import { endpointIsDangling } from './DiagramERData.js';
import { cardSchemaGet, cardRowAnchorBuild } from './TableCardSchema.js';
import { nodeLineListGet, rowNameGet } from './DiagramEditPath.js';
import { cardIconTextStrip } from './CardIconTokenData.js';

// What Delete (or Backspace) takes away in the visual editor (card-diagram-impl.md#removing-what-is-selected):
// the one thing selected, and what depends on it, said before anything goes when something does.
// Pure: it reads the store and answers a removal; the editor asks, confirms and runs it
// (DiagramVisualEdit.jsx: removeAsk), the confirmation is DiagramRemoveConfirm.jsx.
//
//   removal   { key, kind, what, dependentList, run() -> boolean, rectGet?() -> a rect of the screen }
//     key            what it is of, to tell one removal from another (`node:customer`)
//     what           the thing in a few words, for the question (`the card "Customer"`)
//     dependentList  [{ id, count, label, effect }]: what depends on it, and what becomes of it
//                    (`3 lines`, `each keeps a free end where the card was`). Empty: it goes at once
//     run()          takes it away as one step of the history; false, with the store's message, when
//                    refused
//     reason?        it cannot be taken away, and why (said instead of asking)
//     undoHint?      how it is taken back, when not by the keys of the editor (a scene: in its tree)
//
// What is selected is read off the path of the editor, the deepest thing first, and nothing in the
// middle of a list: a line (by itself, or of a card), an anchor of a line, a row, a field of a card,
// the card itself (its own tab). A cell, a list of a collection (after a row was removed the path is
// the list of rows: a second Delete must not take the card) and a standalone card take nothing.
// A feature of the editor answers first for what it focuses, or for a node it places
// (a session's removalGet: card-diagram-impl.md#features).
//
// options: { positionGet(nodeId, handleId), boxGet(nodeId) }: where the canvas draws handles and
// nodes, for the free ends a removal leaves and the backgrounds it unframes
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// the words of a node: what it says (its name, title, label or words), else its id
export function nodeWordsOf(node) {
	const data = node?.data ?? {};
	const words = [data.name, data.title, data.label, data.text].find(value => typeof value === 'string' && value.trim());
	return words ? cardIconTextStrip(words).trim() || node.id : String(node?.id ?? '');
}

// the words of a line: its label, else the two things it joins
export function lineWordsOf(store, connection) {
	if (connection?.label?.text) return `the line "${connection.label.text}"`;
	const endOf = endpoint => (endpointIsDangling(endpoint) ? 'a free end' : nodeWordsOf(store.nodeGet(endpoint.nodeId)));
	return connection ? `the line ${endOf(connection.source)} → ${endOf(connection.target)}` : 'the line';
}

// what depends on a node: the lines on its handles, and the backgrounds drawn around it
export function nodeDependentListOf(store, nodeId) {
	const dependentList = [];
	const lineCount = nodeLineListGet(store, nodeId).length;
	if (lineCount) dependentList.push({ id: 'lines', count: lineCount, label: plural(lineCount, 'line'), effect: lineCount === 1 ? 'keeps a free end where it was attached' : 'each keeps a free end where it was attached' });
	const aroundList = store.nodeAroundListOf(nodeId);
	const aloneList = aroundList.filter(item => item.isAlone);
	const sharedList = aroundList.filter(item => !item.isAlone);
	if (sharedList.length) dependentList.push({ id: 'around', count: sharedList.length, label: plural(sharedList.length, 'block drawn around it'), effect: sharedList.length === 1 ? 'frames what else it framed' : 'each frames what else it framed' });
	if (aloneList.length) dependentList.push({ id: 'around-alone', count: aloneList.length, label: plural(aloneList.length, 'block drawn around it alone'), effect: aloneList.length === 1 ? 'stays where it is, at its size' : 'each stays where it is, at its size' });
	return dependentList;
}

function nodeRemoval(store, nodeId, { positionGet, boxGet }) {
	const node = store.nodeGet(nodeId);
	if (!node) return null;
	return {
		key: `node:${nodeId}`, kind: 'node', nodeId, what: `"${nodeWordsOf(node)}"`,
		dependentList: nodeDependentListOf(store, nodeId),
		run: () => store.nodeRemove(nodeId, positionGet, { boxGet }),
	};
}

// the removal of what is selected, or null when nothing selected can be taken away with a key
export function diagramRemovalOf(store, { positionGet, boxGet } = {}) {
	const display = store.display;
	if (!display || store.kind !== 'diagram') return null;
	const selection = store.selection;
	// an anchor of a line (its route): the anchor alone
	if (selection?.anchorId && selection.connectionId) {
		const connection = store.connectionGet(selection.connectionId);
		return connection ? { key: `anchor:${connection.id}/${selection.anchorId}`, kind: 'anchor', what: `the anchor ${selection.anchorId} of ${lineWordsOf(store, connection)}`, dependentList: [], run: () => store.connectionAnchorRemove(connection.id, selection.anchorId) } : null;
	}
	// a line, by itself or of a card: its own (a draft whose structure is given takes lines too)
	if (display.connectionId && display.view !== 'list') {
		const connection = store.connectionGet(display.connectionId);
		return connection ? { key: `line:${connection.id}`, kind: 'line', connectionId: connection.id, what: lineWordsOf(store, connection), dependentList: [], run: () => store.connectionRemove(connection.id) } : null;
	}
	if (store.isStructureFixed || !display.nodeId || display.view === 'list') return null;
	const node = store.nodeGet(display.nodeId);
	const schema = node ? cardSchemaGet(node, store.registry) : null;
	// a row of a card: the lines on its handles keep a free end
	if (display.rowId && !display.fieldId) {
		const row = store.rowGet(node.id, display.rowId);
		if (!schema || !row) return null;
		const handleIdList = store.anchorHandleListGet(node.id, cardRowAnchorBuild(schema, row.id)).map(handle => handle.id);
		const lineCount = store.connections.filter(connection => ['source', 'target'].some(role => !endpointIsDangling(connection[role]) && connection[role].nodeId === node.id && handleIdList.includes(connection[role].handleId))).length;
		return {
			key: `row:${node.id}/${row.id}`, kind: 'row', what: `the ${schema.labelRow.toLowerCase()} "${rowNameGet(row, schema) || row.id}" of "${nodeWordsOf(node)}"`,
			dependentList: lineCount ? [{ id: 'lines', count: lineCount, label: plural(lineCount, 'line'), effect: lineCount === 1 ? 'keeps a free end where the row was' : 'each keeps a free end where the row was' }] : [],
			run: () => store.rowRemove(node.id, row.id, positionGet),
		};
	}
	// a field (a column) of a card whose fields are its own: its values in the rows go with it
	if (display.fieldId && !display.rowId) {
		const field = schema?.fieldList.find(item => item.id === display.fieldId);
		if (!field) return null;
		if (!schema.isFieldListEditable) return { key: `field:${node.id}/${field.id}`, kind: 'field', what: `the ${schema.labelField.toLowerCase()} "${field.label}"`, dependentList: [], reason: schema.reasonFieldListFixed || `The ${schema.labelFieldPlural.toLowerCase()} of this card are fixed.`, run: () => false };
		const valueCount = store.rowsGet(node).filter(row => row[field.id] !== undefined && row[field.id] !== null && row[field.id] !== '').length;
		return {
			key: `field:${node.id}/${field.id}`, kind: 'field', what: `the ${schema.labelField.toLowerCase()} "${field.label}" of "${nodeWordsOf(node)}"`,
			dependentList: valueCount ? [{ id: 'values', count: valueCount, label: plural(valueCount, 'value'), effect: `written in ${valueCount === 1 ? 'a row go' : 'its rows go'} with it` }] : [],
			run: () => store.columnRemove(node.id, field.id),
		};
	}
	// a cell is typed, not removed; the card itself only on its own tab (its properties, a head field)
	if (display.rowId || display.fieldId || display.tab !== 'table' || display.isViews || display.isRowDisplay) return null;
	return nodeRemoval(store, node.id, { positionGet, boxGet });
}
