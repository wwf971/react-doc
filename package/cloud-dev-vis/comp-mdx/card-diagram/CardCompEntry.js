import { editTemplateListBuild } from '../../../../main/comp-doc/edit/edit-template.js';
import { compDefinitionNormalize, compIdBuiltinByName, compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import { compDefinitionGet } from '../../../../main/comp-doc/registry/comp-definition.js';
import { compBlockTextRead, compIsDocBlock, compMetaGet } from '../../../../main/comp-doc/registry/comp-expose.js';
import { cardCompDataOfBlockSource, cardCompSlashNameOf } from './CardCompData.js';

// The components a card may hold (card-diagram-impl.md#a-component-in-a-card). The rule: **a card
// holds what a document holds as a block**. Every component the insert menu of a document offers
// (edit-template.js) and that can stand as a block of a document, at its top level or in the text of
// a list item (compIsDocBlock: its placements allow the comment block), is offered, started as the
// document starts it:
//   its comment-block form ({ lang, raw, props })    as it is
//   a block of a form of its own ({ text }: $$ lines of math, a quote after the marker of
//   BlockSimple)                                     read as the document reads it
//                                                    (cardCompDataOfBlockSource)
//   naming an object picked first (insertObjectPick: the entry of a frontend object)
//                                                    objectPick: the panel asks for the object, then
//                                                    starts it from the text for that object
//   its data an asset item (isAssetOnly: a spreadsheet)
//                                                    its source is the data of a new item of the
//                                                    store, the card holds the reference
//                                                    (CardCompAsset.js)
// A component drawing a canvas of React Flow itself (meta.isFlowCanvas: a card diagram) is held too,
// drawn by the card as a tile and opened in a dialog (CardComp.jsx). Nothing that a document takes as
// a block is left out: CardCompEntry.test.js checks every component of the page and of the packages.
// Read from the registry of the page (compById, configDoc of useDocStores), by the card and the
// create panel.

// the components a card may hold, in the registry of the page: [{ compName, label, description,
// icon, source: { lang, raw, props }, isAssetOnly, objectPick?, sourceForObjectGet?(objectRef),
// slashName, wordList, sizeDefault? }] in the order of the insert menu. isAssetOnly: source is the
// starting data of its asset item, not what the card writes. objectPick: { typeList, isCreateOffered }
// of the component (meta.insertObjectPick), sourceForObjectGet(ref) its source naming that object.
// sizeDefault: the width a card holding it starts at, when the component says one
// (expose.nodeSizeDefault: { width }, a spreadsheet wider than a note)
export function cardCompEntryListBuild({ compById = {}, configDoc } = {}) {
	let templateList = [];
	try {
		templateList = editTemplateListBuild({ configDoc, compById, docPath: '', docFormat: 'md', compConfigGet: () => ({}) });
	} catch {
		return [];
	}
	const readerList = cardCompBlockReaderListBuild({ compById, configDoc });
	const sourceOf = (template, text) => {
		if (text === undefined) return template.source ?? template.assetSource ?? null;
		const data = cardCompDataOfBlockSource(text, readerList);
		return data ? { lang: data.lang, raw: data.raw, props: data.props ?? {} } : null;
	};
	const entryList = [];
	for (const template of templateList) {
		if (template.group !== 'component') continue;
		const definition = compDefinitionGet(compById, compIdResolve(configDoc, template.compName));
		if (!compIsDocBlock(definition)) continue;
		const source = template.source || template.assetSource ? sourceOf(template) : sourceOf(template, template.text);
		if (!source) continue;
		const slashName = template.slashNameList?.[0] ?? cardCompSlashNameOf(template.compName);
		const width = definition?.expose?.nodeSizeDefault?.width;
		entryList.push({
			compName: template.compName,
			label: template.label,
			description: template.description,
			icon: template.icon,
			source,
			isAssetOnly: Boolean(template.isAssetOnly),
			...(template.objectPick ? {
				objectPick: template.objectPick,
				sourceForObjectGet: (objectRef) => sourceOf(template, template.textForObjectGet(objectRef)),
			} : {}),
			isFlowCanvas: compMetaGet(definition).isFlowCanvas === true,
			slashName,
			wordList: [template.compName, cardCompSlashNameOf(template.compName), ...(template.slashNameList ?? [])],
			...(Number.isFinite(width) && width > 0 ? { sizeDefault: { width } } : {}),
		});
	}
	return entryList;
}

// the components of the page that read a block of a document written in a form of their own, not a
// marker and a fence (expose.blockTextRead: Code a fenced code block, MathBlock $$ lines), each by
// the tag name the page knows it by: [{ compName, read(text) -> { lang, raw, props } | null }]. What
// cardCompDataOfBlockSource takes such a block by
export function cardCompBlockReaderListBuild({ compById = {}, configDoc } = {}) {
	const readerList = [];
	const compIdDoneSet = new Set();
	for (const [compName, compId] of Object.entries({ ...compIdBuiltinByName, ...(configDoc?.compRegistry ?? {}) })) {
		if (compIdDoneSet.has(compId)) continue;
		const definition = compDefinitionNormalize(compDefinitionGet(compById, compId));
		if (!definition?.expose?.blockTextRead || !compIsDocBlock(definition)) continue;
		compIdDoneSet.add(compId);
		readerList.push({ compName, read: (text) => compBlockTextRead(definition, text) });
	}
	return readerList;
}
