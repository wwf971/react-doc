import { Boxes, SquareDashedMousePointer, Table2 } from '../../../../main/frontend/UICommon.js';
import { nodeRegistryBuild } from './node-registry.js';
import { tableCardNormalize, tableCardAnchorListGet } from './TableCardData.js';
import { tableCardSchema } from './TableCardSchema.js';
import { TableCard } from './TableCard.jsx';
import { OperatorCard } from './OperatorCard.jsx';
import { CardBrief, CardDatabase, CardNote, CardThreeDots } from './CompactCard.jsx';
import { CardCaption, CardIcon } from './CardIcon.jsx';
import { cardIconAnchorListGet, cardIconAnchorRectEstimate, cardIconNormalize } from './CardIconData.js';
import { diagramArrangerOutline } from './DiagramArrangeOutline.js';
import { SceneBoxCard } from './SceneBoxCard.jsx';
import { CardMatrix } from './CardMatrix.jsx';
import { cardMatrixNormalize, cardMatrixWidthGet } from './CardMatrixData.js';
import { ColorBlock, colorBlockNormalize } from './ColorBlock.jsx';

// The node kinds of the base series (card-diagram-impl.md#node-registries): a
// generic table card with authored fields and rows, without any limit on
// their number, and an operator, a step with a label and a note. Every
// series may add them to its own registry; CardDiagram offers them alone.
const sideAllList = ['left', 'right', 'top', 'bottom'];

export const tableNodeKind = {
	type: 'table',
	label: 'Table',
	contract: { dataNormalize: tableCardNormalize, anchorListGet: tableCardAnchorListGet, anchorSideDrawn: 'header', sizeDefault: { width: 360, height: 240 } },
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
	contract: { anchorListGet: () => [{ id: 'body', sideList: sideAllList }], sizeDefault: { width: 220, height: 100 } },
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
const compactContract = (sizeDefault) => ({ anchorListGet: () => [{ id: 'body', sideList: sideAllList }], sizeDefault });

export const cardNoteNodeKind = {
	type: 'card-note',
	label: 'Note card',
	contract: compactContract({ width: 170, height: 48 }),
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
	contract: compactContract({ width: 170, height: 40 }),
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

// what is left out between two cards of a long series. written by a generator of
// views, not offered by the editor
export const cardThreeDotsNodeKind = {
	type: 'card-three-dots',
	label: 'Left out',
	contract: compactContract({ width: 170, height: 40 }),
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
	contract: { dataNormalize: cardIconNormalize, anchorListGet: cardIconAnchorListGet, anchorRectEstimate: cardIconAnchorRectEstimate, sizeDefault: { width: 180, height: 32 } },
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
	contract: compactContract({ width: 180, height: 16 }),
	schema: null,
	Card: CardCaption,
};

// rows and columns with headers, and a mark where they meet (CardMatrixData.js)
export const cardMatrixNodeKind = {
	type: 'card-matrix',
	label: 'Matrix',
	contract: { dataNormalize: cardMatrixNormalize, anchorListGet: () => [{ id: 'body', sideList: sideAllList }], sizeDefault: { width: 520, height: 240 } },
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

export const colorBlockNodeKind = {
	type: 'color-block',
	label: 'Color block',
	contract: { isBackground: true, dataNormalize: colorBlockNormalize, anchorListGet: () => [], sizeDefault: { width: 400, height: 300 }, sizeMin: { width: 80, height: 60 } },
	schema: null,
	Card: ColorBlock,
	create: {
		description: 'A light background rectangle with text and icons along the bottom.', icon: Boxes, keywordList: ['background', 'swimlane', 'group', 'area'],
		nodeCreate: idNext => ({ id: idNext('block'), renderer: { type: 'color-block' }, size: { width: 400, height: 300 }, data: { tone: 'blue', itemList: [{ id: 'label', text: 'Group', icon: 'boxes' }] }, handles: [] }),
	},
};

export const cardDiagramNodeKindList = [tableNodeKind, operatorNodeKind, cardNoteNodeKind, cardBriefNodeKind, cardThreeDotsNodeKind, cardDatabaseNodeKind, cardIconNodeKind, cardCaptionNodeKind, cardMatrixNodeKind, sceneBoxNodeKind, colorBlockNodeKind];

export const cardDiagramNodeRegistry = nodeRegistryBuild({ id: 'card-diagram', label: 'Card diagram', kindList: cardDiagramNodeKindList, arrangerList: [diagramArrangerOutline] });
