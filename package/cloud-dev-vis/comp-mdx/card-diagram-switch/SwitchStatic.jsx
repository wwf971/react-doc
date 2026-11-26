import { createContext, useCallback, useContext, useId, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DiagramRenderContext, DiagramSearchPathContext } from '../card-diagram/DiagramRender.jsx';
import { DiagramStaticLabel, DiagramStaticLineLayers, DiagramStaticNode, pathLabelPointAt, pathPointAt } from '../card-diagram/DiagramStatic.jsx';
import { depthKeyOfNode, depthZIndexTopGet, diagramDepthZIndexMapOf } from '../card-diagram/DiagramDepth.js';
import { endpointIsDangling } from '../card-diagram/DiagramERData.js';
import { switchPresentationBuild } from './SwitchData.js';

// A scene drawn without React Flow (card-diagram-flexible-switch.md#embedding): the
// same cards, placed absolutely, with its lines in one svg. This is what an embedded
// scene is, what covers the canvas while its nodes are replaced, and what measures a
// scene before it is shown. There is never a second React Flow canvas: a scene inside
// a scene is plain React, scaled by a transform of its parent. The cards and lines are the
// pieces of a diagram without a canvas (card-diagram/DiagramStatic.jsx).
//
// `pathOwner` reaches the cards below: the scene they belong to. `depth` is how deep the scene
// is embedded (its presentation, with depthMax of the block): a scene deeper than depthMax is
// not drawn, and what holds it draws a note instead (switchPresentationChildIsDrawn).
export const SwitchContext = createContext(null);
export { pathLabelPointAt, pathPointAt };

export const SwitchStaticScene = observer(function SwitchStaticScene({ store, path, depth = 0, isEmbedded = false, pathEmbedder = null }) {
	const parent = useContext(SwitchContext);
	const { config, registry } = useContext(DiagramRenderContext);
	const markerId = `doc-switch-arrow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
	const [geometryById, geometrySet] = useState({});
	const entry = store.entryGet(path);
	const onGeometry = useCallback((id, handleList, size) => {
		store.measurementSet(path, id, size);
		geometrySet((previous) => {
			const next = JSON.stringify(handleList);
			return JSON.stringify(previous[id]) === next ? previous : { ...previous, [id]: handleList };
		});
	}, [store, path]);
	const depthMax = store.depthRenderMax;
	const context = useMemo(() => ({ store, isStatic: true, depth, pathChain: [...(parent?.pathChain ?? []), path], presentation: switchPresentationBuild(path, isEmbedded, pathEmbedder, { depth, depthMax }) }), [store, depth, depthMax, parent, path, isEmbedded, pathEmbedder]);
	if (!entry?.canvas.graph) return null;
	if (depth > depthMax) return null;
	void store.measureVersion;
	const positions = store.entryPositionsGet(entry);
	const nodeList = entry.canvas.graph.nodes.filter((node) => node.renderer.type !== 'scene-box');
	// what is drawn over what: the z-index of each card and line, from their depths (card-diagram/DiagramDepth.js)
	const zIndexByKey = diagramDepthZIndexMapOf(entry.canvas.graph);
	// the words of the lines stay over every card, also one with a depth
	const zIndexLabel = depthZIndexTopGet(zIndexByKey) ? depthZIndexTopGet(zIndexByKey) + 1 : 0;
	// a root drawn as the canvas draws it (a mask, the measuring host) has the title of the scene
	// focused; an embedded copy is named by what holds it
	const titleNode = !isEmbedded && depth === 0 ? store.titleNodeOf?.(path) ?? null : null;
	const titleRect = titleNode ? store.titleRectOf(path) : null;
	const endOf = (endpoint) => {
		if (endpointIsDangling(endpoint)) return { x: endpoint.position.x, y: endpoint.position.y, side: 'left' };
		const position = positions.get(endpoint.nodeId);
		const handle = geometryById[endpoint.nodeId]?.find((item) => item.id === endpoint.handleId);
		return position && handle ? { x: position.x + handle.x, y: position.y + handle.y, side: handle.side } : null;
	};
	const lineList = entry.canvas.graph.connections.flatMap((connection) => {
		const source = endOf(connection.source);
		const target = endOf(connection.target);
		return source && target ? [{ connection, source, target }] : [];
	});
	return (
		<SwitchContext.Provider value={context}>
			<DiagramSearchPathContext.Provider value={path}>
			<div className="doc-switch-static">
				<DiagramStaticLineLayers className="doc-switch-static-lines" lineList={lineList} zIndexByKey={zIndexByKey} markerId={markerId} />
				{titleNode && titleRect ? <DiagramStaticNode className="doc-switch-static-node" key={titleNode.id} id={titleNode.id} node={titleNode} position={titleRect} config={config} registry={registry} onGeometry={onGeometry} /> : null}
				{nodeList.map((node) => (
					<DiagramStaticNode className="doc-switch-static-node" key={node.id} id={node.id} node={node.around ? { ...node, size: store.nodeSizeOf(entry, node) } : node} position={positions.get(node.id) ?? { x: 0, y: 0 }} zIndex={zIndexByKey.get(depthKeyOfNode(node.id))} config={config} registry={registry} onGeometry={onGeometry} />
				))}
				{lineList.filter(({ connection }) => connection.label.text).map(({ connection, source, target }) => <DiagramStaticLabel className="doc-switch-edge-label" key={connection.id} connection={connection} source={source} target={target} zIndex={zIndexLabel} />)}
			</div>
			</DiagramSearchPathContext.Provider>
		</SwitchContext.Provider>
	);
});
