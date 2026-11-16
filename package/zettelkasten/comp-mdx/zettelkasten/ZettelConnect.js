import { zettelDocParse, zettelDocTextBuild } from './ZettelDoc.js';

// Writing the connections of a zettel (doc/README.md#editing): what a reader adds or removes in
// the dialog of a zettel while the document is edited, as a change of its frontmatter. Pure:
// text in, text out. The checks (the other zettel exists, a containment closes no cycle) are the
// caller's, against the model, before anything is written.
//
//   type link          this zettel points at `to` (connectionList: { to, isDirected?, label? })
//   type contain       this zettel holds `to` (connectionList: { type: contain, to })
//   type containedBy   `to` holds this zettel (parent: one key, or a list of keys)
//
// a label is { kind: text, text } | { kind: zettel, key } | { kind: object, ref }, written as a
// text, { zettel } or { object }. groups (lists, arrays, maps) are written in the frontmatter by hand.
export const ZETTEL_CONNECT_TYPE_LIST = ['link', 'contain', 'containedBy'];

const keyListOf = (value) => (Array.isArray(value) ? value.map(String) : value === undefined || value === null || value === '' ? [] : [String(value)]);
const keyNormalize = (value) => String(value ?? '').trim().replace(/^.*\//, '').replace(/\.mdx?$/, '');

function labelWrite(label) {
	if (!label) return undefined;
	if (label.kind === 'zettel' && label.key) return { zettel: label.key };
	if (label.kind === 'object' && label.ref) return { object: label.ref };
	if (label.kind === 'text' && label.text) return label.text;
	if (typeof label === 'string' && label) return label;
	return undefined;
}

// the connections a zettel writes itself, one by one, as the dialog lists them to be removed:
// [{ type, to, label, isDirected }] (a group is not among them: it is edited as text)
export function zettelConnectionWrittenListOf(text) {
	const { meta } = zettelDocParse(text);
	const list = keyListOf(meta.parent ?? meta.hub).map((to) => ({ type: 'containedBy', to: keyNormalize(to), label: null, isDirected: true }));
	for (const entry of Array.isArray(meta.connectionList) ? meta.connectionList : []) {
		if (!entry || typeof entry !== 'object' || entry.group !== undefined || entry.itemList !== undefined) continue;
		for (const to of keyListOf(entry.to)) list.push({ type: entry.type === 'contain' ? 'contain' : 'link', to: keyNormalize(to), label: entry.label ?? null, isDirected: entry.isDirected !== false });
	}
	return list;
}

// the text of a zettel with one connection more
export function zettelConnectionAddMeta(text, { type, to, label = null, isDirected = true }) {
	const { meta, body } = zettelDocParse(text);
	const key = keyNormalize(to);
	const metaNext = { ...meta };
	if (type === 'containedBy') {
		const field = meta.parent === undefined && meta.hub !== undefined ? 'hub' : 'parent';
		const list = keyListOf(meta[field]);
		if (!list.includes(key)) list.push(key);
		metaNext[field] = list.length === 1 ? list[0] : list;
	} else {
		const entry = { to: key };
		if (type === 'contain') entry.type = 'contain';
		else if (isDirected === false) entry.isDirected = false;
		const labelWritten = type === 'contain' ? undefined : labelWrite(label);
		if (labelWritten !== undefined) entry.label = labelWritten;
		metaNext.connectionList = [...(Array.isArray(meta.connectionList) ? meta.connectionList : []), entry];
	}
	return zettelDocTextBuild(metaNext, body);
}

// the text of a zettel without one connection it wrote (the first of that type to that zettel)
export function zettelConnectionRemoveMeta(text, { type, to }) {
	const { meta, body } = zettelDocParse(text);
	const key = keyNormalize(to);
	const metaNext = { ...meta };
	if (type === 'containedBy') {
		const field = meta.parent === undefined && meta.hub !== undefined ? 'hub' : 'parent';
		const list = keyListOf(meta[field]).filter((one) => keyNormalize(one) !== key);
		if (list.length === 0) delete metaNext[field];
		else metaNext[field] = list.length === 1 ? list[0] : list;
	} else {
		const list = Array.isArray(meta.connectionList) ? [...meta.connectionList] : [];
		const index = list.findIndex((entry) => entry && typeof entry === 'object' && entry.group === undefined && (entry.type === 'contain' ? 'contain' : 'link') === type && keyListOf(entry.to).map(keyNormalize).includes(key));
		if (index >= 0) {
			const entry = list[index];
			const toList = keyListOf(entry.to).filter((one) => keyNormalize(one) !== key);
			if (toList.length === 0) list.splice(index, 1);
			else list[index] = { ...entry, to: toList.length === 1 ? toList[0] : toList };
		}
		if (list.length === 0) delete metaNext.connectionList;
		else metaNext.connectionList = list;
	}
	return zettelDocTextBuild(metaNext, body);
}
