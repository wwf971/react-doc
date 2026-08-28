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

  return {
    treePage,
    itemById: context.itemById,
    itemByRoute: context.itemByRoute,
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
      return [registerMissingDocItem(node, position, context)];
    }
    return [registerDocItem(node, entries, position, context)];
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
  return {
    $id: id,
    type: 'page',
    name: displayName(node, item.text, context, {
      kind: 'file',
      fileExt: entry.ext,
      fileName: entry.name,
      filePath: entry.internalPath,
      isTextCustom: node.text !== undefined,
    }),
    url: route,
  };
}

function registerMissingDocItem(node, position, context) {
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
  return {
    $id: id,
    type: 'page',
    name: displayName(node, item.text, context, {
      kind: 'file',
      fileExt,
      fileName,
      filePath: sourceReference,
      isMissing: true,
      isTextCustom: node.text !== undefined,
    }),
    url: route,
  };
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
      const itemFirst = item?.type === 'doc' ? item : undefined;
      if (itemFirst) itemFirstDocByNodeId.set(node.$id, itemFirst);
      return itemFirst;
    }
    if (!Array.isArray(node.children)) return undefined;
    let itemFirst;
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
