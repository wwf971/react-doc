import { yamlStringify } from '../../frontend/src/lib/yaml.js';
import { imageDataParse } from './ImageData.js';

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

// image-20260101-120000.png: the moment of the paste, with the extension
// of the pasted type; the source layer makes it unique in the folder
export function pastedFileNameBuild(file, timeNow = new Date()) {
	const extByType = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };
	const ext = extByType[file.type] ?? 'png';
	const pad = (number) => String(number).padStart(2, '0');
	const dateText = `${timeNow.getFullYear()}${pad(timeNow.getMonth() + 1)}${pad(timeNow.getDate())}`;
	const timeText = `${pad(timeNow.getHours())}${pad(timeNow.getMinutes())}${pad(timeNow.getSeconds())}`;
	return `image-${dateText}-${timeText}.${ext}`;
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
