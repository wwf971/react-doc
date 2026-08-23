// builds the fumadocs PageTree for the sidebar.
//
// preferred: custom tree from side panel yaml (config.sidePanel.tree), whose
// structure is free and need not mirror the file tree. nodes:
//   - doc: /rootId/xx/a.md   (page; text overrides the doc title)
//   - text + children        (folder)
//   - separator: Some Text
//
// fallback: auto tree following the scanned multi-root file structure.

export function buildPageTree(configDoc, fileManifest) {
  const entryByPath = new Map(fileManifest.map((e) => [e.internalPath, e]));
  const treeConfig = configDoc.sidePanel?.tree;

  const children = Array.isArray(treeConfig)
    ? treeConfig.map((node) => convertNode(node, entryByPath)).filter(Boolean)
    : autoChildren(fileManifest);

  return { $id: 'root', name: configDoc.siteTitle ?? 'Docs', children };
}

function convertNode(node, entryByPath) {
  if (node.separator !== undefined) {
    return { $id: `sep-${node.separator}`, type: 'separator', name: node.separator };
  }
  if (node.doc !== undefined) {
    const entry = entryByPath.get(node.doc);
    if (!entry) {
      console.warn(`[page-tree] side panel doc not in source: ${node.doc}`);
      return null;
    }
    return pageNode(entry, node.text);
  }
  if (node.children !== undefined) {
    return {
      $id: `folder-${node.text}`,
      type: 'folder',
      name: node.text ?? '',
      defaultOpen: node.defaultOpen ?? true,
      children: node.children.map((child) => convertNode(child, entryByPath)).filter(Boolean),
    };
  }
  console.warn('[page-tree] unknown side panel node', node);
  return null;
}

// auto tree: one folder per root (or a page, when root is a single file),
// nested folders following relative paths
function autoChildren(fileManifest) {
  const byRootId = new Map();
  for (const entry of fileManifest) {
    const list = byRootId.get(entry.rootId) ?? [];
    list.push(entry);
    byRootId.set(entry.rootId, list);
  }

  const result = [];
  for (const [rootId, entries] of byRootId) {
    if (entries.length === 1 && !entries[0].relPath.includes('/')) {
      result.push(pageNode(entries[0]));
      continue;
    }
    result.push({
      $id: `root-${rootId}`,
      type: 'folder',
      name: rootId,
      defaultOpen: true,
      children: folderChildren(entries),
    });
  }
  return result;
}

function folderChildren(entries) {
  const pagesDirect = [];
  const entriesBySubDir = new Map();
  for (const entry of entries) {
    const indexSlash = entry.relPath.indexOf('/');
    if (indexSlash < 0) {
      pagesDirect.push(pageNode(entry));
    } else {
      const subDir = entry.relPath.slice(0, indexSlash);
      const list = entriesBySubDir.get(subDir) ?? [];
      list.push({ ...entry, relPath: entry.relPath.slice(indexSlash + 1) });
      entriesBySubDir.set(subDir, list);
    }
  }

  const foldersSub = [...entriesBySubDir.entries()].map(([subDir, entriesSub]) => ({
    $id: `dir-${subDir}-${entriesSub[0].internalPath}`,
    type: 'folder',
    name: subDir,
    defaultOpen: true,
    children: folderChildren(entriesSub),
  }));
  return [...pagesDirect, ...foldersSub];
}

function pageNode(entry, textOverride) {
  return {
    $id: entry.internalPath,
    type: 'page',
    name: textOverride ?? entry.title,
    url: entry.internalPath,
  };
}
