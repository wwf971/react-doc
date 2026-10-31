// The workspace as a graph (design: doc_page_impl_source.md#the-workspace-tab):
// what the Workspace tab of the settings panel draws with React Flow.
//
//   workspaceGraphBuild(workspace, packageList, { isDocPageVisible, isPackageVisible })
//     -> { nodeList, edgeList, warningList, docPageCount, mentionCount, packageCount }
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
// packageList is configDoc.packageList (doc_page_impl_package.md): every
// package loaded, { name, description, dir, dependNameList,
// isWorkspaceNamed }. a package is a node; an edge goes from the workspace
// to each package it names, and from a package to each package it needs.
//
// nodes: { id, type: 'workspace' | 'docPage' | 'package', position, data }
//   workspace   data { title, isVirtual, docPageCount, packageCount, side }
//   docPage     data { docPage (DocPageInfo), isRoot, mentionCount, aliasConflictCount }
//   package     data { package, neededByList, side }
// edges: { id, source, target, label, sourceHandle?, targetHandle?, data }
//
// the layout is by depth, one row per level. the doc pages grow below the
// workspace: the root doc pages, then the doc pages reached by includes.
// the packages grow above it, a package one row above every package that
// needs it (the longest chain, so an edge always points up), in another
// tone. with the doc pages hidden, the packages grow below the workspace
// instead; side ('up' | 'down') tells the nodes which handles to draw. the
// page may drag the nodes afterwards (positions are kept by the store).

export const WORKSPACE_NODE_ID = 'workspace';
const NODE_WIDTH = 236;
const NODE_GAP_X = 44;
const ROW_GAP_Y = 150;
const WORKSPACE_NODE_HEIGHT = 54;
const PACKAGE_ROW_OFFSET_Y = 20;

export function workspaceGraphBuild(workspace, packageListInput = [], { isDocPageVisible = true, isPackageVisible = true } = {}) {
  const docPageListAll = Array.isArray(workspace?.docPageList) ? workspace.docPageList : [];
  const docPageList = isDocPageVisible ? docPageListAll : [];
  const packageListAll = Array.isArray(packageListInput) ? packageListInput : [];
  const packageList = isPackageVisible ? packageListAll : [];
  const includeList = isDocPageVisible && Array.isArray(workspace?.includeList) ? workspace.includeList : [];
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
  // the packages: up above the workspace when the doc pages are shown,
  // down below it otherwise
  const packageSide = isDocPageVisible ? 'up' : 'down';
  const packageLevelByName = packageLevelGet(packageList);
  const packageNameListByLevel = new Map();
  for (const item of packageList) {
    const level = packageLevelByName.get(item.name);
    const list = packageNameListByLevel.get(level) ?? [];
    list.push(item.name);
    packageNameListByLevel.set(level, list);
  }
  const rowLengthList = [...aliasListByDepth.values(), ...packageNameListByLevel.values()].map((list) => list.length);
  const rowWidthMax = Math.max(1, ...rowLengthList) * (NODE_WIDTH + NODE_GAP_X) - NODE_GAP_X;

  const nodeList = [{
    id: WORKSPACE_NODE_ID,
    type: 'workspace',
    position: { x: (rowWidthMax - NODE_WIDTH) / 2, y: 0 },
    data: {
      title: String(workspace?.title ?? ''),
      isVirtual: workspace?.isVirtual === true,
      docPageCount: docPageListAll.length,
      packageCount: packageListAll.length,
      isDocPageVisible,
      isPackageVisible,
    },
  }];
  const packageByName = new Map(packageList.map((item) => [item.name, item]));
  for (const [level, nameList] of packageNameListByLevel) {
    const rowWidth = nameList.length * (NODE_WIDTH + NODE_GAP_X) - NODE_GAP_X;
    nameList.forEach((name, index) => {
      const item = packageByName.get(name);
      nodeList.push({
        id: nodeIdOfPackage(name),
        type: 'package',
        position: {
          x: (rowWidthMax - rowWidth) / 2 + index * (NODE_WIDTH + NODE_GAP_X),
          // a package card is about as tall as a doc page card (its
          // description is clamped to two lines); upward rows start a
          // little higher so the lowest one clears the workspace
          y: packageSide === 'up' ? -level * ROW_GAP_Y - PACKAGE_ROW_OFFSET_Y : WORKSPACE_NODE_HEIGHT + level * ROW_GAP_Y,
        },
        data: {
          package: item,
          side: packageSide,
          neededByList: packageList.filter((other) => (other.dependNameList ?? []).includes(name)).map((other) => other.name),
        },
      });
    });
  }
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
      // the workspace has a handle below (doc pages) and one above (packages)
      ...(include.fromAlias === '' ? { sourceHandle: 'down' } : {}),
      type: 'smoothstep',
      label: include.fromAlias === '' ? (include.isAliasGiven ? include.alias : `${include.alias} (folder name)`) : `as ${include.alias}`,
      animated: false,
      className: isConflict ? 'is-conflict' : '',
      data: { ...include, isConflict },
    };
  });

  // workspace -> a package it names, a package -> a package it needs; drawn
  // upward when the packages grow above the workspace
  const handlePair = packageSide === 'up' ? { sourceHandle: 'up', targetHandle: 'up' } : { sourceHandle: 'down', targetHandle: 'down' };
  for (const item of packageList) {
    if (item.isWorkspaceNamed) {
      edgeList.push({
        id: `package-import-${item.name}`, source: WORKSPACE_NODE_ID, target: nodeIdOfPackage(item.name), ...handlePair,
        type: 'smoothstep', label: 'imports', className: 'is-package', data: { kind: 'import' },
      });
    }
    for (const dependName of item.dependNameList ?? []) {
      if (!packageByName.has(dependName)) continue;
      edgeList.push({
        id: `package-depend-${item.name}-${dependName}`, source: nodeIdOfPackage(item.name), target: nodeIdOfPackage(dependName), ...handlePair,
        type: 'smoothstep', label: 'needs', className: 'is-package', data: { kind: 'depend' },
      });
    }
  }

  return {
    nodeList, edgeList, warningList,
    docPageCount: docPageListAll.length, mentionCount: Array.isArray(workspace?.includeList) ? workspace.includeList.length : 0,
    packageCount: packageListAll.length,
  };
}

// the level of a package: 1 for one only the workspace reaches, else one
// more than the deepest package needing it, so a package stands beyond
// everything that needs it (the loader refused cycles)
function packageLevelGet(packageList) {
  const packageByName = new Map(packageList.map((item) => [item.name, item]));
  const levelByName = new Map();
  const levelGet = (name, chain = []) => {
    if (levelByName.has(name)) return levelByName.get(name);
    if (chain.includes(name)) return 1;
    const neededByList = packageList.filter((other) => (other.dependNameList ?? []).includes(name));
    const level = neededByList.length === 0 ? 1 : Math.max(packageByName.get(name)?.isWorkspaceNamed ? 1 : 0, ...neededByList.map((other) => levelGet(other.name, [...chain, name]) + 1));
    levelByName.set(name, level);
    return level;
  };
  for (const item of packageList) levelGet(item.name);
  return levelByName;
}

export function nodeIdOfPackage(name) {
  return `package:${name}`;
}

export function nodeIdOfDocPage(alias) {
  return `doc-page:${alias}`;
}
