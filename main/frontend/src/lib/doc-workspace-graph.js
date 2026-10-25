// The workspace as a graph (design: doc_page_impl_source.md#the-workspace-tab):
// what the Workspace tab of the settings panel draws with React Flow.
//
//   workspaceGraphBuild(workspace)
//     -> { nodeList, edgeList, warningList, docPageCount, mentionCount }
//
// workspace is configDoc.workspace (plugin/doc-entry.ts DocWorkspaceInfo):
// its doc pages, every mention of a doc page as an include edge, its
// warnings. a doc page is one node however often it is mentioned: the
// loader identified it by its entry file, so two mentions of one folder
// become two edges into one node. an edge is labeled with the alias the
// mention gives; a mention whose alias is not the one the doc page got
// (another mention came first, root-level ones first) is drawn as a
// conflict, and its message is in warningList.
//
// nodes: { id, type: 'workspace' | 'docPage', position, data }
//   workspace   data { title, isVirtual, docPageCount }
//   docPage     data { docPage (DocPageInfo), isRoot, mentionCount, aliasConflictCount }
// edges: { id, source, target, label, data: { alias, isAliasGiven, isConflict, file, place } }
//
// the layout is by depth: the workspace at the top, the root doc pages
// below it, then the doc pages reached by includes, each level a row;
// the page may drag the nodes afterwards (positions are kept by the store).

export const WORKSPACE_NODE_ID = 'workspace';
const NODE_WIDTH = 236;
const NODE_GAP_X = 44;
const ROW_GAP_Y = 150;
const WORKSPACE_NODE_HEIGHT = 54;

export function workspaceGraphBuild(workspace) {
  const docPageList = Array.isArray(workspace?.docPageList) ? workspace.docPageList : [];
  const includeList = Array.isArray(workspace?.includeList) ? workspace.includeList : [];
  const warningList = Array.isArray(workspace?.warningList) ? workspace.warningList.map(String) : [];
  const docPageByAlias = new Map(docPageList.map((docPage) => [docPage.alias, docPage]));

  // depth: the workspace 0, a root doc page 1, an included one the depth of
  // the first doc page that reaches it plus one (breadth first)
  const depthByAlias = new Map();
  const queue = [];
  for (const docPage of docPageList) {
    if (!docPage.isRoot) continue;
    depthByAlias.set(docPage.alias, 1);
    queue.push(docPage.alias);
  }
  while (queue.length > 0) {
    const aliasFrom = queue.shift();
    for (const include of includeList) {
      if (include.fromAlias !== aliasFrom || depthByAlias.has(include.toAlias)) continue;
      depthByAlias.set(include.toAlias, depthByAlias.get(aliasFrom) + 1);
      queue.push(include.toAlias);
    }
  }
  // a doc page reached by no chain from a root (cannot happen when loaded;
  // a host's data may) goes to the last row
  const depthMax = Math.max(1, ...depthByAlias.values());
  for (const docPage of docPageList) {
    if (!depthByAlias.has(docPage.alias)) depthByAlias.set(docPage.alias, depthMax + 1);
  }

  const aliasListByDepth = new Map();
  for (const docPage of docPageList) {
    const depth = depthByAlias.get(docPage.alias);
    const list = aliasListByDepth.get(depth) ?? [];
    list.push(docPage.alias);
    aliasListByDepth.set(depth, list);
  }
  const rowWidthMax = Math.max(1, ...[...aliasListByDepth.values()].map((list) => list.length)) * (NODE_WIDTH + NODE_GAP_X) - NODE_GAP_X;

  const nodeList = [{
    id: WORKSPACE_NODE_ID,
    type: 'workspace',
    position: { x: (rowWidthMax - NODE_WIDTH) / 2, y: 0 },
    data: { title: String(workspace?.title ?? ''), isVirtual: workspace?.isVirtual === true, docPageCount: docPageList.length },
  }];
  for (const [depth, aliasList] of aliasListByDepth) {
    const rowWidth = aliasList.length * (NODE_WIDTH + NODE_GAP_X) - NODE_GAP_X;
    aliasList.forEach((alias, index) => {
      const docPage = docPageByAlias.get(alias);
      const mentionList = Array.isArray(docPage.mentionList) ? docPage.mentionList : [];
      nodeList.push({
        id: nodeIdOfDocPage(alias),
        type: 'docPage',
        position: { x: (rowWidthMax - rowWidth) / 2 + index * (NODE_WIDTH + NODE_GAP_X), y: WORKSPACE_NODE_HEIGHT + depth * ROW_GAP_Y },
        data: {
          docPage,
          isRoot: docPage.isRoot === true,
          mentionCount: mentionList.length,
          aliasConflictCount: mentionList.filter((mention) => mention.alias !== docPage.alias).length,
        },
      });
    });
  }

  const edgeList = includeList.map((include, index) => {
    const docPage = docPageByAlias.get(include.toAlias);
    const isConflict = Boolean(docPage) && include.alias !== docPage.alias;
    return {
      id: `include-${index}`,
      source: include.fromAlias === '' ? WORKSPACE_NODE_ID : nodeIdOfDocPage(include.fromAlias),
      target: nodeIdOfDocPage(include.toAlias),
      type: 'smoothstep',
      label: include.fromAlias === '' ? (include.isAliasGiven ? include.alias : `${include.alias} (folder name)`) : `as ${include.alias}`,
      animated: false,
      className: isConflict ? 'is-conflict' : '',
      data: { ...include, isConflict },
    };
  });

  return { nodeList, edgeList, warningList, docPageCount: docPageList.length, mentionCount: includeList.length };
}

export function nodeIdOfDocPage(alias) {
  return `doc-page:${alias}`;
}
