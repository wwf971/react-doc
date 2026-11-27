import assert from 'node:assert/strict';
import test from 'node:test';
import { oaTimeParse } from '../time/oa-time.js';
import { timetableAllDayRowMapOf, timetableHold, timetableLaneMapOf, timetablePlaceOf, timetableRawBuild, timetableRead, timetableSpanOfPlace, timetableWeekText } from './TimetableWeekData.js';

// a page of two components: one at a time (its time is the "time" of its yaml), one not
const timeItem = {
	spanGet: (data) => {
		const match = /time: (.*)/.exec(data.raw ?? '');
		return match ? oaTimeParse(match[1]).span : null;
	},
};
const definitionByName = {
	MeetingZoomReservation: { expose: { meta: { label: 'Zoom meeting reservation' }, timeItem } },
	MeetingZoomInstance: { expose: { meta: { label: 'Zoom meeting instance' } } },
};
const context = { compDefinitionGet: (name) => definitionByName[name] ?? null, packageConfigGet: () => ({ TimeWeekStart: 'monday' }) };
const block = (time, title = 'Sync') => ({ comp: 'MeetingZoomReservation', lang: 'yaml', raw: `title: ${title}\ntime: ${time}\n` });

test('a table not bound yet is bound to the week of the first card at a day', () => {
	const empty = { raw: 'title: Week\nentryList: []\n' };
	assert.equal(timetableHold.takeCheck(empty, block('2026-11-25 10:00~10:45 +09'), context), '');
	const { raw } = timetableHold.take(empty, block('2026-11-25 10:00~10:45 +09'), context);
	const table = timetableRead({ raw });
	assert.deepEqual(table.week, { mode: 'bound', start: '2026-11-23' }, 'the Monday of its week');
	assert.equal(table.zone, 540, 'and its zone');
	assert.equal(table.entryList.length, 1);
	// a card of another week is refused, saying why; one of the week is taken
	assert.match(timetableHold.takeCheck({ raw }, block('2026-12-02 10:00 +09'), context), /not in the week of 11-23 – 11-29/);
	assert.equal(timetableHold.takeCheck({ raw }, block('2026-11-29 22:00~23:00 +09'), context), '');
	assert.equal(timetableHold.takeCheck({ raw }, block('2026-11-29 16:00~17:00 +00'), context).length > 0, true, 'in the zone of the table it is Monday 01:00 of the next week');
});

test('what is not at a time, or has no time of day, is refused with the reason', () => {
	const empty = { raw: 'entryList: []\n' };
	assert.equal(timetableHold.takeCheck(empty, { comp: 'MeetingZoomInstance', raw: 'title: Room\n' }, context), 'Zoom meeting instance is not at a time');
	assert.match(timetableHold.takeCheck(empty, block(''), context), /says no time/);
	assert.equal(timetableHold.takeCheck(empty, block('2026-11-25 +09'), context), '', 'a whole day is taken: its row of whole days');
	assert.match(timetableHold.takeCheck(empty, block('2026-11 +09'), context), /a month: a week holds days and times of day/);
	assert.match(timetableHold.takeCheck(empty, block('2026 spring +09'), context), /a year \(spring\)/);
	assert.match(timetableHold.takeCheck(empty, { comp: 'Unknown', raw: '' }, context), /no component Unknown/);
});

test('a table never bound takes any day, and places a card by its day of the week', () => {
	const every = { raw: 'week: every\nzone: +09\nentryList: []\n' };
	const { raw } = timetableHold.take(every, block('2026-12-09 09:00~09:30 +09'), context);
	const table = timetableRead({ raw });
	assert.equal(table.week.mode, 'every', 'it stays unbound');
	const place = timetablePlaceOf(table, oaTimeParse('2026-12-09 09:00~09:30 +09').span, { zone: 540 });
	assert.deepEqual([place.dayIndex, place.start, place.end], [2, 540, 570], 'a Wednesday is the third column from Monday');
	assert.equal(timetablePlaceOf(table, oaTimeParse('Sun 10:00 +09').span, { zone: 540, weekStart: 'sunday' }).dayIndex, 0);
	assert.match(timetableWeekText(table, { zone: 540 }), /^Every week, from Monday \+09$/);
});

test('a place of the table is a time: a day of a bound week, else a day of the week', () => {
	const bound = timetableRead({ raw: 'week: 2026-11-23\nentryList: []\n' });
	assert.equal(oaTimeParse('x').message !== undefined, true);
	const span = timetableSpanOfPlace(bound, { dayIndex: 4, start: 600, end: 645 }, { zone: 540 });
	assert.deepEqual([span.date, span.start, span.end], ['2026-11-27', 600, 645]);
	const every = timetableRead({ raw: 'week: every\nentryList: []\n' });
	assert.equal(timetableSpanOfPlace(every, { dayIndex: 0, start: 600, end: 645 }, { zone: 540 }).weekday, 1);
	const keptWeek = timetableSpanOfPlace(every, { dayIndex: 1, start: 600, end: 645 }, { zone: 540, spanBefore: oaTimeParse('2026-12-09 09:00 +09').span });
	assert.equal(keptWeek.date, '2026-12-08', 'a card at a day keeps its week, on another day of it');
	assert.equal(timetableWeekText(bound, { zone: 540 }), 'Week of Mon 2026-11-23 – Sun 11-29 +09');
});

test('cards at the same time stand side by side; an entry let go leaves the rest', () => {
	const laneMap = timetableLaneMapOf([
		{ key: 'a', dayIndex: 0, start: 600, end: 660 },
		{ key: 'b', dayIndex: 0, start: 630, end: 690 },
		{ key: 'c', dayIndex: 0, start: 700, end: 720 },
		{ key: 'd', dayIndex: 1, start: 600, end: 660 },
	]);
	assert.deepEqual(laneMap.get('a'), { lane: 0, laneCount: 2 });
	assert.deepEqual(laneMap.get('b'), { lane: 1, laneCount: 2 });
	assert.deepEqual(laneMap.get('c'), { lane: 0, laneCount: 1 });
	assert.deepEqual(laneMap.get('d'), { lane: 0, laneCount: 1 });
	const raw = timetableRawBuild({ ...timetableRead({ raw: 'week: 2026-11-23\nentryList: []\n' }), entryList: [block('2026-11-25 10:00 +09', 'A'), block('2026-11-26 10:00 +09', 'B')] });
	const result = timetableHold.letGo({ raw }, '0');
	assert.match(result.block.raw, /title: A/);
	assert.deepEqual(timetableRead({ raw: result.raw }).entryList.map((entry) => /title: (\w)/.exec(entry.raw)[1]), ['B']);
	assert.equal(timetableHold.letGo({ raw }, '5'), null);
	assert.deepEqual(timetableHold.heldListGet({ raw }).map((one) => one.key), ['0', '1']);
});

test('a time at a coarser granularity is placed by the range it refers to', () => {
	const table = timetableRead({ raw: 'week: 2026-11-23\nzone: +09\nentryList: []\n' });
	const placeOf = (stored) => timetablePlaceOf(table, oaTimeParse(stored).span, { zone: 540 });
	assert.deepEqual(placeOf('2026-11-28 evening +09'), { kind: 'box', dayIndex: 5, start: 1020, end: 1320, isEndWritten: true, isApproximate: true, period: 'evening' });
	assert.equal(placeOf('2026-11-28 night +09').end, 1440, 'a night is drawn to the end of its day');
	assert.deepEqual(placeOf('2026-11-25~11-27 +09'), { kind: 'allDay', dayIndex: 2, dayIndexEnd: 4, isPeriodUnknown: false });
	assert.deepEqual(placeOf('2026-11-28 siesta +09'), { kind: 'allDay', dayIndex: 5, dayIndexEnd: 5, isPeriodUnknown: true }, 'a part the page does not know: the whole day');
	assert.match(placeOf('2026-11-28~12-01 +09').reason, /are not all in the week/);
	const every = timetableRead({ raw: 'week: every\nentryList: []\n' });
	assert.equal(timetablePlaceOf(every, oaTimeParse('Sat morning +09').span, { zone: 540 }).dayIndex, 5);
	assert.deepEqual(timetableAllDayRowMapOf([{ key: 'a', dayIndex: 0, dayIndexEnd: 2 }, { key: 'b', dayIndex: 1, dayIndexEnd: 1 }, { key: 'c', dayIndex: 3, dayIndexEnd: 4 }]), new Map([['a', 0], ['b', 1], ['c', 0]]));
});
