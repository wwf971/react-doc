import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LogOut } from '#react-doc/frontend/UICommon.js';
import { LinkDocRender } from '#react-doc/frontend/src/comp-doc/LinkDocRender.jsx';
import { LinkWarning } from '#react-doc/frontend/src/comp-doc/LinkWarning.jsx';
import { useDocStores } from '#react-doc/frontend/src/store/context.js';
import { CodeBlockCompactPopup } from '../code-block/CodeBlockCompactPopup.jsx';
import { CodeBlockCompactStore } from '../code-block/CodeBlockCompactStore.js';
import './SourceLink.css';

const SourceLink = observer(function SourceLink({ data = {}, config = {}, onEvent }) {
	const { sourceStore } = useDocStores();
	const [store] = useState(() => new CodeBlockCompactStore());
	const [warningText, setWarningText] = useState('');
	const refWrap = useRef(null);
	const target = targetGet(data);
	const label = String(data.label ?? data.title ?? target);
	const sourceEntry = target ? sourceStore.entryByInternalPath.get(target) : undefined;
	const sourceState = target ? sourceStore.rawByPath[target] : undefined;
	const isReady = sourceState?.status === 'done';
	const Panel = config.panelComponent;
	const isBroken = !target || !sourceEntry;
	const isUnavailable = Boolean(sourceEntry)
		&& (!Panel || sourceState?.status === 'error');

	useEffect(() => {
		if (target) void sourceStore.loadRaw(target);
	}, [sourceStore, target]);

	useEffect(() => {
		if (!warningText) return undefined;
		const onDocMouseDown = (event) => {
			if (refWrap.current && !refWrap.current.contains(event.target)) {
				setWarningText('');
			}
		};
		document.addEventListener('mousedown', onDocMouseDown);
		return () => document.removeEventListener('mousedown', onDocMouseDown);
	}, [warningText]);

	useEffect(() => setWarningText(''), [target, Panel, sourceState?.status]);

	useEffect(() => () => store.dispose(), [store]);

	const title = !target
		? '表示するソースファイルが指定されていません。'
		: !sourceEntry
			? `source file not found: ${target}`
			: !Panel
			? 'SourceLink には config.panelComponent が必要です。'
			: sourceState?.status === 'error'
				? sourceState.message
				: isReady ? `ソースを表示: ${target}` : 'ソースを読み込んでいます…';
	const eventHandle = async (eventType, eventData = {}) => {
		if (eventType !== 'activateRequest') return;
		eventData.event?.preventDefault();
		const result = await onEvent?.('openRequest', { ...eventData, target });
		if (result?.isHandled) return;
		if (!Panel || !isReady) {
			setWarningText(title);
			return;
		}
		setWarningText('');
		store.popupOpen(target);
	};

	return (
		<span ref={refWrap} className={`doc-link-controller doc-source-link${config.className ? ` ${config.className}` : ''}`}>
			<LinkDocRender
				data={{
					ariaHasPopup: 'dialog',
					displayContent: <span className="doc-source-link-label">{label}</span>,
					titleText: title,
				}}
				config={{
					activationElement: 'button',
					className: 'doc-source-link-button',
					Icon: SourceLinkIcon,
					isBroken,
					isNavigationUnavailable: isUnavailable,
				}}
				onEvent={eventHandle}
			/>
			<LinkWarning text={warningText} onDismiss={() => setWarningText('')} />
			<CodeBlockCompactPopup Panel={Panel} sourceStore={sourceStore} store={store} />
		</span>
	);
});

function SourceLinkIcon(props) {
	return <LogOut {...props} className="doc-source-link-icon" />;
}

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
