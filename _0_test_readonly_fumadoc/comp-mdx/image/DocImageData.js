import { yamlParse } from '../../frontend/src/lib/yaml.js';

function docImageDataParse(data) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error('Image data must be a mapping.');
	}
	const raw = typeof data.raw === 'string' ? data.raw.trim() : '';
	if (!raw || String(data.src ?? data.source ?? '').trim()) return data;
	const dataParsed = yamlParse(raw);
	if (!dataParsed || typeof dataParsed !== 'object' || Array.isArray(dataParsed)) {
		throw new Error('Image YAML must contain a mapping.');
	}
	const { raw: _raw, lang: _lang, ...dataExplicit } = data;
	return { ...dataParsed, ...dataExplicit };
}

export { docImageDataParse };
