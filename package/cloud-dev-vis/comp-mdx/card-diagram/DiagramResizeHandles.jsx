import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { NodeResizeControl } from '@xyflow/react';

// The resize handles of the node selected in the editor (card-diagram-impl.md#the-words-of-a-node):
// circles at the corners and a pill at the middle of each edge that changes, standing on the frame
// that marks the selection, which is the box of the node itself (DiagramVisualEdit.css:
// data-selected). Every node has them whose box can change (DiagramNodeResize.js: the axes, read
// from the node; no kind has to ask), drawn by DiagramNode beside the content of the card, never
// inside it, so nothing of them is scrolled or clipped by the card.
//
//   both axes     a corner keeps the ratio of the box, or reshapes it freely, Shift held swapping
//                 the two, also in the middle of a drag (the component config key DiagramResizeCorner:
//                 ratio, the default, or free); an edge changes one dimension
//   width alone   the corners are drawn as ever and change the width, as the left and right edges
//                 do; the height keeps following the content (height alone: the other way round)
//
// A resize handle is never a node handle (where a line attaches): an edge resizes along its whole
// length (a thin strip on the frame, under the node handles), and its pill is drawn only where no
// node handle stands at the middle of that edge, so a line is still drawn from a node handle there.
// The box is written when the pointer goes up, as one step, only the axes that change and the place
// only when it moved (editor.nodeResize: a feature placing the node writes it its own way); while the
// drag lasts, the editor's interaction is a resize (the edit card hides).
const CORNER_LIST = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const EDGE_LIST = [['top', 'vertical'], ['bottom', 'vertical'], ['left', 'horizontal'], ['right', 'horizontal']];

export const DiagramResizeHandles = observer(function DiagramResizeHandles({ nodeId, editor, axisList, handleList = [], sizeMin = {}, cornerMode = 'ratio' }) {
	const isShift = useShiftHeld();
	const isRatioKept = (cornerMode === 'free') === isShift;
	const startRef = useRef(null);
	const isBoth = axisList.includes('width') && axisList.includes('height');
	const common = {
		minWidth: sizeMin.width ?? 12, minHeight: sizeMin.height ?? 12,
		onResizeStart: (_event, params) => { startRef.current = params; editor.store.interactionSet({ type: 'resize', nodeId }); },
		onResizeEnd: (_event, params) => {
			const start = startRef.current;
			const isMoved = !start || Math.abs(params.x - start.x) > 0.5 || Math.abs(params.y - start.y) > 0.5;
			editor.store.interactionSet(null);
			editor.nodeResize(nodeId, { ...params, isMoved, axisList });
		},
	};
	// a node handle at the middle of a side keeps that place: no pill there
	const isMiddleTaken = side => handleList.some(handle => handle.anchor?.side === side && Math.abs((handle.anchor?.offset ?? 0.5) - 0.5) < 0.12);
	const edgeList = EDGE_LIST.filter(([, direction]) => axisList.includes(direction === 'horizontal' ? 'width' : 'height'));
	// one axis: a corner is drawn at the corner and acts as the edge of that axis on its side
	const cornerAsEdgeOf = (corner) => {
		const [vertical, horizontal] = corner.split('-');
		return axisList.includes('width') ? { position: horizontal, direction: 'horizontal', at: `is-at-${vertical}` } : { position: vertical, direction: 'vertical', at: `is-at-${horizontal}` };
	};
	return <>
		{edgeList.map(([position, direction]) => <NodeResizeControl key={`line-${position}`} variant="line" position={position} resizeDirection={direction} className="doc-vis-resize-edge" {...common} />)}
		{edgeList.filter(([position]) => !isMiddleTaken(position)).map(([position, direction]) => <NodeResizeControl key={position} position={position} resizeDirection={direction} className="doc-vis-resize-handle is-edge" {...common} />)}
		{CORNER_LIST.map((position) => {
			if (isBoth) return <NodeResizeControl key={position} position={position} keepAspectRatio={isRatioKept} className="doc-vis-resize-handle is-corner" {...common} />;
			const edge = cornerAsEdgeOf(position);
			return <NodeResizeControl key={position} position={edge.position} resizeDirection={edge.direction} className={`doc-vis-resize-handle is-corner ${edge.at}`} {...common} />;
		})}
	</>;
});

// whether Shift is held: from the keys, and from the pointer as it moves (Shift pressed before the
// window had the focus); let go when the window loses it
function useShiftHeld() {
	const [isShift, isShiftSet] = useState(false);
	useEffect(() => {
		const take = event => isShiftSet(Boolean(event.shiftKey));
		const release = () => isShiftSet(false);
		window.addEventListener('keydown', take, true);
		window.addEventListener('keyup', take, true);
		window.addEventListener('pointermove', take, true);
		window.addEventListener('blur', release);
		return () => {
			window.removeEventListener('keydown', take, true);
			window.removeEventListener('keyup', take, true);
			window.removeEventListener('pointermove', take, true);
			window.removeEventListener('blur', release);
		};
	}, []);
	return isShift;
}
