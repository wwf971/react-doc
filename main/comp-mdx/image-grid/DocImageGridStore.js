import { makeAutoObservable } from 'mobx';
import { load as yamlLoad } from 'js-yaml';

class DocImageGridStore {
	imageList = [];
	message = '';
	options = {};

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
			this.message = '';
		} catch (error) {
			this.imageList = [];
			this.options = {};
			this.message = String(error?.message ?? error);
		}
	}
}

function imageNormalize(image, index) {
	if (typeof image === 'string') return { src: image };
	if (!image || typeof image !== 'object' || Array.isArray(image)) {
		throw new Error(`Image ${index + 1} must be a path or an object.`);
	}
	if (!String(image.src ?? image.source ?? '').trim()) {
		throw new Error(`Image ${index + 1} requires src.`);
	}
	return image;
}

export { DocImageGridStore };