import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramNormalize } from './DiagramERData.js';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';
import { diagramSceneSearch, diagramSearchItemListBuild, diagramSearchRegexBuild, diagramSearchRequestBuild, diagramSearchStateBuild } from './DiagramSearch.js';

const graphOf = (nodes, connections = []) => diagramNormalize({ version: 1, nodes, connections }, cardDiagramNodeRegistry);
const note = (id, y, title, text = '') => ({ id, renderer: { type: 'card-note' }, position: { x: 0, y }, size: { width: 100, height: 40 }, data: { title, text, tone: 'blue' }, handles: [{ id: 'out', direction: 'out', anchor: { side: 'right' } }, { id: 'in', direction: 'in', anchor: { side: 'left' } }] });

test('the text of a request: a literal, any case unless asked, a whole word in any script', () => {
	const regexOf = (text, options = {}) => diagramSearchRegexBuild(diagramSearchRequestBuild({ text, ...options }));
	assert.equal(regexOf('a.b').test('xa.by'), true);
	assert.equal(regexOf('a.b').test('axb'), false);
	assert.equal(regexOf('Order').test('order'), true);
	assert.equal(regexOf('Order', { isCaseSensitive: true }).test('order'), false);
	assert.equal(regexOf('order', { isWholeWord: true }).test('orders'), false);
	assert.equal(regexOf('物件', { isWholeWord: true }).test('物件基本'), false);
	assert.equal(regexOf('物件', { isWholeWord: true }).test('物件 基本'), true);
	assert.equal(regexOf(''), null);
});

test('a card of a schema answers its title and the rows whose fields match; a card without one, its words', () => {
	const table = { id: 't', renderer: { type: 'table' }, position: { x: 0, y: 100 }, size: { width: 300, height: 'auto' }, data: { name: 'Orders', fields: [{ id: 'name', label: 'Name' }, { id: 'type', label: 'Type' }], rows: [{ id: 'a', name: 'customer', type: 'lookup' }, { id: 'b', name: 'total', type: 'currency' }] }, handles: [] };
	const graph = graphOf([table, note('n', 0, 'A customer', 'tone words are not searched')]);
	const search = (text) => diagramSceneSearch({ graph, request: diagramSearchRequestBuild({ text }), registry: cardDiagramNodeRegistry, rectOf: (id) => ({ x: 0, y: id === 'n' ? 0 : 100, width: 1, height: 1 }) });
	const result = search('customer');
	assert.deepEqual(result.nodeList.map((node) => node.nodeId), ['n', 't'], 'in reading order');
	assert.deepEqual(result.nodeList[1].partList, [{ id: 'row/a', fieldIdList: ['name'] }]);
	assert.deepEqual(search('orders').nodeList[0].partList, [{ id: 'title' }]);
	assert.equal(search('blue').nodeList.length, 0, 'how a card looks is not its words');
	const items = diagramSearchItemListBuild(result);
	assert.deepEqual(items.map((item) => item.key), ['|n', '|t|row/a']);
});

test('an icon node answers its title, its line of text and its badge, never its icon or tones', () => {
	const icon = (id, y, data) => ({ id, renderer: { type: 'card-icon' }, position: { x: 0, y }, size: { width: 180, height: 32 }, data, handles: [{ id: 'out', direction: 'out', anchor: { target: 'text', side: 'right' } }] });
	const graph = graphOf([
		icon('a', 0, { title: 'Example accounts', text: '4 connections', icon: 'layers', tone: 'amber', statusTone: 'green' }),
		icon('b', 40, { title: 'bb', text: 'webapi', badge: 'example', icon: 'plug', tone: 'amber' }),
	]);
	const idListOf = (text) => diagramSceneSearch({ graph, request: diagramSearchRequestBuild({ text }), registry: cardDiagramNodeRegistry }).nodeList.map((one) => one.nodeId);
	assert.deepEqual(idListOf('account'), ['a']);
	assert.deepEqual(idListOf('connections'), ['a']);
	assert.deepEqual(idListOf('example'), ['a', 'b']);
	assert.deepEqual(idListOf('green'), []);
	assert.deepEqual(idListOf('amber'), []);
	assert.deepEqual(idListOf('plug'), []);
});

test('a line answers by its label', () => {
	const graph = graphOf([note('a', 0, 'A'), note('b', 100, 'B')], [{ id: 'ab', source: { nodeId: 'a', handleId: 'out' }, target: { nodeId: 'b', handleId: 'in' }, label: { text: 'copies to' } }]);
	const result = diagramSceneSearch({ graph, request: diagramSearchRequestBuild({ text: 'copies' }), registry: cardDiagramNodeRegistry });
	assert.deepEqual(result.connectionList, [{ connectionId: 'ab' }]);
});

test('a scene inside a card is searched one level deeper, never past depthMax, never into itself', () => {
	// a kind holding a scene: its card answers what is inside through helper.childSearch
	const registry = { ...cardDiagramNodeRegistry, kindByType: { ...cardDiagramNodeRegistry.kindByType, holder: { contract: { searchMatch: (node, helper) => { const result = helper.childSearch(node.data.scene); return { partList: [], childList: result ? [{ partId: 'scene', result }] : [] }; } } } } };
	const holderOf = (scene) => ({ id: 'h', renderer: { type: 'holder' }, data: { scene } });
	const sceneByPath = { '/a': { nodes: [holderOf('/b')] }, '/b': { nodes: [holderOf('/c'), { id: 'x', renderer: { type: 'card-note' }, data: { title: 'needle' } }] }, '/c': { nodes: [{ id: 'y', renderer: { type: 'card-note' }, data: { title: 'needle' } }, holderOf('/a')] } };
	const run = (depthMax) => {
		const childSceneSearch = (pathOwner, scene, view, request, chain) => (chain.includes(scene) ? null : diagramSceneSearch({ path: scene, graph: sceneByPath[scene], request, registry, childSceneSearch, pathChain: chain }));
		return diagramSearchItemListBuild(diagramSceneSearch({ path: '/a', graph: sceneByPath['/a'], request: diagramSearchRequestBuild({ text: 'needle', depthMax }), registry, childSceneSearch }));
	};
	assert.equal(run(0).length, 0, 'depth 0: the scene shown alone');
	assert.deepEqual(run(1).map((item) => item.key), ['/b|x']);
	assert.deepEqual(run(2).map((item) => item.key), ['/c|y', '/b|x']);
	assert.deepEqual(run(9).map((item) => item.key), ['/c|y', '/b|x'], 'a scene already in the chain is not searched again');
	assert.deepEqual(run(2)[0].chain, [{ path: '/a', nodeId: 'h', partId: 'scene' }, { path: '/b', nodeId: 'h', partId: 'scene' }]);
});

test('the marks: the current item and the cards holding it are current, the others found', () => {
	const itemList = [{ key: '/b|x', path: '/b', nodeId: 'x', chain: [{ path: '/a', nodeId: 'h', partId: 'scene' }] }, { key: '/a|n|row/r', path: '/a', nodeId: 'n', partId: 'row/r', chain: [] }];
	const state = diagramSearchStateBuild(itemList, '/b|x');
	assert.equal(state.get('/b|x'), 'current');
	assert.equal(state.get('/a|h'), 'current');
	assert.equal(state.get('/a|n'), 'match');
	assert.equal(state.get('/a|n|row/r'), 'match');
});
