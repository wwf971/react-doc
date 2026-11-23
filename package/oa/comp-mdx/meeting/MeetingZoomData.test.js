import assert from 'node:assert/strict';
import test from 'node:test';
import {
	MEETING_ZOOM_INSTANCE, MEETING_ZOOM_RESERVATION, meetingFieldNormalize, meetingIdFormat, meetingJoinUrl, meetingRawBuild, meetingRead,
	meetingTimeParse, meetingWhenPartList,
} from './MeetingZoomData.js';

test('a meeting is read from its yaml, every field of its kind a text, and written back in their order', () => {
	const meeting = meetingRead(MEETING_ZOOM_RESERVATION, { raw: 'url: https://zoom.us/j/81234567890\ntitle: Sync\nduration: 30\npasscode: x\n' });
	assert.equal(meeting.title, 'Sync');
	assert.equal(meeting.duration, '30');
	assert.equal(meeting.description, '');
	assert.equal('passcode' in meeting, false, 'a field of the other kind is not read');
	assert.equal(meetingRawBuild(MEETING_ZOOM_RESERVATION, meeting), 'title: Sync\nduration: 30\nurl: https://zoom.us/j/81234567890\n');
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

test('when: the day of the week, the time with the zone it was written with, how long', () => {
	assert.deepEqual(meetingWhenPartList({ time: '2026-11-25 10:00 +09', duration: '60' }), { timeText: 'Wed 2026-11-25 10:00 +09', durationText: '60 min' });
	assert.equal(meetingTimeParse('2026-11-25T01:00Z').zone, '+00');
	assert.equal(meetingTimeParse('2026-11-25T10:00+09:00').zone, '+09');
	assert.equal(meetingTimeParse('2026-11-25 10:00 +05:30').zone, '+05:30');
	// no zone written: shown as written, never a zone made up
	assert.equal(meetingWhenPartList({ time: '2026-11-25 10:00' }).timeText, 'Wed 2026-11-25 10:00');
	assert.equal(meetingWhenPartList({ time: 'every Monday', duration: '1h' }).durationText, '1h');
	assert.deepEqual(meetingWhenPartList({}), { timeText: '', durationText: '' });
});

test('a value typed is kept as the card reads it, so entering the edit mode moves nothing', () => {
	assert.equal(meetingFieldNormalize('time', '2026-11-25T10:00+09:00'), '2026-11-25 10:00 +09');
	assert.equal(meetingFieldNormalize('meetingId', '81234567890'), '812 3456 7890');
	assert.equal(meetingFieldNormalize('title', '  Sync '), 'Sync');
	assert.equal(meetingFieldNormalize('description', '  indented\nline  \n'), '  indented\nline');
});
