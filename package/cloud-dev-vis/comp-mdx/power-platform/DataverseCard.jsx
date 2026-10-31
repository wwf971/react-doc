import { observer } from 'mobx-react-lite';
import { TableCard } from '../card-diagram/TableCard.jsx';

// the column header of a Dataverse card, in the language of the page
const dataverseColumnsStyle = { '--doc-card-columns': '2.9rem minmax(6.5rem, 1fr) minmax(7rem, 1.1fr) 7rem' };

// One Dataverse table (or global choice) card: the generic table card with
// the Dataverse schema (DataverseCardData.js), given by the node registry,
// shared by a diagram node and the standalone DiagramDataverseEntity. A choice card draws a dashed border and
// a badge; a key cell is highlighted when set, a required column is starred,
// and a column's description is its tooltip.
export const DataverseCard = observer(function DataverseCard({ node, schema, anchorRef, editor, nodeId }) {
	const isChoice = node.renderer.type === 'dataverse-choice';
	return (
		<TableCard
			node={node} schema={schema} editor={editor} nodeId={nodeId} anchorRef={anchorRef}
			className={isChoice ? 'is-choice' : ''}
			columnsStyle={dataverseColumnsStyle}
			titleLeading={isChoice ? <span className="doc-er-table-badge">Global Choice</span> : null}
			cellClassName={(field, row) => field.id === 'key' ? `doc-er-table-key${row.key ? ' is-set' : ''}` : field.id === 'name' ? 'doc-er-table-column-name' : field.id === 'nameLogical' ? 'doc-er-table-column-logical' : 'doc-er-table-column-type'}
			cellRender={(field, row, value) => field.id === 'name'
				? <span title={row.description || undefined}>{row.name}{row.isRequired ? <sup aria-label="Required">*</sup> : null}</span>
				: field.id === 'nameLogical' ? (row.nameLogical || row.id) : undefined}
		/>
	);
});
