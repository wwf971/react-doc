import { makeAutoObservable } from 'mobx';
import { parseDocument, stringify } from 'yaml';
import { diagramLegacyConvert, diagramNormalize, dataverseStandaloneNormalize } from './DiagramERData.js';
import { powerAutomateNodeFields } from './PowerAutomateNodeData.js';
import { businessRuleNodeFields } from './BusinessRuleNodeData.js';

export const dataverseEditModeList = [{ id: 'visual', label: 'Visual', description: 'Edit diagram cards, properties and connections', isDefault: true }];
export const dataverseKeyList = ['', 'PK', 'FK'];
export const dataverseTypeList = ['Text', 'Multiline Text', 'Whole Number', 'Decimal Number', 'Floating Point Number', 'Currency', 'Date', 'Date and Time', 'Choice', 'Choices', 'Lookup', 'Customer', 'Owner', 'Boolean', 'Unique identifier', 'UUID', 'String'];

export class DataverseEditStore {
	rawInitial;
	rawDraft;
	valueInitial;
	valueCurrent;
	documentDraft;
	kind;
	focus = null;
	cell = null;
	saveTarget = 'asset';
	message = '';

	constructor(raw, kind = 'diagram', resolve) {
		this.rawInitial = String(raw ?? '');
		this.rawDraft = this.rawInitial;
		this.kind = kind;
		this.resolve = resolve;
		this.documentDraft = parseDocument(this.rawInitial);
		if (this.documentDraft.errors.length) throw this.documentDraft.errors[0];
		let value = this.documentDraft.toJS();
		if (!value?.version) {
			value = kind === 'diagram' ? diagramLegacyConvert(value) : { version: 1, node: { id: value.entity?.id ?? value.id ?? 'entity', renderer: { type: 'dataverse-table' }, data: value.entity ?? value } };
			this.documentDraft = parseDocument(stringify(value));
		}
		this.validate(value);
		this.valueInitial = JSON.stringify(value);
		this.valueCurrent = this.valueInitial;
		makeAutoObservable(this, { documentDraft: false, resolve: false }, { autoBind: true });
	}

	get isDirty() { return this.valueCurrent !== this.valueInitial || this.saveTarget === 'inline'; }
	get nodes() { const value = JSON.parse(this.valueCurrent); return this.kind === 'diagram' ? value.nodes : [value.node]; }
	get nodeFocused() { return this.nodes.find(node => node.id === this.focus?.nodeId); }
	get rowFocused() { return this.rowsGet(this.nodeFocused).find(row => row.id === this.focus?.rowId); }
	get connections() { return JSON.parse(this.valueCurrent).connections ?? []; }
	get connectionFocused() { return this.connections.find(connection => connection.id === this.focus?.connectionId); }
	rowsGet(node) { return node?.data?.[resourceFieldsGet(node?.renderer.type) ? 'properties' : 'columns'] ?? []; }

	validate(value) {
		return this.kind === 'diagram' ? diagramNormalize(value, this.resolve) : dataverseStandaloneNormalize(value);
	}

	focusSet(nodeId, rowId = null) {
		if (this.focus?.nodeId !== nodeId || this.focus?.rowId !== rowId) this.cell = null;
		this.focus = nodeId ? { nodeId, rowId } : null;
		this.message = '';
	}

	connectionFocusSet(connectionId) {
		this.cell = null;
		this.focus = connectionId ? { connectionId } : null;
		this.message = '';
	}

	cellStart(nodeId, rowId, field) {
		this.focusSet(nodeId, rowId);
		const node = this.nodeFocused;
		const item = rowId ? this.rowsGet(node).find(row => row.id === rowId) : node.data;
		this.cell = { nodeId, rowId, field, valueInitial: item[field], isPresent: Object.hasOwn(item, field) };
	}

	cellEnd() { this.cell = null; }
	cellCancel() {
		if (!this.cell) return;
		const { nodeId, rowId, field, valueInitial, isPresent } = this.cell;
		this.fieldSet(nodeId, rowId, field, valueInitial, !isPresent);
		this.cell = null;
	}

	nodePathGet(nodeId) {
		const index = this.nodes.findIndex(node => node.id === nodeId);
		if (index < 0) throw new Error('Unknown table.');
		return this.kind === 'diagram' ? ['nodes', index] : ['node'];
	}

	changeApply(change) {
		const documentNext = this.documentDraft.clone();
		try {
			change(documentNext);
			const value = documentNext.toJS();
			this.validate(value);
			this.documentDraft = documentNext;
			this.valueCurrent = JSON.stringify(value);
			this.rawDraft = this.valueCurrent === this.valueInitial ? this.rawInitial : documentNext.toString();
			this.message = '';
			return true;
		} catch (error) {
			this.message = error.message;
			return false;
		}
	}

	fieldSet(nodeId, rowId, field, value, isDelete = false) {
		const node = this.nodes.find(item => item.id === nodeId);
		const fields = resourceFieldsGet(node?.renderer.type);
		const allowed = fields ? rowId ? ['name', 'value', 'description'] : fields.map(item => item.id) : rowId ? ['name', 'nameLogical', 'type', 'key', 'description', 'isRequired'] : ['name', 'nameLogical', 'description'];
		if (!allowed.includes(field)) return false;
		return this.changeApply(documentNext => {
			const path = [...this.nodePathGet(nodeId), 'data'];
			if (rowId) {
				const rowIndex = this.rowsGet(node).findIndex(row => row.id === rowId);
				if (rowIndex < 0) throw new Error('Unknown row.');
				path.push(fields ? 'properties' : 'columns', rowIndex);
			}
			path.push(field);
			if (isDelete) documentNext.deleteIn(path);
			else documentNext.setIn(path, value);
		});
	}

	handleModeGet(nodeId, rowId) {
		const node = this.nodes.find(item => item.id === nodeId);
		const handles = node?.handles ?? [];
		const target = `${resourceFieldsGet(node?.renderer.type) ? 'property' : 'column'}/${rowId}`;
		const sides = new Set(handles.filter(handle => handle.anchor.target === target).map(handle => handle.anchor.side));
		return sides.has('left') && sides.has('right') ? 'both' : sides.has('left') ? 'left' : sides.has('right') ? 'right' : 'none';
	}

	handleModeSet(nodeId, rowId, mode) {
		if (!['none', 'left', 'right', 'both'].includes(mode)) return false;
		return this.changeApply(documentNext => {
			const path = this.nodePathGet(nodeId);
			const node = documentNext.getIn(path).toJSON();
			const target = `${resourceFieldsGet(node.renderer.type) ? 'property' : 'column'}/${rowId}`;
			const sides = mode === 'both' ? ['left', 'right'] : mode === 'none' ? [] : [mode];
			const handles = node.handles ?? [];
			const selected = handles.filter(handle => handle.anchor.target === target);
			const missing = sides.filter(side => !selected.some(handle => handle.anchor.side === side));
			const removed = selected.filter(handle => !sides.includes(handle.anchor.side));
			if (missing.length === 1 && removed.length === selected.length && sides.length === 1) {
				for (const handle of removed) handle.anchor.side = missing[0];
				if (removed.length) missing.length = 0;
			}
			const value = documentNext.toJS();
			for (const handle of removed.filter(handle => !sides.includes(handle.anchor.side))) {
				if ((value.connections ?? []).some(connection => ['source', 'target'].some(role => connection[role].nodeId === nodeId && connection[role].handleId === handle.id))) {
					throw new Error(`Handle "${handle.id}" is connected. Move it to the other side, or remove/reassign its connections in source first.`);
				}
			}
			const next = handles.filter(handle => handle.anchor.target !== target || sides.includes(handle.anchor.side));
			for (const side of missing) {
				let suffix = 1;
				let id = `${rowId}-${side}`;
				while (handles.some(handle => handle.id === id)) id = `${rowId}-${side}-${suffix++}`;
				next.push({ id, direction: 'both', anchor: { target, side, offset: 0.5 } });
			}
			documentNext.setIn([...path, 'handles'], next);
		});
	}

	saveTargetSet(value) { if (['asset', 'inline'].includes(value)) this.saveTarget = value; }

	propertyAdd(nodeId) {
		const node = this.nodes.find(item => item.id === nodeId);
		if (!resourceFieldsGet(node?.renderer.type)) return false;
		const rows = this.rowsGet(node);
		const id = idNext('property', rows);
		return this.changeApply(documentNext => documentNext.setIn([...this.nodePathGet(nodeId), 'data', 'properties'], documentNext.createNode([...rows, { id, name: 'Property', value: '' }])));
	}

	propertyRemove(nodeId, rowId) {
		const node = this.nodes.find(item => item.id === nodeId);
		if (!resourceFieldsGet(node?.renderer.type)) return false;
		const isChanged = this.changeApply(documentNext => {
			const handles = node.handles ?? [];
			const removed = handles.filter(handle => handle.anchor.target === `property/${rowId}`);
			if (this.connections.some(connection => ['source', 'target'].some(role => connection[role].nodeId === nodeId && removed.some(handle => handle.id === connection[role].handleId)))) throw new Error('Remove the property connections first.');
			const path = this.nodePathGet(nodeId);
			documentNext.setIn([...path, 'data', 'properties'], documentNext.createNode(this.rowsGet(node).filter(row => row.id !== rowId)));
			documentNext.setIn([...path, 'handles'], documentNext.createNode(handles.filter(handle => !removed.includes(handle))));
		});
		if (isChanged) this.focusSet(nodeId);
		return isChanged;
	}

	nodeAdd(type) {
		if (this.kind !== 'diagram' || !resourceFieldsGet(type)) return false;
		const id = idNext(type, this.nodes);
		const data = Object.fromEntries(resourceFieldsGet(type).map(field => [field.id, field.defaultValue ?? '']));
		data.name = type === 'power-automate' ? 'Flow step' : 'Business rule';
		data.properties = [];
		const node = { id, renderer: { type }, data, handles: [
			{ id: 'in', direction: 'in', anchor: { target: 'header', side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { target: 'header', side: 'right' } },
		] };
		return this.changeApply(documentNext => documentNext.addIn(['nodes'], documentNext.createNode(node)));
	}

	nodeRemove(nodeId) {
		if (this.kind !== 'diagram') return false;
		const isChanged = this.changeApply(documentNext => {
			if (this.connections.some(connection => connection.source.nodeId === nodeId || connection.target.nodeId === nodeId)) throw new Error('Remove the node connections first.');
			documentNext.deleteIn(this.nodePathGet(nodeId));
		});
		if (isChanged) this.focusSet(null);
		return isChanged;
	}

	connectionAdd() {
		if (this.kind !== 'diagram') return false;
		return this.changeApply(documentNext => {
			const endpoints = role => this.nodes.flatMap(node => (node.handles ?? []).filter(handle => handle.direction === role || handle.direction === 'both').map(handle => ({ nodeId: node.id, handleId: handle.id })));
			const source = endpoints('out')[0];
			const target = endpoints('in').find(endpoint => endpoint.nodeId !== source?.nodeId);
			if (!source || !target) throw new Error('A connection needs an output and an input on different nodes.');
			const connection = { id: idNext('connection', this.connections), source, target, label: { text: 'Next' } };
			if (!documentNext.has('connections')) documentNext.set('connections', documentNext.createNode([]));
			documentNext.addIn(['connections'], documentNext.createNode(connection));
		});
	}

	connectionSet(connectionId, field, value) {
		if (!['label', 'source', 'target'].includes(field)) return false;
		return this.changeApply(documentNext => {
			const index = this.connections.findIndex(connection => connection.id === connectionId);
			if (index < 0) throw new Error('Unknown connection.');
			const path = ['connections', index, field];
			if (field === 'label') path.push('text');
			documentNext.setIn(path, documentNext.createNode(value));
		});
	}

	connectionRemove(connectionId) {
		const isChanged = this.changeApply(documentNext => {
			const index = this.connections.findIndex(connection => connection.id === connectionId);
			if (index < 0) throw new Error('Unknown connection.');
			documentNext.deleteIn(['connections', index]);
		});
		if (isChanged) this.connectionFocusSet(null);
		return isChanged;
	}

	positionRememberSet(nodeId, isRemembered, position) {
		const node = this.nodes.find(item => item.id === nodeId);
		if (node?.isPositionLocked) return false;
		return this.changeApply(documentNext => {
			if (isRemembered && !position) throw new Error('The current node position is not available.');
			documentNext.setIn([...this.nodePathGet(nodeId), 'position'], isRemembered ? position : 'auto');
		});
	}

	positionLockSet(nodeId, isLocked, position) {
		return this.changeApply(documentNext => {
			const path = this.nodePathGet(nodeId);
			if (isLocked) {
				if (!position) throw new Error('The current node position is not available.');
				documentNext.setIn([...path, 'position'], position);
			}
			documentNext.setIn([...path, 'isPositionLocked'], isLocked);
		});
	}

	nodeMove(nodeId, position) {
		const node = this.nodes.find(item => item.id === nodeId);
		if (!node || node.isPositionLocked || !node.position || node.position === 'auto') return false;
		return this.changeApply(documentNext => documentNext.setIn([...this.nodePathGet(nodeId), 'position'], position));
	}

	get report() {
		return { raw: this.rawDraft, lang: 'yaml', saveTarget: this.saveTarget, isDirty: this.isDirty };
	}
}

export function resourceFieldsGet(type) {
	return type === 'power-automate' ? powerAutomateNodeFields : type === 'business-rule' ? businessRuleNodeFields : undefined;
}

function idNext(prefix, items) {
	let index = 1;
	while (items.some(item => item.id === `${prefix}-${index}`)) index += 1;
	return `${prefix}-${index}`;
}