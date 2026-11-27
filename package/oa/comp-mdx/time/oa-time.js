// The times of the package (doc/time.md): one model of a time for every card at a time (an event, a
// Zoom meeting, a class of a course) and for what collects them (the weekly timetable, a timeline
// later). Pure: no React, no page.
//
// A time is said at a **granularity**, as finely as it is known (doc/time.md#granularity):
//   year      Year 2026                   a part of it: 2026 spring
//   month     2026-11                     a part of it: 2026-11 early
//   day       2026-11-28                  several: 2026-11-28~11-30; a part of it: 2026-11-28 evening
//   minute    2026-11-28 19:00~21:00      a time of day, with or without an end
// A **part** (a period) is a name with its place in its unit: evening is "day 17:00~22:00", early is
// "month 1~10", spring is "year 03-01~05-31" (oaTimePeriodsBuild). The package gives some; a page
// registers more, or changes them, in its config (package preferences TimePeriodMap and
// TimePeriodWordMap, oa-config.js). Every time refers to a **range**, read conservatively: from the
// first moment it may mean to the last (oaTimeRangeOf), so whatever collects times never misses one.
//
// A span, as every function here takes and answers it:
//   granularity  year | month | day | minute
//   date         'YYYY-MM-DD', the first day it names (a month: its first day, a year: January 1); ''
//                for a weekly time (a day of the week alone)
//   dateEnd      the last day of a range of days (day), else ''
//   weekday      0 (Sunday) to 6: read from the date, or the one of a weekly time
//   period       the name of a part of its unit (day: evening, month: early, year: spring), or ''
//   start, end   minutes from 0:00 of its day (minute only; end over 1440 is on the next day)
//   zone         the offset of its zone in minutes (+09 is 540)
//
// It is written in the data in one form (oaTimeTextOf), whatever the reader is shown:
//   year 2026 +09 · 2026 spring +09 · 2026-11 +09 · 2026-11 early +09 · 2026-11-28 +09
//   2026-11-28~11-30 +09 · 2026-11-28 evening +09 · Mon evening +09 · 2026-11-25 10:00~10:45 +09
// and shown in a format (oaTimeFormat): a layout and a clock. What a card shows can be typed back: the
// parser (oaTimeParse) reads every format, and much less (1125 1000 1045, 1128 evening, 11月上旬, nov).

export const OA_WEEKDAY_LIST = Object.freeze(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
const WEEKDAY_SHORT_LIST = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG_LIST = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_KANJI = '日月火水木金土';
const MONTH_LONG_LIST = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_MINUTE = 24 * 60;

// the granularities, coarse to fine
export const OA_TIME_GRANULARITY_LIST = Object.freeze([
	{ id: 'year', label: 'Year', example: 'Year 2026 · 2026 spring' },
	{ id: 'month', label: 'Month', example: '2026-11 · 2026-11 early' },
	{ id: 'day', label: 'Day', example: '2026-11-28 · 2026-11-28~11-30 · 2026-11-28 evening' },
	{ id: 'minute', label: 'Time of day', example: '2026-11-28 19:00~21:00' },
]);

// the layouts a card may write its time in (expose.dataFields of the cards: their edit card, the
// menu of a right click on the time), the first the default of the package
export const OA_TIME_LAYOUT_LIST = Object.freeze([
	{ id: 'full', label: 'Full', example: 'Wed 2026-11-25 10:00–10:45 +09' },
	{ id: 'short', label: 'Short', example: 'Wed 11-25 10:00–10:45 +09' },
	{ id: 'long', label: 'Long', example: 'Wednesday, November 25, 2026, 10:00–10:45 +09' },
	{ id: 'clock', label: 'Time of day only', example: '10:00–10:45 +09' },
]);
export const OA_TIME_CLOCK_LIST = Object.freeze([
	{ id: '24h', label: '24-hour', example: '14:30' },
	{ id: '12h', label: '12-hour', example: '2:30 PM' },
]);

// ---------- days ----------

const pad = (value) => String(value).padStart(2, '0');

// the day number (days since 1970-01-01) of a 'YYYY-MM-DD', NaN for no day
function dayNumberOf(date) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
	if (!match) return Number.NaN;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const time = Date.UTC(year, month - 1, day);
	const back = new Date(time);
	if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return Number.NaN;
	return Math.round(time / 86400000);
}

function dateOfDayNumber(dayNumber) {
	const date = new Date(dayNumber * 86400000);
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function oaDateIsValid(date) {
	return Number.isFinite(dayNumberOf(date));
}

export function oaDateAdd(date, dayCount) {
	return dateOfDayNumber(dayNumberOf(date) + dayCount);
}

// 0 (Sunday) to 6
export function oaWeekdayOf(date) {
	return ((dayNumberOf(date) % 7) + 7 + 4) % 7;
}

// the first day of the week a day is in, the week starting on weekStart ('monday', ... or 0 to 6)
export function oaWeekStartOf(date, weekStart = 'monday') {
	const startDay = typeof weekStart === 'number' ? weekStart : Math.max(0, OA_WEEKDAY_LIST.indexOf(weekStart));
	return oaDateAdd(date, -((oaWeekdayOf(date) - startDay + 7) % 7));
}

// whole days from a to b
export function oaDateDiff(dateFrom, dateTo) {
	return dayNumberOf(dateTo) - dayNumberOf(dateFrom);
}

// the number of days of a month
function monthLengthOf(year, month) {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ---------- zones ----------

// +09, +05:30, -03, +00 for an offset in minutes
export function oaZoneText(zone) {
	const minute = Math.round(Number(zone) || 0);
	const sign = minute < 0 ? '-' : '+';
	const hour = Math.floor(Math.abs(minute) / 60);
	const rest = Math.abs(minute) % 60;
	return `${sign}${pad(hour)}${rest ? `:${pad(rest)}` : ''}`;
}

// the offset of a zone written +09, +0900, +09:00, +9, -3, Z, UTC, UTC+9; null for no zone
export function oaZoneParse(text) {
	const written = String(text ?? '').trim().toLowerCase();
	if (/^(z|utc|gmt)$/.test(written)) return 0;
	const match = /^(?:utc|gmt)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(written);
	if (!match) return null;
	const hour = Number(match[2]);
	const minute = Number(match[3] ?? 0);
	if (hour > 14 || minute >= 60) return null;
	return (match[1] === '-' ? -1 : 1) * (hour * 60 + minute);
}

// the zone of the browser now: what a time typed without one, with nothing to keep, is in
export function oaZoneLocal(now = new Date()) {
	return -now.getTimezoneOffset();
}

// the day of now in a zone, 'YYYY-MM-DD'
export function oaDateToday(zone = oaZoneLocal(), now = new Date()) {
	return dateOfDayNumber(Math.floor((now.getTime() / 60000 + zone) / DAY_MINUTE));
}

// ---------- periods: the named parts of a day, a month, a year ----------

// what the package gives (doc/time.md#parts-of-a-day-a-month-a-year); a page changes or adds to them in
// its config (TimePeriodMap: a name and its place in its unit; TimePeriodWordMap: other words for them).
// The place is read conservatively: what anyone may mean by the word is inside it
export const OA_TIME_PERIOD_MAP_DEFAULT = Object.freeze({
	morning: 'day 05:00~12:00',
	noon: 'day 11:00~14:00',
	afternoon: 'day 12:00~18:00',
	evening: 'day 17:00~22:00',
	night: 'day 19:00~05:00',
	daytime: 'day 08:00~18:00',
	early: 'month 1~10',
	mid: 'month 11~20',
	late: 'month 21~',
	spring: 'year 03-01~05-31',
	summer: 'year 06-01~08-31',
	autumn: 'year 09-01~11-30',
	winter: 'year 12-01~02-29',
	q1: 'year 01-01~03-31',
	q2: 'year 04-01~06-30',
	q3: 'year 07-01~09-30',
	q4: 'year 10-01~12-31',
});
export const OA_TIME_PERIOD_WORD_MAP_DEFAULT = Object.freeze({
	朝: 'morning', 午前中: 'morning', 昼: 'noon', midday: 'noon', 午後: 'afternoon', 夕方: 'evening', 夜: 'night', 日中: 'daytime',
	上旬: 'early', 中旬: 'mid', 下旬: 'late', 春: 'spring', 夏: 'summer', 秋: 'autumn', fall: 'autumn', 冬: 'winter',
});

// the form of a place (the values of TimePeriodMap), checked by the config of the page
const CLOCK_PATTERN = '(?:[01]\\d|2[0-3]):[0-5]\\d|24:00';
const DAY_OF_MONTH_PATTERN = '[1-9]|[12]\\d|3[01]';
const MONTH_DAY_PATTERN = '(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])';
export const OA_TIME_PERIOD_PATTERN_TEXT = `^(?:day (?:${CLOCK_PATTERN})~(?:${CLOCK_PATTERN})|month (?:${DAY_OF_MONTH_PATTERN})~(?:${DAY_OF_MONTH_PATTERN})?|year ${MONTH_DAY_PATTERN}~${MONTH_DAY_PATTERN})$`;
// a name of a period: one word (letters of any script, then letters, digits, _ or -)
export const OA_TIME_PERIOD_NAME_REGEX = /^\p{L}[\p{L}\p{N}_-]*$/u;

const minuteOfClock = (text) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));

// a place read: { unit: 'day', from, to } (minutes; to past 1440 is on the next day) |
// { unit: 'month', from, to } (days; to null: to the end of the month) | { unit: 'year', from: [month, day],
// to: [month, day], isCrossing } (to before from: in the next year); null for what is no place
export function oaTimePeriodDefinitionRead(text) {
	const written = String(text ?? '').trim();
	if (!new RegExp(OA_TIME_PERIOD_PATTERN_TEXT).test(written)) return null;
	const [unit, range] = written.split(' ');
	const [fromText, toText] = range.split('~');
	if (unit === 'day') {
		const from = minuteOfClock(fromText);
		const toRaw = minuteOfClock(toText);
		return { unit, from, to: toRaw > from ? toRaw : toRaw + DAY_MINUTE };
	}
	if (unit === 'month') {
		const from = Number(fromText);
		const to = toText ? Number(toText) : null;
		return to !== null && to < from ? null : { unit, from, to };
	}
	const from = fromText.split('-').map(Number);
	const to = toText.split('-').map(Number);
	return { unit, from, to, isCrossing: to[0] * 100 + to[1] < from[0] * 100 + from[1] };
}

const wordKeyOf = (word) => (/^[\x00-\x7f]+$/.test(word) ? word.toLowerCase() : word);

// the periods a time is read and placed with:
//   byName       name -> { name, unit, from, to, ... }
//   nameByWord   a word typed (a name, or another word for it) -> its name
//   isStrict     an unknown word is refused (typing); else it is taken as a period of the place it
//                stands in, whose range is the whole of its unit (reading what is written)
// periodMap and wordMap as the config holds them (TimePeriodMap, TimePeriodWordMap); an entry null, or
// a name or a place that cannot be read, is left out
const periodsCache = new Map();
export function oaTimePeriodsBuild(periodMap = OA_TIME_PERIOD_MAP_DEFAULT, wordMap = OA_TIME_PERIOD_WORD_MAP_DEFAULT, { isStrict = true } = {}) {
	const cacheKey = JSON.stringify([periodMap, wordMap, isStrict]);
	if (periodsCache.has(cacheKey)) return periodsCache.get(cacheKey);
	const byName = new Map();
	for (const [nameWritten, text] of Object.entries(periodMap ?? {})) {
		const name = wordKeyOf(nameWritten);
		if (text === null || !OA_TIME_PERIOD_NAME_REGEX.test(name)) continue;
		const definition = oaTimePeriodDefinitionRead(text);
		if (definition) byName.set(name, { name, ...definition });
	}
	const nameByWord = new Map([...byName.keys()].map((name) => [name, name]));
	for (const [word, name] of Object.entries(wordMap ?? {})) {
		const key = wordKeyOf(String(word));
		if (name !== null && byName.has(wordKeyOf(String(name))) && OA_TIME_PERIOD_NAME_REGEX.test(key)) nameByWord.set(key, wordKeyOf(String(name)));
	}
	// the words of other scripts, matched as written, the longest first (日中 before 日)
	const wordListNotAscii = [...nameByWord.keys()].filter((word) => !/^[\x00-\x7f]+$/.test(word)).sort((a, b) => b.length - a.length);
	const periods = Object.freeze({ byName, nameByWord, wordListNotAscii, isStrict });
	if (periodsCache.size > 64) periodsCache.clear();
	periodsCache.set(cacheKey, periods);
	return periods;
}

export const OA_TIME_PERIODS_DEFAULT = oaTimePeriodsBuild();
// what a time written in the data is read with when the page's periods are not at hand: the package's,
// and any other word in the place of a period taken as one
const OA_TIME_PERIODS_LENIENT = oaTimePeriodsBuild(OA_TIME_PERIOD_MAP_DEFAULT, OA_TIME_PERIOD_WORD_MAP_DEFAULT, { isStrict: false });

// ---------- the span ----------

export function oaTimeSpanCreate({ granularity = '', date = '', dateEnd = '', weekday = null, period = '', start = null, end = null, zone = 0 } = {}) {
	const startKept = Number.isFinite(start) ? start : null;
	const granularityKept = startKept !== null ? 'minute' : ['year', 'month', 'day'].includes(granularity) ? granularity : 'day';
	let dateKept = oaDateIsValid(date) ? date : '';
	if (dateKept && granularityKept === 'month') dateKept = `${dateKept.slice(0, 7)}-01`;
	if (dateKept && granularityKept === 'year') dateKept = `${dateKept.slice(0, 4)}-01-01`;
	const isWeekly = !dateKept && Number.isInteger(weekday) && (granularityKept === 'day' || granularityKept === 'minute');
	return {
		granularity: granularityKept,
		date: dateKept,
		dateEnd: granularityKept === 'day' && dateKept && oaDateIsValid(dateEnd) && dateEnd > dateKept ? dateEnd : '',
		weekday: dateKept ? oaWeekdayOf(dateKept) : isWeekly ? ((weekday % 7) + 7) % 7 : null,
		period: granularityKept === 'minute' ? '' : String(period ?? ''),
		start: startKept,
		end: startKept !== null && Number.isFinite(end) ? end : null,
		zone: Number.isFinite(zone) ? zone : 0,
	};
}

// whether a span says when: a day (or a month, a year) or a day of the week
export function oaTimeSpanIsSet(span) {
	return Boolean(span && (span.date || Number.isInteger(span.weekday)));
}

// its length in minutes, null without an end (and for what is not a time of day)
export function oaTimeSpanLength(span) {
	return span && Number.isFinite(span.start) && Number.isFinite(span.end) ? span.end - span.start : null;
}

// the same moment in another zone: the day (or the day of the week) follows. Only a time of day moves:
// a day, a month or a year is the one written, in its own zone
export function oaTimeSpanInZone(span, zone) {
	if (!span || !Number.isFinite(span.start) || span.zone === zone) return span;
	const shift = zone - span.zone;
	const startShifted = span.start + shift;
	const dayShift = Math.floor(startShifted / DAY_MINUTE);
	const start = startShifted - dayShift * DAY_MINUTE;
	const end = Number.isFinite(span.end) ? span.end + shift - dayShift * DAY_MINUTE : null;
	if (span.date) return oaTimeSpanCreate({ date: oaDateAdd(span.date, dayShift), start, end, zone });
	return oaTimeSpanCreate({ weekday: (span.weekday ?? 0) + dayShift, start, end, zone });
}

// the span moved by whole days, all else kept (a day of a range keeps its length, a weekly time its
// day of the week moved)
export function oaTimeSpanDaysShift(span, dayCount) {
	if (!span || !dayCount) return span;
	if (span.date) return oaTimeSpanCreate({ ...span, date: oaDateAdd(span.date, dayCount), dateEnd: span.dateEnd ? oaDateAdd(span.dateEnd, dayCount) : '' });
	return oaTimeSpanCreate({ ...span, weekday: (span.weekday ?? 0) + dayCount });
}

const clockText24 = (minute) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

// the last day of a range as written after its first: 11-30, or 2027-01-02 in another year
const dateEndShortOf = (span) => (span.dateEnd.slice(0, 4) === span.date.slice(0, 4) ? span.dateEnd.slice(5) : span.dateEnd);

// the stored text of a span (the forms at the top); '' for none
export function oaTimeTextOf(span) {
	if (!oaTimeSpanIsSet(span)) return '';
	const zone = oaZoneText(span.zone);
	const period = span.period ? ` ${span.period}` : '';
	if (span.granularity === 'year') return span.period ? `${span.date.slice(0, 4)}${period} ${zone}` : `year ${span.date.slice(0, 4)} ${zone}`;
	if (span.granularity === 'month') return `${span.date.slice(0, 7)}${period} ${zone}`;
	const day = span.date ? (span.dateEnd ? `${span.date}~${dateEndShortOf(span)}` : span.date) : WEEKDAY_SHORT_LIST[span.weekday];
	if (span.granularity === 'day') return `${day}${period} ${zone}`;
	const start = clockText24(span.start);
	return Number.isFinite(span.end) ? `${day} ${start}~${clockText24(span.end % DAY_MINUTE)} ${zone}` : `${day} ${start} ${zone}`;
}

// ---------- the reader's form ----------

function clockText(minute, clock, isMeridiemShown = true) {
	const dayMinute = ((minute % DAY_MINUTE) + DAY_MINUTE) % DAY_MINUTE;
	if (clock !== '12h') return clockText24(dayMinute);
	const hour = Math.floor(dayMinute / 60);
	const hour12 = hour % 12 === 0 ? 12 : hour % 12;
	return `${hour12}:${pad(dayMinute % 60)}${isMeridiemShown ? ` ${hour < 12 ? 'AM' : 'PM'}` : ''}`;
}

// the time of day of a span as a reader reads it: 10:00–10:45, 10:00–10:45 AM, 11:30 AM–1:00 PM
export function oaTimeClockRangeText(span, { clock = '24h' } = {}) {
	if (!span || !Number.isFinite(span.start)) return '';
	if (!Number.isFinite(span.end)) return clockText(span.start, clock);
	const isSameHalf = clock === '12h' && Math.floor((span.start % DAY_MINUTE) / 720) === Math.floor((span.end % DAY_MINUTE) / 720) && span.end - span.start < 720;
	return `${clockText(span.start, clock, !isSameHalf)}–${clockText(span.end, clock)}`;
}

// a day as a reader reads it, in a layout: Sat 2026-11-28, Sat 11-28, Saturday, November 28, 2026
function dayText(date, layout, { isYearShown = true } = {}) {
	const weekday = oaWeekdayOf(date);
	const [year, month, day] = date.split('-').map(Number);
	if (layout === 'long') return `${WEEKDAY_LONG_LIST[weekday]}, ${MONTH_LONG_LIST[month - 1]} ${day}${isYearShown ? `, ${year}` : ''}`;
	return `${WEEKDAY_SHORT_LIST[weekday]} ${layout === 'short' || !isYearShown ? date.slice(5) : date}`;
}

// the days of a span (granularity day), without its period: one day, a range, a day of every week
function daysText(span, layout) {
	if (!span.date) return layout === 'long' ? WEEKDAY_LONG_LIST[span.weekday] : WEEKDAY_SHORT_LIST[span.weekday];
	if (!span.dateEnd) return dayText(span.date, layout === 'clock' ? 'full' : layout);
	const isSameYear = span.date.slice(0, 4) === span.dateEnd.slice(0, 4);
	if (layout === 'long') {
		return isSameYear ? `${dayText(span.date, 'long', { isYearShown: false })} – ${dayText(span.dateEnd, 'long')}` : `${dayText(span.date, 'long')} – ${dayText(span.dateEnd, 'long')}`;
	}
	if (layout === 'short' && isSameYear) return `${dayText(span.date, 'short')} – ${dayText(span.dateEnd, 'short')}`;
	return `${dayText(span.date, 'full')} – ${dayText(span.dateEnd, 'full', { isYearShown: !isSameYear })}`;
}

// a span as a card shows it, in a layout (OA_TIME_LAYOUT_LIST) and a clock ('24h' | '12h'); always
// with its zone. '' for none
//   minute   Wed 2026-11-25 10:00–10:45 +09 · Wed 11-25 … · Wednesday, November 25, 2026, 10:00–10:45 +09 · 10:00–10:45 +09
//   day      Sat 2026-11-28 +09 · Sat 2026-11-28 – Mon 11-30 +09 · Sat 2026-11-28 evening +09 (clock: evening +09)
//   month    2026-11 +09 · 2026-11 early +09 (long: November 2026, early November 2026)
//   year     Year 2026 +09 · 2026 spring +09 (long: spring 2026)
// a weekly time: Mon 10:00–10:45 +09, Mon evening +09 (long: Monday, …)
export function oaTimeFormat(span, { layout = 'full', clock = '24h' } = {}) {
	if (!oaTimeSpanIsSet(span)) return '';
	const zone = oaZoneText(span.zone);
	const year = span.date.slice(0, 4);
	if (span.granularity === 'year') {
		if (!span.period) return `Year ${year} ${zone}`;
		return layout === 'long' ? `${span.period} ${year} ${zone}` : `${year} ${span.period} ${zone}`;
	}
	if (span.granularity === 'month') {
		const month = layout === 'long' ? `${MONTH_LONG_LIST[Number(span.date.slice(5, 7)) - 1]} ${year}` : span.date.slice(0, 7);
		if (!span.period) return `${month} ${zone}`;
		return layout === 'long' ? `${span.period} ${month} ${zone}` : `${month} ${span.period} ${zone}`;
	}
	if (span.granularity === 'day') {
		const days = daysText(span, layout);
		if (!span.period) return `${days} ${zone}`;
		if (layout === 'clock') return `${span.period} ${zone}`;
		return layout === 'long' ? `${days}, ${span.period} ${zone}` : `${days} ${span.period} ${zone}`;
	}
	const clockPart = oaTimeClockRangeText(span, { clock });
	let dayPart;
	if (layout === 'clock') dayPart = '';
	else if (!span.date) dayPart = layout === 'long' ? `${WEEKDAY_LONG_LIST[span.weekday]},` : WEEKDAY_SHORT_LIST[span.weekday];
	else dayPart = layout === 'long' ? `${dayText(span.date, 'long')},` : dayText(span.date, layout);
	return [dayPart, clockPart, zone].filter(Boolean).join(' ');
}

// how long, as a card says it beside the time: 45 min, 1 h 30 min, 3 days; '' when it says nothing
export function oaTimeLengthText(span) {
	if (span?.granularity === 'day' && span.dateEnd) return `${oaDateDiff(span.date, span.dateEnd) + 1} days`;
	const length = oaTimeSpanLength(span);
	if (!Number.isFinite(length) || length <= 0) return '';
	const hour = Math.floor(length / 60);
	const minute = length % 60;
	if (!hour) return `${minute} min`;
	return minute ? `${hour} h ${minute} min` : `${hour} h`;
}

// ---------- the range a time refers to ----------

// a point { date | weekday, minute } with its minute in 0 to 1440 (1440: the end of its day)
function pointOf({ date = '', weekday = null, minute }) {
	const dayShift = minute > DAY_MINUTE ? Math.floor((minute - 1) / DAY_MINUTE) : 0;
	const minuteKept = minute - dayShift * DAY_MINUTE;
	return date ? { date: oaDateAdd(date, dayShift), minute: minuteKept } : { weekday: ((weekday + dayShift) % 7 + 7) % 7, minute: minuteKept };
}

// the range a time refers to, read conservatively: from the first moment it may mean to the last.
//   { from, to, zone, isExact, period, isPeriodKnown }, from and to { date | weekday, minute } (to: the
//   moment it ends, 1440 the end of its day); isExact: a time of day; period: the definition read, if any
// A part the page does not know is the whole of its unit (isPeriodKnown false). null for no time
export function oaTimeRangeOf(span, periods = OA_TIME_PERIODS_DEFAULT) {
	if (!oaTimeSpanIsSet(span)) return null;
	const definition = span.period ? periods.byName.get(wordKeyOf(span.period)) ?? null : null;
	const unitOfGranularity = span.granularity === 'year' ? 'year' : span.granularity === 'month' ? 'month' : 'day';
	const period = definition && definition.unit === unitOfGranularity ? definition : null;
	const result = (from, to) => ({ from, to, zone: span.zone, isExact: span.granularity === 'minute', period, isPeriodKnown: !span.period || Boolean(period) });
	const at = { date: span.date, weekday: span.weekday };
	if (span.granularity === 'minute') return result(pointOf({ ...at, minute: span.start }), pointOf({ ...at, minute: span.end ?? span.start }));
	if (span.granularity === 'day') {
		if (period) return result(pointOf({ ...at, minute: period.from }), pointOf({ ...at, minute: period.to }));
		return result({ ...(span.date ? { date: span.date } : { weekday: span.weekday }), minute: 0 }, { ...(span.date ? { date: span.dateEnd || span.date } : { weekday: span.weekday }), minute: DAY_MINUTE });
	}
	const year = Number(span.date.slice(0, 4));
	if (span.granularity === 'month') {
		const month = Number(span.date.slice(5, 7));
		const length = monthLengthOf(year, month);
		const from = period ? Math.min(period.from, length) : 1;
		const to = period ? Math.min(period.to ?? length, length) : length;
		return result({ date: `${span.date.slice(0, 8)}${pad(from)}`, minute: 0 }, { date: `${span.date.slice(0, 8)}${pad(to)}`, minute: DAY_MINUTE });
	}
	if (!period) return result({ date: `${year}-01-01`, minute: 0 }, { date: `${year}-12-31`, minute: DAY_MINUTE });
	const yearTo = period.isCrossing ? year + 1 : year;
	const dayTo = Math.min(period.to[1], monthLengthOf(yearTo, period.to[0]));
	const dayFrom = Math.min(period.from[1], monthLengthOf(year, period.from[0]));
	return result({ date: `${year}-${pad(period.from[0])}-${pad(dayFrom)}`, minute: 0 }, { date: `${yearTo}-${pad(period.to[0])}-${pad(dayTo)}`, minute: DAY_MINUTE });
}

// the range of a time not exact, as a reader reads it beside the time: 17:00–22:00 (a part of a day),
// the whole day, 11-01 – 11-10, 12-01 – 02-28; '' for a time of day and for several days (their own
// text and their length say it)
export function oaTimeRangeText(span, periods = OA_TIME_PERIODS_DEFAULT, { clock = '24h' } = {}) {
	const range = oaTimeRangeOf(span, periods);
	if (!range || range.isExact) return '';
	const unknown = range.isPeriodKnown ? '' : `${span.period} is no part known here: `;
	if (span.granularity === 'day') {
		if (range.period) {
			const crossing = range.from.date !== range.to.date || range.from.weekday !== range.to.weekday;
			return `${unknown}${clockText(range.period.from, clock)}–${clockText(range.period.to, clock)}${crossing && range.to.minute !== DAY_MINUTE ? ' the next day' : ''}`;
		}
		return span.dateEnd ? unknown.replace(/: $/, '') : `${unknown}the whole day`;
	}
	return `${unknown}${range.from.date.slice(5)} – ${range.to.date.slice(5)}`;
}

// ---------- reading what is typed ----------

const WEEKDAY_WORD_LIST = OA_WEEKDAY_LIST.map((name) => [name, name.slice(0, 3), ...(name === 'tuesday' ? ['tues'] : []), ...(name === 'thursday' ? ['thur', 'thurs'] : [])]);
// words that say nothing of the time, read through
const FILLER_WORD_LIST = ['every', 'at', 'on', 'from', 'for', 'and', 'next', 'the', 'of', 'in', 'whole', 'all'];
const ALL_DAY_WORD_LIST = ['allday', 'all-day', 'day', '終日'];

function weekdayOfWord(word) {
	const index = WEEKDAY_WORD_LIST.findIndex((list) => list.includes(word));
	return index >= 0 ? index : null;
}

function monthOfWord(word) {
	const index = MONTH_LONG_LIST.findIndex((name) => name.toLowerCase() === word || name.toLowerCase().slice(0, 3) === word || (name === 'September' && word === 'sept'));
	return index >= 0 ? index + 1 : null;
}

// a clock written h, hh, hmm, hhmm, h:mm, with am / pm after it: minutes, or null
function clockOfToken(text, meridiem) {
	let hour;
	let minute = 0;
	const colon = /^(\d{1,2})[:：](\d{2})$/.exec(text);
	if (colon) [hour, minute] = [Number(colon[1]), Number(colon[2])];
	else if (/^\d{1,2}$/.test(text)) hour = Number(text);
	else if (/^\d{3,4}$/.test(text)) [hour, minute] = [Number(text.slice(0, -2)), Number(text.slice(-2))];
	else return null;
	if (minute >= 60) return null;
	if (meridiem) {
		if (hour < 1 || hour > 12) return null;
		hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
	}
	if (hour > 24 || (hour === 24 && minute > 0)) return null;
	return hour * 60 + minute;
}

// the parts of a text: dates, months, years, weekdays, clocks (with their am / pm), lengths (of minutes,
// of days), parts (periods), marks (week, all day), a zone, and range marks
function tokenListOf(text, periods) {
	let rest = ` ${String(text ?? '').toLowerCase()} `
		// an ISO time: 2026-11-25T10:00:00.000+09:00
		.replace(/(\d{4}-\d{2}-\d{2})t(\d{1,2}:\d{2})(?::\d{2}(?:\.\d+)?)?(z|[+-]\d{2}(?::?\d{2})?)?/g, (all, date, clock, zone) => `${date} ${clock} ${zone ?? ''}`)
		.replace(/[〜～~–—]/g, ' ~ ')
		.replace(/(\d)\s*時\s*(\d{2})\s*分?/g, '$1:$2')
		.replace(/\bto\b/g, ' ~ ')
		.replace(/[,()、]/g, ' ');
	const tokenList = [];
	let zone = null;
	// a zone at the end: +09, UTC+9, Z
	const zoneMatch = /\s((?:utc|gmt)?\s*[+-]\d{1,2}(?::?\d{2})?|z|utc|gmt)\s*$/.exec(rest);
	// -1045 after a time is its end (a dash typed for "to"), not a zone: a zone west of UTC is written
	// -10, -10:45 or UTC-1045
	const isEndNotZone = zoneMatch && /^-\d{3,4}$/.test(zoneMatch[1]);
	if (zoneMatch && !isEndNotZone && oaZoneParse(zoneMatch[1]) !== null) {
		zone = oaZoneParse(zoneMatch[1]);
		rest = rest.slice(0, zoneMatch.index);
	}
	const periodToken = (word) => ({ kind: 'period', word, name: periods.nameByWord.get(wordKeyOf(word)) ?? null });
	// a word no part is named, read where a part is written in the data: right after its day, its month,
	// its year (or the four digits of a year)
	const isAtPartPlace = () => ['date', 'month', 'year', 'weekday'].includes(tokenList.at(-1)?.kind) || isBareFourDigit(tokenList.at(-1));
	while ((rest = rest.trimStart())) {
		let match;
		if ((match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/.exec(rest)) || (match = /^(\d{4})(\d{2})(\d{2})(?!\d)/.exec(rest))) {
			tokenList.push({ kind: 'date', year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) });
		} else if ((match = /^(\d{1,2})月(\d{1,2})日(?!間)/.exec(rest)) || (match = /^(\d{1,2})[/.](\d{1,2})(?![\d:])/.exec(rest))) {
			tokenList.push({ kind: 'date', year: null, month: Number(match[1]), day: Number(match[2]) });
		} else if ((match = /^(\d{4})[-/.](\d{1,2})(?![-/.\d])/.exec(rest)) || (match = /^(\d{4})年(\d{1,2})月(?!\d)/.exec(rest))) {
			tokenList.push({ kind: 'month', year: Number(match[1]), month: Number(match[2]) });
		} else if ((match = /^(\d{4})年/.exec(rest))) {
			tokenList.push({ kind: 'year', year: Number(match[1]) });
		} else if ((match = /^(\d{1,2})月(?!\d)/.exec(rest))) {
			tokenList.push({ kind: 'month', year: null, month: Number(match[1]) });
		} else if ((match = /^(\d{1,2})-(\d{1,2})(?![\d:])/.exec(rest))) {
			// 11-25: a day or a range of hours, decided by what is around it (oaTimeParse)
			tokenList.push({ kind: 'dashPair', first: match[1], second: match[2] });
		} else if ((match = /^(\d+)\s*(days|day|d|日間)(?![a-z])/.exec(rest))) {
			tokenList.push({ kind: 'dayLength', day: Number(match[1]) });
		} else if ((match = /^(\d+(?:\.\d+)?)\s*(hours|hour|hrs|hr|h)(?![a-z])\s*(?:(\d{1,2})\s*(?:minutes|minute|mins|min|m)?(?![a-z]))?/.exec(rest))) {
			tokenList.push({ kind: 'length', minute: Math.round(Number(match[1]) * 60) + Number(match[3] ?? 0) });
		} else if ((match = /^(\d+)\s*(minutes|minute|mins|min|m|分)(?![a-z])/.exec(rest))) {
			tokenList.push({ kind: 'length', minute: Number(match[1]) });
		} else if ((match = /^(\d{1,2}[:：]\d{2}|\d{1,4})\s*(?:時)?\s*(am|pm|a\.m\.|p\.m\.|午前(?!中)|午後)?(?![a-z\d])/.exec(rest))) {
			const meridiemWritten = match[2] ? (/^(am|a\.m\.|午前)$/.test(match[2]) ? 'am' : 'pm') : null;
			tokenList.push({ kind: 'clock', text: match[1].replace('：', ':'), meridiem: meridiemWritten });
		} else if ((match = /^(午前|午後)\s*(\d{1,2}(?:[:：]\d{2})?)/.exec(rest))) {
			tokenList.push({ kind: 'clock', text: match[2].replace('：', ':'), meridiem: match[1] === '午前' ? 'am' : 'pm' });
		} else if ((match = /^([a-z][a-z-]*)\.?/.exec(rest))) {
			const word = match[1];
			const weekday = weekdayOfWord(word);
			const month = monthOfWord(word);
			if (weekday !== null) tokenList.push({ kind: 'weekday', weekday });
			else if (month !== null) {
				// November 28 (2026), November 2026, November
				const withDay = /^[a-z]+\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?![\d:])(?:\s+(\d{4})(?![\d:]))?/.exec(rest);
				const withYear = !withDay && /^[a-z]+\.?\s+(\d{4})(?![\d:])/.exec(rest);
				if (withDay) tokenList.push({ kind: 'date', year: withDay[2] ? Number(withDay[2]) : null, month, day: Number(withDay[1]) });
				else if (withYear) tokenList.push({ kind: 'month', year: Number(withYear[1]), month });
				else tokenList.push({ kind: 'month', year: null, month });
				rest = rest.slice((withDay ?? withYear ?? match)[0].length);
				continue;
			} else if (word === 'year' && /^year\s+(\d{4})(?![\d:])/.test(rest)) {
				const yearMatch = /^year\s+(\d{4})(?![\d:])/.exec(rest);
				tokenList.push({ kind: 'year', year: Number(yearMatch[1]) });
				rest = rest.slice(yearMatch[0].length);
				continue;
			} else if (word === 'week') tokenList.push({ kind: 'marker', marker: 'week' });
			else if (ALL_DAY_WORD_LIST.includes(word)) tokenList.push({ kind: 'marker', marker: 'allDay' });
			else if (FILLER_WORD_LIST.includes(word)) { /* says nothing */ }
			else if (periods.nameByWord.has(word) || (!periods.isStrict && isAtPartPlace())) tokenList.push(periodToken(word));
			else return { message: `"${word}" is not read as a time${periods.byName.size ? ` (the parts of a day, a month, a year: ${[...periods.byName.keys()].join(', ')})` : ''}` };
		} else if ((match = /^終日/.exec(rest))) {
			tokenList.push({ kind: 'marker', marker: 'allDay' });
		} else if ((match = /^週/.exec(rest))) {
			tokenList.push({ kind: 'marker', marker: 'week' });
		} else if ((match = periods.wordListNotAscii.map((word) => (rest.startsWith(word) ? [word] : null)).find(Boolean))) {
			tokenList.push(periodToken(match[0]));
		} else if ((match = new RegExp(`^([${WEEKDAY_KANJI}])(?:曜日?)?(?![\\d月])`).exec(rest))) {
			tokenList.push({ kind: 'weekday', weekday: WEEKDAY_KANJI.indexOf(match[1]) });
		} else if ((match = /^\p{L}[\p{L}\p{N}_-]*/u.exec(rest)) && !periods.isStrict && isAtPartPlace()) {
			tokenList.push(periodToken(match[0]));
		} else if ((match = /^[~-]/.exec(rest))) {
			tokenList.push({ kind: 'range' });
		} else {
			return { message: `"${rest.trim().split(/\s+/)[0]}" is not read as a time` };
		}
		rest = rest.slice(match[0].length);
	}
	return { tokenList, zone };
}

const isBareFourDigit = (token) => token?.kind === 'clock' && !token.meridiem && /^\d{4}$/.test(token.text);

// what is typed, read as a span. base: the span the value held (what is not typed is kept from it:
// its day, its zone, its time of day or part of a day when only a day is typed, its length when only a
// start is typed). Options:
//   zoneDefault   the zone when neither the text nor the base has one (the browser's)
//   today         'YYYY-MM-DD' in that zone, for a time typed without a day and no day to keep
//   weekStart     the first day of the week, for a weekday typed over a day, and for "week"
//   periods       the named parts (oaTimePeriodsBuild: the page's); without them, the package's, and
//                 any other word where a part stands taken as one (what is written in the data)
// -> { span } or { message } saying what could not be read; '' typed answers { span: null }
//
//   1125 1000 1045            Nov 25, 10:00 to 10:45 (the year of the base, else this year)
//   1000 1045, 10-11, 930 45m   on the day kept
//   1128 evening, sat night   a part of a day; evening alone: of the day kept
//   11/28, 20261128, 11/28 all day   a day (alone, it keeps the time of day it had; "all day": the day)
//   11/28~11/30, 11/28 3d, 1128 week   several days
//   2026-11, nov, 11月, 11月上旬, nov early   a month, a part of it
//   2026 spring, year 2026, 2026年     a year, a part of it
//   fri 14                    on the Friday of the week of the day kept; with no day kept, every Friday
//   anything a card shows reads back
export function oaTimeParse(text, { base = null, zoneDefault = oaZoneLocal(), today = null, weekStart = 'monday', periods = OA_TIME_PERIODS_LENIENT } = {}) {
	if (!String(text ?? '').trim()) return { span: null };
	const read = tokenListOf(text, periods);
	if (read.message) return { message: read.message };
	let tokenList = [...read.tokenList];
	const zone = read.zone ?? base?.zone ?? zoneDefault;
	const todayKept = today ?? oaDateToday(zone);
	const yearKept = Number((base?.date || todayKept).slice(0, 4));
	const unitOfPeriod = (token) => periods.byName.get(token.name ?? '')?.unit ?? null;

	// a pair with a dash: a day when a clock follows it, a weekday is before it, or it ends a range of days
	tokenList = tokenList.flatMap((token, index) => {
		if (token.kind !== 'dashPair') return [token];
		const previous = tokenList[index - 1];
		const isDay = previous?.kind === 'weekday'
			|| tokenList.slice(index + 1).some((one) => one.kind === 'clock')
			|| (previous?.kind === 'range' && ['date', 'dashPair'].includes(tokenList[index - 2]?.kind))
			|| tokenList[index + 1]?.kind === 'range' && ['date', 'dashPair', 'weekday'].includes(tokenList[index + 2]?.kind);
		return isDay
			? [{ kind: 'date', year: null, month: Number(token.first), day: Number(token.second) }]
			: [{ kind: 'clock', text: token.first, meridiem: null }, { kind: 'range' }, { kind: 'clock', text: token.second, meridiem: null }];
	});
	// four digits beside a part of a year are the year (2026 spring, spring 2026)
	tokenList = tokenList.map((token, index) => {
		if (!isBareFourDigit(token)) return token;
		const besideList = [tokenList[index - 1], tokenList[index + 1]].filter((one) => one?.kind === 'period');
		const isYear = besideList.some((one) => unitOfPeriod(one) === 'year' || (!one.name && !tokenList.some((other) => ['date', 'month'].includes(other.kind))));
		return isYear ? { kind: 'year', year: Number(token.text) } : token;
	});
	const listOf = (kind) => tokenList.filter((token) => token.kind === kind);
	let clockList = listOf('clock');
	const dateTokenList = listOf('date');
	const periodList = listOf('period');
	const markerOf = (marker) => tokenList.some((token) => token.kind === 'marker' && token.marker === marker);
	const dayLengthToken = listOf('dayLength')[0] ?? null;
	const isDayQualified = periodList.some((one) => (unitOfPeriod(one) ?? 'day') === 'day') || dayLengthToken || markerOf('week') || markerOf('allDay');
	// without a day: three bare groups are a month and a day, then a start and an end (1125 1000 1045);
	// four digits alone before a part of a day, a length in days, week or all day are a month and a day
	if (!dateTokenList.length && clockList.length === 3 && /^\d{4}$/.test(clockList[0].text) && !clockList[0].meridiem) {
		dateTokenList.push({ kind: 'date', year: null, month: Number(clockList[0].text.slice(0, 2)), day: Number(clockList[0].text.slice(2)) });
		clockList = clockList.slice(1);
	} else if (!dateTokenList.length && clockList.length === 1 && isBareFourDigit(clockList[0]) && isDayQualified) {
		dateTokenList.push({ kind: 'date', year: null, month: Number(clockList[0].text.slice(0, 2)), day: Number(clockList[0].text.slice(2)) });
		clockList = [];
	}
	if (dateTokenList.length > 2) return { message: 'more than two days are typed' };
	if (clockList.length > 2) return { message: 'more than a start and an end are typed' };
	if (periodList.length > 1) return { message: 'two parts are typed' };
	const lengthToken = listOf('length')[0] ?? null;
	if (lengthToken && clockList.length !== 1) return { message: clockList.length ? 'an end and a length are both typed' : 'a length needs a start before it' };
	const monthToken = listOf('month')[0] ?? null;
	const yearToken = listOf('year')[0] ?? null;
	const periodToken = periodList[0] ?? null;

	// the days typed: [first, last?]
	const dateList = [];
	for (const token of dateTokenList) {
		const yearOther = dateTokenList.find((one) => one.year !== null)?.year;
		const date = `${token.year ?? yearOther ?? yearKept}-${pad(token.month)}-${pad(token.day)}`;
		if (!oaDateIsValid(date)) return { message: `${date} is not a day` };
		dateList.push(date);
	}
	if (dateList.length === 2 && dateList[1] < dateList[0]) return { message: `${dateList[1]} is before ${dateList[0]}` };
	// a weekday written beside a day says the same day
	for (let index = 0; index < tokenList.length; index += 1) {
		const token = tokenList[index];
		if (token.kind !== 'weekday') continue;
		const besideIndex = tokenList[index + 1]?.kind === 'date' ? index + 1 : tokenList[index - 1]?.kind === 'date' ? index - 1 : -1;
		if (besideIndex < 0) continue;
		const date = dateList[tokenList.slice(0, besideIndex + 1).filter((one) => one.kind === 'date').length - 1];
		if (date && token.weekday !== oaWeekdayOf(date)) return { message: `${date} is a ${WEEKDAY_LONG_LIST[oaWeekdayOf(date)]}, not a ${WEEKDAY_LONG_LIST[token.weekday]}` };
	}
	const weekdayToken = dateList.length ? null : listOf('weekday')[0] ?? null;
	if (!dateList.length && listOf('weekday').length > 1) return { message: 'a range of days of the week is not a time' };

	// a part: its unit, known, else where it stands (after a day: of a day; after a month: of a month)
	let periodUnit = null;
	if (periodToken) {
		periodUnit = unitOfPeriod(periodToken) ?? (dateList.length || weekdayToken ? 'day' : monthToken ? 'month' : yearToken ? 'year' : base?.granularity === 'month' || base?.granularity === 'year' ? base.granularity : 'day');
		const periodWord = periodToken.name ?? periodToken.word;
		if (clockList.length) return { message: `a time of day and a part of a day (${periodWord}) are both typed` };
		if (periodUnit === 'day' && (monthToken || yearToken)) return { message: `${periodWord} is a part of a day: typed with a day` };
		if (periodUnit === 'month' && (dateList.length || yearToken && !monthToken)) return { message: `${periodWord} is a part of a month: typed with a month (2026-11 ${periodWord})` };
		if (periodUnit === 'year' && (dateList.length || monthToken)) return { message: `${periodWord} is a part of a year: typed with a year (2026 ${periodWord})` };
	}
	if ((clockList.length || dayLengthToken) && (monthToken || yearToken)) return { message: 'a month or a year is typed with a time of day or a length in days' };
	if (clockList.length && (dateList.length === 2 || dayLengthToken || markerOf('week'))) return { message: 'several days and a time of day: type one day with its times' };
	const period = periodToken ? (periodToken.name ?? periodToken.word) : '';

	// a year, a month, or a part of one
	if (periodUnit === 'year' || (!periodToken && yearToken && !monthToken && !dateList.length)) {
		return { span: oaTimeSpanCreate({ granularity: 'year', date: `${yearToken?.year ?? (base?.date || todayKept).slice(0, 4)}-01-01`, period: periodUnit === 'year' ? period : '', zone }) };
	}
	if (periodUnit === 'month' || (!periodToken && monthToken && !dateList.length)) {
		const monthDate = monthToken ? `${monthToken.year ?? yearToken?.year ?? yearKept}-${pad(monthToken.month)}-01` : `${(base?.date || todayKept).slice(0, 7)}-01`;
		if (!oaDateIsValid(monthDate)) return { message: `${monthDate.slice(0, 7)} is not a month` };
		return { span: oaTimeSpanCreate({ granularity: 'month', date: monthDate, period: periodUnit === 'month' ? period : '', zone }) };
	}

	// the day
	let date = dateList[0] ?? '';
	let weekday = null;
	if (!date) {
		if (weekdayToken) {
			if (base?.date) date = oaDateAdd(oaWeekStartOf(base.date, weekStart), (weekdayToken.weekday - oaWeekdayOf(oaWeekStartOf(base.date, weekStart)) + 7) % 7);
			else weekday = weekdayToken.weekday;
		} else if (base?.date) date = base.granularity === 'month' || base.granularity === 'year' ? todayKept : base.date;
		else if (Number.isInteger(base?.weekday)) weekday = base.weekday;
		else date = todayKept;
	}

	// several days
	if (dateList.length === 2 || dayLengthToken || markerOf('week')) {
		if (!date) return { message: 'several days are typed with a day' };
		let dateEnd = dateList[1] ?? '';
		if (dayLengthToken) {
			if (dayLengthToken.day < 1) return { message: 'a length in days is a day or more' };
			dateEnd = oaDateAdd(date, dayLengthToken.day - 1);
		}
		if (markerOf('week')) {
			date = oaWeekStartOf(date, weekStart);
			dateEnd = oaDateAdd(date, 6);
		}
		return { span: oaTimeSpanCreate({ granularity: 'day', date, dateEnd, period: periodUnit === 'day' ? period : '', zone }) };
	}
	// a part of a day, or the whole day
	if (periodUnit === 'day') return { span: oaTimeSpanCreate({ granularity: 'day', date, weekday, period, zone }) };
	if (markerOf('allDay')) return { span: oaTimeSpanCreate({ granularity: 'day', date, weekday, zone }) };

	// a time of day
	let start = null;
	let end = null;
	if (clockList.length) {
		const [first, second] = clockList;
		// an am / pm written once, after the end, is the start's too, unless the start would then
		// come after the end (11:30-1 pm: 11:30 am)
		let meridiemFirst = first.meridiem;
		if (second && !meridiemFirst && second.meridiem) {
			const endMinute = clockOfToken(second.text, second.meridiem);
			const same = clockOfToken(first.text, second.meridiem);
			meridiemFirst = same !== null && endMinute !== null && same <= endMinute ? second.meridiem : second.meridiem === 'pm' ? 'am' : 'pm';
		}
		start = clockOfToken(first.text, meridiemFirst);
		if (start === null) return { message: `"${first.text}${first.meridiem ? ` ${first.meridiem}` : ''}" is not a time of day` };
		if (start === DAY_MINUTE) return { message: '24:00 is not a start' };
		if (second) {
			end = clockOfToken(second.text, second.meridiem);
			if (end === null) return { message: `"${second.text}${second.meridiem ? ` ${second.meridiem}` : ''}" is not a time of day` };
			if (end <= start) end += DAY_MINUTE;
		} else if (lengthToken) {
			if (lengthToken.minute <= 0 || lengthToken.minute >= DAY_MINUTE) return { message: 'a length is more than nothing and less than a day' };
			end = start + lengthToken.minute;
		} else if (Number.isFinite(base?.start) && Number.isFinite(base?.end)) {
			// a start typed alone keeps the length it had: the time is moved
			end = start + (base.end - base.start);
		}
		return { span: oaTimeSpanCreate({ date, weekday, start, end, zone }) };
	}
	if (lengthToken) return { message: 'a length needs a start before it' };
	// a day typed alone keeps what of a day it had: its time of day, its part
	if (base?.granularity === 'minute' || Number.isFinite(base?.start)) return { span: oaTimeSpanCreate({ date, weekday, start: base.start, end: base.end, zone }) };
	if (base?.granularity === 'day' && base.period && !base.dateEnd) return { span: oaTimeSpanCreate({ granularity: 'day', date, weekday, period: base.period, zone }) };
	return { span: oaTimeSpanCreate({ granularity: 'day', date, weekday, zone }) };
}

// the stored text of a value read: what was typed, read and written in the stored form; a text read
// as nothing is kept as typed (the card shows it as written, and says why)
export function oaTimeTextNormalize(text, options = {}) {
	const { span, message } = oaTimeParse(text, options);
	if (message) return String(text ?? '').trim();
	return span ? oaTimeTextOf(span) : '';
}

// the span of a stored text (or of anything the parser reads), null for none or what is not a time
export function oaTimeSpanOf(text, options = {}) {
	const { span } = oaTimeParse(text, options);
	return span ?? null;
}
