import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { IndexStore } from './IndexStore.js';
import { IndexTitleSubtopicsItems } from './IndexTitleSubtopicsItems.jsx';
import './Index.css';

const componentByType = {
	'title-subtopics-items': IndexTitleSubtopicsItems,
};

const Index = observer(function Index({ data = {}, config = {}, onEvent }) {
	const [store] = useState(() => new IndexStore(data));
	const source = data.raw ?? data;

	useEffect(() => {
		store.dataLoad(data);
	}, [source, store]);

	if (store.message) {
		return <IndexError message={store.message} />;
	}

	const Component = componentByType[store.dataIndex?.type];
	if (!Component) {
		return <IndexError message={`Unsupported index type: ${String(store.dataIndex?.type ?? '(missing)')}`} />;
	}

	return <Component data={store.dataIndex} config={config} onEvent={onEvent} />;
});

function IndexError({ message }) {
	return (
		<div className="doc-index-error" role="alert">
			<strong>Failed to render document index.</strong>
			<span>{message}</span>
		</div>
	);
}

export { Index, Index as DocIndex };
