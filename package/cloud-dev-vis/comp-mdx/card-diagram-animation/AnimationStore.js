import { makeAutoObservable, observable, runInAction } from 'mobx';
import { yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';
import { DiagramERStore } from '../card-diagram/DiagramERStore.js';
import { cardRowListGet } from '../card-diagram/TableCardSchema.js';
import {
	animationIsLinear, animationNormalize, animationPathFind, animationPlanBuild, animationPositionOffsetGet, animationSceneListBuild,
	animationTargetSetBuild, animationTransitionCompile,
} from './AnimationData.js';

// The state of one animation block (card-diagram-animation.md): the document
// normalized, the canvas store of its diagram, the state the viewport shows, and
// the plan being played: the transitions between two states, as segments of the
// one timeline remotion's Player runs. The block reads and writes nothing else:
// playing never changes the document.
//
//   stateIdCurrent   the state shown, or the state a playing segment left from
//   stateIdTarget    where Play goes ('' the next state); picked with a shift-click
//   plan             the segments of the timeline; none while resting on a state
//   frame            the frame of the timeline, as the Player reports it
//   isPlaying        the Player runs
//   playToken        a new plan to start: the canvas seeks and plays when it changes
//   cameraToken      the view of the state is to be applied again
export class AnimationStore {
	source = '';
	spec = null;
	loadState = { status: 'idle', message: '' };
	stateIdCurrent = '';
	stateIdTarget = '';
	plan = { segmentList: [], frameTotal: 1 };
	frame = 0;
	isPlaying = false;
	playToken = 0;
	cameraToken = 0;
	playbackRate = 1;
	box = null;
	offsetById = {};
	// what a picture of the viewport came to: { status: 'working' | 'done' | 'failed', text }
	captureHint = null;
	captureHintTimer = 0;

	constructor(source, rendererResolve, height, registry) {
		this.rendererResolve = rendererResolve;
		this.height = height;
		this.registry = registry;
		this.canvasStore = new DiagramERStore('', rendererResolve, height, registry);
		this.targetSet = { keyList: [], connectionEndByKey: {} };
		this.sceneById = new Map();
		this.compiledById = new Map();
		this.viewById = new Map();
		makeAutoObservable(this, {
			captureHintTimer: false, rendererResolve: false, height: false, registry: false, canvasStore: false, targetSet: false, sceneById: false, compiledById: false, viewById: false,
			spec: observable.ref, plan: observable.ref, box: observable.ref, offsetById: observable.ref,
		}, { autoBind: true });
		this.sourceLoad(source);
	}

	sourceLoad(source) {
		this.source = String(source ?? '');
		try {
			if (!this.source.trim()) throw new Error('The animation data is empty.');
			const spec = animationNormalize(this.source);
			this.canvasStore.sourceLoad(yamlStringify({ version: 1, ...spec.diagram }));
			if (this.canvasStore.loadState.status !== 'done') throw new Error(this.canvasStore.loadState.message);
			this.targetSet = animationTargetSetBuild(this.canvasStore.graph, (node) => cardRowListGet(node, this.registry));
			this.sceneById = animationSceneListBuild(spec, this.targetSet);
			this.compiledById = new Map(spec.transitionList.map((transition) => [transition.id, animationTransitionCompile(spec, transition, this.targetSet)]));
			this.viewById = new Map();
			this.spec = spec;
			if (!spec.stateList.some((state) => state.id === this.stateIdCurrent)) this.stateIdCurrent = spec.stateIdInitial;
			if (!spec.stateList.some((state) => state.id === this.stateIdTarget)) this.stateIdTarget = '';
			this.plan = animationPlanBuild(this.compiledById, [], this.stateIdCurrent);
			this.frame = 0;
			this.isPlaying = false;
			this.offsetById = animationPositionOffsetGet(this.sceneById.get(this.stateIdCurrent));
			this.cameraToken += 1;
			this.loadState = { status: 'done', message: '' };
		} catch (error) {
			this.spec = null;
			this.loadState = { status: 'error', message: String(error?.message ?? error) };
		}
	}

	get isLinear() {
		return this.spec ? animationIsLinear(this.spec) : true;
	}

	get segmentActive() {
		return this.plan.segmentList.find((segment) => this.frame >= segment.frameStart && this.frame < segment.frameStart + segment.frameCount) ?? null;
	}

	// how far the line of a transition is drawn: 0 to 1, and null when the plan
	// does not hold it. a transition already passed in this plan stays full
	transitionProgressGet(transitionId) {
		const segment = this.plan.segmentList.find((item) => item.transition.id === transitionId);
		if (!segment) return null;
		if (this.frame >= segment.frameStart + segment.frameCount) return 1;
		// a line still waiting its turn shows nothing
		if (this.frame < segment.frameStart) return null;
		return (this.frame - segment.frameStart) / Math.max(1, segment.frameCount - 1);
	}

	get isPlanActive() {
		return this.plan.segmentList.length > 0;
	}

	// what the Play button does from here: the state it goes to, or why not
	get stateIdPlayTo() {
		if (!this.spec) return '';
		if (this.stateIdTarget && this.stateIdTarget !== this.stateIdCurrent) return this.stateIdTarget;
		if (this.isLinear) return this.spec.stateList[this.spec.stateList.length - 1].id;
		return this.spec.transitionList.find((transition) => transition.from === this.stateIdCurrent)?.to ?? '';
	}

	get stateNext() {
		return this.spec?.transitionList.find((transition) => transition.from === this.stateIdCurrent)?.to ?? '';
	}

	get statePrevious() {
		return this.spec?.transitionList.find((transition) => transition.to === this.stateIdCurrent)?.from ?? '';
	}

	// a click on a state: the viewport goes there at once
	stateSet(stateId) {
		this.planClear();
		this.stateIdCurrent = stateId;
		if (this.stateIdTarget === stateId) this.stateIdTarget = '';
		this.offsetById = animationPositionOffsetGet(this.sceneById.get(stateId));
		this.cameraToken += 1;
	}

	stateTargetSet(stateId) {
		this.stateIdTarget = this.stateIdTarget === stateId ? '' : stateId;
	}

	planClear() {
		this.plan = animationPlanBuild(this.compiledById, [], this.stateIdCurrent);
		this.frame = 0;
		this.isPlaying = false;
	}

	// plays the way between two states; false when there is none
	playBetween(stateIdFrom, stateIdTo) {
		const path = animationPathFind(this.spec, stateIdFrom, stateIdTo);
		if (!path || path.length === 0) return false;
		this.stateIdCurrent = stateIdFrom;
		this.plan = animationPlanBuild(this.compiledById, path, stateIdFrom);
		this.frame = 0;
		this.playToken += 1;
		return true;
	}

	playTransition(transition) {
		return this.playBetween(transition.from, transition.to);
	}

	// the Play button: from the state shown to the target, or onward; from where
	// there is no way on (a block starts at its last state), from the first state
	// again. while a plan is held, pause / resume
	playToggle(playerRef) {
		if (this.isPlanActive) {
			if (this.isPlaying) playerRef?.pause();
			else playerRef?.play();
			return;
		}
		const stateIdTo = this.stateIdPlayTo;
		if (stateIdTo && stateIdTo !== this.stateIdCurrent) {
			this.playBetween(this.stateIdCurrent, stateIdTo);
		} else if (this.spec.stateList.length > 1) {
			const first = this.spec.stateList[0].id;
			this.stateSet(first);
			this.playBetween(first, this.stateIdPlayTo);
		}
	}

	playbackRateSet(value) {
		this.playbackRate = value;
	}

	// what the Player reports
	frameSet(frame) {
		this.frame = frame;
		const segment = this.segmentActive;
		if (segment && segment.transition.from !== this.stateIdCurrent) this.stateIdCurrent = segment.transition.from;
	}

	isPlayingSet(isPlaying) {
		this.isPlaying = isPlaying;
	}

	// the timeline ran out: the viewport rests on the state it reached
	planFinish() {
		if (!this.isPlanActive) return;
		const stateId = this.plan.stateIdTo;
		this.stateIdCurrent = stateId;
		if (this.stateIdTarget === stateId) this.stateIdTarget = '';
		this.offsetById = animationPositionOffsetGet(this.sceneById.get(stateId));
		this.planClear();
	}

	offsetByIdSet(offsetById) {
		const textNext = JSON.stringify(offsetById);
		if (textNext !== JSON.stringify(this.offsetById)) this.offsetById = offsetById;
	}

	boxSet(box) {
		if (this.box && this.box.width === box.width && this.box.height === box.height) return;
		this.box = box;
		this.viewById = new Map();
		this.cameraToken += 1;
	}

	// the nodes React Flow is given: an offset of a state moves a node, so that
	// its lines follow; a node at rest keeps its identity
	get nodeListFlow() {
		const list = this.canvasStore.nodeList;
		const offsetList = Object.entries(this.offsetById);
		if (offsetList.length === 0) return list;
		return list.map((node) => {
			const offset = this.offsetById[node.id];
			return offset ? { ...node, position: { x: node.position.x + offset.x, y: node.position.y + offset.y } } : node;
		});
	}

	// working stays until it ends; a failure stays long enough to read its reason
	captureHintSet(status, text) {
		clearTimeout(this.captureHintTimer);
		this.captureHint = { status, text };
		if (status === 'working') return;
		this.captureHintTimer = setTimeout(() => runInAction(() => { this.captureHint = null; }), status === 'failed' ? 9000 : 2600);
	}
}
