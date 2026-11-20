import { observer } from 'mobx-react-lite';
import { DiagramNodeContent } from './DiagramRender.jsx';
import { NODE_PIN_LIST } from './DiagramERData.js';

// The nodes pinned to the viewport (node.pin, DiagramERData.js: graph.pinList): over the canvas,
// in their corner, the same size whatever the camera, as a legend stands beside a map. Each is the
// card of its kind, drawn outside React Flow: it takes no line and is not searched. Several in one
// corner stand one under the other. A canvas puts this layer in its own box
// (card-diagram-impl.md#nodes-pinned-to-the-viewport)
const noAnchorRef = () => () => {};

export const DiagramPinLayer = observer(function DiagramPinLayer({ pinList, registry, config = {} }) {
	if (!pinList?.length) return null;
	return (
		<div className="doc-diagram-pin-layer not-prose">
			{NODE_PIN_LIST.map((corner) => {
				const list = pinList.filter((node) => node.pin === corner);
				if (list.length === 0) return null;
				return (
					<div key={corner} className="doc-diagram-pin" data-corner={corner}>
						{list.map((node) => (
							<div key={node.id} className="doc-diagram-pin-node nodrag nopan nowheel" style={{ width: node.size.width === 'auto' ? node.sizeDefault.width : node.size.width }}>
								<DiagramNodeContent id={node.id} node={node} config={config} registry={registry} anchorRef={noAnchorRef} visualization={{ nodeId: node.id, size: node.size, isEdit: false, anchorRef: noAnchorRef }} />
							</div>
						))}
					</div>
				);
			})}
		</div>
	);
});
