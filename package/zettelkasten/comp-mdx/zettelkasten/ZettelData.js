// The data items of a zettelkasten (doc/README.md#the-data-items): what each kind of
// item holds, the grammar of the links between them, and the model all of them form
// once read. Pure: the items come from anywhere (the assets of a frontend object, a test).
//
//   kind zettel     a knowledge card, a document: frontmatter { level, parent, title, summary, questionList, sourceList, flow? }, body
//   kind question   a question card, a document: frontmatter { number, hub, title, summary, stem, optionList, answer, clueList, zettelList }, body: the analysis
//   kind note       a note of the reader on a place of a card, a document: frontmatter { target, place?, timeCreate }, body
//   kind progress   how the reader did on the questions, yaml: { statusByQuestion: { [key]: { status, time } } }
//
// an item names another by its key, which never changes, never by a path: the paths
// of the assets (/zettel/{hub}/{topic}, /question/q001) are an index for browsing.

import { zettelDocLinkListRead, zettelDocParse, zettelDocPlain, zettelDocSectionListRead, zettelOptionAnchorOf, zettelOptionOfAnchor } from './ZettelDoc.js';

export const ZETTEL_KIND_LIST = ['zettel', 'question', 'note', 'progress'];
export const ZETTEL_LEVEL_LIST = ['root', 'hub', 'topic', 'fact'];
export const ZETTEL_PROGRESS_STATUS_LIST = ['right', 'wrong', 'review'];
export const ZETTEL_PROGRESS_KEY = 'progress';
// the segment of a scene path under which the questions of a hub lie; never a key of a zettel
export const ZETTEL_QUESTION_SEGMENT = 'question';

// ---------- the items read ----------

export function zettelQuestionKeyBuild(number) {
	return `q${String(number).padStart(3, '0')}`;
}

const textOf = (value) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value));
const listOf = (value) => (Array.isArray(value) ? value : []);

function flowRead(flow) {
	if (!flow || typeof flow !== 'object' || !Array.isArray(flow.stepList)) return null;
	const stepList = flow.stepList.filter((step) => step && step.id).map((step) => ({ id: textOf(step.id), title: textOf(step.title) || textOf(step.id), text: textOf(step.text), zettel: textOf(step.zettel), tone: textOf(step.tone) }));
	if (stepList.length === 0) return null;
	const idSet = new Set(stepList.map((step) => step.id));
	const edgeWritten = Array.isArray(flow.edgeList) ? flow.edgeList : stepList.slice(1).map((step, index) => ({ from: stepList[index].id, to: step.id }));
	const edgeList = edgeWritten.filter((edge) => edge && idSet.has(edge.from) && idSet.has(edge.to) && edge.from !== edge.to).map((edge) => ({ from: textOf(edge.from), to: textOf(edge.to), label: textOf(edge.label) }));
	return { title: textOf(flow.title), stepList, edgeList };
}

// a card is a Markdown item: its data is the frontmatter, its text the body (ZettelDoc.js)
function zettelRead(item, problemList) {
	const { meta: data, body, message } = zettelDocParse(item.text);
	if (message) problemList.push(`${item.key}: its frontmatter does not parse: ${message}`);
	const level = ZETTEL_LEVEL_LIST.includes(data.level) ? data.level : 'topic';
	return {
		key: item.key,
		kind: 'zettel',
		level,
		parent: textOf(data.parent),
		title: textOf(data.title) || item.name || item.key,
		label: textOf(data.label),
		summary: textOf(data.summary).trim(),
		tagList: listOf(data.tagList).map(textOf),
		body,
		sectionList: zettelDocSectionListRead(body),
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
		parent: textOf(data.hub),
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
		questionList: [],
		tagList: [],
		flow: null,
		isUnverified: data.isVerified === false,
		partition: item.partition ?? '',
	};
}

// the places of a card a link may name: the ids of its sections and of the Anchor markers in
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

// ---------- the model ----------

// itemList: [{ key, kind, name, path, partition, text, data }], the assets of the object that are read
// (text: of a document; data: of the yaml item of the progress).
// answers a model: the cards by key, their hierarchy, the links between them inverted,
// the notes by the card they are on, the progress, and what does not fit
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
	// the hierarchy: a card without a parent hangs below the root
	const childListByKey = new Map();
	const parentOf = (zettel) => {
		if (zettel === root) return null;
		const parent = zettel.parent ? zettelByKey.get(zettel.parent) : null;
		if (zettel.parent && !parent) problemList.push(`${zettel.key}: its parent "${zettel.parent}" is not a card`);
		return parent ?? root;
	};
	for (const zettel of zettelList) {
		const parent = parentOf(zettel);
		zettel.parentKey = parent?.key ?? '';
		if (!parent) continue;
		if (!childListByKey.has(parent.key)) childListByKey.set(parent.key, []);
		childListByKey.get(parent.key).push(zettel.key);
	}
	const orderOf = (key) => {
		const zettel = zettelByKey.get(key);
		return zettel.kind === 'question' ? zettel.number : 0;
	};
	for (const list of childListByKey.values()) list.sort((a, b) => orderOf(a) - orderOf(b));
	// a cycle of parents would never end: cut it at the card that closes it
	for (const zettel of zettelList) {
		const seen = new Set([zettel.key]);
		let one = zettel;
		while (one.parentKey) {
			if (seen.has(one.parentKey)) {
				problemList.push(`${zettel.key}: its parents form a cycle`);
				const list = childListByKey.get(one.parentKey) ?? [];
				childListByKey.set(one.parentKey, list.filter((key) => key !== one.key));
				one.parentKey = root && root !== one ? root.key : '';
				break;
			}
			seen.add(one.parentKey);
			one = zettelByKey.get(one.parentKey);
		}
	}
	// the links: written in a text ([[key#place]]), or as data (a question naming the cards it
	// needs, a card naming the questions it answers). each is one record, read both ways
	const linkList = [];
	const linkAdd = (link) => {
		if (!zettelByKey.has(link.to)) {
			problemList.push(`${link.from}: it names "${link.to}", which is not a card`);
			return;
		}
		linkList.push(link);
	};
	for (const zettel of zettelList) {
		// a link written in the text: from the section it stands in (for a question, the option
		// that section is about) to a card, and a place of it when the link names one
		for (const section of zettel.sectionList) {
			for (const link of zettelDocLinkListRead(section.text)) {
				if (!zettelByKey.has(link.key)) continue;
				const target = zettelByKey.get(link.key);
				const fromPlace = zettel.kind === 'question' ? zettelOptionOfAnchor(section.id) : section.id;
				const toPlace = target.kind === 'question' ? zettelOptionOfAnchor(link.place) : link.place;
				if (link.place && !zettelPlaceSetOf(target).has(link.place)) problemList.push(`${zettel.key}: a link to "${link.key}#${link.place}", a place that card does not have`);
				linkList.push({ from: zettel.key, fromPlace, fromLabel: section.title, to: link.key, toPlace, toAnchor: link.place, source: 'text', text: linkContextRead(section.text, link) });
			}
		}
		if (zettel.kind === 'question') {
			for (const option of zettel.optionList) {
				for (const key of option.zettelList) linkAdd({ from: zettel.key, fromPlace: option.id, fromLabel: `option ${option.id}`, to: key, toPlace: '', source: 'option', text: '' });
			}
			for (const key of zettel.zettelList) linkAdd({ from: zettel.key, fromPlace: '', fromLabel: '', to: key, toPlace: '', source: 'question', text: '' });
		} else {
			for (const one of zettel.questionList) linkAdd({ from: zettel.key, fromPlace: '', fromLabel: '', to: one.key, toPlace: one.option, source: 'card', text: one.text });
		}
	}
	const linkOutByKey = new Map();
	const linkInByKey = new Map();
	for (const link of linkList) {
		if (!linkOutByKey.has(link.from)) linkOutByKey.set(link.from, []);
		linkOutByKey.get(link.from).push(link);
		if (!linkInByKey.has(link.to)) linkInByKey.set(link.to, []);
		linkInByKey.get(link.to).push(link);
	}
	const noteListByTarget = new Map();
	for (const note of noteList) {
		if (!zettelByKey.has(note.target)) problemList.push(`${note.key}: a note on "${note.target}", which is not a card`);
		if (!noteListByTarget.has(note.target)) noteListByTarget.set(note.target, []);
		noteListByTarget.get(note.target).push(note);
	}
	for (const list of noteListByTarget.values()) list.sort((a, b) => a.timeCreate.localeCompare(b.timeCreate));
	noteList.sort((a, b) => b.timeCreate.localeCompare(a.timeCreate));
	const model = { rootKey: root?.key ?? '', zettelByKey, zettelList, childListByKey, linkList, linkOutByKey, linkInByKey, noteList, noteListByTarget, progress, problemList, pathByKey: new Map(), keyByPath: new Map() };
	pathIndexBuild(model);
	return model;
}

// ---------- reading the model ----------

export const zettelGet = (model, key) => model.zettelByKey.get(key) ?? null;
export const zettelChildListOf = (model, key) => (model.childListByKey.get(key) ?? []).map((child) => model.zettelByKey.get(child));
export const zettelKnowledgeChildListOf = (model, key) => zettelChildListOf(model, key).filter((zettel) => zettel.kind === 'zettel');
export const zettelQuestionChildListOf = (model, key) => zettelChildListOf(model, key).filter((zettel) => zettel.kind === 'question');

// the cards from the root down to this one
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

// the short word of a card: in a path bar, on a pill
export function zettelLabelOf(zettel) {
	if (!zettel) return '';
	if (zettel.kind === 'question') return `Q${zettel.number}`;
	return zettel.label || zettel.title;
}

// the scene path of every card (ZettelScenes.js): the keys from the root down, a question
// below the segment "question" of its hub. /map, /map/rag, /map/rag/rag-chunking,
// /map/rag/question/q015
function pathIndexBuild(model) {
	for (const zettel of model.zettelList) {
		const chain = zettelChainOf(model, zettel.key);
		const segmentList = [];
		for (const one of chain) {
			if (one.kind === 'question') segmentList.push(ZETTEL_QUESTION_SEGMENT);
			segmentList.push(one.key);
		}
		const path = `/${segmentList.join('/')}`;
		model.pathByKey.set(zettel.key, path);
		model.keyByPath.set(path, zettel.key);
	}
}

export const zettelPathOf = (model, key) => model.pathByKey.get(key) ?? '';

// what a scene path names: { key } a card, { key, isQuestionList } the questions of a card, or null
export function zettelPathRead(model, path) {
	const text = String(path ?? '').replace(/\/+$/, '');
	const key = model.keyByPath.get(text);
	if (key) return { key, isQuestionList: false };
	if (text.endsWith(`/${ZETTEL_QUESTION_SEGMENT}`)) {
		const parentKey = model.keyByPath.get(text.slice(0, -ZETTEL_QUESTION_SEGMENT.length - 1));
		if (parentKey && zettelQuestionChildListOf(model, parentKey).length > 0) return { key: parentKey, isQuestionList: true };
	}
	return null;
}

// the cards a card links to and is linked from, each once, without itself: [{ zettel, linkList }]
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
	return neighbourListBuild(model, (model.linkOutByKey.get(key) ?? []).filter((link) => link.to !== key), (link) => link.to);
}

export function zettelLinkInListOf(model, key) {
	return neighbourListBuild(model, (model.linkInByKey.get(key) ?? []).filter((link) => link.from !== key), (link) => link.from);
}

// the questions a knowledge card is used by, at the granularity of options:
// [{ question, optionList: [{ id, isCorrect }], textList }], by number. a question refers to a card
// through an option (its zettelList, a link in its reason), or as a whole; a card refers to a
// question by its questionList
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

// the backlinks of a card that are not questions and not its own children or parent by
// hierarchy alone: the cards whose text points here, with the sentence
export function zettelBacklinkListOf(model, key) {
	return zettelLinkInListOf(model, key)
		.filter((entry) => entry.zettel.kind === 'zettel')
		.map((entry) => ({ zettel: entry.zettel, linkList: entry.linkList.filter((link) => link.source === 'text') }))
		.filter((entry) => entry.linkList.length > 0);
}

// every card below a card, itself included
export function zettelDescendantListOf(model, key) {
	const list = [];
	const walk = (one) => {
		const zettel = model.zettelByKey.get(one);
		if (!zettel) return;
		list.push(zettel);
		for (const child of model.childListByKey.get(one) ?? []) walk(child);
	};
	walk(key);
	return list;
}

export function zettelCountOf(model, key) {
	const list = zettelDescendantListOf(model, key).slice(1);
	return { zettel: list.filter((zettel) => zettel.kind === 'zettel').length, question: list.filter((zettel) => zettel.kind === 'question').length };
}

// the hub of a card: the card below the root on its chain
export function zettelHubOf(model, key) {
	const chain = zettelChainOf(model, key);
	return chain.find((zettel) => zettel.level === 'hub') ?? chain[1] ?? null;
}

// ---------- questions ----------

// does the answer of the card differ from the one the source of the questions gives
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

// the cards holding every word typed, best first: [{ zettel, score, field }]. a word may be
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
		// a card higher in the hierarchy first among equals
		const levelBonus = { root: 3, hub: 2, topic: 1 }[zettel.level] ?? 0;
		resultList.push({ zettel, score: score + levelBonus * 0.1, field });
	}
	return resultList.sort((a, b) => b.score - a.score || a.zettel.title.localeCompare(b.zettel.title)).slice(0, limit);
}

// ---------- the assets of a card ----------

// the path indexing a card among the assets of its object: the hierarchy for a knowledge
// card, /question/{key} for a question
export function zettelAssetPathBuild(kind, keyChain) {
	if (kind === 'question') return `/question/${keyChain[keyChain.length - 1]}`;
	if (kind === 'note') return `/note/${keyChain.join('/')}`;
	return `/zettel/${keyChain.join('/')}`;
}
