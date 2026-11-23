import { FolderCog, FolderOutput, ListIcon } from '../../frontend/UICommon.js';
import { apiDefine } from '../../frontend/src/lib/doc-api.js';

// The apis of files moved with their references (doc_page_impl_nav_backlink.md#relocation)
// and of the virtual roots of managed documents (doc_page_impl_doc_managed.md): what the
// move dialog and the Managed documents tab do, for the palette and for agents. A path is a
// source path; a local one is read in the doc page of the current document.

const isWritable = ({ stores }) => stores.sourceStore.isWritable || 'files are moved through the development server only';

const pathParam = (name, description) => ({ name, type: 'string', isRequired: true, description });

export const apiByIdSource = {
  'source/movePlan': apiDefine({
    label: 'Plan the move of a file',
    description: 'What moving or renaming a file would change, nothing written: the references spelled anew in each document, the side panels and entries rebound, what is left as it is and why.',
    icon: FolderOutput,
    palette: false,
    paramList: [pathParam('from', 'the file, a source path'), pathParam('to', 'where it goes: a source path in a folder of files or in a virtual root')],
    isAvailable: isWritable,
    run: ({ stores }, { from, to }) => stores.relocateStore.move(from, to, { isPlanOnly: true }),
  }),
  'source/move': apiDefine({
    label: 'Move or rename a file',
    description: 'Moves a file with every reference to it: a rename, another folder, into a virtual root (the document becomes managed) or out of one. Answers the plan that was written.',
    icon: FolderOutput,
    palette: false,
    paramList: [pathParam('from', 'the file, a source path'), pathParam('to', 'where it goes: a source path in a folder of files or in a virtual root')],
    isAvailable: isWritable,
    run: ({ stores }, { from, to }) => stores.relocateStore.move(from, to),
  }),
  'source/moveDialogOpen': apiDefine({
    label: 'Move the current document…',
    description: 'Opens the move dialog for the document shown: choose its folder (a virtual root makes it managed) and see what changes first.',
    icon: FolderOutput,
    isAvailable: (context) => {
      const writable = isWritable(context);
      if (writable !== true) return writable;
      return context.doc?.path ? true : 'no document is shown';
    },
    run: ({ stores, doc }) => {
      stores.relocateStore.dialogOpen({ from: doc.path, mode: 'move' });
      return { code: 0, message: '' };
    },
  }),
  'source/managedRootList': apiDefine({
    label: 'List the virtual roots',
    description: 'The virtual roots of managed documents of every doc page, with their mode, form and documents.',
    icon: ListIcon,
    palette: false,
    isAvailable: isWritable,
    run: async ({ stores }) => {
      await stores.managedStore.listLoad();
      return stores.managedStore.list.status === 'done'
        ? { code: 0, data: stores.managedStore.list.data, message: '' }
        : { code: -1, message: stores.managedStore.list.message || 'the virtual roots could not be read' };
    },
  }),
  'source/managedRootCreate': apiDefine({
    label: 'Make a virtual root',
    description: 'A new virtual root of managed documents in a doc page: its folder in .doc-page/doc-managed/ and its root.yaml.',
    icon: FolderCog,
    palette: false,
    paramList: [
      { name: 'docPageAlias', type: 'string', isRequired: true, description: 'the doc page' },
      { name: 'alias', type: 'string', isRequired: true, description: 'the root segment of its paths (~alias/…), one word' },
      { name: 'name', type: 'string', description: 'what readers see' },
      { name: 'mode', type: 'string', description: 'text (default) or block: how its new documents are kept' },
      { name: 'storage', type: 'string', description: 'plain (default, what git reads) or pack (one binary file per document)' },
    ],
    isAvailable: isWritable,
    run: async ({ stores }, param) => {
      stores.managedStore.createSet({ docPageAlias: param.docPageAlias, alias: param.alias, name: param.name ?? '', mode: param.mode ?? 'text', storage: param.storage ?? 'plain' });
      return stores.managedStore.rootCreate();
    },
  }),
};
