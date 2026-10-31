import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, GripHorizontal, GripVertical, Plus, Trash2 } from '../../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { cardRowAnchorBuild } from './TableCardSchema.js';
import { TextValue, ValueMenu } from './DiagramValueControls.jsx';
import './DiagramER.css';

// The generic table-like card of a diagram node (card-diagram.md#the-table-card):
// a title line (name and a subtitle), an optional description, the head
// fields of the card, a header of its fields, and its rows, one cell per
// field. The Dataverse cards and the resource cards are variants that pass a
// schema (TableCardSchema.js) and small render hooks; the generic `table`
// node is the card as is.
//
// Without an editor the card is plain, selectable text (nodrag nopan on
// every row, so a drag in a row selects text while a drag on the title line
// pans the canvas). With one, every part of the card answers a click
// (comp-diagram-er.md#diagram-er-edit): the title line and the description
// focus the card, a head field focuses that property, a field header the
// field, a row the row, a cell starts typing in it; what is focused is
// highlighted even where it cannot be changed. A focused row or field shows
// its toolbar (CardToolbar): a grip to drag it to another place, insert
// before / after, move, remove; a button the card does not support is
// greyed out with its reason as its title. The read and edit layouts are
// one grid, so starting to edit moves nothing.
//
//   node          the normalized node (its data, handles)
//   schema        cardSchemaGet(node)
//   anchorRef     the diagram's ref for the header and row anchors; absent standalone
//   titleLeading / titleTrailing   what a variant puts beside the name
//   cellRender(field, row, value)  what a variant shows in a read cell (undefined: the value)
//   cellClassName(field, row)      an extra class of a cell
export const TableCard = observer(function TableCard({ node, schema, editor, nodeId, anchorRef, className = '', titleLeading = null, titleTrailing = null, cellRender, cellClassName, columnsStyle }) {
	const { docStore } = useDocStores();
	const root = useRef(null);
	const [drop, dropSet] = useState(null);
	const store = editor?.store;
	const selection = store?.selection;
	const isSelected = selection?.nodeId === nodeId;
	const content = store?.nodeGet(nodeId)?.data ?? node.data;
	const rows = node.data[schema.rowListKey] ?? [];
	const isRowHandleAllowed = schema.isRowHandleAllowed?.(content) ?? true;
	const isHeaderHandleAllowed = schema.isHeaderHandleAllowed(content);
	const style = columnsStyle ?? { '--doc-card-columns': `repeat(${schema.fieldList.length}, minmax(0, 1fr))` };
	const handleSides = target => new Set((node.handles ?? []).filter(handle => handle.anchor.target === target).map(handle => handle.anchor.side));
	const handleAdders = (target, sides) => editor ? ['left', 'right'].filter(side => !sides.has(side)).map(side => (
		<button key={side} type="button" className={`doc-card-handle-add is-${side} nodrag nopan`} title={`Add a ${side} handle`} aria-label={`Add a ${side} handle`} disabled={editor.isLocked}
			onClick={event => { event.stopPropagation(); editor.change(() => store.handleSideSet(nodeId, target, side, true)); }}><Plus size={9} strokeWidth={3} /></button>
	)) : null;
	const titleSides = handleSides('header');
	// a click on a part of the card focuses it: the path of the edit card
	// moves there (DiagramEditPath.js)
	const select = options => editor ? event => { event.stopPropagation(); editor.select(nodeId, options); } : undefined;
	const selectOnFocus = options => editor ? event => { if (event.target === event.currentTarget) editor.select(nodeId, options); } : undefined;
	const isCardSelected = isSelected && !selection.rowId && !selection.fieldId;
	const isPropSelected = id => isSelected && selection.propId === id;
	const rectListGet = selector => Array.from(root.current?.querySelectorAll(selector) ?? []).map(element => element.getBoundingClientRect());
	const isFieldListFixed = !schema.isFieldListEditable;
	const labelRow = schema.labelRow.toLowerCase();
	const labelField = schema.labelField.toLowerCase();
	const rowToolbar = (row, index) => <CardToolbar className="is-row" editor={editor}
		grip={{ Icon: GripVertical, axis: 'y', title: `Drag to reorder the ${labelRow}`, isDisabled: rows.length <= 1, reason: `One ${labelRow} cannot be reordered.`, indexFrom: index, rectListGet: () => rectListGet(':scope > .doc-card-row'),
			onPreview: insertion => dropSet({ axis: 'row', index: insertion }), onDrop: indexTo => { dropSet(null); if (indexTo !== index) editor.change(() => store.rowMove(nodeId, row.id, indexTo)); } }}
		actionList={[
			{ id: 'insert-above', Icon: ChevronUp, title: `Insert a ${labelRow} above`, act: () => store.rowInsert(nodeId, index) },
			{ id: 'insert-below', Icon: ChevronDown, title: `Insert a ${labelRow} below`, act: () => store.rowInsert(nodeId, index + 1) },
			{ id: 'move-up', Icon: ArrowUp, title: 'Move up', isDisabled: index === 0, reason: 'Already first.', act: () => store.rowMove(nodeId, row.id, index - 1) },
			{ id: 'move-down', Icon: ArrowDown, title: 'Move down', isDisabled: index === rows.length - 1, reason: 'Already last.', act: () => store.rowMove(nodeId, row.id, index + 1) },
			{ id: 'remove', Icon: Trash2, isDanger: true, title: `Remove the ${labelRow}`, act: () => store.rowRemove(nodeId, row.id, editor.handlePositionGet) },
		]} />;
	const fieldToolbar = (field, index) => <CardToolbar className="is-field" editor={editor}
		grip={{ Icon: GripHorizontal, axis: 'x', title: `Drag to reorder the ${labelField}`, isDisabled: isFieldListFixed || schema.fieldList.length <= 1, reason: isFieldListFixed ? schema.reasonFieldListFixed : `One ${labelField} cannot be reordered.`, indexFrom: index, rectListGet: () => rectListGet(':scope > .doc-card-fields > .doc-card-field'),
			onPreview: insertion => dropSet({ axis: 'field', index: insertion }), onDrop: indexTo => { dropSet(null); if (indexTo !== index) editor.change(() => store.columnMove(nodeId, field.id, indexTo)); } }}
		actionList={[
			{ id: 'insert-left', Icon: ChevronLeft, title: `Insert a ${labelField} left`, isDisabled: isFieldListFixed, reason: schema.reasonFieldListFixed, act: () => store.columnInsert(nodeId, index) },
			{ id: 'insert-right', Icon: ChevronRight, title: `Insert a ${labelField} right`, isDisabled: isFieldListFixed, reason: schema.reasonFieldListFixed, act: () => store.columnInsert(nodeId, index + 1) },
			{ id: 'move-left', Icon: ArrowLeft, title: 'Move left', isDisabled: isFieldListFixed || index === 0, reason: isFieldListFixed ? schema.reasonFieldListFixed : 'Already first.', act: () => store.columnMove(nodeId, field.id, index - 1) },
			{ id: 'move-right', Icon: ArrowRight, title: 'Move right', isDisabled: isFieldListFixed || index === schema.fieldList.length - 1, reason: isFieldListFixed ? schema.reasonFieldListFixed : 'Already last.', act: () => store.columnMove(nodeId, field.id, index + 1) },
			{ id: 'remove', Icon: Trash2, isDanger: true, title: `Remove the ${labelField}`, isDisabled: isFieldListFixed || schema.fieldList.length <= 1, reason: isFieldListFixed ? schema.reasonFieldListFixed : `A ${schema.labelNode.toLowerCase()} keeps at least one ${labelField}.`, act: () => store.columnRemove(nodeId, field.id) },
		]} />;
	const dropClass = (axis, index, count) => drop?.axis === axis ? `${drop.index === index ? ' is-drop-before' : ''}${index === count - 1 && drop.index === count ? ' is-drop-after' : ''}` : '';
	return (
		<div ref={root} data-node-id={nodeId} className={`doc-er-table doc-card ${className}${editor ? ' is-editable' : ''}${isCardSelected ? ' is-selected' : ''}`.trim()} style={style} tabIndex={editor ? 0 : undefined}
			onClick={select({})} onFocus={selectOnFocus({})}>
			<div ref={anchorRef?.('header')} className="doc-er-table-title doc-card-title">
				<span className="doc-er-table-title-name">
					{titleLeading}
					<CardCell editor={editor} nodeId={nodeId} field={{ id: 'name', kind: 'text' }} value={content.name} className="doc-er-table-title-text" />
				</span>
				{node.data.nameLogical || editor ? <CardCell editor={editor} nodeId={nodeId} field={{ id: 'nameLogical', kind: 'text' }} value={content.nameLogical} className="doc-er-table-title-logical" /> : null}
				{titleTrailing}
				{isHeaderHandleAllowed ? handleAdders('header', titleSides) : null}
			</div>
			{node.data.description ? <div className={`doc-er-table-description doc-card-prop nodrag nopan${isPropSelected('description') ? ' is-selected' : ''}`} tabIndex={editor ? 0 : undefined} onClick={select({ propId: 'description' })} onFocus={selectOnFocus({ propId: 'description' })}>{node.data.description}</div> : null}
			{schema.headFieldList.map(field => (
				<div key={field.id} className={`doc-card-head-field doc-card-prop nodrag nopan${isPropSelected(field.id) ? ' is-selected' : ''}`} tabIndex={editor ? 0 : undefined} onClick={select({ propId: field.id })} onFocus={selectOnFocus({ propId: field.id })}>
					<span className="doc-card-head-label">{field.label}</span>
					<CardCell editor={editor} nodeId={nodeId} field={field} value={content[field.id]} className="doc-card-head-value" />
				</div>
			))}
			<div className="doc-er-table-column-header doc-card-fields nodrag nopan">
				{schema.fieldList.map((field, index) => {
					const isFieldSelected = isSelected && selection.fieldId === field.id && !selection.rowId;
					return <span key={field.id} className={`doc-card-field${isFieldSelected ? ' is-selected' : ''}${dropClass('field', index, schema.fieldList.length)}`} tabIndex={editor ? 0 : undefined}
						onClick={select({ fieldId: field.id })} onFocus={selectOnFocus({ fieldId: field.id })}>
						{docStore?.textDisplayGet({ en: field.label }).text ?? field.label}
						{isFieldSelected ? fieldToolbar(field, index) : null}
					</span>;
				})}
			</div>
			{rows.map((row, index) => {
				const rowContent = (content[schema.rowListKey] ?? []).find(item => item.id === row.id) ?? row;
				const isRowSelected = isSelected && selection.rowId === row.id;
				const target = cardRowAnchorBuild(schema, row.id);
				return <div key={row.id} ref={anchorRef?.(target)} className={`doc-er-table-column doc-card-row nodrag nopan${isRowSelected && !selection.fieldId ? ' is-selected' : ''}${isRowSelected ? ' is-row-of-selection' : ''}${dropClass('row', index, rows.length)}`} tabIndex={editor ? 0 : undefined}
					onClick={select({ rowId: row.id })} onFocus={selectOnFocus({ rowId: row.id })}>
					{schema.fieldList.map(field => (
						<CardCell key={field.id} editor={editor} nodeId={nodeId} rowId={row.id} field={field} value={rowContent[field.id]}
							className={`${cellClassName?.(field, row) ?? ''}${isSelected && selection.fieldId === field.id ? ' is-column-selected' : ''}${isRowSelected && selection.fieldId === field.id ? ' is-cell-selected' : ''}`.trim()}>
							{cellRender?.(field, row, row[field.id])}
						</CardCell>
					))}
					{isRowHandleAllowed ? handleAdders(target, handleSides(target)) : null}
					{isRowSelected ? rowToolbar(row, index) : null}
				</div>;
			})}
		</div>
	);
});

// the toolbar of a focused row or field: the control group of the edit
// layer (.doc-button-group), floating beside the row (left of the card) or
// above the field header. the grip drags the item to another place among
// its siblings (a pointer drag, the drop place shown as a line on the
// card); the other buttons act at once. a button the card does not support
// is disabled, and its title says why
//
//   grip        { Icon, axis: 'x' | 'y', title, isDisabled, reason, indexFrom,
//                 rectListGet() -> the rects of the siblings, onPreview(insertion), onDrop(indexTo) }
//   actionList  [{ id, Icon, title, isDisabled?, reason?, isDanger?, act() }]
export function CardToolbar({ className = '', editor, grip, actionList }) {
	return <div className={`doc-card-toolbar doc-button-group nodrag nopan ${className}`.trim()} role="toolbar" onClick={event => event.stopPropagation()}>
		{grip ? <button type="button" className="doc-card-toolbar-grip" title={grip.isDisabled ? grip.reason : grip.title} aria-label={grip.title} disabled={editor.isLocked || grip.isDisabled} onPointerDown={event => reorderStart(event, grip)}><grip.Icon size={13} /></button> : null}
		{actionList.map(action => <button key={action.id} type="button" title={action.isDisabled ? action.reason ?? action.title : action.title} aria-label={action.title} disabled={editor.isLocked || action.isDisabled} data-danger={action.isDanger ? '' : undefined}
			onClick={event => { event.stopPropagation(); editor.change(() => action.act()); }}><action.Icon size={13} /></button>)}
	</div>;
}

// a pointer drag from a grip: the pointer is captured by the grip, the
// insertion place among the siblings follows it (before the sibling whose
// middle the pointer is above, or after the last), and the drop reports the
// index the item moves to
function reorderStart(event, grip) {
	if (event.button !== 0) return;
	event.preventDefault();
	event.stopPropagation();
	const target = event.currentTarget;
	target.setPointerCapture(event.pointerId);
	let indexTo = grip.indexFrom;
	const move = moveEvent => {
		const rectList = grip.rectListGet();
		const at = grip.axis === 'y' ? moveEvent.clientY : moveEvent.clientX;
		let insertion = rectList.findIndex(rect => at < (grip.axis === 'y' ? rect.top + rect.height / 2 : rect.left + rect.width / 2));
		if (insertion < 0) insertion = rectList.length;
		indexTo = insertion > grip.indexFrom ? insertion - 1 : insertion;
		grip.onPreview(insertion);
	};
	const end = () => {
		target.removeEventListener('pointermove', move);
		target.removeEventListener('pointerup', end);
		target.removeEventListener('pointercancel', end);
		try { target.releasePointerCapture(event.pointerId); } catch { /* released already */ }
		grip.onDrop(indexTo);
	};
	target.addEventListener('pointermove', move);
	target.addEventListener('pointerup', end);
	target.addEventListener('pointercancel', end);
}

// one value of a card: text to read, or in the editor a control that edits it
// in place. an enum field picks from a menu, the others are typed. the cell
// keeps the height of the read view, so the card does not move when a cell
// starts or ends editing
export const CardCell = observer(function CardCell({ editor, nodeId, rowId = null, field, value, children, className = '' }) {
	const text = children ?? value ?? '';
	if (!editor) return <span className={className}>{text}</span>;
	const { store, change, isLocked } = editor;
	const cell = store.cell;
	const isEditing = cell?.nodeId === nodeId && cell?.rowId === rowId && cell?.field === field.id;
	const start = () => store.cellStart(nodeId, rowId, field.id);
	return <span className={`${className} doc-vis-cell${isEditing ? ' is-editing' : ''}`.trim()}>
		{field.kind === 'enum' ? <ValueMenu label={`Edit ${field.label ?? field.id}`} value={value ?? ''} values={field.values ?? []} valueLabels={field.valueLabels} isSearchable={field.isSearchable} isCell isLocked={isLocked} onOpen={start} onChange={next => { change(() => store.fieldSet(nodeId, rowId, field.id, next)); store.cellEnd(); }} /> : isEditing ? <TextValue
			label={`Edit ${field.label ?? field.id}`} value={value ?? ''} isLocked={isLocked} isEditing isCell
			onChange={next => change(() => store.fieldSet(nodeId, rowId, field.id, next))}
			onEnd={() => { if (store.cell?.nodeId === nodeId && store.cell?.rowId === rowId && store.cell?.field === field.id) store.cellEnd(); }}
			onCancel={editor.cancelCell}
		/> : <button type="button" className="doc-vis-cell-value nodrag nopan" aria-label={`Edit ${field.label ?? field.id}`} disabled={isLocked} onClick={event => { event.stopPropagation(); start(); }}>{text === '' ? ' ' : text}</button>}
	</span>;
});
