// Searching the items of the side panel by their names. Design:
// doc_page_impl_side_panel.md#searching-the-items
//
// The entries are the items the reader sees in the side panel shown (the
// workspace's: every section, the effective occurrence of every doc page),
// in tree order, each with its label as displayed and where it stands: the
// alias of its section and the labels of the folders above it.
//
//   a document, a panel, an inline item     an entry, with its route
//   a folder bound to a document            an entry, with the route of its document
//   a folder, a separator                   an entry without a route (choosing one reveals it)
//   a section (a root doc page of several)  no entry: its alias heads the path of its items
//   a sole root unfolded (isSidebarRootUnfolded)
//                                           an entry when it is bound (its root row), none
//                                           when it is not (nothing of it is drawn); no
//                                           level of the path either way
//   an item mirroring a source folder       an entry, and the search stops there: the files
//                                           and folders generated below it are not searched
//   a generated item                        never an entry (the search stops above it)
//
// The search does not go into a source folder: its items are files on disk,
// generated each time the tree is built, and a folder can hold far more of
// them than the authored side panel has items. A later search over files
// (the unified search) would take them in, kept apart from the authored
// items (doc_page_impl_TODO.md#side-panel-search-source-folder).

// treePage: the fumadocs page tree of the side panel (DocStore.treeModel.treePage)
//   outlineGet(itemId)   the outline of an item (treeModel.itemOutlineById)
//   textGet(outline)     the label of an item as displayed (the page language)
// -> [{ itemId, text, pathList, ancestorIdList, route, kind, order }]
//    kind: 'doc' | 'folder' | 'folderDoc' | 'sourceFolder' | 'panel' | 'inline' | 'separator'
//    ancestorIdList: the section and the folders above, outermost first (to reveal it)
export function sidePanelSearchEntryListBuild(treePage, { outlineGet, textGet }) {
  const entryList = [];
  const visit = (node, pathList, ancestorIdList) => {
    if (!node || typeof node !== 'object') return;
    const outline = node.$id ? outlineGet(node.$id) : undefined;
    // an item made from the files of a source folder: never searched (the
    // tree generated without a side panel has no source folder node, and is
    // searched whole)
    if (outline?.generatedFrom) return;
    const entryAdd = (kind, route) => {
      const text = textGet(outline);
      if (!text) return;
      entryList.push({ itemId: node.$id, text, pathList, ancestorIdList, route, kind, order: entryList.length });
    };
    if (node.type === 'separator') {
      if (outline) entryAdd('separator', '');
      return;
    }
    if (node.type === 'page') {
      if (outline) entryAdd(outline.kind === 'panel' ? 'panel' : outline.kind === 'inline' ? 'inline' : 'doc', node.url ?? '');
      return;
    }
    if (node.type !== 'folder') return;
    const childList = Array.isArray(node.children) ? node.children : [];
    if (node.docPageSection) {
      const pathSection = [...pathList, node.docPageSection.alias];
      for (const child of childList) visit(child, pathSection, [...ancestorIdList, node.$id]);
      return;
    }
    if (node.isSidebarRootUnfolded) {
      if (node.index && outline) entryAdd('folderDoc', node.index.url ?? '');
      for (const child of childList) visit(child, pathList, ancestorIdList);
      return;
    }
    if (!outline) return;
    if (outline.isSourceFolder) {
      // the search stops at the item of a source folder
      entryAdd('sourceFolder', '');
      return;
    }
    entryAdd(node.index ? 'folderDoc' : 'folder', node.index?.url ?? '');
    const pathFolder = [...pathList, textGet(outline) || node.$id];
    for (const child of childList) visit(child, pathFolder, [...ancestorIdList, node.$id]);
  };
  for (const node of treePage?.children ?? []) visit(node, [], []);
  return entryList;
}

// the entries whose label holds every word of the query (case-insensitive,
// in any order), best first: the label starting with the query as typed,
// then holding it as typed, then holding its words apart; tree order within
// each. countMax bounds the list; countMatched says how many matched.
// -> { wordList, resultList: [{ entry, matchOrder }], countMatched }
export function sidePanelSearchMatch(entryList, query, { countMax = 50 } = {}) {
  const queryLower = String(query ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (queryLower === '') return { wordList: [], resultList: [], countMatched: 0 };
  const wordList = [...new Set(queryLower.split(' '))];
  const resultList = [];
  for (const entry of entryList) {
    const textLower = entry.text.toLowerCase();
    if (!wordList.every((word) => textLower.includes(word))) continue;
    let matchOrder = 2;
    if (textLower.startsWith(queryLower)) matchOrder = 0;
    else if (textLower.includes(queryLower)) matchOrder = 1;
    resultList.push({ entry, matchOrder });
  }
  resultList.sort((a, b) => a.matchOrder - b.matchOrder || a.entry.order - b.entry.order);
  return { wordList, resultList: resultList.slice(0, countMax), countMatched: resultList.length };
}
