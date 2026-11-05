import assert from 'node:assert/strict';
import test from 'node:test';
import {
	animationControlGraphBuild, animationIsLinear, animationNormalize, animationPathFind, animationPatternMatch, animationPlanBuild, animationPositionOffsetGet,
	animationSceneAtFrame, animationSceneListBuild, animationSceneStyleBuild, animationTransitionCompile, animationViewBetween,
} from './AnimationData.js';

const documentCreate = (extra = {}) => ({
	diagram: { nodes: [{ id: 'a' }, { id: 'b' }] },
	stateList: [
		{ id: 'one', name: 'One', hide: ['b', 'connection/line'] },
		{ id: 'two', show: ['b', 'connection/line'], target: { b: { ring: '#ff0000' } } },
		{ id: 'three', target: { b: { x: 100, ring: null }, 'row/a/*': { fill: '#00ff00' } } },
	],
	...extra,
});
const targetSet = {
	keyList: ['node/a', 'row/a/r1', 'row/a/r2', 'node/b', 'connection/line'],
	connectionEndByKey: { 'connection/line': ['node/a', 'node/b'] },
};

test('a document: a chain is assumed, what names nothing is refused with its name', () => {
	const spec = animationNormalize(documentCreate());
	assert.deepEqual(spec.transitionList.map((item) => item.id), ['one->two', 'two->three']);
	assert.equal(spec.stateIdInitial, 'three', 'a block starts at its last state, the most complete');
	assert.equal(animationNormalize(documentCreate({ initial: 'two' })).stateIdInitial, 'two');
	assert.equal(animationIsLinear(spec), true);
	assert.throws(() => animationNormalize({ stateList: [] }), /needs "diagram"/);
	assert.throws(() => animationNormalize(documentCreate({ stateList: [{ id: 'x' }, { id: 'x' }] })), /Two states have the id "x"/);
	assert.throws(() => animationNormalize(documentCreate({ transitionList: [{ from: 'one', to: 'nowhere' }] })), /to "nowhere" is not a state/);
	assert.throws(() => animationNormalize(documentCreate({ other: 1 })), /unknown key "other"/);
	assert.throws(() => animationNormalize(documentCreate({ transitionList: [{ from: 'one', to: 'two', trackList: [{ target: 'b', ease: 'wobble' }] }] })), /ease must be/);
});

test('a node reuses a fragment: its own keys over it, data merged', () => {
	const spec = animationNormalize(documentCreate({
		diagram: { nodes: [{ id: 'x', use: 'card', position: { x: 1, y: 2 }, data: { title: 'Own' } }] },
		nodeDefineById: { card: { renderer: { type: 'card-note' }, data: { title: 'Shared', tone: 'blue' } } },
	}));
	assert.deepEqual(spec.diagram.nodes[0], { id: 'x', renderer: { type: 'card-note' }, position: { x: 1, y: 2 }, data: { title: 'Own', tone: 'blue' } });
	assert.throws(() => animationNormalize(documentCreate({ diagram: { nodes: [{ id: 'x', use: 'none' }] } })), /use "none" is not in nodeDefineById/);
});

test('targets: a word is a node, "*" a step, what matches nothing is refused', () => {
	assert.deepEqual(animationPatternMatch('b', targetSet.keyList), ['node/b']);
	assert.deepEqual(animationPatternMatch('row/a/*', targetSet.keyList), ['row/a/r1', 'row/a/r2']);
	assert.equal(animationPatternMatch('*', targetSet.keyList).length, 5);
	assert.throws(() => animationPatternMatch('node/none', targetSet.keyList), /names nothing/);
});

test('a state lies over its base; a hidden line is undrawn, shown it is drawn', () => {
	const spec = animationNormalize(documentCreate());
	const sceneById = animationSceneListBuild(spec, targetSet);
	assert.deepEqual(sceneById.get('one').propByKey, { 'node/b': { opacity: 0 }, 'connection/line': { opacity: 0, progress: 0 } });
	assert.deepEqual(sceneById.get('two').propByKey['connection/line'], { opacity: 1, progress: 1 });
	assert.equal(sceneById.get('three').propByKey['node/b'].opacity, 1, 'kept from its base');
	assert.equal(sceneById.get('three').propByKey['row/a/r2'].fill, '#00ff00');
	assert.deepEqual(animationPositionOffsetGet(sceneById.get('three')), { b: { x: 100, y: 0 } });
	const specWrong = animationNormalize(documentCreate({ stateList: [{ id: 'one', target: { b: { width: 3 } } }] }));
	assert.throws(() => animationSceneListBuild(specWrong, targetSet), /node\/b has no property "width"/);
});

test('a transition: its frames end exactly on the state it goes to; tracks and stagger set when', () => {
	const spec = animationNormalize(documentCreate({
		fps: 10,
		transitionList: [{ from: 'one', to: 'two', trackList: [
			{ target: 'b', at: 0.5, second: 0.5 },
			{ target: 'connection/line', at: 0, second: 0.5 },
			{ token: 'line', at: 0.2, second: 0.4, count: 2, gap: 0.1 },
		] }],
	}));
	const sceneById = animationSceneListBuild(spec, targetSet);
	const compiled = animationTransitionCompile(spec, spec.transitionList[0], targetSet);
	assert.equal(compiled.frameCount, 11);
	assert.deepEqual(compiled.tokenList.map((token) => token.frameStart), [2, 3]);
	const sceneAt = (frame) => animationSceneAtFrame(sceneById.get('one'), sceneById.get('two'), compiled, frame, spec.fps).propByKey;
	assert.equal(sceneAt(0)['node/b'].opacity, 0);
	assert.equal(sceneAt(4)['node/b'].opacity, 0, 'its track has not begun');
	assert.equal(sceneAt(5)['connection/line'].progress, 1, 'its track has ended');
	assert.equal(sceneAt(10)['node/b'].opacity, 1);
	assert.equal(sceneAt(10)['node/b'].ring, '#ff0000');
	const staggered = animationTransitionCompile(spec, { id: 's', trackList: [{ target: ['a', 'b'], at: 0, second: 0.2, stagger: 0.3, ease: 'linear', patternList: ['a', 'b'] }] }, targetSet);
	assert.deepEqual([staggered.timingByKey['node/a'].frameStart, staggered.timingByKey['node/b'].frameStart], [0, 3]);
	assert.throws(() => animationTransitionCompile(spec, { id: 's', trackList: [{ token: 'none', at: 0, patternList: [] }] }, targetSet), /token "none" is not a connection/);
});

test('between two states: the shortest way, or none; a plan lays its transitions end to end', () => {
	const spec = animationNormalize(documentCreate({
		transitionList: [{ from: 'one', to: 'two' }, { from: 'two', to: 'three' }, { from: 'three', to: 'one' }],
	}));
	assert.equal(animationIsLinear(spec), false);
	assert.deepEqual(animationPathFind(spec, 'one', 'three').map((item) => item.id), ['one->two', 'two->three']);
	assert.deepEqual(animationPathFind(spec, 'three', 'two').map((item) => item.id), ['three->one', 'one->two']);
	assert.deepEqual(animationPathFind(spec, 'one', 'one'), []);
	const specCut = animationNormalize(documentCreate({ transitionList: [{ from: 'one', to: 'two' }] }));
	assert.equal(animationPathFind(specCut, 'two', 'one'), null);
	const compiledById = new Map(spec.transitionList.map((item) => [item.id, animationTransitionCompile(spec, item, targetSet)]));
	const plan = animationPlanBuild(compiledById, animationPathFind(spec, 'one', 'three'), 'one');
	assert.equal(plan.segmentList[1].frameStart, plan.segmentList[0].frameCount);
	assert.equal(plan.stateIdTo, 'three');
	assert.equal(animationPlanBuild(compiledById, [], 'two').frameTotal, 1);
	const graph = animationControlGraphBuild(spec);
	assert.equal(graph.lineList.length, 3);
	assert.ok(graph.lineList.find((line) => line.transition.to === 'one').isBack, 'a line back goes under the states');
});

test('a scene as css: under the scope of its block; a line fades with its ends and is drawn part way', () => {
	const scene = { propByKey: {
		'node/a': { opacity: 0.5, ring: '#ff0000', scale: 1.1 },
		'node/b': { opacity: 0 },
		'row/a/r1': { fill: '#00ff00' },
		'connection/line': { opacity: 1, progress: 0.25, stroke: '#0000ff' },
	} };
	const text = animationSceneStyleBuild(scene, '.x', targetSet, () => 100);
	assert.match(text, /\.x \.react-flow__node\[data-id="a"\]\{opacity:0\.5\}/);
	assert.match(text, /\.x \.react-flow__node\[data-id="b"\]\{opacity:0;visibility:hidden\}/);
	assert.match(text, /\[data-row-id="r1"\]\{background:#00ff00\}/);
	assert.match(text, /\.x \.react-flow__edge\[data-id="line"\]\{opacity:0;visibility:hidden\}/, 'an end is hidden');
	const textShown = animationSceneStyleBuild({ propByKey: { 'connection/line': { progress: 0.25 } } }, '.x', targetSet, () => 100);
	assert.match(textShown, /stroke-dashoffset:75/);
	assert.match(textShown, /marker-end:none/);
});

test('the camera glides: its ends are the two views', () => {
	const box = { width: 400, height: 200 };
	const from = { x: 0, y: 0, zoom: 1 };
	const to = { x: -100, y: -50, zoom: 2 };
	assert.deepEqual(animationViewBetween(from, to, 0, box), from);
	const end = animationViewBetween(from, to, 1, box);
	assert.ok(Math.abs(end.x - to.x) < 1e-6 && Math.abs(end.y - to.y) < 1e-6 && Math.abs(end.zoom - to.zoom) < 1e-6);
	assert.ok(Math.abs(animationViewBetween(from, to, 0.5, box).zoom - Math.SQRT2) < 1e-6);
});
