import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Copy } from '../../frontend/UICommon.js';
import { DynamicCodeBlock } from '../../frontend/src/comp-doc/DynamicCodeBlock.js';
import './CodeBlock.css';

function CodeBlockCompactPopup({ Panel, sourceStore, store }) {
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

	useEffect(() => {
		if (!store.isPopupOpen) return undefined;
		const keyDownHandle = (event) => {
			if (event.key === 'Escape') store.popupClose();
		};
		window.addEventListener('keydown', keyDownHandle);
		return () => window.removeEventListener('keydown', keyDownHandle);
	}, [store, store.isPopupOpen]);

	if (!Panel || !store.isPopupOpen || statePopup?.status !== 'done') return null;

	return (
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
	);
}

const CodeBlockCompactPopupObserved = observer(CodeBlockCompactPopup);

export default CodeBlockCompactPopupObserved;
export { CodeBlockCompactPopupObserved as CodeBlockCompactPopup };
