import { observer } from 'mobx-react-lite';
import { Database } from '../../../../main/frontend/UICommon.js';
import { TableCard } from '../card-diagram/TableCard.jsx';
import { AwsKindIcon } from './AwsKindIcon.jsx';

const columnsStyle = { '--doc-card-columns': '3.4rem minmax(5.5rem, 1fr) 3rem minmax(6rem, 1.5fr)' };

// a table of DynamoDB, or one kind of its rows: the table card in the look of a resource card
// (an accent on its title line), a key cell marked when set, what an attribute holds as its tooltip
export const AwsDynamodbTableNode = observer(function AwsDynamodbTableNode({ node, schema, anchorRef, editor, nodeId }) {
	return (
		<TableCard
			node={node} schema={schema} editor={editor} nodeId={nodeId} anchorRef={anchorRef}
			className="doc-resource-card is-aws-database doc-aws-row-card"
			columnsStyle={columnsStyle}
			titleLeading={<AwsKindIcon type="aws-dynamodb-table" Icon={Database} />}
			titleTrailing={<span className="doc-resource-family">DynamoDB</span>}
			cellClassName={(field, row) => (field.id === 'key' ? `doc-er-table-key${row.key ? ' is-set' : ''}` : field.id === 'name' ? 'doc-aws-attribute-name' : '')}
			cellRender={(field, row, value) => (field.id === 'name' ? <span title={row.description || undefined}>{value}</span> : undefined)}
		/>
	);
});
