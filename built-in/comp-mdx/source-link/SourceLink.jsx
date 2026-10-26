import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LogOut } from '../../../main/frontend/UICommon.js';
import { linkTagsPositionGet } from '../../../main/comp-doc/link/DocLink.jsx';
import { LinkDocRender } from '../../../main/comp-doc/link/LinkDocRender.jsx';
import { LinkWarning } from '../../../main/comp-doc/link/LinkWarning.jsx';
import { useDocStores } from '../../../main/frontend/src/store/context.js';
import { CodeBlockCompactPopup } from '../block/code-block/CodeBlockCompactPopup.jsx';
import { CodeBlockCompactStore } from '../block/code-block/CodeBlockCompactStore.js';
import { SourceLinkRenderPopup } from './SourceLinkRenderPopup.jsx';
import './SourceLink.css';

// data.tagsDisplay   optional: before | after | on | off, as for DocLink. without
//                    it, the document containing the link decides
//                    (TagsDisplayAtLink... config).
// config.configDocOverride   optional document-level config values replacing
//                    those of the containing document, as for DocLink.
const SourceLink = observer(function SourceLink({ data = {}, config = {}, onEvent }) {
	const { configStore, docStore, sourceStore, tagStore } = useDocStores();
	const [store] = useState(() => new CodeBlockCompactStore());
	const [warningText, setWarningText] = useState('');
	const refWrap = useRef(null);
	const target = targetGet(data);
	const label = String(data.label ?? data.title ?? target);
	// every value other than 'render' means source mode, keeping existing
	// Index inline-link and block usages (no displayMode) compatible.
	const displayMode = data.displayMode === 'render' ? 'render' : 'source';
	const sourceEntry = target ? sourceStore.entryByInternalPath.get(target) : undefined;
	const sourceState = target
		? (displayMode === 'render' ? sourceStore.compiledByPath[target] : sourceStore.rawByPath[target])
		: undefined;
	const isReady = sourceState?.status === 'done';
	const Panel = config.panelComponent;
	const isBroken = !target || !sourceEntry;
	const isUnavailable = Boolean(sourceEntry)
		&& (!Panel || sourceState?.status === 'error');
	const tagsPosition = linkTagsPositionGet({
		configLinkDoc: {
			...configStore.configDocGet(config.sourcePath || docStore.docCurrentPath),
			...config.configDocOverride,
		},
		tagsDisplay: data.tagsDisplay ?? '',
	});
	const tagList = tagsPosition && !isBroken
		? tagStore.tagDisplayListGet(tagStore.tagService.assetKeyGet('doc', target))
		: [];

	useEffect(() => {
		if (!target) return;
		if (displayMode === 'render') void sourceStore.loadDoc(target);
		else void sourceStore.loadRaw(target);
	}, [displayMode, sourceStore, target]);

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
				: isReady
					? (displayMode === 'render' ? `ドキュメントを表示: ${target}` : `ソースを表示: ${target}`)
					: displayMode === 'render' ? 'ドキュメントを読み込んでいます…' : 'ソースを読み込んでいます…';
	const eventHandle = async (eventType, eventData = {}) => {
		if (eventType !== 'activateRequest') return;
		eventData.event?.preventDefault();
		const result = await onEvent?.('openRequest', { ...eventData, target });
		if (result?.code === 0) return;
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
					tagList,
					titleText: title,
				}}
				config={{
					activationElement: 'button',
					className: 'doc-source-link-button',
					Icon: SourceLinkIcon,
					instanceId: `source-link:${config.instanceId ?? 'page'}:${target}`,
					isBroken,
					isNavigationUnavailable: isUnavailable,
					tagsPosition,
				}}
				onEvent={eventHandle}
			/>
			<LinkWarning text={warningText} onDismiss={() => setWarningText('')} />
			{displayMode === 'render'
				? <SourceLinkRenderPopup Panel={Panel} store={store} />
				: <CodeBlockCompactPopup Panel={Panel} sourceStore={sourceStore} store={store} />}
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
