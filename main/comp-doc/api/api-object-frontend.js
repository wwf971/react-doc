import { Boxes, Plus, Trash2 } from '../../frontend/UICommon.js';
import { apiDefine } from '../../frontend/src/lib/doc-api.js';

// The apis of the frontend object service layer (doc_page_impl_obj_frontend.md),
// as the unified api registry lists them: what the doc pages declare and
// hold, an object as its entry says, creating and deleting one, an asset
// added to one. for the palette and for callers outside the page (an agent
// building a small system of objects); every one runs through
// DocObjectFrontendStore. switching what a block shows is a change of the
// block: doc/blockDataSet with { object, mode, param }.
export const apiByIdObjectFrontend = {
  'objectFrontend/list': apiDefine({
    label: 'List the frontend objects',
    description: 'The frontend objects of every doc page, their types with their modes (inherited ones included), and the problems of the files.',
    icon: Boxes,
    palette: false,
    paramList: [],
    run: async ({ stores }) => {
      const store = stores.objectFrontendStore;
      await store.configLoad();
      return {
        code: 0,
        message: '',
        data: {
          objectList: store.itemList.map((item) => {
            const state = store.objectGet(item.id);
            return { ref: state.ref, name: state.name, typeId: state.typeId, docPageAlias: item.docPageAlias, status: state.status, assetCount: state.assetList.length };
          }),
          typeList: store.typeOfferList.map((type) => ({
            id: type.id, label: type.label, docPageAlias: type.docPageAlias,
            modeList: store.modeListGet(type.id).map(({ id, label, category, comp, typeId, isDefault }) => ({ id, label, category, comp, typeId, isDefault })),
          })),
          problemList: store.problemList,
        },
      };
    },
  }),
  'objectFrontend/get': apiDefine({
    label: 'A frontend object',
    description: 'One frontend object as its entry says: name, type, description, metadata, its assets (key, kind, object, state), and what does not agree.',
    icon: Boxes,
    palette: false,
    paramList: [{ name: 'object', type: 'string', isRequired: true, description: 'frontend:{id}, or the id' }],
    run: async ({ stores }, { object }) => {
      const store = stores.objectFrontendStore;
      await store.configLoad();
      const item = store.itemGet(String(object).replace(/^frontend:/, ''));
      if (item) await stores.assetStore.refLoad({ store: 'local', objectId: item.entry, versionId: 'head' });
      const state = store.objectGet(String(object));
      if (state.status !== 'found') return { code: -1, message: state.message || `${object} is not loaded` };
      return {
        code: 0,
        message: '',
        data: {
          ref: state.ref, name: state.name, typeId: state.typeId, description: state.description, metadata: state.metadata, docPageAlias: state.docPageAlias,
          assetList: state.assetList.map(({ key, kind, objectId, status, isOwnerMatch }) => ({ key, kind, objectId, status, isOwnerMatch })),
          strayList: state.strayList.map((asset) => asset.objectId),
          problemList: state.problemList,
        },
      };
    },
  }),
  'objectFrontend/create': apiDefine({
    label: 'Create a frontend object',
    description: 'A new frontend object of a type, in a doc page: its entry asset in the group folder {id}--{name} of the doc page\'s asset folder, and its line in the doc page\'s object-frontend.yaml.',
    icon: Plus,
    paramList: [
      { name: 'typeId', type: 'string', isRequired: true, description: 'frontend.object, or a type a doc page declares' },
      { name: 'name', type: 'string', isRequired: true, description: 'its name (the folder of its assets is named after it)' },
      { name: 'docPageAlias', type: 'string', description: 'the doc page; the first that can hold one when absent' },
      { name: 'description', type: 'string' },
    ],
    isAvailable: ({ stores }) => stores.objectFrontendStore.writeUnavailableReason || true,
    run: async ({ stores }, { typeId, name, docPageAlias, description }) => {
      const store = stores.objectFrontendStore;
      const alias = docPageAlias || store.settingsCreateDocPageAlias;
      const result = await store.create({ docPageAlias: alias, typeId, name, description });
      return result.code === 0 ? { code: 0, message: '', data: { ref: `frontend:${result.data.id}` } } : result;
    },
  }),
  'objectFrontend/assetCreate': apiDefine({
    label: 'Add an asset to a frontend object',
    description: 'A new asset of the object, in its group folder, declaring it, listed in its entry under a key unique in the object.',
    icon: Plus,
    palette: false,
    paramList: [
      { name: 'object', type: 'string', isRequired: true, description: 'frontend:{id}, or the id' },
      { name: 'text', type: 'string', isRequired: true, description: 'the data of the asset' },
      { name: 'kind', type: 'string', description: 'what it is among the object\'s assets (book, note, ...)' },
      { name: 'key', type: 'string', description: 'its key; {kind}-{n} when absent' },
      { name: 'lang', type: 'string', description: 'yaml when absent' },
    ],
    isAvailable: ({ stores }) => stores.objectFrontendStore.writeUnavailableReason || true,
    run: async ({ stores }, { object, text, kind, key, lang }) => stores.objectFrontendStore.assetCreate(String(object).replace(/^frontend:/, ''), { text, kind, key, lang }),
  }),
  'objectFrontend/delete': apiDefine({
    label: 'Delete a frontend object',
    description: 'Its line leaves the doc page\'s file, then its assets are deleted softly (isAssetKept: kept, declaring it: an orphan entry).',
    icon: Trash2,
    palette: false,
    paramList: [
      { name: 'object', type: 'string', isRequired: true, description: 'frontend:{id}, or the id' },
      { name: 'isAssetKept', type: 'boolean' },
    ],
    isAvailable: ({ stores }) => stores.objectFrontendStore.writeUnavailableReason || true,
    run: async ({ stores }, { object, isAssetKept }) => stores.objectFrontendStore.delete(String(object).replace(/^frontend:/, ''), isAssetKept === true),
  }),
};
