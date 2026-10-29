import { lineTypeList, markerTypeList, endpointIsDangling } from './DiagramERData.js';
import { cardSchemaGet, cardRowAnchorBuild } from './TableCardSchema.js';
import { strokeDashList } from './DiagramEditStore.js';

// The content of the edit card for the current selection (DiagramEditCard.jsx),
// as data: tabs, each with sections of properties and actions. The card
// renders it with the host's PropEditor, or with a plain form without one.
//
//   tab        { id, label, isDisabled, sectionList }
//   section    { id, label, propertyList, actionList }
//   property   { id, label, kind: text | enum | bool | number | color, value,
//                values?, valueLabels?, isSearchable?, isMultiline?, isReadOnly?,
//                min?, max?, step?, set(value) -> boolean }
//   action     { id, label, kind?: 'danger', isDisabled?, act() }
const lineTypeLabels = { smoothstep: 'Smooth step', step: 'Step', bezier: 'Curve', straight: 'Straight', polyline: 'Polyline' };
const markerLabels = { none: 'None', arrow: 'Arrow', arrowClosed: 'Filled arrow' };

export function cardModelBuild(editor) {
	const { store } = editor;
	const selection = store.selection;
	if (!selection) return null;
	const tabList = [];
	const node = selection.nodeId ? store.nodeGet(selection.nodeId) : undefined;
	const connection = selection.connectionId ? store.connectionGet(selection.connectionId) : undefined;
	const change = operation => { let result = false; editor.change(() => { result = operation(); }); return result; };
	const positionGet = editor.handlePositionGet;
	let title = '';
	if (node) {
		const nodeId = node.id;
		const schema = cardSchemaGet(node);
		const rows = store.rowsGet(node);
		const row = selection.rowId ? rows.find(item => item.id === selection.rowId) : undefined;
		const rowIndex = row ? rows.indexOf(row) : -1;
		const field = selection.fieldId ? schema?.fieldList.find(item => item.id === selection.fieldId) : undefined;
		const fieldIndex = field ? schema.fieldList.indexOf(field) : -1;
		title = node.data.name ?? node.data.label ?? nodeId;
		const propertyOf = (definition, item, setter) => ({
			id: definition.id, label: definition.label, kind: definition.kind, value: item?.[definition.id] ?? (definition.kind === 'bool' ? false : ''),
			values: definition.values, valueLabels: definition.valueLabels, isSearchable: definition.isSearchable, isMultiline: definition.isMultiline,
			set: value => change(() => setter(definition.id, value)),
		});
		const handleSection = (target, label, isAllowed) => {
			if (!isAllowed) return null;
			const handles = store.anchorHandleListGet(nodeId, target);
			const propertyList = ['left', 'right'].map(side => ({
				id: `handle-${side}`, label: `${side === 'left' ? 'Left' : 'Right'} handle`, kind: 'bool', value: handles.some(handle => handle.anchor.side === side),
				set: value => change(() => store.handleSideSet(nodeId, target, side, value, positionGet)),
			}));
			for (const handle of handles) {
				propertyList.push({
					id: `policy-${handle.id}`, label: `${handle.anchor.side === 'left' ? 'Left' : 'Right'} accepts`, kind: 'enum', value: handle.attachPolicy ?? 'multiple',
					values: ['multiple', 'single'], valueLabels: { multiple: 'Many lines', single: 'One line' },
					set: value => change(() => store.handleAttachPolicySet(nodeId, handle.id, value)),
				});
			}
			return { id: `handles-${target.replace('/', '-')}`, label, propertyList, actionList: [] };
		};
		// ---- table ----
		const tableSectionList = [];
		const nodePropertyList = schema ? schema.nodePropertyList : [{ id: 'label', label: 'Label', kind: 'text' }, { id: 'description', label: 'Description', kind: 'text', isMultiline: true }];
		tableSectionList.push({ id: 'node', label: schema?.labelNode ?? 'Node', propertyList: nodePropertyList.map(definition => propertyOf(definition, node.data, (id, value) => store.fieldSet(nodeId, null, id, value))), actionList: [] });
		const header = schema ? handleSection('header', 'Title handles', schema.isHeaderHandleAllowed(node.data)) : null;
		if (header) tableSectionList.push(header);
		if (store.kind === 'diagram') {
			const isRemembered = Boolean(node.position && node.position !== 'auto');
			tableSectionList.push({ id: 'position', label: 'Position', propertyList: [
				{ id: 'remember', label: 'Remember', kind: 'bool', value: isRemembered, isReadOnly: Boolean(node.isPositionLocked), set: value => change(() => store.positionRememberSet(nodeId, value, editor.nodePositionGet(nodeId))) },
				{ id: 'lock', label: 'Locked', kind: 'bool', value: Boolean(node.isPositionLocked), set: value => change(() => store.positionLockSet(nodeId, value, editor.nodePositionGet(nodeId))) },
			], actionList: [] });
		}
		tableSectionList.push({ id: 'node-actions', label: '', propertyList: [], actionList: [
			...(schema ? [{ id: 'row-add', label: `Add ${schema.labelRow.toLowerCase()}`, act: () => change(() => Boolean(store.rowInsert(nodeId))) }] : []),
			...(schema?.isFieldListEditable ? [{ id: 'column-add', label: 'Add column', act: () => change(() => Boolean(store.columnInsert(nodeId))) }] : []),
			...(store.kind === 'diagram' ? [{ id: 'node-remove', label: 'Remove node', kind: 'danger', act: () => change(() => store.nodeRemove(nodeId, positionGet)) }] : []),
		] });
		tabList.push({ id: 'table', label: schema?.labelNode ?? 'Node', isDisabled: false, sectionList: tableSectionList });
		// ---- row ----
		if (schema) {
			const rowSectionList = [];
			if (row) {
				rowSectionList.push({ id: 'row', label: schema.labelRow, propertyList: [...schema.fieldList, ...schema.rowPropertyList].map(definition => propertyOf(definition, row, (id, value) => store.fieldSet(nodeId, row.id, id, value))), actionList: [] });
				const handles = handleSection(cardRowAnchorBuild(schema, row.id), 'Handles', schema.isRowHandleAllowed?.(node.data) ?? true);
				if (handles) rowSectionList.push(handles);
				rowSectionList.push({ id: 'row-actions', label: '', propertyList: [], actionList: [
					{ id: 'insert-above', label: 'Insert above', act: () => change(() => Boolean(store.rowInsert(nodeId, rowIndex))) },
					{ id: 'insert-below', label: 'Insert below', act: () => change(() => Boolean(store.rowInsert(nodeId, rowIndex + 1))) },
					{ id: 'move-up', label: 'Move up', isDisabled: rowIndex <= 0, act: () => change(() => store.rowMove(nodeId, row.id, rowIndex - 1)) },
					{ id: 'move-down', label: 'Move down', isDisabled: rowIndex >= rows.length - 1, act: () => change(() => store.rowMove(nodeId, row.id, rowIndex + 1)) },
					{ id: 'row-remove', label: `Remove ${schema.labelRow.toLowerCase()}`, kind: 'danger', act: () => change(() => store.rowRemove(nodeId, row.id, positionGet)) },
				] });
			}
			tabList.push({ id: 'row', label: 'Row', isDisabled: !row, sectionList: rowSectionList });
			// ---- column ----
			const columnSectionList = [];
			if (field) {
				const isFixed = !schema.isFieldListEditable;
				columnSectionList.push({ id: 'column', label: 'Column', note: isFixed ? `The columns of a ${schema.labelNode.toLowerCase()} card are fixed.` : '', propertyList: [
					{ id: 'label', label: 'Label', kind: 'text', value: field.label, isReadOnly: isFixed, set: value => change(() => store.columnLabelSet(nodeId, field.id, value)) },
				], actionList: [] });
				columnSectionList.push({ id: 'column-actions', label: '', propertyList: [], actionList: [
					{ id: 'insert-left', label: 'Insert left', isDisabled: isFixed, act: () => change(() => Boolean(store.columnInsert(nodeId, fieldIndex))) },
					{ id: 'insert-right', label: 'Insert right', isDisabled: isFixed, act: () => change(() => Boolean(store.columnInsert(nodeId, fieldIndex + 1))) },
					{ id: 'move-left', label: 'Move left', isDisabled: isFixed || fieldIndex <= 0, act: () => change(() => store.columnMove(nodeId, field.id, fieldIndex - 1)) },
					{ id: 'move-right', label: 'Move right', isDisabled: isFixed || fieldIndex >= schema.fieldList.length - 1, act: () => change(() => store.columnMove(nodeId, field.id, fieldIndex + 1)) },
					{ id: 'column-remove', label: 'Remove column', kind: 'danger', isDisabled: isFixed, act: () => change(() => store.columnRemove(nodeId, field.id)) },
				] });
			}
			tabList.push({ id: 'column', label: 'Column', isDisabled: !field, sectionList: columnSectionList });
			// ---- cell ----
			const cellSectionList = [];
			if (row && field) {
				cellSectionList.push({ id: 'cell', label: 'Cell', propertyList: [
					{ id: 'row', label: 'Row', kind: 'text', value: row.name ?? row[schema.fieldList[0].id] ?? row.id, isReadOnly: true, set: () => false },
					{ id: 'column', label: 'Column', kind: 'text', value: field.label, isReadOnly: true, set: () => false },
					propertyOf({ ...field, label: 'Value' }, row, (id, value) => store.fieldSet(nodeId, row.id, id, value)),
				], actionList: [] });
			}
			tabList.push({ id: 'cell', label: 'Cell', isDisabled: !(row && field), sectionList: cellSectionList });
		}
	}
	// ---- line ----
	const lineSectionList = [];
	if (connection) {
		if (!node) title = connection.label?.text ? `${connection.label.text} (${connection.id})` : connection.id;
		const lineSet = (field, value) => change(() => store.connectionSet(connection.id, field, value));
		lineSectionList.push({ id: 'line', label: 'Line', propertyList: [
			{ id: 'label', label: 'Label', kind: 'text', value: connection.label?.text ?? '', set: value => lineSet('label', value) },
			{ id: 'lineType', label: 'Line type', kind: 'enum', value: connection.renderer?.type ?? 'smoothstep', values: lineTypeList, valueLabels: lineTypeLabels, set: value => lineSet('lineType', value) },
			{ id: 'stroke', label: 'Color', kind: 'color', value: connection.style?.stroke ?? '#64748b', set: value => lineSet('stroke', value) },
			{ id: 'strokeWidth', label: 'Thickness', kind: 'number', value: connection.style?.strokeWidth ?? 1.5, min: 0.5, max: 12, step: 0.5, set: value => lineSet('strokeWidth', value) },
			{ id: 'strokeDash', label: 'Dash', kind: 'enum', value: store.strokeDashGet(connection), values: strokeDashList.map(item => item.id), valueLabels: Object.fromEntries(strokeDashList.map(item => [item.id, item.label])), set: value => lineSet('strokeDash', value) },
			{ id: 'markerStart', label: 'Start arrow', kind: 'enum', value: connection.markerStart ?? 'none', values: markerTypeList, valueLabels: markerLabels, set: value => lineSet('markerStart', value) },
			{ id: 'markerEnd', label: 'End arrow', kind: 'enum', value: connection.markerEnd ?? 'arrowClosed', values: markerTypeList, valueLabels: markerLabels, set: value => lineSet('markerEnd', value) },
			{ id: 'isAnimated', label: 'Animated', kind: 'bool', value: Boolean(connection.isAnimated), set: value => lineSet('isAnimated', value) },
		], actionList: [] });
		const endText = endpoint => endpointIsDangling(endpoint) ? `free at ${endpoint.position.x}, ${endpoint.position.y}` : `${store.nodeGet(endpoint.nodeId)?.data?.name ?? endpoint.nodeId} / ${endpoint.handleId}`;
		lineSectionList.push({ id: 'ends', label: 'Ends', note: 'Drag an end of the line to move it to another handle, or let it go free.', propertyList: [
			{ id: 'source', label: 'From', kind: 'text', value: endText(connection.source), isReadOnly: true, set: () => false },
			{ id: 'target', label: 'To', kind: 'text', value: endText(connection.target), isReadOnly: true, set: () => false },
		], actionList: [] });
		lineSectionList.push({ id: 'line-actions', label: '', propertyList: [], actionList: [
			{ id: 'connection-remove', label: 'Remove connection', kind: 'danger', act: () => change(() => store.connectionRemove(connection.id)) },
		] });
	}
	if (connection || node) tabList.push({ id: 'line', label: 'Line', isDisabled: !connection, sectionList: lineSectionList });
	return { title, tabList, tabId: tabList.some(tab => tab.id === store.cardTab && !tab.isDisabled) ? store.cardTab : tabList.find(tab => !tab.isDisabled)?.id };
}
