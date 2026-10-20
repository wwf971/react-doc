// Moving a side-panel item, as the page sees it. design:
// doc_page_impl_side_panel.md#moving-an-item
//
// A move is said in terms of the tree the reader sees: the item goes before
// or after another item, or into one, as its first or last child. This
// module turns that into the request of the edit api (the yaml lists the
// item leaves and joins, plugin/doc-side-panel-move.ts), and decides whether
// the move is allowed. The drag in the side panel and the move picker ask
// the same question here, so they always agree.
//
//   position     'before' | 'after'            next to the target, in its list
//                'insideFirst' | 'insideLast'  a child of the target
//
// the place index (sidePanelPlaceIndexBuild) is built with the tree model:
// for every item, its parent, its children, its depth, and what it is in its
// yaml file. the root of the tree is the place with item id ''.
//
// rules, in this order:
//   - an item generated from a source folder has no node to move, and nothing
//     is placed next to it (its list is the folder, not a yaml list)
//   - an item does not go into itself or below itself
//   - only a document item and a folder hold children: a separator, a
//     component panel, an inline page and a source folder do not
//   - an item stays in its part and in its sub document: the part (a node
//     with "part") or sub document (a node including another document's
//     entry) nearest above the item is the item's scope, and the place it
//     goes to must have the same scope. an item outside every part does not
//     go into one either, so a move can always be undone by a move.

export const sidePanelMovePositionList = ['before', 'after', 'insideFirst', 'insideLast'];

// item id -> {
//   itemId, parentId, depth, childIdList,
//   nodeForm        doc | folder | separator | panel | inline | sourceFolder | generated
//   nodeSource      { file, path }: the node in its yaml file (undefined: generated)
//   includeSource   { file, path, isDocEntry, isChildrenLocal }: the included tree
//   scopeId         'part:{itemId}' | 'doc:{itemId}' | '': the part or sub
//                   document the item belongs to
//   scopeIdChildren the scope of its children: its own when it is a part root
//                   or a sub document, else its scopeId
// }
export function sidePanelPlaceIndexBuild(treePage, itemOutlineById) {
  const placeById = new Map();
  const placeRoot = {
    itemId: '',
    parentId: '',
    depth: -1,
    childIdList: [],
    nodeForm: 'folder',
    scopeId: '',
    scopeIdChildren: '',
  };
  placeById.set('', placeRoot);

  const visit = (node, placeParent) => {
    const outline = itemOutlineById.get(node.$id);
    if (!outline) return;
    const scopeIdChildren = scopeIdChildrenGet(node.$id, outline, placeParent.scopeIdChildren);
    const place = {
      itemId: node.$id,
      parentId: placeParent.itemId,
      depth: placeParent.depth + 1,
      childIdList: [],
      nodeForm: outline.nodeForm ?? 'generated',
      nodeSource: outline.nodeSource,
      includeSource: outline.includeSource,
      scopeId: placeParent.scopeIdChildren,
      scopeIdChildren,
    };
    placeById.set(place.itemId, place);
    placeParent.childIdList.push(place.itemId);
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child, place);
    }
  };
  for (const node of treePage.children ?? []) visit(node, placeRoot);
  return placeById;
}

function scopeIdChildrenGet(itemId, outline, scopeIdParent) {
  if (outline.isPartRoot) return `part:${itemId}`;
  if (outline.includeSource?.isDocEntry) return `doc:${itemId}`;
  return scopeIdParent;
}

// the item can be dragged or picked up at all
export function sidePanelItemIsMovable(placeById, itemId) {
  return Boolean(placeById.get(itemId)?.nodeSource);
}

// whether the item may go to the position at the target, and the request of
// the edit api that moves it there:
//   { code: 0, data: { request, isNoop, parentItemId } }
//     request        { item: { file, path }, target: { file, listPath, index } }
//     isNoop         the item would land where it is
//     parentItemId   the item the moved item is a child of afterwards ('' the root)
//   { code: -1, message }   why not, in words for the reader
// textGet(itemId): the label of an item, for the messages
export function sidePanelMoveResolve(placeById, itemId, position, targetItemId, textGet = (id) => id) {
  const item = placeById.get(itemId);
  const target = placeById.get(targetItemId);
  if (!item || !target || target.itemId === '') return resultFail('the item or the place is not in the side panel');
  if (!sidePanelMovePositionList.includes(position)) return resultFail(`unknown position "${position}"`);
  if (!item.nodeSource) return resultFail(`"${textGet(itemId)}" is generated from a source folder; it has no node of its own to move`);

  const isInside = position === 'insideFirst' || position === 'insideLast';
  if (target.itemId === item.itemId) {
    if (isInside) return resultFail('an item cannot be moved into itself');
    return resultNoop(item);
  }
  if (placeIsBelow(placeById, target.itemId, item.itemId)) {
    return resultFail(`"${textGet(targetItemId)}" is below "${textGet(itemId)}"; an item cannot be moved below itself`);
  }

  let targetRequest;
  let parent;
  if (isInside) {
    const reason = childrenRefusedReasonGet(target, textGet);
    if (reason) return resultFail(reason);
    parent = target;
    targetRequest = insideTargetBuild(target, position);
  } else {
    if (!target.nodeSource) {
      return resultFail(`"${textGet(targetItemId)}" is generated from a source folder; nothing can be placed next to it`);
    }
    parent = placeById.get(target.parentId);
    const listPath = target.nodeSource.path.slice(0, -1);
    const index = target.nodeSource.path[target.nodeSource.path.length - 1] + (position === 'after' ? 1 : 0);
    targetRequest = { file: target.nodeSource.file, listPath, index };
  }

  const scopeIdNew = parent.scopeIdChildren;
  if (scopeIdNew !== item.scopeId) return resultFail(scopeReasonGet(item.scopeId, scopeIdNew, textGet));

  const request = {
    item: { file: item.nodeSource.file, path: item.nodeSource.path },
    target: targetRequest,
  };
  return {
    code: 0,
    data: { request, isNoop: requestIsNoop(placeById, item, parent, targetRequest), parentItemId: parent.itemId },
    message: '',
  };
}

// a document item or a folder holds children; the list they go into is the
// node's own "children", or, for a node including a side panel, the
// included tree (first), and its "children" only when it has some (last)
function insideTargetBuild(target, position) {
  const listLocal = { file: target.nodeSource.file, listPath: [...target.nodeSource.path, 'children'] };
  const include = target.includeSource;
  if (position === 'insideFirst') {
    return include ? { file: include.file, listPath: include.path, index: 0 } : { ...listLocal, index: 0 };
  }
  if (include && !include.isChildrenLocal) return { file: include.file, listPath: include.path, index: -1 };
  return { ...listLocal, index: -1 };
}

function childrenRefusedReasonGet(target, textGet) {
  const label = textGet(target.itemId);
  if (target.nodeForm === 'doc' || target.nodeForm === 'folder') return '';
  if (target.nodeForm === 'separator') return 'a separator holds no items';
  if (target.nodeForm === 'panel') return `"${label}" is a component panel; it holds no items`;
  if (target.nodeForm === 'inline') return `"${label}" is an inline page; it holds no items`;
  if (target.nodeForm === 'sourceFolder') return `the items of "${label}" are generated from its source folder`;
  return `"${label}" is generated from a source folder; it holds no items of its own`;
}

function scopeReasonGet(scopeIdItem, scopeIdNew, textGet) {
  const scopeLabelGet = (scopeId) => {
    const [kind, itemId] = [scopeId.slice(0, scopeId.indexOf(':')), scopeId.slice(scopeId.indexOf(':') + 1)];
    return `the ${kind === 'part' ? 'part' : 'sub document'} "${textGet(itemId)}"`;
  };
  if (scopeIdItem) return `the item belongs to ${scopeLabelGet(scopeIdItem)} and stays inside it`;
  return `the place is inside ${scopeLabelGet(scopeIdNew)}; an item from outside it stays outside`;
}

// the item lands where it is: next to itself in its own list, or as the
// last child of its parent when it is the last child already
function requestIsNoop(placeById, item, parent, targetRequest) {
  const listPathItem = item.nodeSource.path.slice(0, -1);
  const indexItem = item.nodeSource.path[item.nodeSource.path.length - 1];
  const isSameList = targetRequest.file === item.nodeSource.file
    && targetRequest.listPath.length === listPathItem.length
    && targetRequest.listPath.every((step, index) => step === listPathItem[index]);
  if (!isSameList) return false;
  if (targetRequest.index === -1) {
    const siblingIdList = placeById.get(parent.itemId)?.childIdList ?? [];
    return siblingIdList[siblingIdList.length - 1] === item.itemId;
  }
  return targetRequest.index === indexItem || targetRequest.index === indexItem + 1;
}

// itemId is below (a descendant of) ancestorId
export function placeIsBelow(placeById, itemId, ancestorId) {
  let place = placeById.get(itemId);
  while (place && place.itemId !== '') {
    if (place.parentId === ancestorId) return true;
    place = placeById.get(place.parentId);
  }
  return false;
}

function resultNoop(item) {
  return {
    code: 0,
    data: {
      request: undefined,
      isNoop: true,
      parentItemId: item.parentId,
    },
    message: '',
  };
}

function resultFail(message) {
  return { code: -1, data: null, message };
}
