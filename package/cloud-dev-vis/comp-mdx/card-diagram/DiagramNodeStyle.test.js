import assert from 'node:assert/strict';
import test from 'node:test';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';
import { diagramNormalize } from './DiagramERData.js';
import { DiagramEditStore } from './DiagramEditStore.js';
import { cardModelBuild } from './DiagramEditCardModel.js';
import { colorInkOf, colorHexNormalize, nodeStyleKeyListOf, nodeStyleVarsOf } from './DiagramNodeStyle.js';

const registry = cardDiagramNodeRegistry;
const diagramOf = (nodeList) => ({ version: 1, nodes: nodeList, connections: [] });
const noteOf = (id, style) => ({ id, renderer: { type: 'card-note' }, position: { x: 0, y: 0 }, ...(style ? { style } : {}), data: { title: id }, handles: [] });

test('a node is filled with a tone, none or a color of its own, where its kind draws a fill', () => {
	for (const fill of ['blue', 'none', '#fde68a', '#fde68a80', '#abc']) assert.doesNotThrow(() => diagramNormalize(diagramOf([noteOf('a', { fill })]), registry));
	assert.throws(() => diagramNormalize(diagramOf([noteOf('a', { fill: 'navy' })]), registry), /a\.style\.fill is a tone/);
	assert.throws(() => diagramNormalize(diagramOf([noteOf('a', { stroke: 'blue' })]), registry), /a card-note node draws no stroke \(it draws fill\)/);
	assert.throws(() => diagramNormalize(diagramOf([noteOf('a', { shadow: 'blue' })]), registry), /unknown key "shadow"/);
	const caption = { id: 'c', renderer: { type: 'card-caption' }, position: { x: 0, y: 0 }, style: { fill: 'blue' }, data: { text: 'c' }, handles: [] };
	assert.throws(() => diagramNormalize(diagramOf([caption]), registry), /a card-caption node draws no fill\./);
	// a card on the table card draws a fill without saying so; a color block a fill and an edge
	assert.deepEqual(nodeStyleKeyListOf(registry.kindByType.table), ['fill']);
	assert.deepEqual(nodeStyleKeyListOf(registry.kindByType['color-block']), ['fill', 'stroke']);
	assert.deepEqual(nodeStyleKeyListOf(registry.kindByType['scene-box']), []);
});

test('the style of a node becomes the variables of its box, with an ink that reads on a color of its own', () => {
	assert.equal(nodeStyleVarsOf({}), undefined);
	assert.deepEqual(nodeStyleVarsOf({ style: { fill: 'teal' } }), { '--doc-node-fill': 'var(--doc-vis-fill-teal)' });
	assert.deepEqual(nodeStyleVarsOf({ style: { fill: 'none', stroke: 'red' } }), { '--doc-node-fill': 'transparent', '--doc-node-stroke': 'var(--doc-vis-stroke-red)' });
	assert.equal(nodeStyleVarsOf({ style: { fill: '#1e293b' } }).color, '#f8fafc');
	assert.equal(nodeStyleVarsOf({ style: { fill: '#fde68a' } }).color, '#0f172a');
	assert.equal(colorInkOf('#1e293b40'), null);
	assert.equal(colorHexNormalize('#FDE68AFF'), '#fde68a');
	assert.equal(colorHexNormalize('#FDE68A80'), '#fde68a80');
});

test('a fill set from the edit card is a step, a picking of a color one step, and the default takes the style away', () => {
	const store = new DiagramEditStore(JSON.stringify(diagramOf([noteOf('a')])), 'diagram', undefined, registry);
	store.select('a');
	const editor = { store, change: operation => operation(), featureList: [], handlePositionGet: () => null, navigate: () => {} };
	const section = cardModelBuild(editor).view.sectionList.find(item => item.id === 'style');
	assert.deepEqual(section.propertyList.map(property => [property.id, property.kind, property.value]), [['style-fill', 'color', '']]);
	assert.equal(section.propertyList[0].swatchList.length, 7);
	assert.equal(section.propertyList[0].set('amber'), true);
	assert.deepEqual(store.nodeGet('a').style, { fill: 'amber' });
	for (const hex of ['#111111', '#222222', '#333333']) assert.equal(store.nodeStyleSet('a', 'fill', hex, { groupKey: 'color:pick' }), true);
	assert.equal(store.history.length, 2);
	assert.equal(store.undo(), true);
	assert.equal(store.nodeGet('a').style.fill, 'amber');
	assert.equal(store.redo(), true);
	assert.equal(store.nodeStyleSet('a', 'fill', undefined), true);
	assert.equal(store.nodeGet('a').style, undefined);
	assert.equal(store.undo(), true);
	assert.equal(store.nodeGet('a').style.fill, '#333333');
	// what the kind does not draw is refused, and says why
	assert.equal(store.nodeStyleSet('a', 'stroke', 'red'), false);
	assert.match(store.message, /draws no stroke/);
});

test('a color block written with its fill in its data says where it goes now', () => {
	const block = { id: 'b', renderer: { type: 'color-block' }, position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, data: { fill: 'none', itemList: [] }, handles: [] };
	assert.throws(() => diagramNormalize(diagramOf([block]), registry), /style: \{ fill: none \}/);
	assert.doesNotThrow(() => diagramNormalize(diagramOf([{ ...block, style: { fill: 'none', stroke: 'violet' }, data: { itemList: [] } }]), registry));
});
