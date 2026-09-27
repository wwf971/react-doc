import { configDeclaredIs } from './doc-config-define.js';

// Side-panel level of the config system. Design: doc_page_impl_config.md
//
// "config" on a side-panel node applies to the document the node binds and to
// every document bound by items below it (generated sourceFolder items
// included). page-tree.js opens a declaration before converting the node's
// children, so a deeper node is declared later and wins:
//
//   const declaration = configSidePanelDeclareOpen(list, node, itemId)
//   ... convert the node and its children ...
//   configSidePanelDeclareClose(declaration, itemListOfNode)
export function configSidePanelDeclareOpen(declarationList, node, itemId) {
  if (node?.config === undefined) return undefined;
  if (!configDeclaredIs(node.config)) {
    console.warn(`[doc-config] side-panel "config" must be a mapping (item ${itemId || '(no id)'})`);
    return undefined;
  }
  const declaration = {
    config: node.config,
    docPathList: [],
    origin: { step: 'sidePanel', itemId },
  };
  declarationList.push(declaration);
  return declaration;
}

export function configSidePanelDeclareClose(declaration, itemList) {
  if (!declaration) return;
  const docPathSet = new Set();
  for (const item of itemList) {
    if (item.docPath) docPathSet.add(item.docPath);
  }
  declaration.docPathList = [...docPathSet];
}
