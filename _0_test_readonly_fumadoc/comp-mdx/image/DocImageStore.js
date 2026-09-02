import { makeAutoObservable } from 'mobx';

class DocImageStore {
	copyStatus = 'idle';
	displayMode = 'contain';
	isExpanded = false;

	constructor(displayMode = 'contain') {
		this.displayMode = displayMode === 'fill' ? 'fill' : 'contain';
		makeAutoObservable(this, {}, { autoBind: true });
	}

	copyStatusSet(copyStatus) {
		this.copyStatus = copyStatus;
	}

	displayModeSet(displayMode) {
		this.displayMode = displayMode === 'fill' ? 'fill' : 'contain';
	}

	expandedSet(isExpanded) {
		this.isExpanded = isExpanded;
	}
}

export { DocImageStore };