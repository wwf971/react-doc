import { ListIcon, RotateCw, Trash2 } from '../../frontend/UICommon.js';
import { apiDefine } from '../../frontend/src/lib/doc-api.js';

// The apis of the playground documents (doc_page_impl_test.md): what the side panel and
// the document's bar do, for the palette and for agents. Named by id ({doc page}/{name});
// without one, the playground of the current document, or the only one there is.

const idParam = { name: 'id', type: 'string', description: 'the playground, as playground/listGet names it; the one of the current document, or the only one, when absent' };

function playgroundLocate(context, id) {
  const { sourceStore } = context.stores;
  const list = sourceStore.playgroundList;
  if (id) return list.find((item) => item.id === id) ?? { message: `no playground has the id "${id}"` };
  const current = sourceStore.playgroundOfReference(context.doc?.path ?? '');
  if (current) return current;
  return list.length === 1 ? list[0] : { message: list.length ? 'several playgrounds exist: name one (id)' : 'this page has no playground' };
}

const isWritable = ({ stores }) => stores.sourceStore.isWritable || 'a playground is changed through the development server only';

export const apiByIdPlayground = {
  'playground/listGet': apiDefine({
    label: 'List the playgrounds',
    description: 'The playground documents of the doc pages, and whether each exists in this checkout.',
    icon: ListIcon,
    palette: false,
    run: ({ stores }) => stores.sourceStore.playgroundList.map((item) => ({
      id: item.id, title: item.title, description: item.description, doc: item.doc, isPresent: stores.sourceStore.playgroundIsPresent(item),
    })),
  }),
  'playground/reset': apiDefine({
    label: 'Create or reset a playground',
    description: 'Writes the document from its template; what was there is kept as a hidden backup.',
    icon: RotateCw,
    paramList: [idParam],
    isAvailable: isWritable,
    run: async (context, { id }) => {
      const playground = playgroundLocate(context, id);
      if (playground.message) return { code: -1, message: playground.message };
      const result = await context.stores.sourceStore.playgroundChange(playground.id, 'reset');
      return result.code === 0 ? { code: 0, data: { id: playground.id, doc: playground.doc }, message: `${playground.title} is as its template says` } : result;
    },
  }),
  'playground/delete': apiDefine({
    label: 'Delete a playground',
    description: 'As after a fresh clone: the side panel item stays and opens an error page, the document is gone (a hidden backup stays beside it).',
    icon: Trash2,
    paramList: [idParam],
    isAvailable: isWritable,
    run: async (context, { id }) => {
      const playground = playgroundLocate(context, id);
      if (playground.message) return { code: -1, message: playground.message };
      const result = await context.stores.sourceStore.playgroundChange(playground.id, 'delete');
      return result.code === 0 ? { code: 0, data: { id: playground.id }, message: `${playground.title} is gone` } : result;
    },
  }),
};
