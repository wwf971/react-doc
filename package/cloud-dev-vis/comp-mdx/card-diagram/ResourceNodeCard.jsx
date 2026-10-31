import { observer } from 'mobx-react-lite';
import { TableCard } from './TableCard.jsx';
import './ResourceNodeCard.css';

// A resource card (a Power Platform flow step or business rule, a cloud
// resource): the generic table card with a resource schema
// (resourceCardSchemaBuild, TableCardSchema.js): head fields under the title
// and property rows, each a name and a value. A series draws its resource
// kinds with it, giving a family (the class is-{family}, whose accent color
// --resource-accent the series sets in its own stylesheet), a label and an icon
export const ResourceNodeCard = observer(function ResourceNodeCard({ node, schema, family, label, Icon, anchorRef, editor, nodeId }) {
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
