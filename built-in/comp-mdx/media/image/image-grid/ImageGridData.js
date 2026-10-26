import { load as yamlLoad } from 'js-yaml';
import { yamlStringify } from '../../../../../main/frontend/src/lib/yaml.js';

// The data of an ImageGrid block in both directions: parsed for rendering
// (ImageGridStore) and for the draft of the editor (ImageGridEditStore),
// serialized again as the yaml of the block.
//
// the parsed form: { fields, imageList }
//   fields      the mapping of the block as authored (images, gap, itemWidth,
//               and anything else), the base of a rewrite
//   imageList   one entry per slot: the mapping of that image; a slot may be
//               empty (no src), the state a new grid is created in, filled by
//               pasting into it

export function imageGridDataParse(data = {}) {
	const dataParsed = typeof data.raw === 'string' && data.raw.trim() ? yamlLoad(data.raw) : data;
	if (!dataParsed || typeof dataParsed !== 'object' || Array.isArray(dataParsed)) {
		throw new Error('The image grid data must be an object.');
	}
	if (!Array.isArray(dataParsed.images)) {
		throw new Error('The image grid requires an images list.');
	}
	const { raw: _raw, lang: _lang, content: _content, ...fields } = dataParsed;
	return {
		fields,
		imageList: dataParsed.images.map((image, index) => imageNormalize(image, index)),
	};
}

// the yaml of the grid: the fields as authored, with the images list replaced
export function imageGridRawBuild(fields, imageList) {
	return yamlStringify({ ...fields, images: imageList });
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
