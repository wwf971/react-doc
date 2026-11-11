import { yamlParse, yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';

// A card as a document (doc/README.md#a-card-is-a-document): one Markdown item of the object,
// its data in the frontmatter and its text in the body, which the page compiles and renders
// as any document. The object registers these items with the source
// (main/doc_page_impl_obj_frontend.md#documents-of-an-object), so a card names another by its
// file name, {key}.md, and a place in it by a fragment:
//
//   [Chunking strategies](rag-chunking.md)            another card of the same object
//   [Semantic chunking](rag-chunking.md#semantic)     a section (an Anchor id, or a heading)
//   [Q15 · B](q015.md#option-b)                       an option of a question
//   [the guide](~docs/guide.md?nav=page)              a document of the page, the classic way
//
// Pure: text in, data out.

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

// { meta, body } of the text of a card; meta {} when it has no frontmatter or it does not parse
export function zettelDocParse(text) {
	const source = String(text ?? '');
	const match = FRONTMATTER.exec(source);
	if (!match) return { meta: {}, body: source, message: '' };
	try {
		const meta = yamlParse(match[1]);
		return { meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}, body: source.slice(match[0].length), message: '' };
	} catch (error) {
		return { meta: {}, body: source.slice(match[0].length), message: String(error?.message ?? error) };
	}
}

export function zettelDocTextBuild(meta, body) {
	return `---\n${yamlStringify(meta, { lineWidth: 0 }).trimEnd()}\n---\n\n${String(body ?? '').trim()}\n`;
}

// the same card with some keys of its frontmatter changed (null removes one), its body kept
export function zettelDocMetaSet(text, change) {
	const { meta, body } = zettelDocParse(text);
	const metaNext = { ...meta };
	for (const [key, value] of Object.entries(change)) {
		if (value === null || value === undefined) delete metaNext[key];
		else metaNext[key] = value;
	}
	return zettelDocTextBuild(metaNext, body);
}

const ANCHOR = /^<!--\s*renderComp=Anchor,id=([A-Za-z0-9_-]+)[^>]*-->\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

export const zettelHeadingIdOf = (title) => String(title ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');

// the sections of a body: what stands under each heading, with the id a link names it by
// (the Anchor marker before the heading, else the id made of its title) and the ids of the
// Anchor markers inside it. [{ id, title, depth, text, anchorList }]; what precedes the first
// heading is a section without a title
export function zettelDocSectionListRead(body) {
	const sectionList = [];
	let section = { id: '', title: '', depth: 0, lineList: [], anchorList: [] };
	let anchorPending = '';
	let isFence = false;
	const sectionClose = () => {
		const text = section.lineList.join('\n').trim();
		if (section.title || text) sectionList.push({ id: section.id, title: section.title, depth: section.depth, text, anchorList: section.anchorList });
	};
	for (const line of String(body ?? '').split(/\r?\n/)) {
		if (/^\s*(```|~~~)/.test(line)) isFence = !isFence;
		const anchor = isFence ? null : ANCHOR.exec(line.trim());
		if (anchor) {
			if (anchorPending) section.anchorList.push(anchorPending);
			anchorPending = anchor[1];
			continue;
		}
		const heading = isFence ? null : HEADING.exec(line);
		if (heading) {
			sectionClose();
			section = { id: anchorPending || zettelHeadingIdOf(heading[2]), title: heading[2], depth: heading[1].length, lineList: [], anchorList: [] };
			anchorPending = '';
			continue;
		}
		if (anchorPending && line.trim() !== '') {
			section.anchorList.push(anchorPending);
			anchorPending = '';
		}
		section.lineList.push(line);
	}
	if (anchorPending) section.anchorList.push(anchorPending);
	sectionClose();
	return sectionList;
}

// the links of a text to other cards: Markdown links whose target is a file name {key}.md (or a
// path ending with it), [{ key, place, label, param, index, length }]. a target with a scheme is not one
const LINK = /\[((?:[^\]\\]|\\.)*)\]\(\s*<?([^)\s>#?]+\.mdx?)(\?[^)\s>#]*)?(?:#([^)\s>]+))?>?\s*\)/g;

export function zettelDocLinkListRead(text) {
	const list = [];
	for (const match of String(text ?? '').matchAll(LINK)) {
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(match[2])) continue;
		const name = match[2].split('/').pop();
		list.push({ key: name.replace(/\.mdx?$/, ''), place: match[4] ?? '', label: match[1], param: match[3] ?? '', index: match.index, length: match[0].length });
	}
	return list;
}

// the words of a body without its marks: for a preview, a search, a card of a diagram
export function zettelDocPlain(text) {
	return String(text ?? '')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(LINK, '$1')
		.replace(/\[((?:[^\]\\]|\\.)*)\]\([^)]*\)/g, '$1')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/^\s*[-*+]\s+/gm, '')
		.replace(/[*_`|]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

// a text cut at a word, with an ellipsis
export function zettelTextClip(text, length) {
	const plain = String(text ?? '').replace(/\s+/g, ' ').trim();
	if (plain.length <= length) return plain;
	const cut = plain.slice(0, length - 1);
	const space = cut.lastIndexOf(' ');
	return `${(space > length * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

export const zettelOptionAnchorOf = (optionId) => `option-${String(optionId).toLowerCase()}`;
// the option a fragment of a question names: 'B' for option-b, '' otherwise
export const zettelOptionOfAnchor = (place) => /^option-([a-z])$/.exec(String(place ?? ''))?.[1].toUpperCase() ?? '';
