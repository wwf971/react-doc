import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DiagramDataverseEntityStore } from './DiagramDataverseEntityStore.js';
import './DiagramDataverseEntity.css';

const DiagramDataverseEntity = observer(function DiagramDataverseEntity({ data = {} }) {
	const source = data.source || data.raw || '';
	const [store] = useState(() => new DiagramDataverseEntityStore(source));

	useEffect(() => {
		if (store.source !== source) store.sourceLoad(source);
	}, [source, store]);

	if (store.loadState.status === 'error') {
		return (
			<div className="diagram-dataverse-entity-message is-error" role="alert">
				<strong>Dataverse エンティティ定義を読み込めませんでした。</strong>
				<span>{store.loadState.message}</span>
			</div>
		);
	}
	if (store.loadState.status !== 'done' || !store.entity) {
		return <div className="diagram-dataverse-entity-message">Dataverse エンティティ定義が空です。</div>;
	}

	const entity = store.entity;
	return (
		<figure className="diagram-dataverse-entity" aria-label={`${entity.name} の列定義`}>
			<div className="diagram-dataverse-entity-viewport">
				<div className="diagram-dataverse-entity-table">
					<header className="diagram-dataverse-entity-title" title={entity.description || undefined}>
						<span>{entity.name}</span>
						<span className="diagram-dataverse-entity-title-logical">{entity.nameLogical}</span>
					</header>
					<div className="diagram-dataverse-entity-column-header" aria-hidden="true">
						<span>Key</span>
						<span>列</span>
						<span>論理名</span>
						<span>型</span>
					</div>
					<div className="diagram-dataverse-entity-column-list">
						{entity.columnList.map((column) => (
							<div key={column.id} className="diagram-dataverse-entity-column">
								<span className={`diagram-dataverse-entity-key${column.key ? ' is-set' : ''}`}>
									{column.key}
								</span>
								<span className="diagram-dataverse-entity-column-name" title={column.description || undefined}>
									{column.name}
									{column.isRequired ? <sup aria-label="必須">*</sup> : null}
								</span>
								<span className="diagram-dataverse-entity-column-logical">{column.nameLogical}</span>
								<span className="diagram-dataverse-entity-column-type">{column.type}</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</figure>
	);
});

export { DiagramDataverseEntity };
export default DiagramDataverseEntity;
