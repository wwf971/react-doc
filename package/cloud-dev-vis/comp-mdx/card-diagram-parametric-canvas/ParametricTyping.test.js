import test from 'node:test';
import assert from 'node:assert/strict';
import { reaction } from 'mobx';
import { DiagramEditStore } from '../card-diagram/DiagramEditStore.js';
import { DiagramERStore } from '../card-diagram/DiagramERStore.js';
import { cardDiagramNodeRegistry } from '../card-diagram/card-diagram-node-registry.js';
import { PARAMETRIC_FEATURE_ID, copyNodeIdBuild } from './ParametricData.js';
import { ParametricEditStore } from './ParametricEditStore.js';
import { parametricCanvasFeature } from './ParametricFeature.jsx';
import { parametricToolMapDefault } from './ParametricTool.js';

// words typed in the source of a repeat (card-diagram-impl.md#history: rawShown): the draft takes
// every key, what follows from them elsewhere (the copies, their places, the lists of the panel)
// waits for a pause in the typing or its end
const registry = cardDiagramNodeRegistry;
const labelOf = (id, extra = {}) => ({ id, renderer: { type: 'card-label' }, data: { title: id }, handles: [], ...extra });
const source = JSON.stringify({
	version: 1, viewport: { featureList: [PARAMETRIC_FEATURE_ID] },
	nodes: [labelOf('a'), labelOf('b')], connections: [],
	parametric: { groupList: [{ id: 'g', root: { x: 0, y: 0 }, memberList: [
		{ id: 'rep', layout: { type: 'repeat', count: 3, direction: 'row', gap: 10 } },
		{ id: 'm1', node: 'a', parent: 'rep' },
		{ id: 'm2', node: 'b', parent: 'm1', constraint: { type: 'beside', side: 'bottom', gap: 20 } },
	] }] },
});
function sessionOf() {
	const store = new DiagramEditStore(source, 'diagram', undefined, registry);
	const session = new ParametricEditStore({ store, registry, catalog: parametricCanvasFeature.catalog, toolMapGet: () => parametricToolMapDefault });
	return { store, session };
}

test('a word typed reaches the draft at once, and what follows from it when the typing ends', () => {
	const { store, session } = sessionOf();
	let treeCount = 0;
	let modelCount = 0;
	const disposeList = [reaction(() => session.treeIndex, () => { treeCount += 1; }), reaction(() => session.model, () => { modelCount += 1; })];
	store.cellStart('a', null, 'title');
	// counted from here (the tree reads no selection: it is marked when drawn)
	treeCount = 0;
	assert.equal(store.fieldSet('a', null, 'title', 'ab'), true);
	assert.equal(store.fieldSet('a', null, 'title', 'abc'), true);
	// the draft, its history and the page have it
	assert.equal(store.nodeGet('a').data.title, 'abc');
	assert.match(store.report.raw, /abc/);
	assert.equal(store.history.length, 1);
	// the canvas and the lists do not yet
	assert.equal(store.isShownBehind, true);
	assert.doesNotMatch(store.rawShown, /abc/);
	assert.equal(store.nodeShownGet('a').data.title, 'a');
	assert.equal(session.nodeLabelOf('a').label, 'a');
	assert.equal(treeCount, 0);
	// a label typed changes nothing the groups are read from
	assert.equal(modelCount, 0);
	store.cellEnd();
	assert.equal(store.isShownBehind, false);
	assert.equal(store.nodeShownGet('a').data.title, 'abc');
	assert.equal(session.nodeLabelOf('a').label, 'abc');
	assert.equal(treeCount, 1);
	assert.equal(modelCount, 0);
	// an undo is drawn at once
	store.cellStart('a', null, 'title');
	store.fieldSet('a', null, 'title', 'abcd');
	assert.equal(store.undo(), true);
	assert.equal(store.isShownBehind, false);
	assert.equal(store.nodeShownGet('a').data.title, 'abc');
	disposeList.forEach(dispose => dispose());
});

test('while words are typed the canvas keeps its places; the sizes measured meanwhile are placed after', () => {
	const canvas = new DiagramERStore(source, undefined, 620, registry);
	const copyId = copyNodeIdBuild('g', 'rep', 1, 'a');
	const placeOf = id => canvas.nodeList.find(node => node.id === id)?.position;
	const before = placeOf(copyId);
	canvas.placeHoldSet(true);
	// the source grows as it is typed: its copies stay
	canvas.measurementSet('a', { width: 300, height: 40 });
	assert.deepEqual(placeOf(copyId), before);
	canvas.placeHoldSet(false);
	assert.ok(placeOf(copyId).x > before.x + 150, 'the copy moves past the wider source');
	// read anew, nothing is left waiting
	canvas.placeHoldSet(true);
	canvas.measurementSet('a', { width: 120, height: 40 });
	canvas.sourceLoad(source, true);
	const placed = placeOf(copyId);
	canvas.placeHoldSet(false);
	assert.deepEqual(placeOf(copyId), placed);
});
