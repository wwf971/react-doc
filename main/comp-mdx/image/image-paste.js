import { yamlStringify } from '../../frontend/src/lib/yaml.js';
import { imageDataParse } from './ImageData.js';
import { timeTextGet } from '../../frontend/src/lib/time-text.js';

// The paste flow of Image (image-req.md#paste), kept apart from the view:
// the image file of a clipboard event, the name the file is written as,
// and the yaml of the block with the new source.

// the first image file of a clipboard event; undefined when none
export function clipboardImageFileGet(clipboardData) {
	for (const item of clipboardData?.items ?? []) {
		if (item.kind === 'file' && item.type.startsWith('image/')) {
			const file = item.getAsFile();
			if (file) return file;
		}
	}
	return undefined;
}

// a paste whose target is a text field belongs to that field, not to the
// image under the pointer
export function pasteTargetIsText(target) {
	if (!(target instanceof Element)) return false;
	return Boolean(target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'));
}

// image-20260101_12000000+09.png: the moment of the paste in the time
// format of the project (lib/time-text.js), with the extension of the
// pasted type; the doc page source service layer makes it unique in the folder
export function pastedFileNameBuild(file, timeNow = new Date()) {
	const extByType = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };
	const ext = extByType[file.type] ?? 'png';
	return `image-${timeTextGet(timeNow)}.${ext}`;
}

// the yaml mapping of the image with src replaced; the other fields of the
// block are kept, in their order
export function imageRawWithSourceBuild(data, sourcePath) {
	const { raw: _raw, lang: _lang, content: _content, source: _source, ...fields } = imageDataParse(data);
	return yamlStringify({ ...fields, src: sourcePath });
}

// the component-level config keys of Image and ImageGrid
// (doc_page_impl_config.md#component-level-config)
export const imageConfigDefineList = [
	{
		key: 'FileStoreDir',
		type: 'sourcePath',
		pathSpec: { kind: 'dir' },
		valueDefault: null,
		description: 'The folder of the source a pasted image is written to; empty asks for the folder at every paste.',
	},
	{
		key: 'PasteReplaceConfirmIsOn',
		type: 'boolean',
		valueDefault: true,
		description: 'Ask before a pasted image replaces an existing one.',
	},
];

// the files an Image's data refers to (compDefine assetDependencyListGet):
// its source, as a reference the edit layer resolves against the document
export function imageAssetDependencyListGet(data) {
	try {
		const dataParsed = imageDataParse(data);
		const source = String(dataParsed.src ?? dataParsed.source ?? '').trim();
		return source ? [{ type: 'source', path: source }] : [];
	} catch {
		return [];
	}
}
