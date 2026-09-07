// builds the fumadocs PageTree for the sidebar.
//
// preferred: custom tree from side panel yaml (config.sidePanel.tree), whose
// structure is free and need not mirror the file tree. nodes:
//   - doc: /rootId/xx/a.md   (page; text overrides the doc title)
//   - sourceRoot: rootId     (generated tree for one complete source root)
//   - text + children        (folder)
//   - separator: Some Text

import { createElement } from 'react';
import { RegisteredComp } from '../comp-doc/RegisteredComp.jsx';
import { compDefinitionNormalize } from '../comp-doc/comp-registry.js';

// Build both the fumadocs PageTree and the navigation indexes used by DocStore.
// A configured leaf always gets its own route, so multiple sidebar items can
// intentionally point at the same source file without losing item identity.
export function buildPageTreeModel(configDoc, fileManifest, compById = {}) {
  const context = createBuildContext(configDoc, fileManifest, compById);
  const treeConfig = configDoc.sidePanel?.tree;
  const children = Array.isArray(treeConfig)
    ? treeConfig.flatMap((node, index) => convertNode(node, [index], context))
    : autoChildren(fileManifest, context);
  const treePage = { $id: 'root', name: configDoc.siteTitle ?? 'Docs', children };
  const itemFirstDocByNodeId = indexFirstDocItems(treePage, context.itemByRoute);
  const itemAboveById = indexAboveDocItems(treePage, context.itemByRoute);

  return {
    treePage,
    itemById: context.itemById,
    itemByRoute: context.itemByRoute,
    itemAboveById,
    itemFirstDocByNodeId,
    itemIdsByDocPath: context.itemIdsByDocPath,
    items: context.items,
  };
}

// Kept as a small backwards-compatible helper for callers that only need the tree.
export function buildPageTree(configDoc, fileManifest, compById = {}) {
  return buildPageTreeModel(configDoc, fileManifest, compById).treePage;
}

function createBuildContext(configDoc, fileManifest, compById) {
  return {
    compById,
    configDoc,
    entryByPath: new Map(fileManifest.map((entry) => [entry.internalPath, entry])),
    fileManifest,
    itemById: new Map(),
    itemByRoute: new Map(),
    itemIdsByDocPath: new Map(),
    items: [],
    idUsed: new Set(),
  };
}

function convertNode(node, position, context) {
  if (!node || typeof node !== 'object') return [];
  if (node.separator !== undefined) {
    const id = uniqueId(node.id ?? `separator-${position.join('-')}`, context);
    return [{
      $id: id,
      type: 'separator',
      name: displayName(node, node.separator, context, { kind: 'separator' }, false),
    }];
  }
  if (node.doc !== undefined) {
    const entries = resolveDocEntries(String(node.doc), context);
    if (entries.length === 0) {
      console.warn(`[page-tree] side panel doc not in source: ${node.doc}`);
      return [Array.isArray(node.children)
        ? docMissingFolderRegister(node, position, context)
        : registerMissingDocItem(node, position, context)];
    }
    return [Array.isArray(node.children)
      ? docFolderRegister(node, entries, position, context)
      : registerDocItem(node, entries, position, context)];
  }
  if (node.inline !== undefined) {
    return [registerInlineItem(node, position, context)];
  }
  if (node.panel !== undefined) {
    return [registerPanelItem(node, position, context)];
  }
  if (node.sourceRoot !== undefined || node.sourceFolder !== undefined) {
    return convertSourceFolder(node, position, context);
  }
  if (Array.isArray(node.children)) {
    const id = uniqueId(node.id ?? `folder-${position.join('-')}`, context);
    return [{
      $id: id,
      type: 'folder',
      name: displayName(node, node.text ?? '', context, { kind: 'folder' }, false),
      defaultOpen: node.defaultOpen ?? true,
      children: node.children.flatMap((child, index) => convertNode(child, [...position, index], context)),
    }];
  }
  console.warn('[page-tree] unknown side panel node', node);
  return [];
}

function autoChildren(fileManifest, context) {
  const entriesByRootId = new Map();
  for (const entry of fileManifest) {
    const entries = entriesByRootId.get(entry.rootId) ?? [];
    entries.push({ ...entry, relPathTree: entry.relPath });
    entriesByRootId.set(entry.rootId, entries);
  }

  const result = [];
  let indexRoot = 0;
  for (const [rootId, entries] of entriesByRootId) {
    const position = [indexRoot++];
    if (entries.length === 1 && !entries[0].relPathTree.includes('/')) {
      result.push(registerDocItem({}, entries, position, context));
      continue;
    }
    result.push({
      $id: uniqueId(`root-${rootId}`, context),
      type: 'folder',
      name: rootId,
      defaultOpen: true,
      children: folderChildren(entries, position, context),
    });
  }
  return result;
}

function folderChildren(entries, position, context) {
  const entriesDirect = [];
  const entriesBySubDir = new Map();
  for (const entry of entries) {
    const pathTree = entry.relPathTree ?? entry.relPath;
    const indexSlash = pathTree.indexOf('/');
    if (indexSlash < 0) {
      entriesDirect.push(registerDocItem({}, [entry], [...position, entriesDirect.length], context));
    } else {
      const subDir = pathTree.slice(0, indexSlash);
      const list = entriesBySubDir.get(subDir) ?? [];
      list.push({ ...entry, relPathTree: pathTree.slice(indexSlash + 1) });
      entriesBySubDir.set(subDir, list);
    }
  }

  const folders = [...entriesBySubDir.entries()].map(([subDir, entriesSub], index) => ({
    $id: uniqueId(`dir-${position.join('-')}-${index}-${subDir}`, context),
    type: 'folder',
    name: subDir,
    defaultOpen: true,
    children: folderChildren(entriesSub, [...position, entriesDirect.length + index], context),
  }));
  return [...entriesDirect, ...folders];
}

function uniqueId(idRaw, context) {
  const idBase = String(idRaw).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'item';
  let id = idBase;
  let suffix = 2;
  while (context.idUsed.has(id)) id = `${idBase}-${suffix++}`;
  context.idUsed.add(id);
  return id;
}

function displayName(node, textDefault, context, dataItem = {}, isDefaultEnabled = true) {
  const displayDefault = context.configDoc.sidePanel?.itemDisplay;
  const componentName = node.display?.component
    ?? (isDefaultEnabled ? displayDefault?.component : undefined);
  if (!componentName) return node.text ?? textDefault;
  const Component = resolveComponent(componentName, context);
  if (!Component) {
    console.warn(`[page-tree] display component not registered: ${componentName}`);
    return node.text ?? textDefault;
  }
  return createElement(RegisteredComp, {
    compId: Component.compId,
    configRuntime: { instanceId: `side-panel-display:${node.id ?? textDefault}` },
    input: { data: {
      ...(displayDefault?.data ?? {}),
      ...dataItem,
      ...(node.display?.data ?? {}),
      text: node.text ?? textDefault,
    } },
    placement: 'sidePanelDisplay',
  });
}

function convertSourceFolder(node, position, context) {
  const pathFolder = node.sourceFolder !== undefined
    ? normalizeFolderPath(String(node.sourceFolder))
    : `/${node.sourceRoot}`;
  const entries = pathFolder === '/'
    ? context.fileManifest
    : context.fileManifest.filter((entry) => (
      entry.internalPath === pathFolder || entry.internalPath.startsWith(`${pathFolder}/`)
    ));
  if (entries.length === 0) {
    console.warn(`[page-tree] side panel source folder not found: ${pathFolder}`);
    return [];
  }

  const entriesRelative = entries.map((entry) => ({
    ...entry,
    relPathTree: entry.internalPath.slice(pathFolder.length).replace(/^\//, ''),
  }));
  const children = folderChildren(entriesRelative, position, context);
  if (node.text === undefined && node.display === undefined) return children;
  const id = uniqueId(node.id ?? `source-folder-${position.join('-')}`, context);
  return [{
    $id: id,
    type: 'folder',
    name: displayName(
      node,
      node.text ?? pathFolder.split('/').at(-1),
      context,
      { kind: 'folder', sourcePath: pathFolder },
      false,
    ),
    defaultOpen: node.defaultOpen ?? true,
    children,
  }];
}

function registerDocItem(node, entries, position, context) {
  return docPageCreate(node, entries, position, context).page;
}

function docFolderRegister(node, entries, position, context) {
  return docFolderCreate(node, position, context, docPageCreate(
    node,
    entries,
    position,
    context,
    true,
  ));
}

function docFolderCreate(node, position, context, { item, page }) {
  return {
    $id: item.id,
    type: 'folder',
    name: page.name,
    index: page,
    defaultOpen: node.defaultOpen ?? true,
    children: node.children.flatMap((child, index) => (
      convertNode(child, [...position, index], context)
    )),
  };
}

function docPageCreate(node, entries, position, context, isFolderIndex = false) {
  const entry = entries[0];
  const id = uniqueId(node.id ?? `doc-${position.join('-')}`, context);
  const route = itemRoute(id);
  const item = {
    id,
    type: 'doc',
    route,
    docPath: entry.internalPath,
    docCandidates: entries.map((candidate) => ({
      internalPath: candidate.internalPath,
      name: candidate.name,
      title: candidate.title,
    })),
    text: node.text ?? entry.title,
  };
  registerItem(item, context);
  const page = {
    $id: isFolderIndex ? uniqueId(`${id}-index`, context) : id,
    type: 'page',
    name: displayName(node, item.text, context, {
      kind: isFolderIndex ? 'folder-file' : 'file',
      fileExt: entry.ext,
      fileName: entry.name,
      filePath: entry.internalPath,
      isTextCustom: node.text !== undefined,
    }),
    url: route,
  };
  return { item, page };
}

function registerMissingDocItem(node, position, context) {
  return docMissingPageCreate(node, position, context).page;
}

function docMissingFolderRegister(node, position, context) {
  return docFolderCreate(
    node,
    position,
    context,
    docMissingPageCreate(node, position, context, true),
  );
}

function docMissingPageCreate(node, position, context, isFolderIndex = false) {
  const sourceReference = String(node.doc ?? '');
  const fileName = sourceReference.split('/').filter(Boolean).at(-1) ?? sourceReference;
  const fileExt = fileName.includes('.') ? fileName.split('.').at(-1).toLowerCase() : '';
  const id = uniqueId(node.id ?? `missing-doc-${position.join('-')}`, context);
  const route = itemRoute(id);
  const item = {
    id,
    type: 'missing-doc',
    route,
    sourceReference,
    text: node.text ?? fileName ?? sourceReference,
  };
  registerItem(item, context);
  const page = {
    $id: isFolderIndex ? uniqueId(`${id}-index`, context) : id,
    type: 'page',
    name: displayName(node, item.text, context, {
      kind: isFolderIndex ? 'folder-file' : 'file',
      fileExt,
      fileName,
      filePath: sourceReference,
      isMissing: true,
      isTextCustom: node.text !== undefined,
    }),
    url: route,
  };
  return { item, page };
}

function registerPanelItem(node, position, context) {
  const panel = typeof node.panel === 'string' ? { component: node.panel } : node.panel;
  const id = uniqueId(node.id ?? `panel-${position.join('-')}`, context);
  const route = itemRoute(id);
  const item = {
    id,
    type: 'component',
    route,
    panelComponent: panel?.component ?? '',
    panelData: panel?.data ?? {},
    text: node.text ?? panel?.component ?? id,
  };
  registerItem(item, context);
  return {
    $id: id,
    type: 'page',
    name: displayName(node, item.text, context, { kind: 'panel' }),
    url: route,
  };
}

function registerInlineItem(node, position, context) {
  const inline = typeof node.inline === 'string' ? { content: node.inline } : node.inline;
  const id = uniqueId(node.id ?? `inline-${position.join('-')}`, context);
  const route = itemRoute(id);
  const item = {
    id,
    type: 'inline',
    route,
    inlineContent: inline?.content ?? '',
    inlineFormat: inline?.format === 'md' ? 'md' : 'mdx',
    text: node.text ?? inline?.title ?? id,
  };
  registerItem(item, context);
  return {
    $id: id,
    type: 'page',
    name: displayName(node, item.text, context, { kind: 'inline' }),
    url: route,
  };
}

function registerItem(item, context) {
  context.items.push(item);
  context.itemById.set(item.id, item);
  context.itemByRoute.set(item.route, item);
  if (!item.docPath) return;
  const ids = context.itemIdsByDocPath.get(item.docPath) ?? [];
  ids.push(item.id);
  context.itemIdsByDocPath.set(item.docPath, ids);
}

function resolveDocEntries(reference, context) {
  if (reference.startsWith('/')) {
    const entry = context.entryByPath.get(reference);
    return entry ? [entry] : [];
  }
  if (reference.includes('/')) {
    const suffix = `/${reference.replace(/^\.\//, '')}`;
    return context.fileManifest.filter((entry) => entry.internalPath.endsWith(suffix));
  }
  return context.fileManifest.filter((entry) => entry.name === reference);
}

function resolveComponent(componentName, context) {
  const componentId = context.configDoc.compRegistry?.[componentName] ?? componentName;
  const definition = compDefinitionNormalize(context.compById[componentId]);
  return definition ? { compId: componentId, definition } : undefined;
}

function itemRoute(id) {
  return `/__doc-item/${encodeURIComponent(id)}`;
}

function normalizeFolderPath(path) {
  const normalized = `/${path}`.replace(/\\/g, '/').replace(/\/+/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}

function indexFirstDocItems(treePage, itemByRoute) {
  const itemFirstDocByNodeId = new Map();

  const visitNode = (node) => {
    if (node.type === 'page') {
      const item = itemByRoute.get(node.url);
      const itemFirst = item?.type === 'doc' || item?.type === 'missing-doc'
        ? item
        : undefined;
      if (itemFirst) itemFirstDocByNodeId.set(node.$id, itemFirst);
      return itemFirst;
    }
    if (!Array.isArray(node.children)) return undefined;
    let itemFirst = node.index ? visitNode(node.index) : undefined;
    for (const child of node.children) {
      const itemChildFirst = visitNode(child);
      if (!itemFirst && itemChildFirst) itemFirst = itemChildFirst;
    }
    if (itemFirst) itemFirstDocByNodeId.set(node.$id, itemFirst);
    return itemFirst;
  };

  visitNode(treePage);
  return itemFirstDocByNodeId;
}

// For up navigation, a folder's first document follows only its first-item
// chain: the folder index wins, otherwise the first child's first document is
// used. A later sibling is intentionally not considered when that chain is
// empty. Each document then selects the nearest ancestor folder whose first
// document is neither empty nor the same source document.
function indexAboveDocItems(treePage, itemByRoute) {
  const itemFirstDocByFolderId = new Map();
  const itemAboveById = new Map();

  const firstDocGet = (node) => {
    if (node.type === 'page') {
      const item = itemByRoute.get(node.url);
      return item?.type === 'doc' || item?.type === 'missing-doc' ? item : undefined;
    }
    if (node.index) return firstDocGet(node.index);
    if (!Array.isArray(node.children) || node.children.length === 0) return undefined;
    return firstDocGet(node.children[0]);
  };

  const firstDocIndex = (node) => {
    if (!Array.isArray(node.children)) return;
    const itemFirst = firstDocGet(node);
    if (itemFirst) itemFirstDocByFolderId.set(node.$id, itemFirst);
    for (const child of node.children) firstDocIndex(child);
  };

  const aboveIndex = (node, folderIdList) => {
    if (node.type === 'page') {
      const item = itemByRoute.get(node.url);
      if (item?.type !== 'doc' && item?.type !== 'missing-doc') return;
      const itemAbove = folderIdList
        .map((folderId) => itemFirstDocByFolderId.get(folderId))
        .find((candidate) => candidate && !isSameDocItem(candidate, item));
      if (itemAbove) itemAboveById.set(item.id, itemAbove);
      return;
    }
    if (!Array.isArray(node.children)) return;
    const folderIdListNext = [node.$id, ...folderIdList];
    if (node.index) aboveIndex(node.index, folderIdListNext);
    for (const child of node.children) aboveIndex(child, folderIdListNext);
  };

  firstDocIndex(treePage);
  aboveIndex(treePage, []);
  return itemAboveById;
}

function isSameDocItem(itemA, itemB) {
  if (itemA.docPath && itemB.docPath) return itemA.docPath === itemB.docPath;
  if (itemA.sourceReference && itemB.sourceReference) {
    return itemA.sourceReference === itemB.sourceReference;
  }
  return itemA.id === itemB.id;
}
