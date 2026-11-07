import { useContext } from 'react';
import { observer } from 'mobx-react-lite';
import { NodeResizer } from '@xyflow/react';
import { DiagramRenderContext } from './DiagramRender.jsx';

// The bounding box of a scene (card-diagram-flexible-switch.md#the-bounding-box): a
// red frame over the diagram. It is drawn in the visual editor and while the viewer
// adjusts it (sceneBox of the render context, { isAdjust, resizeEnd }); otherwise it
// takes no room and no pointer. It is left out of a picture of the viewport by its
// class, whatever the state of the block.
export const SceneBoxCard = observer(function SceneBoxCard({ node, editor, nodeId }) {
	const { sceneBox } = useContext(DiagramRenderContext);
	const isAdjust = Boolean(sceneBox?.isAdjust);
	if (!editor && !isAdjust) return <div className="doc-vis-scene-box is-hidden doc-vis-no-capture" />;
	const resizeEnd = (_event, params) => {
		if (editor) editor.change(() => editor.store.nodeResize(nodeId, params));
		else sceneBox.resizeEnd?.(nodeId, params);
	};
	return (
		<div className="doc-vis-scene-box doc-vis-no-capture" onClick={editor ? (event) => { event.stopPropagation(); editor.select(nodeId); } : undefined}>
			<NodeResizer isVisible color="#dc2626" minWidth={node.sizeMin?.width ?? 40} minHeight={node.sizeMin?.height ?? 40} onResizeEnd={resizeEnd} />
			<span className="doc-vis-scene-box-label">{node.data.name || 'Bounding box'}</span>
		</div>
	);
});
