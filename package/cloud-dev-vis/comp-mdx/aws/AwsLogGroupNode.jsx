import { observer } from 'mobx-react-lite';
import { ScrollText } from '../../../../main/frontend/UICommon.js';
import { CardCell } from '../card-diagram/TableCard.jsx';
import { AwsKindIcon } from './AwsKindIcon.jsx';

// a log group: the pill of a brief card (CompactCard.jsx) in the accent of its family, its name
// and its retention typed in place
export const AwsLogGroupNode = observer(function AwsLogGroupNode({ node, editor, nodeId }) {
	const content = editor?.store.nodeGet(nodeId)?.data ?? node.data;
	return (
		<div data-node-id={nodeId} className="doc-card-brief doc-aws-log-group" onClick={editor ? (event) => { event.stopPropagation(); editor.select(nodeId); } : undefined}>
			<span className="doc-card-brief-icon"><AwsKindIcon type="aws-log-group" Icon={ScrollText} size={14} /></span>
			<span className="doc-card-brief-text">
				<span className="doc-card-brief-title"><CardCell editor={editor} nodeId={nodeId} field={{ id: 'name', kind: 'text', label: 'Name' }} value={content.name ?? ''}>{node.data.name}</CardCell></span>
				{node.data.retention || editor ? <span className="doc-card-brief-stat"><span>retention</span><CardCell editor={editor} nodeId={nodeId} field={{ id: 'retention', kind: 'text', label: 'Retention' }} value={content.retention ?? ''}>{node.data.retention}</CardCell></span> : null}
			</span>
		</div>
	);
});
