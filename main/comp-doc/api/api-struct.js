import { ListIndentDecrease, ListIndentIncrease, ListTree, MousePointer2, Move, SquarePen, Trash2 } from '../../frontend/UICommon.js';
import { apiDefine } from '../../frontend/src/lib/doc-api.js';
import { listItemGet, listItemInfoBuild } from '../../frontend/src/lib/doc-edit-list.js';
import { blockLocate, docModelEnsure } from './api-doc.js';

// The apis of structural edit (doc_page_impl_edit_structure.md#the-apis):
// the items of a list block read and changed one by one, a block moved, and
// the selection of edit mode. An edit of an item is the edit its toolbar
// asks for: it is dispatched as the same event (editItemInsertRequest,
// editItemLevelRequest, ...), answered by the same store, written by the
// same hash-checked write and recorded in the same history.
//
// locating an item: "block" as for the block apis (its index, or the block
// the author is at), "item" the path of the item in its list ("1.0.2": the
// index of the item among the items of its parent, at every depth). without
// "item", the item the author is at: the one being edited, else the one
// selected, then with the scope of the selection.

const docParam = { name: 'doc', type: 'sourcePath', pathSpec: { kind: 'file' }, description: 'the document, as a link target; the current one when absent' };
const blockParam = { name: 'block', type: 'any', description: 'the list block: its index; the block the author is at when absent' };
const itemParam = { name: 'item', type: 'string', description: 'the path of the item in its list, e.g. "1.0"; the item being edited or selected when absent' };
const scopeParam = {
  name: 'scope',
  type: 'string',
  valueList: ['item', 'subtree'],
  description: 'the item alone, or with what is under it; the scope of the selection, else "subtree", when absent',
};

const editAvailable = (context) => context.stores.editStore.isAvailable || context.stores.envStore.reasonGet('edit');
const structGet = (context) => context.stores.structStore;

// the item a call names: { path, hash, blockIndex, itemPath, scope, list } or { message }
async function itemLocate(context, { block, item, doc, scope }) {
  const ensured = await docModelEnsure(context, doc);
  if (ensured.message) return { message: ensured.message };
  const isCurrentDoc = ensured.path === context.doc?.path;
  const itemAt = isCurrentDoc ? context.item : undefined;
  const isItemGiven = item !== undefined && item !== '';
  const blockWanted = block ?? (isItemGiven ? context.block?.index : itemAt?.blockIndex ?? context.block?.index);
  const located = blockLocate(ensured.model, blockWanted);
  if (located.message) return { message: located.message };
  const list = located.block.list;
  if (!list) {
    return { message: located.block.kind === 'list'
      ? `the items of block ${located.index} cannot be edited one by one: ${located.block.listMessage ?? 'no item model'}`
      : `block ${located.index} is not a list` };
  }
  const itemPath = isItemGiven ? String(item) : itemAt && itemAt.blockIndex === located.index ? itemAt.path : '';
  if (!itemPath) return { message: 'no item is named, and the author is at none' };
  if (!listItemGet(list, itemPath)) return { message: `no item ${itemPath} in block ${located.index}` };
  return {
    path: ensured.path,
    hash: ensured.hash,
    blockIndex: located.index,
    itemPath,
    scope: scope ?? (!isItemGiven && itemAt ? itemAt.scope : 'subtree'),
    list,
  };
}

// an edit of an item reported as its event, as the toolbar of the item does
async function itemEventDispatch(context, params, type, data = {}) {
  const located = await itemLocate(context, params);
  if (located.message) return { code: -1, message: located.message };
  return context.eventDispatch(type, { scope: located.scope, ...data }, {
    sourcePath: located.path,
    blockIndex: located.blockIndex,
    itemPath: located.itemPath,
  });
}

export const apiByIdStruct = {
  'doc/itemListGet': apiDefine({
    label: 'Items of a list block',
    description: 'Every item of a list block as the edit layer models it: path, depth, lines, own text, number of sub-items.',
    icon: ListTree,
    palette: false,
    paramList: [blockParam, docParam],
    run: async (context, { block, doc }) => {
      const ensured = await docModelEnsure(context, doc);
      if (ensured.message) return { code: -1, message: ensured.message };
      const located = blockLocate(ensured.model, block ?? context.block?.index);
      if (located.message) return { code: -1, message: located.message };
      if (!located.block.list) return { code: -1, message: located.block.listMessage ? `block ${located.index}: ${located.block.listMessage}` : `block ${located.index} is not a list` };
      return {
        path: ensured.path,
        hash: ensured.hash,
        blockIndex: located.index,
        itemList: located.block.list.rowList.map(listItemInfoBuild),
      };
    },
  }),
  'doc/itemGet': apiDefine({
    label: 'An item of a list block',
    description: 'One item with its own text, its place and what is under it.',
    icon: ListTree,
    palette: false,
    paramList: [itemParam, blockParam, docParam],
    run: async (context, params) => {
      const located = await itemLocate(context, params);
      if (located.message) return { code: -1, message: located.message };
      return { path: located.path, hash: located.hash, blockIndex: located.blockIndex, ...listItemInfoBuild(listItemGet(located.list, located.itemPath)) };
    },
  }),
  'doc/itemTextSet': apiDefine({
    label: 'Replace the text of a list item',
    description: 'Rewrites the own text of one item; the item keeps its place and what is under it. The text is indented into the item by the page.',
    icon: SquarePen,
    palette: false,
    paramList: [{ name: 'text', type: 'string', isRequired: true, description: 'the new own text of the item, without marker and indentation' }, itemParam, blockParam, docParam],
    isAvailable: editAvailable,
    run: async (context, params) => {
      const located = await itemLocate(context, params);
      if (located.message) return { code: -1, message: located.message };
      return structGet(context).itemTextSet({ path: located.path, blockIndex: located.blockIndex, itemPath: located.itemPath }, params.text);
    },
  }),
  'doc/itemInsert': apiDefine({
    label: 'Insert a list item',
    description: 'A new item beside an item (before, or after it and what is under it) or as its last sub-item: with a text, written with it; without, created empty and opened for the author to type (editItemInsertRequest).',
    icon: SquarePen,
    palette: false,
    paramList: [
      { name: 'text', type: 'string', description: 'the own text of the new item; without it the item is created empty and opened' },
      { name: 'position', type: 'string', valueList: ['before', 'after', 'child'], valueDefault: 'after', description: 'where, relative to the item' },
      itemParam, blockParam, docParam,
    ],
    isAvailable: editAvailable,
    run: (context, params) => itemEventDispatch(context, params, 'editItemInsertRequest', { position: params.position, text: params.text }),
  }),
  'doc/itemDelete': apiDefine({
    label: 'Delete a list item',
    description: 'Removes an item with what is under it, or alone (scope item: its sub-items take its place) (editItemDeleteRequest).',
    icon: Trash2,
    palette: false,
    paramList: [scopeParam, itemParam, blockParam, docParam],
    isAvailable: editAvailable,
    run: (context, params) => itemEventDispatch(context, params, 'editItemDeleteRequest'),
  }),
  'doc/itemIndent': apiDefine({
    label: 'List item one level deeper',
    description: 'The item becomes the last sub-item of the item before it, with what is under it or alone (scope item: its sub-items keep their level) (editItemLevelRequest).',
    icon: ListIndentIncrease,
    paramList: [scopeParam, itemParam, blockParam, docParam],
    isAvailable: editAvailable,
    run: (context, params) => itemEventDispatch(context, params, 'editItemLevelRequest', { direction: 'in' }),
  }),
  'doc/itemOutdent': apiDefine({
    label: 'List item one level up',
    description: 'The item becomes the item after its parent, with what is under it; the items after it in its list come under it (editItemLevelRequest).',
    icon: ListIndentDecrease,
    paramList: [itemParam, blockParam, docParam],
    isAvailable: editAvailable,
    run: (context, params) => itemEventDispatch(context, params, 'editItemLevelRequest', { direction: 'out' }),
  }),
  'doc/itemMove': apiDefine({
    label: 'Move a list item among its siblings',
    description: 'Swaps the item with the item before or after it in its list, with what is under it (editItemMoveRequest).',
    icon: Move,
    palette: false,
    paramList: [{ name: 'direction', type: 'string', isRequired: true, valueList: ['up', 'down'] }, itemParam, blockParam, docParam],
    isAvailable: editAvailable,
    run: (context, params) => itemEventDispatch(context, params, 'editItemMoveRequest', { direction: params.direction }),
  }),
  'doc/itemMoveTo': apiDefine({
    label: 'Move a list item to a place',
    description: 'Moves an item, with what is under it or alone, before or after another item or under it as its first or last sub-item, in its list block or another one of the document.',
    icon: Move,
    palette: false,
    paramList: [
      { name: 'targetItem', type: 'string', isRequired: true, description: 'the path of the item the place is said from' },
      { name: 'position', type: 'string', isRequired: true, valueList: ['before', 'after', 'childFirst', 'childLast'] },
      { name: 'targetBlock', type: 'number', description: 'the list block of that item; the block of the moved item when absent' },
      scopeParam, itemParam, blockParam, docParam,
    ],
    isAvailable: editAvailable,
    run: async (context, params) => {
      const located = await itemLocate(context, params);
      if (located.message) return { code: -1, message: located.message };
      return structGet(context).itemMoveTo(
        { path: located.path, blockIndex: located.blockIndex, itemPath: located.itemPath },
        located.scope === 'item' ? 'item' : 'subtree',
        { blockIndex: params.targetBlock ?? located.blockIndex, itemPath: String(params.targetItem), position: params.position },
      );
    },
  }),
  'doc/itemListTypeSet': apiDefine({
    label: 'Bullets or numbers for the list of an item',
    description: 'Turns the list an item is in into bullets or numbers; its nested lists stay as they are (editItemListTypeRequest).',
    icon: ListTree,
    palette: false,
    paramList: [{ name: 'type', type: 'string', isRequired: true, valueList: ['unordered', 'ordered'] }, itemParam, blockParam, docParam],
    isAvailable: editAvailable,
    run: (context, params) => itemEventDispatch(context, params, 'editItemListTypeRequest', { type: params.type }),
  }),
  'doc/blockMove': apiDefine({
    label: 'Move a block',
    description: 'Moves one block to a border of its document (borderIndex: before block n; the number of blocks: at the end), or swaps it with its neighbor (direction).',
    icon: Move,
    palette: false,
    paramList: [
      { name: 'direction', type: 'string', valueList: ['up', 'down'], description: 'swap with the block above / below' },
      { name: 'borderIndex', type: 'number', description: 'the border the block goes to' },
      { name: 'block', type: 'any', description: 'the block: its index, or the id of its component; the block the author is at when absent' },
      docParam,
    ],
    isAvailable: editAvailable,
    run: async (context, { direction, borderIndex, block, doc }) => {
      const ensured = await docModelEnsure(context, doc);
      if (ensured.message) return { code: -1, message: ensured.message };
      const located = blockLocate(ensured.model, block ?? context.block?.index);
      if (located.message) return { code: -1, message: located.message };
      if (borderIndex !== undefined) return structGet(context).blockMoveTo(ensured.path, located.index, borderIndex);
      if (direction !== 'up' && direction !== 'down') return { code: -1, message: 'name a direction (up, down) or a borderIndex' };
      return context.eventDispatch('editBlockMoveRequest', { direction }, { sourcePath: ensured.path, blockIndex: located.index });
    },
  }),
  'edit/itemEnter': apiDefine({
    label: 'Edit a list item',
    description: 'Opens the own text of a list item for editing, as a click on it does (editItemEnterRequest).',
    icon: SquarePen,
    palette: false,
    paramList: [itemParam, blockParam, docParam],
    isAvailable: (context) => {
      if (!context.stores.editStore.isAvailable) return context.stores.envStore.reasonGet('edit');
      return context.stores.editStore.isEditMode || 'the page is not in edit mode';
    },
    run: (context, params) => itemEventDispatch(context, params, 'editItemEnterRequest'),
  }),
  'edit/selectionGet': apiDefine({
    label: 'Selection',
    description: 'What is selected for a structural edit in the current document: a block, or a list item alone or with what is under it.',
    icon: MousePointer2,
    palette: false,
    run: (context) => context.selection.struct ?? null,
  }),
  'edit/select': apiDefine({
    label: 'Select a block or a list item',
    description: 'Selects a block, or an item of a list block alone (scope item) or with what is under it (scope subtree), as Shift + click does.',
    icon: MousePointer2,
    palette: false,
    paramList: [
      { name: 'block', type: 'any', description: 'the block: its index, or the id of its component; the block the author is at when absent' },
      { name: 'item', type: 'string', description: 'the path of an item of the list block; the block itself when absent' },
      { name: 'scope', type: 'string', valueList: ['item', 'subtree'], valueDefault: 'item' },
    ],
    isAvailable: (context) => context.stores.editStore.isEditMode || 'the page is not in edit mode',
    run: async (context, { block, item, scope }) => {
      if (!context.doc) return { code: -1, message: 'no document is shown' };
      const ensured = await docModelEnsure(context, undefined);
      if (ensured.message) return { code: -1, message: ensured.message };
      const located = blockLocate(ensured.model, block ?? context.block?.index);
      if (located.message) return { code: -1, message: located.message };
      const isSet = await structGet(context).selectionSet(ensured.path, located.index, item ? String(item) : '', item ? scope : 'block');
      return isSet ? { code: 0, data: structGet(context).selection, message: '' } : { code: -1, message: 'it was not selected' };
    },
  }),
  'edit/selectGrow': apiDefine({
    label: 'Select one step more',
    description: 'The selected item with what is under it, then the item above, up to the whole list block, then the item again (Shift + click on the selection).',
    icon: MousePointer2,
    isAvailable: (context) => structGet(context)?.isSelected || 'nothing is selected',
    run: (context) => (structGet(context).selectionGrowStep() ? { code: 0, data: structGet(context).selection, message: '' } : { code: -1, message: 'nothing is selected' }),
  }),
  'edit/selectClear': apiDefine({
    label: 'End the selection',
    description: 'Closes what is open on the selection (a menu, a confirmation), else ends the selection.',
    icon: MousePointer2,
    isAvailable: (context) => structGet(context)?.isSelected || 'nothing is selected',
    run: (context) => { structGet(context).selectionEscape(); },
  }),
  'edit/selectionMove': apiDefine({
    label: 'Move the selection up or down',
    description: 'A selected block swaps with its neighbor, a selected item with the item before or after it in its list; the selection stays on it.',
    icon: Move,
    paramList: [{ name: 'direction', type: 'string', isRequired: true, valueList: ['up', 'down'] }],
    isAvailable: (context) => structGet(context)?.isSelected || 'nothing is selected',
    run: (context, { direction }) => structGet(context).selectionMove(direction),
  }),
  'edit/selectionEnter': apiDefine({
    label: 'Edit the selection',
    description: 'Opens the content of the selected block or list item for editing; the selection ends.',
    icon: SquarePen,
    isAvailable: (context) => structGet(context)?.isSelected || 'nothing is selected',
    run: (context) => structGet(context).selectionEnter(),
  }),
  'edit/selectionDeleteAsk': apiDefine({
    label: 'Delete the selection…',
    description: 'Asks, in the toolbar of the selected block or list item, whether it is deleted.',
    icon: Trash2,
    isAvailable: (context) => structGet(context)?.isSelected || 'nothing is selected',
    run: (context) => structGet(context).selectionDeleteAsk(),
  }),
};
