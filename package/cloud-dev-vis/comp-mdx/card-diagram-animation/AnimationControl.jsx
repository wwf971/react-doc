import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Pause, Play, SkipBack, SkipForward } from '../../../../main/frontend/UICommon.js';
import { AnchoredPopover } from '../../../../main/comp-doc/popup/AnchoredPopover.jsx';
import { animationControlGraphBuild } from './AnimationData.js';

// The control area of an animation (card-diagram-animation.md#the-control-area):
// the states as a small graph, the transitions as lines between them. A chain is
// drawn as one row, state 1 --> state 2 --> state 3; any other shape as a state
// machine. The progress of what plays runs along the line it plays.
//
//   a click on a state         the viewport goes to that state at once
//   shift + click on a state   Play will go there, along the shortest way
//   a click on a line          plays that transition
//   hover or focus             the description of the state, as a tooltip

const PLAYBACK_RATE_LIST = [0.5, 1, 2];

const AnimationStateButton = observer(function AnimationStateButton({ store, state, style }) {
	const ref = useRef(null);
	const [isHint, isHintSet] = useState(false);
	const isCurrent = store.stateIdCurrent === state.id;
	const isTarget = store.stateIdTarget === state.id;
	// a row wider than the block scrolls: the state shown stays in it (only the row
	// moves, never the page), also the last one a block starts at
	useEffect(() => {
		const element = ref.current;
		const row = element?.closest('.doc-anim-states');
		if (!isCurrent || !row) return;
		const place = element.getBoundingClientRect();
		const box = row.getBoundingClientRect();
		if (place.right > box.right) row.scrollLeft += place.right - box.right;
		else if (place.left < box.left) row.scrollLeft -= box.left - place.left;
	}, [isCurrent]);
	return (
		<button
			ref={ref}
			type="button"
			className="doc-anim-state"
			style={style}
			data-current={isCurrent ? '' : undefined}
			data-target={isTarget ? '' : undefined}
			aria-pressed={isCurrent}
			aria-label={state.description ? `${state.name}: ${state.description}` : state.name}
			onClick={(event) => {
				if (event.shiftKey) store.stateTargetSet(state.id);
				else store.stateSet(state.id);
			}}
			onMouseEnter={() => isHintSet(true)}
			onMouseLeave={() => isHintSet(false)}
			onFocus={() => isHintSet(true)}
			onBlur={() => isHintSet(false)}
		>
			<span className="doc-anim-state-name">{state.name}</span>
			{isHint ? (
				<AnchoredPopover anchorRef={ref} className="doc-anim-tooltip">
					<strong>{state.name}</strong>
					{state.description ? <span>{state.description}</span> : null}
					<em>Click to show. Shift + click to play up to here.</em>
				</AnchoredPopover>
			) : null}
		</button>
	);
});

// the part played at 0%: all but nothing, growing to the whole line at 100%
const PROGRESS_LENGTH_MIN = 0.02;

// one transition as a line: the grey track, and over it the part already played,
// a dash as long as the progress in lengths of the line (pathLength). the dash is
// in the coordinates of the line, so this path has no non-scaling-stroke, which
// would measure it in pixels of the screen
const AnimationLinePath = observer(function AnimationLinePath({ store, transition, d, onPlay, isMarker = true }) {
	const progress = store.transitionProgressGet(transition.id);
	const titleName = transition.name || `${transition.from} → ${transition.to}`;
	return (
		<g className="doc-anim-line" data-active={progress !== null ? '' : undefined}>
			<title>{`Play: ${titleName}`}</title>
			<path d={d} className="doc-anim-line-track" markerEnd={isMarker ? 'url(#doc-anim-arrow)' : undefined} />
			{progress !== null ? <path d={d} className="doc-anim-line-progress" pathLength={1} strokeDasharray={`${Math.max(progress, PROGRESS_LENGTH_MIN)} 2`} /> : null}
			<path d={d} className="doc-anim-line-hit" onClick={onPlay} />
		</g>
	);
});

function AnimationArrowDefs() {
	return (
		<defs>
			<marker id="doc-anim-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
				<path d="M 0 0 L 6 3 L 0 6 z" className="doc-anim-line-arrow" />
			</marker>
		</defs>
	);
}

const AnimationStateChain = observer(function AnimationStateChain({ store }) {
	const { stateList, transitionList } = store.spec;
	return (
		<div className="doc-anim-chain">
			{stateList.map((state, index) => {
				const transition = transitionList[index];
				return (
					<div key={state.id} className="doc-anim-chain-item" data-last={index === stateList.length - 1 ? '' : undefined}>
						<AnimationStateButton store={store} state={state} />
						{index < stateList.length - 1 ? (
							<span className="doc-anim-chain-link">
								<svg className="doc-anim-chain-line" viewBox="0 0 60 12" preserveAspectRatio="none" aria-hidden="true">
									<AnimationLinePath store={store} transition={transition} d="M 0 6 L 60 6" isMarker={false} onPlay={() => store.playTransition(transition)} />
								</svg>
								{/* beside the line, not on it: the line stretches with the row, the head keeps its shape */}
								<svg className="doc-anim-chain-head" viewBox="0 0 6 6" aria-hidden="true" onClick={() => store.playTransition(transition)}>
									<path d="M 0 0 L 6 3 L 0 6 z" />
								</svg>
							</span>
						) : null}
					</div>
				);
			})}
		</div>
	);
});

const AnimationStateGraph = observer(function AnimationStateGraph({ store }) {
	const graph = animationControlGraphBuild(store.spec);
	return (
		<div className="doc-anim-graph" style={{ width: graph.width, height: graph.height }}>
			<svg className="doc-anim-graph-line" width={graph.width} height={graph.height} aria-hidden="true">
				<AnimationArrowDefs />
				{graph.lineList.map((line) => (
					<AnimationLinePath key={line.transition.id} store={store} transition={line.transition} d={line.d} onPlay={() => store.playTransition(line.transition)} />
				))}
			</svg>
			{store.spec.stateList.map((state) => {
				const place = graph.placeById[state.id];
				return <AnimationStateButton key={state.id} store={store} state={state} style={{ position: 'absolute', left: place.x, top: place.y, width: place.width, height: place.height }} />;
			})}
		</div>
	);
});

export const AnimationControl = observer(function AnimationControl({ store, playerRef }) {
	const stateTarget = store.spec.stateList.find((state) => state.id === store.stateIdTarget);
	const isActionable = store.isPlanActive || store.spec.stateList.length > 1;
	return (
		<div className="doc-anim-control">
			<div className="doc-anim-control-bar">
				<div className="doc-button-group doc-anim-control-group">
					<button type="button" title="The state before" aria-label="The state before" disabled={!store.statePrevious} onClick={() => store.stateSet(store.statePrevious)}><SkipBack size={13} /></button>
					<button type="button" title={store.isPlaying ? 'Pause' : `Play${stateTarget ? ` up to ${stateTarget.name}` : ''}`} aria-label={store.isPlaying ? 'Pause' : 'Play'} disabled={!isActionable} onClick={() => store.playToggle(playerRef.current)}>
						{store.isPlaying ? <Pause size={13} /> : <Play size={13} />}
					</button>
					<button type="button" title="Play to the next state" aria-label="Play to the next state" disabled={!store.stateNext || store.isPlanActive} onClick={() => store.playBetween(store.stateIdCurrent, store.stateNext)}><SkipForward size={13} /></button>
				</div>
				<div className="doc-anim-rate" role="group" aria-label="Speed">
					{PLAYBACK_RATE_LIST.map((rate) => (
						<button key={rate} type="button" aria-pressed={store.playbackRate === rate} onClick={() => store.playbackRateSet(rate)}>{rate}×</button>
					))}
				</div>
			</div>
			<div className="doc-anim-states">
				{store.isLinear ? <AnimationStateChain store={store} /> : <AnimationStateGraph store={store} />}
			</div>
		</div>
	);
});
