import { makeAutoObservable } from 'mobx';

class DocDiagramMermaidStore {
	copyStatus = 'idle';
	isExpanded = false;

	constructor() {
		makeAutoObservable(this, {}, { autoBind: true });
	}

	copyStatusSet(copyStatus) {
		this.copyStatus = copyStatus;
	}

	expandedSet(isExpanded) {
		this.isExpanded = isExpanded;
	}
}

export { DocDiagramMermaidStore };