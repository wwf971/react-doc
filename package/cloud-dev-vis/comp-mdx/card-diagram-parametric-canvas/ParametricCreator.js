// The creators of the parametric canvas (card-diagram-parametric-canvas.md#creating): what makes
// the thing of a tool. One per `create.what` of a tool (ParametricTool.js), a plugin like a
// constraint type: a feature is built with a list of them.
//
// A creator knows its sort of thing and nothing of gestures. It reads a **placement** (the
// vocabulary of ParametricCreateMode.js) and says which kinds of placement it can take, so the
// modes a tool offers follow from data: no code pairs a mode with a kind of node.
//
//   creator
//     what, label
//     placementKindListGet(create, context)   the kinds of placement it takes for this `create`, in
//                              the order it prefers: the first decides the default mode of a tool
//     ghostOf(create, placement, context)     what the thing will take up, drawn while the gesture
//                              lasts: { boxList?: [{ x, y, width, height, isMark? }], lineList?:
//                              [{ from, to }], text? }; isMark: a thing that is there, pointed at
//     place(create, placement, context)       makes it, as one step of the history (the commands of
//                              the session); answers what it made, or null with the reason said
//     paramSectionListGet(create, write, context)   the parameters of a tool making it, as sections
//                              of the edit card; write(createNext) keeps a change
//   context   { session, target }: the session of the editor (ParametricEditStore), and where a new
//             thing goes when the placement does not say: { groupId, parentId } or null (free)
const TONE_LIST = ['slate', 'blue', 'teal', 'green', 'amber', 'red', 'violet'];
const LAYOUT_GHOST_SIZE = { width: 150, height: 40 };
const SIZE_MIN_DEFAULT = { width: 24, height: 24 };

// where a box of a size stands beside another, on a side, at a gap, their middles in line
function besidePositionOf(box, size, side, gap) {
	if (side === 'left' || side === 'right') return { x: side === 'right' ? box.x + box.width + gap : box.x - gap - size.width, y: box.y + (box.height - size.height) / 2 };
	return { x: box.x + (box.width - size.width) / 2, y: side === 'bottom' ? box.y + box.height + gap : box.y - gap - size.height };
}

// the top left corner a point placement gives a box of a size
const pointCornerOf = (placement, size) => ({ x: placement.point.x - (placement.hold?.x ?? 0) * size.width, y: placement.point.y - (placement.hold?.y ?? 0) * size.height });

// the constraint a `beside` placement is written as, when the feature has the type; else nothing,
// and the member is kept where it stands by the default constraint
const besideConstraintOf = (session, placement) => (session.catalog.constraintTypeByType.beside ? { constraint: { type: 'beside', side: placement.side, gap: placement.gap } } : {});

// ---------- a node of a kind of the registry ----------

// what the registry says of the node a tool makes. Which sizes a box gives it is read from its
// kind, never from its name: its width unless the kind is as wide as its words (isWidthFit), its
// height when the kind writes one (a node drawn to a size: its new node has a numeric height).
// A kind may say otherwise with create.sizeAxisList
function nodeFactsOf(create, session) {
	const kind = session.registry?.kindByType[create.kind];
	const entry = session.registry?.createEntryList.find(item => item.id === create.kind);
	if (!kind || !entry?.create) return null;
	const template = entry.create(prefix => prefix);
	const axisList = kind.create?.sizeAxisList ?? [...(kind.contract.isWidthFit ? [] : ['width']), ...(typeof template.size?.height === 'number' ? ['height'] : [])];
	return { kind, template, axisList, sizeDefault: session.nodeSizeWrittenOf({ ...template, size: { ...(template.size ?? {}), ...(create.size ?? {}) } }), sizeMin: { ...SIZE_MIN_DEFAULT, ...kind.contract.sizeMin } };
}

// the box a placement gives the node, and the size it writes (the dimensions a box decided)
function nodePlaceOf(facts, placement) {
	const size = { ...facts.sizeDefault };
	const sizeWritten = {};
	if (placement.kind === 'box') {
		for (const axis of facts.axisList) sizeWritten[axis] = size[axis] = Math.max(facts.sizeMin[axis], placement.rect[axis]);
		return { box: { x: placement.rect.x, y: placement.rect.y, ...size }, sizeWritten };
	}
	const corner = placement.kind === 'beside' ? besidePositionOf(placement.target.box, size, placement.side, placement.gap) : pointCornerOf(placement, size);
	return { box: { x: Math.round(corner.x), y: Math.round(corner.y), ...size }, sizeWritten };
}

export const creatorNode = {
	what: 'node',
	label: 'Node',
	// a node drawn to a size is made by dragging its size; one as high as its content by a click,
	// and takes a width from a box; one as wide as its words takes no box
	placementKindListGet(create, { session }) {
		const facts = nodeFactsOf(create, session);
		if (!facts) return [];
		return facts.axisList.length >= 2 ? ['box', 'point', 'beside'] : facts.axisList.length ? ['point', 'beside', 'box'] : ['point', 'beside'];
	},
	ghostOf(create, placement, { session }) {
		const facts = nodeFactsOf(create, session);
		if (!facts) return null;
		const { box } = nodePlaceOf(facts, placement);
		return { boxList: [box, ...(placement.kind === 'beside' ? [{ ...placement.target.box, isMark: true }] : [])], text: placement.kind === 'box' ? `${Math.round(box.width)} × ${Math.round(box.height)}` : '' };
	},
	place(create, placement, { session, target }) {
		const facts = nodeFactsOf(create, session);
		if (!facts) { session.store.message = `This diagram has no ${create.kind} to add.`; return null; }
		const { box, sizeWritten } = nodePlaceOf(facts, placement);
		const place = { position: { x: box.x, y: box.y }, size: sizeWritten };
		// beside a member: under it, following it; beside a free thing: where that puts it, and free
		if (placement.kind === 'beside') return placement.target.memberId ? session.nodeCreate(create, place, { groupId: placement.target.groupId, parentId: placement.target.memberId }, besideConstraintOf(session, placement)) : session.nodeCreate(create, place, null);
		return session.nodeCreate(create, place, target);
	},
	paramSectionListGet(create, write, { session }) {
		const facts = nodeFactsOf(create, session);
		if (!facts) return [{ id: 'node', label: 'Makes', propertyList: [], actionList: [], note: `This diagram has no ${create.kind} to add.` }];
		const data = { ...(facts.template.data ?? {}), ...(create.data ?? {}) };
		const dataSet = (id, value) => write({ ...create, data: { ...(create.data ?? {}), [id]: value } });
		const sizeSet = (axis, value) => {
			const number = Number(value);
			const size = { ...(create.size ?? {}) };
			if (Number.isFinite(number) && number > 0) size[axis] = Math.round(number); else delete size[axis];
			const { size: _size, ...rest } = create;
			return write(Object.keys(size).length ? { ...rest, size } : rest);
		};
		return [{
			id: 'node', label: `Makes: ${facts.kind.label.toLowerCase()}`, actionList: [], note: 'What it makes starts with these; each is changed afterwards where it stands. A size of 0 is its own.',
			propertyList: [
				...(facts.kind.contract.propertyList ?? []).filter(definition => !definition.kind || definition.kind === 'text').map(definition => ({ id: definition.id, label: definition.label, kind: 'text', value: String(data[definition.id] ?? ''), isMultiline: definition.isMultiline, set: value => dataSet(definition.id, value) })),
				...(typeof data.tone === 'string' ? [{ id: 'tone', label: 'Tone', kind: 'enum', value: data.tone, values: TONE_LIST, valueLabels: Object.fromEntries(TONE_LIST.map(tone => [tone, tone[0].toUpperCase() + tone.slice(1)])), set: value => dataSet('tone', value) }] : []),
				{ id: 'width', label: 'Width', kind: 'number', value: create.size?.width ?? 0, step: 10, min: 0, set: value => sizeSet('width', value) },
				{ id: 'height', label: 'Height', kind: 'number', value: create.size?.height ?? 0, step: 10, min: 0, set: value => sizeSet('height', value) },
			],
		}];
	},
};

// ---------- a layout member ----------

// the layout a placement gives: a line dragged says which way a layout with a direction runs
function layoutOfPlacement(layoutType, layout, placement) {
	if (placement.kind !== 'segment' || !layoutType.propertyList.some(definition => definition.id === 'direction')) return layout;
	return { ...layout, direction: Math.abs(placement.to.x - placement.from.x) >= Math.abs(placement.to.y - placement.from.y) ? 'row' : 'column' };
}

const layoutCornerOf = placement => (placement.kind === 'segment' ? placement.from : placement.kind === 'beside' ? besidePositionOf(placement.target.box, LAYOUT_GHOST_SIZE, placement.side, placement.gap) : pointCornerOf(placement, LAYOUT_GHOST_SIZE));

export const creatorLayout = {
	what: 'layout',
	label: 'Layout',
	placementKindListGet: (create, { session }) => (session.catalog.layoutTypeByType[create.layout?.type] ? ['point', 'segment', 'beside'] : []),
	ghostOf(create, placement) {
		const corner = layoutCornerOf(placement);
		// a layout holds nothing yet: the frame of an empty one, and for a line dragged the way it runs
		return {
			boxList: [{ x: corner.x, y: corner.y, ...LAYOUT_GHOST_SIZE }, ...(placement.kind === 'beside' ? [{ ...placement.target.box, isMark: true }] : [])],
			lineList: placement.kind === 'segment' ? [{ from: placement.from, to: placement.to }] : [],
		};
	},
	place(create, placement, { session, target }) {
		const layoutType = session.catalog.layoutTypeByType[create.layout?.type];
		if (!layoutType) { session.store.message = `Unknown layout type ${create.layout?.type}.`; return null; }
		const layout = layoutOfPlacement(layoutType, create.layout, placement);
		const corner = layoutCornerOf(placement);
		if (placement.kind === 'beside' && placement.target.memberId) return session.layoutCreate(layout, corner, { groupId: placement.target.groupId, parentId: placement.target.memberId }, { ...besideConstraintOf(session, placement), childList: create.childList });
		return session.layoutCreate(layout, corner, target, { childList: create.childList });
	},
	paramSectionListGet(create, write, { session }) {
		const layoutType = session.catalog.layoutTypeByType[create.layout?.type];
		if (!layoutType) return [];
		const layout = layoutType.read({ ...layoutType.paramDefault, ...create.layout }, 'layout');
		return [{
			id: 'layout', label: `Makes: ${layoutType.label.toLowerCase()}`, actionList: [],
			propertyList: layoutType.propertyList.filter(definition => definition.kind !== 'referencePoint').map((definition) => {
				const set = value => write({ ...create, layout: { ...create.layout, [definition.id]: value } });
				if (definition.kind === 'enum') return { id: definition.id, label: definition.label, kind: 'enum', value: String(layout[definition.id]), values: definition.values.map(String), valueLabels: Object.fromEntries(definition.values.map(item => [String(item), definition.valueLabels?.[item] ?? String(item)])), set: next => set(definition.values.find(item => String(item) === next)) };
				return { id: definition.id, label: definition.label, kind: 'number', value: layout[definition.id], step: definition.step, min: definition.min, max: definition.max, set: (next) => { const number = Number(next); return Number.isFinite(number) && set(number); } };
			}),
		}];
	},
};

// ---------- a parametric group ----------

const boxIsInside = (box, rect) => box.x >= rect.x && box.y >= rect.y && box.x + box.width <= rect.x + rect.width && box.y + box.height <= rect.y + rect.height;

export const creatorGroup = {
	what: 'group',
	label: 'Group',
	placementKindListGet: () => ['point', 'box'],
	// a box dragged out takes in the free elements that lie inside it
	ghostOf(create, placement, { session }) {
		if (placement.kind === 'point') return { boxList: [{ x: placement.point.x - 8, y: placement.point.y - 8, width: 16, height: 16 }] };
		const insideList = session.nodeFreeBoxList.filter(item => boxIsInside(item.box, placement.rect));
		return { boxList: [placement.rect, ...insideList.map(item => ({ ...item.box, isMark: true }))], text: insideList.length ? `${insideList.length} ${insideList.length === 1 ? 'element' : 'elements'} join` : 'no free element inside' };
	},
	place(create, placement, { session }) {
		if (placement.kind === 'point') return session.groupAdd(placement.point);
		return session.groupAdd({ x: placement.rect.x, y: placement.rect.y }, { nodeIdList: session.nodeFreeBoxList.filter(item => boxIsInside(item.box, placement.rect)).map(item => item.nodeId) });
	},
	paramSectionListGet: () => [],
};

// ---------- a line ----------

export const creatorConnection = {
	what: 'connection',
	label: 'Line',
	placementKindListGet: () => ['segment', 'point'],
	ghostOf(create, placement) {
		return { lineList: [placement.kind === 'segment' ? { from: placement.from, to: placement.to } : { from: placement.point, to: { x: placement.point.x + 160, y: placement.point.y } }] };
	},
	// a line dragged joins the handles its two ends are at, where they take it; else its ends are free
	place(create, placement, { session }) {
		if (placement.kind === 'segment') return session.connectionCreateBetween(placement.from, placement.to);
		return session.store.connectionCreateDangling(placement.point);
	},
	paramSectionListGet: () => [],
};

export const creatorListDefault = [creatorNode, creatorLayout, creatorGroup, creatorConnection];
