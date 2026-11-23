import { observer } from 'mobx-react-lite';
import { ViewportPortal } from '@xyflow/react';
import { PARAMETRIC_FEATURE_ID, groupKeyOf, memberIsFramedWhenRead } from './ParametricData.js';

// What the parametric canvas draws over the canvas while a diagram is read
// (card-diagram-parametric-canvas.md#on-the-canvas; node-registry.js: feature.ReadLayer): the frame
// of each layout member framed when read (memberIsFramedWhenRead), with its name, as the editing
// layer draws it but answering nothing. The origins of the groups and the relations are editing
// aids and stay out. It reads the model the diagram was read with (graph.featureById) and the boxes
// the placer last answered (canvasStore.placed), so it needs no session and solves nothing.
export const ParametricReadLayer = observer(function ParametricReadLayer({ canvasStore, catalog }) {
	const model = canvasStore?.graph?.featureById?.[PARAMETRIC_FEATURE_ID]?.model;
	const solved = canvasStore?.placed.get(PARAMETRIC_FEATURE_ID);
	if (!model || !solved) return null;
	const frameList = model.groupList.flatMap(group => group.memberList.filter(member => memberIsFramedWhenRead(member, catalog)).flatMap((member) => {
		const box = solved.boxByKey.get(groupKeyOf(group.id, member.id));
		// a layout with nothing in it has no box to frame when read
		if (!box?.width && !box?.height) return [];
		return [{ key: `${group.id}/${member.id}`, box, label: member.name || catalog.layoutTypeByType[member.layout.type]?.label || 'Layout' }];
	}));
	if (!frameList.length) return null;
	return (
		<ViewportPortal>
			{frameList.map(({ key, box, label }) => (
				<div key={key} className="doc-param-layout-box is-read" style={{ transform: `translate(${box.x - 6}px, ${box.y - 6}px)`, width: box.width + 12, height: box.height + 12 }}>
					<span className="doc-param-layout-tab">{label}</span>
				</div>
			))}
		</ViewportPortal>
	);
});
