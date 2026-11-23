import { editTemplateListBuild } from '../../../../main/comp-doc/edit/edit-template.js';
import { cardCompSlashNameOf } from './CardCompData.js';

// The components a card may hold (card-diagram-impl.md#a-component-in-a-card): those the insert menu
// of a document offers (edit-template.js), started from the same source, but for one that cannot be
// held by a node (meta.isNotInNode: a canvas of its own), one whose data must be an asset item first,
// one naming an object picked first, and one written as text rather than in the comment-block form.
// Read from the registry of the page (compById, configDoc of useDocStores), by the card and the
// create panel.

// the components a card may hold, in the registry of the page: [{ compName, label, description,
// icon, source: { lang, raw, props }, slashName, wordList }] in the order of the insert menu
export function cardCompEntryListBuild({ compById = {}, configDoc } = {}) {
	let templateList = [];
	try {
		templateList = editTemplateListBuild({ configDoc, compById, docPath: '', docFormat: 'md', compConfigGet: () => ({}) });
	} catch {
		return [];
	}
	return templateList
		.filter((template) => template.group === 'component' && template.source && !template.isAssetOnly && !template.objectPick && !template.isNotInNode)
		.map((template) => {
			const slashName = template.slashNameList?.[0] ?? cardCompSlashNameOf(template.compName);
			return {
				compName: template.compName,
				label: template.label,
				description: template.description,
				icon: template.icon,
				source: template.source,
				slashName,
				wordList: [template.compName, cardCompSlashNameOf(template.compName), ...(template.slashNameList ?? [])],
			};
		});
}

