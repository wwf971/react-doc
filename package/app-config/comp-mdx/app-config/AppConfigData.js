// The config layers of an app, stacked (doc/README.md of the package app-config). Pure: no store, no
// page, no React; a doc page (the mode AppConfigView), a desktop app with a backend of its own and a
// test run the same functions. app-config-case.json beside this file is the contract: every case
// is run through appConfigStack by AppConfigData.test.js, and another implementation (the Python
// mirror of db-migration-tool) runs the same cases.
//
//   a layer      one item of kind config-layer: { label, order, isDisabled, value: nested mapping }
//   a declare    one item of kind config-declare: { app, keyList: [{ key (dotted), type, default,
//                label?, description?, valueList?, min?, max? }] }
//   the stack    partitions in their order, layers in a partition by order then key; a later layer
//                wins; a value is taken only for a declared key, of its type
import { parse as yamlParse } from 'yaml';

export const APP_CONFIG_TYPE_ID = 'app-config.config';
export const APP_CONFIG_KIND_LAYER = 'config-layer';
export const APP_CONFIG_KIND_DECLARE = 'config-declare';
export const APP_CONFIG_VALUE_TYPE_LIST = ['boolean', 'number', 'string', 'enum', 'string-list'];
// stale: a key no declaration names; type: a value not of its type (or a value where the declared keys
// below need a mapping); range: a number outside min / max; enum: a value its valueList does not hold
export const APP_CONFIG_PROBLEM_KIND_LIST = ['stale', 'type', 'range', 'enum'];
// the layer a write makes when the default partition has none (appConfigLayerWriteTarget)
export const APP_CONFIG_LAYER_FIRST = { name: 'main', partition: 'local', label: 'Local', order: 0 };

const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isUnset = (value) => value === undefined || value === null;

// the record key and the asset path of a layer named {name} in a partition
export const appConfigLayerKeyBuild = (partition, name) => `${partition}.${name}`;
export const appConfigLayerPathBuild = (partition, name) => `/layer/${partition}/${name}`;
export const appConfigDeclareKeyBuild = (app) => `declare.${app}`;

// a name a layer key can hold: letters, digits, "_" and "-", from a label
export function appConfigLayerNameBuild(label) {
	const name = String(label ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
	return name || 'layer';
}

// a layer from its text (yaml) or its data: every key taken as far as it can be
//   { label, order, isDisabled, value, message }   message: '' or why the text is not a layer
export function appConfigLayerParse(textOrData) {
	let data = textOrData;
	let message = '';
	if (typeof textOrData === 'string') {
		try {
			data = yamlParse(textOrData);
		} catch (error) {
			data = null;
			message = `not yaml: ${error.message}`;
		}
	}
	if (!isUnset(data) && !isMapping(data)) message = 'a layer is a mapping';
	const one = isMapping(data) ? data : {};
	return {
		label: typeof one.label === 'string' ? one.label : '',
		order: typeof one.order === 'number' && Number.isFinite(one.order) ? one.order : 0,
		isDisabled: one.isDisabled === true,
		value: isMapping(one.value) ? one.value : {},
		message: message || (!isUnset(one.value) && !isMapping(one.value) ? 'the value of a layer is a mapping' : ''),
	};
}

// a declaration from its text or data: { app, keyList, message }; an entry without a key or with a
// type not in APP_CONFIG_VALUE_TYPE_LIST is left out, and said
export function appConfigDeclareParse(textOrData) {
	let data = textOrData;
	let message = '';
	if (typeof textOrData === 'string') {
		try {
			data = yamlParse(textOrData);
		} catch (error) {
			data = null;
			message = `not yaml: ${error.message}`;
		}
	}
	const one = isMapping(data) ? data : {};
	const keyList = [];
	const leftList = [];
	for (const entry of Array.isArray(one.keyList) ? one.keyList : []) {
		if (isMapping(entry) && typeof entry.key === 'string' && entry.key && APP_CONFIG_VALUE_TYPE_LIST.includes(entry.type)) keyList.push(entry);
		else leftList.push(isMapping(entry) ? String(entry.key ?? '?') : '?');
	}
	if (leftList.length) message = `left out (no key, or a type not among ${APP_CONFIG_VALUE_TYPE_LIST.join(', ')}): ${leftList.join(', ')}`;
	return { app: typeof one.app === 'string' ? one.app : '', keyList, message };
}

// the keys of several declarations as one list: a key declared twice, the first wins
export function appConfigDeclareListMerge(keyListList) {
	const seen = new Set();
	const out = [];
	for (const keyList of keyListList) {
		for (const entry of keyList ?? []) {
			if (!entry || seen.has(entry.key)) continue;
			seen.add(entry.key);
			out.push(entry);
		}
	}
	return out;
}

// '' when the value is one of the declared key, else the kind of problem: type | range | enum
export function appConfigValueCheck(declare, value) {
	switch (declare?.type) {
		case 'boolean':
			return typeof value === 'boolean' ? '' : 'type';
		case 'number':
			if (typeof value !== 'number' || !Number.isFinite(value)) return 'type';
			if (typeof declare.min === 'number' && value < declare.min) return 'range';
			if (typeof declare.max === 'number' && value > declare.max) return 'range';
			return '';
		case 'string':
			return typeof value === 'string' ? '' : 'type';
		case 'enum':
			if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return 'type';
			return (declare.valueList ?? []).includes(value) ? '' : 'enum';
		case 'string-list':
			return Array.isArray(value) && value.every((one) => typeof one === 'string') ? '' : 'type';
		default:
			return 'type';
	}
}

const PROBLEM_TEXT = {
	stale: 'no declared key has this name: it is not used',
	type: 'not of the declared type: the layer below gives the value',
	range: 'outside the declared range: the layer below gives the value',
	enum: 'not one of the declared values: the layer below gives the value',
};

function problemMessage(kind, declare, value) {
	if (kind === 'type' && declare) return `${JSON.stringify(value)} is not a ${declare.type}: the layer below gives the value`;
	if (kind === 'range') return `${value} is outside ${declare.min ?? '…'} – ${declare.max ?? '…'}: the layer below gives the value`;
	if (kind === 'enum') return `${JSON.stringify(value)} is not one of ${(declare.valueList ?? []).join(', ')}: the layer below gives the value`;
	return PROBLEM_TEXT[kind] ?? kind;
}

// the value at a dotted key of a nested mapping; undefined when the way there breaks
export function appConfigValueAt(tree, dottedKey) {
	let node = tree;
	for (const part of String(dottedKey).split('.')) {
		if (!isMapping(node) || !(part in node)) return undefined;
		node = node[part];
	}
	return node;
}

// the order of the partitions: partitionOrder (the metadata of the object's entry) when given, the
// partitions it does not name after it in the order the type declares them, then any other
// alphabetically; without partitionOrder, the declared order, then the rest alphabetically
export function appConfigPartitionOrderBuild({ partitionOrder, partitionDeclaredList = [], partitionPresentList = [] }) {
	const out = [];
	const add = (one) => { if (typeof one === 'string' && one && !out.includes(one)) out.push(one); };
	if (Array.isArray(partitionOrder)) partitionOrder.forEach(add);
	(partitionDeclaredList ?? []).forEach(add);
	[...new Set(partitionPresentList)].filter((one) => !out.includes(one)).sort().forEach(add);
	return out;
}

// the layers in the order they stack: by the rank of their partition, then order, then key
export function appConfigLayerSort(layerList, partitionRankList) {
	const rank = new Map(partitionRankList.map((one, index) => [one, index]));
	const orderOf = (layer) => (typeof layer.order === 'number' && Number.isFinite(layer.order) ? layer.order : 0);
	return [...layerList].sort((a, b) => (rank.get(a.partition) ?? Infinity) - (rank.get(b.partition) ?? Infinity)
		|| orderOf(a) - orderOf(b)
		|| (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// every leaf of a nested mapping by its dotted path (arrays are leaves; null is not set)
function leafListOf(tree, path = '') {
	const out = [];
	for (const [part, value] of Object.entries(isMapping(tree) ? tree : {})) {
		const key = path ? `${path}.${part}` : part;
		if (isUnset(value)) continue;
		if (isMapping(value)) out.push(...leafListOf(value, key));
		else out.push([key, value]);
	}
	return out;
}

// what of a layer's value no declared key takes: the topmost such path, never walked into. A
// mapping on the way to declared keys is walked; something else there (a leaf where the keys below
// need a mapping) is a problem of type
function staleListOf(tree, declaredSet, prefixSet, path = '') {
	const out = [];
	for (const [part, value] of Object.entries(isMapping(tree) ? tree : {})) {
		const key = path ? `${path}.${part}` : part;
		if (isUnset(value) || declaredSet.has(key)) continue;
		if (prefixSet.has(key)) {
			if (isMapping(value)) out.push(...staleListOf(value, declaredSet, prefixSet, key));
			else out.push({ key, kind: 'type', value });
		} else out.push({ key, kind: 'stale', value });
	}
	return out;
}

// The stack: { value, sourceByKey, layerOrder, problemList, layerList, declareList }
//   value         { dottedKey: final value } for every declared key (its default when no layer sets
//                 it); untyped (no declaration at all): every key a layer sets
//   sourceByKey   { key: { layer, partition } } where a layer gave it, { isDefault: true } else
//   layerOrder    every layer key in stack order, disabled ones too
//   problemList   [{ layer, partition, key, kind, message }], in stack order; within a layer, what its
//                 value holds that no key takes (in the order of the mapping), then the declared keys
//                 in their order. A disabled layer is not read, so it has none
//   layerList     the layers in stack order, each with its rank
//   declareList   the declared keys, merged (the first of a key wins)
export function appConfigStack({ declareList = [], layerList = [], partitionOrder = null, partitionDeclaredList = [] } = {}) {
	const declared = appConfigDeclareListMerge([declareList]);
	const partitionRankList = appConfigPartitionOrderBuild({ partitionOrder, partitionDeclaredList, partitionPresentList: layerList.map((layer) => layer.partition) });
	const sorted = appConfigLayerSort(layerList, partitionRankList).map((layer, rank) => ({ ...layer, rank }));
	const value = {};
	const sourceByKey = {};
	const problemList = [];
	if (declared.length === 0) {
		for (const layer of sorted) {
			if (layer.isDisabled === true) continue;
			for (const [key, leaf] of leafListOf(layer.value)) {
				value[key] = leaf;
				sourceByKey[key] = { layer: layer.key, partition: layer.partition };
			}
		}
	} else {
		const declaredSet = new Set(declared.map((one) => one.key));
		const prefixSet = new Set(declared.flatMap((one) => one.key.split('.').slice(0, -1).map((_, index, list) => list.slice(0, index + 1).join('.'))));
		for (const one of declared) {
			value[one.key] = one.default === undefined ? null : one.default;
			sourceByKey[one.key] = { isDefault: true };
		}
		for (const layer of sorted) {
			if (layer.isDisabled === true) continue;
			for (const stale of staleListOf(layer.value, declaredSet, prefixSet)) {
				problemList.push({ layer: layer.key, partition: layer.partition, key: stale.key, kind: stale.kind,
					message: stale.kind === 'stale' ? PROBLEM_TEXT.stale : 'the keys declared below it need a mapping here' });
			}
			for (const one of declared) {
				const found = appConfigValueAt(layer.value, one.key);
				if (isUnset(found)) continue;
				const kind = appConfigValueCheck(one, found);
				if (kind) {
					problemList.push({ layer: layer.key, partition: layer.partition, key: one.key, kind, message: problemMessage(kind, one, found) });
					continue;
				}
				value[one.key] = found;
				sourceByKey[one.key] = { layer: layer.key, partition: layer.partition };
			}
		}
	}
	return { value, sourceByKey, layerOrder: sorted.map((layer) => layer.key), problemList, layerList: sorted, declareList: declared };
}

// a layer's value with one key set: a new nested mapping, the old one untouched; null (or undefined)
// removes the key, and the mappings it leaves empty
export function appConfigValueSet(layerValue, dottedKey, value) {
	const partList = String(dottedKey).split('.').filter(Boolean);
	const set = (node, index) => {
		const out = isMapping(node) ? { ...node } : {};
		const part = partList[index];
		if (index === partList.length - 1) {
			if (isUnset(value)) delete out[part];
			else out[part] = value;
			return out;
		}
		const child = set(out[part], index + 1);
		if (Object.keys(child).length === 0) delete out[part];
		else out[part] = child;
		return out;
	};
	return partList.length ? set(layerValue, 0) : (isMapping(layerValue) ? { ...layerValue } : {});
}

// where a write naming no layer goes: the top-most enabled layer of the default partition (the
// layer, from layerList), or null, when the writer makes APP_CONFIG_LAYER_FIRST (local.main)
export function appConfigLayerWriteTarget({ layerOrder, layerList = [], partitionDefault = APP_CONFIG_LAYER_FIRST.partition } = {}) {
	const byKey = new Map(layerList.map((layer) => [layer.key, layer]));
	const orderList = layerOrder ?? layerList.map((layer) => layer.key);
	for (let index = orderList.length - 1; index >= 0; index -= 1) {
		const layer = byKey.get(orderList[index]);
		if (layer && layer.partition === partitionDefault && layer.isDisabled !== true) return layer;
	}
	return null;
}

// a value as a person reads it: a list joined, nothing as an em dash
export function appConfigValueText(value) {
	if (isUnset(value)) return '—';
	if (Array.isArray(value)) return value.length ? value.join(', ') : '(none)';
	if (isMapping(value)) return JSON.stringify(value);
	return String(value);
}

// a text typed into a cell, read as a value of the declared key: { value } or { message }
export function appConfigValueFromText(declare, text) {
	const raw = String(text ?? '').trim();
	switch (declare?.type) {
		case 'number': {
			const number = Number(raw);
			if (!raw || !Number.isFinite(number)) return { message: 'a number' };
			const kind = appConfigValueCheck(declare, number);
			return kind === 'range' ? { message: `between ${declare.min ?? '…'} and ${declare.max ?? '…'}` } : { value: number };
		}
		case 'string-list':
			return { value: raw.split(/[\n,]/).map((one) => one.trim()).filter(Boolean) };
		case 'enum': {
			const found = (declare.valueList ?? []).find((one) => String(one) === raw);
			return found === undefined ? { message: `one of ${(declare.valueList ?? []).join(', ')}` } : { value: found };
		}
		case 'boolean':
			if (raw === 'true' || raw === 'false') return { value: raw === 'true' };
			return { message: 'true or false' };
		default:
			return { value: String(text ?? '') };
	}
}
