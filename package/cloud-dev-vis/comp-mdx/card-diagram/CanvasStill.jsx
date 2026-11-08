import { useEffect, useLayoutEffect, useState } from 'react';
import { useCompStateStore } from '../../../../main/comp-doc/registry/use-comp-state.js';

// The picture a canvas of the framework left, held by the next mount of its block until
// that one has drawn (card-diagram-impl.md#a-block-mounted-again). A block is mounted
// again when the document enters or leaves edit mode (another body is rendered) or when
// the reader comes back to it; React Flow then draws the cards a frame after it mounts and
// the lines a frame or two after that (they need the measured cards and anchors), and a
// player measures itself before it draws anything. Without this the block flashes empty.
//
//   const still = useCanvasStill(config, 'diagram', hostRef);
//   <div ref={hostRef} className="...">          position: relative
//     <CanvasStill still={still} />
//     ...the canvas
//   </div>
//
// the picture is a copy of the host's html taken when the mount leaves, kept for the block
// (useCompStateStore, under `${name}-still`). it is shown over the host, without taking
// the pointer, until the live canvas has as many cards and lines as the picture (or it has
// had a few frames to settle: what it draws may have changed meanwhile).
const STILL_FRAME_SETTLE = 6;
const STILL_MS_MAX = 800;

class CanvasStillHolder {
	element = null;
}

function canvasCountGet(root) {
	let node = 0;
	let edge = 0;
	for (const element of root.querySelectorAll('.react-flow__node')) if (!element.closest('.doc-canvas-still')) node += 1;
	for (const element of root.querySelectorAll('.react-flow__edge')) if (!element.closest('.doc-canvas-still')) edge += 1;
	return { node, edge };
}

export function useCanvasStill(config, name, hostRef, { isEnabled = true } = {}) {
	const holder = useCompStateStore(config, `${name}-still`, () => new CanvasStillHolder());
	const [still, stillSet] = useState(null);
	useLayoutEffect(() => {
		// the picture the last mount left. read here, not while rendering: the last mount of
		// the same block leaves in the same commit, and its picture is taken as it leaves,
		// which is after this mount rendered and before its layout effects. shown before the
		// browser paints (a state set in a layout effect renders at once)
		if (isEnabled && holder.element) stillSet(holder.element);
		// the picture, when this mount leaves: only of a canvas that was drawn (a mount
		// leaving while it still showed the last picture keeps that one)
		return () => {
			const host = hostRef.current;
			if (!isEnabled || !host || host.querySelector('.doc-canvas-still')) return;
			if (canvasCountGet(host).node === 0) return;
			holder.element = host.cloneNode(true);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [holder, isEnabled]);
	// let go once the canvas drew
	useEffect(() => {
		if (!still) return undefined;
		const countStill = canvasCountGet(still);
		const timeStart = performance.now();
		let frameDrawn = 0;
		let frameId = requestAnimationFrame(function check() {
			const host = hostRef.current;
			const count = host ? canvasCountGet(host) : { node: 0, edge: 0 };
			if (count.node > 0) frameDrawn += 1;
			const isDrawn = count.node >= countStill.node && count.edge >= countStill.edge;
			if ((count.node > 0 && isDrawn) || frameDrawn >= STILL_FRAME_SETTLE || performance.now() - timeStart > STILL_MS_MAX) {
				// one frame more: what was just drawn is painted under the picture first
				frameId = requestAnimationFrame(() => stillSet(null));
				return;
			}
			frameId = requestAnimationFrame(check);
		});
		return () => cancelAnimationFrame(frameId);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [still]);
	return still;
}

// the picture over the host: the copy's content, so the selectors of the host still apply
export function CanvasStill({ still }) {
	if (!still) return null;
	const ref = (element) => {
		if (!element || element.childElementCount > 0) return;
		element.append(...still.cloneNode(true).childNodes);
		for (const nested of element.querySelectorAll('.doc-canvas-still')) nested.remove();
	};
	return <div ref={ref} className="doc-canvas-still" aria-hidden="true" />;
}
