// An index (CardIndex.jsx): many things as small cards of their two names in a grid, in groups,
// each opening what it stands for (data-switch-link). One card, however many entries: a
// database of thousands of tables and option sets is one node of a diagram, not thousands.
//
//   data { title?, columnCount, itemWidth?, groupList: [{ id, title?, note?, tone?, variant?, linkPrefix?, isIdText?, itemList: [{ id, title, text?, tone?, variant?, link? }] }] }
//   tone: of the compact cards (blue, teal, green, amber, red, violet, slate); variant: dashed | bar.
//   What a group says (tone, variant) is said of each entry that says nothing of it; an entry
//   opens link, else linkPrefix + its id; with isIdText its second line is its id. A long index is
//   written once per scene shown, so what every entry would repeat is said once
export const CARD_INDEX_TONE_LIST = ['blue', 'teal', 'green', 'amber', 'red', 'violet', 'slate'];
export const CARD_INDEX_VARIANT_LIST = ['dashed', 'bar'];
export const CARD_INDEX_ITEM_WIDTH = 250;
export const CARD_INDEX_ITEM_HEIGHT = 40;
export const CARD_INDEX_GAP = 10;
const PAD = 12;
const HEAD_HEIGHT = 30;
const TITLE_HEIGHT = 34;

export function cardIndexNormalize(data) {
	if (!Number.isInteger(data.columnCount) || data.columnCount < 1) throw new Error('An index needs columnCount, a whole number of at least 1.');
	if (data.itemWidth !== undefined && !(Number.isFinite(data.itemWidth) && data.itemWidth > 0)) throw new Error('The itemWidth of an index is a width in pixels.');
	if (!Array.isArray(data.groupList)) throw new Error('An index needs groupList.');
	const idGroupSet = new Set();
	for (const group of data.groupList) {
		if (!group || typeof group.id !== 'string' || !group.id || idGroupSet.has(group.id)) throw new Error('Every group of an index needs a unique nonempty id.');
		if (!Array.isArray(group.itemList)) throw new Error(`The group ${group.id} of an index needs itemList.`);
		if (group.tone !== undefined && !CARD_INDEX_TONE_LIST.includes(group.tone)) throw new Error(`The tone of the group ${group.id} is one of ${CARD_INDEX_TONE_LIST.join(', ')}.`);
		if (group.variant !== undefined && !CARD_INDEX_VARIANT_LIST.includes(group.variant)) throw new Error(`The variant of the group ${group.id} is one of ${CARD_INDEX_VARIANT_LIST.join(', ')}.`);
		idGroupSet.add(group.id);
		for (const item of group.itemList) {
			if (!item || typeof item.id !== 'string' || !item.id) throw new Error(`Every entry of the group ${group.id} of an index needs an id.`);
			if (item.tone !== undefined && !CARD_INDEX_TONE_LIST.includes(item.tone)) throw new Error(`The tone of ${item.id} is one of ${CARD_INDEX_TONE_LIST.join(', ')}.`);
			if (item.variant !== undefined && !CARD_INDEX_VARIANT_LIST.includes(item.variant)) throw new Error(`The variant of ${item.id} is one of ${CARD_INDEX_VARIANT_LIST.join(', ')}.`);
		}
	}
	return data;
}

const itemWidthOf = (data) => data.itemWidth ?? CARD_INDEX_ITEM_WIDTH;

export function cardIndexWidthGet(data) {
	return PAD * 2 + data.columnCount * itemWidthOf(data) + (data.columnCount - 1) * CARD_INDEX_GAP;
}

// as high as its groups, each a head and its rows: what an arranger and the camera take before it is measured
export function cardIndexHeightGet(data) {
	const rowsHeight = (count) => (count > 0 ? Math.ceil(count / data.columnCount) * (CARD_INDEX_ITEM_HEIGHT + CARD_INDEX_GAP) - CARD_INDEX_GAP : 0);
	const groupHeight = data.groupList.reduce((sum, group) => sum + HEAD_HEIGHT + rowsHeight(group.itemList.length) + CARD_INDEX_GAP, 0);
	return PAD * 2 + (data.title ? TITLE_HEIGHT : 0) + groupHeight;
}

// an entry as it is drawn: what its group says of it where it says nothing itself
export function cardIndexItemOf(group, item) {
	return {
		id: item.id, title: item.title,
		text: item.text ?? (group.isIdText ? item.id : undefined),
		tone: item.tone ?? group.tone,
		variant: item.variant ?? group.variant,
		link: item.link ?? (group.linkPrefix !== undefined ? `${group.linkPrefix}${item.id}` : undefined),
	};
}

// what a search of the canvas finds in it (DiagramSearch.js): each entry by either of its names,
// marked where it is drawn ([data-search-part="item/{group}/{id}"])
export function cardIndexSearchMatch(node, helper) {
	const partList = (node.data?.groupList ?? []).flatMap((group) => group.itemList.map((item) => cardIndexItemOf(group, item)).filter((item) => helper.test(item.title) || helper.test(item.text)).map((item) => ({ id: `item/${group.id}/${item.id}` })));
	return partList.length ? { partList, childList: [] } : null;
}
