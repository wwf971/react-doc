// The side panel the page shows, projected so that every doc page of the
// workspace has one effective occurrence (design:
// doc_page_impl_side_panel.md#a-workspace-of-several-doc-pages).
//
// a doc page is one thing however often it is reached (doc-entry.ts): a
// root doc page of the workspace that another doc page includes as well,
// or a doc page included from two places, loads once and every mention is
// kept. its side panel, though, is shown once: the mount of a root doc
// page is effective before anything else, whatever its place in the
// workspace, and for a doc page without a mount the first include reached
// is effective, traversing the roots in their configured order and the
// children in authored order. every later include of the doc page is
// shielded: the node holding it leaves the tree with its whole subtree, its
// local children included (independent local navigation belongs in a
// separate item). the mention records, the source rules, tags, config and
// the edges of the workspace graph are untouched: shielding is a matter of
// the side panel shown, not of what the workspace holds.
//
// an include is a repeated doc-page mount only when it is the entry of
// another doc page (includeSource.isDocEntry) than the one the node is
// written in (includeSource.docPageAlias differs from node.docPageAlias):
// a resource include, and a reference to another side panel of the same
// doc page, stay. the section nodes of a workspace of several doc pages
// (docPageSection) are the mounts themselves, never repeated includes.
//
// the projection clones what it keeps: the cached side panel resources the
// loader built are never mutated.

export const SIDEBAR_ROOT_HIDDEN_KEY = 'isSidebarRootHidden';

// tree: the assembled side panel tree; aliasEffectiveList: the aliases
// effective before the traversal (the root doc pages of the workspace)
export function sidePanelEffectiveGet(tree: any[], aliasEffectiveList: string[]): any[] {
  const aliasEffectiveSet = new Set(aliasEffectiveList);
  return nodeListProject(tree, aliasEffectiveSet);
}

function nodeListProject(nodeList: any[], aliasEffectiveSet: Set<string>): any[] {
  const result: any[] = [];
  for (const node of nodeList) {
    if (!mappingIs(node)) {
      result.push(node);
      continue;
    }
    const aliasIncluded = includeForeignAliasGet(node);
    if (aliasIncluded !== undefined) {
      if (aliasEffectiveSet.has(aliasIncluded)) continue;
      aliasEffectiveSet.add(aliasIncluded);
    }
    result.push(Array.isArray(node.children)
      ? { ...node, children: nodeListProject(node.children, aliasEffectiveSet) }
      : { ...node });
  }
  return result;
}

// the alias of the doc page a node includes, when that is another doc page
// than the one the node is written in; undefined otherwise
function includeForeignAliasGet(node: Record<string, any>): string | undefined {
  if (node.docPageSection) return undefined;
  const includeSource = node.includeSource;
  if (!mappingIs(includeSource) || includeSource.isDocEntry !== true) return undefined;
  const alias = typeof includeSource.docPageAlias === 'string' ? includeSource.docPageAlias : '';
  if (alias === '' || alias === node.docPageAlias) return undefined;
  return alias;
}

// The root row hidden (the workspace mount option isRootVisible: false): a
// side panel whose tree is one wrapper item (a folder-form node with
// children) shows the wrapper's children directly under the section
// heading, without the wrapper's row. the wrapper stays in the tree, marked
// isSidebarRootHidden: its item id, bound document, tags, config, part,
// breadcrumb and edit addresses are as before, only its row is not drawn
// (DocSidebarFolder). nothing else is flattened: several roots, a leaf, an
// empty folder keep their display, so no content is ever hidden.
export function sidePanelRootHiddenApply(tree: any[]): any[] {
  if (tree.length !== 1) return tree;
  const root = tree[0];
  if (!nodeIsWrapper(root)) return tree;
  return [{ ...root, [SIDEBAR_ROOT_HIDDEN_KEY]: true }];
}

// a folder-form node: children of its own (a plain folder, or a document
// with children); a separator, an inline page, a panel or a generated
// source folder is not
function nodeIsWrapper(node: any): boolean {
  if (!mappingIs(node)) return false;
  if (node.separator !== undefined || node.inline !== undefined || node.panel !== undefined) return false;
  if (node.sourceRoot !== undefined || node.sourceFolder !== undefined) return false;
  return Array.isArray(node.children) && node.children.length > 0;
}

function mappingIs(value: any): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
