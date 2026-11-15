import { observer } from 'mobx-react-lite';
import { Braces } from '../../../../main/frontend/UICommon.js';
import { TableCard } from '../card-diagram/TableCard.jsx';
import { AwsKindIcon } from './AwsKindIcon.jsx';

const columnsStyle = { '--doc-card-columns': '4.4rem minmax(8rem, 1fr) 3.4rem' };

// the routes of one group: the table card in the look of a resource card; the method in small
// capitals, a route answered without a token marked
export const AwsRouteGroupNode = observer(function AwsRouteGroupNode({ node, schema, anchorRef, editor, nodeId }) {
	return (
		<TableCard
			node={node} schema={schema} editor={editor} nodeId={nodeId} anchorRef={anchorRef}
			className="doc-resource-card is-aws-network doc-aws-row-card"
			columnsStyle={columnsStyle}
			titleLeading={<AwsKindIcon type="aws-route-group" Icon={Braces} />}
			titleTrailing={<span className="doc-resource-family">Routes</span>}
			cellClassName={(field, row) => (field.id === 'method' ? 'doc-aws-route-method' : field.id === 'path' ? 'doc-aws-route-path' : field.id === 'auth' ? `doc-aws-route-auth${row.auth === 'none' ? ' is-open' : ''}` : '')}
		/>
	);
});
