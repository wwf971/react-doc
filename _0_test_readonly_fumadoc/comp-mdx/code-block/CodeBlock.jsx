import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '#react-doc/frontend/src/store/context.js';
import CodeBlockCompact from './CodeBlockCompact.jsx';
import CodeBlockFull from './CodeBlockFull.jsx';
import CodeBlockJson from './CodeBlockJson.jsx';
import './CodeBlock.css';

const componentByType = {
	compact: CodeBlockCompact,
	full: CodeBlockFull,
	json: CodeBlockJson,
};

function CodeBlock({ data = {}, config = {} }) {
	const { sourceStore } = useDocStores();
	const paths = data.paths ?? [];
	const pathList = Array.isArray(paths) ? paths : [paths];
	const type = typeof data.type === 'string' ? data.type : 'full';
	const Component = componentByType[type] ?? CodeBlockFull;

	useEffect(() => {
		for (const path of pathList) void sourceStore.loadRaw(path);
	}, [sourceStore, pathList.join('\n')]);

	return <Component data={data} config={config} sourceStore={sourceStore} pathList={pathList} />;
}

export default observer(CodeBlock);
export { CodeBlock };
