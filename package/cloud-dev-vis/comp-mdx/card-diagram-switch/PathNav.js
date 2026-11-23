import { makeAutoObservable, observable } from 'mobx';
import { ScrollHorizontalStore } from '../../../../main/comp-doc/scroll/ScrollHorizontalStore.js';
import { switchPathChain, switchPathNormalize, switchPathParent } from './SwitchData.js';

// A path-based view, as a side feature of the switch layer (card-diagram-flexible-switch.md#a-path-based-view-anywhere):
// what the path bar of a switching viewport walks, for anything else that shows one place of a tree
// of paths at a time (the papers of a frontend object, a folder of items). The switch layer uses
// the same history and the same bar (SwitchStore, SwitchPathBar.jsx), so there is one of each.
//
//   provider                a tree of paths, the words of a switch provider without its scenes
//     root                  the first place; '/' is a place of its own, the first segment of every path
//     labelGet(path)        the word of a segment
//     childListGet(path)    the places below a path, the menu of the path bar: [{ path, label, description? }]
//     isFound?(path)        whether a path is a place (every path when absent)
//
//   nav                     what the bar reads (PathNavBar.jsx): pathNavBuild(store, provider), or a
//                           store answering the same (the switch layer's)
//     pathCurrent, pathChain, pathUp, isBackPossible, isForwardPossible, pathScroll
//     labelGet(path), siblingListGet(path), childListGet(path), pathSet(path), back(), forward(), up()

// how far back and forward a history reaches
export const PATH_NAV_HISTORY_MAX = 30;

// every place of a path, the root first: /a/b -> [/a, /a/b]; with the root '/', [/, /a, /a/b]
export function pathNavChain(path, root = '') {
	const chain = switchPathChain(path);
	return root === '/' ? ['/', ...chain] : chain;
}

// the place a path is in: '' at the top (the parent of /a is / when / is the root)
export function pathNavParent(path, root = '') {
	const normalized = switchPathNormalize(path);
	if (normalized === '/') return '';
	return switchPathParent(normalized) || (root === '/' ? '/' : '');
}

// back and forward over the places visited, as a browser does: a new way forgets what lay forward
export class PathNavHistory {
	historyList = [];
	forwardList = [];

	constructor() {
		makeAutoObservable(this, { historyList: observable.ref, forwardList: observable.ref }, { autoBind: true });
	}

	// the place left for another one
	visit(pathLeft) {
		this.historyList = [...this.historyList.slice(-PATH_NAV_HISTORY_MAX), pathLeft];
		this.forwardList = [];
	}

	// the place to go back to, '' for none; the place left is then forward
	backTake(pathCurrent) {
		const list = this.historyList;
		if (list.length === 0) return '';
		this.historyList = list.slice(0, -1);
		this.forwardList = [...this.forwardList.slice(-PATH_NAV_HISTORY_MAX), pathCurrent];
		return list[list.length - 1];
	}

	// the way back undone, as far as it went
	forwardTake(pathCurrent) {
		const list = this.forwardList;
		if (list.length === 0) return '';
		this.forwardList = list.slice(0, -1);
		this.historyList = [...this.historyList.slice(-PATH_NAV_HISTORY_MAX), pathCurrent];
		return list[list.length - 1];
	}

	clear() {
		this.historyList = [];
		this.forwardList = [];
	}
}

// the state of a path-based view whose host has no store of its own: the place shown, the history,
// how far the path of the bar is moved. It knows no provider: what the data says is read when the
// view is drawn (pathNavBuild), so the store can be kept across mounts while the data changes
export class PathNavStore {
	pathCurrent = '';

	constructor({ path = '' } = {}) {
		this.pathCurrent = path;
		this.history = new PathNavHistory();
		this.pathScroll = new ScrollHorizontalStore();
		// how far each place was scrolled, so that back and forward arrive where the reader was; not
		// observed: a scroll draws nothing again
		this.scrollTopByPath = new Map();
		makeAutoObservable(this, { history: false, pathScroll: false, scrollTopByPath: false, scrollTopGet: false, scrollTopSet: false }, { autoBind: true });
	}

	scrollTopGet(path) {
		return this.scrollTopByPath.get(path) ?? 0;
	}

	scrollTopSet(path, top) {
		this.scrollTopByPath.set(path, top);
	}

	// to another place: the one left goes into the history (isHistory: false for a step of back or forward)
	go(pathFrom, pathTo, { isHistory = true } = {}) {
		if (pathTo === pathFrom) return;
		if (isHistory) this.history.visit(pathFrom);
		this.pathCurrent = pathTo;
	}
}

// what the bar reads, from the state of a view and its provider as they are now: a place that is
// gone (a paper removed) shows the nearest place above it that is one, else the root
export function pathNavBuild(store, provider) {
	const root = provider.root ?? '/';
	const isFound = (path) => (provider.isFound ? provider.isFound(path) : true);
	const placeOf = (path) => {
		if (path && isFound(path)) return path;
		return pathNavChain(path || root, root).slice(0, -1).reverse().find(isFound) ?? root;
	};
	const pathCurrent = placeOf(store.pathCurrent);
	const pathChain = pathNavChain(pathCurrent, root);
	const pathUp = pathChain.slice(0, -1).reverse().find(isFound) ?? '';
	const { history } = store;
	return {
		root,
		pathCurrent,
		pathChain,
		pathUp,
		isBackPossible: history.historyList.length > 0,
		isForwardPossible: history.forwardList.length > 0,
		pathScroll: store.pathScroll,
		isFound,
		labelGet: (path) => provider.labelGet(path),
		childListGet: (path) => provider.childListGet(path),
		siblingListGet: (path) => {
			const parent = pathNavParent(path, root);
			return parent ? provider.childListGet(parent) : [];
		},
		// false: the path names no place
		pathSet: (path) => {
			if (!isFound(path)) return false;
			store.go(pathCurrent, path);
			return true;
		},
		back: () => {
			const path = history.backTake(pathCurrent);
			if (path) store.go(pathCurrent, placeOf(path), { isHistory: false });
		},
		forward: () => {
			const path = history.forwardTake(pathCurrent);
			if (path) store.go(pathCurrent, placeOf(path), { isHistory: false });
		},
		up: () => {
			if (pathUp) store.go(pathCurrent, pathUp);
		},
	};
}
