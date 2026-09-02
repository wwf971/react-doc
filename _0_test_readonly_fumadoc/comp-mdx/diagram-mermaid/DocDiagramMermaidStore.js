import { makeAutoObservable } from 'mobx';

class DocDiagramMermaidStore {
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

	displayModeToggle() {
		this.displayModeSet(this.displayMode === 'contain' ? 'fill' : 'contain');
	}

	expandedSet(isExpanded) {
		this.isExpanded = isExpanded;
	}
}

function displayModeNormalize(displayMode) {
	return displayMode === 'fill' || displayMode === 'intrinsic' ? 'fill' : 'contain';
}

export { DocDiagramMermaidStore };