import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Player } from '@remotion/player';
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import { AnimationControl } from '../card-diagram-animation/AnimationControl.jsx';
import { SwitchAnimationStore } from './SwitchAnimationStore.js';
import { SwitchCanvas } from './SwitchCanvas.jsx';
import { SwitchPathBar } from './SwitchPathBar.jsx';
import '../card-diagram-animation/CardDiagramAnimation.css';
import './CardDiagramSwitch.css';

// The switching layer wrapped in the animation layer
// (card-diagram-flexible-switch.md#under-the-animation-layer): the control area of an
// animation over the path bar and the canvas of a switching viewport. A state names a
// scene; a transition plays the way between two scenes. remotion's Player is the clock:
// each segment of the plan writes its frame into the switching store, which draws it
// with the same frames as the clock of a plain block.
const SwitchAnimationSegment = observer(function SwitchAnimationSegment({ store, segment }) {
	const frame = useCurrentFrame();
	const way = useMemo(() => store.wayOf(segment), [store, segment]);
	useLayoutEffect(() => {
		void store.switchStore.seek(way, frame / Math.max(1, segment.frameCount - 1));
	}, [store, way, frame, segment]);
	return null;
});

const SwitchAnimationTimeline = observer(function SwitchAnimationTimeline({ store }) {
	return store.plan.segmentList.map((segment) => (
		<Sequence key={`${segment.transition.id}-${segment.frameStart}`} from={segment.frameStart} durationInFrames={segment.frameCount} layout="none">
			<SwitchAnimationSegment store={store} segment={segment} />
		</Sequence>
	));
});

const SwitchAnimationComposition = ({ store, config, registry }) => (
	<AbsoluteFill>
		<SwitchCanvas store={store.switchStore} config={config} registry={registry}>
			<SwitchAnimationTimeline store={store} />
		</SwitchCanvas>
	</AbsoluteFill>
);

export const SwitchAnimation = observer(function SwitchAnimation({ spec, switchStore, config, registry, height, isInPopup, rootRef, barTrailing }) {
	const [store] = useState(() => new SwitchAnimationStore({ spec, switchStore }));
	const boxRef = useRef(null);
	const playerRef = useRef(null);
	const [box, boxSet] = useState(null);
	const inputProps = useMemo(() => ({ store, config, registry }), [store, config, registry]);
	const { plan, playToken, playbackRate } = store;
	useEffect(() => { if (store.spec !== spec) store.specSet(spec); }, [store, spec]);
	useLayoutEffect(() => {
		const element = boxRef.current;
		if (!element) return undefined;
		const measure = () => {
			const width = element.clientWidth;
			const height2 = element.clientHeight;
			if (width > 0 && height2 > 0) boxSet((previous) => (previous?.width === width && previous?.height === height2 ? previous : { width, height: height2 }));
		};
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		return () => observer.disconnect();
	}, []);
	// the block starts at its state, once the canvas has a box
	const isShownFirst = useRef(false);
	useEffect(() => {
		if (!switchStore.isCameraReady || isShownFirst.current) return;
		isShownFirst.current = true;
		store.stateShow(store.stateIdCurrent);
	}, [store, switchStore.isCameraReady]);
	useEffect(() => {
		const player = playerRef.current;
		if (!player) return undefined;
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
	}, [store, box !== null]);
	useEffect(() => {
		if (playToken === 0 || !playerRef.current) return;
		playerRef.current.seekTo(0);
		playerRef.current.play();
	}, [playToken]);
	useEffect(() => {
		if (plan.segmentList.length === 0) {
			playerRef.current?.pause();
			playerRef.current?.seekTo(0);
		}
	}, [plan]);
	return (
		<figure ref={rootRef} className={`doc-switch doc-switch-${switchStore.scope.replace(/^\.doc-switch-/, '')}${isInPopup ? ' is-popup' : ''}`} style={{ '--doc-switch-height': `${height}px` }}>
			<AnimationControl store={store} playerRef={playerRef} />
			<SwitchPathBar store={switchStore} trailing={barTrailing} />
			<div ref={boxRef} className="doc-switch-player">
				{box ? (
					<Player
						ref={playerRef}
						component={SwitchAnimationComposition}
						inputProps={inputProps}
						durationInFrames={plan.frameTotal}
						fps={store.spec.fps}
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
		</figure>
	);
});
