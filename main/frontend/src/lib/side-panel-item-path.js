// An item of the side panel named by its path: the labels (or ids) of the
// items from the top of the side panel down to it, as a reader finds it.
// The home of the page (homeItem: what "/" opens) is named so. Design:
// doc_page_impl_side_panel.md#naming-an-item-by-its-path
//
//   Japanese areas                        an item at the top
//   map-styles / Japanese areas           the section of the doc page map-styles, then an item
//   Block maps / Block maps: the format   a folder, then an item in it
//   shikuchoson                           an id
//
// segments are separated by "/" (spaces around it are left out); "\/" is a
// "/" inside a segment. A segment names one item among those of the level
// under the previous segment (the top of the side panel first): by its id,
// else by its label: any language of it, the title of its document for a
// document item without a label of its own; case and runs of spaces do not
// count. With several items matching, an id wins over a label, then the
// first in tree order.
//
// the levels a reader does not see may be left out, or named:
//   a section (a root doc page of a workspace of several)   its alias
//   a sole root unfolded (isSidebarRootUnfolded)           drawn among its
//                                                          children: named or skipped
// a separator is never named.
//
// a path of one segment naming nothing at the top names the item of that id
// wherever it is (what homeItem meant before it took a path).

// "a / b\/c" -> ['a', 'b/c']; empty segments are left out
export function sidePanelItemPathParse(text) {
  if (typeof text !== 'string') return [];
  const segmentList = [];
  let segment = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\' && text[index + 1] === '/') {
      segment += '/';
      index += 1;
    } else if (char === '/') {
      segmentList.push(segment);
      segment = '';
    } else {
      segment += char;
    }
  }
  segmentList.push(segment);
  return segmentList.map(textKeyGet.bind(null, false)).filter((item) => item !== '');
}

// treePage: the fumadocs page tree of the side panel (DocStore.treeModel.treePage)
//   outlineGet(itemId)   the outline of an item (treeModel.itemOutlineById)
// -> { node, message }: the node of the tree named, or undefined and why
export function sidePanelItemPathResolve(treePage, pathText, { outlineGet }) {
  const segmentList = sidePanelItemPathParse(pathText);
  if (segmentList.length === 0) return { node: undefined, message: 'the path names no item' };
  let nodeList = treePage?.children ?? [];
  let node;
  for (const [index, segment] of segmentList.entries()) {
    node = segmentMatch(candidateListGet(nodeList), segment, outlineGet);
    if (!node && segmentList.length === 1) node = nodeByIdFind(treePage?.children ?? [], segment);
    if (!node) {
      const place = index === 0 ? 'at the top of the side panel' : `in "${segmentList.slice(0, index).join(' / ')}"`;
      return { node: undefined, message: `"${segment}" names no item ${place}` };
    }
    nodeList = Array.isArray(node.children) ? node.children : [];
  }
  return { node, message: '' };
}

// treeModel: DocStore.treeModel
// -> { route, message }: the route the path opens ('' and why when none): a
//    document, a panel or an inline item its own; a folder its document,
//    else the first document below it
export function sidePanelItemPathRouteGet(treeModel, pathText) {
  const { node, message } = sidePanelItemPathResolve(treeModel?.treePage, pathText, {
    outlineGet: (itemId) => treeModel?.itemOutlineById?.get(itemId),
  });
  if (!node) return { route: '', message };
  if (node.type === 'page') return { route: node.url ?? '', message: '' };
  if (node.index?.url) return { route: node.index.url, message: '' };
  const route = treeModel.itemFirstDocByNodeId?.get(node.$id)?.route ?? '';
  return route
    ? { route, message: '' }
    : { route: '', message: `"${pathText}" names a folder without a document in it` };
}

// the nodes a segment chooses from: those of the level, where a section and
// a sole root unfolded stand with their children beside them
function candidateListGet(nodeList) {
  const candidateList = [];
  for (const node of nodeList) {
    if (!node || typeof node !== 'object' || node.type === 'separator') continue;
    candidateList.push(node);
    if (node.type === 'folder' && (node.docPageSection || node.isSidebarRootUnfolded)) {
      candidateList.push(...candidateListGet(Array.isArray(node.children) ? node.children : []));
    }
  }
  return candidateList;
}

function segmentMatch(candidateList, segment, outlineGet) {
  const nodeById = candidateList.find((node) => node.$id === segment || node.docPageSection?.alias === segment);
  if (nodeById) return nodeById;
  const key = textKeyGet(true, segment);
  return candidateList.find((node) => labelListGet(node, outlineGet).some((label) => textKeyGet(true, label) === key));
}

function labelListGet(node, outlineGet) {
  const textLocalized = node.$id ? outlineGet(node.$id)?.textLocalized : undefined;
  const labelList = typeof textLocalized === 'string'
    ? [textLocalized]
    : textLocalized && typeof textLocalized === 'object' ? Object.values(textLocalized) : [];
  if (node.docPageSection?.alias) labelList.push(node.docPageSection.alias);
  return labelList.filter((label) => typeof label === 'string');
}

function nodeByIdFind(nodeList, itemId) {
  for (const node of nodeList) {
    if (!node || typeof node !== 'object') continue;
    if (node.$id === itemId && node.type !== 'separator') return node;
    const nodeFound = Array.isArray(node.children) ? nodeByIdFind(node.children, itemId) : undefined;
    if (nodeFound) return nodeFound;
  }
  return undefined;
}

// spaces around trimmed and runs of them made one; isCaseIgnored: lower case too
function textKeyGet(isCaseIgnored, text) {
  const key = String(text).trim().replace(/\s+/g, ' ');
  return isCaseIgnored ? key.toLowerCase() : key;
}
