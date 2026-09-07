import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Copy, FileCode } from 'lucide-react';
import { DynamicCodeBlock } from '../../frontend/src/comp-doc/DynamicCodeBlock.js';
import { CodeBlockCompactStore } from './CodeBlockCompactStore.js';

function CodeBlockCompact({ data = {}, config = {}, sourceStore, pathList = [] }) {
	const [store] = useState(() => new CodeBlockCompactStore());
	const Panel = config.panelComponent;
	const pathPopup = store.pathPopup;
	const statePopup = pathPopup ? sourceStore.rawByPath[pathPopup] : undefined;
	const entryPopup = pathPopup ? sourceStore.entryByInternalPath.get(pathPopup) : undefined;
	const languagePopup = sourceStore.configDoc.fileDisplay?.[entryPopup?.ext]
		?? entryPopup?.ext
		?? 'text';
	const copyLabel = store.copyStatus === 'copied'
		? 'コピーしました'
		: store.copyStatus === 'failed'
			? 'コピーできませんでした'
			: 'コードをコピー';

	useEffect(() => () => store.dispose(), [store]);

	useEffect(() => {
		if (!store.isPopupOpen) return undefined;
		const keyDownHandle = (event) => {
			if (event.key === 'Escape') store.popupClose();
		};
		window.addEventListener('keydown', keyDownHandle);
		return () => window.removeEventListener('keydown', keyDownHandle);
	}, [store, store.isPopupOpen]);

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
			{Panel && store.isPopupOpen && statePopup?.status === 'done' ? (
				<Panel
					data={{ title: entryPopup?.name ?? pathPopup }}
					config={{
						isPopup: true,
						isCloseVisible: true,
						className: 'doc-code-block-compact-popup',
						bodyClassName: 'doc-code-block-compact-popup-body',
					}}
					headerRightContent={(
						<button
							type="button"
							className={`doc-code-block-compact-copy is-${store.copyStatus}`}
							title={copyLabel}
							aria-label={copyLabel}
							onClick={() => store.contentCopy(statePopup.content)}
						>
							<Copy aria-hidden="true" width={15} height={15} />
						</button>
					)}
					content={(
						<DynamicCodeBlock
							code={statePopup.content}
							lang={languagePopup}
							codeblock={{ allowCopy: false, className: 'doc-code-block-compact-popup-code' }}
						/>
					)}
					onEvent={(eventType) => {
						if (eventType === 'closeRequest') store.popupClose();
					}}
				/>
			) : null}
		</section>
	);
}

export default observer(CodeBlockCompact);
export { CodeBlockCompact };
