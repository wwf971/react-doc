import { tagAssetKeyGet, tagListNormalize } from './doc-tag-declare.js';

// Side-panel step of the tag system. Design: doc_page_impl_tag.md
//
// "tags" on a side-panel node attach to what the item is bound to:
//   doc item, folder with doc     -> doc:{internal path of the bound document}
//   sourceFolder / sourceRoot     -> folder:{internal folder path}
//   every other item              -> item:{item id}
// page-tree.js calls these while converting the tree, so declarations are
// recorded in tree order (childrenFile imports are already inlined).

export function tagSidePanelAssetKeyGet({ docPath, folderPath, itemId }) {
  if (docPath) return tagAssetKeyGet('doc', docPath);
  if (folderPath) return tagAssetKeyGet('folder', folderPath);
  return tagAssetKeyGet('item', itemId);
}

export function tagSidePanelDeclare(declarationList, node, assetKey, itemId) {
  const tagList = tagListNormalize(node?.tags);
  if (tagList.length === 0) return;
  declarationList.push({
    assetKey,
    tagList,
    origin: { step: 'sidePanel', itemId },
  });
}
