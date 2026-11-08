import { useEffect, useId, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Copy, Download, ImageDown } from '../../../../main/frontend/UICommon.js';
import { BlockPopupSurface } from '../../../../main/comp-doc/popup/BlockPopupSurface.jsx';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { useCompStateStore } from '../../../../main/comp-doc/registry/use-comp-state.js';
import { compDefinitionNormalize, compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import { DiagramCopyStore } from '../card-diagram/DiagramERStore.js';
import { cardDiagramNodeRegistry } from '../card-diagram/card-diagram-node-registry.js';
import { AnimationStore } from './AnimationStore.js';
import { AnimationCanvas } from './AnimationCanvas.jsx';
import { AnimationControl } from './AnimationControl.jsx';
import { animationCapture, animationCaptureCopy, animationCaptureDownload } from './AnimationCapture.js';
import './CardDiagramAnimation.css';

// A card diagram that moves (card-diagram-animation.md): the wrapper of the
// framework, a block of the page:
//
//   [control area]         the states, the lines between them, Play
//   [react-flow viewport]  the diagram at a state, or between two
//
// made for a node registry with cardDiagramAnimationCompCreate, as a diagram is
// with cardDiagramCompCreate, so a series animates its own cards. It writes
// nothing: its only edit mode is the source of the block. The pictures of the
// viewport are actions of the block's toolbar, as every block's actions are.
const CardDiagramAnimationBase = observer(function CardDiagramAnimationBase({ data = {}, config = {}, onEvent, registry }) {
	const source = data.source || data.raw || '';
	const { compById, sourceStore } = useDocStores();
	const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '');
	const scope = `.doc-anim-${instanceId}`;
	const playerRef = useRef(null);
	const rootRef = useRef(null);
	const [copyStore] = useState(() => new DiagramCopyStore());
	// the block's, not the mount's (useCompStateStore): mounted again (the document entering
	// or leaving edit mode), the block is at the state the reader left it at
	const store = useCompStateStore(config, 'animation', () => new AnimationStore(source, (name, placement) => {
		const definition = compDefinitionNormalize(compById[compIdResolve(sourceStore.configDoc, name)]);
		if (!definition?.placementList?.includes(placement)) return undefined;
		return definition.expose?.[placement];
	}, 480, registry));
	useEffect(() => {
		if (store.source !== source) store.sourceLoad(source);
	}, [source, store]);

	const stateCurrent = store.spec?.stateList.find((state) => state.id === store.stateIdCurrent);
	const captureNameGet = (format) => `${(data.title || store.spec?.title || 'animation').replace(/[\\/:*?"<>|\s]+/g, '-')}-${stateCurrent?.id ?? 'state'}.${format}`;
	// called in the click: the clipboard is written before anything is awaited
	const captureRun = (format, isDownload) => {
		const element = rootRef.current?.querySelector('.react-flow');
		if (!element) return;
		const formatLabel = format.toUpperCase();
		store.captureHintSet('working', 'Making the picture…');
		const blobPromise = animationCapture(element, format);
		const donePromise = isDownload
			? blobPromise.then((blob) => {
				animationCaptureDownload(blob, captureNameGet(format));
				return `Download started: ${captureNameGet(format)}`;
			})
			: animationCaptureCopy(blobPromise, format).then(() => `Copied as ${formatLabel}`);
		donePromise.then(
			(text) => store.captureHintSet('done', text),
			(error) => store.captureHintSet('failed', `Could not ${isDownload ? 'download' : 'copy'} the ${formatLabel}: ${String(error?.message ?? error)}`),
		);
	};
	const actionList = [
		{
			id: 'capture',
			label: 'Copy or download the viewport as a picture',
			Icon: ImageDown,
			menuItemList: [
				{ id: 'copy-png', label: 'Copy as PNG', Icon: Copy, onClick: () => captureRun('png', false) },
				{ id: 'copy-svg', label: 'Copy as SVG', Icon: Copy, onClick: () => captureRun('svg', false) },
				{ id: 'download-png', label: 'Download PNG', Icon: Download, onClick: () => captureRun('png', true) },
				{ id: 'download-svg', label: 'Download SVG', Icon: Download, onClick: () => captureRun('svg', true) },
			],
		},
		{ id: 'copy', label: copyStore.label, Icon: Copy, onClick: () => copyStore.copy(source, onEvent) },
	];
	const heightWritten = Number(data.height ?? config.height);
	const height = Number.isFinite(heightWritten) ? Math.max(200, Math.min(1200, heightWritten)) : store.spec?.diagram.viewport?.size?.height ?? 480;
	return (
		<BlockPopupSurface config={config} title={data.title || store.spec?.title || 'Animation'} className="doc-anim-shell not-prose" actionList={actionList}>
			{({ isInPopup }) => (
				store.loadState.status === 'error' ? (
					<div className="doc-er-diagram-message is-error" role="alert">
						<strong>The animation could not be read.</strong>
						<span>{store.loadState.message}</span>
					</div>
				) : store.spec ? (
					<figure ref={rootRef} className={`doc-anim doc-anim-${instanceId}${isInPopup ? ' is-popup' : ''}`} aria-label={data.title || store.spec.title || 'Animation'} style={{ '--doc-anim-height': `${height}px` }}>
						<AnimationControl store={store} playerRef={playerRef} />
						<AnimationCanvas store={store} config={config} registry={registry} playerRefOut={playerRef} scope={scope} />
					</figure>
				) : null
			)}
		</BlockPopupSurface>
	);
});

// the animation component of a node registry
export function cardDiagramAnimationCompCreate(registry, name) {
	const CompRender = (props) => <CardDiagramAnimationBase {...props} registry={registry} />;
	CompRender.displayName = name;
	return CompRender;
}

// the animation of the base series: generic tables, compact cards, operators
export const CardDiagramAnimation = cardDiagramAnimationCompCreate(cardDiagramNodeRegistry, 'CardDiagramAnimation');
