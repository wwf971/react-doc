import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DiagramDataverseEntityStore } from './DiagramDataverseEntityStore.js';
import { DataverseCard } from '../diagram-er/DataverseCard.jsx';
import { DataverseVisualEdit } from '../diagram-er/DataverseVisualEdit.jsx';

function DiagramDataverseEntity({ data = {}, config = {}, onEvent }) {
	if (config.isEdit && config.edit?.modeId === 'visual') return <DataverseVisualEdit data={data} config={config} onEvent={onEvent} kind="card" renderContent={props => <DiagramDataverseEntityView {...props} />} />;
	return <DiagramDataverseEntityView data={data} />;
}

const DiagramDataverseEntityView = observer(function DiagramDataverseEntityView({ data = {}, editor }) {
	const source = data.source || data.raw || '';
	const [store] = useState(() => new DiagramDataverseEntityStore(source));

	useEffect(() => {
		if (store.source !== source) store.sourceLoad(source);
	}, [source, store]);

	if (store.loadState.status === 'error') {
		return (
			<div className="doc-er-diagram-message is-error" role="alert">
				<strong>Dataverse エンティティ定義を読み込めませんでした。</strong>
				<span>{store.loadState.message}</span>
			</div>
		);
	}
	if (store.loadState.status !== 'done' || !store.entity) {
		return <div className="doc-er-diagram-message">Dataverse エンティティ定義が空です。</div>;
	}

	const node = store.node;
	return (
		<figure className="doc-vis-card-static" aria-label={`${node.data.name} の列定義`}
			style={{ width: node.size.width === 'auto' ? node.sizeDefault.width : node.size.width, height: node.size.height === 'auto' ? 'auto' : node.size.height }}>
			<div style={{ width: node.size.width === 'auto' ? node.sizeDefault.width : node.size.width }}>
				<DataverseCard data={node.data} type="dataverse-table" editor={editor} nodeId={node.id} />
			</div>
		</figure>
	);
});

export { DiagramDataverseEntity };
export default DiagramDataverseEntity;
