import { MousePointer2, Waypoints } from '../../../../main/frontend/UICommon.js';
import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { diagramEditModeList } from './DiagramEditStore.js';
import { cardDiagramSourceDefaultCreate } from './DiagramERSource.js';
import { CardDiagram } from './CardDiagram.jsx';
import { diagramApiListBuild } from './DiagramApiList.js';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';

// What a card diagram and a standalone card expose through their registry
// definitions (compDefine expose, doc_page_impl_mdx_comp.md#what-a-component-exposes),
// shared by every series: the visual edit mode (card-diagram-impl.md#card-editing)
// beside the built-in source mode. The visual mode edits inline data like any
// other component mode, and also the data of an asset reference
// (isEditAssetAccepted): the draft then goes to the asset item, or into the
// block when the author picks "Save to inline". A click on the canvas pans or
// drags, so it never opens the editor: only the Edit button does.
export const cardDiagramMetaShared = {
	isEditAssetAccepted: true,
	isEditEnterButtonOnly: true,
};

// the mode list itself stays in DiagramEditStore.js, which tests load
// without the page's icon set
export const cardDiagramEditModeList = diagramEditModeList.map((mode) => ({ ...mode, icon: MousePointer2 }));

// the options of compDefine for a card diagram component of any series:
// it draws with @xyflow/react, and learns whether its data is an asset
// (isAssetAware) since its visual edit mode also edits asset data. registry: its node
// registry, when it draws a diagram: its connection lines get apis (DiagramApiList.js)
export function cardDiagramDefineOptionsBuild({ label, description, icon = Waypoints, sourceDefaultCreate, registry }) {
	return {
		placementList: ['mdx', 'commentBlock'],
		isAssetAware: true,
		expose: {
			meta: { ...cardDiagramMetaShared, label, description },
			icon,
			editModeList: cardDiagramEditModeList,
			sourceDefaultCreate,
			...(registry ? { apiList: diagramApiListBuild(registry) } : {}),
		},
	};
}

// CardDiagram: the diagram of the base series, generic tables (any number
// of rows and columns) and operators (card-diagram-node-registry.js)
export const cardDiagramDefine = compDefine(CardDiagram, cardDiagramDefineOptionsBuild({
	label: 'Card diagram',
	description: 'Generic table cards and operators joined by connections on a canvas.',
	sourceDefaultCreate: cardDiagramSourceDefaultCreate,
	registry: cardDiagramNodeRegistry,
}));
