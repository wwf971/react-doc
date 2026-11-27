import { compHoldLetGo, compHoldTake, compHoldTakeReasonGet } from '../../../../main/comp-doc/registry/comp-expose.js';
import { CARD_COMP_TYPE, CARD_COMP_WIDTH, cardCompIsAssetRef, cardCompSlashNameOf } from './CardCompData.js';

// A card holding a component that holds others (card-diagram-impl.md#a-node-holding-others): the kind
// card-comp answers the contract of a holder (DiagramNodeTake.js) through the component registry of the
// page. Its component says what it takes and lets go (expose.hold:
// main/doc_page_impl_mdx_comp.md#a-component-holding-others); a card dropped on it is a block of a
// document, { comp, lang, raw, props }, what a card holding a component writes in its data. The engine
// and this file know no component: a weekly timetable taking a meeting is all the timetable's.

// the block a card holds, as a block of a document holds it; null for an empty card or data in an asset
// item (the reference: what a holder would hold is the data, not a reference to it)
export function cardCompBlockOf(node) {
	const data = node?.data ?? {};
	if (node?.renderer?.type !== CARD_COMP_TYPE || !data.comp || cardCompIsAssetRef(data)) return null;
	return { comp: data.comp, lang: data.lang ?? 'yaml', raw: String(data.raw ?? ''), ...(data.props && Object.keys(data.props).length ? { props: { ...data.props } } : {}) };
}

// the data of a card as its component reads it ({ raw, lang, ...props }: what expose.hold is given)
function compDataOf(node) {
	const data = node.data ?? {};
	return { raw: String(data.raw ?? ''), lang: data.lang ?? 'yaml', ...(data.props ?? {}) };
}

// what a holder is told besides the block: how to read the components of the page (the time of what
// it is given), and the preferences of a package, resolved as the card's component would be
function holdContextOf(editor) {
	return {
		compDefinitionGet: (name) => editor?.compDefinitionGet?.(name) ?? null,
		packageConfigGet: (name) => editor?.packageConfigGet?.(name) ?? {},
	};
}

// the holder's definition: a card holding a component that holds, else null
function holderDefinitionOf(holder, editor) {
	const data = holder?.data ?? {};
	if (holder?.renderer?.type !== CARD_COMP_TYPE || !data.comp || cardCompIsAssetRef(data)) return null;
	const definition = editor?.compDefinitionGet?.(data.comp) ?? null;
	return definition?.expose?.hold ? definition : null;
}

// contract.nodeTakeReasonGet of card-comp: undefined when its component holds nothing; else '' or why not
export function cardCompTakeReasonGet({ holder, dropped, editor }) {
	const definition = holderDefinitionOf(holder, editor);
	if (!definition) return undefined;
	const block = cardCompBlockOf(dropped);
	if (!block) return dropped?.renderer?.type === CARD_COMP_TYPE && dropped.data?.comp ? 'its data is in an asset item' : 'it holds the cards of components';
	return compHoldTakeReasonGet(definition, compDataOf(holder), block, holdContextOf(editor)) ?? undefined;
}

// contract.nodeTake of card-comp: the holder's data with the dropped card's block in it
export function cardCompTake({ holder, dropped, editor }) {
	const definition = holderDefinitionOf(holder, editor);
	const block = cardCompBlockOf(dropped);
	if (!definition || !block) throw new Error(`${holder?.id} does not take ${dropped?.id ?? 'it'}.`);
	const { raw, props } = compHoldTake(definition, compDataOf(holder), block, holdContextOf(editor));
	return { ...holder.data, raw, ...(props !== undefined ? { props } : {}) };
}

// what a card lets go of its held block of a key: { holderData, block }, or null when it lets nothing go
export function cardCompLetGo({ node, editor, key }) {
	const definition = holderDefinitionOf(node, editor);
	if (!definition) return null;
	const result = compHoldLetGo(definition, compDataOf(node), key);
	if (!result) return null;
	return { holderData: { ...node.data, raw: result.raw, ...(result.props !== undefined ? { props: result.props } : {}) }, block: result.block };
}

// whether a card can let what it holds go: its component lets go (expose.hold.letGo)
export function cardCompIsReleasing(node, editor) {
	return Boolean(holderDefinitionOf(node, editor)?.expose?.hold?.letGo);
}

// the node a block let go becomes, without its id and its place: a card holding it, as wide as its
// component starts (expose.nodeSizeDefault), its lines to come by an in and an out handle
export function cardCompNodeOfBlock(block, definition) {
	return {
		idPrefix: cardCompSlashNameOf(block.comp) || 'comp',
		renderer: { type: CARD_COMP_TYPE },
		size: { width: definition?.expose?.nodeSizeDefault?.width ?? CARD_COMP_WIDTH, height: 'auto' },
		data: { ...block },
		handles: [
			{ id: 'in', direction: 'in', anchor: { side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { side: 'right' } },
		],
	};
}
