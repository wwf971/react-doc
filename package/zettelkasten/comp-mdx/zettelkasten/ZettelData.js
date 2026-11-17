// The data items of a zettelkasten (doc/README.md#a-zettel-is-a-card) and the model they form
// once read: the zettels, and the connections between them. Pure: the items come from anywhere
// (the assets of a frontend object, a test).
//
//   kind zettel     a knowledge zettel, a document: frontmatter { level, parent, title, summary, connectionList, questionList, sourceList, flow? }, body
//   kind question   a question zettel, a document: frontmatter { number, hub, title, summary, stem, optionList, answer, clueList, zettelList }, body: the analysis
//   kind note       a note of the reader on a place of a zettel, a document: frontmatter { target, place?, timeCreate }, body
//   kind progress   how the reader did on the questions, yaml: { statusByQuestion: { [key]: { status, time } } }
//
// a connection joins two zettels, one record read from both ends:
//
//   type contain    the first holds the second. written on the held one (parent: a key or a list of
//                   keys), or on the holder (connectionList: { type: contain, to }); a question is held
//                   by its hub. never a cycle: a containment that would close one is left out
//   type link       the first points at the second (or, isDirected false, they are only related):
//                   a Markdown link in a text, or written in connectionList, with a label that is a
//                   text, another zettel or an object of the page
//   a group         several connections of one zettel aligned together: a list, an array (indexed
//                   from 0) or a map (a key for each). the options of a question are a map
//
// a zettel names another by its key, which never changes, never by a path: the paths of the
// assets (/zettel/{hub}/{topic}, /question/q001) are an index for browsing.

import { zettelDocLinkListRead, zettelDocParse, zettelDocPlain, zettelDocSectionListRead, zettelOptionAnchorOf, zettelOptionOfAnchor } from './ZettelDoc.js';

export const ZETTEL_KIND_LIST = ['zettel', 'question', 'note', 'progress'];
export const ZETTEL_LEVEL_LIST = ['root', 'hub', 'topic', 'fact'];
export const ZETTEL_PROGRESS_STATUS_LIST = ['right', 'wrong', 'review'];
export const ZETTEL_PROGRESS_KEY = 'progress';
export const ZETTEL_CONNECTION_TYPE_LIST = ['link', 'contain'];
export const ZETTEL_GROUP_FORM_LIST = ['list', 'array', 'map'];
// the groups every question has, made of its data
export const ZETTEL_GROUP_OPTION = 'option';
export const ZETTEL_GROUP_NEEDED = 'needed';

// ---------- the items read ----------

export function zettelQuestionKeyBuild(number) {
	return `q${String(number).padStart(3, '0')}`;
}

const textOf = (value) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value));
const listOf = (value) => (Array.isArray(value) ? value : []);
// a key as written: card-atomic, or its file name card-atomic.md
const keyOf = (value) => textOf(value).trim().replace(/^.*\//, '').replace(/\.mdx?$/, '');
const keyListOf = (value) => (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]).map(keyOf).filter(Boolean);
const idOfText = (text) => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function flowRead(flow) {
	if (!flow || typeof flow !== 'object' || !Array.isArray(flow.stepList)) return null;
	const stepList = flow.stepList.filter((step) => step && step.id).map((step) => ({ id: textOf(step.id), title: textOf(step.title) || textOf(step.id), text: textOf(step.text), zettel: textOf(step.zettel), tone: textOf(step.tone) }));
	if (stepList.length === 0) return null;
	const idSet = new Set(stepList.map((step) => step.id));
	const edgeWritten = Array.isArray(flow.edgeList) ? flow.edgeList : stepList.slice(1).map((step, index) => ({ from: stepList[index].id, to: step.id }));
	const edgeList = edgeWritten.filter((edge) => edge && idSet.has(edge.from) && idSet.has(edge.to) && edge.from !== edge.to).map((edge) => ({ from: textOf(edge.from), to: textOf(edge.to), label: textOf(edge.label) }));
	return { title: textOf(flow.title), stepList, edgeList };
}

// the label of a connection as written: a text, { text }, { zettel: key } or { object: ref }.
// answers { kind: text | zettel | object, text, key, ref } or null
export function zettelLabelRead(value) {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value !== 'object') return { kind: 'text', text: textOf(value), key: '', ref: '' };
	if (value.zettel) return { kind: 'zettel', text: textOf(value.text), key: keyOf(value.zettel), ref: '' };
	if (value.object) return { kind: 'object', text: textOf(value.text), key: '', ref: textOf(value.object).trim() };
	if (value.text) return { kind: 'text', text: textOf(value.text), key: '', ref: '' };
	return null;
}

// what connectionList of a frontmatter writes: single connections and groups, still by key, with
// the place each entry stands at (its index), for a message
function connectionWrittenRead(zettelKey, value, problemList) {
	const entryList = [];
	const groupList = [];
	listOf(value).forEach((entry, index) => {
		if (!entry || typeof entry !== 'object') {
			problemList.push(`${zettelKey}: connectionList[${index}] is not a mapping`);
			return;
		}
		const type = ZETTEL_CONNECTION_TYPE_LIST.includes(entry.type) ? entry.type : 'link';
		if (entry.type !== undefined && !ZETTEL_CONNECTION_TYPE_LIST.includes(entry.type)) problemList.push(`${zettelKey}: connectionList[${index}] has the type "${entry.type}", read as link (link | contain)`);
		const isDirected = type === 'contain' ? true : entry.isDirected !== false;
		if (entry.group !== undefined || entry.itemList !== undefined) {
			const form = ZETTEL_GROUP_FORM_LIST.includes(entry.form) ? entry.form : 'list';
			if (entry.form !== undefined && !ZETTEL_GROUP_FORM_LIST.includes(entry.form)) problemList.push(`${zettelKey}: the group connectionList[${index}] has the form "${entry.form}", read as list (list | array | map)`);
			const label = textOf(entry.group) || textOf(entry.label);
			const itemList = [];
			listOf(entry.itemList).forEach((item, itemIndex) => {
				const itemValue = item && typeof item === 'object' ? item : { to: item };
				for (const to of keyListOf(itemValue.to)) itemList.push({ index: itemIndex, key: form === 'map' ? textOf(itemValue.key) || String(itemIndex) : form === 'array' ? String(itemIndex) : '', to, label: zettelLabelRead(itemValue.label) });
			});
			groupList.push({ id: textOf(entry.id) || idOfText(label) || `group-${index + 1}`, label, form, type, isDirected, itemList });
			return;
		}
		const toList = keyListOf(entry.to);
		if (toList.length === 0) problemList.push(`${zettelKey}: connectionList[${index}] names no zettel (to)`);
		for (const to of toList) entryList.push({ type, to, isDirected, label: zettelLabelRead(entry.label) });
	});
	return { entryList, groupList };
}

// a zettel is a Markdown item: its data is the frontmatter, its text the body (ZettelDoc.js)
function zettelRead(item, problemList) {
	const { meta: data, body, message } = zettelDocParse(item.text);
	if (message) problemList.push(`${item.key}: its frontmatter does not parse: ${message}`);
	const level = ZETTEL_LEVEL_LIST.includes(data.level) ? data.level : 'topic';
	return {
		key: item.key,
		kind: 'zettel',
		level,
		parentWrittenList: keyListOf(data.parent),
		title: textOf(data.title) || item.name || item.key,
		label: textOf(data.label),
		summary: textOf(data.summary).trim(),
		tagList: listOf(data.tagList).map(textOf),
		body,
		sectionList: zettelDocSectionListRead(body),
		connectionWritten: connectionWrittenRead(item.key, data.connectionList, problemList),
		questionList: listOf(data.questionList).filter((one) => one?.ref).map((one) => ({ key: textOf(one.ref), option: textOf(one.option), text: textOf(one.text) })),
		sourceList: listOf(data.sourceList).filter((one) => one?.url).map((one) => ({ title: textOf(one.title) || textOf(one.url), url: textOf(one.url) })),
		flow: flowRead(data.flow),
		isUnverified: data.isVerified === false,
		partition: item.partition ?? '',
	};
}

function questionRead(item, problemList) {
	const { meta: data, body, message } = zettelDocParse(item.text);
	if (message) problemList.push(`${item.key}: its frontmatter does not parse: ${message}`);
	const answer = textOf(data.answer);
	return {
		key: item.key,
		kind: 'question',
		level: 'question',
		number: Number(data.number) || 0,
		parentWrittenList: keyListOf(data.hub),
		hub: textOf(data.hub),
		title: textOf(data.title) || item.name || item.key,
		label: '',
		summary: textOf(data.summary).trim(),
		stem: textOf(data.stem),
		optionList: listOf(data.optionList).filter((option) => option?.id).map((option) => ({
			id: textOf(option.id),
			text: textOf(option.text),
			isCorrect: option.verdict ? option.verdict === 'correct' : answer.includes(textOf(option.id)),
			isMostVoted: option.isMostVoted === true,
			zettelList: listOf(option.zettelList).map(textOf),
		})),
		answer,
		answerDump: textOf(data.answerDump),
		answerConfidence: textOf(data.answerConfidence) || 'high',
		isAnalysed: data.isAnalysed !== false,
		voteList: listOf(data.voteList).filter((vote) => vote?.answer).map((vote) => ({ answer: textOf(vote.answer), percent: Number(vote.percent) || 0 })),
		clueList: listOf(data.clueList).filter((clue) => clue?.text).map((clue) => ({ text: textOf(clue.text), implies: textOf(clue.implies) })),
		zettelList: listOf(data.zettelList).map(textOf),
		sourceList: listOf(data.sourceList).filter((one) => one?.url).map((one) => ({ title: textOf(one.title) || textOf(one.url), url: textOf(one.url) })),
		body,
		sectionList: zettelDocSectionListRead(body),
		connectionWritten: connectionWrittenRead(item.key, data.connectionList, problemList),
		questionList: [],
		tagList: [],
		flow: null,
		isUnverified: data.isVerified === false,
		partition: item.partition ?? '',
	};
}

// the places of a zettel a link may name: the ids of its sections and of the Anchor markers in
// them; for a question also option-a, option-b ... whether or not its text has such a section
export function zettelPlaceSetOf(zettel) {
	const set = new Set();
	for (const section of zettel.sectionList) {
		if (section.id) set.add(section.id);
		for (const id of section.anchorList) set.add(id);
	}
	if (zettel.kind === 'question') for (const option of zettel.optionList) set.add(zettelOptionAnchorOf(option.id));
	return set;
}

// the line around a link, for a backlink: links shown by their words
function linkContextRead(text, link) {
	const start = text.lastIndexOf('\n', link.index) + 1;
	const endFound = text.indexOf('\n', link.index);
	const plain = zettelDocPlain(text.slice(start, endFound < 0 ? text.length : endFound));
	return plain.length > 220 ? `${plain.slice(0, 217)}…` : plain;
}

// ---------- containment, a graph without cycles ----------

// the chain by which `from` already reaches `to` through containment ([from, …, to]), or []
function containPathFind(containListByKey, from, to) {
	if (from === to) return [from];
	const previousByKey = new Map([[from, '']]);
	const queue = [from];
	while (queue.length > 0) {
		const key = queue.shift();
		for (const child of containListByKey.get(key) ?? []) {
			if (previousByKey.has(child)) continue;
			previousByKey.set(child, key);
			if (child === to) {
				const chain = [to];
				for (let one = key; one; one = previousByKey.get(one)) chain.unshift(one);
				return chain;
			}
			queue.push(child);
		}
	}
	return [];
}

// would `containerKey` holding `containedKey` close a cycle? answers the chain by which the
// contained zettel already holds the container ([contained, …, container]; [key] for a zettel
// holding itself), [] when it would not. what the model reads, and what a write asks first
export function zettelContainCycleFind(model, containerKey, containedKey) {
	return containPathFind(model.containListByKey, containedKey, containerKey);
}

// the same as a sentence for a reader, '' when there is no cycle
export function zettelContainCycleText(model, containerKey, containedKey) {
	const chain = zettelContainCycleFind(model, containerKey, containedKey);
	if (chain.length === 0) return '';
	const titleOf = (key) => `“${zettelLabelOf(model.zettelByKey.get(key)) || key}”`;
	if (chain.length === 1) return `A zettel cannot contain itself (${titleOf(containedKey)}).`;
	return `${titleOf(containedKey)} already contains ${titleOf(containerKey)} (${chain.map(titleOf).join(' › ')}), so the other way round would make a cycle.`;
}

// ---------- the model ----------

// itemList: [{ key, kind, name, path, partition, text, data }], the assets of the object that are read
// (text: of a document; data: of the yaml item of the progress).
// answers a model: the zettels by key, the containment between them (without cycles), the links
// and groups read both ways, the notes by the zettel they are on, the progress, and what does not fit
export function zettelModelBuild(itemList, { rootKey = '' } = {}) {
	const problemList = [];
	const zettelByKey = new Map();
	const noteList = [];
	let progress = { key: '', statusByQuestion: {} };
	for (const item of itemList) {
		if (item.kind === 'zettel') zettelByKey.set(item.key, zettelRead(item, problemList));
		else if (item.kind === 'question') zettelByKey.set(item.key, questionRead(item, problemList));
		else if (item.kind === 'note') {
			const { meta: data, body } = zettelDocParse(item.text);
			if (data.target) noteList.push({ key: item.key, target: textOf(data.target), place: textOf(data.place), text: body.trim(), timeCreate: textOf(data.timeCreate), partition: item.partition ?? '' });
		} else if (item.kind === 'progress') {
			progress = { key: item.key, statusByQuestion: item.data?.statusByQuestion && typeof item.data.statusByQuestion === 'object' ? item.data.statusByQuestion : {} };
		}
	}
	const zettelList = [...zettelByKey.values()];
	const root = (rootKey && zettelByKey.get(rootKey)) || zettelList.find((zettel) => zettel.level === 'root') || null;
	const model = {
		rootKey: root?.key ?? '', zettelByKey, zettelList,
		containListByKey: new Map(), containerListByKey: new Map(),
		connectionList: [], connectionOutByKey: new Map(), connectionInByKey: new Map(),
		linkList: [], linkOutByKey: new Map(), linkInByKey: new Map(),
		groupListByKey: new Map(),
		noteList, noteListByTarget: new Map(), progress, problemList,
	};
	containBuild(model, root);
	linkBuild(model);
	for (const note of noteList) {
		if (!zettelByKey.has(note.target)) problemList.push(`${note.key}: a note on "${note.target}", which is not a zettel`);
		if (!model.noteListByTarget.has(note.target)) model.noteListByTarget.set(note.target, []);
		model.noteListByTarget.get(note.target).push(note);
	}
	for (const list of model.noteListByTarget.values()) list.sort((a, b) => a.timeCreate.localeCompare(b.timeCreate));
	noteList.sort((a, b) => b.timeCreate.localeCompare(a.timeCreate));
	return model;
}

function connectionAdd(model, connection) {
	const record = { id: `c${model.connectionList.length + 1}`, group: null, label: null, fromPlace: '', fromLabel: '', toPlace: '', toAnchor: '', text: '', ...connection };
	model.connectionList.push(record);
	const listAdd = (map, key) => {
		if (!map.has(key)) map.set(key, []);
		map.get(key).push(record);
	};
	listAdd(model.connectionOutByKey, record.from);
	listAdd(model.connectionInByKey, record.to);
	if (record.type === 'link') {
		model.linkList.push(record);
		listAdd(model.linkOutByKey, record.from);
		listAdd(model.linkInByKey, record.to);
	}
	return record;
}

// what holds what: every containment written, in the order of the zettels, the ones that would
// close a cycle left out with a word; a zettel nothing holds hangs below the root. the children of
// a zettel come in the order of a group of its own when one names them, then as written, the
// questions last by their number
function containBuild(model, root) {
	const { zettelByKey, zettelList, problemList } = model;
	const writtenList = [];
	for (const zettel of zettelList) {
		const source = zettel.kind === 'question' ? 'question' : 'parent';
		for (const parent of zettel.parentWrittenList) writtenList.push({ from: parent, to: zettel.key, source, group: null, order: 1000 + writtenList.length });
		for (const entry of zettel.connectionWritten.entryList) if (entry.type === 'contain') writtenList.push({ from: zettel.key, to: entry.to, source: 'meta', group: null, label: entry.label, order: 1000 + writtenList.length });
		// several groups of contain keep their own order: the first group's members, then the
		// second's (an order below 1000 is a group's: up to ten groups of a hundred)
		let containGroupIndex = 0;
		for (const group of zettel.connectionWritten.groupList) {
			if (group.type !== 'contain') continue;
			const orderBase = containGroupIndex * 100;
			containGroupIndex += 1;
			for (const item of group.itemList) writtenList.push({ from: zettel.key, to: item.to, source: 'meta', group: { id: group.id, label: group.label, form: group.form, index: item.index, key: item.key }, label: item.label, order: orderBase + Math.min(item.index, 99) });
		}
	}
	const pairSet = new Set();
	const orderByPair = new Map();
	const recordList = [];
	for (const written of writtenList) {
		const pair = `${written.from}\u0000${written.to}`;
		if (!zettelByKey.has(written.from)) { problemList.push(`${written.to}: contained by "${written.from}", which is not a zettel`); continue; }
		if (!zettelByKey.has(written.to)) { problemList.push(`${written.from}: contains "${written.to}", which is not a zettel`); continue; }
		// the same containment written twice: once by parent, once in an ordered group of the
		// holder. it is one, with the group's order and key
		if (pairSet.has(pair)) {
			const recorded = recordList.find((one) => one.from === written.from && one.to === written.to);
			if (written.group && recorded && !recorded.group) {
				recorded.group = written.group;
				recorded.label = recorded.label ?? written.label;
				orderByPair.set(pair, written.order);
			}
			continue;
		}
		if (written.to === model.rootKey) { problemList.push(`${written.from}: contains the root "${written.to}", left out (the root is held by nothing)`); continue; }
		if (containPathFind(model.containListByKey, written.to, written.from).length > 0) {
			problemList.push(`${written.from} › ${written.to}: this containment would close a cycle, left out`);
			continue;
		}
		pairSet.add(pair);
		orderByPair.set(pair, written.order);
		if (!model.containListByKey.has(written.from)) model.containListByKey.set(written.from, []);
		model.containListByKey.get(written.from).push(written.to);
		if (!model.containerListByKey.has(written.to)) model.containerListByKey.set(written.to, []);
		model.containerListByKey.get(written.to).push(written.from);
		recordList.push(written);
	}
	// a zettel nothing holds hangs below the root
	if (root) {
		for (const zettel of zettelList) {
			if (zettel === root || model.containerListByKey.has(zettel.key)) continue;
			const pair = `${root.key}\u0000${zettel.key}`;
			orderByPair.set(pair, 1000 + writtenList.length + recordList.length);
			if (!model.containListByKey.has(root.key)) model.containListByKey.set(root.key, []);
			model.containListByKey.get(root.key).push(zettel.key);
			model.containerListByKey.set(zettel.key, [root.key]);
			recordList.push({ from: root.key, to: zettel.key, source: 'root', group: null, order: orderByPair.get(pair) });
		}
	}
	for (const record of recordList) connectionAdd(model, { type: 'contain', from: record.from, to: record.to, isDirected: true, source: record.source, group: record.group, label: record.label ?? null });
	// a group of the container first, by its index; then the order of the zettels; the questions last
	const indexByKey = new Map(zettelList.map((zettel, index) => [zettel.key, index]));
	const orderOf = (from, to) => {
		const zettel = zettelByKey.get(to);
		if (zettel.kind === 'question') return 1000000 + zettel.number;
		const order = orderByPair.get(`${from}\u0000${to}`) ?? 1000;
		return order < 1000 ? order : 1000 + indexByKey.get(to);
	};
	for (const [from, list] of model.containListByKey) list.sort((a, b) => orderOf(from, a) - orderOf(from, b));
	// the first container is the one a chain of titles goes through
	for (const zettel of zettelList) zettel.parentKey = model.containerListByKey.get(zettel.key)?.[0] ?? '';
}

// the links and the groups: written in a text, in connectionList, or as data (a question naming
// the zettels each option is about, a zettel naming the questions it answers)
function linkBuild(model) {
	const { zettelByKey, zettelList, problemList } = model;
	const isKnown = (from, to) => {
		if (zettelByKey.has(to)) return true;
		problemList.push(`${from}: it names "${to}", which is not a zettel`);
		return false;
	};
	const labelCheck = (from, label) => {
		if (label?.kind === 'zettel' && !zettelByKey.has(label.key)) problemList.push(`${from}: a connection labelled by "${label.key}", which is not a zettel`);
		return label;
	};
	const groupAdd = (zettel, group) => {
		if (!model.groupListByKey.has(zettel.key)) model.groupListByKey.set(zettel.key, []);
		const list = model.groupListByKey.get(zettel.key);
		let id = group.id;
		for (let index = 2; list.some((one) => one.id === id); index += 1) id = `${group.id}-${index}`;
		const record = { ...group, id, from: zettel.key, itemList: [] };
		list.push(record);
		return record;
	};
	for (const zettel of zettelList) {
		// a link written in a text: from the section it stands in (for a question, the option that
		// section is about) to a zettel, and a place of it when the link names one
		for (const section of zettel.sectionList) {
			for (const link of zettelDocLinkListRead(section.text)) {
				if (!zettelByKey.has(link.key)) continue;
				const target = zettelByKey.get(link.key);
				const fromPlace = zettel.kind === 'question' ? zettelOptionOfAnchor(section.id) : section.id;
				const toPlace = target.kind === 'question' ? zettelOptionOfAnchor(link.place) : link.place;
				if (link.place && !zettelPlaceSetOf(target).has(link.place)) problemList.push(`${zettel.key}: a link to "${link.key}#${link.place}", a place that zettel does not have`);
				connectionAdd(model, { type: 'link', from: zettel.key, to: link.key, isDirected: true, source: 'text', fromPlace, fromLabel: section.title, toPlace, toAnchor: link.place, text: linkContextRead(section.text, link) });
			}
		}
		// written as connections
		for (const entry of zettel.connectionWritten.entryList) {
			if (entry.type !== 'link' || !isKnown(zettel.key, entry.to)) continue;
			connectionAdd(model, { type: 'link', from: zettel.key, to: entry.to, isDirected: entry.isDirected, source: 'meta', label: labelCheck(zettel.key, entry.label) });
		}
		for (const groupWritten of zettel.connectionWritten.groupList) {
			if (groupWritten.type !== 'link') continue;
			const group = groupAdd(zettel, { id: groupWritten.id, label: groupWritten.label, form: groupWritten.form, isDirected: groupWritten.isDirected, source: 'meta' });
			for (const item of groupWritten.itemList) {
				if (!isKnown(zettel.key, item.to)) continue;
				const connection = connectionAdd(model, { type: 'link', from: zettel.key, to: item.to, isDirected: groupWritten.isDirected, source: 'meta', label: labelCheck(zettel.key, item.label), group: { id: group.id, label: group.label, form: group.form, index: item.index, key: item.key } });
				group.itemList.push({ index: item.index, key: item.key, to: item.to, connectionId: connection.id });
			}
		}
		if (zettel.kind === 'question') {
			// the options: a map from the letter of an option to the zettels it is about
			const optionGroup = groupAdd(zettel, { id: ZETTEL_GROUP_OPTION, label: 'Options', form: 'map', isDirected: true, source: 'option' });
			zettel.optionList.forEach((option, index) => {
				for (const key of option.zettelList) {
					if (!isKnown(zettel.key, key)) continue;
					const connection = connectionAdd(model, { type: 'link', from: zettel.key, to: key, isDirected: true, source: 'option', fromPlace: option.id, fromLabel: `option ${option.id}`, group: { id: optionGroup.id, label: optionGroup.label, form: 'map', index, key: option.id } });
					optionGroup.itemList.push({ index, key: option.id, to: key, connectionId: connection.id });
				}
			});
			// the zettels the whole question needs
			const neededList = zettel.zettelList.filter((key) => isKnown(zettel.key, key));
			if (neededList.length > 0) {
				const neededGroup = groupAdd(zettel, { id: ZETTEL_GROUP_NEEDED, label: 'Zettels needed', form: 'list', isDirected: true, source: 'question' });
				neededList.forEach((key, index) => {
					const connection = connectionAdd(model, { type: 'link', from: zettel.key, to: key, isDirected: true, source: 'question', group: { id: neededGroup.id, label: neededGroup.label, form: 'list', index, key: '' } });
					neededGroup.itemList.push({ index, key: '', to: key, connectionId: connection.id });
				});
			}
			for (const group of [optionGroup]) if (group.itemList.length === 0) model.groupListByKey.set(zettel.key, model.groupListByKey.get(zettel.key).filter((one) => one !== group));
		} else {
			for (const one of zettel.questionList) {
				if (!isKnown(zettel.key, one.key)) continue;
				connectionAdd(model, { type: 'link', from: zettel.key, to: one.key, isDirected: true, source: 'card', toPlace: one.option, text: one.text });
			}
		}
	}
}

// ---------- reading the model ----------

export const zettelGet = (model, key) => model.zettelByKey.get(key) ?? null;
export const zettelChildListOf = (model, key) => (model.containListByKey.get(key) ?? []).map((child) => model.zettelByKey.get(child));
export const zettelKnowledgeChildListOf = (model, key) => zettelChildListOf(model, key).filter((zettel) => zettel.kind === 'zettel');
export const zettelQuestionChildListOf = (model, key) => zettelChildListOf(model, key).filter((zettel) => zettel.kind === 'question');
export const zettelContainerListOf = (model, key) => (model.containerListByKey.get(key) ?? []).map((one) => model.zettelByKey.get(one));
export const zettelGroupListOf = (model, key) => model.groupListByKey.get(key) ?? [];
// the containment record of a container and what it holds (its group, its label)
export const zettelContainOf = (model, from, to) => (model.connectionOutByKey.get(from) ?? []).find((one) => one.type === 'contain' && one.to === to) ?? null;

// the zettels from the root down to this one, through the first container of each
export function zettelChainOf(model, key) {
	const chain = [];
	let zettel = model.zettelByKey.get(key);
	const seen = new Set();
	while (zettel && !seen.has(zettel.key)) {
		chain.unshift(zettel);
		seen.add(zettel.key);
		zettel = zettel.parentKey ? model.zettelByKey.get(zettel.parentKey) : null;
	}
	return chain;
}

// the short word of a zettel: in a crumb, on a pill
export function zettelLabelOf(zettel) {
	if (!zettel) return '';
	if (zettel.kind === 'question') return `Q${zettel.number}`;
	return zettel.label || zettel.title;
}

// the title a zettel is shown by: a question with its number
export function zettelTitleOf(zettel) {
	if (!zettel) return '';
	return zettel.kind === 'question' ? `Q${zettel.number} · ${zettel.title}` : zettel.title;
}

// the links of a zettel that are not in a group, by the other end, each once, without itself:
// [{ zettel, linkList }]. isDirected false counts at both ends
function neighbourListBuild(model, linkList, keyOf) {
	const byKey = new Map();
	for (const link of linkList) {
		const key = keyOf(link);
		const zettel = model.zettelByKey.get(key);
		if (!zettel) continue;
		if (!byKey.has(key)) byKey.set(key, { zettel, linkList: [] });
		byKey.get(key).linkList.push(link);
	}
	return [...byKey.values()];
}

export function zettelLinkOutListOf(model, key) {
	return neighbourListBuild(model, (model.linkOutByKey.get(key) ?? []).filter((link) => link.to !== key && !link.group), (link) => link.to);
}

export function zettelLinkInListOf(model, key) {
	return neighbourListBuild(model, (model.linkInByKey.get(key) ?? []).filter((link) => link.from !== key), (link) => link.from);
}

// the questions a knowledge zettel is used by, at the granularity of options:
// [{ question, optionList: [{ id, isCorrect }], textList }], by number. a question refers to a
// zettel through an option (its zettelList, a link in its reason), or as a whole; a zettel refers
// to a question by its questionList
export function zettelQuestionRefListOf(model, key) {
	const byKey = new Map();
	const entryOf = (questionKey) => {
		const question = model.zettelByKey.get(questionKey);
		if (!question || question.kind !== 'question') return null;
		if (!byKey.has(questionKey)) byKey.set(questionKey, { question, optionIdSet: new Set(), textList: [] });
		return byKey.get(questionKey);
	};
	for (const link of model.linkOutByKey.get(key) ?? []) {
		const entry = entryOf(link.to);
		if (!entry) continue;
		if (link.toPlace) entry.optionIdSet.add(link.toPlace);
		if (link.source === 'card' && link.text && !entry.textList.includes(link.text)) entry.textList.push(link.text);
	}
	for (const link of model.linkInByKey.get(key) ?? []) {
		const entry = entryOf(link.from);
		if (!entry) continue;
		if (link.fromPlace) entry.optionIdSet.add(link.fromPlace);
	}
	return [...byKey.values()]
		.map((entry) => ({ question: entry.question, optionList: entry.question.optionList.filter((option) => entry.optionIdSet.has(option.id)).map((option) => ({ id: option.id, isCorrect: option.isCorrect })), textList: entry.textList }))
		.sort((a, b) => a.question.number - b.question.number);
}

// the backlinks of a zettel written in the text of other knowledge zettels, with the sentence
export function zettelBacklinkListOf(model, key) {
	return zettelLinkInListOf(model, key)
		.filter((entry) => entry.zettel.kind === 'zettel')
		.map((entry) => ({ zettel: entry.zettel, linkList: entry.linkList.filter((link) => link.source === 'text') }))
		.filter((entry) => entry.linkList.length > 0);
}

// What the connection view of a zettel draws (doc/README.md#the-connection-view), sorted into the
// places it has there, each zettel in one place only (the first that applies):
//
//   containerList   the zettels holding it                       above, in a grid
//   childList       the knowledge zettels it holds               below, in a grid
//   questionList    the questions it holds or that use it       below the children, each with the
//                                                               letters of the options about it
//   inList          the zettels pointing at it (back links)     on the left
//   outList         the zettels it points at (forward links)    on the right
//   groupList       its groups: lists, arrays, maps             on the right, under the forward links
//
// a link without direction is drawn on the side of whoever wrote it, and counts as both
export function zettelRoleBuild(model, key) {
	const zettel = model.zettelByKey.get(key);
	const role = { containerList: [], childList: [], questionList: [], inList: [], outList: [], groupList: [] };
	if (!zettel) return role;
	const usedSet = new Set([key]);
	const take = (one) => {
		if (!one || usedSet.has(one.key)) return false;
		usedSet.add(one.key);
		return true;
	};
	for (const container of zettelContainerListOf(model, key)) if (take(container)) role.containerList.push({ zettel: container, connection: zettelContainOf(model, container.key, key) });
	for (const child of zettelChildListOf(model, key)) {
		if (child.kind !== 'zettel' || !take(child)) continue;
		role.childList.push({ zettel: child, connection: zettelContainOf(model, key, child.key) });
	}
	// the groups of the zettel keep their members even when one stands elsewhere too: a group
	// shows its whole content in its order
	const groupList = zettelGroupListOf(model, key);
	// the zettels a question needs, beside those its options are about: only the others
	const optionKeySet = new Set(groupList.find((group) => group.id === ZETTEL_GROUP_OPTION)?.itemList.map((item) => item.to) ?? []);
	for (const group of groupList) {
		const itemList = group.itemList
			.filter((item) => group.id !== ZETTEL_GROUP_NEEDED || !optionKeySet.has(item.to))
			.map((item) => ({ ...item, zettel: model.zettelByKey.get(item.to), connection: model.connectionList.find((one) => one.id === item.connectionId) })).filter((item) => item.zettel);
		if (itemList.length > 0) role.groupList.push({ ...group, itemList });
	}
	// a zettel drawn in a group of this one is not drawn again as a link, either way
	const groupMemberSet = new Set(role.groupList.flatMap((group) => group.itemList.map((item) => item.to)));
	// the questions: those it holds, then those using it, each with the letters of its options
	const questionByKey = new Map();
	const questionEntryOf = (question) => {
		if (!questionByKey.has(question.key)) questionByKey.set(question.key, { zettel: question, optionIdSet: new Set(), isHeld: false });
		return questionByKey.get(question.key);
	};
	for (const child of zettelChildListOf(model, key)) if (child.kind === 'question') questionEntryOf(child).isHeld = true;
	if (zettel.kind !== 'question') {
		for (const entry of zettelQuestionRefListOf(model, key)) {
			const one = questionEntryOf(entry.question);
			for (const option of entry.optionList) one.optionIdSet.add(option.id);
		}
	}
	for (const entry of [...questionByKey.values()].sort((a, b) => a.zettel.number - b.zettel.number)) {
		if (!take(entry.zettel)) continue;
		role.questionList.push({ zettel: entry.zettel, optionIdList: [...entry.optionIdSet].sort(), isHeld: entry.isHeld });
	}
	const outWrittenList = (model.linkOutByKey.get(key) ?? []).filter((link) => !link.group && link.to !== key);
	const inWrittenList = (model.linkInByKey.get(key) ?? []).filter((link) => link.from !== key);
	for (const entry of neighbourListBuild(model, outWrittenList, (link) => link.to)) {
		if (groupMemberSet.has(entry.zettel.key) || !take(entry.zettel)) continue;
		role.outList.push({ zettel: entry.zettel, linkList: entry.linkList });
	}
	for (const entry of neighbourListBuild(model, inWrittenList, (link) => link.from)) {
		if (groupMemberSet.has(entry.zettel.key) || !take(entry.zettel)) continue;
		role.inList.push({ zettel: entry.zettel, linkList: entry.linkList });
	}
	return role;
}

// every zettel below a zettel, itself included, each once
export function zettelDescendantListOf(model, key) {
	const list = [];
	const seen = new Set();
	const walk = (one) => {
		const zettel = model.zettelByKey.get(one);
		if (!zettel || seen.has(one)) return;
		seen.add(one);
		list.push(zettel);
		for (const child of model.containListByKey.get(one) ?? []) walk(child);
	};
	walk(key);
	return list;
}

export function zettelCountOf(model, key) {
	const list = zettelDescendantListOf(model, key).slice(1);
	return { zettel: list.filter((zettel) => zettel.kind === 'zettel').length, question: list.filter((zettel) => zettel.kind === 'question').length };
}

// the hub of a zettel: the zettel below the root on its chain
export function zettelHubOf(model, key) {
	const chain = zettelChainOf(model, key);
	return chain.find((zettel) => zettel.level === 'hub') ?? chain[1] ?? null;
}

// ---------- questions ----------

// does the answer of the question differ from the one the source of the questions gives
export const zettelQuestionIsDisputed = (question) => Boolean(question.answerDump) && question.answerDump !== question.answer;
export const zettelQuestionIsDoubtful = (question) => zettelQuestionIsDisputed(question) || question.answerConfidence !== 'high';

export function zettelProgressOf(model, key) {
	const status = model.progress.statusByQuestion[key]?.status;
	return ZETTEL_PROGRESS_STATUS_LIST.includes(status) ? status : '';
}

export function zettelProgressCount(model, questionList) {
	const count = { right: 0, wrong: 0, review: 0, none: 0 };
	for (const question of questionList) count[zettelProgressOf(model, question.key) || 'none'] += 1;
	return count;
}

// the letters chosen against the answer of a question
export function zettelAnswerCheck(question, optionIdList) {
	const chosen = [...optionIdList].sort().join('');
	return chosen === [...question.answer].sort().join('');
}

// ---------- search ----------

const haystackBuild = (zettel) => {
	const body = `${zettel.kind === 'question' ? `${zettel.stem} ${zettel.optionList.map((option) => option.text).join(' ')} ` : ''}${zettelDocPlain(zettel.body)}`;
	return { title: `${zettelLabelOf(zettel)} ${zettel.title}`.toLowerCase(), key: zettel.key.toLowerCase(), summary: `${zettel.summary} ${zettel.tagList.join(' ')}`.toLowerCase(), body: body.toLowerCase() };
};

// the zettels holding every word typed, best first: [{ zettel, score, field }]. a word may be
// narrowed: kind:question, level:fact, hub:rag. "q12" and "12" find question 12
export function zettelSearch(model, text, { limit = 30 } = {}) {
	const wordList = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
	if (wordList.length === 0) return [];
	if (!model.searchIndex) model.searchIndex = new Map(model.zettelList.map((zettel) => [zettel.key, haystackBuild(zettel)]));
	const resultList = [];
	for (const zettel of model.zettelList) {
		const hay = model.searchIndex.get(zettel.key);
		let score = 0;
		let field = '';
		let isMatch = true;
		for (const word of wordList) {
			const [name, value] = word.includes(':') ? [word.slice(0, word.indexOf(':')), word.slice(word.indexOf(':') + 1)] : ['', word];
			if (name === 'kind') { if (zettel.kind !== value) isMatch = false; continue; }
			if (name === 'level') { if (zettel.level !== value) isMatch = false; continue; }
			if (name === 'hub') { if (zettelHubOf(model, zettel.key)?.key !== value) isMatch = false; continue; }
			const numberText = /^q?(\d{1,3})$/.exec(word)?.[1];
			if (numberText && zettel.kind === 'question' && zettel.number === Number(numberText)) { score += 40; field ||= 'number'; continue; }
			if (hay.title.startsWith(word)) { score += 12; field ||= 'title'; }
			else if (hay.title.includes(word)) { score += 8; field ||= 'title'; }
			else if (hay.key.includes(word)) { score += 6; field ||= 'key'; }
			else if (hay.summary.includes(word)) { score += 4; field ||= 'summary'; }
			else if (hay.body.includes(word)) { score += 1; field ||= 'text'; }
			else isMatch = false;
			if (!isMatch) break;
		}
		if (!isMatch) continue;
		// a zettel higher in the hierarchy first among equals
		const levelBonus = { root: 3, hub: 2, topic: 1 }[zettel.level] ?? 0;
		resultList.push({ zettel, score: score + levelBonus * 0.1, field });
	}
	return resultList.sort((a, b) => b.score - a.score || a.zettel.title.localeCompare(b.zettel.title)).slice(0, limit);
}

// ---------- the assets of a zettel ----------

// the path indexing a zettel among the assets of its object: the chain of containers for a
// knowledge zettel, /question/{key} for a question
export function zettelAssetPathBuild(kind, keyChain) {
	if (kind === 'question') return `/question/${keyChain[keyChain.length - 1]}`;
	if (kind === 'note') return `/note/${keyChain.join('/')}`;
	return `/zettel/${keyChain.join('/')}`;
}
