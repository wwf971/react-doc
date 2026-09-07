import { observer } from 'mobx-react-lite';
import { DynamicCodeBlock } from '../../frontend/src/comp-doc/DynamicCodeBlock.js';

function CodeBlockFull({ data = {}, sourceStore, pathList = [] }) {
	return (
		<section className="doc-mdx-source-code">
			{data.title ? <h2>{data.title}</h2> : null}
			{pathList.map((path) => {
				const state = sourceStore.rawByPath[path];
				const entry = sourceStore.entryByInternalPath.get(path);
				if (state?.status === 'done') {
					const language = sourceStore.configDoc.fileDisplay?.[entry?.ext] ?? entry?.ext ?? 'text';
					return (
						<DynamicCodeBlock
							key={path}
							code={state.content}
							lang={language}
							codeblock={{ title: entry?.name ?? path }}
						/>
					);
				}
				return state?.status === 'error' ? (
					<p key={path} className="doc-mdx-source-code-error">{state.message}</p>
				) : (
					<p key={path} className="doc-mdx-source-code-loading">ソースを読み込んでいます。</p>
				);
			})}
		</section>
	);
}

export default observer(CodeBlockFull);
export { CodeBlockFull };
