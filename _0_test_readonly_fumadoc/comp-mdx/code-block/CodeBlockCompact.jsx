import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FileCode } from 'lucide-react';
import { CodeBlockCompactPopup } from './CodeBlockCompactPopup.jsx';
import { CodeBlockCompactStore } from './CodeBlockCompactStore.js';

function CodeBlockCompact({ data = {}, config = {}, sourceStore, pathList = [] }) {
	const [store] = useState(() => new CodeBlockCompactStore());
	const Panel = config.panelComponent;

	useEffect(() => () => store.dispose(), [store]);

	return (
		<section className={`doc-code-block-compact-list${data.isGrid ? ' is-grid' : ''}`}>
			{data.title ? <h2>{data.title}</h2> : null}
			{pathList.map((path) => {
				const state = sourceStore.rawByPath[path];
				const entry = sourceStore.entryByInternalPath.get(path);
				const isReady = state?.status === 'done';
				const label = entry?.name ?? path;
				return (
					<button
						key={path}
						type="button"
						className="doc-code-block-compact-item"
						disabled={!isReady || !Panel}
						title={!Panel
							? 'Compact CodeBlock requires config.panelComponent.'
							: state?.status === 'error' ? state.message : `コードを表示: ${label}`}
						aria-haspopup="dialog"
						onClick={() => store.popupOpen(path)}
					>
						<FileCode aria-hidden="true" width={16} height={16} />
						<span>{label}</span>
						{!isReady ? (
							<span className="doc-code-block-compact-state">
								{state?.status === 'error' ? '読み込みエラー' : '読み込み中'}
							</span>
						) : null}
					</button>
				);
			})}
			<CodeBlockCompactPopup Panel={Panel} sourceStore={sourceStore} store={store} />
		</section>
	);
}

export default observer(CodeBlockCompact);
export { CodeBlockCompact };
