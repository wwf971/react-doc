import { makeAutoObservable, toJS } from 'mobx';
import { imageGridDataParse, imageGridRawBuild } from './ImageGridData.js';

// the draft of an ImageGrid block being edited in its 'images' mode: the
// slots and the layout fields of the block as plain data. ImageGridEdit
// renders the grid from the draft and serializes it back to yaml after
// every change; fields the editor does not know are kept as authored.
export const imageGridEditFieldList = ['gap', 'itemWidth'];

export class ImageGridEditStore {
	fields = {};
	imageList = [];
	message = '';

	constructor(data = {}) {
		makeAutoObservable(this);
		try {
			const { fields, imageList } = imageGridDataParse(data);
			this.fields = fields;
			this.imageList = imageList;
		} catch (error) {
			this.fields = { images: [] };
			this.imageList = [];
			this.message = String(error?.message ?? error);
		}
	}

	// a pasted image becomes the source of the slot; the other keys of the
	// slot (caption, displayMode, ...) stay
	imageSourceSet(index, sourcePath) {
		if (!this.imageList[index]) return;
		this.imageList[index] = { ...this.imageList[index], src: sourcePath };
	}

	// an empty slot at the end: the placeholder that takes a paste
	imageAdd() {
		this.imageList.push({});
	}

	imageRemove(index) {
		this.imageList.splice(index, 1);
	}

	// a layout field: a number stays a number, an empty value removes the key
	fieldSet(name, value) {
		const valueText = String(value ?? '').trim();
		if (valueText === '') {
			delete this.fields[name];
			return;
		}
		this.fields[name] = /^\d+(?:\.\d+)?$/.test(valueText) ? Number(valueText) : valueText;
	}

	get options() {
		return { gap: this.fields.gap, itemWidth: this.fields.itemWidth };
	}

	get rawYaml() {
		return imageGridRawBuild(toJS(this.fields), toJS(this.imageList));
	}
}
