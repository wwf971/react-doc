import { switchPathNormalize } from './SwitchData.js';

// The references of a diagram (card-diagram-flexible-switch.md#references): the paths written in it
// that name a scene. One walk for everything that reads or rewrites them: a mounted source drawn
// under another path (SwitchMount.js), the relations of scenes in the panel and a scene renamed
// (SwitchSceneEditTree.js).
//
//   kind     link    node.link, connection.link, a `link` anywhere in the data of a node (a cell of a
//                    matrix, a tab, an item of a stack)
//            embed   data.scene of an embedded scene
//            stack   scene of an item of a stack
//            alias   data.focusPath of a stack (where its scroll position is kept)
//   ref      the text written: a path, maybe with a view (@id) or an item (#id); only text starting
//            with / is a reference (command:... is not)
//   where    the keys from the node or the connection to the text
//
//   switchRefListGet(diagram)           -> [{ kind, ref, path, suffix, nodeId?, nodeIndex?, connectionId?,
//                                          connectionIndex?, where }]
//   switchRefMap(diagram, map)          -> the diagram with every ref replaced by map(ref, info) (a
//                                          new object where something changed, the same one elsewhere)
export const SWITCH_REF_KIND_LIST = ['link', 'embed', 'stack', 'alias'];

// a reference split into its path and what follows it (@view, #item)
export function switchRefSplit(ref) {
	const text = String(ref ?? '');
	const index = text.search(/[@#]/);
	return index < 0 ? { path: switchPathNormalize(text), suffix: '' } : { path: switchPathNormalize(text.slice(0, index)), suffix: text.slice(index) };
}

export function switchRefIs(value) {
	return typeof value === 'string' && value.trim().startsWith('/');
}

// every reference of a node, as [where, kind]: where is a list of keys from the node
function nodeRefWhereList(node) {
	const list = [];
	if (switchRefIs(node.link)) list.push([['link'], 'link']);
	const data = node.data;
	if (!data || typeof data !== 'object') return list;
	const type = node.renderer?.type;
	if (type === 'scene-embed' && switchRefIs(data.scene)) list.push([['data', 'scene'], 'embed']);
	if (type === 'scene-stack') {
		(Array.isArray(data.itemList) ? data.itemList : []).forEach((item, index) => { if (switchRefIs(item?.scene)) list.push([['data', 'itemList', index, 'scene'], 'stack']); });
		if (switchRefIs(data.focusPath)) list.push([['data', 'focusPath'], 'alias']);
	}
	// a link anywhere in the data
	const walk = (value, where, depth) => {
		if (depth > 8 || !value || typeof value !== 'object') return;
		if (Array.isArray(value)) { value.forEach((item, index) => walk(item, [...where, index], depth + 1)); return; }
		for (const [key, item] of Object.entries(value)) {
			if (key === 'link' && switchRefIs(item)) list.push([[...where, key], 'link']);
			else walk(item, [...where, key], depth + 1);
		}
	};
	walk(data, ['data'], 0);
	return list;
}

function valueAt(object, where) {
	return where.reduce((value, key) => (value == null ? value : value[key]), object);
}

// the value with the text at where replaced: copies along the way, the rest shared
function valueWith(object, where, text) {
	if (!where.length) return text;
	const [key, ...rest] = where;
	const copy = Array.isArray(object) ? object.slice() : { ...object };
	copy[key] = valueWith(object[key], rest, text);
	return copy;
}

export function switchRefListGet(diagram) {
	const list = [];
	(diagram?.nodes ?? []).forEach((node, nodeIndex) => {
		if (!node || typeof node !== 'object') return;
		for (const [where, kind] of nodeRefWhereList(node)) {
			const ref = valueAt(node, where);
			list.push({ kind, ref, ...switchRefSplit(ref), nodeId: node.id, nodeIndex, where });
		}
	});
	(diagram?.connections ?? []).forEach((connection, connectionIndex) => {
		if (switchRefIs(connection?.link)) list.push({ kind: 'link', ref: connection.link, ...switchRefSplit(connection.link), connectionId: connection.id, connectionIndex, where: ['link'] });
	});
	return list;
}

// map(ref, { kind, path, suffix, nodeId?, connectionId? }) -> the text to write instead (the same
// text: nothing changes there)
export function switchRefMap(diagram, map) {
	if (!diagram || typeof diagram !== 'object') return diagram;
	let isChanged = false;
	const nodes = (diagram.nodes ?? []).map((node) => {
		if (!node || typeof node !== 'object') return node;
		let next = node;
		for (const [where, kind] of nodeRefWhereList(node)) {
			const ref = valueAt(node, where);
			const refNext = map(ref, { kind, ...switchRefSplit(ref), nodeId: node.id });
			if (refNext !== ref) next = valueWith(next, where, refNext);
		}
		if (next !== node) isChanged = true;
		return next;
	});
	const connections = (diagram.connections ?? []).map((connection) => {
		if (!switchRefIs(connection?.link)) return connection;
		const refNext = map(connection.link, { kind: 'link', ...switchRefSplit(connection.link), connectionId: connection.id });
		if (refNext === connection.link) return connection;
		isChanged = true;
		return { ...connection, link: refNext };
	});
	if (!isChanged) return diagram;
	return { ...diagram, ...(diagram.nodes ? { nodes } : {}), ...(diagram.connections ? { connections } : {}) };
}

// a path moved: prefix from -> to, for the path itself and everything below it. null: not under it
export function switchPathPrefixMove(path, from, to) {
	const normalized = switchPathNormalize(path);
	if (normalized === from) return to;
	if (from === '/') return switchPathNormalize(`${to}/${normalized}`);
	if (normalized.startsWith(`${from}/`)) return switchPathNormalize(`${to}${normalized.slice(from.length)}`);
	return null;
}
