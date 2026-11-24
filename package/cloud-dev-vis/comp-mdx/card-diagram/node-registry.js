import { Waypoints } from '../../../../main/frontend/UICommon.js';

// The node registry of a diagram component (card-diagram-impl.md#node-registries):
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
//     contract    { dataNormalize?, anchorListGet, sizeDefault, sizeMin?, resizeAxisList?, sizeModeList?, styleList? }:
//                 what the diagram may assume about the node (DiagramERData.js). resizeAxisList: what
//                 its resize handles change, where the rule of DiagramNodeResize.js (read from the
//                 node) is wrong for the kind; sizeModeList: the ways its box is taken (fit, wrap,
//                 box; DiagramNodeResize.js), the first the default, switched in the edit card;
//                 styleList: the keys of node.style its card draws (DiagramNodeStyle.js)
//     schema      the card schema (TableCardSchema.js) when the node is a
//                 card the editor knows rows and fields of; null otherwise
//     Card        the component drawing the node: { node, schema, anchorRef,
//                 editor, nodeId }
//     create      optional: { description, icon, keywordList, nodeCreate(idNext) }
//                 makes the kind an entry of the create panel; nodeCreate
//                 returns the authored node without its position, idNext(prefix)
//                 gives an id unused in the diagram
//
//   registry = nodeRegistryBuild({ id, label, kindList, cardLegacyConvert?, arrangerList? })
//     kindByType        type -> kind
//     createEntryList   the entries of the create panel: the kinds with a
//                       create entry, in kind order, then a connection
//     cardLegacyConvert optional: the authored data of a standalone card
//                       without `version`, turned into { version: 1, node }
//     arrangerList      the arrangers the editor and the apis of the component
//                       offer (card-diagram-arrange.md); none by default
//     featureList       the features of its diagrams (below); none by default
//
// A **feature** is a layer over the diagrams of a registry that the engine knows only through
// hooks, never by name (card-diagram-impl.md#features): it owns a section of the data of a diagram,
// may place nodes, and may join the visual editor. The parametric canvas is one.
//
//   feature
//     id            what a viewport names to offer it for editing (viewport.featureList)
//     dataKey       the top-level key of a diagram it owns
//     graphResolve(value, graph, { registry }) -> { data?, nodeList?, placer? } | undefined
//                   called by diagramNormalize after the nodes and the connections are read, with
//                   the value of its key; it throws for what it refuses. data is kept as
//                   graph.featureById[id]; nodeList are nodes it derives (already normalized, id
//                   starting with ~, isDerived); placer places nodes (DiagramERData.js: diagramPlacesGet)
//     ReadLayer     a component, { canvasStore }: what it draws over the canvas (inside React Flow)
//                   while the diagram is read, and while it is edited where its session is not on
//                   (the session draws its own CanvasLayer then). It reads graph.featureById[id] and
//                   what its placer answered (canvasStore.placed)
//     editCreate({ store, registry, config, canvas, stores, isOnGet }) -> a session of the visual editor, or nothing
//                   (DiagramVisualEdit.jsx: what a session may answer). stores: the stores of the page
//     configDefineList   keys of the component config its diagram components declare for it
//                   (card-diagram-comp.js), in the form of doc_page_impl_config.md#component-level-config
//     kindList      kinds it brings (what it draws with: a shape, a text): kinds of every registry
//                   listing it, after the registry's own, offered by its create panel like any other
//     apiListBuild({ changeApi, readApi }) -> apis   the apis of the diagram components listing it,
//                   for an agent (DiagramApiList.js): changeApi(options, command(store, params, ends,
//                   diagram)) changes the draft of an open session or the block, readApi(options,
//                   read(store, params, diagram)) answers what is read
export function nodeRegistryBuild({ id, label, kindList: kindOwnList, cardLegacyConvert, arrangerList = [], featureList = [] }) {
	// a registry built from another one's kindList holds the kinds of its features already: the same
	// kind is no second declaration
	const kindList = [...kindOwnList, ...featureList.flatMap(feature => feature.kindList ?? []).filter(kind => !kindOwnList.includes(kind))];
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
	const featureById = {};
	for (const feature of featureList) {
		if (featureById[feature.id]) throw new Error(`Node registry ${id}: the feature ${feature.id} is declared twice.`);
		featureById[feature.id] = feature;
	}
	return { id, label, kindList, kindByType, createEntryList, cardLegacyConvert, arrangerList, featureList, featureById };
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
