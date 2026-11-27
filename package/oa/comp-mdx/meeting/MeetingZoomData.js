import { oaTimeParse, oaTimeTextOf } from '../time/oa-time.js';
import { oaEventKindCreate } from '../oa-card/oa-card-data.js';

// The two Zoom cards (doc/meeting-zoom.md): kinds of the cards of the package (oa-card-data.js reads
// and writes them), and what only a Zoom meeting has: its number grouped as the app shows it, the
// link of a number.
//
// A reservation: a meeting at a time, an event of a special type (doc/event.md): the fields of an event,
// its place the link joining it (MeetingZoomReservation.jsx)
//   title        what the meeting is                   Sprint planning
//   time         when, a span with its zone            2026-11-25 10:00~10:45 +09
//   people       optional: who joins it                [Sato, Tanaka]
//   url          the link joining it; optional         https://zoom.us/j/81234567890?pwd=…
//   description  optional; a cell text (doc_page_impl_edit_cell.md): links and views of objects
//   statusHistory   optional: the changes of its status (doc/event.md#its-status)
//   timeFormat, timeClock   optional: how its time is written (else the package's preferences)
// An older reservation wrote its length apart (duration: 45, in minutes): it is read as the end of
// its time, and written so at the next change.
//
// An instance: a meeting joined by its number and passcode, at any time or at one (MeetingZoomInstance.jsx);
// an event of a special type too (doc/event.md), its place the number
//   title        whose or what it is                   Team room
//   time         optional: when it is held, at any granularity (doc/time.md)   2026-11-28 evening +09
//   people       optional: who joins it
//   meetingId    the number typed in the app           812 3456 7890
//   passcode     the code typed after it
//   url          the link joining it; optional, else the link of the number
//   description  as above
//   statusHistory   optional: the changes of its status (doc/event.md#its-status)

export const MEETING_ZOOM_RESERVATION = oaEventKindCreate({
	name: 'reservation',
	label: 'Zoom meeting reservation',
	fieldById: {
		title: { label: 'Title', placeholder: 'what the meeting is' },
		time: { placeholder: 'e.g. 1125 1000 1045' },
		place: null,
	},
	fieldAfterById: { people: [{ id: 'url', label: 'Link', placeholder: 'e.g. https://zoom.us/j/81234567890' }] },
	sourceRaw: 'title: Zoom meeting\ntime: ',
	// duration: an older length, in minutes, folded into the end of the time
	readMore: (parsed, card) => {
		const minute = Number(parsed.duration);
		if (!card.time || !Number.isInteger(minute) || minute <= 0) return;
		const { span } = oaTimeParse(card.time);
		if (span && Number.isFinite(span.start) && !Number.isFinite(span.end)) card.time = oaTimeTextOf({ ...span, end: span.start + minute });
	},
});

export const MEETING_ZOOM_INSTANCE = oaEventKindCreate({
	name: 'instance',
	label: 'Zoom meeting instance',
	fieldById: {
		title: { label: 'Title', placeholder: 'whose or what it is' },
		time: { placeholder: 'optional: e.g. 1128 evening' },
		place: null,
	},
	fieldAfterById: {
		people: [
			{ id: 'meetingId', label: 'Meeting ID', placeholder: 'e.g. 812 3456 7890' },
			{ id: 'passcode', label: 'Passcode', placeholder: 'the code typed after the number' },
			{ id: 'url', label: 'Link', placeholder: 'optional: the invitation link' },
		],
	},
	sourceRaw: 'title: Zoom meeting\nmeetingId: \npasscode: ',
	// a number kept grouped, so what is typed is what is read
	normalizeMore: (id, value) => (id === 'meetingId' ? meetingIdFormat(value) : value),
});

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
