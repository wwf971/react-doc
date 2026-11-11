#!/usr/bin/env node
// Cards written as yaml files, put into a zettelkasten through the asset api of a running
// development server (doc/README.md#importing-cards): each file one card, turned into the
// document a card is (Markdown with a frontmatter, ZettelDoc.js), created when its key is new
// and written again when its text changed, so the import can be run again. In the yaml a
// text links another card as [[key#place|label]] and marks a paragraph with " ^id"; the
// document gets [label](key.md#place) and an Anchor marker.
//
//   node zettel-import.mjs --server http://localhost:45190 --content <dir> [--questions <json>]
//                          [--doc-page <alias>] [--object <id>] [--name <name>] [--dry]
//
//   --content     a folder of {key}.yaml files, in any folders (the format: comp-zettelkasten.md)
//   --questions   the questions as json [{ n, stem, optionList [{ id, text, isMostVoted }], answer, voteList }]:
//                 the stem and the options of a question card come from here, the analysis from its
//                 yaml file; a question without a file is imported bare, with the answer of the json
//   --object      the frontend object; absent: the first of the type zettelkasten.box in the
//                 doc page, created (--name) when there is none
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const argList = process.argv.slice(2);
const argGet = (name, fallback = '') => { const index = argList.indexOf(`--${name}`); return index < 0 ? fallback : argList[index + 1] ?? ''; };
const isDry = argList.includes('--dry');
const server = argGet('server').replace(/\/+$/, '');
const contentDir = argGet('content');
if (!server || !contentDir) { console.error('usage: zettel-import.mjs --server <url> --content <dir> [--questions <json>] [--doc-page <alias>] [--object <id>] [--name <name>] [--dry]'); process.exit(2); }
const require = createRequire(path.join(path.dirname(new URL(import.meta.url).pathname), '../../../../main/frontend/'));
const YAML = require('yaml');
const { zettelDocTextBuild, zettelOptionAnchorOf } = await import('./ZettelDoc.js');
const TYPE_ID = 'zettelkasten.box';

async function api(route, body) {
	const response = await fetch(`${server}/__doc-asset${route}`, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	const answer = await response.json();
	if (answer.code !== 0) throw new Error(`${route}: ${answer.message}`);
	return answer.data;
}

function fileListRead(dir) {
	const list = [];
	for (const name of fs.readdirSync(dir).sort()) {
		const file = path.join(dir, name);
		if (fs.statSync(file).isDirectory()) list.push(...fileListRead(file));
		else if (name.endsWith('.yaml')) list.push(file);
	}
	return list;
}

const questionKeyOf = (number) => `q${String(number).padStart(3, '0')}`;
const dataByKey = new Map();
for (const file of fileListRead(contentDir)) {
	const data = YAML.parse(fs.readFileSync(file, 'utf8'));
	if (!data?.key) { console.warn(`skipped (no key): ${file}`); continue; }
	if (dataByKey.has(data.key)) console.warn(`the key ${data.key} is written twice: ${file} wins`);
	dataByKey.set(data.key, data);
}
const questionList = argGet('questions') ? JSON.parse(fs.readFileSync(argGet('questions'), 'utf8')) : [];
const questionHubOf = (() => {
	const masterFile = path.join(contentDir, '..', 'tool', 'master-key.yaml');
	const byNumber = new Map();
	if (fs.existsSync(masterFile)) for (const [hub, list] of Object.entries(YAML.parse(fs.readFileSync(masterFile, 'utf8')).questionHub ?? {})) for (const number of list) byNumber.set(number, hub);
	return (number) => byNumber.get(number) ?? '';
})();
// a question card: what the source says (stem, options, its answer, the votes) joined with the analysis
for (const question of questionList) {
	const key = questionKeyOf(question.n);
	const written = dataByKey.get(key);
	const optionWrittenById = new Map((written?.optionList ?? []).map((option) => [option.id, option]));
	dataByKey.set(key, {
		kind: 'question',
		number: question.n,
		hub: written?.hub ?? questionHubOf(question.n),
		title: written?.title ?? `Question ${question.n}`,
		summary: written?.summary ?? '',
		stem: question.stem,
		optionList: question.optionList.map((option) => {
			const one = optionWrittenById.get(option.id);
			return { id: option.id, text: option.text, verdict: one?.verdict ?? (question.answer.includes(option.id) ? 'correct' : 'wrong'), reason: one?.text ?? '', zettelList: one?.zettelList ?? [], ...(option.isMostVoted ? { isMostVoted: true } : {}) };
		}),
		answer: String(written?.answer ?? question.answer),
		answerDump: question.answer,
		answerConfidence: written?.answerConfidence ?? 'low',
		answerNote: written?.answerNote ?? '',
		...(written ? {} : { isAnalysed: false }),
		voteList: question.voteList,
		clueList: written?.clueList ?? [],
		explanation: written?.explanation ?? '',
		zettelList: written?.zettelList ?? [],
		sourceList: written?.sourceList ?? [],
		...(written ? {} : { isVerified: false }),
	});
}
// links to cards that are not written are taken out of the lists (in a text they are drawn as missing)
const keySet = new Set(dataByKey.keys());
let countDropped = 0;
for (const data of dataByKey.values()) {
	const keep = (list) => (list ?? []).filter((key) => { if (keySet.has(key)) return true; countDropped += 1; return false; });
	if (data.kind === 'question') { data.zettelList = keep(data.zettelList); for (const option of data.optionList) option.zettelList = keep(option.zettelList); }
	else if (data.questionList) data.questionList = data.questionList.filter((one) => keySet.has(one.ref));
}
const chainOf = (key) => {
	const chain = [];
	const seen = new Set();
	let one = key;
	while (one && dataByKey.has(one) && !seen.has(one)) { seen.add(one); const data = dataByKey.get(one); if (data.level !== 'root') chain.unshift(one); one = data.parent; }
	return chain;
};

const config = await api('/object-frontend/config');
const docPage = config.docPageList.find((one) => !argGet('doc-page') || one.alias === argGet('doc-page')) ?? config.docPageList[0];
if (!docPage) throw new Error('The server has no doc page that can hold frontend objects.');
const itemList = (await api('/item/list?store=local')).itemList;
const itemById = new Map(itemList.map((item) => [item.itemId, item]));
let object = docPage.objectList.find((one) => (argGet('object') ? one.id === argGet('object') : true));
if (!object) {
	if (isDry) { console.log(`would create an object of ${TYPE_ID} in ${docPage.alias}`); process.exit(0); }
	const root = [...dataByKey.values()].find((data) => data.level === 'root');
	await api('/object-frontend/create', { docPageAlias: docPage.alias, typeId: TYPE_ID, name: argGet('name', 'zettelkasten'), description: root?.summary ?? '', metadata: root ? { rootKey: root.key } : {} });
	object = (await api('/object-frontend/config')).docPageList.find((one) => one.alias === docPage.alias).objectList.at(-1);
	console.log(`created the object frontend:${object.id}`);
}
// ---------- yaml -> the document of a card ----------

const WIKI_LINK = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
const sectionTitleOf = (data, place) => (data.sectionList ?? []).find((section) => section.id === place)?.title;
function linkConvert(text) {
	return String(text ?? '').replace(WIKI_LINK, (whole, keyRaw, placeRaw, labelRaw) => {
		const key = keyRaw.trim();
		const place = (placeRaw ?? '').trim();
		const data = dataByKey.get(key);
		if (!data) return labelRaw?.trim() || key;
		const isQuestion = data.kind === 'question';
		const anchor = !place ? '' : isQuestion ? zettelOptionAnchorOf(place) : place.replace(/^\^/, '');
		const label = labelRaw?.trim() || (isQuestion ? `Q${data.number}${place ? ` · ${place}` : ''}` : sectionTitleOf(data, place) ? `${data.title} › ${sectionTitleOf(data, place)}` : data.title);
		return `[${label.replace(/([\[\]])/g, '\\$1')}](${key}.md${anchor ? `#${anchor}` : ''})`;
	});
}
// a block (what blank lines separate) with lines ending " ^id" gets an Anchor marker per id before it
function blockIdConvert(text) {
	return String(text ?? '').trim().split(/\n{2,}/).map((block) => {
		const idList = [];
		const body = block.split('\n').map((line) => line.replace(/\s\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/, (whole, id) => { idList.push(id); return ''; })).join('\n');
		return [...idList.map((id) => `<!--renderComp=Anchor,id=${id}-->`), body].join('\n\n');
	}).join('\n\n');
}
const textConvert = (text) => blockIdConvert(linkConvert(text));
const anchorLine = (id) => `<!--renderComp=Anchor,id=${id}-->`;

function docBuild(key, data) {
	if (data.kind === 'question') {
		const { explanation, answerNote, optionList, ...meta } = data;
		const partList = [];
		if (answerNote) partList.push(`${anchorLine('answer-note')}\n\n## About the answer\n\n${textConvert(answerNote)}`);
		if (explanation) partList.push(`${anchorLine('explanation')}\n\n## How to get there\n\n${textConvert(explanation)}`);
		const optionReasonList = optionList.filter((option) => option.reason);
		if (optionReasonList.length > 0) {
			partList.push('## Why each option');
			for (const option of optionReasonList) partList.push(`${anchorLine(zettelOptionAnchorOf(option.id))}\n\n### Option ${option.id}: ${option.verdict}\n\n${textConvert(option.reason)}`);
		}
		return zettelDocTextBuild({ ...meta, optionList: optionList.map(({ reason: _reason, ...option }) => option) }, partList.join('\n\n'));
	}
	const { sectionList, kind: _kind, ...meta } = data;
	const body = (sectionList ?? []).map((section) => `${anchorLine(section.id)}\n\n## ${section.title}\n\n${textConvert(section.text)}`).join('\n\n');
	return zettelDocTextBuild(meta, body);
}

const assetByKey = new Map((object.listList ?? []).flatMap((list) => list.assetList ?? []).map((asset) => [asset.key, asset]));
const hashOf = (text) => crypto.createHash('sha1').update(text).digest('hex');
const count = { created: 0, updated: 0, same: 0, failed: 0 };
for (const [key, dataInput] of dataByKey) {
	const { key: _key, ...data } = dataInput;
	const kind = data.kind === 'question' ? 'question' : 'zettel';
	const text = docBuild(key, data);
	const name = kind === 'question' ? `Q${data.number} ${data.title}` : data.title;
	const pathList = [kind === 'question' ? `/question/${key}` : `/zettel/${chainOf(key).join('/') || key}`];
	const asset = assetByKey.get(key);
	try {
		if (!asset) {
			if (!isDry) await api('/object-frontend/asset/create', { id: object.id, key, kind, name, pathList, lang: 'md', text, partition: 'content', note: 'imported' });
			count.created += 1;
		} else {
			const item = itemById.get(asset.itemId);
			const head = item?.versionList?.find((version) => version.versionId === item.versionIdHead);
			if (head?.hash === hashOf(text)) { count.same += 1; continue; }
			if (!isDry) {
				await api('/item/update', { store: 'local', itemId: asset.itemId, hashBase: head?.hash, text, mode: 'inPlace', note: 'imported' });
				if ((asset.name ?? '') !== name || JSON.stringify(asset.pathList ?? []) !== JSON.stringify(pathList)) await api('/object-frontend/asset/meta/set', { id: object.id, key, name, pathList });
			}
			count.updated += 1;
		}
	} catch (error) {
		count.failed += 1;
		console.warn(`${key}: ${error.message}`);
	}
}
// the home document of the box: what a link to a card from outside the box opens, in the popup
// (main/doc_page_impl_obj_frontend.md#the-home-document). made once; edited from the page after
if (!assetByKey.has('home') && !isDry) {
	const root = [...dataByKey.values()].find((data) => data.level === 'root');
	const text = `---\ntitle: ${JSON.stringify(root?.title ?? argGet('name', 'Zettelkasten'))}\n---\n\n<!--renderComp=ObjectFrontend-->\n\`\`\`yaml\nobject: frontend:${object.id}\nmode: explorer\nparam:\n  height: 640\n\`\`\`\n`;
	try {
		await api('/object-frontend/asset/create', { id: object.id, key: 'home', kind: 'page', name: 'Home', pathList: ['/page/home'], lang: 'md', text, partition: 'content', note: 'the home document' });
		await api('/object-frontend/meta/set', { id: object.id, metadata: { ...(root ? { rootKey: root.key } : {}), docHome: 'home' } });
		console.log('created the home document (metadata.docHome: home)');
	} catch (error) {
		console.warn(`home document: ${error.message}`);
	}
}
console.log(`${isDry ? 'dry run: ' : ''}frontend:${object.id}: ${count.created} created, ${count.updated} updated, ${count.same} unchanged, ${count.failed} failed; ${countDropped} references to cards not written were left out`);
