import { Waypoints } from '../../../../main/frontend/UICommon.js';

// The node registry of a diagram component (card-diagram.md#node-registries):
// the node kinds a diagram of that component can draw, and the entries its
// create panel offers. A registry is fixed per component type: each series
// of components builds its own from the kinds it knows, and binds it to its
// components, so a diagram never offers the nodes of an unrelated series.
// A node drawn by a registered component (renderer.component, placement
// visualizationNode) is not a kind: it is resolved through the component
// registry of the page, by every diagram alike.
//
//   kind
//     type        the renderer type authored in `renderer: { type }`
//     label       its name in the create panel and in messages
//     contract    { dataNormalize?, anchorListGet, sizeDefault, sizeMin? }:
//                 what the diagram may assume about the node (DiagramERData.js)
//     schema      the card schema (TableCardSchema.js) when the node is a
//                 card the editor knows rows and fields of; null otherwise
//     Card        the component drawing the node: { node, schema, anchorRef,
//                 editor, nodeId }
//     create      optional: { description, icon, keywordList, nodeCreate(idNext) }
//                 makes the kind an entry of the create panel; nodeCreate
//                 returns the authored node without its position, idNext(prefix)
//                 gives an id unused in the diagram
//
//   registry = nodeRegistryBuild({ id, label, kindList, cardLegacyConvert? })
//     kindByType        type -> kind
//     createEntryList   the entries of the create panel: the kinds with a
//                       create entry, in kind order, then a connection
//     cardLegacyConvert optional: the authored data of a standalone card
//                       without `version`, turned into { version: 1, node }
export function nodeRegistryBuild({ id, label, kindList, cardLegacyConvert }) {
	const kindByType = {};
	for (const kind of kindList) {
		if (kindByType[kind.type]) throw new Error(`Node registry ${id}: the type ${kind.type} is declared twice.`);
		kindByType[kind.type] = kind;
	}
	const createEntryList = kindList.filter(kind => kind.create).map(kind => ({
		id: kind.type,
		label: kind.label,
		description: kind.create.description,
		icon: kind.create.icon,
		keywordList: kind.create.keywordList ?? [],
		create: kind.create.nodeCreate,
	}));
	createEntryList.push({ id: 'connection', label: 'Connection', description: 'A line with two free ends; drag an end onto a handle.', icon: Waypoints, keywordList: ['line', 'edge', 'relationship'], isConnection: true });
	return { id, label, kindList, kindByType, createEntryList, cardLegacyConvert };
}

// the create entries of a registry matching what is typed: label first, then
// type and keywords, then description
export function nodeRegistrySearch(registry, query) {
	const entryList = registry?.createEntryList ?? [];
	const queryLower = query.trim().toLowerCase();
	if (!queryLower) return entryList.map(entry => ({ entry, rank: 0 }));
	return entryList.map(entry => {
		const rank = entry.label.toLowerCase().includes(queryLower) ? 0 : entry.id.includes(queryLower) || entry.keywordList.some(keyword => keyword.includes(queryLower)) ? 1 : entry.description.toLowerCase().includes(queryLower) ? 2 : -1;
		return { entry, rank };
	}).filter(item => item.rank >= 0).sort((a, b) => a.rank - b.rank);
}

// a card with head fields and property rows (ResourceNodeCard.jsx): its
// create function. a series uses it for its resource kinds
export function resourceNodeCreateBuild(type, fields, name) {
	return (idNext) => {
		const data = Object.fromEntries(fields.map(field => [field.id, field.defaultValue ?? '']));
		data.name = name;
		data.properties = [];
		return { id: idNext(type), renderer: { type }, data, handles: [
			{ id: 'in', direction: 'in', anchor: { target: 'header', side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { target: 'header', side: 'right' } },
		] };
	};
}
