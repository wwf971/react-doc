import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LocateFixed } from '../../../../main/frontend/UICommon.js';
import { DiagramStatic } from './DiagramStatic.jsx';
import { nodeRegistryBuild } from './node-registry.js';
import { CardIcon } from './CardIcon.jsx';
import { cardIconAnchorListGet, cardIconAnchorRectEstimate, cardIconNormalize } from './CardIconData.js';

// The middle part of a tab of the panel: the relations of what is selected, as a small diagram of
// the card diagram format drawn without a canvas (DiagramStatic), icon nodes joined by right-angled
// lines. The part is a small canvas of its own: the wheel over it zooms around the pointer and
// never scrolls the page (a pinch too), a drag pans, the button at its corner puts the camera back.
// The camera is the tab's ({ x, y, zoom }), so it is kept with what it shows.
//
//   diagram          { nodes, connections } or null (nothing to show: emptyText)
//   camera, cameraSet(camera), cameraReset()
//   onNodeClick(nodeId)
//   legend           [{ id, label, tone }]: the looks of the lines, in a corner
const GRAPH_DRAG_MIN = 3;
const GRAPH_ZOOM_MIN = 0.3;
const GRAPH_ZOOM_MAX = 3;
export const GRAPH_CAMERA_REST = { x: 0, y: 0, zoom: 1 };
// the registry of a graph of relations: icon nodes alone. Its own, so a graph is drawn the same
// whatever the kinds of the diagram edited
export const panelGraphRegistry = nodeRegistryBuild({ id: 'panel-relations', label: 'Relations', kindList: [{ type: 'card-icon', label: 'Icon', contract: { dataNormalize: cardIconNormalize, anchorListGet: cardIconAnchorListGet, anchorRectEstimate: cardIconAnchorRectEstimate, sizeDefault: { width: 190, height: 34 } }, schema: null, Card: CardIcon }] });

export function panelGraphZoomClamp(zoom) { return Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, zoom)); }

// the graph at rest: at its size, or smaller to fit its box (never below GRAPH_FIT_ZOOM_MIN, where
// its words stay readable: what is left out is reached by a drag)
const GRAPH_PADDING = 14;
const GRAPH_FIT_ZOOM_MIN = 0.7;
export function panelGraphRestOf(diagram, box) {
	if (!diagram?.nodes?.length || !box?.width || !box?.height) return GRAPH_CAMERA_REST;
	const width = Math.max(...diagram.nodes.map(node => node.position.x + (node.size?.width ?? 0))) + GRAPH_PADDING * 2;
	const height = Math.max(...diagram.nodes.map(node => node.position.y + (node.size?.height ?? 0))) + GRAPH_PADDING * 2;
	const zoom = Math.max(GRAPH_FIT_ZOOM_MIN, Math.min(1, box.width / width, box.height / height));
	return { x: 0, y: 0, zoom };
}

export const DiagramPanelGraph = observer(function DiagramPanelGraph({ diagram, camera, cameraSet, cameraReset, onNodeClick, emptyText, legend = null, ariaLabel = 'Relations of what is selected' }) {
	const key = diagram ? JSON.stringify(diagram) : '';
	// the diagram keeps its identity while it says the same: the static diagram reads it once
	const diagramKept = useMemo(() => (key ? JSON.parse(key) : null), [key]);
	const hostRef = useRef(null);
	const drag = useRef(null);
	// the box of the part, measured: the graph at rest fits it
	const [box, boxSet] = useState(null);
	useLayoutEffect(() => {
		const host = hostRef.current;
		if (!host) return undefined;
		const measure = () => boxSet(previous => (previous?.width === host.clientWidth && previous?.height === host.clientHeight ? previous : { width: host.clientWidth, height: host.clientHeight }));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(host);
		return () => observer.disconnect();
	}, []);
	const isAtRest = camera.x === 0 && camera.y === 0 && camera.zoom === 1;
	// what is drawn: the camera of the tab, or at rest the graph fitted to its box
	const cameraShown = isAtRest ? panelGraphRestOf(diagramKept, box) : camera;
	const cameraRef = useRef(cameraShown);
	cameraRef.current = cameraShown;
	// the wheel is taken natively (not passive), so the page never scrolls under it
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return undefined;
		const wheel = (event) => {
			event.preventDefault();
			event.stopPropagation();
			const rect = host.getBoundingClientRect();
			const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
			const now = cameraRef.current;
			const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
			const zoom = panelGraphZoomClamp(now.zoom * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015)));
			// the point of the graph under the pointer stays under it
			cameraSet({ zoom, x: pointer.x - ((pointer.x - now.x) * zoom) / now.zoom, y: pointer.y - ((pointer.y - now.y) * zoom) / now.zoom });
		};
		host.addEventListener('wheel', wheel, { passive: false });
		return () => host.removeEventListener('wheel', wheel);
	}, [cameraSet]);
	const pointerDown = (event) => {
		if (event.button !== 0) return;
		drag.current = { x: event.clientX, y: event.clientY, camera: cameraRef.current, isMoved: false };
	};
	const pointerMove = (event) => {
		const state = drag.current;
		if (!state) return;
		const dx = event.clientX - state.x;
		const dy = event.clientY - state.y;
		if (!state.isMoved && Math.hypot(dx, dy) < GRAPH_DRAG_MIN) return;
		if (!state.isMoved) event.currentTarget.setPointerCapture(event.pointerId);
		state.isMoved = true;
		cameraSet({ ...state.camera, x: state.camera.x + dx, y: state.camera.y + dy });
	};
	const pointerUp = (event) => {
		const state = drag.current;
		drag.current = null;
		if (state?.isMoved) {
			event.currentTarget.releasePointerCapture?.(event.pointerId);
			// the click that ends a drag selects nothing
			const swallow = (clickEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
			window.addEventListener('click', swallow, { capture: true, once: true });
			setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
		}
	};
	return (
		<div ref={hostRef} className="doc-vis-panel-graph" aria-label={ariaLabel} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; }}>
			{diagramKept ? (
				<div className="doc-vis-panel-graph-view" style={{ transform: `translate(${cameraShown.x}px, ${cameraShown.y}px) scale(${cameraShown.zoom})` }}>
					<DiagramStatic diagram={diagramKept} registry={panelGraphRegistry} padding={14} onNodeClick={node => onNodeClick?.(node.id)} />
				</div>
			) : <p className="doc-note doc-vis-panel-empty">{emptyText}</p>}
			{diagramKept && legend?.length ? (
				<span className="doc-vis-panel-graph-legend" aria-label="The looks of the lines">
					{legend.map(item => <span key={item.id} className={`doc-vis-panel-graph-legend-item is-${item.tone}${item.isDashed ? ' is-dashed' : ''}`}><i aria-hidden="true" />{item.label}</span>)}
				</span>
			) : null}
			{diagramKept && !isAtRest ? <button type="button" className="doc-button-icon doc-vis-panel-graph-reset" title="Back to the whole graph at its size" aria-label="Reset the view of the graph" onPointerDown={event => event.stopPropagation()} onClick={cameraReset}><LocateFixed size={12} /></button> : null}
		</div>
	);
});
