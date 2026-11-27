import assert from 'node:assert/strict';
import test from 'node:test';
import {
	OA_TIME_LAYOUT_LIST, OA_TIME_PERIOD_MAP_DEFAULT, oaDateAdd, oaTimeFormat, oaTimeLengthText, oaTimeParse, oaTimePeriodDefinitionRead, oaTimePeriodsBuild,
	oaTimeRangeOf, oaTimeRangeText, oaTimeSpanCreate, oaTimeSpanInZone, oaTimeTextNormalize, oaTimeTextOf, oaWeekStartOf, oaWeekdayOf, oaZoneParse, oaZoneText,
} from './oa-time.js';

const JST = 540;
const options = { zoneDefault: JST, today: '2026-11-27' };
const read = (text, more = {}) => {
	const { span, message } = oaTimeParse(text, { ...options, ...more });
	if (message) throw new Error(`${text}: ${message}`);
	return span ? oaTimeTextOf(span) : '';
};

test('a time is typed without a colon or a tilde', () => {
	assert.equal(read('1125 1000 1045'), '2026-11-25 10:00~10:45 +09');
	assert.equal(read('20261125 1000 1045'), '2026-11-25 10:00~10:45 +09');
	assert.equal(read('1000 1045'), '2026-11-27 10:00~10:45 +09', 'no day: today');
	assert.equal(read('10 1130'), '2026-11-27 10:00~11:30 +09');
	assert.equal(read('10-11'), '2026-11-27 10:00~11:00 +09', 'a dash between two hours is "to"');
	assert.equal(read('930 45m'), '2026-11-27 09:30~10:15 +09');
	assert.equal(read('930 1h30'), '2026-11-27 09:30~11:00 +09');
	assert.equal(read('2pm 3:30pm'), '2026-11-27 14:00~15:30 +09');
	assert.equal(read('11:30-1 pm'), '2026-11-27 11:30~13:00 +09', 'an am / pm written once is the start\'s too, unless it would end before it starts');
	assert.equal(read('11/25 10'), '2026-11-25 10:00 +09');
	assert.equal(read('11月25日 10時30分'), '2026-11-25 10:30 +09');
	assert.equal(read('2300 0100'), '2026-11-27 23:00~01:00 +09', 'an end before the start is on the next day');
	assert.equal(read('1000 1045 utc'), '2026-11-27 10:00~10:45 +00');
	assert.equal(read('1000 1045 +0530'), '2026-11-27 10:00~10:45 +05:30');
	assert.equal(read('1000 -1045'), '2026-11-27 10:00~10:45 +09', '-1045 after a time is its end, not a zone');
	assert.equal(read(''), '');
});

test('what is not typed is kept from the value held', () => {
	const base = oaTimeParse('2026-11-25 10:00~10:45 +05:30', options).span;
	assert.equal(read('1100', { base }), '2026-11-25 11:00~11:45 +05:30', 'a start alone moves the time, its length kept');
	assert.equal(read('11/26', { base }), '2026-11-26 10:00~10:45 +05:30', 'a day alone keeps the time of day');
	assert.equal(read('fri 14', { base }), '2026-11-27 14:00~14:45 +05:30', 'a weekday over a day: that day of its week');
	assert.equal(read('fri 14'), 'Fri 14:00 +09', 'a weekday with no day to keep: every Friday');
	const weekly = oaTimeParse('Mon 10:00~10:45 +09', options).span;
	assert.equal(read('1100', { base: weekly }), 'Mon 11:00~11:45 +09');
});

test('every format a card shows reads back as the same time', () => {
	const span = oaTimeParse('2026-11-25 10:00~10:45 +09', options).span;
	for (const { id } of OA_TIME_LAYOUT_LIST) {
		for (const clock of ['24h', '12h']) {
			const shown = oaTimeFormat(span, { layout: id, clock });
			assert.equal(read(shown, { base: span }), '2026-11-25 10:00~10:45 +09', `${id} ${clock}: ${shown}`);
		}
	}
	assert.equal(oaTimeFormat(span), 'Wed 2026-11-25 10:00–10:45 +09');
	assert.equal(oaTimeFormat(span, { layout: 'short', clock: '12h' }), 'Wed 11-25 10:00–10:45 AM +09');
	assert.equal(oaTimeFormat(span, { layout: 'long' }), 'Wednesday, November 25, 2026, 10:00–10:45 +09');
	assert.equal(oaTimeFormat(span, { layout: 'clock' }), '10:00–10:45 +09');
	const across = oaTimeParse('2026-11-25 11:30~13:00 +09', options).span;
	assert.equal(oaTimeFormat(across, { clock: '12h' }), 'Wed 2026-11-25 11:30 AM–1:00 PM +09');
	assert.equal(read(oaTimeFormat(across, { clock: '12h' })), '2026-11-25 11:30~13:00 +09');
	assert.equal(oaTimeFormat(oaTimeParse('Mon 10:00 +09', options).span, { layout: 'long' }), 'Monday, 10:00 +09');
	assert.equal(oaTimeFormat(oaTimeParse('2026-11-25 +09', options).span), 'Wed 2026-11-25 +09');
});

test('what cannot be read says why', () => {
	for (const [text, part] of [['2561', 'not a time of day'], ['1000 1045 1100 1200', 'more than a start'], ['2026-02-30 10', 'not a day'], ['mon 2026-11-25 10', 'is a Wednesday'], ['45m', 'needs a start'], ['soon', 'not read as a time']]) {
		const { message } = oaTimeParse(text, options);
		assert.ok(message?.includes(part), `${text}: ${message}`);
	}
	assert.equal(oaTimeTextNormalize('soon', options), 'soon', 'kept as typed');
});

test('days, weeks, zones and lengths', () => {
	assert.equal(oaWeekdayOf('2026-11-25'), 3);
	assert.equal(oaWeekStartOf('2026-11-25', 'monday'), '2026-11-23');
	assert.equal(oaWeekStartOf('2026-11-25', 'sunday'), '2026-11-22');
	assert.equal(oaWeekStartOf('2026-11-23', 'monday'), '2026-11-23');
	assert.equal(oaDateAdd('2026-12-31', 1), '2027-01-01');
	assert.equal(oaZoneText(540), '+09');
	assert.equal(oaZoneText(-210), '-03:30');
	assert.equal(oaZoneParse('UTC+9'), 540);
	assert.equal(oaZoneParse('+09:00'), 540);
	assert.equal(oaZoneParse('Z'), 0);
	const span = oaTimeSpanCreate({ date: '2026-11-25', start: 60, end: 120, zone: JST });
	assert.equal(oaTimeTextOf(oaTimeSpanInZone(span, 0)), '2026-11-24 16:00~17:00 +00', 'the day follows the zone');
	assert.equal(oaTimeTextOf(oaTimeSpanInZone(oaTimeSpanCreate({ weekday: 1, start: 60, end: 120, zone: JST }), 0)), 'Sun 16:00~17:00 +00');
	assert.equal(oaTimeLengthText(span), '1 h');
	assert.equal(oaTimeLengthText(oaTimeSpanCreate({ date: '2026-11-25', start: 600, end: 690, zone: JST })), '1 h 30 min');
	assert.equal(oaTimeLengthText(oaTimeSpanCreate({ date: '2026-11-25', start: 600, zone: JST })), '');
});

// doc/time.md#granularity: a time said as finely as it is known, and the range it refers to
test('a time is said at a granularity: a year, a month, a day, a part of one, a time of day', () => {
	const base = oaTimeParse('2026-11-25 10:00~10:45 +09', options).span;
	const periods = oaTimePeriodsBuild();
	const typed = (text, more = {}) => read(text, { periods, ...more });
	assert.equal(typed('1128 evening'), '2026-11-28 evening +09');
	assert.equal(typed('sat night', { base }), '2026-11-28 night +09', 'the Saturday of the week of the day kept');
	assert.equal(typed('evening', { base }), '2026-11-25 evening +09', 'a part alone: of the day kept');
	assert.equal(typed('11月28日夕方'), '2026-11-28 evening +09');
	assert.equal(typed('11/28 all day', { base }), '2026-11-28 +09', 'the whole day, its time of day dropped');
	assert.equal(typed('11/28', { base }), '2026-11-28 10:00~10:45 +09', 'a day alone keeps the time of day it had');
	assert.equal(typed('11/28~11/30'), '2026-11-28~11-30 +09');
	assert.equal(typed('11/28 3d'), '2026-11-28~11-30 +09');
	assert.equal(typed('1128 week'), '2026-11-23~11-29 +09', 'the week of the day, from its first day');
	assert.equal(typed('2026-12-30~2027-01-02'), '2026-12-30~2027-01-02 +09');
	assert.equal(typed('2026-11'), '2026-11 +09');
	assert.equal(typed('nov'), '2026-11 +09');
	assert.equal(typed('11月上旬'), '2026-11 early +09');
	assert.equal(typed('nov late'), '2026-11 late +09');
	assert.equal(typed('2026 spring'), '2026 spring +09');
	assert.equal(typed('year 2026'), 'year 2026 +09');
	assert.equal(typed('2026年'), 'year 2026 +09');
	assert.equal(typed('mon evening'), 'Mon evening +09', 'every Monday evening');
	for (const [text, part] of [['1128 evning', 'not read as a time'], ['11/28 19:00 evening', 'a part of a day'], ['11/28 early', 'a part of a month'], ['2026-11 spring', 'a part of a year'], ['11/30~11/28', 'before']]) {
		const { message } = oaTimeParse(text, { ...options, periods });
		assert.ok(message?.includes(part), `${text}: ${message}`);
	}
});

test('every granularity reads back from every format', () => {
	const periods = oaTimePeriodsBuild();
	for (const stored of ['year 2026 +09', '2026 spring +09', '2026-11 +09', '2026-11 early +09', '2026-11-28 +09', '2026-11-28~11-30 +09', '2026-12-30~2027-01-02 +09', '2026-11-28 evening +09']) {
		const span = oaTimeParse(stored, options).span;
		assert.equal(oaTimeTextOf(span), stored, `stored: ${stored}`);
		for (const { id } of OA_TIME_LAYOUT_LIST) {
			const shown = oaTimeFormat(span, { layout: id });
			assert.equal(read(shown, { base: span, periods }), stored, `${stored} as ${id}: ${shown}`);
		}
	}
	const span = (stored) => oaTimeParse(stored, options).span;
	assert.equal(oaTimeFormat(span('2026-11-28 evening +09')), 'Sat 2026-11-28 evening +09');
	assert.equal(oaTimeFormat(span('2026-11-28 evening +09'), { layout: 'long' }), 'Saturday, November 28, 2026, evening +09');
	assert.equal(oaTimeFormat(span('2026-11-28~11-30 +09')), 'Sat 2026-11-28 – Mon 11-30 +09');
	assert.equal(oaTimeFormat(span('2026-11-28~11-30 +09'), { layout: 'long' }), 'Saturday, November 28 – Monday, November 30, 2026 +09');
	assert.equal(oaTimeFormat(span('2026-11 early +09'), { layout: 'long' }), 'early November 2026 +09');
	assert.equal(oaTimeFormat(span('year 2026 +09')), 'Year 2026 +09');
	assert.equal(oaTimeLengthText(span('2026-11-28~11-30 +09')), '3 days');
});

test('a time refers to a range that holds everything it may mean', () => {
	const range = (stored, periods) => {
		const one = oaTimeRangeOf(oaTimeParse(stored, options).span, periods);
		return [one.from.date ?? one.from.weekday, one.from.minute, one.to.date ?? one.to.weekday, one.to.minute];
	};
	assert.deepEqual(range('2026-11-28 evening +09'), ['2026-11-28', 1020, '2026-11-28', 1320]);
	assert.deepEqual(range('2026-11-28 night +09'), ['2026-11-28', 1140, '2026-11-29', 300], 'a night ends the next morning');
	assert.deepEqual(range('2026-11-28 +09'), ['2026-11-28', 0, '2026-11-28', 1440]);
	assert.deepEqual(range('2026-11-28~11-30 +09'), ['2026-11-28', 0, '2026-11-30', 1440]);
	assert.deepEqual(range('2026-02 late +09'), ['2026-02-21', 0, '2026-02-28', 1440], 'late: to the end of the month');
	assert.deepEqual(range('2026 winter +09'), ['2026-12-01', 0, '2027-02-28', 1440], 'winter crosses the year, February clamped');
	assert.deepEqual(range('2028 winter +09'), ['2028-12-01', 0, '2029-02-28', 1440]);
	assert.deepEqual(range('2026-11-25 10:00~10:45 +09'), ['2026-11-25', 600, '2026-11-25', 645]);
	assert.deepEqual(range('Mon evening +09'), [1, 1020, 1, 1320]);
	// a part the page does not know: the whole of its unit
	const unknown = oaTimeRangeOf(oaTimeParse('2026-11-28 siesta +09', options).span);
	assert.equal(unknown.isPeriodKnown, false);
	assert.deepEqual([unknown.from.minute, unknown.to.minute], [0, 1440]);
	// a part registered by a page, another word for it
	const periods = oaTimePeriodsBuild({ ...OA_TIME_PERIOD_MAP_DEFAULT, siesta: 'day 13:00~16:00', evening: null }, { 昼寝: 'siesta' });
	assert.deepEqual(range('2026-11-28 siesta +09', periods), ['2026-11-28', 780, '2026-11-28', 960]);
	assert.equal(read('1128 昼寝', { periods }), '2026-11-28 siesta +09');
	assert.ok(oaTimeParse('1128 evening', { ...options, periods }).message, 'a part a page took away is no part there');
	assert.equal(oaTimeRangeText(oaTimeParse('2026-11-28 night +09', options).span), '19:00–05:00 the next day');
	assert.equal(oaTimeRangeText(oaTimeParse('2026-11 early +09', options).span), '11-01 – 11-10');
});

test('a place of a part is read from its form, a wrong one left out', () => {
	assert.deepEqual(oaTimePeriodDefinitionRead('day 17:00~22:00'), { unit: 'day', from: 1020, to: 1320 });
	assert.deepEqual(oaTimePeriodDefinitionRead('day 19:00~05:00'), { unit: 'day', from: 1140, to: 1740 });
	assert.deepEqual(oaTimePeriodDefinitionRead('month 21~'), { unit: 'month', from: 21, to: null });
	assert.deepEqual(oaTimePeriodDefinitionRead('year 04-01~03-31'), { unit: 'year', from: [4, 1], to: [3, 31], isCrossing: true });
	for (const wrong of ['day 25:00~26:00', 'month 10~5', 'week mon~fri', 'evening']) assert.equal(oaTimePeriodDefinitionRead(wrong), null, wrong);
	const periods = oaTimePeriodsBuild({ 'two words': 'day 01:00~02:00', fy: 'year 04-01~03-31', bad: 'day 9~10' });
	assert.deepEqual([...periods.byName.keys()], ['fy']);
	const span = oaTimeParse('2026 fy', { ...options, periods }).span;
	assert.equal(oaTimeTextOf(span), '2026 fy +09');
	const fiscal = oaTimeRangeOf(span, periods);
	assert.deepEqual([fiscal.from.date, fiscal.to.date], ['2026-04-01', '2027-03-31'], 'a fiscal year: April to March');
});
