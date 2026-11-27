import assert from 'node:assert/strict';
import test from 'node:test';
import { MEETING_ZOOM_INSTANCE, MEETING_ZOOM_RESERVATION, meetingIdFormat, meetingJoinUrl } from './MeetingZoomData.js';
import { oaCardDataFieldsOf, oaCardFieldNormalize, oaCardRawBuild, oaCardRead, oaCardTimeShownOf, oaTimeItemOf } from '../oa-card/oa-card-data.js';

const meetingRead = oaCardRead;
const meetingRawBuild = oaCardRawBuild;

test('a meeting is read from its yaml, every field of its kind a text, and written back in their order', () => {
	const meeting = meetingRead(MEETING_ZOOM_RESERVATION, { raw: 'url: https://zoom.us/j/81234567890\ntitle: Sync\ntime: 2026-11-25 10:00~10:30 +09\npasscode: x\n' });
	assert.equal(meeting.title, 'Sync');
	assert.equal(meeting.time, '2026-11-25 10:00~10:30 +09');
	assert.equal(meeting.description, '');
	assert.equal('passcode' in meeting, false, 'a field of the other kind is not read');
	assert.equal(meetingRawBuild(MEETING_ZOOM_RESERVATION, meeting), 'title: Sync\ntime: 2026-11-25 10:00~10:30 +09\nurl: https://zoom.us/j/81234567890\n');
	assert.equal(meetingRawBuild(MEETING_ZOOM_RESERVATION, { title: '  ' }), '');
	// fields given as props, for a block written without yaml
	assert.equal(meetingRead(MEETING_ZOOM_INSTANCE, { passcode: 'p1' }).passcode, 'p1');
	assert.equal(meetingRead(MEETING_ZOOM_INSTANCE, { raw: '- not a mapping' }).title, '');
});

test('a description keeps its lines and its tokens as typed', () => {
	const raw = meetingRawBuild(MEETING_ZOOM_INSTANCE, { title: 'Room', description: 'Agenda in [the notes](~page:root/notes.md)\nsecond line' });
	assert.equal(meetingRead(MEETING_ZOOM_INSTANCE, { raw }).description, 'Agenda in [the notes](~page:root/notes.md)\nsecond line');
});

test('a meeting number is grouped as the app shows it, and joined by its link when none is written', () => {
	assert.equal(meetingIdFormat('81234567890'), '812 3456 7890');
	assert.equal(meetingIdFormat('8123456789'), '812 345 6789');
	assert.equal(meetingIdFormat('my room'), 'my room');
	assert.equal(meetingJoinUrl({ meetingId: '812 3456 7890' }), 'https://zoom.us/j/81234567890');
	assert.equal(meetingJoinUrl({ meetingId: '812 3456 7890', url: 'https://zoom.us/j/81234567890?pwd=abc' }), 'https://zoom.us/j/81234567890?pwd=abc');
	assert.equal(meetingJoinUrl({ meetingId: '12' }), '');
});

test('a reservation is at a time: a span written in one form, an older length read as its end', () => {
	assert.equal(oaCardRead(MEETING_ZOOM_RESERVATION, { raw: 'title: Sync\ntime: 2026-11-25 10:00 +09\nduration: 45\n' }).time, '2026-11-25 10:00~10:45 +09');
	assert.equal(oaCardRawBuild(MEETING_ZOOM_RESERVATION, oaCardRead(MEETING_ZOOM_RESERVATION, { raw: 'title: Sync\ntime: 2026-11-25 10:00 +09\nduration: 45\n' })), 'title: Sync\ntime: 2026-11-25 10:00~10:45 +09\n');
	const shown = oaCardTimeShownOf({ time: '2026-11-25 10:00~10:45 +09' }, { TimeFormat: 'full', TimeClock: '24h' });
	assert.deepEqual(shown, { text: 'Wed 2026-11-25 10:00–10:45 +09', lengthText: '45 min', rangeText: '', message: '' });
	assert.equal(oaCardTimeShownOf({ time: '2026-11-25 evening +09' }, {}).rangeText, '17:00–22:00', 'a time not exact says the range it refers to');
	assert.equal(oaCardTimeShownOf({ time: '2026-11-25 10:00~10:45 +09', timeFormat: 'short', timeClock: '12h' }, {}).text, 'Wed 11-25 10:00–10:45 AM +09', 'the card\'s own format wins over the preferences');
	assert.equal(oaCardTimeShownOf({ time: 'every second Monday' }, {}).text, 'every second Monday', 'what is not a time is shown as written');
	assert.ok(oaCardTimeShownOf({ time: 'every second Monday' }, {}).message);
	assert.equal(MEETING_ZOOM_RESERVATION.fieldList.some((field) => field.id === 'duration'), false);
});

test('a value typed is kept as the card reads it, so entering the edit mode moves nothing', () => {
	assert.equal(oaCardFieldNormalize(MEETING_ZOOM_RESERVATION, 'time', '2026-11-25T10:00+09:00'), '2026-11-25 10:00 +09');
	assert.equal(oaCardFieldNormalize(MEETING_ZOOM_RESERVATION, 'time', '1000 1045', { card: { time: '2026-11-25 09:00 +09' } }), '2026-11-25 10:00~10:45 +09', 'the day kept');
	assert.equal(oaCardFieldNormalize(MEETING_ZOOM_RESERVATION, 'time', 'Wed 11-25 10:00–10:45 AM +09', { card: { time: '2026-11-25 10:00~10:45 +09' } }), '2026-11-25 10:00~10:45 +09', 'what the card shows reads back');
	assert.equal(oaCardFieldNormalize(MEETING_ZOOM_RESERVATION, 'timeFormat', 'short'), 'short');
	assert.equal(oaCardFieldNormalize(MEETING_ZOOM_RESERVATION, 'timeFormat', 'nonsense'), '');
	assert.equal(oaCardFieldNormalize(MEETING_ZOOM_INSTANCE, 'meetingId', '81234567890'), '812 3456 7890');
	assert.equal(oaCardFieldNormalize(MEETING_ZOOM_INSTANCE, 'title', '  Sync '), 'Sync');
	assert.equal(oaCardFieldNormalize(MEETING_ZOOM_INSTANCE, 'description', '  indented\nline  \n'), '  indented\nline');
});

test('the values are offered one by one, then the properties: read as the card reads them, one written as typed', () => {
	const fields = oaCardDataFieldsOf(MEETING_ZOOM_INSTANCE);
	assert.deepEqual(fields.fieldList.map(field => field.id), ['title', 'time', 'people', 'meetingId', 'passcode', 'url', 'description', 'statusHistory', 'timeFormat', 'timeClock'], 'an instance is an event of a special type: a time and a status');
	assert.equal(fields.fieldList.find(field => field.id === 'description').isMultiline, true);
	const data = { raw: 'title: Team room\nmeetingId: 812 3456 7890\n' };
	assert.equal(fields.valueListGet(data).meetingId, '812 3456 7890');
	// a value typed keeps its last space (it is being typed); an emptied one goes
	assert.equal(fields.rawWithValue(data, 'passcode', 'ab '), 'title: Team room\nmeetingId: 812 3456 7890\npasscode: "ab "\n');
	assert.equal(fields.rawWithValue(data, 'title', ''), 'meetingId: 812 3456 7890\n');
	const reservation = oaCardDataFieldsOf(MEETING_ZOOM_RESERVATION);
	assert.deepEqual(reservation.fieldList.filter((field) => field.isProperty).map((field) => [field.id, field.kind, field.valueList[0]]), [['timeFormat', 'enum', ''], ['timeClock', 'enum', '']]);
	assert.equal(reservation.rawWithValue({ raw: 'title: A\ntime: 2026-11-25 10:00 +09\n' }, 'time', '1100 1130'), 'title: A\ntime: 2026-11-25 11:00~11:30 +09\n', 'a time typed is read');
});

test('a reservation tells whoever collects times when it is, and takes another time', () => {
	const item = oaTimeItemOf(MEETING_ZOOM_RESERVATION);
	const data = { raw: 'title: Sync\ntime: 2026-11-25 10:00~10:45 +09\ntimeFormat: short\n' };
	const span = item.spanGet(data);
	assert.deepEqual([span.date, span.start, span.end, span.zone], ['2026-11-25', 600, 645, 540]);
	assert.equal(item.titleGet(data), 'Sync');
	assert.equal(item.spanSet(data, { ...span, date: '2026-11-26', weekday: 4, start: 660, end: 705 }), 'title: Sync\ntime: 2026-11-26 11:00~11:45 +09\ntimeFormat: short\n');
	assert.equal(item.spanGet({ raw: 'title: x\n' }), null);
});
