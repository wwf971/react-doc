import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Copy, Download, ImageDown } from '../../../../main/frontend/UICommon.js';
import { BlockPopupSurface } from '../../../../main/comp-doc/popup/BlockPopupSurface.jsx';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { compDefinitionNormalize, compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import { yamlParse, yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';
import { DiagramCopyStore } from '../card-diagram/DiagramERStore.js';
import { cardDiagramNodeRegistry } from '../card-diagram/card-diagram-node-registry.js';
import { animationCapture, animationCaptureCopy, animationCaptureDownload } from '../card-diagram-animation/AnimationCapture.js';
import { SwitchStore } from './SwitchStore.js';
import { SwitchCanvas } from './SwitchCanvas.jsx';
import { SwitchPathBar } from './SwitchPathBar.jsx';
import { switchRegistryBuild } from './SwitchNodeKinds.jsx';
import { switchDocNormalize, switchPathNormalize, switchPathViewRead, switchProviderFromDoc } from './SwitchData.js';
import '../card-diagram-animation/CardDiagramAnimation.css';
import './CardDiagramSwitch.css';

// the names a resolver of registered components answers with, for a diagram of a block
export function useSwitchResolve() {
	const { compById, sourceStore } = useDocStores();
	return useMemo(() => (name, placement) => {
		const definition = compDefinitionNormalize(compById[compIdResolve(sourceStore.configDoc, name)]);
		return definition?.placementList?.includes(placement) ? definition.expose?.[placement] : undefined;
	}, [compById, sourceStore]);
}

// the store of a switching viewport, given its scenes: one per block, its scenes
// replaced when the provider changes
export function useSwitchStore({ provider, registry, pathInitial, scope }) {
	const resolve = useSwitchResolve();
	const [store] = useState(() => new SwitchStore({ provider, registry, resolve, pathInitial, scope }));
	useEffect(() => {
		if (store.provider !== provider) store.providerSet(provider);
	}, [store, provider]);
	return store;
}

function switchScrollFreeze(element) {
	const restoreList = [...element.querySelectorAll('.doc-switch-stack-scroll')].map((scroll) => {
		const top = scroll.scrollTop;
		const list = scroll.firstElementChild;
		list.style.transform = `translateY(${-top}px)`;
		scroll.style.overflow = 'hidden';
		scroll.scrollTop = 0;
		return () => {
			list.style.transform = '';
			scroll.style.overflow = '';
			scroll.scrollTop = top;
		};
	});
	return () => restoreList.forEach((restore) => restore());
}

// the toolbar's picture button of a switching viewport: the scene as it stands now
export function switchCaptureActionBuild({ store, rootRef, titleGet }) {
	const nameGet = (format) => `${(titleGet() || 'scene').replace(/[\\/:*?"<>|\s]+/g, '-')}-${store.pathCurrent.replace(/\//g, '_').replace(/^_/, '')}.${format}`;
	const run = (format, isDownload) => {
		const element = rootRef.current?.querySelector('.react-flow');
		if (!element) return;
		const formatLabel = format.toUpperCase();
		store.captureHintSet('working', 'Making the picture…');
		// a picture is made of a copy of the html, which has no scroll position: while
		// it is made, a scrolled area holds its place by a transform
		const scrollRestore = switchScrollFreeze(element);
		const blobPromise = animationCapture(element, format).finally(scrollRestore);
		const donePromise = isDownload
			? blobPromise.then((blob) => {
				animationCaptureDownload(blob, nameGet(format));
				return `Download started: ${nameGet(format)}`;
			})
			: animationCaptureCopy(blobPromise, format).then(() => `Copied as ${formatLabel}`);
		donePromise.then(
			(text) => store.captureHintSet('done', text),
			(error) => store.captureHintSet('failed', `Could not ${isDownload ? 'download' : 'copy'} the ${formatLabel}: ${String(error?.message ?? error)}`),
		);
	};
	return {
		id: 'capture',
		label: 'Copy or download the scene as a picture',
		Icon: ImageDown,
		menuItemList: [
			{ id: 'copy-png', label: 'Copy as PNG', Icon: Copy, onClick: () => run('png', false) },
			{ id: 'copy-svg', label: 'Copy as SVG', Icon: Copy, onClick: () => run('svg', false) },
			{ id: 'download-png', label: 'Download PNG', Icon: Download, onClick: () => run('png', true) },
			{ id: 'download-svg', label: 'Download SVG', Icon: Download, onClick: () => run('svg', true) },
		],
	};
}

// A viewport of many scenes (card-diagram-flexible-switch.md): the path bar over one
// canvas. Whoever has scenes makes one of these with a provider: a document
// (CardDiagramSwitch below), or a component generating its scenes from data.
//
//   [path bar]        overview > tables > account           ←  fit  box
//   [react-flow viewport]
export const SwitchViewport = observer(function SwitchViewport({ store, config, registry, height, isInPopup, rootRef, barTrailing }) {
	return (
		<figure ref={rootRef} className={`doc-switch doc-switch-${store.scope.replace(/^\.doc-switch-/, '')}${isInPopup ? ' is-popup' : ''}${store.isBoxAdjust ? ' is-box-adjust' : ''}`} style={{ '--doc-switch-height': `${height}px` }}>
			<SwitchPathBar store={store} trailing={barTrailing} />
			{store.message ? <p className="doc-switch-message" role="status">{store.message}</p> : null}
			<SwitchCanvas store={store} config={config} registry={registry} />
		</figure>
	);
});

const CardDiagramSwitchBase = observer(function CardDiagramSwitchBase({ data = {}, config = {}, onEvent, registry }) {
	const source = data.source || data.raw || '';
	const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '');
	const rootRef = useRef(null);
	const [copyStore] = useState(() => new DiagramCopyStore());
	// a box adjusted by the reader rewrites the block, where it can be written
	const sourceRef = useRef(source);
	sourceRef.current = source;
	const load = useMemo(() => {
		try {
			const spec = switchDocNormalize(source);
			return { spec, provider: switchProviderFromDoc(spec, { onBoxSave: (path, rect) => switchDocBoxSave(sourceRef.current, path, rect, onEvent, config) }) };
		} catch (error) {
			return { message: String(error?.message ?? error) };
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [source]);
	const title = data.title || load.spec?.title || 'Scenes';
	return (
		<BlockPopupSurface config={config} title={title} className="doc-switch-shell not-prose">
			{({ isInPopup }) => (load.message ? (
				<div className="doc-er-diagram-message is-error" role="alert">
					<strong>The scenes could not be read.</strong>
					<span>{load.message}</span>
				</div>
			) : (
				<CardDiagramSwitchBody load={load} data={data} config={config} registry={registry} scope={`.doc-switch-${instanceId}`} isInPopup={isInPopup} rootRef={rootRef} title={title} copyStore={copyStore} source={source} onEvent={onEvent} />
			))}
		</BlockPopupSurface>
	);
});

const CardDiagramSwitchBody = observer(function CardDiagramSwitchBody({ load, data, config, registry, scope, isInPopup, rootRef, title, copyStore, source, onEvent }) {
	const store = useSwitchStore({ provider: load.provider, registry, pathInitial: data.path ?? load.spec.root, scope });
	const capture = switchCaptureActionBuild({ store, rootRef, titleGet: () => title });
	const heightWritten = Number(data.height ?? config.height ?? load.spec.height);
	const height = Number.isFinite(heightWritten) ? Math.max(240, Math.min(1400, heightWritten)) : 620;
	return (
		<SwitchViewport
			store={store} config={config} registry={registry} height={height} isInPopup={isInPopup} rootRef={rootRef}
			barTrailing={<>
				<SwitchBarMenu action={capture} />
				<button type="button" className="doc-switch-bar-button" title={copyStore.label} aria-label={copyStore.label} onClick={() => copyStore.copy(source, onEvent)}><Copy size={13} aria-hidden="true" /></button>
			</>}
		/>
	);
});

// the picture menu, in the bar of the viewport so it stands beside what it pictures
export const SwitchBarMenu = observer(function SwitchBarMenu({ action }) {
	const [isOpen, isOpenSet] = useState(false);
	const { Icon } = action;
	return (
		<span className="doc-switch-bar-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) isOpenSet(false); }}>
			<button type="button" className="doc-switch-bar-button" title={action.label} aria-label={action.label} aria-expanded={isOpen} onClick={() => isOpenSet(!isOpen)}><Icon size={13} aria-hidden="true" /></button>
			{isOpen ? (
				<span className="doc-switch-bar-menu-list" role="menu">
					{action.menuItemList.map((item) => {
						const ItemIcon = item.Icon;
						return <button key={item.id} type="button" role="menuitem" onClick={() => { isOpenSet(false); item.onClick(); }}><ItemIcon size={13} aria-hidden="true" /><span>{item.label}</span></button>;
					})}
				</span>
			) : null}
		</span>
	);
});

// the document written again with the box of one scene. inline data is rewritten by
// the page, in reading mode too; an asset-backed block is left as it is, and says so
async function switchDocBoxSave(source, path, rect, onEvent, config) {
	if (config.assetInfo?.isFromAsset) return { code: -1, message: 'The data of this block is an asset: the bounding box holds while the page is open.' };
	const doc = yamlParse(source);
	const { path: scenePath, view } = switchPathViewRead(path);
	const scene = doc.sceneList.find((item) => switchPathNormalize(item.path) === scenePath);
	const holder = view ? scene?.viewList?.find((item) => item.id === view) : scene;
	if (!holder) return { code: 0 };
	const boxNode = holder.diagram?.nodes?.find((node) => node.renderer?.type === 'scene-box');
	if (boxNode) {
		boxNode.position = { x: rect.x, y: rect.y };
		boxNode.size = { width: rect.width, height: rect.height };
	} else {
		holder.box = rect;
	}
	return (await onEvent?.('dataReplaceRequest', { raw: yamlStringify(doc) })) ?? { code: -1, message: 'This block cannot be written.' };
}

// the switching component of a node registry
export function cardDiagramSwitchCompCreate(registry, name) {
	const registrySwitch = switchRegistryBuild(registry);
	const CompRender = (props) => <CardDiagramSwitchBase {...props} registry={registrySwitch} />;
	CompRender.displayName = name;
	return CompRender;
}

export const CardDiagramSwitch = cardDiagramSwitchCompCreate(cardDiagramNodeRegistry, 'CardDiagramSwitch');
