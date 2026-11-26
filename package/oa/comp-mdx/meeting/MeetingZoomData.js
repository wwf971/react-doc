import { yamlParse, yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';

// The data of the two Zoom cards (doc/meeting-zoom.md): one mapping of yaml each, every field a
// text. What a card draws and its edit mode types are read and written here, so both directions
// stay in one place.
//
// A reservation: a meeting at a time (MeetingZoomReservation.jsx)
//   title        what the meeting is                   Sprint planning
//   time         when, with its zone                   2026-11-25 10:00 +09
//   duration     how long, in minutes; optional        60
//   url          the link joining it; optional         https://zoom.us/j/81234567890?pwd=…
//   description  optional; a cell text (doc_page_impl_edit_cell.md): links and views of objects
//
// An instance: a meeting to join at any time, its number and passcode (MeetingZoomInstance.jsx)
//   title        whose or what it is                   Team room
//   meetingId    the number typed in the app           812 3456 7890
//   passcode     the code typed after it
//   url          the link joining it; optional, else the link of the number
//   description  as above

const DESCRIPTION_FIELD = { id: 'description', label: 'Description', placeholder: 'what it is about', isMultiline: true, isCellText: true };

export const MEETING_ZOOM_RESERVATION = Object.freeze({
	name: 'reservation',
	label: 'Zoom meeting reservation',
	fieldList: [
		{ id: 'title', label: 'Title', placeholder: 'what the meeting is' },
		{ id: 'time', label: 'Time', placeholder: 'e.g. 2026-11-25 10:00 +09' },
		{ id: 'duration', label: 'Length', placeholder: 'minutes, e.g. 60' },
		{ id: 'url', label: 'Link', placeholder: 'e.g. https://zoom.us/j/81234567890' },
		DESCRIPTION_FIELD,
	],
	sourceRaw: 'title: Zoom meeting\ntime: ',
});

export const MEETING_ZOOM_INSTANCE = Object.freeze({
	name: 'instance',
	label: 'Zoom meeting instance',
	fieldList: [
		{ id: 'title', label: 'Title', placeholder: 'whose or what it is' },
		{ id: 'meetingId', label: 'Meeting ID', placeholder: 'e.g. 812 3456 7890' },
		{ id: 'passcode', label: 'Passcode', placeholder: 'the code typed after the number' },
		{ id: 'url', label: 'Link', placeholder: 'optional: the invitation link' },
		DESCRIPTION_FIELD,
	],
	sourceRaw: 'title: Zoom meeting\nmeetingId: \npasscode: ',
});

// the meeting a block holds: its yaml (data.raw), or fields given as props; every field a text
export function meetingRead(kind, data = {}) {
	let value = {};
	if (typeof data.raw === 'string' && data.raw.trim()) {
		const parsed = yamlParse(data.raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed;
	}
	const meeting = {};
	for (const { id } of kind.fieldList) {
		const one = value[id] ?? data[id];
		meeting[id] = one === undefined || one === null ? '' : String(one);
	}
	return meeting;
}

// the yaml of a meeting: the fields written, in their order; an empty one left out. isTrimmed false:
// a value written as it is (a field being typed elsewhere keeps the space typed last)
export function meetingRawBuild(kind, meeting, { isTrimmed = true } = {}) {
	const value = {};
	for (const { id } of kind.fieldList) {
		const written = String(meeting[id] ?? '');
		const text = written.trim();
		if (text) value[id] = id === 'duration' && /^\d+$/.test(text) ? Number(text) : isTrimmed ? text : written;
	}
	return Object.keys(value).length ? yamlStringify(value) : '';
}

// the fields of a kind as a component offers them to whoever edits its data value by value without
// drawing it (expose.dataFields, main/doc_page_impl_mdx_comp.md#what-a-component-exposes: the edit card
// of a card of a card diagram holding it)
//   fieldList                  [{ id, label, placeholder, isMultiline? }]
//   valueListGet(data)         { id: text }: what each holds, as the card reads it
//   rawWithValue(data, id, text)   the yaml with one value changed, written as typed
export function meetingDataFieldsOf(kind) {
	return {
		fieldList: kind.fieldList.map(({ id, label, placeholder, isMultiline }) => ({ id, label, placeholder, ...(isMultiline ? { isMultiline } : {}) })),
		valueListGet: (data) => meetingRead(kind, data),
		rawWithValue: (data, id, text) => meetingRawBuild(kind, { ...meetingRead(kind, data), [id]: String(text ?? '') }, { isTrimmed: false }),
	};
}

// a number grouped as the app shows it (3-4-4 for eleven digits, 3-3-4 for ten, 3-3-3 for nine);
// anything else as written
export function meetingIdFormat(id) {
	const digit = String(id ?? '').replace(/\D/g, '');
	if (digit.length === 11) return `${digit.slice(0, 3)} ${digit.slice(3, 7)} ${digit.slice(7)}`;
	if (digit.length === 10 || digit.length === 9) return `${digit.slice(0, 3)} ${digit.slice(3, 6)} ${digit.slice(6)}`;
	return String(id ?? '').trim();
}

// the link joining a meeting: the one written, else for an instance the link of its number
export function meetingJoinUrl(meeting) {
	const url = String(meeting.url ?? '').trim();
	if (/^https?:\/\//.test(url)) return url;
	const digit = String(meeting.meetingId ?? '').replace(/\D/g, '');
	return digit.length >= 9 && digit.length <= 11 ? `https://zoom.us/j/${digit}` : '';
}

const WEEKDAY_LIST = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// the time of a meeting as written: "2026-11-25 10:00 +09" (an ISO text with a zone too); a text
// that is no time answers null
export function meetingTimeParse(text) {
	const match = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?\s*(Z|[+-]\d{2}(?::?\d{2})?)?\s*$/.exec(String(text ?? ''));
	if (!match) return null;
	const [, year, month, day, hour, minute, zoneWritten] = match;
	const weekday = WEEKDAY_LIST[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()];
	// +09, +0900 and +09:00 are +09; a zone with minutes keeps them (+05:30)
	const [, zoneHour = '+00', zoneMinute = '00'] = /^([+-]\d{2}):?(\d{2})?$/.exec(zoneWritten ?? '') ?? [];
	const zone = !zoneWritten ? '' : zoneMinute === '00' ? zoneHour : `${zoneHour}:${zoneMinute}`;
	return { date: `${year}-${month}-${day}`, clock: `${hour}:${minute}`, weekday, zone };
}

// when, as the card says it: its day, its time with the zone written, how long. A time written
// without a zone is shown as written: the card cannot know the zone
export function meetingWhenPartList(meeting) {
	const time = meetingTimeParse(meeting.time);
	const timeText = time ? [time.weekday, time.date, time.clock, time.zone].filter(Boolean).join(' ') : String(meeting.time ?? '').trim();
	const minute = String(meeting.duration ?? '').trim();
	const durationText = minute ? (/^\d+$/.test(minute) ? `${minute} min` : minute) : '';
	return { timeText, durationText };
}

// a value as the card keeps it, so what is typed is what is read: a time in the form the card shows
// ("2026-11-25 10:00 +09"), a meeting number grouped; anything else as typed
export function meetingFieldNormalize(id, text) {
	const value = String(text ?? '').trim();
	if (id === 'time') {
		const time = meetingTimeParse(value);
		return time ? [time.date, time.clock, time.zone].filter(Boolean).join(' ') : value;
	}
	if (id === 'meetingId') return meetingIdFormat(value);
	return id === 'description' ? String(text ?? '').replace(/\s+$/, '') : value;
}

// the source of a new block (expose.sourceDefaultCreate): the fields to fill, the title written
export function meetingSourceDefaultCreate(kind) {
	return () => ({ lang: 'yaml', raw: kind.sourceRaw });
}
