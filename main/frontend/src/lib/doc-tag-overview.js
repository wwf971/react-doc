import { tagAssetKeyParse } from './doc-tag-declare.js';
import { tagDisplayGet } from './doc-tag-model.js';

// Overview of the assets carrying one tag. Design: doc_page_impl_tag.md
//
//   nodeList            the side-panel tree, reduced to tagged items and the
//                       folders above them; folders keep their tree order
//   assetListOutside    tagged assets no side-panel item is bound to, such as
//                       documents collected by source rules but not listed
//                       in the side panel; shown last
//
// overview node: { itemId, text, kind, assetKey, route, isTagged, children }
//   kind      folder | folder-file | file | panel | inline | ... (side-panel item kind)
//   route     item route to navigate to, '' for a folder without a document
//   isTagged  false for a folder kept only because a descendant is tagged
export function tagOverviewBuild({ treeModel, tagModel, entryByPath, tagId }) {
  const assetKeyTaggedSet = new Set(tagModel.assetKeyListByTagId.get(tagId) ?? []);
  const assetKeyFoundSet = new Set();

  const nodeBuild = (node) => {
    if (node.type === 'separator') return undefined;
    const outline = treeModel.itemOutlineById.get(node.$id);
    const assetKey = outline?.assetKey ?? '';
    const isTagged = assetKeyTaggedSet.has(assetKey);
    if (isTagged) assetKeyFoundSet.add(assetKey);
    const children = Array.isArray(node.children)
      ? node.children.map(nodeBuild).filter(Boolean)
      : [];
    if (!isTagged && children.length === 0) return undefined;
    return {
      itemId: node.$id,
      text: outline?.text ?? '',
      kind: outline?.kind ?? '',
      assetKey,
      route: node.type === 'folder' ? node.index?.url ?? '' : node.url ?? '',
      isTagged,
      children,
    };
  };

  const nodeList = treeModel.treePage.children.map(nodeBuild).filter(Boolean);
  const assetListOutside = [...assetKeyTaggedSet]
    .filter((assetKey) => !assetKeyFoundSet.has(assetKey))
    .map((assetKey) => {
      const { assetType, assetId } = tagAssetKeyParse(assetKey);
      const entry = assetType === 'doc' ? entryByPath.get(assetId) : undefined;
      return { assetKey, assetType, assetId, title: entry?.title ?? assetId };
    });

  return {
    tagId,
    tag: tagDisplayGet(tagModel, { id: tagId, data: {} }),
    assetCount: assetKeyTaggedSet.size,
    nodeList,
    assetListOutside,
  };
}
