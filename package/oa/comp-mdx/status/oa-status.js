import { timeTextDisplay, timeTextGet } from '../../../../main/frontend/src/lib/time-text.js';
import { oaDateIsValid, oaTimeParse, oaZoneLocal } from '../time/oa-time.js';

// The status of a card of the package (doc/event.md#its-status): what is kept is its **history**, never
// the status alone. Every change is one entry, when it was made (a moment with its zone) and, when
// known, who made it; the status a card shows is the one of its latest change. Pure: no React.
//
//   statusHistory:                       in the data of a card, in the order written
//     - status: planned
//       time: 20261120_09000000+09       the moment of the change, in the project's form (time-format.md:
//                                        local time to 10 ms, its zone in whole hours)
//     - status: confirmed
//       time: 20261125_18300000+09
//       by: someone                      optional: who changed it (nobody is named yet)
//
// A change is made now (oaStatusChangeAdd), and the history is edited like any data: a change's status or
// its moment set again, a change taken away. The latest change is the one at the latest moment, the one
// written last among changes at the same moment, whatever their order in the data.

// the statuses of an event (an event of oa and its special types: a Zoom reservation, a class of a
// course); tone: the color of its mark
export const OA_EVENT_STATUS_LIST = Object.freeze([
	{ id: 'planned', label: 'Planned', tone: 'gray' },
	{ id: 'tentative', label: 'Tentative', tone: 'amber' },
	{ id: 'confirmed', label: 'Confirmed', tone: 'blue' },
	{ id: 'postponed', label: 'Postponed', tone: 'amber' },
	{ id: 'cancelled', label: 'Cancelled', tone: 'red' },
	{ id: 'done', label: 'Done', tone: 'green' },
]);

// ---------- moments ----------

const MOMENT_REGEX = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(\d{2})?([+-]\d{2})$/;

// a moment of the project's form: { date, minute, second, zone (minutes), ms (since the epoch) }, or null
export function oaMomentParse(text) {
	const match = MOMENT_REGEX.exec(String(text ?? '').trim());
	if (!match) return null;
	const [, year, month, day, hour, minute, second, hundredth = '00', zoneHour] = match;
	const date = `${year}-${month}-${day}`;
	if (!oaDateIsValid(date) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
	const zone = Number(zoneHour) * 60;
	const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(hundredth) * 10) - zone * 60000;
	return { date, minute: Number(hour) * 60 + Number(minute), second: Number(second), zone, ms };
}

// now, in the project's form, in the zone of the browser
export function oaMomentNow(now = new Date()) {
	return timeTextGet(now);
}

// a moment as a reader reads it, with its zone: 2026-11-25 18:30 +09 (a text that is no moment, as written)
export function oaMomentShown(text) {
	return oaMomentParse(text) ? timeTextDisplay(String(text).trim()) : String(text ?? '');
}

// a moment typed loosely (as a time of oa-time.js: 1125 1830, 2026-11-25 18:30 +09, what is shown), what
// is not typed kept from the moment it had: the moment in the project's form, or { message }
export function oaMomentOfTyped(text, base = '') {
	const before = oaMomentParse(base);
	const span = before ? { date: before.date, weekday: null, start: before.minute, end: null, zone: before.zone } : null;
	// a moment has one time of day: two groups of digits are a day and a time (1126 0900), not a start and an end
	const typed = String(text ?? '').replace(/^\s*(\d{2})(\d{2})\s+(\d{1,4}(?:[:：]\d{2})?)(?=\s|$)/, '$1/$2 $3');
	const { span: read, message } = oaTimeParse(typed, { base: span, zoneDefault: before?.zone ?? oaZoneLocal() });
	if (message) return { message };
	if (!read?.date || !Number.isFinite(read.start)) return { message: 'a change is at a day and a time of day' };
	if (read.zone % 60 !== 0) return { message: 'the zone of a moment is in whole hours (+09, -05)' };
	const pad = (value) => String(value).padStart(2, '0');
	const zoneHour = read.zone / 60;
	const second = before && before.minute === read.start && before.date === read.date ? pad(before.second) : '00';
	return { moment: `${read.date.replaceAll('-', '')}_${pad(Math.floor(read.start / 60))}${pad(read.start % 60)}${second}00${zoneHour < 0 ? '-' : '+'}${pad(Math.abs(zoneHour))}` };
}

// ---------- the history ----------

// the history as the data holds it: [{ status, time, by? }], what is no change left out
export function oaStatusHistoryRead(value) {
	if (!Array.isArray(value)) return [];
	return value
		.filter((entry) => entry && typeof entry === 'object' && String(entry.status ?? '').trim())
		.map((entry) => ({
			status: String(entry.status).trim(),
			time: entry.time === undefined || entry.time === null ? '' : String(entry.time),
			...(entry.by ? { by: String(entry.by) } : {}),
		}));
}

// the changes from the oldest to the latest, each with its place in the data (index)
export function oaStatusHistoryOrdered(history) {
	return history
		.map((entry, index) => ({ ...entry, index, ms: oaMomentParse(entry.time)?.ms ?? Number.NEGATIVE_INFINITY }))
		.sort((a, b) => a.ms - b.ms || a.index - b.index);
}

// the latest change, or null when there is none
export function oaStatusLatest(history) {
	const ordered = oaStatusHistoryOrdered(history);
	return ordered.length ? ordered[ordered.length - 1] : null;
}

// what a status is among the statuses of a kind: { id, label, tone }; one the kind does not know, as written
export function oaStatusOf(statusId, statusList = OA_EVENT_STATUS_LIST) {
	if (!statusId) return null;
	return statusList.find((one) => one.id === statusId) ?? { id: statusId, label: statusId, tone: 'gray' };
}

// the history with a change made now (or at time), by nobody named unless by is given
export function oaStatusChangeAdd(history, status, { time = oaMomentNow(), by = '' } = {}) {
	return [...history, { status, time, ...(by ? { by } : {}) }];
}

// the history with one change set again (its status, its moment), by its place in the data
export function oaStatusChangeSet(history, index, patch) {
	return history.map((entry, one) => (one === index ? { ...entry, ...patch } : entry));
}

// the history without one change
export function oaStatusChangeRemove(history, index) {
	return history.filter((_, one) => one !== index);
}

// what a card at a status tells whoever reads it (expose.statusItem, doc/event.md#its-status):
//   statusListGet()        the statuses it may be at
//   historyGet(data)       its changes, as the data holds them
//   statusGet(data)        the status of its latest change ({ id, label, tone }), or null
export function oaStatusItemOf({ read, fieldId = 'statusHistory', statusList = OA_EVENT_STATUS_LIST }) {
	return Object.freeze({
		statusListGet: () => statusList,
		historyGet: (data) => read(data)[fieldId] ?? [],
		statusGet: (data) => oaStatusOf(oaStatusLatest(read(data)[fieldId] ?? [])?.status, statusList),
	});
}
