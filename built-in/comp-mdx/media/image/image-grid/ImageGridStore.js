import { makeAutoObservable } from 'mobx';
import { load as yamlLoad } from 'js-yaml';
import { imageGridDataParse, imageGridRawBuild } from './ImageGridData.js';
import { imageDeleteFileListBuild } from '../image/image-paste.js';

// the parsed data of an ImageGrid block (ImageGridData.js): the images (a
// slot may be empty, without src: the state a new grid is created in,
// filled by pasting into the slot) and the layout options.
// rawWithImageReplaced builds the yaml of the grid with one slot replaced,
// for a paste into that slot in view mode.
class ImageGridStore {
	imageList = [];
	message = '';
	options = {};
	// the mapping of the block as authored, the base of a rewrite
	fields = undefined;

	constructor(data = {}) {
		makeAutoObservable(this, {}, { autoBind: true });
		this.dataLoad(data);
	}

	dataLoad(data = {}) {
		try {
			const { fields, imageList } = imageGridDataParse(data);
			this.imageList = imageList;
			this.options = {
				gap: fields.gap,
				itemWidth: fields.itemWidth,
			};
			this.fields = fields;
			this.message = '';
		} catch (error) {
			this.imageList = [];
			this.options = {};
			this.fields = undefined;
			this.message = String(error?.message ?? error);
		}
	}

	// the yaml of the grid with the image at index replaced by the mapping
	// parsed from imageRaw (the yaml an Image reports for itself); the other
	// fields of the block are kept
	rawWithImageReplaced(index, imageRaw) {
		const fields = this.fields ?? { images: [] };
		const imageParsed = yamlLoad(imageRaw);
		const imageNext = imageParsed && typeof imageParsed === 'object' && !Array.isArray(imageParsed) ? imageParsed : { src: String(imageParsed ?? '') };
		const images = [...(fields.images ?? [])];
		images[index] = imageNext;
		return imageGridRawBuild(fields, images);
	}
}

// the files an ImageGrid's data refers to (compDefine assetDependencyListGet):
// the source of every filled slot
export function imageGridAssetDependencyListGet(data) {
	const store = new ImageGridStore(data);
	if (store.message) return [];
	return store.imageList
		.map((image) => String(image.src ?? image.source ?? '').trim())
		.filter((source) => source !== '')
		.map((source) => ({ type: 'source', path: source }));
}

export function imageGridDeleteFileListGet(data) {
	return imageDeleteFileListBuild(imageGridAssetDependencyListGet(data));
}

export { ImageGridStore };
