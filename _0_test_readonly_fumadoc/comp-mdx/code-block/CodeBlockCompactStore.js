import { makeAutoObservable, runInAction } from 'mobx';

export class CodeBlockCompactStore {
	pathPopup = '';
	copyStatus = 'idle';
	copyResetTimerId = 0;

	constructor() {
		makeAutoObservable(this, {}, { autoBind: true });
	}

	get isPopupOpen() {
		return this.pathPopup !== '';
	}

	popupOpen(path) {
		this.pathPopup = path;
		this.copyStatus = 'idle';
	}

	popupClose() {
		this.pathPopup = '';
		this.copyStatus = 'idle';
		this.copyResetClear();
	}

	async contentCopy(content) {
		this.copyResetClear();
		try {
			if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard is unavailable.');
			await globalThis.navigator.clipboard.writeText(content);
			runInAction(() => {
				this.copyStatus = 'copied';
			});
		} catch {
			runInAction(() => {
				this.copyStatus = 'failed';
			});
		}
		this.copyResetTimerId = globalThis.setTimeout(this.copyStatusReset, 1400);
	}

	copyStatusReset() {
		this.copyStatus = 'idle';
		this.copyResetTimerId = 0;
	}

	copyResetClear() {
		if (!this.copyResetTimerId) return;
		globalThis.clearTimeout(this.copyResetTimerId);
		this.copyResetTimerId = 0;
	}

	dispose() {
		this.copyResetClear();
	}
}
