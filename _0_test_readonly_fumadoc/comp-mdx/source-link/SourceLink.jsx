import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LogOut } from 'lucide-react';
import { useDocStores } from '../../frontend/src/store/context.js';
import { CodeBlockCompactPopup } from '../code-block/CodeBlockCompactPopup.jsx';
import { CodeBlockCompactStore } from '../code-block/CodeBlockCompactStore.js';
import './SourceLink.css';

const SourceLink = observer(function SourceLink({ data = {}, config = {}, onEvent }) {
	const { sourceStore } = useDocStores();
	const [store] = useState(() => new CodeBlockCompactStore());
	const target = targetGet(data);
	const label = String(data.label ?? data.title ?? target);
	const sourceState = target ? sourceStore.rawByPath[target] : undefined;
	const isReady = sourceState?.status === 'done';
	const Panel = config.panelComponent;

	useEffect(() => {
		if (target) void sourceStore.loadRaw(target);
	}, [sourceStore, target]);

	useEffect(() => () => store.dispose(), [store]);

	const popupOpen = async () => {
		const result = await onEvent?.('openRequest', { target });
		if (!result?.isHandled) store.popupOpen(target);
	};

	const title = !target
		? '表示するソースファイルが指定されていません。'
		: !Panel
			? 'SourceLink には config.panelComponent が必要です。'
			: sourceState?.status === 'error'
				? sourceState.message
				: isReady ? `ソースを表示: ${target}` : 'ソースを読み込んでいます…';

	return (
		<span className={`doc-source-link${config.className ? ` ${config.className}` : ''}`}>
			<button
				type="button"
				className="doc-source-link-button"
				disabled={!target || !isReady || !Panel}
				title={title}
				aria-haspopup="dialog"
				onClick={() => void popupOpen()}
			>
				<span>{label}</span>
				<LogOut className="doc-source-link-icon" aria-hidden="true" width={13} height={13} />
			</button>
			<CodeBlockCompactPopup Panel={Panel} sourceStore={sourceStore} store={store} />
		</span>
	);
});

function targetGet(data) {
	const target = String(data.target ?? '').trim();
	if (target) return target;
	return String(data.raw ?? '')
		.trim()
		.split(/\r?\n/, 1)[0]
		.trim();
}

export { SourceLink };
export default SourceLink;
