import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { BlockPopupSurface } from '../../../../main/comp-doc/popup/BlockPopupSurface.jsx';
import { DiagramDataverseEntityStore } from './DiagramDataverseEntityStore.js';
import { DataverseCard } from '../diagram-er/DataverseCard.jsx';
import { DiagramVisualEdit } from '../diagram-er/DiagramVisualEdit.jsx';

// One Dataverse table card in the flow of the document, without a canvas
// (comp_db_table.md). Both modes render inside BlockPopupSurface: the card
// opens in the block popup and is edited there; the surface's outer box
// carries the block's margins (doc_page_impl_mdx_comp_block.md).
function DiagramDataverseEntity({ data = {}, config = {}, onEvent }) {
	return (
		<BlockPopupSurface config={config} title={data.title || 'Dataverse table'} className="doc-vis-card-shell not-prose">
			{({ isInPopup }) => (config.isEdit && config.edit?.modeId === 'visual'
				? <DiagramVisualEdit data={data} config={config} onEvent={onEvent} kind="card" isInPopup={isInPopup} renderContent={props => <DiagramDataverseEntityView {...props} isInPopup={isInPopup} />} />
				: <DiagramDataverseEntityView data={data} isInPopup={isInPopup} />)}
		</BlockPopupSurface>
	);
}

const DiagramDataverseEntityView = observer(function DiagramDataverseEntityView({ data = {}, editor, isInPopup = false }) {
	const source = data.source || data.raw || '';
	const [store] = useState(() => new DiagramDataverseEntityStore(source));

	useEffect(() => {
		if (store.source !== source) store.sourceLoad(source);
	}, [source, store]);

	if (store.loadState.status === 'error') {
		return (
			<div className="doc-er-diagram-message is-error" role="alert">
				<strong>The table definition could not be read.</strong>
				<span>{store.loadState.message}</span>
			</div>
		);
	}
	if (store.loadState.status !== 'done' || !store.entity) {
		return <div className="doc-er-diagram-message">The table definition is empty.</div>;
	}

	const node = store.node;
	const width = node.size.width === 'auto' ? node.sizeDefault.width : node.size.width;
	return (
		<figure className={`doc-vis-card-static${isInPopup ? ' is-popup' : ''}`} aria-label={`Columns of ${node.data.name}`}
			style={{ width, height: node.size.height === 'auto' ? 'auto' : node.size.height }}>
			<div style={{ width }}>
				<DataverseCard node={node} editor={editor} nodeId={node.id} />
			</div>
		</figure>
	);
});

export { DiagramDataverseEntity };
export default DiagramDataverseEntity;
