import { makeAutoObservable } from 'mobx';

const displayModeNormalize = (displayMode) => {
	if (displayMode === 'fill' || displayMode === 'contain-auto') return displayMode;
	return 'contain';
};

// view state of one rendered Image: display mode, copy status, the expanded
// popup, and the paste flow (image-req.md#paste):
//   isHovered        the pointer is over the image; a paste anywhere on the
//                    page then targets this image
//   isLocationCustom the next pasted file asks for its folder
//   pastePending     a pasted file waiting for the person to confirm that it
//                    replaces the current image
//   pasteStatus      idle | submitting | error, pasteMessage the failure
class ImageStore {
	copyStatus = 'idle';
	displayMode = 'contain';
	isExpanded = false;
	isHovered = false;
	isLocationCustom = false;
	pastePending = undefined;
	pasteStatus = 'idle';
	pasteMessage = '';

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

	hoveredSet(isHovered) {
		this.isHovered = isHovered;
	}

	locationCustomToggle() {
		this.isLocationCustom = !this.isLocationCustom;
	}

	pastePendingSet(pastePending) {
		this.pastePending = pastePending;
	}

	pasteStatusSet(pasteStatus, pasteMessage = '') {
		this.pasteStatus = pasteStatus;
		this.pasteMessage = pasteMessage;
	}
}

export { ImageStore };
