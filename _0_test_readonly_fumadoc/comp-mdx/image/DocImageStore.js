import { makeAutoObservable } from 'mobx';

const displayModeNormalize = (displayMode) => {
	if (displayMode === 'fill' || displayMode === 'contain-auto') return displayMode;
	return 'contain';
};

class DocImageStore {
	copyStatus = 'idle';
	displayMode = 'contain';
	isExpanded = false;

	constructor(displayMode = 'contain') {
		this.displayMode = displayModeNormalize(displayMode);
		makeAutoObservable(this, {}, { autoBind: true });
	}

	copyStatusSet(copyStatus) {
		this.copyStatus = copyStatus;
	}

	displayModeSet(displayMode) {
		this.displayMode = displayModeNormalize(displayMode);
	}

	expandedSet(isExpanded) {
		this.isExpanded = isExpanded;
	}
}

export { DocImageStore };