import { observer } from 'mobx-react-lite';
import { DataverseCell } from './DataverseVisualEdit.jsx';
import './ResourceNodeCard.css';

export const ResourceNodeCard = observer(function ResourceNodeCard({ data, fields, family, label, Icon, anchorRef, editor, nodeId }) {
	const focus = editor?.store.focus;
	const isFocused = focus?.nodeId === nodeId;
	const cell = (field, value, rowId = null) => <DataverseCell editor={editor} nodeId={nodeId} rowId={rowId} field={field.id} value={value} values={field.values} />;
	return <div className={`doc-er-table doc-resource-card is-${family}${editor ? ' is-editable' : ''}${isFocused && !focus.rowId ? ' is-focused' : ''}`} tabIndex={editor ? 0 : undefined}
		onClick={editor ? event => editor.focus(nodeId, null, event.currentTarget) : undefined}>
		<div ref={anchorRef?.('header')} className="doc-er-table-title">
			<Icon size={16} />
			<span className="doc-er-table-title-text">{cell(fields[0], data.name)}</span>
			<span className="doc-resource-family">{label}</span>
		</div>
		{fields.slice(1).map(field => <div key={field.id} className="doc-resource-field nodrag">
			<span className="doc-resource-label">{field.label}</span>
			{cell(field, data[field.id])}
		</div>)}
		{data.properties.map(property => <div key={property.id} ref={anchorRef?.(`property/${property.id}`)} className={`doc-resource-field doc-resource-property nodrag${isFocused && focus.rowId === property.id ? ' is-focused' : ''}`}
			onClick={editor ? event => { event.stopPropagation(); editor.focus(nodeId, property.id, event.currentTarget); } : undefined}>
			{cell({ id: 'name' }, property.name, property.id)}
			<span title={property.description || undefined}>{cell({ id: 'value' }, property.value, property.id)}</span>
		</div>)}
	</div>;
});