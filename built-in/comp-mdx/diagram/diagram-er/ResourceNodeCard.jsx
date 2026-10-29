import { observer } from 'mobx-react-lite';
import { TableCard } from './TableCard.jsx';
import { cardSchemaGet } from './TableCardSchema.js';
import './ResourceNodeCard.css';

// A Power Platform resource card (a flow step, a business rule): the generic
// table card with the resource schema: head fields under the title and
// property rows, each a name and a value
export const ResourceNodeCard = observer(function ResourceNodeCard({ node, family, label, Icon, anchorRef, editor, nodeId }) {
	const schema = cardSchemaGet(node);
	return (
		<TableCard
			node={node} schema={schema} editor={editor} nodeId={nodeId} anchorRef={anchorRef}
			className={`doc-resource-card is-${family}`}
			columnsStyle={{ '--doc-card-columns': 'minmax(0, 0.8fr) minmax(0, 1.6fr)' }}
			titleLeading={<Icon size={16} />}
			titleTrailing={<span className="doc-resource-family">{label}</span>}
			cellRender={(field, row, value) => field.id === 'value' ? <span title={row.description || undefined}>{value}</span> : undefined}
		/>
	);
});
