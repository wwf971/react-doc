import { makeAutoObservable } from 'mobx';

const COPY_STATUS_RESET_MS = 1600;

// operation state of one BlockSimple: the copy action feedback.
//   copyStatus  idle | copied | failed; copied and failed return to idle
class BlockSimpleStore {
	copyStatus = 'idle';
	copyStatusResetTimer = null;

	constructor() {
		makeAutoObservable(this, { copyStatusResetTimer: false }, { autoBind: true });
	}

	copyStatusSet(copyStatus) {
		this.copyStatus = copyStatus;
		clearTimeout(this.copyStatusResetTimer);
		this.copyStatusResetTimer = copyStatus === 'idle'
			? null
			: setTimeout(() => this.copyStatusSet('idle'), COPY_STATUS_RESET_MS);
	}

	dispose() {
		clearTimeout(this.copyStatusResetTimer);
		this.copyStatusResetTimer = null;
	}
}

export { BlockSimpleStore };
