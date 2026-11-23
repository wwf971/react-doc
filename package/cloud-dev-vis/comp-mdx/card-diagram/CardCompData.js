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

export const CARD_COMP_TYPE = 'card-comp';

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

// the data of a card holding the component of an entry (null: none), as its source starts it
export function cardCompDataOf(entry) {
	if (!entry) return {};
	const { lang, raw, props } = entry.source ?? {};
	return { comp: entry.compName, lang: lang ?? 'yaml', raw: String(raw ?? ''), ...(props && Object.keys(props).length ? { props: { ...props } } : {}) };
}

// a new card: the component of an entry, or none; as high as what the component draws
export function cardCompNodeCreate(idNext, entry = null) {
	return {
		id: idNext(entry ? cardCompSlashNameOf(entry.compName) || 'comp' : 'comp'),
		renderer: { type: CARD_COMP_TYPE },
		size: { width: 240, height: 'auto' },
		data: cardCompDataOf(entry),
		handles: [
			{ id: 'in', direction: 'in', anchor: { side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { side: 'right' } },
		],
	};
}
