import { cardSchemaGet } from './TableCardSchema.js';

// Search in a diagram (card-diagram-impl.md#search): one contract every node and line answers,
// pure, over the data of the diagram, so it finds what a card does not draw at the moment (rows
// behind a row break, a scene too deep to be drawn). What it finds is marked where it is drawn
// (DiagramSearchStore, the highlights); this file only decides what matches.
//
//   request   { text, isCaseSensitive, isWholeWord, depth, depthMax }
//             depth: how deep the scene searched is embedded (0 the scene searched first);
//             depthMax: the deepest a search goes. a scene inside a card is searched only while
//             depth + 1 <= depthMax (helper.childSearch is the one place that goes deeper)
//   match     what a node answers: null, or { partList: [{ id }], childList: [{ partId, result }], isWhole? }
//             a part is a piece of the card that matched: 'title', 'row/{id}', 'item/{id}', ...,
//             marked where the card draws it ([data-search-part], or the row of [data-row-id]);
//             isWhole: the card matched as a whole, no part to point at. a child is a scene
//             inside it, searched through helper.childSearch. an answer with no part, no child
//             with matches and not whole is no match
//   result    what a scene answers: { path, nodeList: [{ nodeId, rect, partList, childList }],
//             connectionList: [{ connectionId }] }, its nodes in reading order
//
// A kind answers through its contract (contract.searchMatch(node, helper) -> match | null). A
// kind without one is searched by its schema when it is a card (its title fields, its head
// fields, every field of every row: a cell is read as text, or by contract.searchCellTextGet
// when a variant draws it otherwise), else by the text of its data. A line matches by its label.

const SEARCH_KEY_SKIP = new Set(['id', 'tone', 'icon', 'renderer', 'link', 'scene', 'view', 'box', 'padding', 'focusPath', 'columnTemplate', 'handles', 'position', 'size']);

// the test of one text against a request: a literal, whatever the case unless asked, and as a
// whole word when asked (a letter, a digit or _ on neither side; in any script)
export function diagramSearchRegexBuild(request, { isGlobal = false } = {}) {
	const text = String(request?.text ?? '');
	if (!text) return null;
	const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const source = request.isWholeWord ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
	return new RegExp(source, `u${request.isCaseSensitive ? '' : 'i'}${isGlobal ? 'g' : ''}`);
}

export function diagramSearchRequestBuild({ text = '', isCaseSensitive = false, isWholeWord = false, depthMax = 0 } = {}) {
	return { text: String(text), isCaseSensitive: Boolean(isCaseSensitive), isWholeWord: Boolean(isWholeWord), depth: 0, depthMax: Math.max(0, Number(depthMax) || 0) };
}

// the texts of a value, deep, without what only says how it looks or where it goes
export function diagramSearchTextListOf(value, list = []) {
	if (value === null || value === undefined) return list;
	if (typeof value === 'string') { if (value.trim()) list.push(value); return list; }
	if (typeof value === 'number') { list.push(String(value)); return list; }
	if (Array.isArray(value)) { for (const item of value) diagramSearchTextListOf(item, list); return list; }
	if (typeof value === 'object') {
		for (const [key, item] of Object.entries(value)) if (!SEARCH_KEY_SKIP.has(key)) diagramSearchTextListOf(item, list);
	}
	return list;
}

// how a card shows the value of a field: an enum by its label
function fieldTextOf(field, value) {
	if (value === null || value === undefined) return '';
	if (field?.valueLabels && Object.hasOwn(field.valueLabels, value)) return String(field.valueLabels[value]);
	return typeof value === 'object' ? diagramSearchTextListOf(value).join(' ') : String(value);
}

// a card of a schema (TableCardSchema.js): its title fields, then its rows
export function diagramCardSchemaSearch(node, schema, helper, contract = {}) {
	const data = node.data ?? {};
	const partList = [];
	const titleFieldList = [...(schema.nodePropertyList ?? []), ...(schema.headFieldList ?? [])];
	const titleTextList = titleFieldList.length ? titleFieldList.map((field) => fieldTextOf(field, data[field.id])) : [data.name, data.nameLogical];
	if ([...titleTextList, data.badge].some((text) => helper.test(text))) partList.push({ id: 'title' });
	for (const row of data[schema.rowListKey] ?? []) {
		if (!row || row.isEllipsis) continue;
		const fieldIdList = [...(schema.fieldList ?? []), ...(schema.rowPropertyList ?? [])]
			.filter((field) => helper.test(contract.searchCellTextGet?.(field, row, data) ?? fieldTextOf(field, row[field.id])))
			.map((field) => field.id);
		if (fieldIdList.length) partList.push({ id: `row/${row.id}`, fieldIdList });
	}
	return partList.length ? { partList, childList: [] } : null;
}

// what one node answers
export function diagramNodeSearch(node, helper, registry) {
	const kind = registry?.kindByType?.[node.renderer?.type];
	const contract = kind?.contract ?? {};
	if (typeof contract.searchMatch === 'function') return contract.searchMatch(node, helper);
	// the schema as the editor reads it: a generic table's fields are those of its data
	if (kind?.schema) return diagramCardSchemaSearch(node, cardSchemaGet(node, registry), helper, contract);
	return diagramSearchTextListOf(node.data).some((text) => helper.test(text)) ? { partList: [], childList: [], isWhole: true } : null;
}

// what one line answers: its label
export function diagramConnectionSearch(connection, helper) {
	return helper.test(connection.label?.text) ? { partList: [{ id: 'label' }] } : null;
}

// a scene: its nodes in reading order (top to bottom, then left to right), then its lines.
// childSceneSearch(path, sceneInput, view, request) -> result | null is what a host with scenes
// inside scenes gives (the switch layer); helper.childSearch calls it one level deeper, never
// past request.depthMax, and never into a scene already in the chain
export function diagramSceneSearch({ path = '', graph, rectOf, request, registry, childSceneSearch, pathChain = [] }) {
	const regex = diagramSearchRegexBuild(request);
	if (!regex || !graph) return { path, nodeList: [], connectionList: [] };
	const test = (text) => text !== undefined && text !== null && text !== '' && regex.test(String(text));
	const chain = [...pathChain, path];
	const helper = {
		request,
		test,
		childSearch: (sceneInput, view) => {
			if (!childSceneSearch || request.depth + 1 > request.depthMax) return null;
			return childSceneSearch(path, sceneInput, view, { ...request, depth: request.depth + 1 }, chain);
		},
		textListOf: diagramSearchTextListOf,
		cardSchemaSearch: (node) => diagramCardSchemaSearch(node, cardSchemaGet(node, registry), helper),
		nodeSearch: (node) => diagramNodeSearch(node, helper, registry),
	};
	const nodeList = [];
	for (const node of graph.nodes ?? []) {
		if (node.renderer?.type === 'scene-box') continue;
		const match = diagramNodeSearch(node, helper, registry);
		if (!match) continue;
		const partList = match.partList ?? [];
		const childList = (match.childList ?? []).filter((child) => child.result && diagramSearchResultCount(child.result) > 0);
		if (!partList.length && !childList.length && !match.isWhole) continue;
		nodeList.push({ nodeId: node.id, rect: rectOf?.(node.id) ?? { x: 0, y: 0, width: 0, height: 0 }, partList, childList });
	}
	const nodeListKept = nodeList;
	nodeListKept.sort((a, b) => (Math.abs(a.rect.y - b.rect.y) > 8 ? a.rect.y - b.rect.y : a.rect.x - b.rect.x));
	const connectionList = (graph.connections ?? []).filter((connection) => diagramConnectionSearch(connection, helper)).map((connection) => ({ connectionId: connection.id }));
	return { path, nodeList: nodeListKept, connectionList };
}

export function diagramSearchResultCount(result) {
	return diagramSearchItemListBuild(result).length;
}

// what the reader steps through, in order: one item per part of a node (a node matched as a
// whole is one item), the items of a scene inside a node right after the node's own, then the
// lines. chain: the nodes, from the scene searched down, that hold the item
//   item  { key, path, nodeId?, partId?, connectionId?, chain: [{ path, nodeId, partId? }] }
export function diagramSearchItemListBuild(result, chain = []) {
	if (!result) return [];
	const list = [];
	for (const node of result.nodeList) {
		const keyOf = (partId) => `${result.path}|${node.nodeId}${partId ? `|${partId}` : ''}`;
		if (!node.partList.length && !node.childList.length) list.push({ key: keyOf(), path: result.path, nodeId: node.nodeId, chain });
		for (const part of node.partList) list.push({ key: keyOf(part.id), path: result.path, nodeId: node.nodeId, partId: part.id, chain });
		for (const child of node.childList) list.push(...diagramSearchItemListBuild(child.result, [...chain, { path: result.path, nodeId: node.nodeId, partId: child.partId }]));
	}
	for (const connection of result.connectionList) list.push({ key: `${result.path}|~line|${connection.connectionId}`, path: result.path, connectionId: connection.connectionId, chain });
	return list;
}

// how each place is marked, from the items and the current one: 'current' for the current item
// and the nodes (and their parts) holding it, 'match' for every other
//   stateByKey   `${path}|${nodeId}`, `${path}|${nodeId}|${partId}`, `${path}|~line|${connectionId}`
export function diagramSearchStateBuild(itemList, keyCurrent) {
	const stateByKey = new Map();
	const mark = (key, state) => { if (stateByKey.get(key) !== 'current') stateByKey.set(key, state); };
	for (const item of itemList) {
		const state = item.key === keyCurrent ? 'current' : 'match';
		for (const holder of item.chain) {
			mark(`${holder.path}|${holder.nodeId}`, state);
			if (holder.partId) mark(`${holder.path}|${holder.nodeId}|${holder.partId}`, state);
		}
		if (item.connectionId) { mark(item.key, state); continue; }
		mark(`${item.path}|${item.nodeId}`, state);
		if (item.partId) mark(item.key, state);
	}
	return stateByKey;
}
