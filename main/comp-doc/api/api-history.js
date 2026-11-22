import { History, Trash2, Undo2 } from '../../frontend/UICommon.js';
import { apiDefine } from '../../frontend/src/lib/doc-api.js';
import { docPathResolve } from './api-doc.js';

// The apis of the edit history (doc_page_impl_edit_history.md). An undo or a redo
// is an event of the event layer (historyUndoRequest / historyRedoRequest), as the
// buttons report it, so the host application sees it as it sees any change of a
// document. Without a document, the request goes where the author is: the
// component of the block they are at first (a step of its own), else the document
// of the body they are in (the page, a popup). The keys (mod+z, mod+shift+z) call
// these apis.

const historyUnavailable = (context) => context.stores.editStore.isAvailable || context.stores.envStore.reasonGet('edit');

const docParam = {
  name: 'doc',
  type: 'sourcePath',
  pathSpec: { kind: 'file' },
  description: 'the document; where the author is when absent (the component there first)',
};

// the step of the history the event layer answers
function historyStepRun(direction) {
  return async (context, { doc }) => {
    const path = doc ? docPathResolve(context, doc) : '';
    if (doc && !path) return { code: -1, message: `no document of the source matches ${doc}` };
    const type = direction === 'undo' ? 'historyUndoRequest' : 'historyRedoRequest';
    return context.eventDispatch(type, path ? { path } : { isPlaceUsed: true });
  };
}

export const apiByIdHistory = {
  'history/undo': apiDefine({
    label: 'Undo',
    description: 'Takes back the last change of the document (or of the component) the author is at.',
    icon: Undo2,
    palette: { keywordList: ['undo', 'history', 'revert'] },
    paramList: [docParam],
    isAvailable: historyUnavailable,
    run: historyStepRun('undo'),
  }),
  'history/redo': apiDefine({
    label: 'Redo',
    description: 'Makes again the change taken back last in the document (or the component) the author is at.',
    icon: Undo2,
    palette: { keywordList: ['redo', 'history'] },
    paramList: [docParam],
    isAvailable: historyUnavailable,
    run: historyStepRun('redo'),
  }),
  'history/list': apiDefine({
    label: 'History of a document',
    description: 'The entries of the edit history of a document, oldest first, as the development server keeps them.',
    icon: History,
    palette: false,
    paramList: [{ name: 'doc', type: 'sourcePath', pathSpec: { kind: 'file' }, description: 'the document; the current one when absent' }],
    isAvailable: historyUnavailable,
    run: async (context, { doc }) => {
      const path = docPathResolve(context, doc);
      if (!path) return { code: -1, message: doc ? `no document of the source matches ${doc}` : 'no document is shown' };
      return context.stores.editStore.historyRead(path);
    },
  }),
  'history/clear': apiDefine({
    label: 'Clear the history of a document',
    description: 'Forgets every entry of the edit history of a document: nothing of it can be undone after.',
    icon: Trash2,
    paramList: [{ name: 'doc', type: 'sourcePath', pathSpec: { kind: 'file' }, description: 'the document; the current one when absent' }],
    isAvailable: historyUnavailable,
    run: async (context, { doc }) => {
      const path = docPathResolve(context, doc);
      if (!path) return { code: -1, message: doc ? `no document of the source matches ${doc}` : 'no document is shown' };
      return context.stores.editStore.historyClear(path);
    },
  }),
};
