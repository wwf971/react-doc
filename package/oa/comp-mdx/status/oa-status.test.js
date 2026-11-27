import assert from 'node:assert/strict';
import test from 'node:test';
import {
	oaMomentOfTyped, oaMomentParse, oaMomentShown, oaStatusChangeAdd, oaStatusChangeRemove, oaStatusChangeSet, oaStatusHistoryOrdered, oaStatusHistoryRead,
	oaStatusLatest, oaStatusOf,
} from './oa-status.js';
import { EVENT_GENERAL } from '../event/EventGeneralData.js';
import { MEETING_ZOOM_RESERVATION } from '../meeting/MeetingZoomData.js';
import { COURSE_ONLINE_RESERVATION } from '../course/CourseOnlineData.js';
import { oaCardDataFieldsOf, oaCardFieldNormalize, oaCardRawBuild, oaCardRead, oaCardStatusItemOf } from '../oa-card/oa-card-data.js';

// doc/event.md#its-status: what is kept is the history of the status, every change at a moment with its zone
test('the status is the one of the latest change, whatever the order written', () => {
	const history = oaStatusHistoryRead([
		{ status: 'confirmed', time: '20261125_18300000+09' },
		{ status: 'planned', time: '20261120_09000000+09' },
		{ status: 'postponed', time: '20261125_10000000+00' },
		{ time: '20261126_10000000+09' },
	]);
	assert.equal(history.length, 3, 'what is no change is left out');
	assert.equal(oaStatusLatest(history).status, 'postponed', '10:00 at +00 is 19:00 at +09, after 18:30');
	assert.deepEqual(oaStatusHistoryOrdered(history).map((one) => one.status), ['planned', 'confirmed', 'postponed']);
	assert.equal(oaStatusLatest([]), null);
	assert.deepEqual(oaStatusOf('done'), { id: 'done', label: 'Done', tone: 'green' });
	assert.deepEqual(oaStatusOf('held over'), { id: 'held over', label: 'held over', tone: 'gray' }, 'a status the kind does not know, as written');
});

test('a change is made now; the history is edited like any data', () => {
	const now = new Date(Date.UTC(2026, 10, 28, 1, 30));
	const added = oaStatusChangeAdd([], 'planned', { time: '20261128_10300000+09' });
	assert.deepEqual(added, [{ status: 'planned', time: '20261128_10300000+09' }]);
	assert.deepEqual(oaStatusChangeAdd(added, 'done', { time: 'x', by: 'Sato' })[1], { status: 'done', time: 'x', by: 'Sato' });
	assert.equal(oaStatusChangeSet(added, 0, { status: 'confirmed' })[0].status, 'confirmed');
	assert.deepEqual(oaStatusChangeRemove(added, 0), []);
	assert.match(oaStatusChangeAdd([], 'planned', {}).at(0).time, /^\d{8}_\d{8}[+-]\d{2}$/, 'a moment of the project\'s form');
	assert.ok(now);
});

test('a moment is read, shown with its zone, and typed loosely', () => {
	const moment = oaMomentParse('20261125_18300512+09');
	assert.deepEqual([moment.date, moment.minute, moment.second, moment.zone], ['2026-11-25', 1110, 5, 540]);
	assert.equal(moment.ms, Date.UTC(2026, 10, 25, 9, 30, 5, 120));
	assert.equal(oaMomentParse('2026-11-25'), null);
	assert.equal(oaMomentShown('20261125_18300000+09'), '2026-11-25 18:30 +09');
	assert.deepEqual(oaMomentOfTyped('1126 0900', '20261125_18300000+09'), { moment: '20261126_09000000+09' });
	assert.deepEqual(oaMomentOfTyped('2026-11-25 18:30 +09', '20261125_18301512+09'), { moment: '20261125_18301500+09' }, 'what is shown reads back, its seconds kept');
	assert.ok(oaMomentOfTyped('1000 +05:30', '20261125_18300000+09').message, 'a zone in whole hours');
	assert.ok(oaMomentOfTyped('fri', '').message);
});

test('an event and its special types share the fields of an event, its status among them', () => {
	const fieldIdOf = (kind) => kind.fieldList.map((field) => field.id);
	assert.deepEqual(fieldIdOf(EVENT_GENERAL), ['title', 'time', 'people', 'place', 'description', 'statusHistory', 'timeFormat', 'timeClock']);
	assert.deepEqual(fieldIdOf(MEETING_ZOOM_RESERVATION), ['title', 'time', 'people', 'url', 'description', 'statusHistory', 'timeFormat', 'timeClock']);
	assert.deepEqual(fieldIdOf(COURSE_ONLINE_RESERVATION), ['title', 'time', 'teacher', 'people', 'url', 'description', 'statusHistory', 'timeFormat', 'timeClock']);
	for (const kind of [EVENT_GENERAL, MEETING_ZOOM_RESERVATION, COURSE_ONLINE_RESERVATION]) assert.deepEqual(kind.typeList, ['event']);
});

test('people are typed as one text and kept as a list; the history is written as it is', () => {
	const raw = 'title: Team dinner\ntime: 2026-11-28 19:00~21:00 +09\npeople: [Sato, Tanaka]\nplace: Shibuya\nstatusHistory:\n  - { status: planned, time: 20261120_09000000+09 }\n  - { status: confirmed, time: 20261125_18300000+09, by: Sato }\n';
	const card = oaCardRead(EVENT_GENERAL, { raw });
	assert.equal(card.people, 'Sato, Tanaka');
	assert.equal(card.statusHistory.length, 2);
	assert.equal(oaCardFieldNormalize(EVENT_GENERAL, 'people', ' Sato、 Tanaka ,Suzuki '), 'Sato, Tanaka, Suzuki');
	const written = oaCardRawBuild(EVENT_GENERAL, { ...card, people: 'Sato, Suzuki' });
	assert.match(written, /people:\n {2}- Sato\n {2}- Suzuki\n/);
	assert.match(written, /statusHistory:\n {2}- status: planned\n {4}time: 20261120_09000000\+09\n {2}- status: confirmed\n {4}time: 20261125_18300000\+09\n {4}by: Sato\n/);
	assert.deepEqual(oaCardRead(EVENT_GENERAL, { raw: written }).statusHistory, card.statusHistory, 'read back the same');
	assert.equal(oaCardRawBuild(EVENT_GENERAL, { ...card, statusHistory: [] }).includes('statusHistory'), false, 'no change, nothing written');
	const item = oaCardStatusItemOf(EVENT_GENERAL);
	assert.equal(item.statusGet({ raw }).label, 'Confirmed');
	assert.equal(item.historyGet({ raw }).length, 2);
	assert.equal(oaCardStatusItemOf({ fieldList: [] }), null);
});

test('in the edit card a status chosen is a change made now, the history kept', () => {
	const fields = oaCardDataFieldsOf(EVENT_GENERAL);
	const statusField = fields.fieldList.find((field) => field.id === 'statusHistory');
	assert.equal(statusField.kind, 'enum');
	assert.equal(statusField.isProperty, undefined, 'a value, not a property');
	const data = { raw: 'title: A\nstatusHistory:\n  - { status: planned, time: 20261120_09000000+09 }\n' };
	assert.equal(fields.valueListGet(data).statusHistory, 'planned');
	const next = oaCardRead(EVENT_GENERAL, { raw: fields.rawWithValue(data, 'statusHistory', 'confirmed') }).statusHistory;
	assert.deepEqual(next.map((one) => one.status), ['planned', 'confirmed']);
	assert.equal(fields.rawWithValue(data, 'statusHistory', 'planned'), oaCardRawBuild(EVENT_GENERAL, oaCardRead(EVENT_GENERAL, data)), 'the same status: no change');
});
