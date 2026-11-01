import { Check, Pencil, SquareDashedMousePointer, X } from '../../frontend/UICommon.js';
import { apiDefine } from '../../frontend/src/lib/doc-api.js';
import { blockLocate, docModelEnsure } from './api-doc.js';

// The apis of the edit layer (doc_page_impl_edit.md): the modes of the
// page and the open session, as the toolbar offers them. a block is
// entered through the event layer (editBlockEnterRequest), as a click on
// it is, so the host application sees it like any block operation
// (doc_page_impl_event.md).

const editUnavailable = (context) => context.stores.editStore.isAvailable || context.stores.envStore.reasonGet('edit');

export const apiByIdEdit = {
  'edit/modeToggle': apiDefine({
    label: 'Toggle edit mode',
    description: 'Turns the edit mode of the page on or off (off saves the open block).',
    icon: Pencil,
    palette: { keywordList: ['editing'] },
    isAvailable: editUnavailable,
    run: async ({ stores }) => {
      const isDone = await stores.editStore.editModeToggle();
      return isDone ? { code: 0, data: { isEditMode: stores.editStore.isEditMode }, message: '' } : { code: -1, message: 'the open edit could not be saved' };
    },
  }),
  'edit/modeSet': apiDefine({
    label: 'Set edit mode',
    description: 'Turns the edit mode on or off.',
    icon: Pencil,
    paramList: [{ name: 'isOn', type: 'boolean', isRequired: true }],
    isAvailable: editUnavailable,
    run: async ({ stores }, { isOn }) => {
      const isDone = await stores.editStore.editModeSet(isOn);
      return isDone ? { code: 0, data: { isEditMode: stores.editStore.isEditMode }, message: '' } : { code: -1, message: 'the mode was not changed' };
    },
  }),
  'edit/blockSelectModeToggle': apiDefine({
    label: 'Toggle block selection mode',
    description: 'Selects blocks to copy, move or delete them together (doc_page_impl_block_ops.md).',
    icon: SquareDashedMousePointer,
    isAvailable: editUnavailable,
    run: async ({ stores }) => {
      const isDone = await stores.editStore.blockSelectModeSet(!stores.editStore.isBlockSelectMode);
      return isDone ? { code: 0, data: { isBlockSelectMode: stores.editStore.isBlockSelectMode }, message: '' } : { code: -1, message: 'the mode was not changed' };
    },
  }),
  'edit/sessionLeave': apiDefine({
    label: 'Save the block being edited',
    description: 'Leaves the open edit session, saving its draft.',
    icon: Check,
    isAvailable: ({ stores }) => stores.editStore.isSessionOpen || 'no block is being edited',
    run: async ({ stores }) => {
      const isLeft = await stores.editStore.sessionLeave();
      return isLeft ? undefined : { code: -1, message: stores.editStore.session?.message || 'the draft was not saved' };
    },
  }),
  'edit/sessionCancel': apiDefine({
    label: 'Cancel the block being edited',
    description: 'Leaves the open edit session, dropping its draft.',
    icon: X,
    isAvailable: ({ stores }) => stores.editStore.isSessionOpen || 'no block is being edited',
    run: async ({ stores }) => {
      const isCanceled = await stores.editStore.sessionCancel();
      return isCanceled ? undefined : { code: -1, message: 'the session was not canceled' };
    },
  }),
  'edit/blockEnter': apiDefine({
    label: 'Edit a block',
    description: 'Opens a block of the current document in an edit mode, as a click on it or its Edit button does.',
    icon: Pencil,
    paramList: [
      { name: 'block', type: 'any', description: 'the block: its index, or the id of its component (id=...); the block the author is at when absent' },
      { name: 'editModeId', type: 'string', description: 'an edit mode of the block; its default when absent' },
      { name: 'doc', type: 'sourcePath', pathSpec: { kind: 'file' }, description: 'the document; the current one when absent' },
    ],
    isAvailable: (context) => {
      if (!context.stores.editStore.isAvailable) return context.stores.envStore.reasonGet('edit');
      return context.stores.editStore.isEditMode || 'the page is not in edit mode';
    },
    run: async (context, { block, editModeId, doc }) => {
      const ensured = await docModelEnsure(context, doc);
      if (ensured.message) return { code: -1, message: ensured.message };
      const located = blockLocate(ensured.model, block ?? context.block?.index);
      if (located.message) return { code: -1, message: located.message };
      return context.eventDispatch(
        'editBlockEnterRequest',
        editModeId ? { editModeId } : {},
        { sourcePath: ensured.path, blockIndex: located.index },
      );
    },
  }),
};
