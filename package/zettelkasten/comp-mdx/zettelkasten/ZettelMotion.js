// How a zettel turns into its connections and back (doc/README.md#the-connection-view): the
// frame of the zettel shrinks onto its own card in the middle of the view, the frame of the card
// stays where it was as the edge of the viewport, and what is connected comes out of the middle
// to its place, the lines last. Back, the same in reverse: everything goes into the card in the
// middle, whose frame grows to the whole zettel, and the text comes back.
//
// The scene is already drawn under the text, at its camera, when a change starts (the viewport of
// the package cloud-dev-vis, showAt): this moves only what is on the screen, with the Web
// Animations API, so nothing of the scene is rendered again, and an animation left half way is
// cancelled by the next one. A reader preferring less motion gets the end at once.
//
// each answers, once it has played, a cleanup: what it holds at its end (the text faded out, the
// cards gone into the middle) stays until the caller has shown the view it went to, then goes,
// so nothing flashes between the last frame and the next render.
//
//   bodyEl     the body of the zettel, under its title bar: the frame that becomes the viewport
//   ghostEl    an empty frame over everything, the one that shrinks and grows
//   textEl     the text of the zettel
//   sceneEl    the viewport, with the nodes of React Flow in it
//   centerId   the id of the node of the zettel itself in the scene

const EASE = 'cubic-bezier(0.22, 0.8, 0.24, 1)';
const SECOND_FRAME = 0.5;

export const zettelMotionIsReduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const finished = (animationList) => Promise.all(animationList.map((animation) => animation.finished.catch(() => undefined)));

// the nodes and the lines of the scene: the zettel's own node, the cards, the frames, the lines
function sceneElementRead(sceneEl, centerId) {
	const nodeList = [...sceneEl.querySelectorAll('.react-flow__node')];
	const centerEl = nodeList.find((element) => element.dataset.id === centerId) ?? null;
	const frameList = nodeList.filter((element) => element !== centerEl && element.querySelector('.zettel-frame, .doc-vis-node.is-background'));
	const cardList = nodeList.filter((element) => element !== centerEl && !frameList.includes(element));
	const lineList = [...sceneEl.querySelectorAll('.react-flow__edge, .doc-switch-edge-label')];
	return { centerEl, frameList, cardList, lineList };
}

const rectIn = (element, bodyRect) => {
	const rect = element.getBoundingClientRect();
	return { left: rect.left - bodyRect.left, top: rect.top - bodyRect.top, width: rect.width, height: rect.height };
};
const rectFrame = (rect) => ({ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });

// where each card comes from: toward the middle, by most of the way, in the scale of the canvas
function towardCenter(cardEl, centerRect, zoom) {
	const rect = cardEl.getBoundingClientRect();
	const dx = (centerRect.left + centerRect.width / 2 - (rect.left + rect.width / 2)) / zoom;
	const dy = (centerRect.top + centerRect.height / 2 - (rect.top + rect.height / 2)) / zoom;
	return { dx: dx * 0.82, dy: dy * 0.82, distance: Math.hypot(dx, dy) };
}

// every animation of a previous change, gone: what is drawn is the scene as it is
export function zettelMotionClear({ ghostEl, textEl, sceneEl }) {
	for (const element of [ghostEl, textEl, sceneEl, ...(sceneEl ? sceneEl.querySelectorAll('.react-flow__node > *, .react-flow__node, .react-flow__edge, .doc-switch-edge-label') : [])]) {
		for (const animation of element?.getAnimations?.() ?? []) animation.cancel();
	}
	if (ghostEl) ghostEl.hidden = true;
}

// the text turns into the connections. answers when it has played
const cleanupNone = () => {};
const cleanupOf = (animationList) => () => { for (const animation of animationList) animation.cancel(); };

export async function zettelMotionOpen({ bodyEl, ghostEl, textEl, sceneEl, centerId, duration = 620 }) {
	zettelMotionClear({ ghostEl, textEl, sceneEl });
	if (zettelMotionIsReduced()) return cleanupNone;
	const bodyRect = bodyEl.getBoundingClientRect();
	const { centerEl, frameList, cardList, lineList } = sceneElementRead(sceneEl, centerId);
	const animationList = [textEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.3, easing: 'ease-out', fill: 'forwards' })];
	if (!centerEl) {
		animationList.push(sceneEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration * 0.6, easing: 'ease-out', fill: 'backwards' }));
		await finished(animationList);
		return cleanupOf(textEl.getAnimations());
	}
	const centerRect = centerEl.getBoundingClientRect();
	const zoom = centerRect.width / Math.max(1, centerEl.offsetWidth);
	const rectTo = rectIn(centerEl, bodyRect);
	// the frame of the zettel shrinking onto its card
	ghostEl.hidden = false;
	animationList.push(ghostEl.animate([
		{ ...rectFrame({ left: 0, top: 0, width: bodyRect.width, height: bodyRect.height }), borderRadius: '2px', offset: 0 },
		{ ...rectFrame(rectTo), borderRadius: '8px', offset: 1 },
	], { duration: duration * 0.78, easing: EASE, fill: 'forwards' }));
	const fill = ghostEl.firstElementChild;
	if (fill) animationList.push(fill.animate([{ opacity: 0 }, { opacity: 0, offset: 0.25 }, { opacity: 1 }], { duration: duration * 0.78, easing: 'linear', fill: 'forwards' }));
	// the card of the zettel itself takes over where the frame lands
	animationList.push(centerEl.animate([{ opacity: 0 }, { opacity: 0, offset: 0.74 }, { opacity: 1, offset: 0.82 }, { opacity: 1 }], { duration, fill: 'backwards' }));
	// the rest comes out of the middle, the nearest first
	const distanceMax = Math.max(1, ...cardList.map((element) => towardCenter(element, centerRect, zoom).distance));
	for (const element of cardList) {
		const inner = element.firstElementChild ?? element;
		const { dx, dy, distance } = towardCenter(element, centerRect, zoom);
		animationList.push(inner.animate([
			{ transform: `translate(${dx}px, ${dy}px) scale(0.55)`, opacity: 0 },
			{ transform: 'none', opacity: 1 },
		], { duration: duration * 0.62, delay: duration * (0.26 + 0.16 * (distance / distanceMax)), easing: EASE, fill: 'backwards' }));
	}
	for (const element of frameList) animationList.push(element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration * 0.4, delay: duration * SECOND_FRAME, easing: 'ease-out', fill: 'backwards' }));
	for (const element of lineList) animationList.push(element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration * 0.35, delay: duration * 0.72, easing: 'ease-out', fill: 'backwards' }));
	await finished(animationList);
	ghostEl.hidden = true;
	for (const animation of [...ghostEl.getAnimations(), ...(fill?.getAnimations() ?? [])]) animation.cancel();
	return cleanupOf(textEl.getAnimations());
}

// the connections turn back into the text. answers when it has played
export async function zettelMotionClose({ bodyEl, ghostEl, textEl, sceneEl, centerId, duration = 560 }) {
	zettelMotionClear({ ghostEl, textEl, sceneEl });
	if (zettelMotionIsReduced()) return cleanupNone;
	const bodyRect = bodyEl.getBoundingClientRect();
	const { centerEl, frameList, cardList, lineList } = sceneElementRead(sceneEl, centerId);
	const animationList = [];
	const keepList = [];
	const hold = (animation) => {
		keepList.push(animation);
		animationList.push(animation);
	};
	if (!centerEl) {
		hold(sceneEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.5, easing: 'ease-in', fill: 'forwards' }));
		animationList.push(textEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration * 0.5, delay: duration * 0.3, easing: 'ease-out', fill: 'backwards' }));
		await finished(animationList);
		return cleanupOf(keepList);
	}
	const centerRect = centerEl.getBoundingClientRect();
	const zoom = centerRect.width / Math.max(1, centerEl.offsetWidth);
	const rectFrom = rectIn(centerEl, bodyRect);
	for (const element of lineList) hold(element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.22, easing: 'ease-in', fill: 'forwards' }));
	for (const element of frameList) hold(element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.3, easing: 'ease-in', fill: 'forwards' }));
	const distanceMax = Math.max(1, ...cardList.map((element) => towardCenter(element, centerRect, zoom).distance));
	for (const element of cardList) {
		const inner = element.firstElementChild ?? element;
		const { dx, dy, distance } = towardCenter(element, centerRect, zoom);
		hold(inner.animate([
			{ transform: 'none', opacity: 1 },
			{ transform: `translate(${dx}px, ${dy}px) scale(0.55)`, opacity: 0 },
		], { duration: duration * 0.45, delay: duration * 0.1 * (1 - distance / distanceMax), easing: 'cubic-bezier(0.5, 0, 0.75, 0.2)', fill: 'forwards' }));
	}
	// the card of the zettel grows into the whole zettel
	hold(centerEl.animate([{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0, offset: 0.36 }, { opacity: 0 }], { duration, fill: 'forwards' }));
	ghostEl.hidden = false;
	animationList.push(ghostEl.animate([
		{ ...rectFrame(rectFrom), borderRadius: '8px', offset: 0 },
		{ ...rectFrame(rectFrom), borderRadius: '8px', offset: 0.3 },
		{ ...rectFrame({ left: 0, top: 0, width: bodyRect.width, height: bodyRect.height }), borderRadius: '2px', offset: 1 },
	], { duration, easing: EASE, fill: 'forwards' }));
	const fill = ghostEl.firstElementChild;
	if (fill) animationList.push(fill.animate([{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration, easing: 'linear', fill: 'forwards' }));
	animationList.push(textEl.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], { duration, easing: 'ease-out', fill: 'backwards' }));
	await finished(animationList);
	ghostEl.hidden = true;
	for (const animation of [...ghostEl.getAnimations(), ...(fill?.getAnimations() ?? [])]) animation.cancel();
	return cleanupOf(keepList);
}

// the text and the flow: one fades into the other
export async function zettelMotionFade({ fromEl, toEl, duration = 320 }) {
	if (zettelMotionIsReduced() || !fromEl || !toEl) return cleanupNone;
	const animationList = [
		fromEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.6, easing: 'ease-in', fill: 'forwards' }),
		toEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration * 0.7, delay: duration * 0.3, easing: 'ease-out', fill: 'backwards' }),
	];
	await finished(animationList);
	return cleanupOf(animationList);
}
