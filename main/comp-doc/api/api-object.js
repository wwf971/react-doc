import { Box, Search } from '../../frontend/UICommon.js';
import { apiDefine } from '../../frontend/src/lib/doc-api.js';

// The apis of the object service layer (doc_page_impl_obj.md,
// doc_page_impl_obj_search.md), as the unified api registry lists them: a
// search, a resolve, the content of an object, opening it. for the
// palette, the hotkeys, and callers outside the page (an agent finds an
// object by its name, then reads it). every one runs through DocObjectStore.
export const apiByIdObject = {
  'object/search': apiDefine({
    label: 'Search objects',
    description: 'Objects of the page and of the services by words in any order: a name, a host (service, doc page), an id, a type; type:…, in:…, id:…, ns:… narrow a word. Hosts with too many objects are counted, not listed.',
    icon: Search,
    paramList: [
      { name: 'text', type: 'string', isRequired: true, description: 'the words of the search' },
      { name: 'typeList', type: 'list', description: 'only objects of these types (and their subtypes)' },
      { name: 'providerIdList', type: 'list', description: 'only these providers (doc-source, service:{serviceId}, kernel, …)' },
      { name: 'fetchMax', type: 'number', description: 'the most objects asked of one provider (50)' },
      { name: 'providerIdExpandList', type: 'list', description: 'providers to load the first fetchMax of, however many they have' },
    ],
    run: async ({ stores }, params) => {
      const result = await stores.objectStore.searchStore.search(params);
      return {
        code: 0,
        message: '',
        data: {
          objectList: result.objectList.map((hit) => ({ ref: hit.descriptor.ref, label: hit.descriptor.label, typeList: hit.descriptor.typeList, path: hit.path, status: hit.descriptor.status, score: hit.score })),
          providerList: result.providerList,
          isComplete: result.isComplete,
        },
      };
    },
  }),
  'object/resolve': apiDefine({
    label: 'Resolve an object',
    description: 'What the registry knows of an object reference ({namespace}:{local}), asked of its provider: its descriptor and its status.',
    icon: Box,
    paramList: [
      { name: 'ref', type: 'string', isRequired: true, description: 'the reference' },
      { name: 'isVerify', type: 'boolean', description: 'ask the provider again, whatever is cached' },
    ],
    run: async ({ stores }, { ref, isVerify }) => ({ code: 0, message: '', data: await stores.objectStore.resolve(String(ref), { isVerify: isVerify === true }) }),
  }),
  'object/read': apiDefine({
    label: 'Read an object',
    description: 'The content of an object, from its provider.',
    icon: Box,
    paramList: [{ name: 'ref', type: 'string', isRequired: true, description: 'the reference' }],
    run: ({ stores }, { ref }) => stores.objectStore.read(String(ref)),
  }),
  'object/open': apiDefine({
    label: 'Open an object',
    description: 'Goes to where the object is shown by its own layer: its document, the Services tab, the asset panel.',
    icon: Box,
    paramList: [{ name: 'ref', type: 'string', isRequired: true, description: 'the reference' }],
    run: async ({ stores }, { ref }) => ((await stores.objectStore.open(String(ref))) ? undefined : { code: -1, message: `${ref} has no place to open` }),
  }),
};
