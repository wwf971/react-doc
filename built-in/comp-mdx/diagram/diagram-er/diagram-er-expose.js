import { MousePointer2, TableProperties, Waypoints } from '../../../../main/frontend/UICommon.js';
import { dataverseEditModeList } from './DataverseEditStore.js';
import { dataverseSourceDefaultCreate, diagramSourceDefaultCreate } from './DiagramERSource.js';
import { powerAutomateSourceDefaultCreate } from './PowerAutomateNodeSource.js';
import { businessRuleSourceDefaultCreate } from './BusinessRuleNodeSource.js';

// What DiagramER and DiagramDataverseEntity expose through their registry
// definitions (compDefine expose, doc_page_impl_mdx_comp.md#what-a-component-exposes).
// Both share the visual edit mode of the Dataverse cards (comp_db_vis.md#card-editing)
// beside the built-in source mode. The visual mode edits inline data like any
// other component mode, and also the data of an asset reference
// (isEditAssetAccepted): the draft then goes to the asset object, or into the
// block when the author picks "Save to inline". A click on the canvas pans or
// drags, so it never opens the editor: only the Edit button does.
const metaShared = {
  isEditAssetAccepted: true,
  isEditEnterButtonOnly: true,
};

// the mode list itself stays in DataverseEditStore.js, which tests load
// without the page's icon set
const editModeList = dataverseEditModeList.map((mode) => ({ ...mode, icon: MousePointer2 }));

export const diagramERExpose = {
  meta: {
    ...metaShared,
    label: 'ER diagram',
    description: 'Nodes and connections on a canvas: Dataverse tables, choices, operators and registered components.',
  },
  icon: Waypoints,
  editModeList,
  // two tables and one connection between column handles: the smallest
  // diagram that shows every part of the format
  sourceDefaultCreate: diagramSourceDefaultCreate,
};

export const diagramDataverseEntityExpose = {
  meta: {
    ...metaShared,
    label: 'Dataverse table',
    description: 'One Dataverse table card with its columns, outside a canvas.',
  },
  icon: TableProperties,
  editModeList,
  sourceDefaultCreate: dataverseSourceDefaultCreate,
};

export const diagramPowerAutomateExpose = {
  ...diagramERExpose,
  meta: { ...metaShared, label: 'Power Automate flow', description: 'Trigger, actions, branches and configuration in a design diagram.' },
  sourceDefaultCreate: powerAutomateSourceDefaultCreate,
};

export const diagramBusinessRuleExpose = {
  ...diagramERExpose,
  meta: { ...metaShared, label: 'Business rule', description: 'Dataverse conditions, actions, scope and target columns.' },
  sourceDefaultCreate: businessRuleSourceDefaultCreate,
};
