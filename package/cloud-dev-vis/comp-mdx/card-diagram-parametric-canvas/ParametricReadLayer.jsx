import { observer } from 'mobx-react-lite';
import { ViewportPortal } from '@xyflow/react';
import { PARAMETRIC_FEATURE_ID, groupKeyOf, memberIsFramedWhenRead } from './ParametricData.js';

// What the parametric canvas draws over the canvas while a diagram is read
// (card-diagram-parametric-canvas.md#on-the-canvas; node-registry.js: feature.ReadLayer): the frame
// of each layout member framed when read (memberIsFramedWhenRead), with its name, as the editing
// layer draws it but answering nothing. The origins of the groups and the relations are editing
// aids and stay out. It reads the model the diagram was read with (graph.featureById) and the boxes
// the placer last answered (canvasStore.placed), so it needs no session and solves nothing.
// A layout type that draws itself when read (layoutUiByType[type].ReadLayer: a locator shown in
// full or faintly, ParametricLocatorLayer.jsx) is drawn by its own component, answering nothing.
export const ParametricReadLayer = observer(function ParametricReadLayer({ canvasStore, catalog, layoutUiByType = {} }) {
	const model = canvasStore?.graph?.featureById?.[PARAMETRIC_FEATURE_ID]?.model;
	const solved = canvasStore?.placed.get(PARAMETRIC_FEATURE_ID);
	if (!model || !solved) return null;
	const ownList = model.groupList.flatMap(group => group.memberList.filter(member => member.layout && layoutUiByType[member.layout.type]?.ReadLayer).flatMap((member) => {
		const box = solved.boxByKey.get(groupKeyOf(group.id, member.id));
		const Layer = layoutUiByType[member.layout.type].ReadLayer;
		const childBoxList = group.memberList.filter(other => other.parentIdList.includes(member.id)).map(other => solved.boxByKey.get(groupKeyOf(group.id, other.id))).filter(Boolean);
		return box ? [<Layer key={`${group.id}/${member.id}`} group={group} member={member} box={box} childBoxList={childBoxList} isRead />] : [];
	}));
	const frameList = model.groupList.flatMap(group => group.memberList.filter(member => memberIsFramedWhenRead(member, catalog)).flatMap((member) => {
		const box = solved.boxByKey.get(groupKeyOf(group.id, member.id));
		// a layout with nothing in it has no box to frame when read
		if (!box?.width && !box?.height) return [];
		return [{ key: `${group.id}/${member.id}`, box, label: member.name || catalog.layoutTypeByType[member.layout.type]?.label || 'Layout' }];
	}));
	if (!frameList.length && !ownList.length) return null;
	return (
		<ViewportPortal>
			{ownList}
			{frameList.map(({ key, box, label }) => (
				<div key={key} className="doc-param-layout-box is-read" style={{ transform: `translate(${box.x - 6}px, ${box.y - 6}px)`, width: box.width + 12, height: box.height + 12 }}>
					<span className="doc-param-layout-tab">{label}</span>
				</div>
			))}
		</ViewportPortal>
	);
});
