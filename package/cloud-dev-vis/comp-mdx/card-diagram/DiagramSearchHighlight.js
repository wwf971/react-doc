import { diagramSearchRegexBuild } from './DiagramSearch.js';

// The words found, highlighted where they are drawn (card-diagram-impl.md#search), with the
// CSS Custom Highlight API: ranges of the text of the page, painted by ::highlight(), without
// touching the elements of any card. So a card of any kind, a cell a variant draws its own way,
// a scene drawn inside a card, all show their words found, and no card does anything for it.
// Only text inside what is marked found ([data-search]) is looked at; the current item's
// innermost marked elements get the second highlight.
//
// one registry of highlights serves the page: every search (one per canvas) keeps its ranges
// under its id, and the two highlights are the union of them all
const HIGHLIGHT_MATCH = 'doc-diagram-search';
const HIGHLIGHT_CURRENT = 'doc-diagram-search-current';
const rangeByOwner = new Map();

function highlightApply() {
	if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
	const all = [];
	const current = [];
	for (const value of rangeByOwner.values()) {
		all.push(...value.match);
		current.push(...value.current);
	}
	CSS.highlights.set(HIGHLIGHT_MATCH, new Highlight(...all));
	CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(...current));
}

// the elements of the current item: those marked current holding no other one
export function diagramSearchCurrentElementList(root) {
	return [...root.querySelectorAll('[data-search="current"]')].filter((element) => !element.querySelector('[data-search="current"]') && !element.closest('.doc-canvas-still'));
}

export function diagramSearchHighlightSet(ownerId, root, request) {
	const regex = diagramSearchRegexBuild(request, { isGlobal: true });
	const match = [];
	const current = [];
	if (root && regex) {
		const currentSet = new Set(diagramSearchCurrentElementList(root));
		for (const element of root.querySelectorAll('[data-search]')) {
			if (element.closest('.doc-canvas-still')) continue;
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			for (let text = walker.nextNode(); text; text = walker.nextNode()) {
				// a text belongs to the innermost marked element around it
				if (text.parentElement?.closest('[data-search]') !== element) continue;
				regex.lastIndex = 0;
				for (let found = regex.exec(text.data); found; found = regex.exec(text.data)) {
					if (found[0].length === 0) { regex.lastIndex += 1; continue; }
					const range = new Range();
					range.setStart(text, found.index);
					range.setEnd(text, found.index + found[0].length);
					(currentSet.has(element) ? current : match).push(range);
				}
			}
		}
	}
	rangeByOwner.set(ownerId, { match, current });
	highlightApply();
}

export function diagramSearchHighlightClear(ownerId) {
	if (!rangeByOwner.delete(ownerId)) return;
	highlightApply();
}
