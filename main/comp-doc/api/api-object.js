import { Box, Network, Plus, Search, SquarePen, Trash2 } from '../../frontend/UICommon.js';
import { apiDefine } from '../../frontend/src/lib/doc-api.js';

// The apis of the object service layer (doc_page_impl_obj.md#the-apis,
// doc_page_impl_obj_search.md), as the unified api registry lists them: the
// standard operations of the semantic model, one set for every kind of
// object, whoever keeps it. every one runs through DocObjectStore, which
// hands it to the provider that owns what it is about (the namespace of a
// reference, the provider that creates a type, the keeper of a relation);
// the provider's own checks decide, and its answer is the api's. a layer
// therefore offers its objects to agents, the palette and the hotkeys by
// implementing the capabilities of its provider, never with apis of its own
// (the frontend objects: create, update, delete, the relations of their
// assets; doc_page_impl_obj_frontend.md#in-the-object-registry).
//
//   types      type/list, type/get          the type registry, and what providers know of a type
//   finding    object/search, object/query, object/resolve
//   content    object/read, object/open
//   writing    object/create, object/update, object/delete
//   relations  relation/query, relation/create, relation/update, relation/delete
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
  'object/query': apiDefine({
    label: 'List objects of some types',
    description: 'A federated query: the objects of these types (and their subtypes) from every provider, matching the text, with how complete the answer is.',
    icon: Box,
    palette: false,
    paramList: [
      { name: 'typeList', type: 'list', isRequired: true, description: 'the types (core.object: everything)' },
      { name: 'text', type: 'string', description: 'words their label or reference must hold' },
      { name: 'filter', type: 'any', description: 'what the providers filter by themselves (their queryFilterList)' },
      { name: 'limit', type: 'number', description: 'the most objects answered (100)' },
    ],
    run: async ({ stores }, params) => {
      const result = await stores.objectStore.query(params, { isFresh: true });
      return { code: 0, message: '', data: { ...result, objectList: result.objectList.map(descriptorShortGet) } };
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
  'object/create': apiDefine({
    label: 'Create an object',
    description: 'A new object of a type, made by the provider that creates objects of it (a frontend object: content { name, description, metadata }, place { docPageAlias }; an asset: content { text | data, lang, name }); or, with memberOf, a new member of a collection made by the collection\'s provider (an asset of a frontend object: memberOf { ref, key?, data: { kind } }).',
    icon: Plus,
    palette: false,
    paramList: [
      { name: 'typeId', type: 'string', description: 'its type (type/list: creatorList says who makes it)' },
      { name: 'content', type: 'any', description: 'what it holds, in the words of its type' },
      { name: 'place', type: 'any', description: 'where its provider keeps it, when it may choose: { docPageAlias } | { docPath } | { folder }' },
      { name: 'memberOf', type: 'any', description: 'the collection it is created in: a reference, or { ref, key?, data? }' },
      { name: 'label', type: 'string', description: 'a shorthand of content.name' },
    ],
    run: ({ stores }, params) => stores.objectStore.create(params),
  }),
  'object/update': apiDefine({
    label: 'Change an object',
    description: 'A change of an object, checked and made by its provider; the patch is in the words of its type (a frontend object: { name, description, typeId, metadata }; an asset: { text | data }; a task: { isDone }; a config: { valueByKey }).',
    icon: SquarePen,
    palette: false,
    paramList: [
      { name: 'ref', type: 'string', isRequired: true, description: 'the reference' },
      { name: 'patch', type: 'any', isRequired: true, description: 'the change' },
    ],
    run: ({ stores }, { ref, patch }) => stores.objectStore.update(String(ref), patch),
  }),
  'object/delete': apiDefine({
    label: 'Delete an object',
    description: 'An object removed by its provider (a frontend object with its assets, or { isMemberKept: true } keeping them; an asset gets its deletion mark).',
    icon: Trash2,
    palette: false,
    paramList: [
      { name: 'ref', type: 'string', isRequired: true, description: 'the reference' },
      { name: 'options', type: 'any', description: 'what its provider takes ({ isMemberKept })' },
    ],
    run: ({ stores }, { ref, options }) => stores.objectStore.delete(String(ref), options ?? {}),
  }),
  'relation/query': apiDefine({
    label: 'Relations of an object',
    description: 'The relations from or to an object (its members, its containment, its links), from every provider of the relation types, with how complete the answer is.',
    icon: Network,
    palette: false,
    paramList: [
      { name: 'fromRef', type: 'string', description: 'from this object' },
      { name: 'toRef', type: 'string', description: 'to this object' },
      { name: 'typeList', type: 'list', description: 'the relation types (core.relation: all)' },
      { name: 'text', type: 'string', description: 'words the relations must match (key, label, data); a provider may search them its own way (the assets of a frontend object: kind:, name:, path:, …)' },
    ],
    run: async ({ stores }, params) => ({ code: 0, message: '', data: await stores.objectStore.relationQuery(params, { isFresh: true }) }),
  }),
  'relation/update': apiDefine({
    label: 'Change a relation',
    description: 'The data of a relation entry, changed by the provider that keeps it: how an asset of a frontend object is named and indexed (data { kind?, name?, pathList? }, paths replaced whole).',
    icon: Network,
    palette: false,
    paramList: [
      { name: 'fromRef', type: 'string', isRequired: true, description: 'the object it is from' },
      { name: 'key', type: 'string', description: 'its key (as relation/query answers it)' },
      { name: 'toRef', type: 'string', description: 'or the object it is to' },
      { name: 'type', type: 'string', description: 'the relation type (core.member when absent)' },
      { name: 'data', type: 'any', isRequired: true, description: 'the change of its data' },
    ],
    run: ({ stores }, params) => stores.objectStore.relationUpdate(params),
  }),
  'relation/create': apiDefine({
    label: 'Add a relation',
    description: 'A relation from an object, written by the provider that keeps it (the provider of fromRef): an object of the store attached to a collection (core.member, with its key and data).',
    icon: Network,
    palette: false,
    paramList: [
      { name: 'fromRef', type: 'string', isRequired: true, description: 'the object it is from (a collection)' },
      { name: 'toRef', type: 'string', isRequired: true, description: 'the object it is to' },
      { name: 'type', type: 'string', description: 'the relation type (core.member when absent)' },
      { name: 'key', type: 'string', description: 'its key among the relations from fromRef' },
      { name: 'data', type: 'any', description: 'the data of the entry ({ kind } for an asset of a frontend object)' },
    ],
    run: ({ stores }, params) => stores.objectStore.relationCreate(params),
  }),
  'relation/delete': apiDefine({
    label: 'Remove a relation',
    description: 'A relation from an object removed by the provider that keeps it, named by its key or its target; with isTargetDeleted the object it was to is deleted too.',
    icon: Network,
    palette: false,
    paramList: [
      { name: 'fromRef', type: 'string', isRequired: true, description: 'the object it is from' },
      { name: 'key', type: 'string', description: 'its key (as relation/query answers it)' },
      { name: 'toRef', type: 'string', description: 'or the object it is to' },
      { name: 'type', type: 'string', description: 'the relation type (core.member when absent)' },
      { name: 'isTargetDeleted', type: 'boolean', description: 'delete the object it was to as well' },
    ],
    run: ({ stores }, params) => stores.objectStore.relationDelete(params),
  }),
  'type/list': apiDefine({
    label: 'List the object types',
    description: 'The types of the type registry (built-in, the templates\', the doc pages\' frontend object types), each with its ancestors, who defines it, who creates objects of it, and what its providers add (the modes of a frontend object type).',
    icon: Box,
    palette: false,
    paramList: [{ name: 'typeList', type: 'list', description: 'only these types and their subtypes' }],
    run: ({ stores }, { typeList }) => ({ code: 0, message: '', data: { typeList: stores.objectStore.typeInfoListGet(Array.isArray(typeList) ? typeList.map(String) : []) } }),
  }),
  'type/get': apiDefine({
    label: 'An object type',
    description: 'One type: its definition, ancestors, descendants, who defines and creates it, and what its providers add (the modes of a frontend object type).',
    icon: Box,
    palette: false,
    paramList: [{ name: 'typeId', type: 'string', isRequired: true, description: 'the type id' }],
    run: ({ stores }, { typeId }) => {
      const info = stores.objectStore.typeInfoGet(String(typeId));
      return info ? { code: 0, message: '', data: info } : { code: -3, message: `no one defines the type ${typeId}` };
    },
  }),
  'object/open': apiDefine({
    label: 'Open an object',
    description: 'Goes to where the object is shown by its own layer: its document, the Services tab, the asset panel.',
    icon: Box,
    paramList: [{ name: 'ref', type: 'string', isRequired: true, description: 'the reference' }],
    run: async ({ stores }, { ref }) => ((await stores.objectStore.open(String(ref))) ? undefined : { code: -1, message: `${ref} has no place to open` }),
  }),
};

// a descriptor as a list answers it: what a caller chooses by
function descriptorShortGet(descriptor) {
  return {
    ref: descriptor.ref, label: descriptor.label, typeList: descriptor.typeList, description: descriptor.description,
    summary: descriptor.summary, capabilityList: descriptor.capabilityList, status: descriptor.status,
  };
}
