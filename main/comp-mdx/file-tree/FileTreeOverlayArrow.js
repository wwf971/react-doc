// "arrow" annotation type of the file tree overlay: a right-angled connector
// from one or more source nodes to one or more destination nodes.
//
//   source a ──╮
//              │ text
//   source b ──┤
//              │
//   dest c  ◀──╯
//
// every endpoint has a horizontal branch from the end of its name to a
// vertical trunk. the trunk sits in its own lane inside the gutter column of
// the tree, and the text sits to the right of the trunk.
//
// this module is pure: it normalizes authored data and computes geometry from
// measured numbers. measuring and rendering live in FileTreeOverlay*.jsx.

// all lengths are px.
const arrowStyleDefault = {
	color: 'var(--color-fd-muted-foreground)',
	textColor: 'var(--color-fd-muted-foreground)',
	lineWidth: 1.25,
	lineStyle: 'solid',
	// branch style of an endpoint that is hidden inside a collapsed folder and
	// therefore drawn at that folder's row.
	lineStyleCollapsed: 'dashed',
	cornerRadius: 5,
	headShape: 'triangle',
	headSize: 3.5,
	tailShape: 'dot',
	// space between the end of a node name and the arrow end.
	gap: 6,
	// space between the gutter start (or the previous lane) and the trunk.
	laneSpacing: 14,
	textGap: 6,
	textMaxWidth: 160,
};

const arrowStyleSpecByKey = {
	color: { type: 'string' },
	textColor: { type: 'string' },
	lineWidth: { type: 'number' },
	lineStyle: { valueList: ['solid', 'dashed', 'dotted'] },
	lineStyleCollapsed: { valueList: ['solid', 'dashed', 'dotted'] },
	cornerRadius: { type: 'number' },
	headShape: { valueList: ['triangle', 'open', 'none'] },
	headSize: { type: 'number' },
	tailShape: { valueList: ['dot', 'none'] },
	gap: { type: 'number' },
	laneSpacing: { type: 'number' },
	textGap: { type: 'number' },
	textMaxWidth: { type: 'number' },
};

// authored form:
//   { type: arrow, id?, from, to, text?, lane?, style? }
// "from"/"to" is one node reference or a list. a node reference is a string,
// or { node: string } (the mapping form leaves room for per-endpoint options).
// returns the normalized annotation; problems that make the annotation
// unusable throw, minor problems are reported through warn().
function arrowNormalize(itemRaw, { index, styleShared, warn }) {
	const id = itemRaw.id === undefined ? `annotation-${index}` : String(itemRaw.id);
	const endpointRefList = [
		...endpointRefListNormalize(itemRaw.from, 'from'),
		...endpointRefListNormalize(itemRaw.to, 'to'),
	];
	if (!endpointRefList.some((endpointRef) => endpointRef.role === 'from')) {
		throw new Error('an arrow requires "from".');
	}
	if (!endpointRefList.some((endpointRef) => endpointRef.role === 'to')) {
		throw new Error('an arrow requires "to".');
	}
	let lane = index;
	if (itemRaw.lane !== undefined) {
		if (Number.isInteger(itemRaw.lane) && itemRaw.lane >= 0) {
			lane = itemRaw.lane;
		} else {
			warn(`"lane" must be a non-negative integer, got ${JSON.stringify(itemRaw.lane)}.`);
		}
	}
	const text = itemRaw.text === undefined || itemRaw.text === null ? '' : String(itemRaw.text);
	const style = {
		...arrowStyleDefault,
		...arrowStyleNormalize(styleShared, 'annotationStyle.arrow', warn),
		...arrowStyleNormalize(itemRaw.style, 'style', warn),
	};
	return { type: 'arrow', id, lane, text, style, endpointRefList };
}

function endpointRefListNormalize(value, role) {
	if (value === undefined || value === null) return [];
	const valueList = Array.isArray(value) ? value : [value];
	return valueList.map((valueItem) => {
		const ref = typeof valueItem === 'object' && valueItem !== null ? valueItem.node : valueItem;
		if (typeof ref !== 'string' || !ref.trim()) {
			throw new Error(`every "${role}" entry must be a node id, a name path, or { node }.`);
		}
		return { ref: ref.trim(), role };
	});
}

function arrowStyleNormalize(styleRaw, where, warn) {
	if (styleRaw === undefined || styleRaw === null) return {};
	if (typeof styleRaw !== 'object' || Array.isArray(styleRaw)) {
		warn(`"${where}" must be a mapping.`);
		return {};
	}
	const style = {};
	for (const [key, value] of Object.entries(styleRaw)) {
		const spec = arrowStyleSpecByKey[key];
		if (!spec) {
			warn(`unknown arrow style key "${where}.${key}".`);
			continue;
		}
		if (spec.valueList && !spec.valueList.includes(value)) {
			warn(`"${where}.${key}" must be one of ${spec.valueList.join(', ')}.`);
			continue;
		}
		if (spec.type === 'number' && !(typeof value === 'number' && value >= 0)) {
			warn(`"${where}.${key}" must be a non-negative number.`);
			continue;
		}
		if (spec.type === 'string' && (typeof value !== 'string' || !value.trim())) {
			warn(`"${where}.${key}" must be a non-empty string.`);
			continue;
		}
		style[key] = value;
	}
	return style;
}

// horizontal space this annotation needs inside its lane.
function arrowLaneWidthGet(annotation, labelSize) {
	const { style } = annotation;
	if (!annotation.text) return style.laneSpacing;
	return style.laneSpacing + style.textGap + (labelSize?.width ?? 0);
}

// endpointList: [{ role, rowKey, isCollapsed }], already mapped to the row
// that is actually visible. rowGeometryGet(rowKey) returns
// { nameRight, yCenter, height } in overlay coordinates, or null.
// returns null when the arrow cannot be drawn (for example a missing row).
function arrowLayout(annotation, { laneX, endpointList, rowGeometryGet, labelSize }) {
	const { style } = annotation;
	const pointList = endpointPointListGet(endpointList, rowGeometryGet, style);
	if (!pointList) return null;
	pointList.sort((pointA, pointB) => pointA.y - pointB.y);
	const yTop = pointList[0].y;
	const yBottom = pointList[pointList.length - 1].y;
	const radius = Math.min(style.cornerRadius, (yBottom - yTop) / 2);
	const headLength = style.headSize * 1.6;

	const branchList = pointList.map((point, pointIndex) => {
		let xStart = point.x;
		if (point.role === 'to' && style.headShape === 'triangle') xStart = point.x + headLength - 0.5;
		let path = `M ${xStart} ${point.y} `;
		if (pointIndex === 0) {
			path += `H ${laneX - radius} Q ${laneX} ${point.y} ${laneX} ${point.y + radius}`;
		} else if (pointIndex === pointList.length - 1) {
			path += `H ${laneX - radius} Q ${laneX} ${point.y} ${laneX} ${point.y - radius}`;
		} else {
			path += `H ${laneX}`;
		}
		return {
			key: `${point.rowKey}|${point.role}`,
			path,
			lineStyle: point.isCollapsed ? style.lineStyleCollapsed : style.lineStyle,
			marker: markerGet(point, style, headLength),
		};
	});

	const trunkPath = yBottom - yTop > radius * 2
		? `M ${laneX} ${yTop + radius} V ${yBottom - radius}`
		: '';
	// an arrow collapsed into one row is only a small loop; its text would
	// cover the branches of other arrows on that row, so the text is hidden.
	const isOneRow = pointList.every((point) => point.rowKey === pointList[0].rowKey);
	const labelHeight = labelSize?.height ?? 0;
	const label = annotation.text && !isOneRow
		? { x: laneX + style.textGap, y: (yTop + yBottom) / 2 - labelHeight / 2 }
		: null;
	return { branchList, trunkPath, label };
}

// several endpoints can land on the same visible row, for example two files
// inside one collapsed folder. endpoints with the same row and role become one
// point. when one row is both a source and a destination, the source branch
// moves slightly up and the destination branch slightly down, so a fully
// collapsed arrow still reads as a small loop leaving and entering that row.
function endpointPointListGet(endpointList, rowGeometryGet, style) {
	const pointByKey = new Map();
	for (const endpoint of endpointList) {
		const key = `${endpoint.rowKey}|${endpoint.role}`;
		const point = pointByKey.get(key);
		if (point) {
			point.isCollapsed = point.isCollapsed || endpoint.isCollapsed;
			continue;
		}
		pointByKey.set(key, { ...endpoint });
	}
	const pointList = [];
	for (const point of pointByKey.values()) {
		const row = rowGeometryGet(point.rowKey);
		if (!row) return null;
		const isRowBothRoles = pointByKey.has(`${point.rowKey}|from`) && pointByKey.has(`${point.rowKey}|to`);
		const yOffset = isRowBothRoles ? Math.min(row.height * 0.25, 5) : 0;
		pointList.push({
			...point,
			x: row.nameRight + style.gap,
			y: point.role === 'from' ? row.yCenter - yOffset : row.yCenter + yOffset,
		});
	}
	if (pointList.length < 2) return null;
	return pointList;
}

// a hollow marker means "the real endpoint is inside this collapsed folder".
function markerGet(point, style, headLength) {
	const isHollow = point.isCollapsed;
	if (point.role === 'to') {
		if (style.headShape === 'none') return null;
		const pointListText = [
			`${point.x + headLength},${point.y - style.headSize}`,
			`${point.x},${point.y}`,
			`${point.x + headLength},${point.y + style.headSize}`,
		].join(' ');
		if (style.headShape === 'open') return { kind: 'polyline', points: pointListText, isHollow: true };
		return { kind: 'polygon', points: pointListText, isHollow };
	}
	if (style.tailShape === 'none') return null;
	const radius = Math.max(style.lineWidth * 1.4, 2);
	return { kind: 'circle', cx: point.x + radius, cy: point.y, r: radius, isHollow };
}

export { arrowLaneWidthGet, arrowLayout, arrowNormalize, arrowStyleDefault };
