import { Boxes, SquareDashedMousePointer, Table2 } from '../../../../main/frontend/UICommon.js';
import { nodeRegistryBuild } from './node-registry.js';
import { cardNoteHeightEstimate, tableCardNormalize, tableCardAnchorListGet } from './TableCardData.js';
import { tableCardSchema } from './TableCardSchema.js';
import { TableCard } from './TableCard.jsx';
import { OperatorCard } from './OperatorCard.jsx';
import { CardBrief, CardDatabase, CardLabel, CardNote, CardThreeDots } from './CompactCard.jsx';
import { CardCaption, CardIcon } from './CardIcon.jsx';
import { cardIconAnchorListGet, cardIconAnchorRectEstimate, cardIconNormalize, cardIconSearchMatch } from './CardIconData.js';
import { diagramArrangerOutline } from './DiagramArrangeOutline.js';
import { diagramArrangerBlocks } from './DiagramArrangeBlocks.js';
import { diagramArrangerScatter } from './DiagramArrangeScatter.js';
import { diagramArrangerLanesAcross, diagramArrangerLanesDown, diagramArrangerLayers } from './DiagramArrangeLayers.js';
import { SceneBoxCard } from './SceneBoxCard.jsx';
import { CardMatrix } from './CardMatrix.jsx';
import { cardMatrixNormalize, cardMatrixWidthGet } from './CardMatrixData.js';
import { ColorBlock, colorBlockNormalize, colorBlockSearchMatch } from './ColorBlock.jsx';
import { cardIconTextBuild } from './CardIconTokenData.js';
import { CardIndex } from './CardIndex.jsx';
import { cardIndexHeightGet, cardIndexNormalize, cardIndexSearchMatch, cardIndexWidthGet } from './CardIndexData.js';
import { CardLegend } from './CardLegend.jsx';
import { cardLegendHeightGet, cardLegendNormalize } from './CardLegendData.js';
import { CardGraph } from './CardGraph.jsx';
import { cardGraphNormalize, cardGraphSearchMatch, cardGraphSizeGet } from './CardGraphData.js';
import { parametricCanvasFeature } from '../card-diagram-parametric-canvas/ParametricFeature.jsx';
import { CardComp } from './CardComp.jsx';
import { CARD_COMP_SIZE_MODE_LIST, CARD_COMP_TYPE, cardCompNodeCreate, cardCompNormalize, cardCompSectionListBuild } from './CardCompData.js';

// The node kinds of the base series (card-diagram-impl.md#node-registries): a
// generic table card with authored fields and rows, without any limit on
// their number, and an operator, a step with a label and a note. Every
// series may add them to its own registry; CardDiagram offers them alone.
const sideAllList = ['left', 'right', 'top', 'bottom'];

export const tableNodeKind = {
	type: 'table',
	label: 'Table',
	contract: {
		dataNormalize: tableCardNormalize, anchorListGet: tableCardAnchorListGet, anchorSideDrawn: 'header', sizeDefault: { width: 360, height: 240 },
	},
	schema: tableCardSchema,
	Card: TableCard,
	create: {
		description: 'A titled card with rows and columns of your own.', icon: Table2, keywordList: ['generic', 'grid', 'rows'],
		nodeCreate: idNext => ({ id: idNext('table'), renderer: { type: 'table' }, data: { name: 'Table', fields: [{ id: 'name', label: 'Name' }, { id: 'value', label: 'Value' }], rows: [{ id: 'row-1', name: 'Row', value: '' }] }, handles: [] }),
	},
};

export const operatorNodeKind = {
	type: 'operator',
	label: 'Operator',
	contract: { anchorListGet: () => [{ id: 'body', sideList: sideAllList }], sizeDefault: { width: 220, height: 100 }, styleList: ['fill'] },
	schema: null,
	Card: OperatorCard,
	create: {
		description: 'A step with a label and a note.', icon: Boxes, keywordList: ['step', 'process'],
		nodeCreate: idNext => ({ id: idNext('step'), renderer: { type: 'operator' }, data: { label: 'Step', description: '' }, handles: [
			{ id: 'in', direction: 'in', anchor: { side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { side: 'right' } },
		] }),
	},
};

// two compact cards, for what is mostly read at a glance: a note (a title, a line
// of text, small figures, a tone), and a brief pill (an icon, a title, a line of
// figures). neither has rows: a line joins the body of the card
// (their body takes a fill: DiagramNodeStyle.js; what a generator writes takes no resize handles)
const compactContract = (sizeDefault, styleList = ['fill'], extra = {}) => ({ anchorListGet: () => [{ id: 'body', sideList: sideAllList }], sizeDefault, styleList, ...extra });

export const cardNoteNodeKind = {
	type: 'card-note',
	label: 'Note card',
	contract: { ...compactContract({ width: 170, height: 48 }), sizeEstimate: (node) => ({ height: cardNoteHeightEstimate(node) }), propertyList: [{ id: 'title', label: 'Title', kind: 'text' }, { id: 'text', label: 'Text', kind: 'text', isMultiline: true }] },
	schema: null,
	Card: CardNote,
	create: {
		description: 'A compact card: a title, a line of text, small figures, a tone.', icon: Boxes, keywordList: ['compact', 'status', 'note'],
		nodeCreate: idNext => ({ id: idNext('note'), renderer: { type: 'card-note' }, data: { title: 'Note', text: '', tone: 'slate' }, handles: [
			{ id: 'in', direction: 'in', anchor: { side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { side: 'right' } },
		] }),
	},
};

export const cardBriefNodeKind = {
	type: 'card-brief',
	label: 'Brief card',
	contract: { ...compactContract({ width: 170, height: 40 }), propertyList: [{ id: 'title', label: 'Title', kind: 'text' }] },
	schema: null,
	Card: CardBrief,
	create: {
		description: 'A pill: an icon, a title, a line of figures.', icon: Boxes, keywordList: ['compact', 'pill', 'brief'],
		nodeCreate: idNext => ({ id: idNext('brief'), renderer: { type: 'card-brief' }, data: { title: 'Brief', icon: 'boxes', tone: 'teal' }, handles: [
			{ id: 'in', direction: 'in', anchor: { side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { side: 'right' } },
		] }),
	},
};

// a label: a pill as wide as its words (an icon, a few words), standing for something that has
// no card of its own. It may carry settings: the properties its data declares (propertyList,
// TableCardSchema.js: nodePropertyListGet), their values beside them in its data. A click on it
// in the editor opens them in the edit card, beside the label (card-diagram-impl.md#labels)
export const cardLabelNodeKind = {
	type: 'card-label',
	label: 'Label',
	contract: { ...compactContract({ width: 120, height: 28 }), isWidthFit: true, propertyList: [{ id: 'title', label: 'Words', kind: 'text' }] },
	schema: null,
	Card: CardLabel,
	create: {
		description: 'A pill as wide as its words: an icon and a few words. It may carry settings, edited beside it.', icon: Boxes, keywordList: ['label', 'pill', 'settings', 'tag'],
		nodeCreate: idNext => ({ id: idNext('label'), renderer: { type: 'card-label' }, data: { title: 'Label', icon: 'settings', tone: 'slate' }, handles: [] }),
	},
};

// what is left out between two cards of a long series. written by a generator of
// views, not offered by the editor
export const cardThreeDotsNodeKind = {
	type: 'card-three-dots',
	label: 'Left out',
	contract: compactContract({ width: 170, height: 40 }, [], { resizeAxisList: [] }),
	schema: null,
	Card: CardThreeDots,
};

// a cylinder with its name inside: a database as someone would sketch it
export const cardDatabaseNodeKind = {
	type: 'card-database',
	label: 'Database',
	contract: compactContract({ width: 320, height: 260 }),
	schema: null,
	Card: CardDatabase,
	create: {
		description: 'A cylinder with the name of a database inside.', icon: Boxes, keywordList: ['database', 'cylinder', 'storage', 'icon'],
		nodeCreate: idNext => ({ id: idNext('database'), renderer: { type: 'card-database' }, size: { width: 320, height: 260 }, data: { title: 'Database', tone: 'blue' }, handles: [
			{ id: 'in', direction: 'in', anchor: { side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { side: 'right' } },
		] }),
	},
};

// something among many: a round mark with its words beside it (CardIcon.jsx). a line of a
// graph ends on the mark (the anchor `icon`); an arranger asks where that is (anchorRectEstimate)
export const cardIconNodeKind = {
	type: 'card-icon',
	label: 'Icon',
	contract: { dataNormalize: cardIconNormalize, anchorListGet: cardIconAnchorListGet, anchorRectEstimate: cardIconAnchorRectEstimate, searchMatch: cardIconSearchMatch, sizeDefault: { width: 180, height: 32 }, styleList: ['fill'], resizeAxisList: ['width'] },
	schema: null,
	Card: CardIcon,
	create: {
		description: 'A small round icon with its name beside it: a thing among many, in a graph.', icon: Boxes, keywordList: ['icon', 'graph', 'node', 'circle', 'resource'],
		nodeCreate: idNext => ({ id: idNext('icon'), renderer: { type: 'card-icon' }, size: { width: 180, height: 32 }, data: { title: 'Thing', icon: 'boxes', tone: 'slate' }, handles: [
			{ id: 'in', direction: 'in', anchor: { target: 'icon', side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { target: 'icon', side: 'bottom' } },
		] }),
	},
};

// a few words over a group of nodes. written by a generator, not offered by the editor
export const cardCaptionNodeKind = {
	type: 'card-caption',
	label: 'Caption',
	contract: compactContract({ width: 180, height: 16 }, [], { resizeAxisList: [] }),
	schema: null,
	Card: CardCaption,
};

// rows and columns with headers, and a mark where they meet (CardMatrixData.js)
export const cardMatrixNodeKind = {
	type: 'card-matrix',
	label: 'Matrix',
	contract: { dataNormalize: cardMatrixNormalize, anchorListGet: () => [{ id: 'body', sideList: sideAllList }], sizeDefault: { width: 520, height: 240 }, styleList: ['fill'], resizeAxisList: [] },
	schema: null,
	Card: CardMatrix,
	create: {
		description: 'Rows and columns with headers, and a mark where they meet.', icon: Table2, keywordList: ['matrix', 'grid', 'relationship', 'cross'],
		nodeCreate: (idNext) => {
			const data = { title: 'Matrix', rowList: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], columnList: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], cellList: [{ row: 'b', column: 'a' }], isDiagonalMarked: true };
			return { id: idNext('matrix'), renderer: { type: 'card-matrix' }, size: { width: cardMatrixWidthGet(data), height: 'auto' }, data, handles: [] };
		},
	},
};

// the bounding box of a scene (card-diagram-flexible-switch.md#the-bounding-box): the
// part of the diagram a camera shows by default, and an embedding of the scene shows.
// a red frame an author places and resizes; it never appears in a picture, and in
// reading mode it is drawn only while the box is being adjusted
export const sceneBoxNodeKind = {
	type: 'scene-box',
	label: 'Bounding box',
	contract: {
		anchorListGet: () => [{ id: 'body', sideList: sideAllList }],
		sizeDefault: { width: 480, height: 320 },
		sizeMin: { width: 40, height: 40 },
	},
	schema: null,
	Card: SceneBoxCard,
	create: {
		description: 'The part of this diagram shown by default, and when it is embedded.', icon: SquareDashedMousePointer, keywordList: ['bounding', 'frame', 'viewport', 'embed', 'region'],
		nodeCreate: idNext => ({ id: idNext('scene-box'), renderer: { type: 'scene-box' }, size: { width: 480, height: 320 }, data: {}, handles: [] }),
	},
};

// a light rectangle behind cards with labels (ColorBlock.jsx): the words of a label are typed where
// they stand, an icon among them as a token ({{icon:boxes}} Group); its look is set in the edit card:
// its tone, and the style of its node, a fill (none: a frame) and an edge
const colorBlockToneList = ['slate', 'blue', 'teal', 'green', 'amber', 'red', 'violet'];
export const colorBlockNodeKind = {
	type: 'color-block',
	label: 'Color block',
	contract: {
		isBackground: true, dataNormalize: colorBlockNormalize, anchorListGet: () => [], sizeDefault: { width: 400, height: 300 }, sizeMin: { width: 80, height: 60 },
		searchMatch: colorBlockSearchMatch, styleList: ['fill', 'stroke'],
		propertyList: [
			{ id: 'tone', label: 'Tone', kind: 'enum', valueDefault: 'slate', values: colorBlockToneList, valueLabels: Object.fromEntries(colorBlockToneList.map(tone => [tone, tone[0].toUpperCase() + tone.slice(1)])) },
			{ id: 'labelSide', label: 'Labels', kind: 'enum', valueDefault: 'bottom', values: ['bottom', 'top'], valueLabels: { bottom: 'At the bottom', top: 'At the top' } },
		],
	},
	schema: null,
	Card: ColorBlock,
	create: {
		description: 'A light background rectangle with text and icons along the bottom.', icon: Boxes, keywordList: ['background', 'swimlane', 'group', 'area'],
		nodeCreate: idNext => ({ id: idNext('block'), renderer: { type: 'color-block' }, size: { width: 400, height: 300 }, data: { tone: 'blue', itemList: [{ id: 'label', text: cardIconTextBuild('boxes', 'Group') }] }, handles: [] }),
	},
};

// many things as small cards of their names in a grid, each opening what it stands for
// (CardIndexData.js). written by a generator of views, not offered by the editor
export const cardIndexNodeKind = {
	type: 'card-index',
	label: 'Index',
	contract: {
		dataNormalize: cardIndexNormalize, anchorListGet: () => [{ id: 'body', sideList: sideAllList }], searchMatch: cardIndexSearchMatch, resizeAxisList: [],
		sizeDefault: { width: 800, height: 400 }, sizeEstimate: (node) => ({ width: cardIndexWidthGet(node.data), height: cardIndexHeightGet(node.data) }),
	},
	schema: null,
	Card: CardIndex,
};

// what the looks of a diagram stand for: cards and lines, with words (CardLegendData.js).
// written by a generator of views, not offered by the editor; usually pinned to a corner of the
// viewport (node.pin)
export const cardLegendNodeKind = {
	type: 'card-legend',
	label: 'Legend',
	contract: { dataNormalize: cardLegendNormalize, anchorListGet: () => [], sizeDefault: { width: 240, height: 120 }, sizeEstimate: (node) => ({ height: cardLegendHeightGet(node.data) }), resizeAxisList: [] },
	schema: null,
	Card: CardLegend,
};

// many things and the lines between them in one card, each a square or a label (CardGraphData.js),
// for a graph too large for a node per thing. written by a generator of views, not offered by the editor
export const cardGraphNodeKind = {
	type: 'card-graph',
	label: 'Graph',
	contract: {
		dataNormalize: cardGraphNormalize, anchorListGet: () => [{ id: 'body', sideList: sideAllList }], searchMatch: cardGraphSearchMatch, resizeAxisList: [],
		sizeDefault: { width: 800, height: 600 }, sizeEstimate: (node) => cardGraphSizeGet(node.data),
	},
	schema: null,
	Card: CardGraph,
};

// a card holding one component of the page, or none yet (CardComp.jsx, CardCompData.js,
// card-diagram-impl.md#a-component-in-a-card): the component drawn and edited as in a document, its
// lang, raw and props written in the node. Its data as text is typed in its edit card
export const cardCompNodeKind = {
	type: CARD_COMP_TYPE,
	label: 'Component',
	contract: {
		...compactContract({ width: 240, height: 64 }, []),
		// a card whose width is auto is as wide as what its component draws: its own size, a height
		// alone, a block in a view drawing a tile (the icon of a code block) (CardCompData.js)
		isWidthFit: true,
		// its own size, or a width, a height or both given, what is beyond scrolling; the handles
		// resize what its mode gives (DiagramNodeResize.js)
		sizeModeList: CARD_COMP_SIZE_MODE_LIST,
		dataNormalize: cardCompNormalize,
		// no words of its own (a label, a description): the component says what it is
		propertyList: [],
		// found by the name of its component and the words of its data
		searchMatch: (node, helper) => ([node.data?.comp, node.data?.raw].some(value => helper.test(value)) ? { partList: [], childList: [], isWhole: true } : null),
		// its values one by one, when its component offers them, and its data as text (CardCompData.js);
		// the definition of its component is the page's, asked of the editor
		cardSectionListGet: ({ nodeId, node, store, editor, change }) => cardCompSectionListBuild({ nodeId, node, store, change, definition: node.data?.comp ? editor?.compDefinitionGet?.(node.data.comp) ?? null : null }),
	},
	schema: null,
	Card: CardComp,
	create: {
		description: 'A card holding one component of the page (a meeting, an image, …), drawn and edited as in a document.', icon: Boxes, keywordList: ['component', 'block', 'mdx', 'embed'],
		nodeCreate: idNext => cardCompNodeCreate(idNext),
	},
};

export const cardDiagramNodeKindList = [tableNodeKind, operatorNodeKind, cardNoteNodeKind, cardBriefNodeKind, cardLabelNodeKind, cardThreeDotsNodeKind, cardDatabaseNodeKind, cardIconNodeKind, cardCaptionNodeKind, cardMatrixNodeKind, sceneBoxNodeKind, colorBlockNodeKind, cardIndexNodeKind, cardLegendNodeKind, cardGraphNodeKind, cardCompNodeKind];

// the features of the diagrams of the base series: the parametric canvas (card-diagram-parametric-canvas.md).
// a series lists the ones its diagrams have in its own registry
export const cardDiagramFeatureList = [parametricCanvasFeature];

export const cardDiagramNodeRegistry = nodeRegistryBuild({ id: 'card-diagram', label: 'Card diagram', kindList: cardDiagramNodeKindList, arrangerList: [diagramArrangerOutline, diagramArrangerLayers, diagramArrangerLanesDown, diagramArrangerLanesAcross, diagramArrangerBlocks, diagramArrangerScatter], featureList: cardDiagramFeatureList });
