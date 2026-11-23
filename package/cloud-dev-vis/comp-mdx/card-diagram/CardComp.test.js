import assert from 'node:assert/strict';
import test from 'node:test';
import { DiagramEditStore } from './DiagramEditStore.js';
import { cardModelBuild } from './DiagramEditCardModel.js';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';
import { cardCompEntryMatch, cardCompSlashNameOf } from './CardCompData.js';

// A card holding a component (card-diagram-impl.md#a-component-in-a-card): its commands, each a step
// of the history or none, and what its edit card offers
const source = `version: 1
nodes:
  - id: note
    renderer: { type: card-note }
    data: { title: A note }
`;
const meeting = { compName: 'MeetingZoom', label: 'Zoom meeting', description: 'a meeting', source: { lang: 'yaml', raw: 'title: Zoom meeting\n' }, slashName: 'meeting-zoom', wordList: ['MeetingZoom', 'meeting-zoom', 'zoom'] };
const storeMake = () => new DiagramEditStore(source, 'diagram', () => undefined, cardDiagramNodeRegistry);

test('a card is added holding a component, started from its source, and selected', () => {
  const store = storeMake();
  const id = store.nodeCompAdd(meeting, { x: 10.4, y: 20 });
  assert.equal(id, 'meeting-zoom-1');
  const node = store.nodeGet(id);
  assert.deepEqual(node.renderer, { type: 'card-comp' });
  assert.deepEqual(node.data, { comp: 'MeetingZoom', lang: 'yaml', raw: 'title: Zoom meeting\n' });
  assert.deepEqual(node.position, { x: 10, y: 20 });
  assert.equal(store.selection.nodeId, id);
  // an empty card, its component chosen later: one step each, undone whole
  const empty = store.nodeCompAdd(null, { x: 0, y: 200 });
  assert.deepEqual(store.nodeGet(empty).data, {});
  assert.equal(store.nodeCompChoose(empty, meeting), true);
  assert.equal(store.nodeGet(empty).data.comp, 'MeetingZoom');
  store.undo();
  assert.deepEqual(store.nodeGet(empty).data, {});
  // a card is no place for a component on a node of another kind
  assert.equal(store.nodeCompChoose('note', meeting), false);
});

test('what the editor of the component reports is one step per session; a cancel leaves none', () => {
  const store = storeMake();
  const id = store.nodeCompAdd(meeting, { x: 0, y: 0 });
  const rawBefore = store.nodeGet(id).data.raw;
  assert.equal(store.compEditStart(id, 'fields'), true);
  assert.deepEqual({ nodeId: store.compEdit.nodeId, modeId: store.compEdit.modeId }, { nodeId: id, modeId: 'fields' });
  store.nodeCompDataSet(id, { raw: 'title: Sync\n' });
  store.nodeCompDataSet(id, { raw: 'title: Sync\npasscode: "1"\n' });
  assert.equal(store.nodeGet(id).data.raw, 'title: Sync\npasscode: "1"\n');
  store.compEditEnd();
  assert.equal(store.compEdit, null);
  // the session is one step: one undo puts back what the card held before it
  store.undo();
  assert.equal(store.nodeGet(id).data.raw, rawBefore);
  store.redo();
  assert.equal(store.nodeGet(id).data.raw, 'title: Sync\npasscode: "1"\n');
  // a session given up: the card holds again what it held, and no step is left of it
  const undoAvailable = store.history.isUndoAvailable;
  store.compEditStart(id, 'fields');
  store.nodeCompDataSet(id, { raw: 'title: Gone\n' });
  store.compEditCancel();
  assert.equal(store.nodeGet(id).data.raw, 'title: Sync\npasscode: "1"\n');
  assert.equal(store.history.isUndoAvailable, undoAvailable);
  store.undo();
  assert.equal(store.nodeGet(id).data.raw, rawBefore);
  // no session on a card without a component, or on another kind
  assert.equal(store.compEditStart('note', 'fields'), false);
});

test('a data of another form is refused, naming the node; the edit card offers its data as text', () => {
  const store = storeMake();
  const id = store.nodeCompAdd(meeting, { x: 0, y: 0 });
  assert.equal(store.changeApply(documentNext => documentNext.setIn(['nodes', 1, 'data', 'raw'], 3)), false);
  assert.match(store.message, /data.raw of a card-comp node/);
  store.select(id);
  const model = cardModelBuild({ store, change: fn => fn(), navigate: () => {}, featureList: [] });
  const section = (model.view?.sectionList ?? []).find(one => one.id === 'comp-data');
  assert.ok(section, 'the section of its data');
  assert.equal(section.propertyList[0].value, 'title: Zoom meeting\n');
  section.propertyList[0].set('title: Typed\n');
  assert.equal(store.nodeGet(id).data.raw, 'title: Typed\n');
});

test('a component is found by its names, its word after / and its label', () => {
  assert.equal(cardCompSlashNameOf('MeetingZoom'), 'meeting-zoom');
  assert.equal(cardCompSlashNameOf('ExcelUniver'), 'excel-univer');
  assert.ok(cardCompEntryMatch(meeting, 'zoom meet'));
  assert.ok(cardCompEntryMatch(meeting, 'meeting-zoom'));
  assert.ok(!cardCompEntryMatch(meeting, 'table'));
});
