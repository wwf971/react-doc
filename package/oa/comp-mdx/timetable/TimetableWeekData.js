import { yamlParse, yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';
import {
	OA_TIME_PERIODS_DEFAULT, OA_WEEKDAY_LIST, oaDateAdd, oaDateDiff, oaDateIsValid, oaTimeFormat, oaTimeParse, oaTimeRangeOf, oaTimeSpanCreate, oaTimeSpanInZone,
	oaWeekStartOf, oaWeekdayOf, oaZoneLocal, oaZoneParse, oaZoneText,
} from '../time/oa-time.js';
import { oaPreferenceGet, oaTimePeriodsOf } from '../time/oa-config.js';

// The data of a weekly timetable (doc/timetable-week.md): one mapping of yaml.
//   title       optional                                   Week of the team
//   week        what dates it is bound to:
//                 2026-11-23   bound: the week starting that day (7 days)
//                 every        never bound: one week of every week (planning, a log of what repeats)
//                 (absent)     not bound yet: the first card at a day binds it, to the week of that day
//   zone        the zone it is drawn in (+09); absent: the zone of its first entry, else the browser's
//   hours       the hours shown at least (08:00~20:00, the default); widened to show every entry
//   entryList   the blocks it holds, as a block of a document holds one: [{ comp, lang?, raw, props? }].
//               Each is a component at a time (expose.timeItem, doc/time.md#a-card-at-a-time): its own
//               data says when it is; the timetable never writes a time of its own beside it
//
// A held block is placed by its time (doc/time.md#granularity), at a precision of five minutes: a time of
// day in its box (converted to the zone of the table); a part of a day (evening) in a box over the range it
// refers to, drawn as not exact; whole days in the row of whole days under the heads; a month or a year
// has no place in a week. Its day: the day of its span, or, for a weekly time (Mon 10:00~10:45), its day
// of the week. What the
// timetable takes, lets go and holds is its exposure hold (timetableHold, below): a card of a card
// diagram dropped on it is taken, an entry dragged out of it is let go (card-diagram-impl.md#a-node-holding-others).

export const TIMETABLE_WEEK_EVERY = 'every';
export const TIMETABLE_HOURS_DEFAULT = Object.freeze({ start: 8 * 60, end: 20 * 60 });
export const TIMETABLE_STEP_MINUTE = 5;

// the table a block holds: { title, week: { mode: bound | open | every, start }, zone, zoneText,
// hours: { start, end } | null, entryList: [block], message }. message: what could not be read (kept
// as written, the rest drawn)
export function timetableRead(data = {}) {
	let value = {};
	let message = '';
	if (typeof data.raw === 'string' && data.raw.trim()) {
		try {
			const parsed = yamlParse(data.raw);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed;
			else message = 'the data of a timetable is a mapping';
		} catch (error) {
			message = `the data cannot be read: ${error?.message ?? error}`;
		}
	}
	const weekWritten = value.week === undefined || value.week === null ? '' : String(value.week).trim();
	let week = { mode: 'open', start: '' };
	if (weekWritten === TIMETABLE_WEEK_EVERY) week = { mode: 'every', start: '' };
	else if (oaDateIsValid(weekWritten)) week = { mode: 'bound', start: weekWritten };
	else if (weekWritten) message ||= `week: "${weekWritten}" is neither a day nor "every"`;
	// +09 unquoted is the number 9 to yaml: a number is whole hours
	const zoneWritten = value.zone === undefined || value.zone === null ? null
		: typeof value.zone === 'number' ? (Number.isFinite(value.zone) && Math.abs(value.zone) <= 14 ? Math.round(value.zone * 60) : null)
			: oaZoneParse(String(value.zone));
	if (value.zone !== undefined && value.zone !== null && zoneWritten === null) message ||= `zone: "${value.zone}" is not a zone`;
	const hoursSpan = value.hours ? oaTimeParse(`mon ${value.hours}`, { zoneDefault: 0 }).span : null;
	const hours = hoursSpan && Number.isFinite(hoursSpan.end) ? { start: hoursSpan.start, end: Math.min(hoursSpan.end, 24 * 60) } : null;
	const entryList = Array.isArray(value.entryList)
		? value.entryList.filter((entry) => entry && typeof entry === 'object' && typeof entry.comp === 'string' && entry.comp).map((entry) => ({
			comp: entry.comp, lang: entry.lang ? String(entry.lang) : 'yaml', raw: String(entry.raw ?? ''), ...(entry.props && typeof entry.props === 'object' ? { props: { ...entry.props } } : {}),
		}))
		: [];
	return {
		title: value.title === undefined || value.title === null ? '' : String(value.title),
		week,
		zone: zoneWritten,
		hours,
		hoursWritten: value.hours === undefined || value.hours === null ? '' : String(value.hours),
		entryList,
		message,
	};
}

// the yaml of a table: what is written, in its order
export function timetableRawBuild(table) {
	const value = {};
	if (table.title?.trim()) value.title = table.title.trim();
	if (table.week.mode === 'bound' && table.week.start) value.week = table.week.start;
	else if (table.week.mode === 'every') value.week = TIMETABLE_WEEK_EVERY;
	if (Number.isFinite(table.zone)) value.zone = oaZoneText(table.zone);
	if (table.hoursWritten) value.hours = table.hoursWritten;
	value.entryList = table.entryList.map((entry) => ({
		comp: entry.comp, ...(entry.lang && entry.lang !== 'yaml' ? { lang: entry.lang } : {}), raw: entry.raw, ...(entry.props && Object.keys(entry.props).length ? { props: entry.props } : {}),
	}));
	return yamlStringify(value);
}

// the data of a held block as its component reads it ({ raw, lang, ...props })
export function timetableEntryDataOf(entry) {
	return { raw: entry.raw ?? '', lang: entry.lang ?? 'yaml', ...(entry.props ?? {}) };
}

// the zone the table is drawn in: written, else its first entry's, else the browser's
export function timetableZoneOf(table, spanOf) {
	if (Number.isFinite(table.zone)) return table.zone;
	for (const entry of table.entryList) {
		const span = spanOf(entry);
		if (span) return span.zone;
	}
	return oaZoneLocal();
}

// the first day of the columns, 0 (Sunday) to 6: the day the bound week starts on, else the preference
export function timetableWeekStartDayOf(table, weekStart = 'monday') {
	if (table.week.mode === 'bound') return oaWeekdayOf(table.week.start);
	return Math.max(0, OA_WEEKDAY_LIST.indexOf(weekStart));
}

// the seven columns: [{ index, weekday, date }] (date '' when not bound)
export function timetableDayListOf(table, weekStart = 'monday') {
	const startDay = timetableWeekStartDayOf(table, weekStart);
	return Array.from({ length: 7 }, (_, index) => ({
		index,
		weekday: (startDay + index) % 7,
		date: table.week.mode === 'bound' ? oaDateAdd(table.week.start, index) : '',
	}));
}

// where a span stands in the table, or { reason } when it has none (a month or a year, a day out of the
// bound week):
//   { kind: 'box', dayIndex, start, end, isEndWritten, isApproximate, period }   in the hours: a time of
//        day, or a part of a day over the range it refers to (isApproximate; its end at the end of the day)
//   { kind: 'allDay', dayIndex, dayIndexEnd }   in the row of whole days: a day, several days, a day of a
//        part the page does not know (the whole day: conservative)
export function timetablePlaceOf(table, span, { zone, weekStart = 'monday', periods = OA_TIME_PERIODS_DEFAULT } = {}) {
	if (!span) return { reason: 'it says no time' };
	if (span.granularity === 'month' || span.granularity === 'year') {
		return { reason: `its time is ${span.granularity === 'month' ? 'a month' : 'a year'}${span.period ? ` (${span.period})` : ''}: a week holds days and times of day` };
	}
	const startDay = timetableWeekStartDayOf(table, weekStart);
	const weekText = () => `the week of ${table.week.start.slice(5)} – ${oaDateAdd(table.week.start, 6).slice(5)}`;
	// the column of a day: of the bound week, else of its day of the week
	const dayIndexOf = (date, weekday) => {
		if (table.week.mode === 'bound' && date) return oaDateDiff(table.week.start, date);
		return ((date ? oaWeekdayOf(date) : weekday) - startDay + 7) % 7;
	};
	const isOutside = (index) => index < 0 || index > 6;
	if (span.granularity === 'minute') {
		const shown = oaTimeSpanInZone(span, zone);
		const dayIndex = dayIndexOf(shown.date, shown.weekday);
		if (isOutside(dayIndex)) return { reason: `its day, ${shown.date}, is not in ${weekText()}` };
		const end = Number.isFinite(shown.end) ? shown.end : shown.start + 30;
		return { kind: 'box', dayIndex, start: shown.start, end: Math.max(end, shown.start + TIMETABLE_STEP_MINUTE), isEndWritten: Number.isFinite(shown.end), isApproximate: false };
	}
	const dayIndex = dayIndexOf(span.date, span.weekday);
	const range = oaTimeRangeOf(span, periods);
	if (span.period && range?.period) {
		if (isOutside(dayIndex)) return { reason: `its day, ${span.date}, is not in ${weekText()}` };
		return { kind: 'box', dayIndex, start: range.period.from, end: Math.min(range.period.to, 24 * 60), isEndWritten: true, isApproximate: true, period: span.period };
	}
	const dayIndexEnd = span.dateEnd ? (table.week.mode === 'bound' ? dayIndexOf(span.dateEnd) : Math.min(6, dayIndex + oaDateDiff(span.date, span.dateEnd))) : dayIndex;
	if (isOutside(dayIndex) || isOutside(dayIndexEnd)) {
		return { reason: span.dateEnd ? `its days, ${span.date.slice(5)} – ${span.dateEnd.slice(5)}, are not all in ${weekText()}` : `its day, ${span.date}, is not in ${weekText()}` };
	}
	return { kind: 'allDay', dayIndex, dayIndexEnd, isPeriodUnknown: Boolean(span.period) };
}

// the span of a place in the table (a day column and minutes), in the zone of the table: what an
// entry moved there is at. A table bound to a week gives the day; one never bound, the day of the
// week (a held block at a day keeps a day: the same day of the week in the week it was in)
export function timetableSpanOfPlace(table, { dayIndex, start, end }, { zone, weekStart = 'monday', spanBefore = null }) {
	const day = timetableDayListOf(table, weekStart)[dayIndex];
	if (day.date) return oaTimeSpanCreate({ date: day.date, start, end, zone });
	if (spanBefore?.date) {
		// the same week as before, another day of it
		const before = oaTimeSpanInZone(spanBefore, zone);
		const weekStartDate = oaWeekStartOf(before.date, timetableWeekStartDayOf(table, weekStart));
		return oaTimeSpanCreate({ date: oaDateAdd(weekStartDate, dayIndex), start, end, zone });
	}
	return oaTimeSpanCreate({ weekday: day.weekday, start, end, zone });
}

// the hours drawn: those written (or 8 to 20), widened to whole hours so every place shows
export function timetableHoursOf(table, placeList) {
	let { start, end } = table.hours ?? TIMETABLE_HOURS_DEFAULT;
	for (const place of placeList) {
		if (place.kind !== 'box' || !Number.isFinite(place.start)) continue;
		start = Math.min(start, Math.floor(place.start / 60) * 60);
		end = Math.max(end, Math.ceil(Math.min(place.end, 24 * 60) / 60) * 60);
	}
	return { start: Math.max(0, start), end: Math.min(24 * 60, Math.max(end, start + 60)) };
}

// the lanes of a day: entries at the same time side by side. placeList [{ key, dayIndex, start, end }]
// -> Map key -> { lane, laneCount }
export function timetableLaneMapOf(placeList) {
	const result = new Map();
	for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
		const dayList = placeList.filter((place) => place.dayIndex === dayIndex).sort((a, b) => a.start - b.start || b.end - a.end);
		let cluster = [];
		let clusterEnd = -1;
		const clusterClose = () => {
			const laneEndList = [];
			const laneOf = new Map();
			for (const place of cluster) {
				let lane = laneEndList.findIndex((laneEnd) => laneEnd <= place.start);
				if (lane < 0) lane = laneEndList.push(0) - 1;
				laneEndList[lane] = place.end;
				laneOf.set(place.key, lane);
			}
			for (const place of cluster) result.set(place.key, { lane: laneOf.get(place.key), laneCount: laneEndList.length });
			cluster = [];
		};
		for (const place of dayList) {
			if (cluster.length && place.start >= clusterEnd) clusterClose();
			cluster.push(place);
			clusterEnd = Math.max(clusterEnd, place.end);
		}
		if (cluster.length) clusterClose();
	}
	return result;
}

// the rows of the whole days: entries over the same days one under another. placeList
// [{ key, dayIndex, dayIndexEnd }] -> Map key -> row (0 the first)
export function timetableAllDayRowMapOf(placeList) {
	const result = new Map();
	const rowEndList = [];
	for (const place of [...placeList].sort((a, b) => a.dayIndex - b.dayIndex || b.dayIndexEnd - a.dayIndexEnd)) {
		let row = rowEndList.findIndex((rowEnd) => rowEnd < place.dayIndex);
		if (row < 0) row = rowEndList.push(-1) - 1;
		rowEndList[row] = place.dayIndexEnd;
		result.set(place.key, row);
	}
	return result;
}

// what the head of the table says of its dates
export function timetableWeekText(table, { zone, weekStart = 'monday' } = {}) {
	const zoneText = oaZoneText(zone);
	if (table.week.mode === 'bound') {
		const end = oaDateAdd(table.week.start, 6);
		return `Week of ${oaTimeFormat(oaTimeSpanCreate({ date: table.week.start, zone }), { layout: 'full' }).replace(` ${zoneText}`, '')} – ${oaTimeFormat(oaTimeSpanCreate({ date: end, zone }), { layout: 'short' }).replace(` ${zoneText}`, '')} ${zoneText}`;
	}
	if (table.week.mode === 'every') return `Every week, from ${OA_WEEKDAY_LIST[timetableWeekStartDayOf(table, weekStart)].replace(/^./, (letter) => letter.toUpperCase())} ${zoneText}`;
	return `No week yet: the first card at a day binds it ${zoneText}`;
}

// ---------- what it holds (expose.hold, main/doc_page_impl_mdx_comp.md#a-component-holding-others) ----------

// the time item of a block (expose.timeItem of its component) and its span, or why it has none
function heldSpanOf(block, context) {
	const definition = context?.compDefinitionGet?.(block.comp) ?? null;
	const timeItem = definition?.expose?.timeItem;
	const label = definition?.expose?.meta?.label ?? block.comp;
	if (!definition) return { reason: `no component ${block.comp} on this page` };
	if (!timeItem) return { reason: `${label} is not at a time` };
	const span = timeItem.spanGet(timetableEntryDataOf(block));
	if (!span) return { reason: `this ${label.toLowerCase()} says no time yet` };
	return { span, timeItem };
}

// the preferences of the package the table is drawn with (the first day of a week, the parts of a day)
function preferenceOf(context) {
	const preference = oaPreferenceGet({ packageConfig: context?.packageConfigGet?.('oa') ?? {} });
	return { weekStart: OA_WEEKDAY_LIST.includes(preference.TimeWeekStart) ? preference.TimeWeekStart : 'monday', periods: oaTimePeriodsOf(preference) };
}

// why a block is not taken ('' it is): a component at a time, with a time of day, on a day of the
// bound week (any day while not bound yet, or never bound)
export function timetableTakeReasonGet(data, block, context) {
	const table = timetableRead(data);
	if (table.message) return `the timetable cannot be read: ${table.message}`;
	const { span, reason } = heldSpanOf(block, context);
	if (reason) return reason;
	const { weekStart, periods } = preferenceOf(context);
	const zone = timetableZoneOf(table, (entry) => heldSpanOf(entry, context).span ?? null);
	const place = timetablePlaceOf(table, span, { zone: Number.isFinite(table.zone) || table.entryList.length ? zone : span.zone, weekStart, periods });
	return place.reason ?? '';
}

export const timetableHold = Object.freeze({
	heldListGet: (data) => timetableRead(data).entryList.map((block, index) => ({ key: String(index), block })),
	takeCheck: timetableTakeReasonGet,
	// the block added; a table not bound yet is bound to the week of its day (the first day of the
	// week of the preferences), and takes its zone when it has none
	take: (data, block, context) => {
		const table = timetableRead(data);
		const { span } = heldSpanOf(block, context);
		const { weekStart } = preferenceOf(context);
		const next = { ...table, entryList: [...table.entryList, { ...block, lang: block.lang ?? 'yaml', raw: String(block.raw ?? '') }] };
		if (!Number.isFinite(table.zone) && !table.entryList.length && span) next.zone = span.zone;
		if (table.week.mode === 'open' && span?.date) {
			const zone = Number.isFinite(next.zone) ? next.zone : timetableZoneOf(table, (entry) => heldSpanOf(entry, context).span ?? null);
			next.week = { mode: 'bound', start: oaWeekStartOf(oaTimeSpanInZone(span, zone).date, weekStart) };
		}
		return { raw: timetableRawBuild(next) };
	},
	letGo: (data, key) => {
		const table = timetableRead(data);
		const index = Number(key);
		const block = table.entryList[index];
		if (!block) return null;
		return { raw: timetableRawBuild({ ...table, entryList: table.entryList.filter((_, one) => one !== index) }), block };
	},
});

// the source of a new block: a table not bound yet, holding nothing
export function timetableSourceDefaultCreate() {
	return { lang: 'yaml', raw: 'title: Week\nentryList: []\n' };
}
