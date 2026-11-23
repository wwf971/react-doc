import test from 'node:test';
import assert from 'node:assert/strict';
import { PathNavHistory, PathNavStore, pathNavBuild, pathNavChain, pathNavParent } from './PathNav.js';

// a tree whose root is '/': / holds /a and /b, /a holds /a/x; /a/gap is no place, /a/gap/y is
const provider = (pathList) => ({
	root: '/',
	isFound: (path) => pathList.includes(path),
	labelGet: (path) => (path === '/' ? 'Top' : path.split('/').pop()),
	childListGet: (path) => pathList.filter((one) => one !== path && pathNavParent(one, '/') === path).map((one) => ({ path: one, label: one })),
});

test('the chain of a path starts at / when / is the root', () => {
	assert.deepEqual(pathNavChain('/a/x', '/'), ['/', '/a', '/a/x']);
	assert.deepEqual(pathNavChain('/', '/'), ['/']);
	assert.deepEqual(pathNavChain('/overview/db'), ['/overview', '/overview/db'], 'a root of its own: as the switch layer reads it');
	assert.equal(pathNavParent('/a', '/'), '/');
	assert.equal(pathNavParent('/a'), '', 'nothing above the top without a root /');
	assert.equal(pathNavParent('/', '/'), '');
});

test('the history: back, forward, and a new way forgetting what lay forward', () => {
	const history = new PathNavHistory();
	history.visit('/a');
	history.visit('/b');
	assert.equal(history.backTake('/c'), '/b');
	assert.deepEqual([history.historyList, history.forwardList], [['/a'], ['/c']]);
	assert.equal(history.forwardTake('/b'), '/c');
	assert.deepEqual([history.historyList, history.forwardList], [['/a', '/b'], []]);
	history.backTake('/c');
	history.visit('/b');
	assert.deepEqual(history.forwardList, [], 'a new way forgets it');
	assert.equal(new PathNavHistory().backTake('/a'), '', 'nothing to go back to');
});

test('a view walks its tree: segments, up past a folder that is no place, back and forward', () => {
	const tree = provider(['/', '/a', '/b', '/a/x', '/a/gap/y']);
	const store = new PathNavStore({ path: '/' });
	let nav = pathNavBuild(store, tree);
	assert.deepEqual([nav.pathChain, nav.pathUp, nav.isBackPossible], [['/'], '', false]);
	assert.equal(nav.pathSet('/nowhere'), false, 'a path naming no place goes nowhere');
	nav.pathSet('/a/gap/y');
	nav = pathNavBuild(store, tree);
	assert.deepEqual(nav.pathChain, ['/', '/a', '/a/gap', '/a/gap/y']);
	assert.equal(nav.pathUp, '/a', 'the nearest folder above that is a place: /a/gap is not');
	assert.deepEqual(nav.siblingListGet('/a').map((one) => one.path), ['/a', '/b'], 'the places beside a segment');
	nav.up();
	nav = pathNavBuild(store, tree);
	assert.equal(nav.pathCurrent, '/a');
	nav.back();
	nav = pathNavBuild(store, tree);
	assert.equal(nav.pathCurrent, '/a/gap/y', 'going up can be gone back on');
	assert.equal(nav.isForwardPossible, true);
	nav.forward();
	assert.equal(pathNavBuild(store, tree).pathCurrent, '/a');
});

test('a place that is gone shows the nearest place above it', () => {
	const store = new PathNavStore({ path: '/a/x' });
	assert.equal(pathNavBuild(store, provider(['/', '/a'])).pathCurrent, '/a', 'a paper removed: its folder');
	assert.equal(pathNavBuild(store, provider(['/'])).pathCurrent, '/');
	assert.equal(pathNavBuild(new PathNavStore(), provider(['/', '/a'])).pathCurrent, '/', 'no path yet: the root');
});
