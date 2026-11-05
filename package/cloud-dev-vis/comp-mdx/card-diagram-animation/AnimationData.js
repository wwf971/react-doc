import { Easing, interpolate, interpolateColors, spring } from 'remotion';
import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';

// The data of a card diagram animation (card-diagram-animation.md), pure: what
// the YAML says, normalized; what each state looks like (a scene); what a frame
// of a transition looks like; which transitions lie between two states; and the
// stylesheet a scene is drawn with. Nothing here touches React Flow or the page.
//
//   document
//     diagram            a card diagram (card-diagram-impl.md), unchanged
//     nodeDefineById     node fragments the nodes of the diagram reuse: { use: key }
//     stateList          [{ id, name, description, base, view, show, hide, target, caption }]
//     transitionList     [{ from, to, name, second, trackList }]; absent: a chain in list order
//     fps, transitionSecond, control { layout, positionById }
//     initial            the state shown when the page loads; default the last one,
//                        by convention the most complete (card-diagram-animation.md#the-state-shown-first)
//
//   target key     node/{id} | row/{nodeId}/{rowId} | connection/{id}, or camera in a track
//   scene          { propByKey: { [key]: { prop: value } }, view, caption }
//   plan           { segmentList: [{ transition, frameStart, frameCount }], frameTotal, stateIdFrom, stateIdTo }

export const ANIMATION_FPS_DEFAULT = 30;
export const ANIMATION_TRANSITION_SECOND_DEFAULT = 0.8;

const DOCUMENT_KEY_LIST = ['version', 'title', 'diagram', 'nodeDefineById', 'stateList', 'transitionList', 'fps', 'transitionSecond', 'control', 'initial'];
const STATE_KEY_LIST = ['id', 'name', 'description', 'base', 'view', 'show', 'hide', 'target', 'caption'];
const TRANSITION_KEY_LIST = ['from', 'to', 'name', 'description', 'second', 'trackList'];
const TRACK_KEY_LIST = ['target', 'token', 'at', 'second', 'ease', 'stagger', 'color', 'size', 'count', 'gap', 'label'];

const PROP_DEFAULT_BY_KIND = {
	node: { opacity: 1, scale: 1, x: 0, y: 0, ring: null, fill: null },
	row: { opacity: 1, ring: null, fill: null },
	connection: { opacity: 1, progress: 1, stroke: null, width: null },
};
const PROP_COLOR_SET = new Set(['ring', 'fill', 'stroke']);
const COLOR_NONE = 'rgba(0, 0, 0, 0)';

export const ANIMATION_EASE_LIST = ['linear', 'ease', 'easeIn', 'easeOut', 'easeInOut', 'spring'];
const EASE_BY_NAME = {
	linear: Easing.linear,
	ease: Easing.bezier(0.25, 0.1, 0.25, 1),
	easeIn: Easing.bezier(0.42, 0, 1, 1),
	easeOut: Easing.bezier(0, 0, 0.58, 1),
	easeInOut: Easing.bezier(0.42, 0, 0.58, 1),
};

function keysCheck(value, keyList, place) {
	for (const key of Object.keys(value)) {
		if (!keyList.includes(key)) throw new Error(`${place}: unknown key "${key}" (known: ${keyList.join(', ')})`);
	}
}

function mappingIs(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ---------- the document ----------

// the document text, or its parsed value, checked and filled in
export function animationNormalize(input) {
	const data = typeof input === 'string' ? yamlParse(input) : input;
	if (!mappingIs(data)) throw new Error('An animation is a mapping { diagram, stateList, transitionList? }.');
	keysCheck(data, DOCUMENT_KEY_LIST, 'The animation');
	if (!mappingIs(data.diagram) || !Array.isArray(data.diagram.nodes)) throw new Error('The animation needs "diagram", a card diagram with its nodes.');
	if (!Array.isArray(data.stateList) || data.stateList.length === 0) throw new Error('The animation needs "stateList", at least one state.');
	const fps = data.fps === undefined ? ANIMATION_FPS_DEFAULT : Number(data.fps);
	if (!Number.isFinite(fps) || fps < 1 || fps > 120) throw new Error(`fps must be a number from 1 to 120 (got ${data.fps}).`);
	const transitionSecond = data.transitionSecond === undefined ? ANIMATION_TRANSITION_SECOND_DEFAULT : Number(data.transitionSecond);
	if (!Number.isFinite(transitionSecond) || transitionSecond <= 0) throw new Error(`transitionSecond must be positive (got ${data.transitionSecond}).`);

	const stateIdSet = new Set();
	const stateList = data.stateList.map((state, index) => {
		const place = `State ${index + 1}`;
		if (!mappingIs(state)) throw new Error(`${place} must be a mapping.`);
		keysCheck(state, STATE_KEY_LIST, place);
		if (typeof state.id !== 'string' || !state.id.trim()) throw new Error(`${place} needs an id.`);
		if (stateIdSet.has(state.id)) throw new Error(`Two states have the id "${state.id}".`);
		stateIdSet.add(state.id);
		if (state.target !== undefined && !mappingIs(state.target)) throw new Error(`State "${state.id}": target is a mapping of target -> properties.`);
		return {
			id: state.id,
			name: String(state.name ?? state.id),
			description: String(state.description ?? ''),
			// what it says it changes over: the state before it, unless named
			base: state.base === undefined ? (index === 0 ? null : data.stateList[index - 1].id) : state.base,
			view: state.view,
			show: patternListRead(state.show, `State "${state.id}": show`),
			hide: patternListRead(state.hide, `State "${state.id}": hide`),
			target: state.target ?? {},
			caption: state.caption === undefined ? undefined : String(state.caption ?? ''),
		};
	});
	for (const state of stateList) {
		if (state.base !== null && !stateIdSet.has(state.base)) throw new Error(`State "${state.id}": base "${state.base}" is not a state.`);
	}

	const transitionInput = data.transitionList ?? stateList.slice(1).map((state, index) => ({ from: stateList[index].id, to: state.id }));
	if (!Array.isArray(transitionInput)) throw new Error('transitionList must be a list of { from, to }.');
	const transitionKeySet = new Set();
	const transitionList = transitionInput.map((transition, index) => {
		const place = `Transition ${index + 1}`;
		if (!mappingIs(transition)) throw new Error(`${place} must be a mapping { from, to }.`);
		keysCheck(transition, TRANSITION_KEY_LIST, place);
		for (const role of ['from', 'to']) {
			if (!stateIdSet.has(transition[role])) throw new Error(`${place}: ${role} "${transition[role]}" is not a state.`);
		}
		const id = `${transition.from}->${transition.to}`;
		if (transitionKeySet.has(id)) throw new Error(`Two transitions go from "${transition.from}" to "${transition.to}".`);
		transitionKeySet.add(id);
		const second = transition.second === undefined ? undefined : Number(transition.second);
		if (second !== undefined && (!Number.isFinite(second) || second <= 0)) throw new Error(`Transition ${id}: second must be positive.`);
		const trackList = (transition.trackList ?? []).map((track, trackIndex) => trackNormalize(track, `Transition ${id}, track ${trackIndex + 1}`));
		return { id, from: transition.from, to: transition.to, name: String(transition.name ?? ''), description: String(transition.description ?? ''), second, trackList };
	});

	const control = data.control ?? {};
	if (!mappingIs(control)) throw new Error('control must be a mapping { layout, positionById }.');
	const layout = control.layout ?? 'auto';
	if (!['auto', 'linear', 'graph'].includes(layout)) throw new Error(`control.layout must be auto, linear or graph (got ${layout}).`);
	if (data.initial !== undefined && !stateIdSet.has(data.initial)) throw new Error(`initial "${data.initial}" is not a state.`);

	return {
		title: String(data.title ?? ''),
		fps,
		transitionSecond,
		diagram: { ...data.diagram, nodes: nodeDefineListApply(data.diagram.nodes, data.nodeDefineById) },
		stateList,
		transitionList,
		control: { layout, positionById: control.positionById ?? {} },
		stateIdInitial: data.initial ?? stateList[stateList.length - 1].id,
	};
}

function patternListRead(value, place) {
	if (value === undefined) return [];
	const list = Array.isArray(value) ? value : [value];
	if (!list.every((item) => typeof item === 'string' && item.trim() !== '')) throw new Error(`${place} is a target or a list of targets.`);
	return list;
}

function trackNormalize(track, place) {
	if (!mappingIs(track)) throw new Error(`${place} must be a mapping.`);
	keysCheck(track, TRACK_KEY_LIST, place);
	if ((track.target === undefined) === (track.token === undefined)) throw new Error(`${place} is either { target } (when its properties change) or { token } (a mark moving along a connection).`);
	for (const key of ['at', 'second', 'stagger', 'size', 'count', 'gap']) {
		if (track[key] !== undefined && !(Number(track[key]) >= 0)) throw new Error(`${place}: ${key} must be a number, zero or more.`);
	}
	if (track.ease !== undefined && !ANIMATION_EASE_LIST.includes(track.ease)) throw new Error(`${place}: ease must be one of ${ANIMATION_EASE_LIST.join(', ')}.`);
	return {
		...track,
		at: Number(track.at ?? 0),
		second: track.second === undefined ? undefined : Number(track.second),
		ease: track.ease ?? 'easeInOut',
		stagger: Number(track.stagger ?? 0),
		patternList: track.target === undefined ? [] : patternListRead(track.target, `${place}: target`),
	};
}

// a node may say { use: key }: the fragment of nodeDefineById under it, its own
// keys over it, data merged key by key, so one card is written once and placed
// in several diagrams and places
function nodeDefineListApply(nodeList, nodeDefineById = {}) {
	return nodeList.map((node) => {
		if (!mappingIs(node) || node.use === undefined) return node;
		const define = nodeDefineById[node.use];
		if (!mappingIs(define)) throw new Error(`Node "${node.id}": use "${node.use}" is not in nodeDefineById.`);
		const { use: _use, ...own } = node;
		return { ...define, ...own, data: { ...define.data, ...own.data } };
	});
}

// ---------- targets ----------

// every target of a normalized diagram: { node, row, connection } lists of keys
// and which nodes each connection joins. graph: the normalized graph of the
// canvas store; rowListGet(node): the rows of a card
export function animationTargetSetBuild(graph, rowListGet) {
	const keyList = [];
	const connectionEndByKey = {};
	for (const node of graph.nodes) {
		keyList.push(`node/${node.id}`);
		for (const row of rowListGet(node)) keyList.push(`row/${node.id}/${row.id}`);
	}
	for (const connection of graph.connections) {
		const key = `connection/${connection.id}`;
		keyList.push(key);
		connectionEndByKey[key] = ['source', 'target'].map((role) => connection[role]?.nodeId).filter(Boolean).map((id) => `node/${id}`);
	}
	return { keyList, connectionEndByKey };
}

// "*" one whole target or one step of it; a word alone names a node
export function animationPatternMatch(patternInput, keyList, place = 'A target') {
	if (patternInput === 'camera' && keyList.includes('camera')) return ['camera'];
	const pattern = patternInput === '*' ? '**' : /^(node|row|connection)\//.test(patternInput) ? patternInput : `node/${patternInput}`;
	if (pattern === '**') return keyList.filter((key) => key !== 'camera');
	const source = pattern.split('/').map((part) => part.split('*').map((text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('/');
	const regex = new RegExp(`^${source}$`);
	const result = keyList.filter((key) => regex.test(key));
	if (result.length === 0) throw new Error(`${place}: "${patternInput}" names nothing of the diagram.`);
	return result;
}

function targetKindGet(key) {
	return key.split('/')[0];
}

// ---------- the scene of each state ----------

// a state over its base: what it hides, what it shows, then its own values. a
// connection hidden starts undrawn, so showing it draws it
export function animationSceneListBuild(spec, targetSet) {
	const stateById = new Map(spec.stateList.map((state) => [state.id, state]));
	const sceneById = new Map();
	const sceneGet = (stateId, chain = []) => {
		if (sceneById.has(stateId)) return sceneById.get(stateId);
		if (chain.includes(stateId)) throw new Error(`The states are based on each other in a cycle: ${[...chain, stateId].join(' -> ')}.`);
		const state = stateById.get(stateId);
		const base = state.base === null ? { propByKey: {}, view: undefined, caption: '' } : sceneGet(state.base, [...chain, stateId]);
		const propByKey = Object.fromEntries(Object.entries(base.propByKey).map(([key, prop]) => [key, { ...prop }]));
		const set = (key, change) => { propByKey[key] = { ...propByKey[key], ...change }; };
		for (const pattern of state.hide) {
			for (const key of animationPatternMatch(pattern, targetSet.keyList, `State "${stateId}": hide`)) {
				set(key, targetKindGet(key) === 'connection' ? { opacity: 0, progress: 0 } : { opacity: 0 });
			}
		}
		for (const pattern of state.show) {
			for (const key of animationPatternMatch(pattern, targetSet.keyList, `State "${stateId}": show`)) {
				set(key, targetKindGet(key) === 'connection' ? { opacity: 1, progress: 1 } : { opacity: 1 });
			}
		}
		for (const [pattern, change] of Object.entries(state.target)) {
			if (!mappingIs(change)) throw new Error(`State "${stateId}": target "${pattern}" is a mapping of properties.`);
			for (const key of animationPatternMatch(pattern, targetSet.keyList, `State "${stateId}": target`)) {
				const propAllowed = PROP_DEFAULT_BY_KIND[targetKindGet(key)];
				for (const prop of Object.keys(change)) {
					if (!(prop in propAllowed)) throw new Error(`State "${stateId}": ${key} has no property "${prop}" (known: ${Object.keys(propAllowed).join(', ')}).`);
				}
				set(key, change);
			}
		}
		const scene = { propByKey, view: state.view ?? base.view ?? 'all', caption: state.caption ?? base.caption ?? '' };
		sceneById.set(stateId, scene);
		return scene;
	};
	for (const state of spec.stateList) sceneGet(state.id);
	return sceneById;
}

// ---------- a transition, compiled to frames ----------

// when each target changes, in frames: the tracks naming it, staggered among
// what they match; a target no track names changes over the whole transition.
// the last frame of a transition is exactly its to-state
export function animationTransitionCompile(spec, transition, targetSet) {
	const { fps } = spec;
	const keyListAll = [...targetSet.keyList, 'camera'];
	const secondOfTrack = (track) => track.second ?? spec.transitionSecond;
	const trackEnd = Math.max(0, ...transition.trackList.map((track, index) => {
		const tokenCount = track.token === undefined ? 0 : Math.max(0, Number(track.count ?? 1) - 1) * Number(track.gap ?? 0.15);
		const matchCount = track.token === undefined ? matchCountGet(track, keyListAll) : 1;
		return track.at + secondOfTrack(track) + tokenCount + track.stagger * Math.max(0, matchCount - 1) + index * 0;
	}));
	const second = transition.second ?? (transition.trackList.length > 0 ? trackEnd : spec.transitionSecond);
	const frameCount = Math.max(2, Math.round(second * fps) + 1);
	const timingByKey = {};
	const tokenList = [];
	transition.trackList.forEach((track, trackIndex) => {
		if (track.token !== undefined) {
			const connectionKey = `connection/${track.token}`;
			if (!targetSet.keyList.includes(connectionKey)) throw new Error(`Transition ${transition.id}: token "${track.token}" is not a connection.`);
			const count = Math.max(1, Number(track.count ?? 1));
			for (let index = 0; index < count; index += 1) {
				tokenList.push({
					id: `${trackIndex}-${index}`,
					connectionId: track.token,
					frameStart: Math.round((track.at + index * Number(track.gap ?? 0.15)) * fps),
					frameCount: Math.max(2, Math.round(secondOfTrack(track) * fps)),
					color: track.color ?? '#2563eb',
					size: Number(track.size ?? 5),
					label: track.label === undefined ? '' : String(track.label),
					ease: track.ease,
				});
			}
			return;
		}
		let index = 0;
		for (const pattern of track.patternList) {
			for (const key of animationPatternMatch(pattern, keyListAll, `Transition ${transition.id}, track ${trackIndex + 1}`)) {
				if (timingByKey[key]) continue;
				const start = (track.at + track.stagger * index) * fps;
				timingByKey[key] = { frameStart: Math.round(start), frameEnd: Math.max(Math.round(start) + 1, Math.round(start + secondOfTrack(track) * fps)), ease: track.ease };
				index += 1;
			}
		}
	});
	return { transition, frameCount, timingByKey, tokenList };
}

function matchCountGet(track, keyList) {
	return track.patternList.reduce((count, pattern) => count + animationPatternMatch(pattern, keyList).length, 0);
}

// 0 to 1 at a frame of a timing, eased with remotion's own functions
export function animationProgressGet(frame, timing, fps) {
	const { frameStart, frameEnd, ease } = timing;
	if (frame <= frameStart) return 0;
	if (frame >= frameEnd) return 1;
	if (ease === 'spring') {
		return spring({ frame: frame - frameStart, fps, durationInFrames: frameEnd - frameStart, config: { damping: 18, stiffness: 120, mass: 0.7 } });
	}
	return interpolate(frame, [frameStart, frameEnd], [0, 1], { easing: EASE_BY_NAME[ease] ?? EASE_BY_NAME.easeInOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

// the values of every target at a frame of a transition
export function animationSceneAtFrame(sceneFrom, sceneTo, compiled, frame, fps) {
	const { frameCount, timingByKey } = compiled;
	const timingWhole = { frameStart: 0, frameEnd: frameCount - 1, ease: 'easeInOut' };
	const keySet = new Set([...Object.keys(sceneFrom.propByKey), ...Object.keys(sceneTo.propByKey)]);
	const propByKey = {};
	for (const key of keySet) {
		const propFrom = sceneFrom.propByKey[key] ?? {};
		const propTo = sceneTo.propByKey[key] ?? {};
		const propDefault = PROP_DEFAULT_BY_KIND[targetKindGet(key)];
		const progress = animationProgressGet(frame, timingByKey[key] ?? timingWhole, fps);
		const prop = {};
		for (const name of new Set([...Object.keys(propFrom), ...Object.keys(propTo)])) {
			const valueFrom = propFrom[name] ?? propDefault[name];
			const valueTo = propTo[name] ?? propDefault[name];
			prop[name] = PROP_COLOR_SET.has(name)
				? colorBetween(valueFrom, valueTo, progress)
				: valueFrom === valueTo ? valueTo : numberBetween(valueFrom, valueTo, progress, name);
		}
		propByKey[key] = prop;
	}
	return { propByKey };
}

function numberBetween(from, to, progress, name) {
	const fromValue = Number(from ?? PROP_DEFAULT_NUMBER_BY_NAME[name] ?? 0);
	const toValue = Number(to ?? PROP_DEFAULT_NUMBER_BY_NAME[name] ?? 0);
	return fromValue + (toValue - fromValue) * progress;
}
const PROP_DEFAULT_NUMBER_BY_NAME = { width: 1.5 };

function colorBetween(from, to, progress) {
	if (from === to) return to ?? null;
	if (progress >= 1) return to ?? null;
	if (progress <= 0) return from ?? null;
	return interpolateColors(progress, [0, 1], [from ?? COLOR_NONE, to ?? COLOR_NONE]);
}

// the camera between two views, resolved to { x, y, zoom }: the center and the
// logarithm of the zoom move evenly, so it glides instead of swinging out
export function animationViewBetween(viewFrom, viewTo, progress, box) {
	if (!viewFrom || !viewTo) return viewTo ?? viewFrom;
	const centerGet = (view) => ({ x: (box.width / 2 - view.x) / view.zoom, y: (box.height / 2 - view.y) / view.zoom });
	const centerFrom = centerGet(viewFrom);
	const centerTo = centerGet(viewTo);
	const zoom = Math.exp(Math.log(viewFrom.zoom) + (Math.log(viewTo.zoom) - Math.log(viewFrom.zoom)) * progress);
	const cx = centerFrom.x + (centerTo.x - centerFrom.x) * progress;
	const cy = centerFrom.y + (centerTo.y - centerFrom.y) * progress;
	return { x: box.width / 2 - cx * zoom, y: box.height / 2 - cy * zoom, zoom };
}

// ---------- which transitions lie between two states ----------

// the shortest way along the transitions, [] when the two are one state, null
// when there is none
export function animationPathFind(spec, stateIdFrom, stateIdTo) {
	if (stateIdFrom === stateIdTo) return [];
	const previousById = new Map([[stateIdFrom, null]]);
	const queue = [stateIdFrom];
	while (queue.length > 0) {
		const stateId = queue.shift();
		for (const transition of spec.transitionList) {
			if (transition.from !== stateId || previousById.has(transition.to)) continue;
			previousById.set(transition.to, transition);
			if (transition.to === stateIdTo) {
				const path = [];
				for (let item = transition; item; item = previousById.get(item.from)) path.unshift(item);
				return path;
			}
			queue.push(transition.to);
		}
	}
	return null;
}

export function animationPlanBuild(compiledById, path, stateIdFrom) {
	let frameTotal = 0;
	const segmentList = path.map((transition) => {
		const compiled = compiledById.get(transition.id);
		const segment = { transition, compiled, frameStart: frameTotal, frameCount: compiled.frameCount };
		frameTotal += compiled.frameCount;
		return segment;
	});
	return { segmentList, frameTotal: Math.max(1, frameTotal), stateIdFrom, stateIdTo: path.length > 0 ? path[path.length - 1].to : stateIdFrom };
}

export function animationIsLinear(spec) {
	if (spec.control.layout !== 'auto') return spec.control.layout === 'linear';
	const { stateList, transitionList } = spec;
	if (transitionList.length !== stateList.length - 1) return false;
	return transitionList.every((transition, index) => transition.from === stateList[index].id && transition.to === stateList[index + 1].id);
}

// the place of each state of a state machine in the control area, and the lines
// between them: layers by distance from the first state, a line back under them
const CONTROL_STATE_WIDTH = 116;
const CONTROL_STATE_HEIGHT = 26;
const CONTROL_GAP_X = 44;
const CONTROL_GAP_Y = 14;
export function animationControlGraphBuild(spec) {
	const depthById = new Map([[spec.stateList[0].id, 0]]);
	const queue = [spec.stateList[0].id];
	while (queue.length > 0) {
		const stateId = queue.shift();
		for (const transition of spec.transitionList) {
			if (transition.from === stateId && !depthById.has(transition.to)) {
				depthById.set(transition.to, depthById.get(stateId) + 1);
				queue.push(transition.to);
			}
		}
	}
	const orderByDepth = new Map();
	const placeById = {};
	for (const state of spec.stateList) {
		const depth = depthById.get(state.id) ?? 0;
		const order = orderByDepth.get(depth) ?? 0;
		orderByDepth.set(depth, order + 1);
		const written = spec.control.positionById[state.id];
		placeById[state.id] = {
			x: written?.x ?? depth * (CONTROL_STATE_WIDTH + CONTROL_GAP_X),
			y: written?.y ?? order * (CONTROL_STATE_HEIGHT + CONTROL_GAP_Y),
			width: CONTROL_STATE_WIDTH,
			height: CONTROL_STATE_HEIGHT,
		};
	}
	const placeList = Object.values(placeById);
	const bottomAll = Math.max(...placeList.map((place) => place.y + place.height));
	const lineList = spec.transitionList.map((transition) => {
		const from = placeById[transition.from];
		const to = placeById[transition.to];
		const isForward = to.x > from.x;
		if (isForward) {
			const x1 = from.x + from.width;
			const y1 = from.y + from.height / 2;
			const x2 = to.x;
			const y2 = to.y + to.height / 2;
			const bend = Math.max(18, (x2 - x1) / 2);
			return { transition, d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2 - 3} ${y2}` };
		}
		const x1 = from.x + from.width / 2;
		const y1 = from.y + from.height;
		const x2 = to.x + to.width / 2;
		const y2 = to.y + to.height;
		const bottom = bottomAll + 18;
		return { transition, d: `M ${x1} ${y1} C ${x1} ${bottom}, ${x2} ${bottom}, ${x2} ${y2 + 3}`, isBack: true };
	});
	return {
		placeById,
		lineList,
		width: Math.max(...placeList.map((place) => place.x + place.width)),
		height: bottomAll + (lineList.some((line) => line.isBack) ? 16 : 2),
	};
}

// ---------- the stylesheet of a scene ----------

// the values of a scene written as css rules under the scope of one block, which
// reach cards however they are drawn and whenever they mount. a row is found by
// its data-row-id. a connection fades with its ends unless it says otherwise.
// lengthOfConnectionGet(id): the length of its path, to draw it part way
export function animationSceneStyleBuild(scene, scope, targetSet, lengthOfConnectionGet) {
	const ruleList = [];
	const opacityOf = (key) => {
		const value = scene.propByKey[key]?.opacity;
		return value === undefined ? 1 : Number(value);
	};
	const connectionKeySet = new Set(Object.keys(targetSet.connectionEndByKey));
	const keyList = new Set([...Object.keys(scene.propByKey), ...connectionKeySet]);
	for (const key of keyList) {
		const prop = scene.propByKey[key] ?? {};
		const [kind, idFirst, idSecond] = key.split('/');
		const declarationList = [];
		if (kind === 'node') {
			const selector = `${scope} .react-flow__node[data-id=${JSON.stringify(idFirst)}]`;
			opacityRule(declarationList, prop.opacity);
			if (declarationList.length) ruleList.push(`${selector}{${declarationList.join(';')}}`);
			const contentList = [];
			if (prop.scale !== undefined && Number(prop.scale) !== 1) contentList.push(`transform:scale(${roundText(prop.scale)})`, 'transform-origin:center');
			if (prop.ring) contentList.push(`outline:2px solid ${prop.ring}`, 'outline-offset:2px', 'border-radius:0.5rem');
			if (prop.fill) contentList.push(`--doc-anim-fill:${prop.fill}`);
			if (contentList.length) ruleList.push(`${selector} > .doc-vis-node{${contentList.join(';')}}`);
		} else if (kind === 'row') {
			opacityRule(declarationList, prop.opacity);
			if (prop.fill) declarationList.push(`background:${prop.fill}`);
			if (prop.ring) declarationList.push(`box-shadow:inset 0 0 0 1.5px ${prop.ring}`);
			if (declarationList.length) ruleList.push(`${scope} .react-flow__node[data-id=${JSON.stringify(idFirst)}] [data-row-id=${JSON.stringify(idSecond)}]{${declarationList.join(';')}}`);
		} else if (kind === 'connection') {
			const endOpacity = Math.min(1, ...(targetSet.connectionEndByKey[key] ?? []).map(opacityOf));
			const opacity = (prop.opacity === undefined ? 1 : Number(prop.opacity)) * endOpacity;
			const selector = `${scope} .react-flow__edge[data-id=${JSON.stringify(idFirst)}]`;
			opacityRule(declarationList, opacity);
			if (declarationList.length) ruleList.push(`${selector}{${declarationList.join(';')}}`);
			const pathList = [];
			if (prop.stroke) pathList.push(`stroke:${prop.stroke} !important`);
			if (prop.width !== undefined && prop.width !== null) pathList.push(`stroke-width:${roundText(prop.width)} !important`);
			const progress = prop.progress === undefined ? 1 : Number(prop.progress);
			if (progress < 1 && opacity > 0) {
				const length = lengthOfConnectionGet?.(idFirst) ?? 0;
				if (length > 0) pathList.push(`stroke-dasharray:${roundText(length)} ${roundText(length)} !important`, `stroke-dashoffset:${roundText(length * (1 - progress))}`, 'marker-end:none !important', 'marker-start:none !important');
			}
			if (pathList.length) ruleList.push(`${selector} .react-flow__edge-path{${pathList.join(';')}}`);
			if (progress < 1) ruleList.push(`${selector} .react-flow__edge-text,${selector} .react-flow__edge-textbg{opacity:0}`);
		}
	}
	return ruleList.join('\n');
}

function opacityRule(list, value) {
	if (value === undefined) return;
	const opacity = Number(value);
	if (opacity >= 1) return;
	list.push(`opacity:${roundText(opacity)}`);
	if (opacity <= 0) list.push('visibility:hidden');
}

function roundText(value) {
	return String(Math.round(Number(value) * 1000) / 1000);
}

// the node offsets of a scene (x, y of a node target): only those not at rest
export function animationPositionOffsetGet(scene) {
	const offsetById = {};
	for (const [key, prop] of Object.entries(scene.propByKey)) {
		if (!key.startsWith('node/') || (!prop.x && !prop.y)) continue;
		offsetById[key.slice(5)] = { x: Number(prop.x ?? 0), y: Number(prop.y ?? 0) };
	}
	return offsetById;
}
