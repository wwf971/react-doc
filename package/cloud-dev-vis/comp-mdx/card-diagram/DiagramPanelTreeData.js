// The rows of a tree of the panel (card-diagram-impl.md#the-paged-tree), laid out from a model and
// the state of the tree. Pure: tests run it without a browser, and the component draws what it
// answers (DiagramPanelTree.jsx).
//
// A model (a tab gives it; keys are strings, stable across changes of the data):
//   rootKeyList                  the items at the top
//   itemGet(key)                 { key, kind, label, ... } (what a row draws; see DiagramPanelTree.jsx)
//   childKeyListGet(key)         its children, in order: asked only of the items laid out open, of
//                                every item while a search runs
//   parentKeyGet(key)            the item it stands under ('' at the top): what a reveal walks up
//   searchTextGet(key)           the words a search finds it by
//   isExpandedDefault?(key)      open before the author chose (false by default)
//
// A page is a page of **direct children**: an item open with more children than the page size
// lists them a page at a time, under a pager row. What is open inside a page is laid out inside it,
// so opening a child never moves another child to another page; pages nest. The state of each item
// (open, its page, the filter of its level) is kept by its key.
//
// The search narrows the whole tree: an item stays when it, or something below it, holds every
// word; what holds matches is open (unless closed during this search), and each level is still
// paged over what it keeps.
export const TREE_ROOT_KEY = '';
export const TREE_PAGE_SIZE_LIST = [10, 20, 50, 100];
export const TREE_PAGE_SIZE_DEFAULT = 20;

export function treeWordListOf(text) {
	return String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

export function treeTextMatches(text, wordList) {
	if (!wordList.length) return true;
	const haystack = String(text ?? '').toLowerCase();
	return wordList.every(word => haystack.includes(word));
}

function childListOf(model, key) {
	return key === TREE_ROOT_KEY ? model.rootKeyList : model.childKeyListGet(key) ?? [];
}

// what a search keeps: the items holding every word (matchKeySet), and those plus everything above
// them (shownKeySet). keepKeySet: items kept whatever they hold (what is selected stays in sight)
export function treeSearchSetBuild(model, wordList, keepKeySet = new Set()) {
	const matchKeySet = new Set();
	const shownKeySet = new Set();
	const visit = (key, chain) => {
		const isMatch = treeTextMatches(model.searchTextGet(key), wordList);
		if (isMatch) matchKeySet.add(key);
		if (isMatch || keepKeySet.has(key)) {
			shownKeySet.add(key);
			for (const above of chain) shownKeySet.add(above);
		}
		chain.push(key);
		for (const child of model.childKeyListGet(key) ?? []) visit(child, chain);
		chain.pop();
	};
	for (const key of model.rootKeyList) visit(key, []);
	return { matchKeySet, shownKeySet };
}

// an item is open: in a search, when something below it is shown and the author did not close it
// during that search; else as the author left it, or as the model has it by default
export function treeIsExpanded(model, state, key, search) {
	if (search) return !state.searchCollapsedByKey?.[key];
	const chosen = state.expandedByKey?.[key];
	return chosen ?? Boolean(model.isExpandedDefault?.(key));
}

// the children of an item as one level lists them: narrowed by the search, then by the filter of
// the level. countLevel: before the filter of the level (what decides whether the level is paged)
export function treeLevelOf(model, state, parentKey, search) {
	let keyList = childListOf(model, parentKey);
	if (search) keyList = keyList.filter(key => search.shownKeySet.has(key));
	const countLevel = keyList.length;
	const filterWordList = treeWordListOf(state.filterByKey?.[parentKey]);
	if (filterWordList.length) keyList = keyList.filter(key => treeTextMatches(model.searchTextGet(key), filterWordList));
	const pageSize = Math.max(1, state.pageSize ?? TREE_PAGE_SIZE_DEFAULT);
	const isPaged = countLevel > pageSize;
	const pageCount = isPaged ? Math.max(1, Math.ceil(keyList.length / pageSize)) : 1;
	const page = isPaged ? Math.min(Math.max(0, state.pageByKey?.[parentKey] ?? 0), pageCount - 1) : 0;
	return { keyList, countLevel, isPaged, pageSize, pageCount, page, filter: state.filterByKey?.[parentKey] ?? '' };
}

// the rows: { type: 'item', key, depth, isExpanded, hasChildren, childCount } and, first among
// the children of a paged level, { type: 'pager', key: 'pager:{parentKey}', parentKey, depth,
// page, pageCount, from, to, total, countLevel, filter }. search: treeSearchSetBuild's answer,
// or null
export function treeRowListBuild(model, state, search = null) {
	const rowList = [];
	const levelPush = (parentKey, depth) => {
		const level = treeLevelOf(model, state, parentKey, search);
		let keyList = level.keyList;
		if (level.isPaged) {
			const from = level.page * level.pageSize;
			keyList = keyList.slice(from, from + level.pageSize);
			rowList.push({ type: 'pager', key: `pager:${parentKey}`, parentKey, depth, page: level.page, pageCount: level.pageCount, from: keyList.length ? from + 1 : 0, to: from + keyList.length, total: level.keyList.length, countLevel: level.countLevel, filter: level.filter });
		}
		for (const key of keyList) {
			const childList = childListOf(model, key);
			const childCount = search ? childList.filter(child => search.shownKeySet.has(child)).length : childList.length;
			const isExpanded = childCount > 0 && treeIsExpanded(model, state, key, search);
			rowList.push({ type: 'item', key, depth, isExpanded, hasChildren: childCount > 0, childCount });
			if (isExpanded) levelPush(key, depth + 1);
		}
	};
	levelPush(TREE_ROOT_KEY, 0);
	return rowList;
}

// the items above a key, the top first (without the key itself)
export function treeChainOf(model, key) {
	const chain = [];
	const seen = new Set([key]);
	let parent = model.parentKeyGet(key);
	while (parent && !seen.has(parent)) {
		chain.unshift(parent);
		seen.add(parent);
		parent = model.parentKeyGet(parent);
	}
	return chain;
}

// what makes a key seen: every item above it open, the page of each holding the next one down, a
// filter of a level that hides the next one emptied. Answers the state patched (a new object), or
// the state itself when the key is not in the tree
export function treeRevealState(model, state, key, search = null) {
	const chain = treeChainOf(model, key);
	const pathList = [TREE_ROOT_KEY, ...chain];
	const next = { ...state, expandedByKey: { ...state.expandedByKey }, pageByKey: { ...state.pageByKey }, filterByKey: { ...state.filterByKey }, searchCollapsedByKey: { ...state.searchCollapsedByKey } };
	for (let index = 0; index < pathList.length; index += 1) {
		const parentKey = pathList[index];
		const childKey = index + 1 < pathList.length ? pathList[index + 1] : key;
		if (!childListOf(model, parentKey).includes(childKey)) return state;
		if (parentKey !== TREE_ROOT_KEY) {
			if (search) delete next.searchCollapsedByKey[parentKey];
			else next.expandedByKey[parentKey] = true;
		}
		let level = treeLevelOf(model, next, parentKey, search);
		if (!level.keyList.includes(childKey) && next.filterByKey[parentKey]) {
			delete next.filterByKey[parentKey];
			level = treeLevelOf(model, next, parentKey, search);
		}
		const indexChild = level.keyList.indexOf(childKey);
		if (indexChild < 0) return state;
		if (level.isPaged) next.pageByKey[parentKey] = Math.floor(indexChild / level.pageSize);
	}
	return next;
}
