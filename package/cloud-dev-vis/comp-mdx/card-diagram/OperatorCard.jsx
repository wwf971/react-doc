import { observer } from 'mobx-react-lite';
import { CardCell } from './TableCard.jsx';

// an operator: a label and a note, selectable as a whole in the editor
export const OperatorCard = observer(function OperatorCard({ node, editor, nodeId }) {
	const content = editor?.store.nodeGet(nodeId)?.data ?? node.data;
	const isSelected = editor?.store.selection?.nodeId === nodeId;
	return <div data-node-id={nodeId} className={`doc-vis-operator${editor ? ' is-editable' : ''}${isSelected ? ' is-selected' : ''}`} tabIndex={editor ? 0 : undefined}
		onClick={editor ? event => { event.stopPropagation(); editor.select(nodeId); } : undefined}>
		<strong><CardCell editor={editor} nodeId={nodeId} field={{ id: 'label', kind: 'text', label: 'Label' }} value={content.label ?? content.name ?? ''}>{node.data.label ?? node.data.name ?? nodeId}</CardCell></strong>
		{node.data.description || editor ? <p className="nodrag nopan"><CardCell editor={editor} nodeId={nodeId} field={{ id: 'description', kind: 'text', label: 'Description' }} value={content.description ?? ''}>{node.data.description}</CardCell></p> : null}
	</div>;
});
