import { Boxes, Table2 } from '../../../../main/frontend/UICommon.js';
import { nodeRegistryBuild } from './node-registry.js';
import { tableCardNormalize, tableCardAnchorListGet } from './TableCardData.js';
import { tableCardSchema } from './TableCardSchema.js';
import { TableCard } from './TableCard.jsx';
import { OperatorCard } from './OperatorCard.jsx';
import { CardBrief, CardNote } from './CompactCard.jsx';

// The node kinds of the base series (card-diagram-impl.md#node-registries): a
// generic table card with authored fields and rows, without any limit on
// their number, and an operator, a step with a label and a note. Every
// series may add them to its own registry; CardDiagram offers them alone.
const sideAllList = ['left', 'right', 'top', 'bottom'];

export const tableNodeKind = {
	type: 'table',
	label: 'Table',
	contract: { dataNormalize: tableCardNormalize, anchorListGet: tableCardAnchorListGet, sizeDefault: { width: 360, height: 240 } },
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

export const cardDiagramNodeKindList = [tableNodeKind, operatorNodeKind, cardNoteNodeKind, cardBriefNodeKind];

export const cardDiagramNodeRegistry = nodeRegistryBuild({ id: 'card-diagram', label: 'Card diagram', kindList: cardDiagramNodeKindList });
