import { observer } from 'mobx-react-lite';
import { CardCell } from '../card-diagram/TableCard.jsx';
import './OperatorStyle.css';

export const OperatorAbandon = observer(function OperatorAbandon({ node, editor, nodeId }) {
	const content = editor?.store.nodeGet(nodeId)?.data ?? node.data;
	return <div data-node-id={nodeId} className="doc-operator doc-operator-abandon" tabIndex={editor ? 0 : undefined}
		onClick={editor ? event => { event.stopPropagation(); editor.select(nodeId); } : undefined}>
		<CardCell editor={editor} nodeId={nodeId} field={{ id: 'name', label: 'Label', kind: 'text' }} value={content.name ?? 'Abandon'} />
	</div>;
});