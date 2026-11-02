// Changing the structure of the side panel, as the page sees it: an item
// inserted next to another one or into it, an item removed, an item bound to
// another document or source folder, or to nothing. design:
// doc_page_impl_side_panel.md#changing-the-structure
//
// Like lib/side-panel-move.js for a move, this module is the one place that
// decides whether a change is allowed and what it writes (the request of
// the edit api, plugin/doc-side-panel-node.ts). The context menu, the
// dialogs and the event handler all ask here, so they never disagree. It
// reads the place index of the move (sidePanelPlaceIndexBuild).
//
// what an item is, for these rules:
//   leaf document     nodeForm doc, kind file: "doc" without "children"
//   document folder   nodeForm doc, kind folder-file: "doc" with "children"
//   virtual folder    nodeForm folder: "text" + "children", or an include
//   source folder     nodeForm sourceFolder: mirrors a source folder; its
//                     items are generated, one per file and folder
//   generated item    nodeForm generated: a file or folder of a source
//                     folder; it has no node, nothing is written for it
//
// rules:
//   insert   next to (before / after) any item that is a node; into
//            (insideLast) a document item or a folder, as for a move
//   remove   an item that holds no items of its own; a source folder goes
//            with its generated items (its files stay)
//   bind     a leaf document changes its document (it is not detached: a
//            leaf without a document is nothing); a non-leaf item is bound
//            to a document, to a source folder (only while it holds no items:
//            the files would replace them), or to nothing (detached); an item
//            including another side panel keeps the binding of that side
//            panel's root

import { insideTargetBuild, sidePanelChildrenRefusedReasonGet } from './side-panel-move.js';
import { sourcePathDocPageAliasGet, sourcePathLocalGet } from './doc-source-path.js';

export const sidePanelInsertPositionList = ['before', 'after', 'insideLast'];

// where a new item goes:
//   { code: 0, data: { file, listPath, index, docPageAlias, parentItemId } }
//     docPageAlias   the doc page of the file holding the list: a document
//                    created for the new item is one of its roots
//   { code: -1, message }
export function sidePanelInsertResolve(placeById, itemId, position, textGet = (id) => id) {
  const item = placeById.get(itemId);
  if (!item || item.itemId === '') return resultFail('the item is not in the side panel');
  if (!sidePanelInsertPositionList.includes(position)) return resultFail(`unknown position "${position}"`);
  if (!item.nodeSource) return resultFail(generatedReasonGet(placeById, item, textGet));
  if (position === 'insideLast') {
    const reason = sidePanelChildrenRefusedReasonGet(item, textGet);
    if (reason) return resultFail(reason);
    const target = insideTargetBuild(item, position);
    const include = item.includeSource;
    const isIntoInclude = Boolean(include) && target.file === include.file;
    const docPageAlias = isIntoInclude && include.isDocEntry && include.docPageAlias ? include.docPageAlias : item.docPageAlias;
    return resultOk({ ...target, docPageAlias, parentItemId: item.itemId });
  }
  const indexItem = item.nodeSource.path[item.nodeSource.path.length - 1];
  return resultOk({
    file: item.nodeSource.file,
    listPath: item.nodeSource.path.slice(0, -1),
    index: indexItem + (position === 'after' ? 1 : 0),
    docPageAlias: item.docPageAlias,
    parentItemId: item.parentId,
  });
}

// whether the item can be removed:
//   { code: 0, data: { file, path, filePath, isSourceFolder, generatedCount } }
//     filePath        the document of a document item ('' otherwise, or when
//                     it is missing): the file the remover may delete with it
//     generatedCount  the items of a source folder that go with it
//   { code: -1, message }
export function sidePanelRemoveResolve(placeById, itemId, textGet = (id) => id) {
  const item = placeById.get(itemId);
  if (!item || item.itemId === '') return resultFail('the item is not in the side panel');
  if (!item.nodeSource) return resultFail(generatedReasonGet(placeById, item, textGet));
  const isSourceFolder = item.nodeForm === 'sourceFolder';
  if (!isSourceFolder && item.childIdList.length > 0) {
    const count = item.childIdList.length;
    return resultFail(`"${textGet(itemId)}" holds ${count} item${count === 1 ? '' : 's'}; move or remove ${count === 1 ? 'it' : 'them'} first`);
  }
  return resultOk({
    file: item.nodeSource.file,
    path: item.nodeSource.path,
    filePath: item.nodeForm === 'doc' && !item.isMissing ? item.bindPath : '',
    isSourceFolder,
    generatedCount: isSourceFolder ? generatedCountGet(placeById, item) : 0,
  });
}

// the binding changes the item offers, each with the reason it is refused
// ('' when allowed):
//   [{ action, reason }]  action: docChange | docBind | folderChange | folderBind | detach
// an item that is no document item nor folder offers none
export function sidePanelBindActionListGet(placeById, itemId, textGet = (id) => id) {
  const item = placeById.get(itemId);
  if (!item || !item.nodeSource) return [];
  if (item.includeSource) return [];
  const reasonChildren = item.childIdList.length > 0
    ? `"${textGet(itemId)}" holds items; a source folder would replace them, so move or remove them first`
    : '';
  if (item.nodeForm === 'doc') {
    if (item.kind !== 'folder-file') return [{ action: 'docChange', reason: '' }];
    return [
      { action: 'docChange', reason: '' },
      { action: 'folderBind', reason: reasonChildren },
      { action: 'detach', reason: '' },
    ];
  }
  if (item.nodeForm === 'folder') {
    return [
      { action: 'docBind', reason: '' },
      { action: 'folderBind', reason: reasonChildren },
    ];
  }
  if (item.nodeForm === 'sourceFolder') {
    return [
      { action: 'folderChange', reason: '' },
      { action: 'docBind', reason: '' },
      { action: 'detach', reason: '' },
    ];
  }
  return [];
}

// the request of a binding change:
//   binding   { kind: 'doc' | 'folder', path } (a full source path) | { kind: 'none' }
//   label     the label the reader sees now, kept as "text" where the node
//             would lose it
//   { code: 0, data: { file, request, isNoop } } | { code: -1, message }
// a path of the node's own doc page is written in the local form (~root/...),
// so the doc page stays valid under any alias a workspace gives it
export function sidePanelBindResolve(placeById, itemId, binding, label = '', textGet = (id) => id) {
  const item = placeById.get(itemId);
  if (!item || !item.nodeSource) return resultFail('the item is not a node of a side panel file');
  const actionList = sidePanelBindActionListGet(placeById, itemId, textGet);
  const actionWanted = bindActionOf(item, binding);
  const action = actionList.find((entry) => entry.action === actionWanted);
  if (!action) return resultFail(`"${textGet(itemId)}" cannot be ${actionLabelGet(actionWanted)}`);
  if (action.reason) return resultFail(action.reason);
  const isNoop = binding.kind !== 'none' && binding.path === item.bindPath
    && ((binding.kind === 'doc' && item.nodeForm === 'doc') || (binding.kind === 'folder' && item.nodeForm === 'sourceFolder'));
  const request = {
    action: 'bind',
    path: item.nodeSource.path,
    binding: binding.kind === 'none' ? { kind: 'none' } : { kind: binding.kind, path: sidePanelPathWrittenGet(binding.path, item.docPageAlias) },
  };
  if (label) request.text = label;
  return resultOk({ file: item.nodeSource.file, request, isNoop });
}

// a source path as a node of the doc page writes it: the local form for a
// path of its own doc page, the full form for another one
export function sidePanelPathWrittenGet(path, docPageAlias) {
  const pathDocPageAlias = sourcePathDocPageAliasGet(path);
  if (!docPageAlias || !pathDocPageAlias || pathDocPageAlias === docPageAlias) return sourcePathLocalGet(path);
  return path;
}

// ---------- helpers ----------

function bindActionOf(item, binding) {
  if (binding.kind === 'none') return 'detach';
  if (binding.kind === 'doc') return item.nodeForm === 'doc' ? 'docChange' : 'docBind';
  return item.nodeForm === 'sourceFolder' ? 'folderChange' : 'folderBind';
}

function actionLabelGet(action) {
  if (action === 'detach') return 'detached from its document or folder';
  if (action === 'docChange' || action === 'docBind') return 'bound to a document';
  return 'bound to a source folder';
}

// why a generated item is not changed, naming the folder it mirrors
function generatedReasonGet(placeById, item, textGet) {
  const folderPath = item.generatedFrom?.folderPath ?? '';
  const folderItemId = item.generatedFrom?.itemId ?? '';
  const where = folderItemId && placeById.has(folderItemId) ? `"${textGet(folderItemId)}"` : (folderPath || 'a source folder');
  return `"${textGet(item.itemId)}" mirrors a file or folder of ${where}; it follows the files and is not edited here`;
}

function generatedCountGet(placeById, item) {
  let count = 0;
  const visit = (place) => {
    for (const childId of place.childIdList) {
      count++;
      visit(placeById.get(childId));
    }
  };
  visit(item);
  return count;
}

function resultOk(data) {
  return { code: 0, data, message: '' };
}

function resultFail(message) {
  return { code: -1, data: null, message };
}
