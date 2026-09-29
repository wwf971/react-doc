import { makeAutoObservable } from 'mobx';
import { arrowLaneWidthGet, arrowLayout, arrowNormalize } from './FileTreeOverlayArrow.js';

// annotation types of the file tree overlay. a type provides:
//   normalize(itemRaw, { index, styleShared, warn }) -> annotation
//     the annotation carries id, lane, text and endpointRefList [{ ref, role }]
//   laneWidthGet(annotation, labelSize) -> px
//   layout(annotation, { laneX, endpointList, rowGeometryGet, labelSize }) -> shape | null
// a new annotation type is added here, plus its renderer in FileTreeOverlay.jsx.
const overlayTypeById = {
	arrow: { normalize: arrowNormalize, laneWidthGet: arrowLaneWidthGet, layout: arrowLayout },
};

// right padding of the gutter, after the last lane.
const gutterPaddingEnd = 8;

// ui/data store of the annotation overlay of one FileTree instance.
// semantic input is read from FileTreeStore (nodes, open state, authored
// annotations). geometry is measured from the rendered tree by
// FileTreeOverlay.jsx and written back through geometrySet(); the layout is
// derived from both, so any change of data, open state, or size redraws it.
class FileTreeOverlayStore {
	treeStore = null;
	// { mainRight, rowByKey: { [key]: { nameRight, yCenter, height } },
	//   clipBottomByKey: { [folderKey]: y }, labelSizeById: { [id]: { width, height } } }
	geometry = null;

	constructor(treeStore) {
		this.treeStore = treeStore;
		makeAutoObservable(this, { treeStore: false }, { autoBind: true });
	}

	geometrySet(geometry) {
		if (JSON.stringify(geometry) === JSON.stringify(this.geometry)) return;
		this.geometry = geometry;
	}

	// node key -> { node, namePath, ancestorKeyList }; plus lookup by id and path.
	get nodeIndex() {
		const nodeInfoByKey = {};
		const keyByNodeId = {};
		const keyListByNamePath = {};
		const visit = (nodeList, namePathParent, ancestorKeyList) => {
			for (const node of nodeList) {
				const namePath = [...namePathParent, nameSegmentGet(node.name)];
				const namePathText = namePath.join('/');
				nodeInfoByKey[node.key] = { node, namePath: namePathText, ancestorKeyList };
				if (node.id) keyByNodeId[node.id] = node.key;
				keyListByNamePath[namePathText] = [...(keyListByNamePath[namePathText] ?? []), node.key];
				if (node.isFolder) visit(node.children, namePath, [...ancestorKeyList, node.key]);
			}
		};
		visit(this.treeStore.nodeList, [], []);
		return { nodeInfoByKey, keyByNodeId, keyListByNamePath };
	}

	// normalized annotations with endpoints resolved to node keys, and the
	// warnings found on the way. a broken annotation is skipped, the rest
	// still render.
	get annotationResult() {
		const annotationList = [];
		const warningList = [];
		const annotationListRaw = this.treeStore.annotationListRaw;
		if (!Array.isArray(annotationListRaw)) {
			return { annotationList, warningList: ['"annotations" must be a list.'] };
		}
		const styleSharedByType = mappingGet(this.treeStore.annotationStyleRaw);
		annotationListRaw.forEach((itemRaw, index) => {
			const where = `Annotation ${index + 1}`;
			const warn = (message) => warningList.push(`${where}: ${message}`);
			if (!itemRaw || typeof itemRaw !== 'object' || Array.isArray(itemRaw)) {
				warn('must be a mapping.');
				return;
			}
			const typeId = itemRaw.type ?? 'arrow';
			const overlayType = overlayTypeById[typeId];
			if (!overlayType) {
				warn(`unknown type "${typeId}". Known types: ${Object.keys(overlayTypeById).join(', ')}.`);
				return;
			}
			let annotation;
			try {
				annotation = overlayType.normalize(itemRaw, {
					index,
					styleShared: styleSharedByType[typeId],
					warn,
				});
			} catch (error) {
				warn(String(error?.message ?? error));
				return;
			}
			if (annotationList.some((annotationAdded) => annotationAdded.id === annotation.id)) {
				warn(`id "${annotation.id}" is used more than once.`);
				return;
			}
			const endpointList = [];
			for (const endpointRef of annotation.endpointRefList) {
				const nodeKey = this.nodeKeyResolve(endpointRef.ref, warn);
				if (nodeKey) endpointList.push({ role: endpointRef.role, nodeKey });
			}
			annotationList.push({ ...annotation, endpointList });
		});
		return { annotationList, warningList };
	}

	get annotationList() {
		return this.annotationResult.annotationList;
	}

	get warningList() {
		return this.annotationResult.warningList;
	}

	// a reference is a node id first; otherwise a name path such as
	// "main/comp-mdx/FileTree.jsx", where trailing "/" of names is ignored.
	nodeKeyResolve(ref, warn) {
		const { keyByNodeId, keyListByNamePath } = this.nodeIndex;
		if (keyByNodeId[ref]) return keyByNodeId[ref];
		const namePath = ref.split('/').filter(Boolean).join('/');
		const keyList = keyListByNamePath[namePath] ?? [];
		if (keyList.length === 1) return keyList[0];
		if (keyList.length > 1) {
			warn(`"${ref}" matches ${keyList.length} nodes; give the node an "id" and refer to it.`);
		} else {
			warn(`no node matches "${ref}".`);
		}
		return '';
	}

	// the row that shows a node: the node itself, or its outermost collapsed
	// ancestor folder when the node is hidden.
	rowVisibleGet(nodeKey) {
		const { ancestorKeyList } = this.nodeIndex.nodeInfoByKey[nodeKey];
		for (const ancestorKey of ancestorKeyList) {
			if (!this.treeStore.folderIsOpen(ancestorKey)) return { rowKey: ancestorKey, isCollapsed: true };
		}
		return { rowKey: nodeKey, isCollapsed: false };
	}

	// row geometry, with its center kept inside every ancestor's children clip.
	// while a folder is opening, its children are still partly clipped, and
	// the arrow follows the growing clip edge instead of pointing at a row
	// that cannot be seen yet.
	rowGeometryGet(rowKey) {
		const row = this.geometry?.rowByKey[rowKey];
		if (!row) return null;
		let yCenter = row.yCenter;
		for (const ancestorKey of this.nodeIndex.nodeInfoByKey[rowKey].ancestorKeyList) {
			const clipBottom = this.geometry.clipBottomByKey[ancestorKey];
			if (clipBottom !== undefined) yCenter = Math.min(yCenter, clipBottom - 1);
		}
		return { ...row, yCenter };
	}

	// lane number -> width. annotations with the same lane share one vertical
	// track; the lane is as wide as its widest annotation.
	get laneList() {
		const widthByLane = new Map();
		for (const annotation of this.annotationList) {
			const labelSize = this.geometry?.labelSizeById[annotation.id];
			const width = overlayTypeById[annotation.type].laneWidthGet(annotation, labelSize);
			widthByLane.set(annotation.lane, Math.max(widthByLane.get(annotation.lane) ?? 0, width));
		}
		const laneNumberList = [...widthByLane.keys()].sort((laneA, laneB) => laneA - laneB);
		let offset = 0;
		return laneNumberList.map((lane) => {
			const laneItem = { lane, offset, width: widthByLane.get(lane) };
			offset += laneItem.width;
			return laneItem;
		});
	}

	// width of the gutter column that FileTree reserves between the name
	// column and the description column.
	get gutterWidth() {
		if (this.annotationList.length === 0) return 0;
		const laneLast = this.laneList[this.laneList.length - 1];
		return laneLast.offset + laneLast.width + gutterPaddingEnd;
	}

	// size of the drawing surface: the name column plus the gutter, down to the
	// last row. it is derived from row geometry rather than the scroll size of
	// the tree, so the surface can never enlarge the tree it measures.
	get canvasSize() {
		if (!this.geometry) return { width: 0, height: 0 };
		let height = 0;
		for (const row of Object.values(this.geometry.rowByKey)) {
			height = Math.max(height, row.yCenter + row.height);
		}
		return { width: Math.ceil(this.geometry.mainRight + this.gutterWidth), height: Math.ceil(height) };
	}

	// [{ annotation, shape }] for rendering; shape is null until the geometry
	// is measured or when an endpoint row cannot be measured.
	get shapeList() {
		const laneByNumber = new Map(this.laneList.map((laneItem) => [laneItem.lane, laneItem]));
		return this.annotationList.map((annotation) => {
			if (!this.geometry) return { annotation, shape: null };
			const laneItem = laneByNumber.get(annotation.lane);
			const endpointList = annotation.endpointList.map((endpoint) => ({
				role: endpoint.role,
				...this.rowVisibleGet(endpoint.nodeKey),
			}));
			const shape = overlayTypeById[annotation.type].layout(annotation, {
				laneX: this.geometry.mainRight + laneItem.offset + annotation.style.laneSpacing,
				endpointList,
				rowGeometryGet: this.rowGeometryGet,
				labelSize: this.geometry.labelSizeById[annotation.id],
			});
			return { annotation, shape };
		});
	}
}

function nameSegmentGet(name) {
	return name.replace(/\/+$/, '');
}

function mappingGet(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return value;
}

export { FileTreeOverlayStore };
