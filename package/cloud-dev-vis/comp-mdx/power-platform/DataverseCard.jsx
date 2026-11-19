import { observer } from 'mobx-react-lite';
import { TableCard } from '../card-diagram/TableCard.jsx';

// the columns of a Dataverse card: its four, then the further fields its data declares
// (fieldExtraList, TableCardSchema.js), each as wide as it says
const DATAVERSE_COLUMNS = '2.9rem minmax(6.5rem, 1fr) minmax(7rem, 1.1fr) 7rem';
const dataverseColumnsStyle = { '--doc-card-columns': DATAVERSE_COLUMNS };
const columnsStyleByExtra = new Map();
function dataverseColumnsStyleOf(schema) {
	const extra = (schema.fieldExtraList ?? []).map(field => field.width || 'minmax(6rem, 1fr)').join(' ');
	if (!extra) return dataverseColumnsStyle;
	if (!columnsStyleByExtra.has(extra)) columnsStyleByExtra.set(extra, { '--doc-card-columns': `${DATAVERSE_COLUMNS} ${extra}` });
	return columnsStyleByExtra.get(extra);
}

// One Dataverse table (or choice, global or not) card: the generic table card with
// the Dataverse schema (DataverseCardData.js), given by the node registry,
// shared by a diagram node and the standalone DiagramDataverseEntity. A choice card draws a dashed border and
// a badge; a key cell is highlighted when set, a required column is starred,
// and a column's description is its tooltip.
export const DataverseCard = observer(function DataverseCard({ node, schema, anchorRef, editor, nodeId }) {
	const isChoice = node.renderer.type === 'dataverse-choice';
	return (
		<TableCard
			node={node} schema={schema} editor={editor} nodeId={nodeId} anchorRef={anchorRef}
			className={isChoice ? 'is-choice' : node.data.isMaster ? 'is-master' : ''}
			columnsStyle={dataverseColumnsStyleOf(schema)}
			titleLeading={isChoice ? <span className="doc-er-table-badge">{node.data.isGlobal === false ? 'Option Set' : 'Global Choice'}</span> : null}
			cellClassName={(field, row) => field.id === 'key' ? `doc-er-table-key${row.key ? ' is-set' : ''}` : field.id === 'name' ? 'doc-er-table-column-name' : field.id === 'nameLogical' ? 'doc-er-table-column-logical' : field.id === 'type' ? 'doc-er-table-column-type' : 'doc-er-table-column-extra'}
			cellRender={(field, row, value) => field.id === 'name'
				? <span title={row.description || undefined}>{row.name}{row.isRequired ? <sup aria-label="Required">*</sup> : null}</span>
				: field.id === 'nameLogical' ? (row.nameLogical || row.id) : undefined}
		/>
	);
});
