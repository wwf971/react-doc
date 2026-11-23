import assert from 'node:assert/strict';
import test from 'node:test';
import { compDefine } from '../registry/comp-registry.js';
import { slashActionByIdCompBuild } from './slash-comp.js';

const Meeting = () => null;
const compById = {
  'oa/MeetingZoom': compDefine(Meeting, { expose: { meta: { label: 'Zoom meeting', slashName: 'meeting-zoom', slashAliasList: ['zoom'] }, sourceDefaultCreate: () => ({ lang: 'yaml', raw: 'title: Zoom meeting\n' }) } }),
  'oa/Quiet': compDefine(Meeting, { expose: { meta: { label: 'Quiet' }, sourceDefaultCreate: () => ({ lang: 'yaml', raw: '' }) } }),
  'oa/Panel': compDefine(Meeting, { expose: { meta: { slashName: 'panel', isNotInDoc: true }, sourceDefaultCreate: () => ({ lang: 'yaml', raw: '' }) } }),
};
const configDoc = { compRegistry: { MeetingZoom: 'oa/MeetingZoom', Quiet: 'oa/Quiet', Panel: 'oa/Panel', ZoomMeeting: 'oa/MeetingZoom' } };

test('a component declaring a slash name is put at the caret by it, as the insert menu writes its block', () => {
  const actionById = slashActionByIdCompBuild({ compById, configDoc });
  assert.deepEqual(Object.keys(actionById), ['comp/MeetingZoom']);
  const action = actionById['comp/MeetingZoom'];
  assert.equal(action.name, 'meeting-zoom');
  assert.deepEqual(action.aliasList, ['zoom']);
  assert.equal(action.label, 'Zoom meeting');
  const effect = action.run({ sourcePath: '~oa/doc/notes.md' });
  assert.equal(effect.type, 'block');
  assert.equal(effect.source, '<!--renderComp=MeetingZoom-->\n```yaml\ntitle: Zoom meeting\n\n```');
});

test('a slash name is one word typed after /', () => {
  assert.throws(() => compDefine(Meeting, { expose: { meta: { slashName: 'meeting zoom' } } }), /words typed after/);
  assert.throws(() => compDefine(Meeting, { expose: { meta: { slashName: 'm', slashAliasList: 'zoom' } } }), /must be an array/);
});
