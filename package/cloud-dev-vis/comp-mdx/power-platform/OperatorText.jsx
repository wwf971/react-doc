import { observer } from 'mobx-react-lite';
import { CardCell } from '../card-diagram/TableCard.jsx';
import './OperatorStyle.css';

export const OperatorText = observer(function OperatorText({ node, editor, nodeId }) {
	const content = editor?.store.nodeGet(nodeId)?.data ?? node.data;
	return <div data-node-id={nodeId} className="doc-operator doc-operator-text" tabIndex={editor ? 0 : undefined}
		onClick={editor ? event => { event.stopPropagation(); editor.select(nodeId); } : undefined}>
		<div className="doc-operator-title"><CardCell editor={editor} nodeId={nodeId} field={{ id: 'name', label: 'Header', kind: 'text' }} value={content.name} /></div>
		<div className="doc-operator-description nodrag nopan"><CardCell editor={editor} nodeId={nodeId} field={{ id: 'description', label: 'Operation', kind: 'text' }} value={content.description} /></div>
	</div>;
});