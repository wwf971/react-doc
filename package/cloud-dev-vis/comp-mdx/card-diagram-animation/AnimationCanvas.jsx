import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Player } from '@remotion/player';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import {
	Background, Controls, ReactFlow, ReactFlowProvider, ViewportPortal, getViewportForBounds, useNodesInitialized, useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Check, CircleAlert, LoaderCircle } from '../../../../main/frontend/UICommon.js';
import { DiagramEdge, DiagramNode, DiagramPointNode, DiagramRenderContext } from '../card-diagram/DiagramRender.jsx';
import { useCanvasWheelGuard } from '../card-diagram/CanvasWheelGuard.js';
import '../card-diagram/DiagramER.css';
import { animationPositionOffsetGet, animationProgressGet, animationSceneAtFrame, animationSceneStyleBuild, animationViewBetween } from './AnimationData.js';

// The viewport of an animation (card-diagram-animation.md): remotion's Player
// holds the clock and the timeline, a React Flow canvas of the card diagram
// framework is its composition. A segment of the plan is a <Sequence>, so its
// frame counts from its own start; it writes what its frame looks like as a
// stylesheet (reaching the cards however they are drawn), moves the camera and
// the nodes, and draws its tokens, each a <Sequence> of its own. Nothing renders
// a card again per frame: the React Flow element above them never reads a frame.
//
// the composition has the size of the box, so remotion scales nothing and React
// Flow measures true pixels.

const nodeTypes = { visualizationNode: DiagramNode, visualizationPoint: DiagramPointNode };
const edgeTypes = { visualizationEdge: DiagramEdge };
const nodeMouseEnterNoop = () => {};
const FIT_PADDING = 0.1;
const FIT_ZOOM_MAX = 1.15;

// where each state's camera is, resolved once per box and per layout
function viewOfStateGet(store, stateId, rf) {
	const cached = store.viewById.get(stateId);
	if (cached) return cached;
	const { box, canvasStore } = store;
	const scene = store.sceneById.get(stateId);
	const viewport = canvasStore.viewport;
	const zoomRange = [viewport.zoom.min, viewport.zoom.max];
	const view = scene.view;
	let result;
	if (view && typeof view === 'object' && view.zoom !== undefined) {
		result = { x: Number(view.x ?? 0), y: Number(view.y ?? 0), zoom: Number(view.zoom) };
	} else {
		const offsetById = animationPositionOffsetGet(scene);
		const nodeIdAllList = canvasStore.graph.nodes.map((node) => node.id);
		let nodeIdList = nodeIdAllList;
		if (view === 'visible') nodeIdList = nodeIdAllList.filter((id) => Number(scene.propByKey[`node/${id}`]?.opacity ?? 1) > 0);
		if (view && typeof view === 'object' && view.fit) nodeIdList = Array.isArray(view.fit) ? view.fit : [view.fit];
		const padding = view && typeof view === 'object' && view.padding !== undefined ? Number(view.padding) : FIT_PADDING;
		const nodeList = rf.getNodes().filter((node) => nodeIdList.includes(node.id)).map((node) => {
			const base = canvasStore.nodeList.find((item) => item.id === node.id)?.position ?? node.position;
			const offset = offsetById[node.id];
			return { ...node, position: offset ? { x: base.x + offset.x, y: base.y + offset.y } : base };
		});
		if (nodeList.length === 0 || nodeList.some((node) => !node.measured?.width)) return null;
		// a fit never enlarges past maxZoom (FIT_ZOOM_MAX unless said): a few cards stay compact
		const zoomMax = Math.min(zoomRange[1], view && typeof view === 'object' && view.maxZoom !== undefined ? Number(view.maxZoom) : FIT_ZOOM_MAX);
		result = getViewportForBounds(rf.getNodesBounds(nodeList), box.width, box.height, zoomRange[0], zoomMax, padding);
	}
	store.viewById.set(stateId, result);
	return result;
}

// the path of a connection, drawn: its length, and a point along it
function edgePathGet(root, connectionId) {
	return root?.querySelector(`.react-flow__edge[data-id=${JSON.stringify(connectionId)}] .react-flow__edge-path`) ?? null;
}

const AnimationStyle = ({ text }) => <style className="doc-anim-style">{text}</style>;

// what one frame of a transition looks like
const AnimationSegment = observer(function AnimationSegment({ store, segment, scope, rootRef }) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const rf = useReactFlow();
	const { transition, compiled } = segment;
	const sceneFrom = store.sceneById.get(transition.from);
	const sceneTo = store.sceneById.get(transition.to);
	const scene = useMemo(() => animationSceneAtFrame(sceneFrom, sceneTo, compiled, frame, fps), [sceneFrom, sceneTo, compiled, frame, fps]);
	useLayoutEffect(() => {
		store.offsetByIdSet(animationPositionOffsetGet(scene));
		const viewFrom = viewOfStateGet(store, transition.from, rf);
		const viewTo = viewOfStateGet(store, transition.to, rf);
		if (!viewFrom || !viewTo) return;
		const timing = compiled.timingByKey.camera ?? { frameStart: 0, frameEnd: compiled.frameCount - 1, ease: 'easeInOut' };
		void rf.setViewport(animationViewBetween(viewFrom, viewTo, animationProgressGet(frame, timing, fps), store.box));
	}, [frame, scene, store, transition, compiled, fps, rf]);
	const styleText = animationSceneStyleBuild(scene, scope, store.targetSet, (id) => edgePathGet(rootRef.current, id)?.getTotalLength() ?? 0);
	const captionFrom = sceneFrom.caption;
	const captionTo = sceneTo.caption;
	const progressCaption = frame / Math.max(1, compiled.frameCount - 1);
	return <>
		<AnimationStyle text={styleText} />
		{compiled.tokenList.map((token) => (
			<Sequence key={token.id} from={token.frameStart} durationInFrames={token.frameCount} layout="none">
				<AnimationToken token={token} rootRef={rootRef} />
			</Sequence>
		))}
		{captionFrom === captionTo
			? <AnimationCaption text={captionTo} opacity={1} />
			: <AnimationCaption text={progressCaption < 0.5 ? captionFrom : captionTo} opacity={Math.abs(progressCaption - 0.5) * 2} />}
	</>;
});

// a mark moving along a connection, placed by its frame on the path as drawn
function AnimationToken({ token, rootRef }) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const path = edgePathGet(rootRef.current, token.connectionId);
	if (!path) return null;
	const progress = animationProgressGet(frame, { frameStart: 0, frameEnd: token.frameCount - 1, ease: token.ease }, fps);
	const point = path.getPointAtLength(path.getTotalLength() * progress);
	const fade = Math.min(1, frame / 3, (token.frameCount - 1 - frame) / 3);
	const size = token.size * 2;
	return (
		<ViewportPortal>
			<div className="doc-anim-token" style={{ transform: `translate(${point.x - size / 2}px, ${point.y - size / 2}px)`, width: size, height: size, background: token.color, opacity: fade }}>
				{token.label ? <span className="doc-anim-token-label" style={{ color: token.color }}>{token.label}</span> : null}
			</div>
		</ViewportPortal>
	);
}

function AnimationCaption({ text, opacity }) {
	if (!text) return null;
	return <div className="doc-anim-caption" style={{ opacity }}>{text}</div>;
}

// what the viewport shows resting on a state: its scene, its camera when asked
const AnimationRest = observer(function AnimationRest({ store, scope, rootRef }) {
	const rf = useReactFlow();
	const isInitialized = useNodesInitialized();
	const { stateIdCurrent, cameraToken } = store;
	const scene = store.sceneById.get(stateIdCurrent);
	const [, lengthReadySet] = useState(0);
	useLayoutEffect(() => {
		if (!isInitialized) return undefined;
		// a frame later: React Flow has the sizes of the nodes in its store
		const frameId = requestAnimationFrame(() => {
			const view = viewOfStateGet(store, stateIdCurrent, rf);
			if (view) void rf.setViewport(view);
			lengthReadySet((value) => value + 1);
		});
		return () => cancelAnimationFrame(frameId);
	}, [isInitialized, stateIdCurrent, cameraToken, store, rf]);
	if (!scene) return null;
	return <>
		<AnimationStyle text={animationSceneStyleBuild(scene, scope, store.targetSet, (id) => edgePathGet(rootRef.current, id)?.getTotalLength() ?? 0)} />
		<AnimationCaption text={scene.caption} opacity={1} />
	</>;
});

const AnimationFlow = observer(function AnimationFlow({ store, scope }) {
	const rootRef = useRef(null);
	const { plan, isPlaying, canvasStore } = store;
	return (
		<ReactFlow
			ref={rootRef}
			className="doc-er-diagram-flow doc-anim-flow"
			nodes={store.nodeListFlow}
			edges={canvasStore.edgeList}
			nodeTypes={nodeTypes}
			edgeTypes={edgeTypes}
			defaultViewport={{ x: 0, y: 0, zoom: 1 }}
			minZoom={canvasStore.viewport.zoom.min}
			maxZoom={canvasStore.viewport.zoom.max}
			proOptions={{ hideAttribution: true }}
			nodesDraggable={false}
			nodesConnectable={false}
			nodesFocusable={false}
			edgesFocusable={false}
			edgesReconnectable={false}
			elementsSelectable={false}
			panOnDrag={!isPlaying}
			zoomOnScroll={!isPlaying}
			zoomOnPinch={!isPlaying}
			zoomOnDoubleClick={false}
			deleteKeyCode={null}
			selectionKeyCode={null}
			multiSelectionKeyCode={null}
			onNodesChange={canvasStore.nodeListChange}
			onNodeMouseEnter={nodeMouseEnterNoop}
		>
			<Background gap={18} size={1} />
			<Controls showInteractive={false} />
			{plan.segmentList.map((segment) => (
				<Sequence key={`${segment.transition.id}-${segment.frameStart}`} from={segment.frameStart} durationInFrames={segment.frameCount} layout="none">
					<AnimationSegment store={store} segment={segment} scope={scope} rootRef={rootRef} />
				</Sequence>
			))}
			{store.isPlanActive ? null : <AnimationRest store={store} scope={scope} rootRef={rootRef} />}
		</ReactFlow>
	);
});

// the composition: everything remotion plays
const AnimationComposition = ({ store, scope, context }) => (
	<AbsoluteFill>
		<ReactFlowProvider>
			<DiagramRenderContext.Provider value={context}>
				<AnimationFlow store={store} scope={scope} />
			</DiagramRenderContext.Provider>
		</ReactFlowProvider>
	</AbsoluteFill>
);

// what a picture of the viewport came to: over the viewport, out of the flow, so
// nothing moves, and outside the canvas, so it is not in the picture
const AnimationCaptureHint = observer(function AnimationCaptureHint({ store }) {
	const hint = store.captureHint;
	if (!hint) return null;
	const Icon = { working: LoaderCircle, done: Check, failed: CircleAlert }[hint.status];
	return (
		<div className="doc-anim-capture-hint" data-status={hint.status} role={hint.status === 'failed' ? 'alert' : 'status'}>
			<Icon size={13} aria-hidden="true" />
			<span>{hint.text}</span>
		</div>
	);
});

export const AnimationCanvas = observer(function AnimationCanvas({ store, config, registry, playerRefOut, scope }) {
	const boxRef = useRef(null);
	const playerRef = useRef(null);
	useCanvasWheelGuard(boxRef);
	const { box, plan, spec, playToken, playbackRate } = store;
	const context = useMemo(() => ({ config, registry, measurementSet: store.canvasStore.measurementSet, edgeGeometry: new Map() }), [config, registry, store]);
	const inputProps = useMemo(() => ({ store, scope, context }), [store, scope, context]);

	useLayoutEffect(() => {
		const element = boxRef.current;
		if (!element) return undefined;
		const measure = () => {
			const width = element.clientWidth;
			const height = element.clientHeight;
			if (width > 0 && height > 0) store.boxSet({ width, height });
		};
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		return () => observer.disconnect();
	}, [store]);

	useEffect(() => {
		const player = playerRef.current;
		if (!player) return undefined;
		playerRefOut.current = player;
		const onFrame = (event) => store.frameSet(event.detail.frame);
		const onPlay = () => store.isPlayingSet(true);
		const onPause = () => store.isPlayingSet(false);
		const onEnded = () => store.planFinish();
		player.addEventListener('frameupdate', onFrame);
		player.addEventListener('seeked', onFrame);
		player.addEventListener('play', onPlay);
		player.addEventListener('pause', onPause);
		player.addEventListener('ended', onEnded);
		return () => {
			player.removeEventListener('frameupdate', onFrame);
			player.removeEventListener('seeked', onFrame);
			player.removeEventListener('play', onPlay);
			player.removeEventListener('pause', onPause);
			player.removeEventListener('ended', onEnded);
		};
	}, [store, box !== null, playerRefOut]);

	// a new plan: from its start. the Player has its new length when this runs
	useEffect(() => {
		if (playToken === 0 || !playerRef.current) return;
		playerRef.current.seekTo(0);
		playerRef.current.play();
	}, [playToken]);
	// a plan dropped (a click on a state): the Player stops on its one frame
	useEffect(() => {
		if (plan.segmentList.length === 0) {
			playerRef.current?.pause();
			playerRef.current?.seekTo(0);
		}
	}, [plan]);

	return (
		<div ref={boxRef} className="doc-anim-viewport">
			<AnimationCaptureHint store={store} />
			{box && spec ? (
				<Player
					ref={playerRef}
					component={AnimationComposition}
					inputProps={inputProps}
					durationInFrames={plan.frameTotal}
					fps={spec.fps}
					compositionWidth={box.width}
					compositionHeight={box.height}
					playbackRate={playbackRate}
					style={{ width: box.width, height: box.height }}
					controls={false}
					clickToPlay={false}
					doubleClickToFullscreen={false}
					spaceKeyToPlayOrPause={false}
					moveToBeginningWhenEnded={false}
					numberOfSharedAudioTags={0}
					acknowledgeRemotionLicense
				/>
			) : null}
		</div>
	);
});
