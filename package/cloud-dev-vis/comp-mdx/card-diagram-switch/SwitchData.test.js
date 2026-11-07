import test from 'node:test';
import assert from 'node:assert/strict';
import {
	SWITCH_STACK_ITEM_SCALE_MAX, SWITCH_TAB_HEADER_HEIGHT, switchBoxClipBuild, switchCameraBetween, switchCameraChildOf, switchCameraFit, switchCameraParentOf, switchDocNormalize, switchEmbedMapBuild, switchMaskClipBuild, switchMorphBuild, switchMorphFrameAt,
	switchPathChain, switchPathHashRead, switchPathNormalize, switchPathParent, switchProviderFromDoc, switchRouteFind, switchStackItemLayout, switchStepSecondGet, switchTabsApply } from './SwitchData.js';
import { SWITCH_EMBED_CHROME_HEIGHT, switchEmbedCardRectOf, switchViewFrameIsHidden } from './SwitchData.js';
import { switchPathViewBuild, switchPathViewRead, switchViewHoverResolve, switchViewListCheck, switchViewListOf, switchViewResolve, switchViewSwitcherIsShown } from './SwitchData.js';
import { cardDatabaseFontSizeOf } from '../card-diagram/CompactCard.jsx';
import { cardMatrixCellOf, cardMatrixNormalize, cardMatrixWidthGet } from '../card-diagram/CardMatrixData.js';
import { switchPresentationBuild, switchStackFrameIsVisible, switchStackHeightIsFull, switchStackPresentationBuild, switchStackTitleBarNormalize, switchStackTitleBarRead } from './SwitchData.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SceneStackTitleBar, sceneStackNodeKind, switchRegistryBuild } from './SwitchNodeKinds.jsx';
import { SwitchStore } from './SwitchStore.js';
import { cardDiagramNodeRegistry } from '../card-diagram/card-diagram-node-registry.js';
import { ColorBlock, colorBlockNormalize } from '../card-diagram/ColorBlock.jsx';
import { StoreContext } from '../../../../main/frontend/src/store/context.js';
import { DiagramRenderContext } from '../card-diagram/DiagramRender.jsx';
import { switchDependenciesCollect } from './SwitchSource.js';
import { SwitchStaticScene } from './SwitchStatic.jsx';

test('base color blocks validate bottom labels and stay behind ordinary cards', () => {
	const data = { tone: 'blue', itemList: [{ id: 'db', icon: 'database', text: 'Source' }, { id: 'note', text: 'PW' }] };
	assert.equal(colorBlockNormalize(data), data);
	assert.throws(() => colorBlockNormalize({ itemList: [{ id: 'same', text: 'One' }, { id: 'same', text: 'Two' }] }), /unique/);
	assert.throws(() => colorBlockNormalize({ itemList: [{ id: 'bad', icon: 'unknown' }] }), /icon/);
	const block = { id: 'area', renderer: { type: 'color-block' }, position: { x: -20, y: -20 }, size: { width: 400, height: 300 }, data };
	const card = { id: 'card', renderer: { type: 'card-note' }, data: { title: 'Foreground' } };
	const registry = switchRegistryBuild(cardDiagramNodeRegistry);
	const store = new SwitchStore({ provider: { root: '/', sceneGet: () => ({ diagram: { nodes: [card, block] } }) }, registry });
	assert.equal(store.loadError, '');
	const nodes = store.entryGet('/').canvas.nodeList;
	assert.ok(nodes.find(node => node.id === 'area').zIndex < nodes.find(node => node.id === 'card').zIndex);
	const html = renderToStaticMarkup(createElement(ColorBlock, { node: block }));
	assert.match(html, /Source/);
	assert.match(html, /PW/);
	assert.equal((html.match(/class="doc-color-block-label"/g) ?? []).length, 2);
});

test('direct stacks share scroll state across scenes while keeping geometry and other stacks independent', () => {
	const node = { id: 'report', renderer: { type: 'scene-stack' }, data: { focusPath: '/report', itemList: [] }, size: { width: 300, height: 200 } };
	const independent = { ...node, id: 'independent', data: { itemList: [] } };
	const provider = { root: '/overview', sceneGet: () => ({ diagram: { nodes: [node, independent], connections: [] } }) };
	const store = new SwitchStore({ provider, registry: switchRegistryBuild({ id: 'test', kindList: [] }) });
	const overview = store.stackKey('/overview', 'report');
	const focused = store.stackKey('/report', 'report');
	const elementOverview = { scrollTop: 0 };
	const elementFocused = { scrollTop: 0 };
	store.stackElementAdd(overview, elementOverview);
	store.stackScrollSet(overview, 120);
	store.stackElementAdd(focused, elementFocused);
	assert.equal(elementFocused.scrollTop, 120);
	store.stackScrollSet(focused, 180);
	assert.equal(elementOverview.scrollTop, 180);
	assert.equal(store.stackScrollGet(overview), 180);
	store.stackAreaSet(overview, { width: 300 });
	store.stackAreaSet(focused, { width: 800 });
	assert.equal(store.stackAreaByKey.get(overview).width, 300);
	assert.equal(store.stackAreaByKey.get(focused).width, 800);
	store.plan = { steps: [] };
	store.stackScrollReport(focused, { scrollTop: 178, clientHeight: 200, scrollHeight: 500, dataset: {} });
	assert.equal(store.stackScrollGet(overview), 180);
	store.plan = null;
	store.stackScrollReport(focused, { scrollTop: 100, clientHeight: 200, scrollHeight: 300, dataset: { isSettled: '1' } });
	assert.equal(store.stackScrollGet(overview), 180);
	store.stackScrollReport(focused, { scrollTop: 80, clientHeight: 200, scrollHeight: 300, dataset: {} });
	assert.equal(store.stackScrollGet(overview), 80);
	const keyIndependent = store.stackKey('/overview', 'independent');
	store.stackScrollSet(keyIndependent, 40);
	assert.equal(store.stackScrollGet(store.stackKey('/report', 'independent')), 0);
	assert.equal(store.stackScrollGet(overview), 80);
});

test('a direct stack focus path determines presentation and its focused frame defaults to visible', () => {
	const data = { focusPath: '/report' };
	const overview = switchStackPresentationBuild(data, switchPresentationBuild('/overview'));
	const focused = switchStackPresentationBuild(data, switchPresentationBuild('/report'));
	assert.equal(overview.isEmbedded, true);
	assert.equal(focused.isFocused, true);
	assert.equal(switchStackFrameIsVisible(data, focused), true);
	assert.equal(switchStackFrameIsVisible({ ...data, isFrameVisibleFocused: false }, focused), false);
	assert.equal(switchStackFrameIsVisible({ ...data, isFrameVisibleFocused: false }, overview), true);
	assert.throws(() => sceneStackNodeKind.contract.dataNormalize({ itemList: [], focusPath: 1 }), /focusPath/);
	assert.throws(() => sceneStackNodeKind.contract.dataNormalize({ itemList: [], isFrameVisibleFocused: 'true' }), /isFrameVisibleFocused/);
	const html = renderToStaticMarkup(createElement(SceneStackTitleBar, { data: { titleBar: 'Report' }, nodeId: 'report', presentation: overview, onFocus: () => {} }));
	assert.match(html, /aria-label="Focus this container"/);
});

test('static root snapshots use focused titles while embedded copies hide them', () => {
	const node = { id: 'stack', renderer: { type: 'scene-stack' }, position: { x: 0, y: 0 }, size: { width: 300, height: 200 }, data: { titleBar: { text: 'Focused title', isVisibleEmbedded: false }, itemList: [] }, handles: [] };
	const store = { entryGet: () => ({ canvas: { graph: { nodes: [node], connections: [] } } }), entryPositionsGet: () => new Map(), stackKey: (path, id) => `${path}|${id}` };
	const context = { config: {}, registry: { kindByType: { 'scene-stack': sceneStackNodeKind } } };
	const render = (props = {}) => renderToStaticMarkup(createElement(DiagramRenderContext.Provider, { value: context }, createElement(SwitchStaticScene, { store, path: '/report', ...props })));
	assert.match(render(), /Focused title/);
	assert.match(render(), /data-presentation="focused"/);
	assert.doesNotMatch(render({ isEmbedded: true }), /Focused title/);
	assert.match(render({ isEmbedded: true }), /data-presentation="embedded"/);
});

test('custom title items use the registry placement, data and presentation context', () => {
	let received;
	const stores = {
		compById: { Status: { placementList: ['visualizationTitle'], CompRender: (props) => { received = props; return createElement('button', null, `Count ${props.data.count}`); } } },
		compConfigHost: {}, configStore: { compConfigGet: () => ({}) }, docStore: { docCurrentPath: 'report.md' },
		sourceStore: { configDoc: {}, sourceService: {} }, envStore: { envService: {} },
	};
	const presentation = switchPresentationBuild('/report', true);
	const data = { titleBar: { itemList: [{ id: 'name', type: 'text', text: 'Report' }, { id: 'status', type: 'component', comp: 'Status', data: { count: 2 } }] } };
	const html = renderToStaticMarkup(createElement(StoreContext.Provider, { value: stores }, createElement(DiagramRenderContext.Provider, { value: { config: { instanceId: 'block' } } }, createElement(SceneStackTitleBar, { data, nodeId: 'stack', presentation }))));
	assert.match(html, /Report/);
	assert.match(html, /Count 2/);
	assert.equal(received.config.placement, 'visualizationTitle');
	assert.equal(received.config.instanceId, 'block:node:stack:title:status');
	assert.deepEqual(received.config.visualization.presentation, presentation);
	assert.equal(typeof received.onEvent, 'function');
});

test('switch dependencies include title components in nested stacks, even when hidden', () => {
	const stack = (comp, itemList = []) => ({ renderer: { type: 'scene-stack' }, data: { titleBar: { isVisibleEmbedded: false, isVisibleFocused: false, itemList: [{ id: 'status', type: 'component', comp, data: { file: 'report.md' } }] }, itemList } });
	const collected = [];
	switchDependenciesCollect({ sceneList: [{ diagram: { nodes: [stack('Outer', [{ id: 'nested', node: stack('Inner') }])] } }] }, { componentCollect: (...args) => collected.push(args), warn: (message) => assert.fail(message) });
	assert.deepEqual(collected, [['Outer', { file: 'report.md' }], ['Inner', { file: 'report.md' }]]);
});

test('stack title renderer respects presentation and renders plain text safely', () => {
	const data = { titleBar: { text: '<Report>', isVisibleEmbedded: false } };
	const render = (isEmbedded) => renderToStaticMarkup(createElement(SceneStackTitleBar, { data, nodeId: 'stack', presentation: switchPresentationBuild('/report', isEmbedded) }));
	assert.equal(render(true), '');
	assert.match(render(false), /&lt;Report&gt;/);
	assert.match(render(false), /nopan nodrag/);
	assert.throws(() => sceneStackNodeKind.contract.dataNormalize({ itemList: [], titleBar: { itemList: [{ id: 'bad', type: 'component' }] } }), /needs comp/);
});

test('stack titles choose visibility by presentation, independently of static rendering', () => {
	const focused = switchPresentationBuild('/report');
	const embedded = switchPresentationBuild('/report', true);
	assert.deepEqual(focused, { path: '/report', view: '', isEmbedded: false, isFocused: true, pathEmbedder: null });
	assert.deepEqual(embedded, { path: '/report', view: '', isEmbedded: true, isFocused: false, pathEmbedder: null });
	for (const isVisibleEmbedded of [false, true]) {
		for (const isVisibleFocused of [false, true]) {
			const data = { titleBar: { text: 'Report', isVisibleEmbedded, isVisibleFocused } };
			assert.equal(Boolean(switchStackTitleBarRead(data, embedded)), isVisibleEmbedded);
			assert.equal(Boolean(switchStackTitleBarRead(data, focused)), isVisibleFocused);
		}
	}
	assert.equal(switchStackTitleBarRead({ titleBar: 'Simple' }, focused).text, 'Simple');
	assert.equal(switchStackTitleBarRead({ title: 'Old' }, focused).isLegacy, true);
	assert.equal(switchStackTitleBarRead({ isChromeHidden: true }, focused), null);
	assert.equal(switchStackTitleBarRead({ isChromeHidden: true, titleBar: 'New' }, embedded).text, 'New');
});

test('complex stack titles validate text and registered component items', () => {
	const title = { itemList: [{ id: 'name', type: 'text', text: 'Report' }, { id: 'status', type: 'component', comp: 'Status', data: { count: 2 } }] };
	assert.equal(switchStackTitleBarNormalize(title), title);
	for (const invalid of [null, [], { text: 1 }, { text: 'x', itemList: [] }, { isVisibleFocused: 'false' }, { itemList: {} }, { itemList: [{ id: 'x', type: 'unknown' }] }, { itemList: [{ id: 'x', type: 'component' }] }, { itemList: [{ id: 'x', type: 'text', text: 'X' }, { id: 'x', type: 'text', text: 'Y' }] }]) {
		assert.throws(() => switchStackTitleBarNormalize(invalid), /titleBar/);
	}
});

test('a path is read from the root, its folders listed', () => {
	assert.equal(switchPathNormalize('a//b/'), '/a/b');
	assert.equal(switchPathParent('/a/b'), '/a');
	assert.equal(switchPathParent('/a'), '');
	assert.deepEqual(switchPathChain('/a/b/c'), ['/a', '/a/b', '/a/b/c']);
});

test('a document refuses what cannot be drawn, naming it', () => {
	assert.throws(() => switchDocNormalize({ version: 1, sceneList: [] }), /sceneList/);
	assert.throws(() => switchDocNormalize({ version: 1, sceneList: [{ path: '/a' }] }), /\/a needs one of a diagram, tabs or a viewList/);
	assert.throws(() => switchDocNormalize({ version: 1, sceneList: [{ path: '/a', diagram: {} }, { path: '/a', diagram: {} }] }), /written twice/);
	assert.throws(() => switchDocNormalize({ version: 1, sceneList: [{ path: '/a', diagram: {}, box: { x: 0, y: 0, width: 0, height: 1 } }] }), /\/a\.box/);
});

const member = (id) => ({ id, renderer: { type: 'card-note' }, position: { x: 0, y: 500 }, handles: [{ id: 'in', direction: 'in', anchor: { side: 'top' } }, { id: 'out', direction: 'out', anchor: { side: 'right' } }] });
const diagramBase = {
	nodes: [{ id: 'tool', renderer: { type: 'card-note' }, position: { x: 0, y: 0 }, handles: [{ id: 'out', direction: 'out', anchor: { side: 'bottom' } }] }, member('a'), member('b'), member('c')],
	connections: [
		{ id: 'tool-a', source: { nodeId: 'tool', handleId: 'out' }, target: { nodeId: 'a', handleId: 'in' } },
		{ id: 'tool-b', source: { nodeId: 'tool', handleId: 'out' }, target: { nodeId: 'b', handleId: 'in' } },
		{ id: 'a-b', source: { nodeId: 'a', handleId: 'out' }, target: { nodeId: 'b', handleId: 'in' } },
		{ id: 'b-c', source: { nodeId: 'b', handleId: 'out' }, target: { nodeId: 'c', handleId: 'in' } },
	],
};
const tabs = { id: 'tabs', memberList: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], position: { x: 10, y: 400 }, size: { width: 800, height: 600 } };

test('tabs rewire a line to the tab of a member that left, and drop no line', () => {
	const diagram = switchTabsApply(diagramBase, tabs, 'a', '/scene');
	assert.deepEqual(diagram.nodes.map((node) => node.id).sort(), ['a', 'tabs', 'tool']);
	const focused = diagram.nodes.find((node) => node.id === 'a');
	assert.deepEqual(focused.position, { x: 10, y: 400 + SWITCH_TAB_HEADER_HEIGHT });
	assert.deepEqual(focused.size, { width: 800, height: 600 });
	const byId = new Map(diagram.connections.map((connection) => [connection.id, connection]));
	assert.equal(diagram.connections.length, 4);
	assert.deepEqual(byId.get('tool-a').target, { nodeId: 'a', handleId: 'in' });
	assert.deepEqual(byId.get('tool-b').target, { nodeId: 'tabs', handleId: 'tab:b:top' });
	assert.equal(byId.get('a-b').source.nodeId, 'a');
	assert.equal(byId.get('a-b').target.nodeId, 'tabs');
	// both ends left: a dashed line between their tabs
	assert.deepEqual([byId.get('b-c').source.nodeId, byId.get('b-c').target.nodeId], ['tabs', 'tabs']);
	assert.equal(byId.get('b-c').style.strokeDasharray, '4 4');
	const header = diagram.nodes.find((node) => node.id === 'tabs');
	assert.equal(header.data.focus, 'a');
	assert.equal(header.data.tabList[1].link, '/scene/b');
	for (const connection of diagram.connections) {
		for (const end of [connection.source, connection.target]) {
			if (end.nodeId === 'tabs') assert.ok(header.handles.some((handle) => handle.id === end.handleId), end.handleId);
		}
	}
});

test('a scene with tabs has a scene per tab below its path', () => {
	const spec = switchDocNormalize({ version: 1, sceneList: [{ path: '/scene', diagram: diagramBase }, { path: '/scene/tabs', tabs: { ...tabs, of: '/scene' } }] });
	const provider = switchProviderFromDoc(spec);
	assert.deepEqual(provider.childListGet('/scene/tabs').map((item) => item.path), ['/scene/tabs/a', '/scene/tabs/b', '/scene/tabs/c']);
	assert.equal(provider.sceneGet('/scene/tabs/b').diagram.nodes.find((node) => node.id === 'tabs').data.focus, 'b');
	assert.equal(provider.labelGet('/scene/tabs/c'), 'C');
	assert.equal(provider.sceneGet('/nothing'), null);
});

test('a camera fits a box, stopping at its zoom limit', () => {
	const camera = switchCameraFit({ x: 100, y: 0, width: 1000, height: 500 }, { width: 1000, height: 1000 }, { padding: 0 });
	assert.equal(camera.zoom, 1);
	assert.equal(camera.x, -100);
	assert.equal(camera.y, 250);
	assert.equal(switchCameraFit({ x: 0, y: 0, width: 10, height: 10 }, { width: 1000, height: 1000 }, { zoomMax: 1.25 }).zoom, 1.25);
});

test('the camera of the parent draws an embedded scene exactly where its own camera would', () => {
	const body = { x: 300, y: 200, width: 400, height: 300 };
	const box = { x: -50, y: 20, width: 800, height: 300 };
	const map = switchEmbedMapBuild(body, box);
	assert.ok(Math.abs(map.scale - 0.47) < 1e-9);
	const cameraChild = { x: 37, y: -11, zoom: 0.8 };
	const cameraParent = switchCameraParentOf(cameraChild, body, map);
	for (const point of [{ x: -50, y: 20 }, { x: 750, y: 320 }, { x: 13, y: 77 }]) {
		const inParent = { x: body.x + map.tx + point.x * map.scale, y: body.y + map.ty + point.y * map.scale };
		const screenParent = { x: cameraParent.x + inParent.x * cameraParent.zoom, y: cameraParent.y + inParent.y * cameraParent.zoom };
		const screenChild = { x: cameraChild.x + point.x * cameraChild.zoom, y: cameraChild.y + point.y * cameraChild.zoom };
		assert.ok(Math.abs(screenParent.x - screenChild.x) < 1e-9);
		assert.ok(Math.abs(screenParent.y - screenChild.y) < 1e-9);
	}
});

test('between two cameras everything moves away from one fixed point', () => {
	const from = { x: 0, y: 0, zoom: 1 };
	const to = { x: -300, y: -100, zoom: 4 };
	assert.deepEqual(switchCameraBetween(from, to, 0), from);
	assert.deepEqual(switchCameraBetween(from, to, 1), to);
	const middle = switchCameraBetween(from, to, 0.5);
	assert.ok(Math.abs(middle.zoom - 2) < 1e-9);
	// the fixed point: world (100, 33.3..) is at the same place of the screen
	const worldX = 100;
	assert.ok(Math.abs((middle.x + worldX * middle.zoom) - (from.x + worldX * from.zoom)) < 1e-9);
});

test('the way between scenes: a portal, a morph, out and in through a common scene', () => {
	const embedByPair = { '/p|/c1': { id: 'e1' }, '/p|/c2': { id: 'e2' } };
	const options = {
		embedOf: (parent, child) => embedByPair[`${parent}|${child}`],
		isShared: (a, b) => a === '/m1' && b === '/m2',
		embedderOf: (path) => (path === '/c1' || path === '/c2' ? '/p' : ''),
	};
	assert.deepEqual(switchRouteFind('/p', '/p', options), []);
	assert.deepEqual(switchRouteFind('/p', '/c1', options), [{ type: 'portal', direction: 'in', parent: '/p', child: '/c1', nodeId: 'e1' }]);
	assert.deepEqual(switchRouteFind('/c1', '/p', options), [{ type: 'portal', direction: 'out', parent: '/p', child: '/c1', nodeId: 'e1' }]);
	assert.deepEqual(switchRouteFind('/m1', '/m2', options), [{ type: 'morph', from: '/m1', to: '/m2' }]);
	const chain = switchRouteFind('/c1', '/c2', options);
	assert.deepEqual(chain.map((step) => [step.direction, step.child]), [['out', '/c1'], ['in', '/c2']]);
	assert.deepEqual(switchRouteFind('/x', '/y', options), [{ type: 'morph', from: '/x', to: '/y' }]);
});

const flowNode = (id, x, data = {}, handles = []) => ({ id, type: 'visualizationNode', position: { x, y: 0 }, data: { node: { id, renderer: { type: 'table' }, data, handles, size: { width: 100, height: 'auto' } } } });
const flowEdge = (id, source, target) => ({ id, source, target, sourceHandle: 'a', targetHandle: 'b', data: { connection: { label: { text: '' } } } });

test('a morph moves what both scenes have, fades the rest, and keeps the handles of both', () => {
	const morph = switchMorphBuild({
		nodeListFrom: [flowNode('same', 0, { a: 1 }, [{ id: 'h1' }]), flowNode('gone', 50), flowNode('changed', 10, { v: 1 })],
		edgeListFrom: [flowEdge('line', 'same', 'gone'), flowEdge('keep', 'same', 'changed')],
		nodeListTo: [flowNode('same', 200, { a: 1 }, [{ id: 'h2' }]), flowNode('new', 90), flowNode('changed', 20, { v: 2 })],
		edgeListTo: [flowEdge('line', 'same', 'new'), flowEdge('keep', 'same', 'changed')],
	});
	const roleOf = (id) => morph.itemList.find((item) => item.flow.id === id).role;
	assert.equal(roleOf('same'), 'same');
	assert.equal(roleOf('gone'), 'out');
	assert.equal(roleOf('new'), 'in');
	assert.equal(roleOf('~from:changed'), 'out');
	assert.equal(roleOf('changed'), 'in');
	assert.deepEqual(morph.itemList.find((item) => item.flow.id === 'same').flow.data.node.handles.map((handle) => handle.id), ['h2', 'h1']);
	const edgeOf = (id) => morph.edgeItemList.find((item) => item.flow.id === id);
	assert.equal(edgeOf('~from:line').role, 'out');
	assert.equal(edgeOf('line').role, 'in');
	// the line of a card replaced follows the card that leaves
	assert.equal(edgeOf('~from:keep').flow.target, '~from:changed');
	const frame = switchMorphFrameAt(morph, 0.5);
	assert.equal(frame.moveList.find((move) => move.id === 'same').x, 100);
	assert.equal(switchMorphFrameAt(morph, 0).fadeOut, 1);
	assert.equal(switchMorphFrameAt(morph, 1).fadeIn, 1);
});

test('an embedded scene keeps a margin inside its card, or the one written', () => {
	const box = { x: 0, y: 0, width: 100, height: 100 };
	const body = { width: 100, height: 100 };
	const map = switchEmbedMapBuild(body, box);
	assert.ok(map.tx > 0 && map.ty > 0, 'nothing of the scene touches the border of the card');
	assert.deepEqual(switchEmbedMapBuild(body, box, 0), { scale: 1, tx: 0, ty: 0 });
});

test('an item of a stack holds its scene at the width of the item, however tall that is', () => {
	const box = { x: 10, y: 20, width: 400, height: 2000 };
	const { height, map } = switchStackItemLayout(800, box, 0.05);
	assert.equal(map.scale, Math.min(SWITCH_STACK_ITEM_SCALE_MAX, 720 / 400));
	assert.equal(height, 2000 * map.scale + 80);
	assert.equal(map.ty, 40 - 20 * map.scale);
	// a small scene does not grow past the limit: it is centered
	const small = switchStackItemLayout(800, { x: 0, y: 0, width: 100, height: 50 }, 0);
	assert.equal(small.map.scale, SWITCH_STACK_ITEM_SCALE_MAX);
	assert.equal(small.map.tx, (800 - 100 * SWITCH_STACK_ITEM_SCALE_MAX) / 2);
});

test('the camera of a child and of its parent are inverse', () => {
	const body = { x: 30, y: 70, width: 200, height: 100 };
	const map = { scale: 0.5, tx: 4, ty: 8 };
	const child = { x: 12, y: -40, zoom: 1.5 };
	const round = switchCameraChildOf(switchCameraParentOf(child, body, map), body, map);
	for (const key of ['x', 'y', 'zoom']) assert.ok(Math.abs(round[key] - child[key]) < 1e-9, key);
});

test('a path may name an item of a stack; a scroll is a step of its own', () => {
	assert.deepEqual(switchPathHashRead('/a/b#item'), { path: '/a/b', itemId: 'item' });
	assert.deepEqual(switchPathHashRead('/a/'), { path: '/a', itemId: '' });
	assert.ok(switchStepSecondGet({ type: 'scroll' }) > 0);
	assert.equal(switchStepSecondGet({ type: 'scroll' }, { secondScroll: 2 }), 2);
});

test('the way into an item names it; its mask opens from the part in view to the viewport', () => {
	const options = { embedOf: (parent, child) => (parent === '/p' && child === '/c' ? { id: 'stack', itemId: 'i1' } : undefined), isShared: () => false, embedderOf: () => '' };
	assert.deepEqual(switchRouteFind('/p', '/c', options), [{ type: 'portal', direction: 'in', parent: '/p', child: '/c', nodeId: 'stack', itemId: 'i1' }]);
	const rect = { x: 100, y: 50, width: 200, height: 100 };
	const viewport = { width: 1000, height: 500 };
	assert.equal(switchMaskClipBuild(rect, viewport, 0), 'inset(50.0px 700.0px 350.0px 100.0px)');
	assert.equal(switchMaskClipBuild(rect, viewport, 1), 'inset(0.0px 0.0px 0.0px 0.0px)');
});

test('a chosen box clips the world to it, with a margin a portal opens', () => {
	const clip = switchBoxClipBuild({ x: 10, y: 20, width: 100, height: 50 });
	assert.match(clip, /^inset\(calc\(20px - var\(--doc-switch-open, 0px\)\) calc\(-110px - /);
	assert.match(clip, /calc\(-70px - var\(--doc-switch-open, 0px\)\) calc\(10px - /);
});

test('a stack at full height: by presentation, what is chosen first, a node as tall as its items', () => {
	const embedded = switchPresentationBuild('/', true);
	const focused = switchPresentationBuild('/');
	assert.equal(switchStackHeightIsFull({}, focused), false);
	assert.equal(switchStackHeightIsFull({ isHeightFullFocused: true }, focused), true);
	assert.equal(switchStackHeightIsFull({ isHeightFullFocused: true }, embedded), false);
	assert.equal(switchStackHeightIsFull({ isHeightFullEmbedded: true }, embedded), true);
	assert.equal(switchStackHeightIsFull({ isHeightFullEmbedded: true }, embedded, false), false);
	assert.equal(switchStackHeightIsFull({}, focused, true), true);

	const stack = { id: 'report', renderer: { type: 'scene-stack' }, position: { x: 0, y: 0 }, size: { width: 500, height: 300 }, data: { focusPath: '/report', isHeightFullFocused: true, itemList: [] }, handles: [] };
	const sceneByPath = { '/': { nodes: [stack] }, '/report': { nodes: [stack] } };
	const provider = { root: '/', sceneGet: (path) => (sceneByPath[path] ? { path, diagram: sceneByPath[path] } : null), labelGet: (path) => path, childListGet: () => [] };
	const store = new SwitchStore({ provider, registry: switchRegistryBuild({ id: 'test', kindList: [] }) });
	// the same node: scrolling where it is embedded, at full height in its own scene
	assert.equal(store.stackHeightIsFull({ path: '/', nodeId: 'report' }), false);
	assert.equal(store.stackHeightIsFull({ path: '/report', nodeId: 'report' }), true);
	const nodeOf = (path) => store.entryGet(path).canvas.graph.nodes[0];
	assert.equal(nodeOf('/').size.height, 300);
	assert.equal(nodeOf('/report').size.height, 'auto');
	// a stack at full height does not scroll, whatever position its other copy keeps
	const keyEmbedded = store.stackKey('/', 'report');
	const keyFocused = store.stackKey('/report', 'report');
	store.stackScrollSet(keyEmbedded, 80);
	assert.equal(store.stackScrollGet(keyEmbedded), 80);
	assert.equal(store.stackScrollGet(keyFocused), 0);
	// set by a program: for one presentation, the other keeps its own
	assert.equal(store.stackHeightFullSet({ path: '/', nodeId: 'report', isFull: true }), true);
	assert.equal(store.stackHeightIsFull({ path: '/', nodeId: 'report' }), true);
	assert.equal(nodeOf('/').size.height, 'auto');
	store.stackHeightFullSet({ path: '/report', nodeId: 'report', isFull: false });
	assert.equal(nodeOf('/report').size.height, 300);
	assert.equal(nodeOf('/').size.height, 'auto');
	assert.equal(store.stackHeightFullSet({ path: '/', nodeId: 'nothing', isFull: true }), false);
	// the written height is kept for going back
	store.stackHeightFullSet({ path: '/', nodeId: 'report', isFull: false });
	assert.equal(nodeOf('/').size.height, 300);
	// switched on the canvas: the camera is left where it is, and kept from being refitted;
	// the nodes keep what React Flow measured, or it would hide them until it measures again
	const cameraList = [];
	store.viewportApiSet({ viewportGet: () => ({ x: 12, y: 34, zoom: 0.5 }), viewportSet: (camera) => cameraList.push(camera) });
	store.isCameraReady = true;
	store.nodeListFlow = store.nodeListFlow.map((node) => ({ ...node, measured: { width: 560, height: 300 } }));
	store.stackHeightFullSet({ nodeId: 'report', path: store.pathCurrent, isFull: true });
	assert.deepEqual(store.cameraOf(store.pathCurrent), { x: 12, y: 34, zoom: 0.5 });
	store.measurementSet(store.pathCurrent, 'report', { width: 560, height: 900 });
	assert.deepEqual(cameraList, []);
	assert.equal(store.nodeListFlow.find((node) => node.id === 'report').measured.height, 300);
	store.viewportApiSet(null);
	assert.throws(() => sceneStackNodeKind.contract.dataNormalize({ itemList: [], isHeightFullFocused: 'yes' }), /isHeightFullFocused must be a boolean/);
});

test('an item of the menu may be more than words', () => {
	const provider = switchProviderFromDoc(switchDocNormalize({ version: 1, sceneList: [
		{ path: '/v', label: 'Root', diagram: { nodes: [] } },
		{ path: '/v/a', label: 'A', labelItemList: [{ type: 'icon', icon: 'database' }, { type: 'text', text: 'A' }], diagram: { nodes: [] } },
		{ path: '/v/b', label: 'B', diagram: { nodes: [] } },
	] }));
	const [a, b] = provider.childListGet('/v');
	assert.equal(a.labelItemList[0].icon, 'database');
	assert.equal(a.label, 'A');
	assert.equal(b.labelItemList, undefined);
});

// ---------- the views of a scene ----------

const twoViews = (extra = {}) => ({ path: '/er', viewList: [{ id: 'diagram', diagram: { nodes: [] } }, { id: 'matrix', diagram: { nodes: [] } }], ...extra });
const embeddedIn = (path) => switchPresentationBuild('/er', true, path);

test('a path may name a view of its scene, and an item after it', () => {
	assert.deepEqual(switchPathViewRead('/a/b@matrix'), { path: '/a/b', view: 'matrix' });
	assert.deepEqual(switchPathViewRead('/a/b'), { path: '/a/b', view: '' });
	assert.equal(switchPathViewBuild('/a/b', 'matrix'), '/a/b@matrix');
	assert.equal(switchPathViewBuild('/a/b', ''), '/a/b');
	assert.deepEqual(switchPathViewRead(switchPathHashRead('/a/b@matrix#item').path), { path: '/a/b', view: 'matrix' });
});

test('a presentation says which scene embeds it, not the parent in the tree of paths', () => {
	assert.deepEqual(switchPresentationBuild('/er@matrix', true, '/other@x'), { path: '/er', view: 'matrix', isEmbedded: true, isFocused: false, pathEmbedder: '/other' });
	assert.equal(switchPresentationBuild('/er', false, '/other').pathEmbedder, null);
	// a stack focused elsewhere: the scene it stands in embeds it
	const stack = switchStackPresentationBuild({ focusPath: '/report' }, switchPresentationBuild('/overview'));
	assert.deepEqual(stack, { path: '/report', view: '', isEmbedded: true, isFocused: false, pathEmbedder: '/overview' });
	assert.equal(switchStackPresentationBuild({ focusPath: '/report' }, switchPresentationBuild('/report')).isFocused, true);
});

test('the default view: unconditional, by rules on the presentation, or a function', () => {
	const focused = switchPresentationBuild('/er');
	assert.equal(switchViewResolve(twoViews(), focused), 'diagram', 'the first, without a default');
	assert.equal(switchViewResolve(twoViews({ viewDefault: 'matrix' }), focused), 'matrix');
	assert.equal(switchViewResolve(twoViews({ viewDefault: 'matrix' }), embeddedIn('/a')), 'matrix');
	const viewDefault = [
		{ when: { embedder: '/a' }, view: 'matrix' },
		{ when: { embedder: ['/b/*', '/c'] }, view: 'matrix' },
		{ when: { isFocused: true }, view: 'matrix' },
		{ view: 'diagram' },
	];
	const desc = twoViews({ viewDefault });
	assert.equal(switchViewResolve(desc, embeddedIn('/a')), 'matrix');
	assert.equal(switchViewResolve(desc, embeddedIn('/b/deep/er')), 'matrix');
	assert.equal(switchViewResolve(desc, embeddedIn('/b')), 'diagram', '/b/* is what lies below /b');
	assert.equal(switchViewResolve(desc, embeddedIn('/c')), 'matrix');
	assert.equal(switchViewResolve(desc, embeddedIn('/other')), 'diagram');
	assert.equal(switchViewResolve(desc, focused), 'matrix');
	assert.equal(switchViewResolve(twoViews({ viewDefault: (presentation) => (presentation.pathEmbedder === '/z' ? 'matrix' : 'diagram') }), embeddedIn('/z')), 'matrix');
});

test('a view not available in a presentation is not shown there, whoever asks', () => {
	const desc = twoViews({ viewDefault: 'matrix' });
	desc.viewList[1].isAvailableEmbedded = false;
	assert.equal(switchViewResolve(desc, embeddedIn('/a')), 'diagram');
	assert.equal(switchViewResolve(desc, embeddedIn('/a'), ['matrix']), 'diagram');
	assert.deepEqual(switchViewListOf(desc, embeddedIn('/a')).map((view) => view.id), ['diagram']);
	assert.deepEqual(switchViewListOf(desc, switchPresentationBuild('/er')).map((view) => view.id), ['diagram', 'matrix']);
	// a scene hiding them all still has something to show
	desc.viewList[0].isAvailableEmbedded = false;
	assert.equal(switchViewListOf(desc, embeddedIn('/a')).length, 2);
	// what is wanted goes first, in order
	assert.equal(switchViewResolve(twoViews({ viewDefault: 'diagram' }), switchPresentationBuild('/er'), ['', 'matrix', 'diagram']), 'matrix');
});

test('a document refuses views that cannot be drawn, naming them', () => {
	const docOf = (scene) => ({ version: 1, sceneList: [scene] });
	assert.throws(() => switchDocNormalize(docOf({ path: '/a', viewList: [] })), /\/a must list/);
	assert.throws(() => switchDocNormalize(docOf({ path: '/a', diagram: {}, viewList: [{ id: 'x', diagram: {} }] })), /one of a diagram/);
	assert.throws(() => switchDocNormalize(docOf({ path: '/a', viewList: [{ id: 'x' }] })), /view x of \/a needs a diagram/);
	assert.throws(() => switchDocNormalize(docOf({ path: '/a', viewList: [{ id: 'x', diagram: {} }, { id: 'x', diagram: {} }] })), /two views/);
	assert.throws(() => switchDocNormalize(docOf({ path: '/a', viewList: [{ id: 'x@y', diagram: {} }] })), /without spaces/);
	assert.throws(() => switchDocNormalize(docOf({ path: '/a', viewDefault: 'y', viewList: [{ id: 'x', diagram: {} }] })), /names a view it does not have: y/);
	assert.throws(() => switchDocNormalize(docOf({ path: '/a', viewDefault: [{ when: { parent: '/b' }, view: 'x' }], viewList: [{ id: 'x', diagram: {} }] })), /unknown condition: parent/);
	assert.throws(() => switchDocNormalize(docOf({ path: '/a@x', diagram: {} })), /has @ or #/);
	assert.throws(() => switchDocNormalize({ version: 1, sceneList: [{ path: '/a', viewList: [{ id: 'x', diagram: {} }] }, { path: '/b', tabs: { of: '/a', memberList: [{ id: '1' }, { id: '2' }], position: {}, size: {} } }] }), /\/a has views/);
});

test('the way: a portal goes to what the card shows, a morph to the view asked for', () => {
	const options = {
		embedOf: (parent, child) => (parent === '/p' && child.startsWith('/c') ? { id: 'card', path: '/c@card' } : undefined),
		isShared: () => false,
		embedderOf: (path) => (path.startsWith('/c') ? '/p' : ''),
	};
	assert.deepEqual(switchRouteFind('/p', '/c@card', options), [{ type: 'portal', direction: 'in', parent: '/p', child: '/c@card', nodeId: 'card' }]);
	assert.deepEqual(switchRouteFind('/p', '/c@focus', options), [
		{ type: 'portal', direction: 'in', parent: '/p', child: '/c@card', nodeId: 'card' },
		{ type: 'morph', from: '/c@card', to: '/c@focus' },
	]);
	assert.deepEqual(switchRouteFind('/c@focus', '/p', options), [
		{ type: 'morph', from: '/c@focus', to: '/c@card' },
		{ type: 'portal', direction: 'out', parent: '/p', child: '/c@card', nodeId: 'card' },
	]);
	assert.deepEqual(switchRouteFind('/c@card', '/c@focus', options), [{ type: 'morph', from: '/c@card', to: '/c@focus' }], 'two views of one scene, though something embeds it');
});

const viewStoreBuild = () => {
	const note = (id) => ({ nodes: [{ id, renderer: { type: 'card-note' }, position: { x: 0, y: 0 }, size: { width: 100, height: 40 }, data: { title: id } }] });
	const embed = (id, scene, data = {}) => ({ id, renderer: { type: 'scene-embed' }, position: { x: 0, y: 0 }, size: { width: 300, height: 200 }, data: { scene, ...data } });
	const sceneByPath = {
		'/a': { path: '/a', diagram: { nodes: [embed('card', '/er')] } },
		'/b': { path: '/b', diagram: { nodes: [embed('card', '/er')] } },
		'/c': { path: '/c', diagram: { nodes: [embed('card', '/er', { view: 'brief' })] } },
		'/plain': { path: '/plain', diagram: note('plain') },
		'/er': {
			path: '/er',
			viewList: [{ id: 'diagram', diagram: note('d') }, { id: 'matrix', diagram: note('m') }, { id: 'brief', diagram: note('r') }],
			viewDefault: [{ when: { embedder: '/b' }, view: 'brief' }, { when: { isEmbedded: true }, view: 'diagram' }, { view: 'matrix' }],
		},
	};
	const provider = { root: '/a', sceneGet: (path) => sceneByPath[path] ?? null, labelGet: (path) => path, childListGet: () => [] };
	return new SwitchStore({ provider, registry: switchRegistryBuild(cardDiagramNodeRegistry) });
};

test('a store: what a scene shows depends on how it is presented, and each draws its own diagram', () => {
	const store = viewStoreBuild();
	assert.equal(store.pathFocusedOf('/er'), '/er@matrix');
	assert.equal(store.pathFocusedOf('/er@brief'), '/er@brief');
	assert.equal(store.pathFocusedOf('/plain'), '/plain');
	assert.equal(store.embedPathOf('/a', '/er'), '/er@diagram');
	assert.equal(store.embedPathOf('/b@x', '/er'), '/er@brief');
	assert.equal(store.embedPathOf('/a', '/er', 'brief'), '/er@brief', 'what the embedding asks for goes before the default');
	assert.equal(store.embedOf('/a', '/er@matrix').path, '/er@diagram');
	assert.equal(store.embedOf('/c', '/er').path, '/er@brief');
	assert.equal(store.entryGet('/er@matrix').desc.diagram.nodes[0].id, 'm');
	assert.equal(store.entryGet('/er').path, '/er@matrix', 'a scene named without a view is the view focusing it shows');
	assert.equal(store.entryGet('/er@diagram').canvas.graph.nodes[0].id, 'd');
	assert.equal(store.entryGet('/er@nothing'), null);
	assert.equal(store.entryGet('/plain@nothing'), null);
	assert.equal(store.pathIsFound('/er@nothing'), false);
	assert.deepEqual(store.routeBuild('/a', '/er@matrix').map((step) => step.type), ['portal', 'morph']);
	assert.equal(store.routeBuild('/a', '/er@diagram').length, 1);
});

test('a store: a view chosen lasts per presentation, before the default and what an embedding asks for', () => {
	const store = viewStoreBuild();
	store.viewSet({ path: '/er', view: 'diagram', pathEmbedder: '/b' });
	assert.equal(store.embedPathOf('/b', '/er'), '/er@diagram');
	assert.equal(store.embedPathOf('/a', '/er'), '/er@diagram');
	store.viewSet({ path: '/er', view: 'matrix', pathEmbedder: '/c' });
	assert.equal(store.embedPathOf('/c', '/er', 'brief'), '/er@matrix');
	assert.equal(store.pathFocusedOf('/er'), '/er@matrix', 'the focused presentation has its own');
	store.viewSet({ path: '/er', view: 'brief' });
	assert.equal(store.pathFocusedOf('/er'), '/er@brief');
	assert.equal(store.pathFocusedOf('/er@diagram'), '/er@diagram', 'a path naming a view goes first');
	assert.equal(store.viewSet({ path: '/er', view: 'nothing' }), false);
	assert.match(store.message, /no view nothing/);
	const switcher = store.viewSwitcherGet(switchPresentationBuild('/er', true, '/c'), 'brief');
	assert.equal(switcher.view, 'matrix');
	assert.deepEqual(switcher.viewList.map((view) => view.id), ['diagram', 'matrix', 'brief']);
	assert.equal(store.viewSwitcherGet(switchPresentationBuild('/plain')), null);
});

test('a scene with no such view or path says so', async () => {
	const store = viewStoreBuild();
	assert.equal(await store.pathSet('/er@nothing'), false);
	assert.match(store.message, /The scene \/er has no view nothing/);
	assert.equal(await store.pathSet('/nowhere'), false);
	assert.match(store.message, /There is no scene \/nowhere/);
});

test('the switcher shows only where the scene lets it', () => {
	const embedded = switchPresentationBuild('/a', true, '/b');
	const focused = switchPresentationBuild('/a');
	assert.equal(switchViewSwitcherIsShown({}, focused), true);
	assert.equal(switchViewSwitcherIsShown({ isViewSwitcherHidden: true }, focused), false);
	assert.equal(switchViewSwitcherIsShown({ isViewSwitcherHiddenEmbedded: true }, focused), true);
	assert.equal(switchViewSwitcherIsShown({ isViewSwitcherHiddenEmbedded: true }, embedded), false);
	assert.equal(switchViewSwitcherIsShown({ isViewSwitcherHiddenFocused: true }, focused), false);
});

test('the dependencies of a block are collected from the diagrams of its views', () => {
	const seen = [];
	const node = { id: 'n', renderer: { component: 'Mine' }, data: { x: 1 } };
	switchDependenciesCollect({ sceneList: [{ path: '/a', viewList: [{ id: 'v', diagram: { nodes: [node] } }] }] }, { componentCollect: (name) => seen.push(name) });
	assert.deepEqual(seen, ['Mine']);
});

test('a matrix refuses a cell naming what it does not have, and is as wide as its columns', () => {
	const data = { rowList: [{ id: 'a', label: 'A' }], columnList: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], cellList: [{ row: 'a', column: 'b' }] };
	assert.equal(cardMatrixNormalize(data), data);
	assert.throws(() => cardMatrixNormalize({ ...data, cellList: [{ row: 'a', column: 'z' }] }), /does not have: a, z/);
	assert.throws(() => cardMatrixNormalize({ ...data, rowList: [{ id: 'a' }, { id: 'a' }] }), /unique id/);
	assert.throws(() => cardMatrixNormalize({ columnList: [] }), /rowList/);
	assert.equal(cardMatrixWidthGet({ ...data, rowHeadWidth: 100, cellSize: 20 }), 140);
	assert.deepEqual(cardMatrixCellOf(data)('a', 'b'), { row: 'a', column: 'b' });
	assert.equal(cardMatrixCellOf(data)('a', 'a'), undefined);
});

// ---------- the hover view ----------

test('the hover view: by the same rules as the default, what the card asks for first, false for none', () => {
	const embedded = switchPresentationBuild('/er', true, '/a');
	assert.equal(switchViewHoverResolve(twoViews(), embedded), '', 'none without one');
	assert.equal(switchViewHoverResolve(twoViews({ viewHover: 'matrix' }), embedded), 'matrix');
	const rules = twoViews({ viewHover: [{ when: { embedder: '/b' }, view: 'diagram' }, { view: 'matrix' }] });
	assert.equal(switchViewHoverResolve(rules, switchPresentationBuild('/er', true, '/b')), 'diagram');
	assert.equal(switchViewHoverResolve(rules, embedded), 'matrix');
	assert.equal(switchViewHoverResolve(twoViews({ viewHover: 'matrix' }), embedded, 'diagram'), 'diagram');
	assert.equal(switchViewHoverResolve(twoViews({ viewHover: 'matrix' }), embedded, false), '');
	assert.equal(switchViewHoverResolve(twoViews({ viewHover: (presentation) => (presentation.pathEmbedder === '/a' ? 'matrix' : '') }), embedded), 'matrix');
	const hidden = twoViews({ viewHover: 'matrix' });
	hidden.viewList[1].isAvailableEmbedded = false;
	assert.equal(switchViewHoverResolve(hidden, embedded), '', 'a view not available embedded is not shown there either');
	assert.throws(() => switchViewListCheck(twoViews({ viewHover: 'nothing' }), '/er'), /viewHover of \/er names a view it does not have: nothing/);
});

const hoverStoreBuild = () => {
	const note = (id) => ({ nodes: [{ id, renderer: { type: 'card-note' }, position: { x: 0, y: 0 }, size: { width: 100, height: 40 }, data: { title: id } }] });
	const embed = (data = {}) => ({ nodes: [{ id: 'card', renderer: { type: 'scene-embed' }, position: { x: 0, y: 0 }, size: { width: 300, height: 200 }, data: { scene: '/db', ...data } }] });
	const sceneByPath = {
		'/a': { path: '/a', diagram: embed() },
		'/off': { path: '/off', diagram: embed({ viewHover: false }) },
		'/db': {
			path: '/db',
			viewList: [{ id: 'diagram', diagram: note('d') }, { id: 'matrix', isAvailableEmbedded: false, diagram: note('m') }, { id: 'icon', isAvailableFocused: false, diagram: note('i') }],
			viewDefault: [{ when: { isEmbedded: true }, view: 'icon' }, { view: 'diagram' }],
			viewHover: 'diagram',
		},
	};
	const provider = { root: '/a', sceneGet: (path) => sceneByPath[path] ?? null, labelGet: (path) => path, childListGet: () => [] };
	return new SwitchStore({ provider, registry: switchRegistryBuild(cardDiagramNodeRegistry) });
};

test('a card with a hover view opens through it, in both directions, with no morph on the way', () => {
	const store = hoverStoreBuild();
	assert.equal(store.embedPathOf('/a', '/db'), '/db@icon', 'at rest');
	assert.equal(store.embedHoverPathOf('/a', '/db'), '/db@diagram');
	assert.equal(store.embedOf('/a', '/db').path, '/db@diagram');
	const stepsIn = store.routeBuild('/a', '/db@diagram');
	assert.deepEqual(stepsIn.map((step) => [step.type, step.child]), [['portal', '/db@diagram']]);
	const stepsOut = store.routeBuild('/db@diagram', '/a');
	assert.deepEqual(stepsOut.map((step) => [step.type, step.child]), [['portal', '/db@diagram']]);
	// another view of the scene goes by the hover view, not by the icon
	assert.deepEqual(store.routeBuild('/db@matrix', '/a').map((step) => step.type), ['morph', 'portal']);
	assert.equal(store.routeBuild('/db@matrix', '/a')[0].to, '/db@diagram');
});

test('a card without a hover view, or with a view the reader chose, has its view at rest', () => {
	const store = hoverStoreBuild();
	assert.equal(store.embedHoverPathOf('/off', '/db', false), '');
	assert.equal(store.embedOf('/off', '/db').path, '/db@icon');
	assert.deepEqual(store.routeBuild('/off', '/db@diagram').map((step) => step.type), ['portal', 'morph']);
	store.viewSet({ path: '/db', view: 'icon', pathEmbedder: '/a' });
	assert.equal(store.embedHoverPathOf('/a', '/db'), '', 'the choice of the reader stands');
	assert.equal(store.embedHoverPathOf('/off', '/db'), '/db@diagram', 'only on the card it was made on');
});

test('a portal holds the view on its card until the way is over', () => {
	const store = hoverStoreBuild();
	assert.equal(store.embedHeldPathOf('/a', 'card'), '');
	store.embedHeld = { parent: '/a', nodeId: 'card', path: '/db@diagram' };
	assert.equal(store.embedHeldPathOf('/a', 'card'), '/db@diagram');
	assert.equal(store.embedHeldPathOf('/a', 'other'), '');
	assert.equal(store.embedHeldPathOf('/off', 'card'), '');
	store.planEnd();
	assert.equal(store.embedHeldPathOf('/a', 'card'), '');
});

test('the name in a database card fits its width, wide letters counting more', () => {
	assert.ok(cardDatabaseFontSizeOf('移行元データベース', 320, 260) < cardDatabaseFontSizeOf('PW', 320, 260));
	assert.equal(cardDatabaseFontSizeOf('PW', 320, 260), 52, 'a short name stops at a part of the height');
	assert.ok(cardDatabaseFontSizeOf('A very long name of a database indeed', 320, 260) >= 12);
	assert.ok(cardDatabaseFontSizeOf('移行元データベース', 320, 260) * 9 <= 320 * 0.8);
});

test('a scene written in a document keeps all it says of its views', () => {
	const scene = { path: '/er', viewDefault: 'a', viewHover: 'b', isViewSwitcherHidden: true, isViewSwitcherHiddenEmbedded: true, isViewSwitcherHiddenFocused: true, viewList: [{ id: 'a', label: 'A', isAvailableFocused: false, diagram: { nodes: [] } }, { id: 'b', isAvailableEmbedded: false, diagram: { nodes: [] }, box: { x: 0, y: 0, width: 1, height: 1 } }] };
	const desc = switchProviderFromDoc(switchDocNormalize({ version: 1, sceneList: [scene] })).sceneGet('/er');
	for (const key of ['viewDefault', 'viewHover', 'isViewSwitcherHidden', 'isViewSwitcherHiddenEmbedded', 'isViewSwitcherHiddenFocused']) assert.equal(desc[key], scene[key], key);
	assert.equal(desc.viewList[0].isAvailableFocused, false);
	assert.deepEqual(desc.viewList[1].box, { x: 0, y: 0, width: 1, height: 1 });
});

// ---------- a view alone in its card ----------

test('a view alone in its card fills the card, and a portal goes from exactly there', () => {
	assert.deepEqual(switchEmbedCardRectOf({ x: 1, y: 35, width: 298, height: 164 }), { x: 0, y: 0, width: 300, height: 200 });
	assert.equal(switchViewFrameIsHidden({ viewList: [{ id: 'a', isFrameHiddenEmbedded: true }, { id: 'b' }] }, 'a'), true);
	assert.equal(switchViewFrameIsHidden({ viewList: [{ id: 'a', isFrameHiddenEmbedded: true }, { id: 'b' }] }, 'b'), false);
	assert.equal(switchViewFrameIsHidden({ diagram: {} }, ''), false);
	assert.equal(switchViewFrameIsHidden(null, ''), false);
	const note = (id, width, height) => ({ nodes: [{ id, renderer: { type: 'card-note' }, position: { x: 0, y: 0 }, size: { width, height }, data: { title: id } }] });
	const sceneByPath = {
		'/a': { path: '/a', diagram: { nodes: [{ id: 'card', renderer: { type: 'scene-embed' }, position: { x: 100, y: 50 }, size: { width: 300, height: 200 }, data: { scene: '/db', padding: 0.1 } }] } },
		'/db': { path: '/db', viewList: [{ id: 'alone', isFrameHiddenEmbedded: true, diagram: note('i', 300, 200) }, { id: 'framed', diagram: note('d', 300, 200) }] },
	};
	const provider = { root: '/a', sceneGet: (path) => sceneByPath[path] ?? null, labelGet: (path) => path, childListGet: () => [] };
	const store = new SwitchStore({ provider, registry: switchRegistryBuild(cardDiagramNodeRegistry) });
	const placeOf = (view) => store.embedPlaceGet('/a', { ...store.embedOf('/a', '/db'), path: `/db@${view}` });
	const alone = placeOf('alone');
	assert.deepEqual([alone.body.x, alone.body.y, alone.body.width, alone.body.height], [100, 50, 300, 200]);
	assert.deepEqual(alone.map, { scale: 1, tx: 0, ty: 0 }, 'at the size of the card, with no margin');
	const framed = placeOf('framed');
	assert.deepEqual([framed.body.x, framed.body.y], [100, 50 + SWITCH_EMBED_CHROME_HEIGHT]);
	assert.ok(framed.map.scale < 1, 'under the title line, with the margin of the card');
});
