// The card holding a component (card-diagram-impl.md#a-component-in-a-card): a node of the kind
// card-comp holds one component of the page, or none yet, with the data a block of that component
// holds in a document, written in the node:
//
//   data:
//     comp: MeetingZoomInstance  the tag name of the component; absent: an empty card
//     lang: yaml                 the language of its data, as the fence of a block of it says
//     raw: |                     its data, as the fence of a block of it holds it
//       title: Weekly sync
//     props: { … }               what the marker comment of a block of it says, when anything
//
// So a block of a document and a card hold the same thing, and the component is drawn and edited
// as it is in a document: through the page's boundary of components, placement commentBlock, its
// own edit modes. Which components a card may hold: CardCompEntry.js. Nothing here reads the page:
// the store of the editor and the tests use it alone.
//
// Its data may be an asset reference (lang asset, raw { store, itemId }: a component whose data must
// be an asset item, a spreadsheet): the card holds the reference, the item holds the data, and what
// the component writes goes to the item (CardCompAsset.js), never over the reference.

import { commentMarkerParse } from '../../../../main/frontend/src/lib/remark-comment-comp.js';
import { assetRefLangIs } from '../../../../main/frontend/src/lib/doc-asset-ref.js';
import { codeInfoLangGet, codeInfoTitleGet, codeInfoViewGet } from '../../../../main/frontend/src/lib/rehype-code-view.js';
// the component the lines of a fenced block are drawn by when they are its data, as the core moves a
// code block into the asset store (doc_page_impl_mdx_code.md#the-lines-in-the-asset-service-layer)
import { CODE_COMPONENT_NAME } from '../../../../main/frontend/src/lib/doc-edit-code.js';

export const CARD_COMP_TYPE = 'card-comp';

// how a card takes its box (contract.sizeModeList, DiagramNodeResize.js), read from its size as
// written: its component's own size, or a width, a height, or both given, what the component draws
// beyond an axis given scrolling (CardComp.jsx: its body, by the rule of the box of a node)
export const CARD_COMP_SIZE_MODE_LIST = [
	{ id: 'fit', label: 'Its own size', note: 'As large as what it holds: nothing to resize.' },
	{ id: 'wrap', label: 'A width, its height follows', note: 'What it holds takes the width; what is wider scrolls.' },
	{ id: 'tall', label: 'A height, its width follows', note: 'As wide as what it holds; what is higher scrolls.' },
	{ id: 'box', label: 'A width and a height', note: 'What does not fit scrolls.' },
];

const isMapping = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// the data of a card, checked: what is not of its form is refused with the reason, naming the node
export function cardCompNormalize(data = {}) {
	if (!isMapping(data)) throw new Error('a card-comp node holds a mapping: { comp, lang, raw, props }');
	if (data.comp !== undefined && (typeof data.comp !== 'string' || !data.comp.trim())) throw new Error('data.comp of a card-comp node is the tag name of a component');
	if (data.lang !== undefined && typeof data.lang !== 'string') throw new Error('data.lang of a card-comp node is a word (yaml)');
	if (data.raw !== undefined && typeof data.raw !== 'string') throw new Error('data.raw of a card-comp node is the text of its data');
	if (data.props !== undefined && !isMapping(data.props)) throw new Error('data.props of a card-comp node is a mapping');
	return data;
}

// MeetingZoomInstance -> meeting-zoom-instance: the word a component is typed as when it declares none
export function cardCompSlashNameOf(compName) {
	return String(compName ?? '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

// whether an entry answers the words typed: every word in its names, its label or its description
export function cardCompEntryMatch(entry, text) {
	const wordList = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
	if (!wordList.length) return true;
	const hay = [...entry.wordList, entry.label, entry.description].join(' ').toLowerCase();
	return wordList.every((word) => hay.includes(word));
}

// whether the data of a card is a reference to an asset item rather than the data itself
export function cardCompIsAssetRef(data = {}) {
	return assetRefLangIs(data.lang);
}

// the data of a card holding what a block of a document is, from the text of the block (what a
// slash action puts at the caret, slashEffect.block): a component block (its marker, then its fence)
// gives its component, its props and its data; a fenced code block gives the component Code with
// the lines, their language and the view and the title of its info string. null: a text a card
// cannot hold (more than one block, a block of another form)
//   <!--renderComp=Mdx,view=card-->        { comp: 'Mdx', lang: 'md', raw: '', props: { view: 'card' } }
//   ```md
//   ```
//   ```text view=icon                     { comp: 'Code', lang: 'text', raw: '', props: { view: 'icon' } }
//   ```
export function cardCompDataOfBlockSource(source) {
	const lineList = String(source ?? '').replace(/\r\n?/g, '\n').trim().split('\n');
	const marker = commentMarkerParse(lineList[0]);
	const fence = fenceRead(marker ? lineList.slice(1) : lineList);
	if (!fence) return null;
	if (marker) return { comp: marker.compName, lang: codeInfoLangGet(fence.info) || 'yaml', raw: fence.raw, ...(Object.keys(marker.props).length ? { props: marker.props } : {}) };
	const view = codeInfoViewGet(fence.info);
	const title = codeInfoTitleGet(fence.info);
	const props = { ...(view ? { view } : {}), ...(title ? { title } : {}) };
	return { comp: CODE_COMPONENT_NAME, lang: codeInfoLangGet(fence.info) || 'text', raw: fence.raw, ...(Object.keys(props).length ? { props } : {}) };
}

// the one fenced block the lines are, from its opening to its closing fence: { info, raw }, or null
function fenceRead(lineList) {
	const open = /^(`{3,}|~{3,})(.*)$/.exec(lineList[0] ?? '');
	if (!open) return null;
	const close = lineList.length - 1;
	if (close < 1 || !new RegExp(`^${open[1][0]}{${open[1].length},}\\s*$`).test(lineList[close])) return null;
	const body = lineList.slice(1, close);
	return { info: open[2].trim(), raw: body.length ? `${body.join('\n')}\n` : '' };
}

// the view of a card's component, written as view= on the marker of a block of it, when the component
// draws its blocks in views (expose.blockViewList): its props with that view, '' removing it (the
// component's default, or what its place decides)
export function cardCompPropsWithView(props = {}, view) {
	const rest = { ...(props ?? {}) };
	delete rest.view;
	return view ? { ...rest, view } : rest;
}

// the data of a card holding the component of an entry (null: none), as its source starts it
export function cardCompDataOf(entry) {
	if (!entry) return {};
	const { lang, raw, props } = entry.source ?? {};
	return { comp: entry.compName, lang: lang ?? 'yaml', raw: String(raw ?? ''), ...(props && Object.keys(props).length ? { props: { ...props } } : {}) };
}

// the sections a card holding a component adds to its edit card (contract.cardSectionListGet):
//   its values    its view, when the component draws its blocks in views (expose.blockViewList:
//                 view= of its props), and one field per value, when the component offers its data
//                 value by value (expose.dataFields: { fieldList, valueListGet(data), rawWithValue(data,
//                 id, text) }); each typed is written into the draft as the component writes it, one
//                 step per field
//   its data      the text of its data, as a block of it holds it in a document; for data held in an
//                 asset item, the reference to it
// definition: the component's, as the page resolves it (null: a component the page lacks). Pure
export function cardCompSectionListBuild({ nodeId, node, store, change, definition }) {
	const data = node.data ?? {};
	if (!data.comp) return [];
	const dataFields = definition?.expose?.dataFields;
	const viewList = cardCompViewListOf(definition);
	const label = definition?.expose?.meta?.label ?? data.comp;
	const isAssetRef = cardCompIsAssetRef(data);
	const sectionList = [];
	const viewPropertyList = viewList.length ? [{
		id: 'comp-view', label: 'View', kind: 'enum', value: viewList.some(view => view.id === data.props?.view) ? data.props.view : '',
		values: ['', ...viewList.map(view => view.id)],
		valueLabels: { '': 'Default', ...Object.fromEntries(viewList.map(view => [view.id, view.label ?? view.id])) },
		set: (value) => change(() => {
			const props = cardCompPropsWithView(store.nodeGet(nodeId)?.data?.props, value);
			return store.nodeCompViewSet(nodeId, props, { isTile: cardCompViewIsTile(definition, props) });
		}),
	}] : [];
	if (dataFields?.fieldList?.length && !isAssetRef) {
		const valueById = dataFields.valueListGet({ raw: data.raw ?? '', lang: data.lang ?? 'yaml', ...(data.props ?? {}) }) ?? {};
		sectionList.push({
			id: 'comp-values', label,
			note: 'Typed here, or where they stand on the card (a click on a value).',
			propertyList: [...viewPropertyList, ...dataFields.fieldList.map(field => ({
				id: `comp-field-${field.id}`, label: field.label, kind: 'text', value: valueById[field.id] ?? '', placeholder: field.placeholder ?? '', isMultiline: field.isMultiline === true,
				set: (value) => change(() => {
					// the data as it is now (a value typed is a step of its own, after the ones before it)
					const dataNow = store.nodeGet(nodeId)?.data ?? data;
					return store.nodeCompDataSet(nodeId, { raw: dataFields.rawWithValue({ raw: dataNow.raw ?? '', lang: dataNow.lang ?? 'yaml', ...(dataNow.props ?? {}) }, field.id, value) }, { groupKey: `comp-field:${nodeId}/${field.id}` });
				}),
			}))],
			actionList: [],
		});
	} else if (viewPropertyList.length) {
		sectionList.push({ id: 'comp-values', label, note: 'How the card draws it: the views of a block of it in a document.', propertyList: viewPropertyList, actionList: [] });
	}
	sectionList.push(isAssetRef ? {
		id: 'comp-data', label: 'Its data',
		note: `Kept in an item of the asset store; the card holds the reference to it. ${data.comp} edits the data in its own modes (the buttons over the card), and saves it into the item.`,
		propertyList: [{ id: 'comp-raw', label: 'reference', kind: 'text', isMultiline: true, value: data.raw ?? '', set: value => change(() => store.nodeCompDataSet(nodeId, { raw: value }, { groupKey: `comp-raw:${nodeId}` })) }],
		actionList: [],
	} : {
		id: 'comp-data', label: dataFields ? 'Its data as text' : 'Its data',
		note: `What a block of ${data.comp} holds in a document, in ${data.lang ?? 'yaml'}.${dataFields || !definition?.expose?.editModeList?.length ? '' : ' The component edits it in its own modes too: the buttons over the card.'}`,
		propertyList: [{ id: 'comp-raw', label: data.lang ?? 'yaml', kind: 'text', isMultiline: true, value: data.raw ?? '', set: value => change(() => store.nodeCompDataSet(nodeId, { raw: value }, { groupKey: `comp-raw:${nodeId}` })) }],
		actionList: [],
	});
	return sectionList;
}

// whether a card of this component with these props draws a tile (a view isTile: the icon of a code
// block), so the card is as wide as the tile (width auto). Without a view written, the first view
// of the list (the component's default where its place decides nothing)
export function cardCompViewIsTile(definition, props = {}) {
	const viewList = cardCompViewListOf(definition);
	const viewId = viewList.some(view => view.id === props?.view) ? props.view : viewList[0]?.id;
	return viewList.find(view => view.id === viewId)?.isTile === true;
}

// the views a block of a component is drawn in (expose.blockViewList: [{ id, label, description,
// isTile? }]), [] for one without
export function cardCompViewListOf(definition) {
	const list = definition?.expose?.blockViewList;
	return Array.isArray(list) ? list.filter(view => view && typeof view.id === 'string' && view.id) : [];
}

// a new card: the component of an entry, or none; as high as what the component draws, and as wide
// as it when it draws a tile (entry.isTile)
export const CARD_COMP_WIDTH = 240;
export function cardCompNodeCreate(idNext, entry = null) {
	return {
		id: idNext(entry ? cardCompSlashNameOf(entry.compName) || 'comp' : 'comp'),
		renderer: { type: CARD_COMP_TYPE },
		size: { width: entry?.isTile ? 'auto' : entry?.sizeDefault?.width ?? CARD_COMP_WIDTH, height: 'auto' },
		data: cardCompDataOf(entry),
		handles: [
			{ id: 'in', direction: 'in', anchor: { side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { side: 'right' } },
		],
	};
}
