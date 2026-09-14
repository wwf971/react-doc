import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DynamicCodeBlock } from '#react-doc/frontend/src/comp-doc/DynamicCodeBlock.js';
import { jsonContentFormat, jsonModeNext, jsonModeNormalize } from './CodeBlockJsonData.js';

function CodeBlockJson({ data = {}, sourceStore, pathList = [] }) {
	const [modeCurrent, setModeCurrent] = useState(() => jsonModeNormalize(data.modeInitial));
	const pathListValid = pathList.filter((path) => typeof path === 'string' && path.trim());
	const sourceList = pathListValid.length > 0
		? pathListValid.map((path) => ({
			key: path,
			path,
			state: sourceStore.rawByPath[path],
			title: sourceStore.entryByInternalPath.get(path)?.name ?? path,
		}))
		: [{
			key: 'inline-json',
			state: { status: 'done', content: data.source ?? data.raw ?? '' },
			title: data.codeTitle,
		}];
	const modeToggle = () => setModeCurrent((mode) => jsonModeNext(mode));
	const Actions = ({ children, className = '' }) => (
		<div className={`${className} doc-code-block-json-actions`}>
			<button
				type="button"
				className="doc-code-block-json-mode"
				aria-label={`JSON display mode: ${modeCurrent}. Click to switch to ${jsonModeNext(modeCurrent)}.`}
				aria-pressed={modeCurrent === 'pretty'}
				onClick={modeToggle}
			>
				<span className={modeCurrent === 'pretty' ? 'is-active' : ''}>Pretty</span>
				<span aria-hidden="true">/</span>
				<span className={modeCurrent === 'plain' ? 'is-active' : ''}>Plain</span>
			</button>
			{children}
		</div>
	);

	return (
		<section className="doc-mdx-source-code doc-code-block-json">
			{data.title ? <h2>{data.title}</h2> : null}
			{sourceList.map(({ key, state, title }) => {
				if (state?.status !== 'done') {
					return state?.status === 'error' ? (
						<p key={key} className="doc-mdx-source-code-error">{state.message}</p>
					) : (
						<p key={key} className="doc-mdx-source-code-loading">JSON を読み込んでいます。</p>
					);
				}

				const result = jsonContentFormat(state.content, modeCurrent);
				return (
					<div key={key} className="doc-code-block-json-entry">
						{result.error ? <p className="doc-code-block-json-error" role="alert">{result.error}</p> : null}
						<DynamicCodeBlock
							code={result.content}
							lang="json"
							codeblock={{
								Actions,
								className: 'doc-code-block-json-code',
								title,
								viewportProps: title ? undefined : {
									style: { '--padding-right': '10.5rem' },
								},
							}}
						/>
					</div>
				);
			})}
		</section>
	);
}

export default observer(CodeBlockJson);
export { CodeBlockJson };