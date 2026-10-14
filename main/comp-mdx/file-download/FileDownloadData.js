import { yamlParse } from '../../frontend/src/lib/yaml.js';

// data of a FileDownload block: a yaml mapping (the fenced block) or the
// authored properties
//   src    the file, a source path or a path relative to the document
//   name   the file name shown and downloaded as (default: the last part of src)
//   icon   tag name or id of a registered component drawing the file
//          (placement fileDownloadIcon); default by extension, else FileIcon
//   size   the size text of the detailed view
//   view   'detailed' (default) | 'compact'
export function fileDownloadDataParse(data = {}) {
	const parsed = data.raw ? yamlParse(data.raw) : data;
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('FileDownload data must be a mapping');
	const src = String(parsed.src ?? '').trim();
	if (!src) throw new Error('FileDownload requires src');
	const fileName = String(parsed.name ?? src.split(/[\\/]/).pop()).trim();
	const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
	return {
		src,
		fileName,
		extension,
		icon: String(parsed.icon ?? '').trim(),
		size: String(parsed.size ?? '').trim(),
		view: parsed.view === 'compact' ? 'compact' : 'detailed',
	};
}

// the file the data refers to, recorded as a dependency of an asset made
// from it (doc_page_impl_asset.md#dependencies)
export function fileDownloadAssetDependencyListGet(data) {
	try {
		return [{ type: 'source', path: fileDownloadDataParse(data).src }];
	} catch {
		return [];
	}
}
