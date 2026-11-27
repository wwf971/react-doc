import assert from 'node:assert/strict';
import test from 'node:test';
import { DiagramEditStore } from './DiagramEditStore.js';
import { cardModelBuild } from './DiagramEditCardModel.js';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';
import { cardCompDataOfBlockSource, cardCompEntryMatch, cardCompPropsWithView, cardCompSlashNameOf } from './CardCompData.js';
import { cardCompAssetEntryCreate, cardCompAssetWrite } from './CardCompAsset.js';
import { codeSlashAction } from '../../../../built-in/comp-mdx/text/code-slash.js';
import { mdxSlashAction } from '../../../../built-in/comp-mdx/text/mdx-slash.js';
import { codeExpose, mdxExpose } from '../../../../main/comp-doc/registry/registry-expose.js';
import { compBlockTextRead } from '../../../../main/comp-doc/registry/comp-expose.js';
import { mathBlockExpose } from '../../../../built-in/comp-mdx/math/math-block-expose.js';
import { mathSlashAction } from '../../../../built-in/comp-mdx/math/math-slash.js';

// the components of a page that read a block of a form of their own (cardCompBlockReaderListBuild):
// Code a fenced code block, MathBlock $$ lines
const readerList = [
  { compName: 'Code', read: (text) => compBlockTextRead({ expose: codeExpose }, text) },
  { compName: 'MathBlock', read: (text) => compBlockTextRead({ expose: mathBlockExpose }, text) },
];

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

test('a component offering its values has them in the edit card, one field each, each typed a step', () => {
  const store = storeMake();
  const id = store.nodeCompAdd(meeting, { x: 0, y: 0 });
  store.select(id);
  // the definition of the page, as the editor resolves it: a component whose values are offered
  const dataFields = {
    fieldList: [{ id: 'title', label: 'Title' }, { id: 'passcode', label: 'Passcode' }],
    valueListGet: data => ({ title: /title: (.*)/.exec(data.raw)?.[1] ?? '', passcode: /passcode: (.*)/.exec(data.raw)?.[1] ?? '' }),
    rawWithValue: (data, fieldId, text) => `${data.raw.replace(new RegExp(`${fieldId}: .*\\n`), '')}${fieldId}: ${text}\n`,
  };
  const editor = { store, change: fn => fn(), navigate: () => {}, featureList: [], compDefinitionGet: () => ({ expose: { meta: { label: 'Zoom meeting instance' }, dataFields } }) };
  const model = cardModelBuild(editor);
  const values = model.view.sectionList.find(one => one.id === 'comp-values');
  assert.equal(values.label, 'Zoom meeting instance');
  assert.deepEqual(values.propertyList.map(property => [property.label, property.value]), [['Title', 'Zoom meeting'], ['Passcode', '']]);
  const rawBefore = store.nodeGet(id).data.raw;
  values.propertyList[1].set('1234');
  assert.equal(store.nodeGet(id).data.raw, 'title: Zoom meeting\npasscode: 1234\n');
  // the text of its data stays offered beside them
  assert.equal(model.view.sectionList.find(one => one.id === 'comp-data').label, 'Its data as text');
  store.undo();
  assert.equal(store.nodeGet(id).data.raw, rawBefore);
});

test('a component is found by its names, its word after / and its label', () => {
  assert.equal(cardCompSlashNameOf('MeetingZoom'), 'meeting-zoom');
  assert.equal(cardCompSlashNameOf('ExcelUniver'), 'excel-univer');
  assert.ok(cardCompEntryMatch(meeting, 'zoom meet'));
  assert.ok(cardCompEntryMatch(meeting, 'meeting-zoom'));
  assert.ok(!cardCompEntryMatch(meeting, 'table'));
});

// the blocks the slash actions of a document put at the caret, taken as cards (the create panel)
test('a block of a document is a card: a code block holds Code, an MDX block Mdx, each in its view', () => {
  // the page's actions say they put a block, with its views
  assert.deepEqual(codeSlashAction.block.viewList.map(view => view.id), ['card', 'plain', 'icon']);
  assert.deepEqual(mdxSlashAction.block.viewList.map(view => view.id), ['icon', 'card']);
  // what they answer, by default and in a view chosen
  const sourceOf = effect => effect.source;
  assert.deepEqual(cardCompDataOfBlockSource(sourceOf(codeSlashAction.run({})), readerList), { comp: 'Code', lang: 'text', raw: '' });
  const iconItem = codeSlashAction.param.itemListGet('', {}).find(item => item.id === 'icon');
  assert.deepEqual(cardCompDataOfBlockSource(sourceOf(codeSlashAction.param.itemChoose(iconItem, '', {})), readerList), { comp: 'Code', lang: 'text', raw: '', props: { view: 'icon' } });
  assert.deepEqual(cardCompDataOfBlockSource(sourceOf(mdxSlashAction.run({}))), { comp: 'Mdx', lang: 'md', raw: '' });
  const cardItem = mdxSlashAction.param.itemListGet('', {}).find(item => item.id === 'card');
  assert.deepEqual(cardCompDataOfBlockSource(sourceOf(mdxSlashAction.param.itemChoose(cardItem, '', {}))), { comp: 'Mdx', lang: 'md', raw: '', props: { view: 'card' } });
  // a fence with lines, its language, title and view; a longer fence holding a shorter one
  assert.deepEqual(cardCompDataOfBlockSource('```python title="a.py" view=plain\ndef add(a, b):\n    return a + b\n```', readerList), { comp: 'Code', lang: 'python', raw: 'def add(a, b):\n    return a + b\n', props: { view: 'plain', title: 'a.py' } });
  assert.deepEqual(cardCompDataOfBlockSource('<!--renderComp=Mdx,title=Notes-->\n````md\n# Notes\n```sh\nls\n```\n````'), { comp: 'Mdx', lang: 'md', raw: '# Notes\n```sh\nls\n```\n', props: { title: 'Notes' } });
  // a block of math: $$ lines, read by MathBlock; /math answers one where a block alone is taken
  assert.deepEqual(cardCompDataOfBlockSource('$$\nE = mc^2\n$$', readerList), { comp: 'MathBlock', lang: 'latex', raw: 'E = mc^2' });
  assert.ok(mathSlashAction.block, '/math says it answers a block where a block alone is taken');
  assert.deepEqual(cardCompDataOfBlockSource(sourceOf(mathSlashAction.run({ isBlockOnly: true })), readerList), { comp: 'MathBlock', lang: 'latex', raw: 'x' });
  const rowItem = mathSlashAction.param.itemListGet('', {}).find(item => item.id === 'row');
  assert.equal(mathSlashAction.param.itemChoose(rowItem, '', {}).type, 'atom', 'in a document /math stays a formula among the text');
  // a block of another form after its marker, as the document hands it to its component (a quote)
  assert.deepEqual(cardCompDataOfBlockSource('<!--renderComp=BlockSimple,type=info,title=Note-->\n> Text of the block.', readerList), { comp: 'BlockSimple', lang: '', raw: '> Text of the block.', props: { type: 'info', title: 'Note' } });
  // what is not one block is no card; a fence no component of the page reads neither
  assert.equal(cardCompDataOfBlockSource('a paragraph', readerList), null);
  assert.equal(cardCompDataOfBlockSource('$$\nx\n$$\n\nand a paragraph', readerList), null);
  assert.equal(cardCompDataOfBlockSource('<!--renderComp=BlockSimple-->\n> one\n\nanother', readerList), null);
  assert.equal(cardCompDataOfBlockSource('```js\nnot closed', readerList), null);
  assert.equal(cardCompDataOfBlockSource('```js\nx\n```'), null);
  assert.equal(cardCompDataOfBlockSource(undefined), null);
});

test('the view of a card is a prop of its block, chosen in its edit card; Default removes it', () => {
  assert.deepEqual(cardCompPropsWithView({ title: 'a.py', view: 'icon' }, 'plain'), { title: 'a.py', view: 'plain' });
  assert.deepEqual(cardCompPropsWithView({ title: 'a.py', view: 'icon' }, ''), { title: 'a.py' });
  assert.deepEqual(cardCompPropsWithView(undefined, 'card'), { view: 'card' });
  const store = storeMake();
  const id = store.nodeCompAdd({ compName: 'Code', source: { lang: 'python', raw: 'print(1)\n', props: { view: 'icon' } } }, { x: 0, y: 0 });
  store.select(id);
  const editor = { store, change: fn => fn(), navigate: () => {}, featureList: [], compDefinitionGet: name => (name === 'Code' ? { expose: codeExpose } : { expose: mdxExpose }) };
  const values = () => cardModelBuild(editor).view.sectionList.find(one => one.id === 'comp-values');
  const view = values().propertyList.find(property => property.id === 'comp-view');
  assert.equal(view.kind, 'enum');
  assert.equal(view.value, 'icon');
  assert.deepEqual(view.values, ['', 'card', 'plain', 'icon']);
  view.set('plain');
  assert.deepEqual(store.nodeGet(id).data.props, { view: 'plain' });
  values().propertyList.find(property => property.id === 'comp-view').set('');
  assert.equal(store.nodeGet(id).data.props, undefined);
  store.undo();
  assert.deepEqual(store.nodeGet(id).data.props, { view: 'plain' });
  // a view drawing a tile makes the card as wide as the tile; another one gives it its width again
  values().propertyList.find(property => property.id === 'comp-view').set('icon');
  assert.equal(store.nodeGet(id).size.width, 'auto');
  values().propertyList.find(property => property.id === 'comp-view').set('card');
  assert.equal(store.nodeGet(id).size.width, 240);
  // a card made in a tile view is as wide as its tile
  const tile = store.nodeCompAdd({ compName: 'Mdx', source: { lang: 'md', raw: '' }, isTile: true }, { x: 0, y: 300 });
  assert.equal(store.nodeGet(tile).size.width, 'auto');
});

// a component whose data must be an asset item (a spreadsheet): its item made first, the card holding
// the reference, and what it writes going to the item
test('a card of an asset-only component holds the reference to an item made for it, and writes into the item', async () => {
  const callList = [];
  const assetStore = {
    isWritable: true,
    writeUnavailableReason: '',
    itemCreate: async (input) => { callList.push(['create', input.store, input.lang, input.text, input.component.name]); return { code: 0, data: { item: { itemId: 'w1item' } } }; },
    itemGet: () => ({ lang: 'json' }),
    itemMetaSet: async (...args) => { callList.push(['meta', ...args]); return { code: 0 }; },
    itemUpdate: async (store, itemId, data, mode, note, dependencyList, versionMetadata) => { callList.push(['update', store, itemId, data.text, versionMetadata]); return { code: 0, message: '' }; },
    refQuery: () => ({}),
  };
  const entry = { compName: 'ExcelUniver', label: 'Spreadsheet', isAssetOnly: true, source: { lang: 'json', raw: '{"sheets":{}}' } };
  const result = await cardCompAssetEntryCreate({ assetStore, entry, compById: {}, docPath: 'example/a.md' });
  assert.equal(result.code, 0);
  assert.deepEqual(callList[0], ['create', 'local', 'json', '{"sheets":{}}', 'ExcelUniver']);
  assert.deepEqual(result.data.entry.source, { lang: 'asset', raw: 'store: local\nitemId: w1item\n' });
  const store = storeMake();
  const id = store.nodeCompAdd(result.data.entry, { x: 0, y: 0 });
  assert.deepEqual(store.nodeGet(id).data, { comp: 'ExcelUniver', lang: 'asset', raw: 'store: local\nitemId: w1item\n' });
  // the edit card offers the reference, not the data
  store.select(id);
  const editor = { store, change: fn => fn(), navigate: () => {}, featureList: [], compDefinitionGet: () => ({ expose: { meta: { label: 'Spreadsheet', isAssetOnly: true } } }) };
  const dataSection = cardModelBuild(editor).view.sectionList.find(one => one.id === 'comp-data');
  assert.equal(dataSection.propertyList[0].label, 'reference');
  // what the component saves goes into the item, in its save mode
  const write = await cardCompAssetWrite({ assetStore, reference: store.nodeGet(id).data.raw, compName: 'ExcelUniver', raw: '{"sheets":{"a":{}}}', versionMetadata: { engine: 'univer' } });
  assert.equal(write.code, 0);
  assert.deepEqual(callList.at(-1), ['update', 'local', 'w1item', '{"sheets":{"a":{}}}', { engine: 'univer' }]);
  // where the store cannot be written, nothing is made, and the reason is said
  const refused = await cardCompAssetEntryCreate({ assetStore: { ...assetStore, isWritable: false, writeUnavailableReason: 'the store is read-only' }, entry, compById: {} });
  assert.equal(refused.code, -1);
  assert.match(refused.message, /read-only/);
  assert.equal(callList.filter(call => call[0] === 'create').length, 1);
});

// A node holding others (card-diagram-impl.md#a-node-holding-others): a card of a component holding
// others (expose.hold, here a list of names) takes a card dropped on it, refuses one saying why, and
// lets one go again, as a card of its own or into another holder; each a step undone whole
test('a holder takes a card dropped on it, refuses another with the reason, and lets one go', async () => {
  const { compHoldTakeReasonGet } = await import('../../../../main/comp-doc/registry/comp-expose.js');
  const { nodeTakeDataGet, nodeTakeTargetGet } = await import('./DiagramNodeTake.js');
  const { cardCompLetGo, cardCompNodeOfBlock } = await import('./CardCompHold.js');
  const lineList = (raw) => String(raw ?? '').split('\n').filter(Boolean);
  const listHold = {
    heldListGet: (data) => lineList(data.raw).map((line, index) => ({ key: String(index), block: JSON.parse(line) })),
    takeCheck: (_data, block) => (block.comp === 'Meeting' ? '' : `${block.comp} is not a meeting`),
    take: (data, block) => ({ raw: [...lineList(data.raw), JSON.stringify(block)].join('\n') }),
    letGo: (data, key) => {
      const list = lineList(data.raw);
      const block = list[Number(key)] ? JSON.parse(list[Number(key)]) : null;
      return block ? { raw: list.filter((_, index) => index !== Number(key)).join('\n'), block } : null;
    },
  };
  const definitionByName = { Holder: { expose: { meta: { label: 'Holder' }, hold: listHold } }, Meeting: { expose: { meta: { label: 'Meeting' } } }, Other: { expose: { meta: { label: 'Other' } } } };
  const editor = { compDefinitionGet: (name) => definitionByName[name] ?? null, packageConfigGet: () => ({}) };
  const diagram = `version: 1
nodes:
  - { id: holder, renderer: { type: card-comp }, position: { x: 0, y: 0 }, data: { comp: Holder, lang: yaml, raw: '' } }
  - { id: holder-2, renderer: { type: card-comp }, position: { x: 600, y: 0 }, data: { comp: Holder, lang: yaml, raw: '' } }
  - id: meeting
    renderer: { type: card-comp }
    position: { x: 300, y: 0 }
    data: { comp: Meeting, lang: yaml, raw: "title: Sync\\n" }
    handles: [{ id: out, direction: out, anchor: { side: right } }]
  - { id: other, renderer: { type: card-comp }, position: { x: 300, y: 200 }, data: { comp: Other, lang: yaml, raw: '' } }
  - { id: note, renderer: { type: card-note }, position: { x: 300, y: 400 }, data: { title: A note } }
connections:
  - { id: line, source: { nodeId: meeting, handleId: out }, target: { position: { x: 500, y: 100 } } }
`;
  const store = new DiagramEditStore(diagram, 'diagram', () => undefined, cardDiagramNodeRegistry);
  const ask = (droppedId, idListAt) => nodeTakeTargetGet({ store, registry: store.registry, editor, dropped: store.nodeGet(droppedId), idListAt, exceptIdList: [droppedId] });
  assert.deepEqual(ask('meeting', ['meeting', 'holder']), { nodeId: 'holder', reason: '' });
  assert.deepEqual(ask('other', ['holder']), { nodeId: 'holder', reason: 'Other is not a meeting' });
  assert.deepEqual(ask('note', ['holder']), { nodeId: 'holder', reason: 'it holds the cards of components' });
  assert.equal(ask('meeting', ['note', 'other']), null, 'a node that holds nothing answers nothing');
  assert.equal(compHoldTakeReasonGet(definitionByName.Meeting, {}, { comp: 'Meeting' }, {}), undefined);

  // taken: the holder holds its block, the card is gone, its line keeps a free end; one step
  const { data } = nodeTakeDataGet({ store, registry: store.registry, editor, holderId: 'holder', dropped: store.nodeGet('meeting') });
  assert.equal(store.nodeTake('holder', data, 'meeting', { positionGet: () => ({ x: 320, y: 40 }) }), true);
  assert.equal(store.nodeGet('meeting'), undefined);
  assert.deepEqual(JSON.parse(store.nodeGet('holder').data.raw), { comp: 'Meeting', lang: 'yaml', raw: 'title: Sync\n' });
  assert.deepEqual(store.connectionGet('line').source, { position: { x: 320, y: 40 } }, 'its line is not dropped: its end is free where it was');
  assert.equal(store.selection.nodeId, 'holder');
  store.undo();
  assert.equal(store.nodeGet('meeting').data.comp, 'Meeting');
  assert.equal(store.nodeGet('holder').data.raw, '');
  store.redo();

  // let go on the canvas: a card of its own there; into another holder: that one holds it
  const letGo = cardCompLetGo({ node: store.nodeGet('holder'), editor, key: '0' });
  assert.equal(letGo.holderData.raw, '');
  const released = cardCompNodeOfBlock(letGo.block, editor.compDefinitionGet('Meeting'));
  const idNew = store.nodeRelease('holder', letGo.holderData, released, { position: { x: 900.6, y: 50 } });
  assert.equal(idNew, 'meeting-1');
  assert.deepEqual(store.nodeGet(idNew).data, { comp: 'Meeting', lang: 'yaml', raw: 'title: Sync\n' });
  assert.deepEqual(store.nodeGet(idNew).position, { x: 901, y: 50 });
  assert.equal(store.nodeGet('holder').data.raw, '');
  store.undo();
  assert.equal(store.nodeGet('meeting-1'), undefined);
  assert.equal(lineList(store.nodeGet('holder').data.raw).length, 1);
  const { data: takerData } = nodeTakeDataGet({ store, registry: store.registry, editor, holderId: 'holder-2', dropped: { id: '', ...released } });
  assert.equal(store.nodeRelease('holder', letGo.holderData, released, { takerId: 'holder-2', takerData }), 'holder-2');
  assert.equal(store.nodeGet('holder').data.raw, '');
  assert.equal(lineList(store.nodeGet('holder-2').data.raw).length, 1);
  assert.equal(store.nodeRelease('holder', letGo.holderData, released, { takerId: 'holder' }), null, 'never into itself');
});
