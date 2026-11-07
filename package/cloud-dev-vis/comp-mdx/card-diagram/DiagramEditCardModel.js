import { lineTypeList, markerTypeList, endpointIsDangling } from './DiagramERData.js';
import { cardSchemaGet, cardRowAnchorBuild } from './TableCardSchema.js';
import { CARD_VIEW_MODE_LABEL, cardViewLabelOf, cardViewListGet, cardViewSourceOf, cardViewSwitcherIsShown } from './TableCardData.js';
import { strokeDashList } from './DiagramEditStore.js';
import { cardTabList, tabPathGet, pathLabelListGet, rowNameGet, selectionPathBuild } from './DiagramEditPath.js';
import { routeAnchorPointGet, routeDirectionFacingList, routeEndPointGet, routeResolve, routeTypeHasAnchors, routeTypeIsBezier, ROUTE_DIRECTION_LIST } from './DiagramRoute.js';

// The content of the edit card for the current path (DiagramEditCard.jsx),
// as data. The card renders it with the host's PropEditor, or with a plain
// form without one. Everything is read off the store's display
// (DiagramEditPath.js): the tabs and where each leads, the segments of the
// path bar, and the view of the active tab: the detail of one thing, or the
// list of a collection.
//
//   model      { title, kindLabel, tabList, tabId, segmentList, view }
//   tab        { id, label, isDisabled, disabledReason, path }
//   segment    { name, path }                                  the path bar
//   view       { type: 'detail', sectionList }
//              { type: 'list', id, label, itemList, isReorderable, reorderReason,
//                move(indexFrom, indexTo), remove(id), add?, actionList?, note, sectionList }
//   item       { id, name, badge?, sub?, isSelected, path, isRemovable, removeReason }
//   section    { id, label, propertyList, actionList, note? }
//   property   { id, label, kind: text | enum | bool | number | color, value,
//                values?, valueLabels?, isSearchable?, isMultiline?, isReadOnly?,
//                min?, max?, step?, set(value) -> boolean }
//   action     { id, label, kind?: 'danger', isDisabled?, reason?, act() }
const lineTypeLabels = { smoothstep: 'Right-angled', step: 'Right-angled, sharp', bezier: 'Curve', straight: 'Straight', polyline: 'Polyline' };
const directionLabels = { auto: 'Auto', 'x+': 'Right (x+)', 'x-': 'Left (x-)', 'y+': 'Down (y+)', 'y-': 'Up (y-)' };
const endHandleVectorSize = 60;
const markerLabels = { none: 'None', arrow: 'Arrow', arrowClosed: 'Filled arrow' };

export function cardModelBuild(editor) {
	const { store } = editor;
	const display = store.display;
	if (!display) return null;
	const path = store.path;
	const change = operation => { let result = false; editor.change(() => { result = operation(); }); return result; };
	const positionGet = editor.handlePositionGet;
	const node = display.nodeId ? store.nodeGet(display.nodeId) : undefined;
	const connection = display.connectionId ? store.connectionGet(display.connectionId) : undefined;
	const schema = node ? cardSchemaGet(node, store.registry) : null;
	const nodeId = node?.id;
	const title = node ? String(node.data.name ?? node.data.label ?? nodeId) : connection?.label?.text ? `${connection.label.text} (${connection.id})` : String(connection?.id ?? '');
	const kindLabel = node ? schema?.labelNode ?? 'Node' : 'Line';

	// ---- the tabs and the path bar ----
	const labelByTab = {
		table: schema?.labelNode ?? (node ? 'Node' : 'Table'),
		row: schema?.labelRowPlural ?? 'Rows',
		column: schema?.labelFieldPlural ?? 'Columns',
		cell: 'Cell',
		line: node ? 'Lines' : 'Line',
	};
	const tabList = cardTabList.map(id => {
		const tabPath = tabPathGet(display, id);
		let reason = '';
		if (!tabPath) reason = display.principal === 'connection' ? 'The line is selected by itself; click a card for its tabs.' : 'Click a cell of the card, or pick a row and then one of its fields.';
		else if (['row', 'column', 'cell'].includes(id) && !schema) reason = 'This node has no rows or columns.';
		else if (id === 'line' && store.kind !== 'diagram') reason = 'A standalone card has no lines.';
		return { id, label: labelByTab[id], isDisabled: Boolean(reason), disabledReason: reason, path: tabPath };
	});
	const segmentList = pathLabelListGet(path, store).map((name, index) => ({ name, path: path.slice(0, index + 1) }));
	const model = { title, kindLabel, tabList, tabId: display.tab, segmentList, view: { type: 'detail', sectionList: [] } };

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
	const lineSectionList = lineConnection => {
		const lineSet = (field, value) => change(() => store.connectionSet(lineConnection.id, field, value));
		const endText = endpoint => endpointIsDangling(endpoint) ? `free at ${endpoint.position.x}, ${endpoint.position.y}` : `${store.nodeGet(endpoint.nodeId)?.data?.name ?? endpoint.nodeId} / ${endpoint.handleId}`;
		return [
			{ id: 'line', label: 'Line', propertyList: [
				{ id: 'label', label: 'Label', kind: 'text', value: lineConnection.label?.text ?? '', set: value => lineSet('label', value) },
				{ id: 'lineType', label: 'Line type', kind: 'enum', value: lineConnection.renderer?.type ?? 'smoothstep', values: lineTypeList, valueLabels: lineTypeLabels, set: value => lineSet('lineType', value) },
				{ id: 'stroke', label: 'Color', kind: 'color', value: lineConnection.style?.stroke ?? '#64748b', set: value => lineSet('stroke', value) },
				{ id: 'strokeWidth', label: 'Thickness', kind: 'number', value: lineConnection.style?.strokeWidth ?? 1.5, min: 0.5, max: 12, step: 0.5, set: value => lineSet('strokeWidth', value) },
				{ id: 'strokeDash', label: 'Dash', kind: 'enum', value: store.strokeDashGet(lineConnection), values: strokeDashList.map(item => item.id), valueLabels: Object.fromEntries(strokeDashList.map(item => [item.id, item.label])), set: value => lineSet('strokeDash', value) },
				{ id: 'markerStart', label: 'Start arrow', kind: 'enum', value: lineConnection.markerStart ?? 'none', values: markerTypeList, valueLabels: markerLabels, set: value => lineSet('markerStart', value) },
				{ id: 'markerEnd', label: 'End arrow', kind: 'enum', value: lineConnection.markerEnd ?? 'arrowClosed', values: markerTypeList, valueLabels: markerLabels, set: value => lineSet('markerEnd', value) },
				{ id: 'isAnimated', label: 'Animated', kind: 'bool', value: Boolean(lineConnection.isAnimated), set: value => lineSet('isAnimated', value) },
			], actionList: [] },
			...routeSectionList(lineConnection),
			{ id: 'ends', label: 'Ends', note: 'Drag an end of the line to move it to another handle, or let it go free.', propertyList: [
				{ id: 'source', label: 'From', kind: 'text', value: endText(lineConnection.source), isReadOnly: true, set: () => false },
				{ id: 'target', label: 'To', kind: 'text', value: endText(lineConnection.target), isReadOnly: true, set: () => false },
			], actionList: [] },
			{ id: 'line-actions', label: '', propertyList: [], actionList: [
				{ id: 'connection-remove', label: 'Remove line', kind: 'danger', act: () => change(() => store.connectionRemove(lineConnection.id)) },
			] },
		];
	};

	// ---- the route of a line (card-diagram-connection-line.md) ----
	// the two ends where the canvas drew them; undefined when it has not (the card
	// then offers what needs no geometry)
	const endsGet = lineConnection => editor.connectionEndsGet?.(lineConnection.id);
	const directionProperty = (id, label, value, allowedList, set) => ({
		id, label, kind: 'enum', value: value ?? 'auto',
		values: ['auto', ...ROUTE_DIRECTION_LIST.filter(direction => allowedList.includes(direction) || direction === value)],
		valueLabels: directionLabels,
		set: next => change(() => set(next === 'auto' ? null : next)),
	});
	const vectorPropertyList = (id, label, vector, set) => ['x', 'y'].map(axis => ({
		id: `${id}-${axis}`, label: `${label} ${axis.toUpperCase()}`, kind: 'number', value: vector[axis], step: 1,
		set: value => { const size = Number(value); return Number.isFinite(size) && change(() => set({ ...vector, [axis]: size }, `route:${id}-${axis}`)); },
	}));
	const routeSectionList = lineConnection => {
		const lineType = store.connectionLineTypeGet(lineConnection);
		if (!routeTypeHasAnchors(lineType)) return [{ id: 'route', label: 'Route', note: store.connectionRouteReasonGet(lineConnection), propertyList: [], actionList: [] }];
		const lineId = lineConnection.id;
		const route = store.connectionRouteGet(lineId);
		const ends = endsGet(lineConnection);
		const resolved = ends ? routeResolve(lineType, route, ends) : null;
		const count = route?.anchorList?.length ?? 0;
		const pointNeighbour = role => {
			if (!ends) return null;
			const anchorList = resolved.anchorList;
			if (role === 'source') return anchorList[0] ?? routeEndPointGet(ends, 'target');
			return anchorList[anchorList.length - 1] ?? routeEndPointGet(ends, 'source');
		};
		const propertyList = [];
		for (const [role, label] of [['source', 'Start handle'], ['target', 'End handle']]) {
			const handle = route?.[role]?.handle;
			const setEnd = (value, groupKey) => store.connectionEndHandleSet(lineId, role, value, groupKey ? { groupKey: `${groupKey}:${lineId}` } : undefined);
			if (routeTypeIsBezier(lineType)) {
				propertyList.push({ id: `${role}-handle`, label, kind: 'bool', value: Boolean(handle), set: value => change(() => setEnd(value ? endHandleDefaultGet(role, ends) : null)) });
				if (handle) propertyList.push(...vectorPropertyList(`${role}-handle`, label, handle, setEnd));
			} else {
				const neighbour = pointNeighbour(role);
				propertyList.push(directionProperty(`${role}-handle`, label, handle, neighbour ? routeDirectionFacingList(routeEndPointGet(ends, role), neighbour) : ROUTE_DIRECTION_LIST, setEnd));
			}
		}
		return [{
			id: 'route', label: 'Route',
			note: 'Double-click the line to add an anchor. Drag an anchor to move it; select one and press Delete to remove it. Drag a handle at an end to set the way the line leaves or arrives.',
			propertyList,
			actionList: [
				{ id: 'anchors-open', label: `Anchors (${count})`, act: () => { editor.navigate([...store.linePathGet(lineId), { kind: 'anchors' }]); return true; } },
				{ id: 'anchor-add', label: 'Add anchor', isDisabled: !ends, reason: 'The line is not drawn yet.', act: () => change(() => Boolean(editor.anchorAdd(lineId))) },
				{ id: 'route-clear', label: 'Reset route', isDisabled: !route, reason: 'The line has no route to reset.', act: () => change(() => store.connectionRouteSet(lineId, null)) },
			],
		}];
	};
	const endHandleDefaultGet = (role, ends) => {
		const side = ends ? (role === 'source' ? ends.sourcePosition : ends.targetPosition) : null;
		return { left: { x: -endHandleVectorSize, y: 0 }, right: { x: endHandleVectorSize, y: 0 }, top: { x: 0, y: -endHandleVectorSize }, bottom: { x: 0, y: endHandleVectorSize } }[side] ?? { x: endHandleVectorSize, y: 0 };
	};
	const anchorListViewBuild = lineConnection => {
		const lineId = lineConnection.id;
		const anchorList = store.connectionRouteGet(lineId)?.anchorList ?? [];
		const linePath = store.linePathGet(lineId);
		const ends = endsGet(lineConnection);
		return {
			type: 'list', id: 'anchors', label: `Anchors (${anchorList.length})`,
			itemList: anchorList.map(anchor => {
				const point = ends ? routeAnchorPointGet(anchor, ends) : null;
				return { id: anchor.id, name: anchor.id, sub: point ? `${Math.round(point.x)}, ${Math.round(point.y)}` : `along ${anchor.along}`, isSelected: false, path: [...linePath, { kind: 'anchors' }, { kind: 'anchor', id: anchor.id }], isRemovable: true, removeReason: '' };
			}),
			isReorderable: false, reorderReason: 'Anchors follow the line in order; a new one is placed where it is added.',
			move: () => false,
			remove: id => change(() => store.connectionAnchorRemove(lineId, id)),
			add: { id: 'anchor-add', label: 'Add anchor', isDisabled: !ends, reason: 'The line is not drawn yet.', act: () => change(() => Boolean(editor.anchorAdd(lineId))) },
			note: anchorList.length ? '' : 'Double-click the line to add an anchor where it runs.',
			sectionList: [],
		};
	};
	const anchorSectionList = (lineConnection, anchorId) => {
		const lineId = lineConnection.id;
		const lineType = store.connectionLineTypeGet(lineConnection);
		const route = store.connectionRouteGet(lineId);
		const anchorList = route?.anchorList ?? [];
		const anchorIndex = anchorList.findIndex(item => item.id === anchorId);
		const anchor = anchorList[anchorIndex];
		if (!anchor) return [];
		const ends = endsGet(lineConnection);
		const point = ends ? routeAnchorPointGet(anchor, ends) : null;
		const moveGroup = axis => ({ groupKey: `route:${lineId}/${anchorId}/${axis}` });
		const place = {
			id: 'anchor', label: 'Anchor', actionList: [],
			note: 'Along says which end it follows: 0 moves with the start, 1 with the end, between takes a share of each.',
			propertyList: [
				...(point ? ['x', 'y'].map(axis => ({
					id: axis, label: axis.toUpperCase(), kind: 'number', value: Math.round(point[axis] * 100) / 100, step: 1,
					set: value => { const size = Number(value); return Number.isFinite(size) && change(() => store.connectionAnchorMove(lineId, anchorId, { point: { ...point, [axis]: size }, ends, along: anchor.along }, moveGroup(axis))); },
				})) : []),
				{ id: 'along', label: 'Along', kind: 'number', value: anchor.along, min: 0, max: 1, step: 0.05, set: value => {
					const along = Number(value);
					if (!Number.isFinite(along)) return false;
					return change(() => store.connectionAnchorMove(lineId, anchorId, point ? { point, ends, along } : { along }, moveGroup('along')));
				} },
			],
		};
		const remove = { id: 'anchor-remove', label: 'Remove anchor', kind: 'danger', act: () => change(() => store.connectionAnchorRemove(lineId, anchorId)) };
		if (!routeTypeIsBezier(lineType)) {
			const resolved = ends ? routeResolve(lineType, route, ends) : null;
			const neighbourOf = index => (index < 0 ? routeEndPointGet(ends, 'source') : index >= anchorList.length ? routeEndPointGet(ends, 'target') : resolved.anchorList[index]);
			const allowed = index => (ends ? routeDirectionFacingList(point, neighbourOf(index)) : ROUTE_DIRECTION_LIST);
			const handleSet = side => value => store.connectionAnchorHandleSet(lineId, anchorId, side, value);
			return [place, {
				id: 'anchor-handles', label: 'Handles', actionList: [remove],
				note: 'A handle says which way the line runs from the anchor. Auto takes the direction that gives the whole line the fewest bends.',
				propertyList: [
					directionProperty('in', 'In', anchor.handleIn, allowed(anchorIndex - 1), handleSet('in')),
					directionProperty('out', 'Out', anchor.handleOut, allowed(anchorIndex + 1), handleSet('out')),
				],
			}];
		}
		const isCoupled = anchor.isCoupled !== false;
		const handleSet = side => (value, groupKey) => store.connectionAnchorHandleSet(lineId, anchorId, side, value, { groupKey: groupKey ? `${groupKey}:${lineId}/${anchorId}` : null });
		return [place, {
			id: 'anchor-handles', label: 'Handles',
			note: 'Coupled handles stay on one straight line: the curve is smooth through the anchor. Alt + drag a handle to decouple it.',
			propertyList: [
				{ id: 'coupled', label: 'Coupled', kind: 'bool', value: isCoupled, set: value => change(() => store.connectionAnchorCoupleSet(lineId, anchorId, value)) },
				...(anchor.handleIn ? vectorPropertyList('in', 'In', anchor.handleIn, handleSet('in')) : []),
				...(anchor.handleOut ? vectorPropertyList('out', 'Out', anchor.handleOut, handleSet('out')) : []),
			],
			actionList: [
				{ id: 'handles-pull', label: 'Pull out handles', isDisabled: !ends, reason: 'The line is not drawn yet.', act: () => change(() => store.connectionAnchorHandlesPull(lineId, anchorId, ends)) },
				{ id: 'handle-in-remove', label: 'Remove in handle', isDisabled: !anchor.handleIn, reason: 'It has none.', act: () => change(() => store.connectionAnchorHandleSet(lineId, anchorId, 'in', null)) },
				{ id: 'handle-out-remove', label: 'Remove out handle', isDisabled: !anchor.handleOut, reason: 'It has none.', act: () => change(() => store.connectionAnchorHandleSet(lineId, anchorId, 'out', null)) },
				remove,
			],
		}];
	};
	// the view of a line: its settings, the list of its anchors, or one anchor
	const lineViewBuild = lineConnection => {
		if (!lineConnection) return { type: 'detail', sectionList: [] };
		if (display.view === 'list' && display.isAnchors) return anchorListViewBuild(lineConnection);
		if (display.anchorId) return { type: 'detail', sectionList: anchorSectionList(lineConnection, display.anchorId) };
		return { type: 'detail', sectionList: lineSectionList(lineConnection) };
	};

	// ---- a line by itself ----
	if (!node) {
		model.view = lineViewBuild(connection);
		return model;
	}

	const rows = schema ? store.rowsGet(node) : [];
	const row = display.rowId ? rows.find(item => item.id === display.rowId) : undefined;
	const rowIndex = row ? rows.indexOf(row) : -1;
	const field = display.fieldId && schema ? schema.fieldList.find(item => item.id === display.fieldId) : undefined;
	const fieldIndex = field ? schema.fieldList.indexOf(field) : -1;
	const labelRowLower = schema?.labelRow.toLowerCase() ?? 'row';
	const labelFieldLower = schema?.labelField.toLowerCase() ?? 'column';
	const isFieldListFixed = Boolean(schema) && !schema.isFieldListEditable;
	const reasonFieldListFixed = schema?.reasonFieldListFixed || '';
	const rowInsertAction = (id, label, index) => ({ id, label, act: () => change(() => Boolean(store.rowInsert(nodeId, index))) });
	const columnInsertAction = (id, label, index) => ({ id, label, isDisabled: isFieldListFixed, reason: reasonFieldListFixed, act: () => change(() => Boolean(store.columnInsert(nodeId, index))) });

	// the views of the card: the list, or one view with the parameters of its mode
	const viewViewBuild = () => {
		const nodeSegment = { kind: 'node', id: nodeId };
		const declared = node.data.viewList ?? [];
		const modeList = schema.viewModeList ?? ['plain'];
		const source = cardViewSourceOf(node.data, schema.rowListKey);
		if (!display.viewId) {
			const defaultId = cardViewListGet(node.data).find(view => view.id === node.data.viewDefault)?.id ?? cardViewListGet(node.data)[0].id;
			const current = store.cardViewGet(nodeId);
			const itemList = cardViewListGet(node.data).map(view => ({
				id: view.id, name: cardViewLabelOf(view), badge: `${CARD_VIEW_MODE_LABEL[view.mode]}${view.id === defaultId ? ' · default' : ''}`, sub: view.isImplicit ? 'Every card has this view until it declares others.' : '',
				isSelected: view.id === current.id, path: view.isImplicit ? [nodeSegment] : [nodeSegment, { kind: 'views' }, { kind: 'view', id: view.id }],
				isRemovable: !view.isImplicit, removeReason: 'A card keeps at least one view.',
			}));
			return {
				type: 'list', id: 'views', label: `Views (${itemList.length})`, itemList,
				isReorderable: declared.length > 1, reorderReason: 'One view cannot be reordered.',
				move: (indexFrom, indexTo) => change(() => store.viewMove(nodeId, indexFrom, indexTo)),
				remove: id => change(() => store.viewRemove(nodeId, id)),
				add: { id: 'view-add', label: 'Add view', act: () => change(() => store.viewAdd(nodeId) !== null) },
				note: '', sectionList: [],
			};
		}
		const view = declared.find(item => item.id === display.viewId);
		const set = (patch, options) => change(() => store.viewSet(nodeId, view.id, patch, options));
		const propertyList = [
			{ id: 'label', label: 'Label', kind: 'text', value: view.label ?? '', set: value => set({ label: value }, { groupKey: `view:${nodeId}/${view.id}/label` }) },
			{ id: 'mode', label: 'View mode', kind: 'enum', value: view.mode, values: modeList, valueLabels: CARD_VIEW_MODE_LABEL, set: value => set({ mode: value }) },
		];
		if (view.mode === 'column' && source.recordList.length) {
			propertyList.push({ id: 'valueRowId', label: 'Values of', kind: 'enum', value: view.valueRowId ?? '', values: ['', ...source.recordList.map(record => record.id)], valueLabels: { '': 'No record' }, set: value => set({ valueRowId: value || undefined }) });
		}
		if (view.mode === 'row') {
			const shown = view.fieldDisplay ?? source.columnList.map(column => column.id);
			for (const column of source.columnList) {
				propertyList.push({ id: `field:${column.id}`, label: column.label, kind: 'bool', value: shown.includes(column.id), isReadOnly: shown.length === 1 && shown[0] === column.id, set: value => set({ fieldDisplay: source.columnList.map(item => item.id).filter(id => (id === column.id ? value : shown.includes(id))) }) });
			}
		}
		const noteOfMode = { plain: 'The rows of the card as they are.', column: 'A row for each column of the table, with the values of a record beside them if one is chosen.', row: 'A row for each record of the table: the columns checked above are the ones shown.' };
		return { type: 'detail', sectionList: [
			{ id: 'view', label: 'View', propertyList, note: `${noteOfMode[view.mode]}${source.recordList.length || !modeList.includes('row') ? '' : ' A row view needs the records of the table, written as rows in the source.'}`, actionList: [] },
			{ id: 'view-actions', label: '', propertyList: [], actionList: [
				{ id: 'row-display', label: 'Choose rows and row breaks', act: () => editor.navigate([nodeSegment, { kind: 'rowDisplay' }]) },
				{ id: 'view-default', label: 'Make default', isDisabled: node.data.viewDefault === view.id, reason: 'It is the default.', act: () => change(() => store.viewDefaultSet(nodeId, view.id)) },
				{ id: 'view-remove', label: 'Remove view', kind: 'danger', act: () => change(() => store.viewRemove(nodeId, view.id)) },
			] },
		] };
	};

	// what the card shows when read: the rows and row breaks in their order, then the rows
	// left out, which a drag up among them shows. one row break opens its own text
	const rowDisplayViewBuild = () => {
		const listPath = [{ kind: 'node', id: nodeId }, { kind: 'rowDisplay' }];
		const list = store.rowDisplayCurrentGet(nodeId);
		if (display.rowBreakIndex !== undefined) {
			const entry = list[display.rowBreakIndex];
			return { type: 'detail', sectionList: [{ id: 'row-break', label: 'Row break', propertyList: [
				{ id: 'text', label: 'Text', kind: 'text', value: typeof entry === 'object' ? entry.break : '', set: value => change(() => store.rowBreakTextSet(nodeId, display.rowBreakIndex, value)) },
			], note: 'Words beside the mark: what was left out here. Empty, only the mark is drawn.', actionList: [
				{ id: 'row-break-remove', label: 'Remove row break', kind: 'danger', act: () => change(() => store.rowDisplayEntryRemove(nodeId, display.rowBreakIndex)) },
			] }] };
		}
		const view = store.cardViewGet(nodeId);
		const viewRows = store.cardViewRowsGet(nodeId);
		const isPlainRows = view.mode === 'plain';
		const nameOf = item => (isPlainRows ? rowNameGet(item, schema) : String(item?.label ?? item?.name ?? item?.id ?? ''));
		const rowOf = id => viewRows.find(item => item.id === id);
		const hiddenList = viewRows.filter(item => !list.includes(item.id));
		const rowPath = id => (isPlainRows ? selectionPathBuild(nodeId, { rowId: id }) : listPath);
		const itemList = [
			...list.map((entry, index) => (typeof entry === 'string' && entry !== '...'
				? { id: `shown:${entry}`, name: nameOf(rowOf(entry)), isSelected: false, path: rowPath(entry), isRemovable: !store.rowHideReasonGet(nodeId, entry), removeReason: store.rowHideReasonGet(nodeId, entry) }
				: { id: `break:${index}`, name: 'Row break', sub: typeof entry === 'object' ? entry.break : '', badge: 'break', isSelected: false, path: [...listPath, { kind: 'rowBreak', index }], isRemovable: true, removeReason: '' })),
			...hiddenList.map(item => ({ id: `hidden:${item.id}`, name: nameOf(item), badge: 'not shown', isSelected: false, path: rowPath(item.id), isRemovable: false, removeReason: 'It is not shown: drag it up, or open it, to show it.' })),
		];
		return {
			type: 'list', id: 'row-display', label: `Shown when reading (${list.filter(entry => typeof entry === 'string' && entry !== '...').length} of ${viewRows.length})`,
			itemList,
			isReorderable: itemList.length > 1, reorderReason: 'Nothing to reorder.',
			move: (indexFrom, indexTo) => change(() => {
				if (indexFrom >= list.length) return indexTo < list.length ? store.rowShownSet(nodeId, hiddenList[indexFrom - list.length].id, true, indexTo) : false;
				return store.rowDisplayMove(nodeId, indexFrom, Math.min(indexTo, list.length - 1));
			}),
			remove: id => change(() => store.rowDisplayEntryRemove(nodeId, itemList.findIndex(item => item.id === id))),
			add: { id: 'row-break-add', label: 'Insert row break', isDisabled: Boolean(store.rowBreakInsertReasonGet(nodeId, list.length)), reason: store.rowBreakInsertReasonGet(nodeId, list.length), act: () => change(() => store.rowBreakInsert(nodeId) !== null) },
			note: view.rowDisplay ? '' : 'All are shown, in their order: a change here starts a list of its own.',
			sectionList: [],
		};
	};

	switch (display.tab) {
		case 'table': {
			if (display.isViews) {
				model.view = viewViewBuild();
				return model;
			}
			const sectionList = [];
			const nodePropertyList = schema ? schema.nodePropertyList : [{ id: 'label', label: 'Label', kind: 'text' }, { id: 'description', label: 'Description', kind: 'text', isMultiline: true }];
			sectionList.push({ id: 'node', label: schema?.labelNode ?? 'Node', propertyList: nodePropertyList.map(definition => propertyOf(definition, node.data, (id, value) => store.fieldSet(nodeId, null, id, value))), actionList: [] });
			if (schema) {
				const viewCurrent = store.cardViewGet(nodeId);
				const isChosen = Boolean(viewCurrent.rowDisplay);
				const viewList = cardViewListGet(node.data);
				sectionList.push({
					id: 'display', label: 'Display',
					propertyList: [
						...(node.data.viewList?.length > 1 ? [{ id: 'viewDefault', label: 'Default view', kind: 'enum', value: node.data.viewDefault ?? '', values: ['', ...viewList.map(view => view.id)], valueLabels: { '': 'The first', ...Object.fromEntries(viewList.map(view => [view.id, cardViewLabelOf(view)])) }, set: value => change(() => store.viewDefaultSet(nodeId, value || null)) }] : []),
						{ id: 'viewSwitcher', label: 'View switcher', kind: 'bool', value: cardViewSwitcherIsShown(node.data), set: value => change(() => store.viewSwitcherShownSet(nodeId, value)) },
						{ id: 'rowDisplayMode', label: `${schema.labelRowPlural} shown`, kind: 'enum', value: isChosen ? 'chosen' : 'all', values: ['all', 'chosen'], valueLabels: { all: 'All', chosen: 'Chosen' }, set: value => change(() => store.rowDisplaySet(nodeId, value === 'chosen' ? store.rowDisplayCurrentGet(nodeId) : null)) },
						...(schema.displayPropertyList ?? []).map(definition => propertyOf(definition, node.data, (id, value) => store.fieldSet(nodeId, null, id, value, value === '' || value === false))),
					],
					note: viewCurrent.isImplicit ? '' : `Rows shown and row breaks are those of the view shown: ${cardViewLabelOf(viewCurrent)}.`,
					actionList: [
						{ id: 'views', label: `Views (${viewList.length})`, act: () => editor.navigate([{ kind: 'node', id: nodeId }, { kind: 'views' }]) },
						{ id: 'row-display', label: 'Choose rows and row breaks', act: () => editor.navigate([{ kind: 'node', id: nodeId }, { kind: 'rowDisplay' }]) },
					],
				});
			}
			const header = schema ? handleSection('header', 'Title handles', schema.isHeaderHandleAllowed(node.data)) : null;
			if (header) sectionList.push(header);
			if (store.kind === 'diagram') {
				const isRemembered = Boolean(node.position && node.position !== 'auto');
				sectionList.push({ id: 'position', label: 'Position', propertyList: [
					{ id: 'remember', label: 'Remember', kind: 'bool', value: isRemembered, isReadOnly: Boolean(node.isPositionLocked), set: value => change(() => store.positionRememberSet(nodeId, value, editor.nodePositionGet(nodeId))) },
					{ id: 'lock', label: 'Locked', kind: 'bool', value: Boolean(node.isPositionLocked), set: value => change(() => store.positionLockSet(nodeId, value, editor.nodePositionGet(nodeId))) },
				], actionList: [] });
			}
			sectionList.push({ id: 'node-actions', label: '', propertyList: [], actionList: [
				...(schema ? [rowInsertAction('row-add', `Add ${labelRowLower}`)] : []),
				...(schema ? [columnInsertAction('column-add', `Add ${labelFieldLower}`)] : []),
				...(store.kind === 'diagram' ? [{ id: 'node-remove', label: 'Remove node', kind: 'danger', act: () => change(() => store.nodeRemove(nodeId, positionGet)) }] : []),
			] });
			model.view = { type: 'detail', sectionList };
			return model;
		}
		case 'row': {
			if (!schema) return model;
			if (display.isRowDisplay) {
				model.view = rowDisplayViewBuild();
				return model;
			}
			if (display.view === 'list') {
				model.view = {
					type: 'list', id: 'rows', label: `${schema.labelRowPlural} (${rows.length})`,
					itemList: rows.map(item => {
						const name = rowNameGet(item, schema);
						const badge = schema.kind === 'dataverse' ? [item.key, item.type].filter(Boolean).join(' · ') : '';
						const sub = schema.kind === 'dataverse' ? String(item.nameLogical || item.id) : schema.kind === 'resource' ? String(item.value ?? '') : schema.fieldList.slice(1).map(definition => item[definition.id]).filter(Boolean).join(' · ');
						return { id: item.id, name, badge, sub, isSelected: display.rowId === item.id, path: selectionPathBuild(nodeId, { rowId: item.id }), isRemovable: true, removeReason: '' };
					}),
					isReorderable: rows.length > 1, reorderReason: rows.length > 1 ? '' : `One ${labelRowLower} cannot be reordered.`,
					move: (indexFrom, indexTo) => change(() => store.rowMove(nodeId, rows[indexFrom]?.id, indexTo)),
					remove: id => change(() => store.rowRemove(nodeId, id, positionGet)),
					add: rowInsertAction('row-add', `Add ${labelRowLower}`),
					actionList: [{ id: 'row-display', label: 'Shown when reading', act: () => editor.navigate([{ kind: 'node', id: nodeId }, { kind: 'rowDisplay' }]) }],
					note: rows.length ? '' : `No ${schema.labelRowPlural.toLowerCase()} yet.`,
					sectionList: [],
				};
				return model;
			}
			const sectionList = [];
			sectionList.push({ id: 'row', label: schema.labelRow, propertyList: [...schema.fieldList, ...schema.rowPropertyList].map(definition => propertyOf(definition, row, (id, value) => store.fieldSet(nodeId, row.id, id, value))), actionList: [] });
			const handles = handleSection(cardRowAnchorBuild(schema, row.id), 'Handles', schema.isRowHandleAllowed?.(node.data) ?? true);
			if (handles) sectionList.push(handles);
			const viewShown = store.cardViewGet(nodeId);
			const isRowShown = !viewShown.rowDisplay || viewShown.rowDisplay.includes(row.id);
			const hideReason = store.rowHideReasonGet(nodeId, row.id);
			if (viewShown.mode === 'plain') sectionList.push({ id: 'row-display', label: 'When reading', propertyList: [
				{ id: 'isShown', label: 'Shown', kind: 'bool', value: isRowShown, isReadOnly: isRowShown && Boolean(hideReason), set: value => change(() => store.rowShownSet(nodeId, row.id, value)) },
			], note: isRowShown ? hideReason : '', actionList: [
				{ id: 'break-after', label: 'Insert row break below', isDisabled: !isRowShown || Boolean(store.rowBreakInsertReasonGet(nodeId, store.rowDisplayCurrentGet(nodeId).indexOf(row.id) + 1)), reason: isRowShown ? store.rowBreakInsertReasonGet(nodeId, store.rowDisplayCurrentGet(nodeId).indexOf(row.id) + 1) : 'This row is not shown.', act: () => change(() => store.rowBreakInsert(nodeId, { afterRowId: row.id }) !== null) },
			] });
			sectionList.push({ id: 'row-actions', label: '', propertyList: [], actionList: [
				rowInsertAction('insert-above', 'Insert above', rowIndex),
				rowInsertAction('insert-below', 'Insert below', rowIndex + 1),
				{ id: 'move-up', label: 'Move up', isDisabled: rowIndex <= 0, reason: 'Already first.', act: () => change(() => store.rowMove(nodeId, row.id, rowIndex - 1)) },
				{ id: 'move-down', label: 'Move down', isDisabled: rowIndex >= rows.length - 1, reason: 'Already last.', act: () => change(() => store.rowMove(nodeId, row.id, rowIndex + 1)) },
				{ id: 'row-remove', label: `Remove ${labelRowLower}`, kind: 'danger', act: () => change(() => store.rowRemove(nodeId, row.id, positionGet)) },
			] });
			model.view = { type: 'detail', sectionList };
			return model;
		}
		case 'column': {
			if (!schema) return model;
			if (display.view === 'list') {
				model.view = {
					type: 'list', id: 'fields', label: `${schema.labelFieldPlural} (${schema.fieldList.length})`,
					itemList: schema.fieldList.map(item => ({ id: item.id, name: item.label, badge: item.kind === 'enum' ? 'choice' : '', sub: item.id, isSelected: display.fieldId === item.id, path: selectionPathBuild(nodeId, { fieldId: item.id }), isRemovable: !isFieldListFixed && schema.fieldList.length > 1, removeReason: isFieldListFixed ? reasonFieldListFixed : `A ${schema.labelNode.toLowerCase()} keeps at least one ${labelFieldLower}.` })),
					isReorderable: !isFieldListFixed && schema.fieldList.length > 1, reorderReason: isFieldListFixed ? reasonFieldListFixed : `One ${labelFieldLower} cannot be reordered.`,
					move: (indexFrom, indexTo) => change(() => store.columnMove(nodeId, schema.fieldList[indexFrom]?.id, indexTo)),
					remove: id => change(() => store.columnRemove(nodeId, id)),
					add: columnInsertAction('column-add', `Add ${labelFieldLower}`),
					note: isFieldListFixed ? reasonFieldListFixed : '',
					sectionList: [],
				};
				return model;
			}
			model.view = { type: 'detail', sectionList: [
				{ id: 'column', label: schema.labelField, note: isFieldListFixed ? reasonFieldListFixed : '', propertyList: [
					{ id: 'label', label: 'Label', kind: 'text', value: field.label, isReadOnly: isFieldListFixed, set: value => change(() => store.columnLabelSet(nodeId, field.id, value)) },
					{ id: 'id', label: 'Id', kind: 'text', value: field.id, isReadOnly: true, set: () => false },
				], actionList: [] },
				{ id: 'column-actions', label: '', propertyList: [], actionList: [
					columnInsertAction('insert-left', 'Insert left', fieldIndex),
					columnInsertAction('insert-right', 'Insert right', fieldIndex + 1),
					{ id: 'move-left', label: 'Move left', isDisabled: isFieldListFixed || fieldIndex <= 0, reason: isFieldListFixed ? reasonFieldListFixed : 'Already first.', act: () => change(() => store.columnMove(nodeId, field.id, fieldIndex - 1)) },
					{ id: 'move-right', label: 'Move right', isDisabled: isFieldListFixed || fieldIndex >= schema.fieldList.length - 1, reason: isFieldListFixed ? reasonFieldListFixed : 'Already last.', act: () => change(() => store.columnMove(nodeId, field.id, fieldIndex + 1)) },
					{ id: 'column-remove', label: `Remove ${labelFieldLower}`, kind: 'danger', isDisabled: isFieldListFixed, reason: reasonFieldListFixed, act: () => change(() => store.columnRemove(nodeId, field.id)) },
				] },
			] };
			return model;
		}
		case 'cell': {
			if (!schema || !row || !field) return model;
			model.view = { type: 'detail', sectionList: [{ id: 'cell', label: 'Cell', propertyList: [
				{ id: 'row', label: schema.labelRow, kind: 'text', value: rowNameGet(row, schema), isReadOnly: true, set: () => false },
				{ id: 'column', label: schema.labelField, kind: 'text', value: field.label, isReadOnly: true, set: () => false },
				propertyOf({ ...field, label: 'Value' }, row, (id, value) => store.fieldSet(nodeId, row.id, id, value)),
			], actionList: [] }] };
			return model;
		}
		case 'line': {
			if (display.view === 'list' && !display.isAnchors) {
				const lineList = store.nodeLineListGet(nodeId);
				const endName = endpoint => endpointIsDangling(endpoint) ? 'free end' : endpoint.nodeId === nodeId ? endpoint.handleId : String(store.nodeGet(endpoint.nodeId)?.data?.name ?? endpoint.nodeId);
				model.view = {
					type: 'list', id: 'lines', label: `Lines (${lineList.length})`,
					itemList: lineList.map(item => ({ id: item.id, name: String(item.label?.text || item.id), badge: item.label?.text ? item.id : '', sub: `${endName(item.source)} → ${endName(item.target)}`, isSelected: display.connectionId === item.id, path: selectionPathBuild(nodeId, { connectionId: item.id }), isRemovable: true, removeReason: '' })),
					isReorderable: false, reorderReason: 'Lines have no order.',
					move: () => false,
					remove: id => change(() => store.connectionRemove(id)),
					add: null,
					note: lineList.length ? 'Click a handle of the card to step through its lines.' : 'Drag from a handle of the card to draw a line.',
					sectionList: [],
				};
				return model;
			}
			model.view = lineViewBuild(connection);
			return model;
		}
		default:
			return model;
	}
}
