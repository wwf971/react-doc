import './DiagramER.css';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { DataverseCell } from './DataverseVisualEdit.jsx';

// the column header of a card, in the language of the page
const headerTextList = [
	{ en: 'Key', jp: 'Key' },
	{ en: 'Column', jp: '列' },
	{ en: 'Logical name', jp: '論理名' },
	{ en: 'Type', jp: '型' },
];

// One Dataverse table (or global choice) card, shared by a diagram node and
// the standalone DiagramDataverseEntity. Without an editor it is plain,
// selectable text; with one (DataverseVisualEdit) every value is a cell of
// the editor, and the card and its rows are what the author selects. The
// read and edit layouts are the same grid, so starting to edit moves nothing.
//
//   anchorRef(anchorId)  the diagram's ref for header and column/<id>
//                        anchors, where it draws handles; absent standalone
export const DataverseCard = observer(function DataverseCard({ data, type = 'dataverse-table', anchorRef, editor, nodeId }) {
	const { docStore } = useDocStores();
	const isChoice = type === 'dataverse-choice';
	const focus = editor?.store.focus;
	const isFocused = focus?.nodeId === nodeId;
	const content = editor?.store.nodes.find(node => node.id === nodeId)?.data ?? data;
	const cell = (field, className, children) => <DataverseCell editor={editor} nodeId={nodeId} field={field} value={content[field]} className={className}>{children}</DataverseCell>;
	return (
		<div className={`doc-er-table${isChoice ? ' is-choice' : ''}${editor ? ' is-editable' : ''}${isFocused && !focus.rowId ? ' is-focused' : ''}`} tabIndex={editor ? 0 : undefined}
			onClick={editor ? event => editor.focus(nodeId, null, event.currentTarget) : undefined}
			onFocus={editor ? event => { if (event.target === event.currentTarget) editor.focus(nodeId, null, event.currentTarget); } : undefined}>
			<div ref={anchorRef?.('header')} className="doc-er-table-title">
				<span className="doc-er-table-title-name">
					{isChoice ? <span className="doc-er-table-badge">Global Choice</span> : null}
					{cell('name', 'doc-er-table-title-text')}
				</span>
				{data.nameLogical || editor ? cell('nameLogical', 'doc-er-table-title-logical') : null}
			</div>
			{data.description ? <div className="doc-er-table-description nodrag">{data.description}</div> : null}
			<div className="doc-er-table-column-header nodrag">
				{headerTextList.map(text => <span key={text.en}>{docStore?.textDisplayGet(text).text ?? text.en}</span>)}
			</div>
			{data.columns.map(column => {
				const row = content.columns.find(item => item.id === column.id) ?? column;
				return <div key={column.id} ref={anchorRef?.(`column/${column.id}`)} className={`doc-er-table-column nodrag${isFocused && focus.rowId === column.id ? ' is-focused' : ''}`} tabIndex={editor ? 0 : undefined}
					onClick={editor ? event => { event.stopPropagation(); editor.focus(nodeId, column.id, event.currentTarget); } : undefined}
					onFocus={editor ? event => { if (event.target === event.currentTarget) editor.focus(nodeId, column.id, event.currentTarget); } : undefined}>
					<DataverseCell editor={editor} nodeId={nodeId} rowId={column.id} field="key" value={row.key} className={`doc-er-table-key${column.key ? ' is-set' : ''}`} />
					<DataverseCell editor={editor} nodeId={nodeId} rowId={column.id} field="name" value={row.name} className="doc-er-table-column-name"><span title={column.description || undefined}>{column.name}{column.isRequired ? <sup aria-label="Required">*</sup> : null}</span></DataverseCell>
					<DataverseCell editor={editor} nodeId={nodeId} rowId={column.id} field="nameLogical" value={row.nameLogical} className="doc-er-table-column-logical">{column.nameLogical || column.id}</DataverseCell>
					<DataverseCell editor={editor} nodeId={nodeId} rowId={column.id} field="type" value={row.type} className="doc-er-table-column-type" />
				</div>;
			})}
		</div>
	);
});
