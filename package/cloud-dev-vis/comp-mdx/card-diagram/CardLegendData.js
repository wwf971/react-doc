// A legend (CardLegend.jsx): what the looks of a diagram stand for, in groups. An entry shows a
// card as it is drawn (swatch: the tone and the variant of the compact cards) or a line as it is
// drawn (line: its color, its dashes, its width, an arrow at its end), with words beside it. Any
// diagram may have one: a generator writes it rather than drawing its own; pinned to a corner of the
// viewport (node.pin) it stays there while the camera moves, and folds to its title line.
//
//   data { title?, isFolded?, opacity?, groupList: [{ id, title?, itemList: [{ id, label, swatch?: { tone, variant? }, line?: { color, dash?, width?, opacity?, isArrow? } }] }] }
//   title: the words of its title line (Legend by default)
//   opacity: of its panel, 0.1 to 1 (1 by default): below 1 the diagram shows through it, its words
//     and its samples staying whole. A reader turns it either way with the button of its title
//     line; that choice is remembered for every legend (cardLegendTranslucentRead), and goes first
export const CARD_LEGEND_TONE_LIST = ['blue', 'teal', 'green', 'amber', 'red', 'violet', 'slate'];
// how much of the panel stays when a reader asks for it see-through and the legend says no opacity of its own
export const CARD_LEGEND_TRANSLUCENT_DEFAULT = 0.55;
const TRANSLUCENT_KEY = 'doc-card-legend-translucent';

// the reader's choice: true (see-through), false (opaque), or null when never made
export function cardLegendTranslucentRead() {
	try {
		const value = globalThis.localStorage?.getItem(TRANSLUCENT_KEY);
		return value === '1' ? true : value === '0' ? false : null;
	} catch {
		return null;
	}
}

export function cardLegendTranslucentWrite(isTranslucent) {
	try {
		globalThis.localStorage?.setItem(TRANSLUCENT_KEY, isTranslucent ? '1' : '0');
	} catch {
		// a page without storage forgets the choice when it closes
	}
}
const ROW_HEIGHT = 22;
const HEAD_HEIGHT = 18;
const PAD = 10;
const TITLE_HEIGHT = 22;

export function cardLegendNormalize(data) {
	if (!Array.isArray(data.groupList)) throw new Error('A legend needs groupList.');
	if (data.opacity !== undefined && !(typeof data.opacity === 'number' && data.opacity >= 0.1 && data.opacity <= 1)) throw new Error('The opacity of a legend is a number from 0.1 to 1.');
	const idGroupSet = new Set();
	for (const group of data.groupList) {
		if (!group || typeof group.id !== 'string' || !group.id || idGroupSet.has(group.id)) throw new Error('Every group of a legend needs a unique nonempty id.');
		if (!Array.isArray(group.itemList)) throw new Error(`The group ${group.id} of a legend needs itemList.`);
		idGroupSet.add(group.id);
		for (const item of group.itemList) {
			if (!item || typeof item.id !== 'string' || !item.id) throw new Error(`Every entry of the group ${group.id} of a legend needs an id.`);
			if (Boolean(item.swatch) === Boolean(item.line)) throw new Error(`The entry ${item.id} of a legend shows a swatch or a line.`);
			if (item.swatch && !CARD_LEGEND_TONE_LIST.includes(item.swatch.tone)) throw new Error(`The swatch of ${item.id} needs a tone: one of ${CARD_LEGEND_TONE_LIST.join(', ')}.`);
			if (item.line && typeof item.line.color !== 'string') throw new Error(`The line of ${item.id} needs a color.`);
		}
	}
	return data;
}

// one row per entry under the head of its group
export function cardLegendHeightGet(data) {
	const groupHeight = data.groupList.reduce((sum, group) => sum + (group.title ? HEAD_HEIGHT : 0) + group.itemList.length * ROW_HEIGHT + 6, 0);
	return PAD * 2 + TITLE_HEIGHT + groupHeight;
}
