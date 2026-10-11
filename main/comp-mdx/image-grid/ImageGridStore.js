import { makeAutoObservable } from 'mobx';
import { load as yamlLoad } from 'js-yaml';
import { yamlStringify } from '../../frontend/src/lib/yaml.js';

// the parsed data of an ImageGrid block: the images (a slot may be empty,
// without src: the state a new grid is created in, filled by pasting into
// the slot) and the layout options. rawWithImageReplaced builds the yaml of
// the grid with one slot replaced, for a paste into that slot.
class ImageGridStore {
	imageList = [];
	message = '';
	options = {};
	// the parsed mapping of the block, the base of a rewrite
	dataParsed = undefined;

	constructor(data = {}) {
		makeAutoObservable(this, {}, { autoBind: true });
		this.dataLoad(data);
	}

	dataLoad(data = {}) {
		try {
			const dataParsed = data.raw?.trim() ? yamlLoad(data.raw) : data;
			if (!dataParsed || typeof dataParsed !== 'object' || Array.isArray(dataParsed)) {
				throw new Error('The image grid data must be an object.');
			}
			if (!Array.isArray(dataParsed.images)) {
				throw new Error('The image grid requires an images list.');
			}
			this.imageList = dataParsed.images.map((image, index) => imageNormalize(image, index));
			this.options = {
				gap: dataParsed.gap,
				itemWidth: dataParsed.itemWidth,
			};
			this.dataParsed = dataParsed;
			this.message = '';
		} catch (error) {
			this.imageList = [];
			this.options = {};
			this.dataParsed = undefined;
			this.message = String(error?.message ?? error);
		}
	}

	// the yaml of the grid with the image at index replaced by the mapping
	// parsed from imageRaw (the yaml an Image reports for itself); the other
	// fields of the block are kept
	rawWithImageReplaced(index, imageRaw) {
		const { raw: _raw, lang: _lang, content: _content, ...fields } = this.dataParsed ?? { images: [] };
		const imageParsed = yamlLoad(imageRaw);
		const imageNext = imageParsed && typeof imageParsed === 'object' && !Array.isArray(imageParsed) ? imageParsed : { src: String(imageParsed ?? '') };
		const images = [...(fields.images ?? [])];
		images[index] = imageNext;
		return yamlStringify({ ...fields, images });
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

// a slot: a path, a mapping, or empty (null / {} / a mapping without src)
function imageNormalize(image, index) {
	if (image === null || image === undefined) return {};
	if (typeof image === 'string') return { src: image };
	if (!image || typeof image !== 'object' || Array.isArray(image)) {
		throw new Error(`Image ${index + 1} must be a path or an object.`);
	}
	return image;
}

export { ImageGridStore };
