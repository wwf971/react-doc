import { makeAutoObservable, observable } from 'mobx';
import { parseDocument, stringify } from 'yaml';
import { diagramLegacyConvert, diagramNormalize, cardStandaloneNormalize, endpointIsDangling, handleRoleAccepts, lineTypeList, markerTypeList, attachPolicyList } from './DiagramERData.js';
import { cardSchemaGet, cardRowAnchorBuild } from './TableCardSchema.js';
import { pathResolve, pathEquals, selectionPathBuild, tabPathGet, nodeLineListGet, cardTabList } from './DiagramEditPath.js';
import { EditHistory } from './DiagramEditHistory.js';

export { cardTabList };

export const diagramEditModeList = [{ id: 'visual', label: 'Visual', description: 'Edit cards, rows, handles and connections on the canvas', isDefault: true }];

// the dash presets of a line, offered by name in the edit card
export const strokeDashList = [
	{ id: 'solid', label: 'Solid', value: '' },
	{ id: 'dashed', label: 'Dashed', value: '6 4' },
	{ id: 'dotted', label: 'Dotted', value: '2 3' },
];

// The draft of a diagram (or of one card) while its visual edit mode is open
// (card-diagram-impl.md#card-editing). The YAML document is the draft; every
// command changes it through the YAML document api (changeApply), validates
// the result with the same normalization the view uses, and keeps the
// previous draft when the change is invalid (the message says why).
//
// changeApply is also where the history is recorded (DiagramEditHistory.js,
// card-diagram-impl.md#history): the state of the draft before and after
// every accepted change, so undo and redo exist for every command, the ones
// below and the ones a series adds, as long as they change the draft through
// changeApply. A command that is typing passes a group key, so the
// keystrokes in one cell or field are one step. The history belongs to the
// session: it starts empty with the store and is dropped with it when a
// save closes the session; nothing of it is written with the data.
//
// Beside the draft the store holds what the editor shows but never saves,
// and none of which the history records:
//
//   path         where the author is in the principal of the edit card
//                (DiagramEditPath.js): a card with one of its rows, fields,
//                cells, properties or lines, or a line selected by itself;
//                [] when nothing is selected. The path is kept canonical
//                (ids), and every change of the draft re-resolves it, so a
//                subject that is gone redirects to its list. selection and
//                cardTab are read off it for the cards and the edit card
//   redirectRuleList   rules of the host, (display, path, store) => path |
//                null, applied after the built-in redirects
//   cell         the cell being typed, with the value it had, so Escape restores it
//   interaction  a drag in progress (a connection being drawn, an end being
//                moved, a node being dragged, the create panel): the edit
//                card is hidden while it lasts
//   create       the create panel, at a canvas position
export class DiagramEditStore {
	rawInitial;
	rawDraft;
	valueInitial;
	valueCurrent;
	documentDraft;
	kind;
	history;
	path = [];
	redirectRuleList = [];
	cell = null;
	interaction = null;
	create = null;
	saveTarget = 'asset';
	message = '';

	// kind: 'diagram', or 'card' for one card outside a canvas. registry: the
	// node registry of the component (node-registry.js): what the draft may
	// hold and what the create panel offers
	constructor(raw, kind = 'diagram', resolve, registry) {
		this.rawInitial = String(raw ?? '');
		this.rawDraft = this.rawInitial;
		this.kind = kind;
		this.resolve = resolve;
		this.registry = registry;
		this.documentDraft = parseDocument(this.rawInitial);
		if (this.documentDraft.errors.length) throw this.documentDraft.errors[0];
		let value = this.documentDraft.toJS();
		if (!value?.version) {
			value = kind === 'diagram' ? diagramLegacyConvert(value) : registry?.cardLegacyConvert ? registry.cardLegacyConvert(value) : value;
			this.documentDraft = parseDocument(stringify(value));
		}
		this.validate(value);
		this.valueInitial = JSON.stringify(value);
		this.valueCurrent = this.valueInitial;
		// two states are one draft when their values are: the text may differ
		// (the initial text keeps its comments and layout) and is restored with it
		this.history = new EditHistory({ isSame: (a, b) => a.valueCurrent === b.valueCurrent });
		makeAutoObservable(this, { documentDraft: false, resolve: false, registry: false, history: false, path: observable.ref, redirectRuleList: false }, { autoBind: true });
	}

	// ---------- the draft ----------

	get isDirty() { return this.valueCurrent !== this.valueInitial || this.saveTarget === 'inline'; }
	get value() { return JSON.parse(this.valueCurrent); }
	get nodes() { const value = this.value; return this.kind === 'diagram' ? value.nodes ?? [] : [value.node]; }
	get connections() { return this.kind === 'diagram' ? this.value.connections ?? [] : []; }
	get report() { return { raw: this.rawDraft, lang: 'yaml', saveTarget: this.saveTarget, isDirty: this.isDirty }; }

	validate(value) {
		return this.kind === 'diagram' ? diagramNormalize(value, this.registry, this.resolve) : cardStandaloneNormalize(value, this.registry);
	}

	// the draft as a state of the history: the YAML document (never changed in
	// place after it became the draft, so an older one can be the draft again),
	// its value and its text
	stateGet() { return { documentDraft: this.documentDraft, valueCurrent: this.valueCurrent, rawDraft: this.rawDraft }; }

	// every change of the draft, the commands below and those of a series:
	// the change is made on a clone of the document, validated, and recorded
	// (groupKey: the typing it is part of, see DiagramEditHistory.js). a
	// refused change leaves the draft and the history as they were
	changeApply(change, { groupKey = null } = {}) {
		const documentNext = this.documentDraft.clone();
		try {
			change(documentNext);
			const value = documentNext.toJS();
			this.validate(value);
			const stateBefore = this.stateGet();
			this.documentDraft = documentNext;
			this.valueCurrent = JSON.stringify(value);
			this.rawDraft = this.valueCurrent === this.valueInitial ? this.rawInitial : documentNext.toString();
			this.history.record(stateBefore, this.stateGet(), groupKey);
			this.message = '';
			this.pathNormalize();
			return true;
		} catch (error) {
			this.message = error.message;
			return false;
		}
	}

	// ---------- undo and redo ----------

	// the draft put back to an earlier (undo) or later (redo) state. not
	// during a gesture, whose end would write into the restored draft. the
	// cell being typed is dropped (its value may be gone), the path is
	// re-resolved against the restored draft, never restored itself
	undo() { return this.historyStep(this.history.undo); }
	redo() { return this.historyStep(this.history.redo); }

	historyStep(step) {
		if (this.interaction) return false;
		const state = step(this.stateGet());
		if (!state) return false;
		this.documentDraft = state.documentDraft;
		this.valueCurrent = state.valueCurrent;
		this.rawDraft = state.rawDraft;
		this.cell = null;
		this.message = '';
		this.pathNormalize();
		return true;
	}

	historyClear() { this.history.clear(); }

	saveTargetSet(value) { if (['asset', 'inline'].includes(value)) this.saveTarget = value; }

	// ---------- queries ----------

	nodeGet(nodeId) { return this.nodes.find(node => node.id === nodeId); }
	connectionGet(connectionId) { return this.connections.find(connection => connection.id === connectionId); }
	schemaGet(nodeId) { return cardSchemaGet(this.nodeGet(nodeId), this.registry); }
	rowsGet(node) { const schema = cardSchemaGet(node, this.registry); return schema ? node.data?.[schema.rowListKey] ?? [] : []; }
	rowGet(nodeId, rowId) { return this.rowsGet(this.nodeGet(nodeId)).find(row => row.id === rowId); }
	handleGet(nodeId, handleId) { return (this.nodeGet(nodeId)?.handles ?? []).find(handle => handle.id === handleId); }
	nodePathGet(nodeId) {
		const index = this.nodes.findIndex(node => node.id === nodeId);
		if (index < 0) throw new Error('Unknown node.');
		return this.kind === 'diagram' ? ['nodes', index] : ['node'];
	}

	get nodeSelected() { return this.selection?.nodeId ? this.nodeGet(this.selection.nodeId) : undefined; }
	get rowSelected() { return this.selection?.rowId ? this.rowGet(this.selection.nodeId, this.selection.rowId) : undefined; }
	get connectionSelected() { return this.selection?.connectionId ? this.connectionGet(this.selection.connectionId) : undefined; }
	get isCardShown() { return Boolean(this.display) && !this.cell && !this.interaction && !this.create; }
	nodeLineListGet(nodeId) { return nodeLineListGet(this, nodeId); }

	// the connections attached to a handle, with the role each has there
	handleConnectionListGet(nodeId, handleId) {
		const result = [];
		for (const connection of this.connections) {
			for (const role of ['source', 'target']) {
				const endpoint = connection[role];
				if (!endpointIsDangling(endpoint) && endpoint.nodeId === nodeId && endpoint.handleId === handleId) result.push({ connection, role });
			}
		}
		return result;
	}

	// the row a handle sits on, by its anchor; null for a header or body handle
	handleRowIdGet(nodeId, handleId) {
		const handle = this.handleGet(nodeId, handleId);
		const schema = this.schemaGet(nodeId);
		if (!handle || !schema) return null;
		const prefix = `${schema.anchorPrefix}/`;
		return handle.anchor.target.startsWith(prefix) ? handle.anchor.target.slice(prefix.length) : null;
	}

	// the sides of an anchor (a row, the header) that hold a handle
	anchorHandleListGet(nodeId, target) {
		return (this.nodeGet(nodeId)?.handles ?? []).filter(handle => handle.anchor.target === target);
	}

	// why an endpoint cannot be attached to a handle in a role, or '' when it can.
	// connectionId names the connection the endpoint belongs to (its own
	// attachment at the handle does not count against a single-attach policy)
	endpointAttachReasonGet(connectionId, role, endpoint) {
		if (endpointIsDangling(endpoint)) return '';
		const handle = this.handleGet(endpoint.nodeId, endpoint.handleId);
		if (!handle) return 'Unknown handle.';
		if (!handleRoleAccepts(handle, role)) return `The handle takes no ${role === 'source' ? 'outgoing' : 'incoming'} connection.`;
		const other = this.connectionGet(connectionId)?.[role === 'source' ? 'target' : 'source'];
		if (other && !endpointIsDangling(other) && other.nodeId === endpoint.nodeId && other.handleId === endpoint.handleId) return 'Both ends of a connection cannot be on the same handle.';
		const attached = this.handleConnectionListGet(endpoint.nodeId, endpoint.handleId).filter(item => item.connection.id !== connectionId);
		if (handle.attachPolicy === 'single' && attached.length) return 'The handle takes one connection.';
		return '';
	}

	// the orientation of a new connection between two handles: the first as
	// the source when it can be, else the other way round; null when neither
	connectionOrient(a, b) {
		if (a.nodeId === b.nodeId && a.handleId === b.handleId) return null;
		for (const [source, target] of [[a, b], [b, a]]) {
			if (!this.endpointAttachReasonGet(null, 'source', source) && !this.endpointAttachReasonGet(null, 'target', target)) return { source, target };
		}
		return null;
	}

	// ---------- the path ----------

	// the path resolved against the draft: its canonical form and the display
	// it stands for (DiagramEditPath.js). what the draft no longer has is
	// redirected away, so the display is always of things that exist
	get route() { return pathResolve(this.path, this, this.redirectRuleList); }
	get display() { return this.route.display; }

	// the selection the cards highlight, read off the display: { nodeId,
	// rowId, fieldId, connectionId, propId } for a card, { connectionId } for
	// a line selected by itself, null for none
	get selection() {
		const display = this.display;
		if (!display) return null;
		if (display.principal === 'connection') return { connectionId: display.connectionId };
		return { nodeId: display.nodeId, rowId: display.rowId, fieldId: display.fieldId, connectionId: display.connectionId, propId: display.propId };
	}

	get cardTab() { return this.display?.tab ?? 'table'; }

	pathSet(path) {
		const route = pathResolve(path, this, this.redirectRuleList);
		const previous = this.display;
		const next = route.display;
		if (this.cell && (this.cell.nodeId !== next?.nodeId || this.cell.rowId !== (next?.rowId ?? null))) this.cell = null;
		// going elsewhere ends the typing step in progress; the path itself is
		// not a step of the history
		if (!pathEquals(route.path, this.path)) { this.path = route.path; this.history.groupClose(); }
		if (previous?.nodeId !== next?.nodeId || previous?.connectionId !== next?.connectionId) this.message = '';
	}

	// the path cut at a segment (a click on the path bar), and one level up (Escape)
	pathGo(index) { this.pathSet(this.path.slice(0, index + 1)); }
	pathUp() { this.pathSet(this.path.slice(0, -1)); }

	// the canonical form of the path after the draft changed: a removed row
	// takes its segment away, a row renamed keeps its id
	pathNormalize() {
		const route = this.route;
		if (!pathEquals(route.path, this.path)) this.path = route.path;
	}

	// ---------- selection (the path in the terms of the cards) ----------

	select(nodeId, { rowId = null, fieldId = null, connectionId = null, propId = null } = {}) {
		this.pathSet(selectionPathBuild(nodeId, { rowId, fieldId, connectionId, propId }));
		this.message = '';
	}

	selectConnection(connectionId) {
		this.cell = null;
		this.pathSet(connectionId ? [{ kind: 'connection', id: connectionId }] : []);
		this.message = '';
	}

	selectionClear() {
		this.pathSet([]);
		this.cell = null;
		this.message = '';
	}

	// a tab is a place in the path: the subject the display has for it, or
	// its list (tabPathGet); a tab without a place is not switched to
	cardTabSet(tab) {
		if (!cardTabList.includes(tab)) return false;
		const path = tabPathGet(this.display, tab);
		if (!path) return false;
		this.pathSet(path);
		return true;
	}

	// a click on a handle rotates through the connections attached to it:
	// the first, the second ..., then the list of the card's lines (none
	// chosen), and the first again
	handleClick(nodeId, handleId) {
		const list = this.handleConnectionListGet(nodeId, handleId).map(item => item.connection.id);
		const display = this.display;
		const current = display?.nodeId === nodeId && display.connectionId ? list.indexOf(display.connectionId) : -1;
		const next = current + 1 < list.length ? list[current + 1] : null;
		this.pathSet(next ? selectionPathBuild(nodeId, { connectionId: next }) : [{ kind: 'node', id: nodeId }, { kind: 'lines' }]);
		this.message = '';
	}

	interactionSet(interaction) { this.interaction = interaction; }
	createOpen(position) { this.create = { position }; this.cell = null; }
	createClose() { this.create = null; }

	// ---------- cells ----------

	// typing in a cell focuses it: a cell of a row, or a property of the card
	cellStart(nodeId, rowId, field) {
		const selection = this.selection;
		if (rowId ? selection?.nodeId !== nodeId || selection?.rowId !== rowId || selection?.fieldId !== field : selection?.nodeId !== nodeId || selection?.propId !== field) this.select(nodeId, rowId ? { rowId, fieldId: field } : { propId: field });
		const node = this.nodeGet(nodeId);
		const item = rowId ? this.rowGet(nodeId, rowId) : node.data;
		this.cell = { nodeId, rowId, field, valueInitial: item[field], isPresent: Object.hasOwn(item, field) };
	}

	// the typing in the cell is one step of the history, closed with the
	// cell; a cell restored by Escape leaves no step (the group ends where
	// it started, DiagramEditHistory.js)
	cellEnd() { this.cell = null; this.history.groupClose(); }
	cellCancel() {
		if (!this.cell) return;
		const { nodeId, rowId, field, valueInitial, isPresent } = this.cell;
		this.fieldSet(nodeId, rowId, field, valueInitial, !isPresent);
		this.cell = null;
		this.history.groupClose();
	}

	// a value of the card (rowId null) or of one of its rows. a typed value
	// (every keystroke reaches the draft) is grouped in the history under its
	// field; a picked one (an enum, a boolean) is a step of its own
	fieldSet(nodeId, rowId, field, value, isDelete = false) {
		const node = this.nodeGet(nodeId);
		const schema = cardSchemaGet(node, this.registry);
		const definitionList = schema ? rowId ? [...schema.fieldList, ...schema.rowPropertyList] : schema.nodePropertyList : rowId ? [] : [{ id: 'label' }, { id: 'name' }, { id: 'description' }];
		const definition = definitionList.find(item => item.id === field);
		if (!definition) return false;
		const groupKey = ['enum', 'bool'].includes(definition.kind) ? null : `field:${nodeId}/${rowId ?? ''}/${field}`;
		return this.changeApply(documentNext => {
			const path = [...this.nodePathGet(nodeId), 'data'];
			if (rowId) {
				const rowIndex = this.rowsGet(node).findIndex(row => row.id === rowId);
				if (rowIndex < 0) throw new Error('Unknown row.');
				path.push(schema.rowListKey, rowIndex);
			}
			path.push(field);
			if (isDelete) documentNext.deleteIn(path);
			else documentNext.setIn(path, value);
		}, { groupKey });
	}

	// ---------- rows ----------

	rowInsert(nodeId, index) {
		const node = this.nodeGet(nodeId);
		const schema = cardSchemaGet(node, this.registry);
		if (!schema) return null;
		const rows = this.rowsGet(node);
		const id = idNext(schema.anchorPrefix, rows);
		const row = { id, ...schema.rowNew(schema.fieldList) };
		const at = Math.max(0, Math.min(rows.length, index ?? rows.length));
		const isChanged = this.changeApply(documentNext => {
			const next = [...rows];
			next.splice(at, 0, row);
			documentNext.setIn([...this.nodePathGet(nodeId), 'data', schema.rowListKey], documentNext.createNode(next));
		});
		if (isChanged) this.select(nodeId, { rowId: id });
		return isChanged ? id : null;
	}

	rowMove(nodeId, rowId, indexTo) {
		const node = this.nodeGet(nodeId);
		const schema = cardSchemaGet(node, this.registry);
		if (!schema) return false;
		const rows = this.rowsGet(node);
		const indexFrom = rows.findIndex(row => row.id === rowId);
		const at = Math.max(0, Math.min(rows.length - 1, indexTo));
		if (indexFrom < 0 || indexFrom === at) return false;
		return this.changeApply(documentNext => {
			const next = [...rows];
			const [row] = next.splice(indexFrom, 1);
			next.splice(at, 0, row);
			documentNext.setIn([...this.nodePathGet(nodeId), 'data', schema.rowListKey], documentNext.createNode(next));
		});
	}

	// a row goes with its handles; their connections are detached (the end
	// stays where the handle was, as a dangling end)
	rowRemove(nodeId, rowId, positionGet) {
		const node = this.nodeGet(nodeId);
		const schema = cardSchemaGet(node, this.registry);
		if (!schema) return false;
		const target = cardRowAnchorBuild(schema, rowId);
		const removed = this.anchorHandleListGet(nodeId, target);
		const isChanged = this.changeApply(documentNext => {
			this.endpointsDetach(documentNext, endpoint => endpoint.nodeId === nodeId && removed.some(handle => handle.id === endpoint.handleId), positionGet);
			const path = this.nodePathGet(nodeId);
			documentNext.setIn([...path, 'data', schema.rowListKey], documentNext.createNode(this.rowsGet(node).filter(row => row.id !== rowId)));
			documentNext.setIn([...path, 'handles'], documentNext.createNode((node.handles ?? []).filter(handle => !removed.includes(handle))));
		});
		if (isChanged) this.pathSet([{ kind: 'node', id: nodeId }, { kind: 'rows' }]);
		return isChanged;
	}

	// ---------- columns (the fields of a generic table) ----------

	columnInsert(nodeId, index) {
		const node = this.nodeGet(nodeId);
		const schema = cardSchemaGet(node, this.registry);
		if (!schema?.isFieldListEditable) return null;
		const fields = node.data.fields ?? [];
		const id = idNext('field', fields);
		const at = Math.max(0, Math.min(fields.length, index ?? fields.length));
		const isChanged = this.changeApply(documentNext => {
			const next = [...fields];
			next.splice(at, 0, { id, label: 'Field' });
			documentNext.setIn([...this.nodePathGet(nodeId), 'data', 'fields'], documentNext.createNode(next));
		});
		if (isChanged) this.select(nodeId, { fieldId: id });
		return isChanged ? id : null;
	}

	columnMove(nodeId, fieldId, indexTo) {
		const node = this.nodeGet(nodeId);
		const schema = cardSchemaGet(node, this.registry);
		if (!schema?.isFieldListEditable) return false;
		const fields = node.data.fields ?? [];
		const indexFrom = fields.findIndex(field => field.id === fieldId);
		const at = Math.max(0, Math.min(fields.length - 1, indexTo));
		if (indexFrom < 0 || indexFrom === at) return false;
		return this.changeApply(documentNext => {
			const next = [...fields];
			const [field] = next.splice(indexFrom, 1);
			next.splice(at, 0, field);
			documentNext.setIn([...this.nodePathGet(nodeId), 'data', 'fields'], documentNext.createNode(next));
		});
	}

	columnRemove(nodeId, fieldId) {
		const node = this.nodeGet(nodeId);
		const schema = cardSchemaGet(node, this.registry);
		if (!schema?.isFieldListEditable) return false;
		const fields = node.data.fields ?? [];
		if (fields.length <= 1) { this.message = 'A table keeps at least one column.'; return false; }
		const isChanged = this.changeApply(documentNext => {
			const path = [...this.nodePathGet(nodeId), 'data'];
			documentNext.setIn([...path, 'fields'], documentNext.createNode(fields.filter(field => field.id !== fieldId)));
			documentNext.setIn([...path, 'rows'], documentNext.createNode(this.rowsGet(node).map(({ [fieldId]: _, ...row }) => row)));
		});
		if (isChanged) this.pathSet([{ kind: 'node', id: nodeId }, { kind: 'fields' }]);
		return isChanged;
	}

	columnLabelSet(nodeId, fieldId, label) {
		const node = this.nodeGet(nodeId);
		const schema = cardSchemaGet(node, this.registry);
		if (!schema?.isFieldListEditable) return false;
		const index = (node.data.fields ?? []).findIndex(field => field.id === fieldId);
		if (index < 0) return false;
		return this.changeApply(documentNext => documentNext.setIn([...this.nodePathGet(nodeId), 'data', 'fields', index, 'label'], label), { groupKey: `column:${nodeId}/${fieldId}` });
	}

	// ---------- handles ----------

	// adds or removes the handle on one side of an anchor (a row, the header).
	// removing a handle that connections use moves them to the handle on the
	// other side of the same anchor when there is one, and detaches them
	// otherwise, their ends dangling where the handle was
	handleSideSet(nodeId, target, side, isPresent, positionGet) {
		const node = this.nodeGet(nodeId);
		if (!node) return false;
		const handles = node.handles ?? [];
		const existing = handles.find(handle => handle.anchor.target === target && handle.anchor.side === side);
		if (isPresent === Boolean(existing)) return true;
		return this.changeApply(documentNext => {
			const path = this.nodePathGet(nodeId);
			if (isPresent) {
				const base = target === 'header' || target === 'body' ? target : target.split('/').slice(1).join('/');
				let id = `${base}-${side}`;
				let suffix = 1;
				while (handles.some(handle => handle.id === id)) id = `${base}-${side}-${suffix++}`;
				documentNext.setIn([...path, 'handles'], documentNext.createNode([...handles, { id, direction: 'both', anchor: { target, side, offset: 0.5 } }]));
				return;
			}
			const other = handles.find(handle => handle.anchor.target === target && handle.anchor.side !== side);
			const attached = this.handleConnectionListGet(nodeId, existing.id);
			if (other && attached.length) {
				for (const { connection, role } of attached) {
					if (this.endpointAttachReasonGet(connection.id, role, { nodeId, handleId: other.id })) throw new Error(`Connection "${connection.id}" cannot move to the handle on the other side.`);
					const index = this.connections.findIndex(item => item.id === connection.id);
					documentNext.setIn(['connections', index, role], documentNext.createNode({ nodeId, handleId: other.id }));
				}
			} else {
				this.endpointsDetach(documentNext, endpoint => endpoint.nodeId === nodeId && endpoint.handleId === existing.id, positionGet);
			}
			documentNext.setIn([...path, 'handles'], documentNext.createNode(handles.filter(handle => handle !== existing)));
		});
	}

	handleAttachPolicySet(nodeId, handleId, policy) {
		if (!attachPolicyList.includes(policy)) return false;
		const index = (this.nodeGet(nodeId)?.handles ?? []).findIndex(handle => handle.id === handleId);
		if (index < 0) return false;
		return this.changeApply(documentNext => {
			const path = [...this.nodePathGet(nodeId), 'handles', index, 'attachPolicy'];
			if (policy === 'multiple') documentNext.deleteIn(path);
			else documentNext.setIn(path, policy);
		});
	}

	// every endpoint the predicate names becomes a dangling end at the place
	// positionGet reports for its handle (a little away from the card), or at
	// the node's position when the canvas cannot tell
	endpointsDetach(documentNext, predicate, positionGet) {
		this.connections.forEach((connection, index) => {
			for (const role of ['source', 'target']) {
				const endpoint = connection[role];
				if (endpointIsDangling(endpoint) || !predicate(endpoint)) continue;
				const placed = positionGet?.(endpoint.nodeId, endpoint.handleId);
				const node = this.nodeGet(endpoint.nodeId);
				const position = placed
					? { x: Math.round(placed.x + (placed.side === 'left' ? -48 : placed.side === 'right' ? 48 : 0)), y: Math.round(placed.y + (placed.side === 'top' ? -48 : placed.side === 'bottom' ? 48 : 0)) }
					: { x: node?.position?.x ?? 0, y: node?.position?.y ?? 0 };
				documentNext.setIn(['connections', index, role], documentNext.createNode({ position }));
			}
		});
	}

	// ---------- nodes ----------

	// a node from the create entries of the registry, at a canvas position
	nodeAdd(entryId, position) {
		if (this.kind !== 'diagram') return null;
		const entry = this.registry?.createEntryList.find(item => item.id === entryId);
		if (!entry || entry.isConnection) return null;
		const node = { ...entry.create(prefix => idNext(prefix, this.nodes)), position: { x: Math.round(position.x), y: Math.round(position.y) } };
		const isChanged = this.changeApply(documentNext => {
			if (!documentNext.has('nodes')) documentNext.set('nodes', documentNext.createNode([]));
			documentNext.addIn(['nodes'], documentNext.createNode(node));
		});
		if (isChanged) this.select(node.id);
		return isChanged ? node.id : null;
	}

	// a node goes alone: the connections on its handles stay, their ends
	// dangling where the handles were
	nodeRemove(nodeId, positionGet) {
		if (this.kind !== 'diagram') return false;
		const isChanged = this.changeApply(documentNext => {
			this.endpointsDetach(documentNext, endpoint => endpoint.nodeId === nodeId, positionGet);
			documentNext.deleteIn(this.nodePathGet(nodeId));
		});
		// the node is the principal of the card it was removed from; another
		// card's path is only re-resolved (its lines may have come loose)
		if (isChanged && !(this.display?.nodeId && this.display.nodeId !== nodeId)) this.selectionClear();
		return isChanged;
	}

	positionRememberSet(nodeId, isRemembered, position) {
		const node = this.nodeGet(nodeId);
		if (node?.isPositionLocked) return false;
		return this.changeApply(documentNext => {
			if (isRemembered && !position) throw new Error('The current node position is not available.');
			documentNext.setIn([...this.nodePathGet(nodeId), 'position'], isRemembered ? { x: Math.round(position.x), y: Math.round(position.y) } : 'auto');
		});
	}

	positionLockSet(nodeId, isLocked, position) {
		return this.changeApply(documentNext => {
			const path = this.nodePathGet(nodeId);
			if (isLocked) {
				if (!position) throw new Error('The current node position is not available.');
				documentNext.setIn([...path, 'position'], { x: Math.round(position.x), y: Math.round(position.y) });
			}
			documentNext.setIn([...path, 'isPositionLocked'], isLocked);
		});
	}

	nodeMove(nodeId, position) {
		const node = this.nodeGet(nodeId);
		if (!node || node.isPositionLocked || !node.position || node.position === 'auto') return false;
		return this.changeApply(documentNext => documentNext.setIn([...this.nodePathGet(nodeId), 'position'], { x: Math.round(position.x), y: Math.round(position.y) }));
	}

	// ---------- connections ----------

	connectionCreate(source, target) {
		if (this.kind !== 'diagram') return null;
		const id = idNext('connection', this.connections);
		const connection = { id, source, target };
		const isChanged = this.changeApply(documentNext => {
			for (const role of ['source', 'target']) {
				const reason = this.endpointAttachReasonGet(id, role, connection[role]);
				if (reason) throw new Error(reason);
			}
			if (!documentNext.has('connections')) documentNext.set('connections', documentNext.createNode([]));
			documentNext.addIn(['connections'], documentNext.createNode(connection));
		});
		return isChanged ? id : null;
	}

	// a connection with two free ends, from the create panel
	connectionCreateDangling(position) {
		const x = Math.round(position.x);
		const y = Math.round(position.y);
		const id = this.connectionCreate({ position: { x, y } }, { position: { x: x + 160, y } });
		if (id) this.selectConnection(id);
		return id;
	}

	// one end of a connection: attached to a handle { nodeId, handleId }, or
	// dangling { position }
	connectionEndpointSet(connectionId, role, endpoint) {
		const index = this.connections.findIndex(connection => connection.id === connectionId);
		if (index < 0) return false;
		const reason = this.endpointAttachReasonGet(connectionId, role, endpoint);
		if (reason) { this.message = reason; return false; }
		const value = endpointIsDangling(endpoint) ? { position: { x: Math.round(endpoint.position.x), y: Math.round(endpoint.position.y) } } : { nodeId: endpoint.nodeId, handleId: endpoint.handleId };
		return this.changeApply(documentNext => documentNext.setIn(['connections', index, role], documentNext.createNode(value)));
	}

	// the presentation of a connection: label, lineType, stroke, strokeWidth,
	// strokeDash (a preset name), markerStart, markerEnd, isAnimated. the
	// typed and dragged values (the label, the color picker, the width) are
	// grouped in the history; a picked one is a step of its own
	connectionSet(connectionId, field, value) {
		const index = this.connections.findIndex(connection => connection.id === connectionId);
		if (index < 0) return false;
		const groupKey = ['label', 'stroke', 'strokeWidth'].includes(field) ? `connection:${connectionId}/${field}` : null;
		return this.changeApply(documentNext => {
			const path = ['connections', index];
			switch (field) {
				case 'label': documentNext.setIn([...path, 'label', 'text'], String(value ?? '')); break;
				case 'lineType':
					if (!lineTypeList.includes(value)) throw new Error('Unknown line type.');
					documentNext.setIn([...path, 'renderer'], documentNext.createNode({ type: value }));
					if (value !== 'polyline') documentNext.deleteIn([...path, 'route']);
					break;
				case 'stroke': documentNext.setIn([...path, 'style', 'stroke'], String(value)); break;
				case 'strokeWidth': {
					const width = Number(value);
					if (!Number.isFinite(width) || width <= 0) throw new Error('The width must be a positive number.');
					documentNext.setIn([...path, 'style', 'strokeWidth'], width);
					break;
				}
				case 'strokeDash': {
					const preset = strokeDashList.find(item => item.id === value);
					if (!preset) throw new Error('Unknown dash preset.');
					if (preset.value) documentNext.setIn([...path, 'style', 'strokeDasharray'], preset.value);
					else if (documentNext.hasIn([...path, 'style', 'strokeDasharray'])) documentNext.deleteIn([...path, 'style', 'strokeDasharray']);
					break;
				}
				case 'markerStart':
				case 'markerEnd':
					if (!markerTypeList.includes(value)) throw new Error('Unknown marker.');
					documentNext.setIn([...path, field], value);
					break;
				case 'isAnimated': documentNext.setIn([...path, 'isAnimated'], Boolean(value)); break;
				default: throw new Error(`Unknown connection field "${field}".`);
			}
		}, { groupKey });
	}

	connectionRemove(connectionId) {
		const isChanged = this.changeApply(documentNext => {
			const index = this.connections.findIndex(connection => connection.id === connectionId);
			if (index < 0) throw new Error('Unknown connection.');
			documentNext.deleteIn(['connections', index]);
		});
		if (isChanged) {
			const nodeId = this.display?.nodeId;
			if (nodeId) this.pathSet([{ kind: 'node', id: nodeId }, { kind: 'lines' }]);
			else this.selectionClear();
		}
		return isChanged;
	}

	// the dash preset a connection's style amounts to
	strokeDashGet(connection) {
		const value = String(connection?.style?.strokeDasharray ?? '');
		return (strokeDashList.find(item => item.value === value) ?? (value ? { id: 'dashed' } : strokeDashList[0])).id;
	}
}

function idNext(prefix, items) {
	let index = 1;
	while (items.some(item => item.id === `${prefix}-${index}`)) index += 1;
	return `${prefix}-${index}`;
}
