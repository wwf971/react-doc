import { editTemplateListBuild } from '../../../../main/comp-doc/edit/edit-template.js';
import { compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import { compDefinitionGet } from '../../../../main/comp-doc/registry/comp-definition.js';
import { cardCompSlashNameOf } from './CardCompData.js';

// The components a card may hold (card-diagram-impl.md#a-component-in-a-card): those the insert menu
// of a document offers (edit-template.js), started from the same source, but for one that cannot be
// held by a node (meta.isNotInNode: a canvas of its own), one naming an object picked first, and one
// written as text rather than in the comment-block form. A component whose data must be an asset
// item (isAssetOnly: a spreadsheet) is offered as the insert menu offers it: its source is the data
// of a new item of the store, and the card holds the reference (CardCompAsset.js). Read from the
// registry of the page (compById, configDoc of useDocStores), by the card and the create panel.

// the components a card may hold, in the registry of the page: [{ compName, label, description,
// icon, source: { lang, raw, props }, isAssetOnly, slashName, wordList, sizeDefault? }] in the
// order of the insert menu. isAssetOnly: source is the starting data of its asset item, not what the card
// writes. sizeDefault: the width a card holding it starts at, when the component says one
// (expose.nodeSizeDefault: { width }, a spreadsheet wider than a note)
export function cardCompEntryListBuild({ compById = {}, configDoc } = {}) {
	let templateList = [];
	try {
		templateList = editTemplateListBuild({ configDoc, compById, docPath: '', docFormat: 'md', compConfigGet: () => ({}) });
	} catch {
		return [];
	}
	return templateList
		.filter((template) => template.group === 'component' && template.source && !template.objectPick && !template.isNotInNode)
		.map((template) => {
			const slashName = template.slashNameList?.[0] ?? cardCompSlashNameOf(template.compName);
			const width = compDefinitionGet(compById, compIdResolve(configDoc, template.compName))?.expose?.nodeSizeDefault?.width;
			return {
				compName: template.compName,
				label: template.label,
				description: template.description,
				icon: template.icon,
				source: template.source,
				isAssetOnly: Boolean(template.isAssetOnly),
				slashName,
				wordList: [template.compName, cardCompSlashNameOf(template.compName), ...(template.slashNameList ?? [])],
				...(Number.isFinite(width) && width > 0 ? { sizeDefault: { width } } : {}),
			};
		});
}
