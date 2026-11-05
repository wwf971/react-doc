import { makeAutoObservable, observable } from 'mobx';
import { animationIsLinear, animationPathFind, animationPlanBuild } from '../card-diagram-animation/AnimationData.js';
import { switchPathNormalize } from './SwitchData.js';

const FPS_DEFAULT = 30;
const SECOND_MIN = 0.1;

// the document of an animation over views (card-diagram-flexible-switch.md#under-the-animation-layer):
//
//   stateList        [{ id, name, description?, view: a path, box?: a region of it, item?: an item of a scrolling stack of it }]
//   transitionList   [{ from, to, name?, second? }]; absent, the states run as a chain
//   fps, control     as in an animation of one diagram
export function switchAnimationNormalize(input) {
	const value = input ?? {};
	if (!Array.isArray(value.stateList) || value.stateList.length === 0) throw new Error('The animation needs "stateList", at least one state, each naming a view.');
	const idSet = new Set();
	const stateList = value.stateList.map((state, index) => {
		if (!state?.id) throw new Error(`State ${index + 1} needs an id.`);
		if (idSet.has(state.id)) throw new Error(`Two states have the id "${state.id}".`);
		if (!state.view) throw new Error(`State "${state.id}" needs "view", the path of a view.`);
		idSet.add(state.id);
		return { id: String(state.id), name: String(state.name ?? state.id), description: String(state.description ?? ''), path: switchPathNormalize(state.view), box: state.box, item: state.item ? String(state.item) : '' };
	});
	const transitionInput = value.transitionList ?? stateList.slice(0, -1).map((state, index) => ({ from: state.id, to: stateList[index + 1].id }));
	const transitionList = transitionInput.map((transition, index) => {
		if (!idSet.has(transition.from) || !idSet.has(transition.to)) throw new Error(`Transition ${index + 1} names a state that does not exist: ${transition.from} -> ${transition.to}.`);
		return { id: transition.id ?? `${transition.from}->${transition.to}`, from: transition.from, to: transition.to, name: transition.name ?? '', second: transition.second };
	});
	return { title: String(value.title ?? ''), fps: Number(value.fps) || FPS_DEFAULT, stateList, transitionList, control: { layout: value.control?.layout ?? 'auto' }, stateIdInitial: value.initial ?? stateList[stateList.length - 1].id };
}

// The state of a block moving between views under remotion's clock: the interface
// AnimationControl reads (the same as AnimationStore), over a SwitchStore it drives.
// A way between two states of the plan is drawn by the frame (SwitchStore.seek), so
// seeking gives the same picture as playing.
export class SwitchAnimationStore {
	spec = null;
	stateIdCurrent = '';
	stateIdTarget = '';
	plan = { segmentList: [], frameTotal: 1 };
	frame = 0;
	isPlaying = false;
	playToken = 0;
	playbackRate = 1;

	constructor({ spec, switchStore }) {
		this.switchStore = switchStore;
		this.compiledById = new Map();
		this.wayById = new Map();
		makeAutoObservable(this, { switchStore: false, compiledById: false, wayById: false, spec: observable.ref, plan: observable.ref }, { autoBind: true });
		this.specSet(spec);
	}

	specSet(spec) {
		this.spec = spec;
		const stateById = new Map(spec.stateList.map((state) => [state.id, state]));
		this.compiledById = new Map();
		this.wayById = new Map();
		for (const transition of spec.transitionList) {
			const from = stateById.get(transition.from);
			const to = stateById.get(transition.to);
			const timeline = this.switchStore.routeTimelineGet(from.path, to.path, { itemId: to.item });
			const second = Math.max(SECOND_MIN, Number(transition.second) || timeline.second);
			this.compiledById.set(transition.id, { frameCount: Math.max(2, Math.round(second * spec.fps)) });
			this.wayById.set(transition.id, { id: transition.id, from: from.path, to: to.path, timeline, region: to.box });
		}
		if (!spec.stateList.some((state) => state.id === this.stateIdCurrent)) this.stateIdCurrent = spec.stateIdInitial;
		if (!spec.stateList.some((state) => state.id === this.stateIdTarget)) this.stateIdTarget = '';
		this.plan = animationPlanBuild(this.compiledById, [], this.stateIdCurrent);
		this.switchStore.viewsMeasured([...new Set(spec.stateList.map((state) => state.path))]);
	}

	stateOf(stateId) {
		return this.spec.stateList.find((state) => state.id === stateId);
	}

	// where a block starts: its state shown, once the canvas can place it
	stateShow(stateId) {
		const state = this.stateOf(stateId);
		if (state) void this.switchStore.showAt(state.path, state.box, state.item);
	}

	get isLinear() {
		return animationIsLinear(this.spec);
	}

	get isPlanActive() {
		return this.plan.segmentList.length > 0;
	}

	get segmentActive() {
		return this.plan.segmentList.find((segment) => this.frame >= segment.frameStart && this.frame < segment.frameStart + segment.frameCount) ?? null;
	}

	transitionProgressGet(transitionId) {
		const segment = this.plan.segmentList.find((item) => item.transition.id === transitionId);
		if (!segment) return null;
		if (this.frame >= segment.frameStart + segment.frameCount) return 1;
		if (this.frame < segment.frameStart) return null;
		return (this.frame - segment.frameStart) / Math.max(1, segment.frameCount - 1);
	}

	get stateIdPlayTo() {
		if (this.stateIdTarget && this.stateIdTarget !== this.stateIdCurrent) return this.stateIdTarget;
		if (this.isLinear) return this.spec.stateList[this.spec.stateList.length - 1].id;
		return this.spec.transitionList.find((transition) => transition.from === this.stateIdCurrent)?.to ?? '';
	}

	get stateNext() {
		return this.spec.transitionList.find((transition) => transition.from === this.stateIdCurrent)?.to ?? '';
	}

	get statePrevious() {
		return this.spec.transitionList.find((transition) => transition.to === this.stateIdCurrent)?.from ?? '';
	}

	stateSet(stateId) {
		this.planClear();
		this.stateIdCurrent = stateId;
		if (this.stateIdTarget === stateId) this.stateIdTarget = '';
		this.stateShow(stateId);
	}

	stateTargetSet(stateId) {
		this.stateIdTarget = this.stateIdTarget === stateId ? '' : stateId;
	}

	planClear() {
		this.plan = animationPlanBuild(this.compiledById, [], this.stateIdCurrent);
		this.frame = 0;
		this.isPlaying = false;
	}

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

	playToggle(player) {
		if (this.isPlanActive) {
			if (this.isPlaying) player?.pause();
			else player?.play();
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

	frameSet(frame) {
		this.frame = frame;
		const segment = this.segmentActive;
		if (segment && segment.transition.from !== this.stateIdCurrent) this.stateIdCurrent = segment.transition.from;
	}

	isPlayingSet(isPlaying) {
		this.isPlaying = isPlaying;
	}

	planFinish() {
		if (!this.isPlanActive) return;
		const stateId = this.plan.stateIdTo;
		this.stateIdCurrent = stateId;
		if (this.stateIdTarget === stateId) this.stateIdTarget = '';
		this.planClear();
		void this.switchStore.seekEnd();
	}

	// the way of a segment, its final camera resolved when it is played
	wayOf(segment) {
		const way = this.wayById.get(segment.transition.id);
		return { ...way, cameraTo: way.region ? this.switchStore.boxCameraGet(way.to, way.region) : null };
	}
}
