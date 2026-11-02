import { cardSchemaGet } from './TableCardSchema.js';
import { endpointIsDangling } from './DiagramERData.js';

// The path of the edit card (card-diagram-impl.md#the-path-of-the-edit-card): where
// the author is in the principal of the card (a node, or a line by itself),
// as a list of segments. The path is the one state the card is drawn from:
// its tabs, the view of the tab (a list, or the detail of one thing), and
// what the canvas highlights are all read off the path (pathResolve). Every
// gesture that focuses something (a click on a row, on a tab, on a segment
// of the path bar) is a change of the path, and a change of the data that
// takes a subject away (a removed row) is answered by a redirect.
//
//   segment kinds
//     node        { kind: 'node', id }                        the root: a card
//     connection  { kind: 'connection', id }                  the root: a line selected by itself
//     prop        { kind: 'prop', id }                        a property of the card (a head field, the description)
//     rows        { kind: 'rows' }                            the rows of the card (its columns, options, properties)
//     row         { kind: 'row', id | index | name }          one row
//     field       { kind: 'field', id | index | name }        under a row: that cell; under fields: the field
//     fields      { kind: 'fields' }                          the fields of the card (its columns)
//     lines       { kind: 'lines' }                           the connections at the handles of the card
//     line        { kind: 'line', id | index }                one of them
//
// A segment names its subject by id, or by index or name instead: the three
// spellings route to the same display, and the path the store keeps is the
// canonical one (ids). A collection may also be spelled with the word the
// card uses for it ('columns' for the rows of a Dataverse table, 'columns'
// for the fields of a generic table): the schema's own plural.
//
//   display   what the card shows for a path
//     principal      'node' | 'connection'
//     nodeId, connectionId, rowId, fieldId, propId   the subjects, null when none
//     tab            table | row | column | cell | line
//     view           'detail' | 'list'
export const cardTabList = ['table', 'row', 'column', 'cell', 'line'];

const pathHopMax = 12;
const nodePropertyIdList = ['name', 'nameLogical', 'label', 'description'];

export function segmentIs(segment, kind) {
	return Boolean(segment) && segment.kind === kind;
}

// an item segment under a collection: its kind, or the kind 'item' that a
// bare key=value takes in the text form (the collection says what it is)
function segmentIsItem(segment, kind) {
	return Boolean(segment) && (segment.kind === kind || segment.kind === 'item');
}

export function pathEquals(a, b) {
	if (a === b) return true;
	if (!a || !b || a.length !== b.length) return false;
	return a.every((segment, index) => segment.kind === b[index].kind && segment.id === b[index].id && segment.index === b[index].index && segment.name === b[index].name);
}

// the id of a row read from a row segment: by id, by index, or by name (the
// value of the row's first field, or its name)
function rowFind(rows, schema, segment) {
	if (segment.id !== undefined) return rows.find(row => row.id === segment.id);
	if (segment.index !== undefined) return rows[Number(segment.index)];
	if (segment.name !== undefined) return rows.find(row => rowNameGet(row, schema) === segment.name);
	return undefined;
}

function fieldFind(fieldList, segment) {
	if (segment.id !== undefined) return fieldList.find(field => field.id === segment.id);
	if (segment.index !== undefined) return fieldList[Number(segment.index)];
	if (segment.name !== undefined) return fieldList.find(field => field.label === segment.name);
	return undefined;
}

function lineFind(lineList, segment) {
	if (segment.id !== undefined) return lineList.find(connection => connection.id === segment.id);
	if (segment.index !== undefined) return lineList[Number(segment.index)];
	if (segment.name !== undefined) return lineList.find(connection => connection.label?.text === segment.name);
	return undefined;
}

export function rowNameGet(row, schema) {
	const first = schema?.fieldList[0]?.id;
	return String(row?.name ?? (first ? row?.[first] : undefined) ?? row?.id ?? '');
}

// the connections attached to any handle of a node, in document order
export function nodeLineListGet(store, nodeId) {
	return store.connections.filter(connection => ['source', 'target'].some(role => !endpointIsDangling(connection[role]) && connection[role].nodeId === nodeId));
}

// a collection segment spelled with the card's own word for it
function collectionKindGet(segment, schema) {
	const kind = String(segment?.kind ?? '').toLowerCase();
	if (['rows', 'fields', 'lines'].includes(kind)) return kind;
	if (schema && kind === schema.labelRowPlural.toLowerCase()) return 'rows';
	if (schema && kind === schema.labelFieldPlural.toLowerCase()) return 'fields';
	return null;
}

const displayOf = (base, extra) => ({ principal: 'node', connectionId: null, rowId: null, fieldId: null, propId: null, view: 'detail', ...base, ...extra });

// one resolution step: the display of a path, or where the path redirects
// to when a segment names nothing (the parent collection, the root, or
// nothing at all when the principal is gone)
export function pathResolveStep(path, store) {
	if (!path?.length) return { path: [], display: null };
	const [root, ...rest] = path;
	if (segmentIs(root, 'connection')) {
		if (!store.connectionGet(root.id)) return { redirect: [] };
		const canonical = [{ kind: 'connection', id: root.id }];
		if (rest.length) return { redirect: canonical };
		return { path: canonical, display: { principal: 'connection', nodeId: null, connectionId: root.id, rowId: null, fieldId: null, propId: null, tab: 'line', view: 'detail' } };
	}
	if (!segmentIs(root, 'node')) return { redirect: [] };
	const node = store.nodeGet(root.id);
	if (!node) return { redirect: [] };
	const nodeId = node.id;
	const nodeSegment = { kind: 'node', id: nodeId };
	const schema = cardSchemaGet(node, store.registry);
	if (!rest.length) return { path: [nodeSegment], display: displayOf({ nodeId, tab: 'table' }) };
	const [second, third, fourth] = rest;
	if (segmentIs(second, 'prop')) {
		const allowed = schema ? schema.nodePropertyList.map(item => item.id) : nodePropertyIdList;
		if (!allowed.includes(second.id) && !nodePropertyIdList.includes(second.id)) return { redirect: [nodeSegment] };
		return { path: [nodeSegment, { kind: 'prop', id: second.id }], display: displayOf({ nodeId, propId: second.id, tab: 'table' }) };
	}
	const collection = collectionKindGet(second, schema);
	if (!collection) return { redirect: [nodeSegment] };
	if (collection === 'lines') {
		const lineList = nodeLineListGet(store, nodeId);
		const listPath = [nodeSegment, { kind: 'lines' }];
		if (!third) return { path: listPath, display: displayOf({ nodeId, tab: 'line', view: 'list' }) };
		if (!segmentIsItem(third, 'line')) return { redirect: listPath };
		const connection = lineFind(lineList, third);
		if (!connection) return { redirect: listPath };
		const canonical = [...listPath, { kind: 'line', id: connection.id }];
		if (fourth) return { redirect: canonical };
		return { path: canonical, display: displayOf({ nodeId, connectionId: connection.id, tab: 'line' }) };
	}
	if (!schema) return { redirect: [nodeSegment] };
	if (collection === 'fields') {
		const listPath = [nodeSegment, { kind: 'fields' }];
		if (!third) return { path: listPath, display: displayOf({ nodeId, tab: 'column', view: 'list' }) };
		if (!segmentIsItem(third, 'field')) return { redirect: listPath };
		const field = fieldFind(schema.fieldList, third);
		if (!field) return { redirect: listPath };
		const canonical = [...listPath, { kind: 'field', id: field.id }];
		if (fourth) return { redirect: canonical };
		return { path: canonical, display: displayOf({ nodeId, fieldId: field.id, tab: 'column' }) };
	}
	const rows = store.rowsGet(node);
	const listPath = [nodeSegment, { kind: 'rows' }];
	if (!third) return { path: listPath, display: displayOf({ nodeId, tab: 'row', view: 'list' }) };
	if (!segmentIsItem(third, 'row')) return { redirect: listPath };
	const row = rowFind(rows, schema, third);
	if (!row) return { redirect: listPath };
	const rowPath = [...listPath, { kind: 'row', id: row.id }];
	if (!fourth) return { path: rowPath, display: displayOf({ nodeId, rowId: row.id, tab: 'row' }) };
	if (!segmentIsItem(fourth, 'field')) return { redirect: rowPath };
	const field = fieldFind(schema.fieldList, fourth);
	if (!field) return { redirect: rowPath };
	const canonical = [...rowPath, { kind: 'field', id: field.id }];
	if (rest.length > 3) return { redirect: canonical };
	return { path: canonical, display: displayOf({ nodeId, rowId: row.id, fieldId: field.id, tab: 'cell' }) };
}

// the display of a path, following redirects until the path is canonical:
// the built-in redirects of pathResolveStep, then the store's own rules
// (redirectRuleList: (display, path, store) => a path to go to instead, or
// null), applied in order until none fires. a chain that does not settle
// ends at the root, so a wrong rule cannot hang the editor
export function pathResolve(pathInput, store, ruleList = []) {
	let path = pathInput ?? [];
	for (let hop = 0; hop < pathHopMax; hop++) {
		const step = pathResolveStep(path, store);
		if (step.redirect) { path = step.redirect; continue; }
		const redirect = ruleList.map(rule => rule(step.display, step.path, store)).find(Boolean);
		if (redirect && !pathEquals(redirect, step.path)) { path = redirect; continue; }
		return step;
	}
	return { path: [], display: null };
}

// the path a tab leads to from a display: the subject the display has for
// that tab, or the tab's list. null when the tab has no subject at all
export function tabPathGet(display, tab) {
	if (!display) return null;
	if (display.principal === 'connection') return tab === 'line' ? [{ kind: 'connection', id: display.connectionId }] : null;
	const node = { kind: 'node', id: display.nodeId };
	switch (tab) {
		case 'table': return [node];
		case 'row': return display.rowId ? [node, { kind: 'rows' }, { kind: 'row', id: display.rowId }] : [node, { kind: 'rows' }];
		case 'column': return display.fieldId ? [node, { kind: 'fields' }, { kind: 'field', id: display.fieldId }] : [node, { kind: 'fields' }];
		case 'cell': return display.rowId && display.fieldId ? [node, { kind: 'rows' }, { kind: 'row', id: display.rowId }, { kind: 'field', id: display.fieldId }] : null;
		case 'line': return display.connectionId ? [node, { kind: 'lines' }, { kind: 'line', id: display.connectionId }] : [node, { kind: 'lines' }];
		default: return null;
	}
}

// the path of a selection in the terms the cards report (a node with one
// of its rows, fields, cells, properties, or lines)
export function selectionPathBuild(nodeId, { rowId = null, fieldId = null, connectionId = null, propId = null } = {}) {
	if (!nodeId) return [];
	const node = { kind: 'node', id: nodeId };
	if (connectionId) return [node, { kind: 'lines' }, { kind: 'line', id: connectionId }];
	if (rowId && fieldId) return [node, { kind: 'rows' }, { kind: 'row', id: rowId }, { kind: 'field', id: fieldId }];
	if (rowId) return [node, { kind: 'rows' }, { kind: 'row', id: rowId }];
	if (fieldId) return [node, { kind: 'fields' }, { kind: 'field', id: fieldId }];
	if (propId) return [node, { kind: 'prop', id: propId }];
	return [node];
}

// the labels of a canonical path, for the path bar: one per segment
export function pathLabelListGet(path, store) {
	const node = segmentIs(path[0], 'node') ? store.nodeGet(path[0].id) : undefined;
	const schema = node ? cardSchemaGet(node, store.registry) : null;
	return path.map(segment => {
		switch (segment.kind) {
			case 'node': return String(node?.data?.name ?? node?.data?.label ?? segment.id);
			case 'connection': { const connection = store.connectionGet(segment.id); return String(connection?.label?.text || segment.id); }
			case 'prop': return String((schema?.nodePropertyList ?? []).find(item => item.id === segment.id)?.label ?? segment.id);
			case 'rows': return schema?.labelRowPlural ?? 'Rows';
			case 'fields': return schema?.labelFieldPlural ?? 'Columns';
			case 'lines': return 'Lines';
			case 'row': return rowNameGet(node ? store.rowGet(node.id, segment.id) : undefined, schema) || String(segment.id);
			case 'field': return String(schema?.fieldList.find(field => field.id === segment.id)?.label ?? segment.id);
			case 'line': { const connection = store.connectionGet(segment.id); return String(connection?.label?.text || segment.id); }
			default: return String(segment.kind);
		}
	});
}

// ---------- the text form ----------
//
//   node(id=customer) > rows > row(id=name) > field(id=type)
//   node(id=customer) > columns > index=1          the second column of a Dataverse table
//   node(id=customer) > columns > name=Account     by its name
//   node(id=customer) > columns > all              the list (all is dropped)
//   connection(id=order-customer)
//
// a bare key=value is an item of the collection before it (kind 'item'):
// the resolution reads it as a row, a field or a line by its place

export function pathFormat(path) {
	return (path ?? []).map(segment => {
		const key = ['id', 'index', 'name'].find(name => segment[name] !== undefined);
		return key === undefined ? segment.kind : `${segment.kind}(${key}=${segment[key]})`;
	}).join(' > ');
}

export function pathParse(text) {
	const parts = String(text ?? '').split(/\s*[>/]\s*/).map(part => part.trim()).filter(Boolean);
	const path = [];
	let implied = null;
	for (const part of parts) {
		if (part.toLowerCase() === 'all') continue;
		const call = /^([a-z]+)\((.*)\)$/i.exec(part);
		let kind;
		let argument = '';
		if (call) { kind = call[1].toLowerCase(); argument = call[2]; }
		else if (part.includes('=')) { kind = implied; argument = part; }
		else kind = part.toLowerCase();
		if (!kind) throw new Error(`"${part}": a key=value needs a collection before it.`);
		const segment = { kind };
		for (const pair of argument.split(',').map(item => item.trim()).filter(Boolean)) {
			const [key, ...valueParts] = pair.split('=');
			const value = valueParts.join('=').trim();
			if (!['id', 'index', 'name'].includes(key.trim())) throw new Error(`"${part}": unknown key "${key}".`);
			segment[key.trim()] = key.trim() === 'index' ? Number(value) : value;
		}
		path.push(segment);
		implied = kind === 'node' || kind === 'connection' ? null : 'item';
	}
	return path;
}
