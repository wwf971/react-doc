import assert from 'node:assert/strict';
import test from 'node:test';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';
import { diagramNormalize } from './DiagramERData.js';
import { DiagramEditStore } from './DiagramEditStore.js';
import { nodeResizeAxisListOf, nodeResizeHandlePointListOf, nodeSizeModeListOf, nodeSizeModeOf, nodeSizeOfMode } from './DiagramNodeResize.js';
import { cardModelBuild } from './DiagramEditCardModel.js';

const registry = cardDiagramNodeRegistry;
const nodeOf = (id, type, extra = {}) => ({ id, renderer: { type }, position: { x: 0, y: 0 }, handles: [], ...extra });
const diagramOf = nodeList => ({ version: 1, nodes: nodeList, connections: [] });
const axisOf = (graph, id) => {
	const node = graph.nodes.find(item => item.id === id);
	return nodeResizeAxisListOf(node, registry.kindByType[node.renderer.type]?.contract);
};

test('what the resize handles of a node change is read from the node, for every kind alike', () => {
	const graph = diagramNormalize(diagramOf([
		nodeOf('block', 'color-block', { size: { width: 200, height: 100 }, data: {} }),
		nodeOf('note', 'card-note', { data: { title: 'N' } }),
		nodeOf('table', 'table', { data: { name: 'T', fields: [{ id: 'name', label: 'Name' }], rows: [] } }),
		nodeOf('table-sized', 'table', { size: { width: 300, height: 200 }, data: { name: 'T', fields: [{ id: 'name', label: 'Name' }], rows: [] } }),
		nodeOf('label', 'card-label', { data: { title: 'L' } }),
		nodeOf('icon', 'card-icon', { size: { width: 180, height: 32 }, data: { title: 'I' } }),
		nodeOf('text', 'text', { data: { text: 'words' } }),
		nodeOf('text-wrap', 'text', { size: { width: 200 }, data: { text: 'words' } }),
		nodeOf('shape', 'shape', { size: { width: 100, height: 60 }, data: { shape: 'ellipse' } }),
		nodeOf('caption', 'card-caption', { size: { width: 100, height: 16 }, data: { text: 'c' } }),
	]), registry);
	assert.deepEqual(axisOf(graph, 'block'), ['width', 'height']);
	assert.deepEqual(axisOf(graph, 'shape'), ['width', 'height']);
	assert.deepEqual(axisOf(graph, 'note'), ['width']);
	assert.deepEqual(axisOf(graph, 'table'), ['width']);
	assert.deepEqual(axisOf(graph, 'table-sized'), ['width', 'height']);
	assert.deepEqual(axisOf(graph, 'label'), []);
	assert.deepEqual(axisOf(graph, 'icon'), ['width']);
	// a text as its size mode says: fitting its words, nothing; wrapped at a width, that width
	assert.deepEqual(axisOf(graph, 'text'), []);
	assert.deepEqual(axisOf(graph, 'text-wrap'), ['width']);
	assert.deepEqual(axisOf(graph, 'caption'), []);
	assert.deepEqual(nodeResizeAxisListOf({ ...graph.nodes[0], isDerived: true }), []);
	assert.equal(nodeResizeHandlePointListOf({ x: 0, y: 0, width: 10, height: 4 }, ['width']).length, 6);
	assert.equal(nodeResizeHandlePointListOf({ x: 0, y: 0, width: 10, height: 4 }, ['width', 'height']).length, 8);
});

test('a resize writes what changed: the axes given, the place only when it moved, as one step', () => {
	const store = new DiagramEditStore(JSON.stringify(diagramOf([nodeOf('note', 'card-note', { position: 'auto', data: { title: 'N' } }), nodeOf('locked', 'card-note', { position: { x: 5, y: 5 }, isPositionLocked: true, data: { title: 'L' } })])), 'diagram', undefined, registry);
	// the right edge of a note: its width alone, its place left to the layout
	assert.equal(store.nodeResize('note', { x: 40, y: 60, width: 251.6, height: 80, isMoved: false, axisList: ['width'] }), true);
	assert.deepEqual(store.nodeGet('note').size, { width: 252 });
	assert.equal(store.nodeGet('note').position, 'auto');
	assert.equal(store.history.length, 1);
	// its left edge moves it
	assert.equal(store.nodeResize('note', { x: 20, y: 60, width: 272, height: 80, isMoved: true, axisList: ['width'] }), true);
	assert.deepEqual(store.nodeGet('note').position, { x: 20, y: 60 });
	// a node locked in place grows from its right or bottom edge only
	assert.equal(store.nodeResize('locked', { x: 0, y: 5, width: 300, height: 80, isMoved: true, axisList: ['width'] }), false);
	assert.match(store.message, /locked in place/);
	assert.equal(store.nodeResize('locked', { x: 5, y: 5, width: 300, height: 80, isMoved: false, axisList: ['width'] }), true);
	assert.equal(store.undo(), true);
	assert.equal(store.nodeGet('locked').size, undefined);
});

test('a text takes its box by its size mode: fitting its words, or a width it wraps at; switched as one step, nothing moving', () => {
	const store = new DiagramEditStore(JSON.stringify(diagramOf([nodeOf('text', 'text', { data: { text: 'words' } })])), 'diagram', undefined, registry);
	assert.equal(nodeSizeModeOf(store.nodeGet('text')), 'fit');
	// to a width: the width it is drawn at, so nothing moves
	assert.equal(store.nodeSizeModeSet('text', 'wrap', { width: 87.4, height: 22 }), true);
	assert.deepEqual(store.nodeGet('text').size, { width: 89 });
	assert.equal(nodeSizeModeOf(store.nodeGet('text')), 'wrap');
	// the width resized, the height still following the words
	assert.equal(store.nodeResize('text', { width: 150, isMoved: false, axisList: ['width'] }), true);
	assert.deepEqual(store.nodeGet('text').size, { width: 150 });
	// back to fitting its words: no size at all
	assert.equal(store.nodeSizeModeSet('text', 'fit'), true);
	assert.equal(store.nodeGet('text').size, undefined);
	assert.equal(store.history.length, 3);
	// a mode the kind does not list is refused, and so is a size written in it
	assert.equal(store.nodeSizeModeSet('text', 'box', { width: 100, height: 40 }), false);
	assert.throws(() => diagramNormalize(diagramOf([nodeOf('text', 'text', { size: { width: 100, height: 40 }, data: { text: 'words' } })]), registry), /no size \(fits the words\) or a width alone/);
});

// a component in a card takes its box in any of the four modes, in its own words; the handles resize
// what its mode gives, and the edit card offers the axes of its mode
test('the four size modes: read from the size, in the words of a kind, each resizing what it gives', () => {
	assert.equal(nodeSizeModeOf({ size: { width: 'auto', height: 'auto' } }), 'fit');
	assert.equal(nodeSizeModeOf({ size: { width: 240, height: 'auto' } }), 'wrap');
	assert.equal(nodeSizeModeOf({ size: { width: 'auto', height: 160 } }), 'tall');
	assert.equal(nodeSizeModeOf({ size: { width: 240, height: 160 } }), 'box');
	assert.equal(nodeSizeModeOf({}), 'fit');
	assert.deepEqual(nodeSizeOfMode('tall', { width: 99.2, height: 120.4 }), { height: 122 });
	assert.deepEqual(nodeSizeOfMode('box', { width: 99.2, height: 120.4 }), { width: 101, height: 122 });
	// a kind's own words over the defaults, an unknown mode left out
	const contract = registry.kindByType['card-comp'].contract;
	assert.deepEqual(nodeSizeModeListOf(contract).map(mode => [mode.id, mode.label]), [['fit', 'Its own size'], ['wrap', 'A width, its height follows'], ['tall', 'A height, its width follows'], ['box', 'A width and a height']]);
	assert.deepEqual(nodeSizeModeListOf({ sizeModeList: ['fit', 'nothing', { id: 'wrap', label: 'Wrapped' }] }).map(mode => mode.label), ['Fits the words', 'Wrapped']);
	const comp = (id, size) => nodeOf(id, 'card-comp', { ...(size ? { size } : {}), data: { comp: 'Code', lang: 'text', raw: 'a' } });
	const graph = diagramNormalize(diagramOf([
		comp('fit'), comp('wrap', { width: 240, height: 'auto' }), comp('tall', { height: 160 }), comp('box', { width: 240, height: 160 }),
	]), registry);
	assert.deepEqual(['fit', 'wrap', 'tall', 'box'].map(id => axisOf(graph, id)), [[], ['width'], ['height'], ['width', 'height']]);
	// a text lists no height alone: refused, naming what it takes
	assert.throws(() => diagramNormalize(diagramOf([nodeOf('text', 'text', { size: { height: 40 }, data: { text: 'w' } })]), registry), /no size \(fits the words\) or a width alone/);
});

test('the edit card switches the box of a card and offers the axes its mode gives, each a step', () => {
	const store = new DiagramEditStore(`version: 1
nodes:
  - id: code
    renderer: { type: card-comp }
    size: { width: 240, height: auto }
    data: { comp: Code, lang: text, raw: "a" }
`, 'diagram', () => undefined, registry);
	store.select('code');
	const editor = { store, change: fn => fn(), navigate: () => {}, featureList: [], nodeSizeGet: () => ({ width: 240, height: 90 }) };
	const sizeOf = () => cardModelBuild(editor).view.sectionList.find(section => section.id === 'size');
	assert.deepEqual(sizeOf().propertyList.map(property => property.id), ['size-mode', 'size-width']);
	assert.equal(sizeOf().note, 'What it holds takes the width; what is wider scrolls.');
	sizeOf().propertyList[0].set('box');
	assert.deepEqual(store.nodeGet('code').size, { width: 241, height: 91 });
	assert.deepEqual(sizeOf().propertyList.map(property => property.id), ['size-mode', 'size-width', 'size-height']);
	sizeOf().propertyList.find(property => property.id === 'size-height').set(300);
	assert.equal(store.nodeGet('code').size.height, 300);
	sizeOf().propertyList[0].set('tall');
	assert.equal(nodeSizeModeOf(store.nodeGet('code')), 'tall');
	assert.deepEqual(sizeOf().propertyList.map(property => property.id), ['size-mode', 'size-height']);
	sizeOf().propertyList[0].set('fit');
	assert.equal(nodeSizeModeOf(store.nodeGet('code')), 'fit');
	assert.deepEqual(sizeOf().propertyList.map(property => property.id), ['size-mode']);
	// each switch a step of its own
	store.undo();
	assert.equal(nodeSizeModeOf(store.nodeGet('code')), 'tall');
});
