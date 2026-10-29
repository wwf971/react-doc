import { observer } from 'mobx-react-lite';
import { Plus } from '../../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { cardRowAnchorBuild } from './TableCardSchema.js';
import { TextValue, ValueMenu } from './DiagramValueControls.jsx';
import './DiagramER.css';

// The generic table-like card of a diagram node (comp_db_vis.md#the-table-card):
// a title line (name and a subtitle), an optional description, the head
// fields of the card, a header of its fields, and its rows, one cell per
// field. The Dataverse cards and the resource cards are variants that pass a
// schema (TableCardSchema.js) and small render hooks; the generic `table`
// node is the card as is.
//
// Without an editor the card is plain, selectable text (nodrag nopan on
// every row, so a drag in a row selects text while a drag on the title line
// pans the canvas). With one every value is a cell: a click starts typing in
// it (or opens its menu), the card, its rows, its fields (the columns of the
// card) and its cells are what the author selects, and the row edges offer
// the handles. The read and edit layouts are one grid, so starting to edit
// moves nothing.
//
//   node          the normalized node (its data, handles)
//   schema        cardSchemaGet(node)
//   anchorRef     the diagram's ref for the header and row anchors; absent standalone
//   titleLeading / titleTrailing   what a variant puts beside the name
//   cellRender(field, row, value)  what a variant shows in a read cell (undefined: the value)
//   cellClassName(field, row)      an extra class of a cell
export const TableCard = observer(function TableCard({ node, schema, editor, nodeId, anchorRef, className = '', titleLeading = null, titleTrailing = null, cellRender, cellClassName, columnsStyle }) {
	const { docStore } = useDocStores();
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
	return (
		<div className={`doc-er-table doc-card ${className}${editor ? ' is-editable' : ''}${isSelected && !selection.rowId && !selection.fieldId ? ' is-selected' : ''}`.trim()} style={style} tabIndex={editor ? 0 : undefined}
			onClick={editor ? event => editor.select(nodeId, {}, event.currentTarget) : undefined}
			onFocus={editor ? event => { if (event.target === event.currentTarget) editor.select(nodeId, {}, event.currentTarget); } : undefined}>
			<div ref={anchorRef?.('header')} className="doc-er-table-title doc-card-title">
				<span className="doc-er-table-title-name">
					{titleLeading}
					<CardCell editor={editor} nodeId={nodeId} field={{ id: 'name', kind: 'text' }} value={content.name} className="doc-er-table-title-text" />
				</span>
				{node.data.nameLogical || editor ? <CardCell editor={editor} nodeId={nodeId} field={{ id: 'nameLogical', kind: 'text' }} value={content.nameLogical} className="doc-er-table-title-logical" /> : null}
				{titleTrailing}
				{isHeaderHandleAllowed ? handleAdders('header', titleSides) : null}
			</div>
			{node.data.description ? <div className="doc-er-table-description nodrag nopan">{node.data.description}</div> : null}
			{schema.headFieldList.map(field => (
				<div key={field.id} className="doc-card-head-field nodrag nopan">
					<span className="doc-card-head-label">{field.label}</span>
					<CardCell editor={editor} nodeId={nodeId} field={field} value={content[field.id]} className="doc-card-head-value" />
				</div>
			))}
			<div className="doc-er-table-column-header doc-card-fields nodrag nopan">
				{schema.fieldList.map(field => (
					<span key={field.id} className={`doc-card-field${isSelected && selection.fieldId === field.id && !selection.rowId ? ' is-selected' : ''}`}
						onClick={editor ? event => { event.stopPropagation(); editor.select(nodeId, { fieldId: field.id }, event.currentTarget); } : undefined}>
						{docStore?.textDisplayGet({ en: field.label }).text ?? field.label}
					</span>
				))}
			</div>
			{rows.map(row => {
				const rowContent = (content[schema.rowListKey] ?? []).find(item => item.id === row.id) ?? row;
				const isRowSelected = isSelected && selection.rowId === row.id;
				const target = cardRowAnchorBuild(schema, row.id);
				return <div key={row.id} ref={anchorRef?.(target)} className={`doc-er-table-column doc-card-row nodrag nopan${isRowSelected && !selection.fieldId ? ' is-selected' : ''}${isRowSelected ? ' is-row-of-selection' : ''}`} tabIndex={editor ? 0 : undefined}
					onClick={editor ? event => { event.stopPropagation(); editor.select(nodeId, { rowId: row.id }, event.currentTarget); } : undefined}
					onFocus={editor ? event => { if (event.target === event.currentTarget) editor.select(nodeId, { rowId: row.id }, event.currentTarget); } : undefined}>
					{schema.fieldList.map(field => (
						<CardCell key={field.id} editor={editor} nodeId={nodeId} rowId={row.id} field={field} value={rowContent[field.id]}
							className={`${cellClassName?.(field, row) ?? ''}${isSelected && selection.fieldId === field.id ? ' is-column-selected' : ''}${isRowSelected && selection.fieldId === field.id ? ' is-cell-selected' : ''}`.trim()}>
							{cellRender?.(field, row, row[field.id])}
						</CardCell>
					))}
					{isRowHandleAllowed ? handleAdders(target, handleSides(target)) : null}
				</div>;
			})}
		</div>
	);
});

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
	const start = element => {
		editor.anchorSet(element?.closest('.doc-card-row, .doc-card-title, .doc-card-head-field') ?? element?.closest('.doc-card'));
		store.cellStart(nodeId, rowId, field.id);
	};
	return <span className={`${className} doc-vis-cell${isEditing ? ' is-editing' : ''}`.trim()}>
		{field.kind === 'enum' ? <ValueMenu label={`Edit ${field.label ?? field.id}`} value={value ?? ''} values={field.values ?? []} valueLabels={field.valueLabels} isSearchable={field.isSearchable} isCell isLocked={isLocked} onOpen={() => start(document.activeElement)} onChange={next => { change(() => store.fieldSet(nodeId, rowId, field.id, next)); store.cellEnd(); }} /> : isEditing ? <TextValue
			label={`Edit ${field.label ?? field.id}`} value={value ?? ''} isLocked={isLocked} isEditing isCell
			onChange={next => change(() => store.fieldSet(nodeId, rowId, field.id, next))}
			onEnd={() => { if (store.cell?.nodeId === nodeId && store.cell?.rowId === rowId && store.cell?.field === field.id) store.cellEnd(); }}
			onCancel={editor.cancelCell}
		/> : <button type="button" className="doc-vis-cell-value nodrag nopan" aria-label={`Edit ${field.label ?? field.id}`} disabled={isLocked} onClick={event => { event.stopPropagation(); start(event.currentTarget); }}>{text === '' ? ' ' : text}</button>}
	</span>;
});
