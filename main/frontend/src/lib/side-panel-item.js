import { createElement } from 'react';
import { SidePanelItemHost } from '../../../comp-doc/side-panel/SidePanelItemHost.jsx';
import { compDefinitionNormalize, compIdResolve } from '../../../comp-doc/registry/comp-registry.js';
import { tagListNormalize } from './doc-tag-declare.js';

// Decides how one side-panel item label is rendered. Design: doc_page_side_panel.md
//
//   node.display.component                    explicit per-item component
//   -> sidePanel.itemDisplay.component        document, panel and inline items;
//                                             not folders or separators
//   -> SidePanelItem                          registry name; the package default
//                                             unless compRegistry maps it elsewhere
//
// The result is the fumadocs page-tree "name": an element of SidePanelItemHost,
// which adds runtime context (resolved tags, tag service, surface) at render time.
export function sidePanelItemNameCreate(node, textDefault, context, options = {}) {
  const { assetKey, dataItem = {}, isItemDisplayApplied = false, itemId } = options;
  const displayDefault = context.configDoc.sidePanel?.itemDisplay;
  const text = node.text ?? textDefault;
  const compNameCustom = node.display?.component
    ?? (isItemDisplayApplied ? displayDefault?.component : undefined);

  let compName = 'SidePanelItem';
  if (compNameCustom) {
    if (compIsRegistered(compNameCustom, context)) compName = compNameCustom;
    else console.warn(`[page-tree] display component not registered: ${compNameCustom}`);
  }
  if (!compIsRegistered(compName, context)) return text;

  return createElement(SidePanelItemHost, {
    assetKey,
    compName,
    itemId,
    data: sidePanelItemDataBuild(node, text, dataItem, displayDefault),
  });
}

// data known when the tree is built. tagList is added by the host at render
// time, because later side-panel items can still change a document's tags.
function sidePanelItemDataBuild(node, text, dataItem, displayDefault) {
  const { children: _children, ...itemDeclared } = node;
  return {
    ...(displayDefault?.data ?? {}),
    ...dataItem,
    ...(node.display?.data ?? {}),
    itemDeclared,
    tagListDeclared: tagListNormalize(node.tags),
    text,
  };
}

function compIsRegistered(compName, context) {
  const compId = compIdResolve(context.configDoc, compName);
  return Boolean(compDefinitionNormalize(context.compById[compId]));
}
