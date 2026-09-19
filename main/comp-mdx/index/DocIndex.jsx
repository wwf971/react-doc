import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DocIndexStore } from './DocIndexStore.js';
import { IndexTitleSubtopicsItems } from './IndexTitleSubtopicsItems.jsx';
import './DocIndex.css';

const componentByType = {
	'title-subtopics-items': IndexTitleSubtopicsItems,
};

const DocIndex = observer(function DocIndex({ data = {}, config = {}, onEvent }) {
	const [store] = useState(() => new DocIndexStore(data));
	const source = data.raw ?? data;

	useEffect(() => {
		store.dataLoad(data);
	}, [source, store]);

	if (store.message) {
		return <DocIndexError message={store.message} />;
	}

	const Component = componentByType[store.dataIndex?.type];
	if (!Component) {
		return <DocIndexError message={`Unsupported index type: ${String(store.dataIndex?.type ?? '(missing)')}`} />;
	}

	return <Component data={store.dataIndex} config={config} onEvent={onEvent} />;
});

function DocIndexError({ message }) {
	return (
		<div className="doc-index-error" role="alert">
			<strong>Failed to render document index.</strong>
			<span>{message}</span>
		</div>
	);
}

export { DocIndex };
