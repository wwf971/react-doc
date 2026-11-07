import { stringify as yamlStringify } from 'yaml';
import { objectRefParse } from './doc-object-ref.js';

// The asset service layer as a provider of the object registry (design:
// doc_page_impl_obj.md#the-providers-of-the-page): every item of its
// index is an asset.item, asset:{store}/{itemId}. The asset store keeps
// its own representation (the index, the versions); the registry asks it.
//
// the writes of the registry (doc_page_impl_obj.md#writing-through-the-registry):
//   create { typeId: asset.item, content: { text | data, lang, name? }, place: { folder | docPath } }
//   update asset:{store}/{id} { text | data, note?, mode? }   the head, by the item's save mode unless mode
//   delete asset:{store}/{id}                                 the deletion mark (its files stay)
// an asset of a frontend object is added and taken out through that item
// (create with memberOf, relationDelete), so its entry lists it.

export function objectProviderAssetCreate({ assetStore }) {
  const descriptorBuild = (store, item) => ({
    ref: `asset:${store}/${item.itemId}`,
    typeList: ['asset.item'],
    label: item.name || item.itemId,
    description: `${item.lang || item.contentType || 'data'} · ${item.versionList?.length ?? 0} version(s)${item.isLocked ? ' · locked' : ''}`,
    summary: {
      store,
      lang: item.lang,
      versionCount: item.versionList?.length ?? 0,
      versionIdHead: item.versionIdHead,
      isLocked: item.isLocked === true,
      compName: item.component?.compName ?? '',
    },
    capabilityList: item.isLocked ? ['read'] : ['read', 'update', 'delete'],
    open: { kind: 'asset', store, itemId: item.itemId },
  });

  const entryList = () => Object.entries(assetStore.itemById)
    .filter(([, state]) => state?.item && !state.item.isDeleted)
    .map(([key, state]) => ({ store: key.slice(0, key.indexOf('/')), item: state.item }));

  const statusGet = () => (assetStore.backendKind === 'none'
    ? { status: 'unavailable', message: assetStore.unavailableReason || 'the page has no asset service layer' }
    : { status: 'ready', message: '' });

  // the item of a reference, with its head loaded
  const itemOfRefGet = async (ref) => {
    await assetStore.indexLoad();
    const local = objectRefParse(ref)?.local ?? '';
    const indexSlash = local.indexOf('/');
    const store = local.slice(0, indexSlash);
    const item = indexSlash > 0 ? assetStore.itemGet(store, local.slice(indexSlash + 1)) : undefined;
    if (!item) throw codeError(-3, `${ref} is not an item of the asset store`);
    await assetStore.refLoad({ store, itemId: item.itemId, versionId: 'head' });
    return { store, item: assetStore.itemGet(store, item.itemId) };
  };

  const readBuild = (store, item) => {
    const head = assetStore.versionGet(store, item.itemId, item.versionIdHead);
    return {
      descriptor: descriptorBuild(store, item),
      content: {
        itemId: item.itemId,
        name: item.name,
        lang: item.lang,
        owner: item.owner,
        versionIdHead: item.versionIdHead,
        // the head's data, when it is text (an image is read through its url)
        text: head?.isText ? head.text : undefined,
        versionList: (item.versionList ?? []).map((version) => ({ versionId: version.versionId, time: version.time, note: version.note, size: version.size })),
      },
    };
  };

  return {
    id: 'asset',
    label: 'the asset store',
    registry: 'page',
    namespaceList: ['asset'],
    typeList: ['asset.item'],
    relationTypeList: [],
    capabilityList: ['query', 'resolve', 'read', 'create', 'update', 'delete'],
    createTypeList: ['asset.item'],
    versionGet: () => assetStore.itemById,
    cacheSecond: 300,
    statusGet,

    // an item of the store opens in the asset panel
    open: (descriptor) => {
      const open = descriptor.open;
      if (open?.kind !== 'asset' || !assetStore.panelOpen) return false;
      assetStore.panelOpen(open.store, open.itemId);
      return true;
    },

    query: async () => {
      await assetStore.indexLoad();
      return entryList().map(({ store, item }) => descriptorBuild(store, item));
    },

    resolve: async (refList) => {
      await assetStore.indexLoad();
      return refList.map((ref) => {
        const local = objectRefParse(ref)?.local ?? '';
        const indexSlash = local.indexOf('/');
        const store = local.slice(0, indexSlash);
        const item = indexSlash > 0 ? assetStore.itemGet(store, local.slice(indexSlash + 1)) : undefined;
        return item && !item.isDeleted ? descriptorBuild(store, item) : null;
      });
    },

    // what the index knows of the item, its versions and their notes, and
    // the text of its head when it is text
    read: async (ref) => {
      const { store, item } = await itemOfRefGet(ref);
      return readBuild(store, item);
    },

    create: async (spec) => {
      const content = spec.content ?? {};
      const result = await assetStore.itemCreate({
        store: spec.place?.store ?? 'local',
        name: content.name ?? spec.label,
        lang: content.lang ?? 'yaml',
        text: textOfContent(content),
        note: content.note,
        folder: spec.place?.folder,
        docPath: spec.place?.docPath,
      });
      resultCheck(result);
      if (result.data?.isCreated === false) throw codeError(-1, `the name ${content.name ?? spec.label} is taken by the asset ${result.data.item.itemId}`);
      return { descriptor: descriptorBuild(spec.place?.store ?? 'local', result.data.item) };
    },

    update: async (ref, patch = {}) => {
      const { store, item } = await itemOfRefGet(ref);
      if (patch.text === undefined && patch.data === undefined) throw codeError(-1, 'an asset is changed by its data: { text } or { data } (written in its language), with note and mode optional');
      resultCheck(await assetStore.itemUpdate(store, item.itemId, { text: textOfContent({ ...patch, lang: item.lang }) }, patch.mode, patch.note ?? ''));
      return readBuild(store, assetStore.itemGet(store, item.itemId));
    },

    delete: async (ref) => {
      const { store, item } = await itemOfRefGet(ref);
      resultCheck(await assetStore.itemDelete(store, item.itemId));
    },
  };
}

function resultCheck(result) {
  if (result?.code !== 0) throw codeError(result?.code ?? -1, result?.message || 'the asset was not written');
  return result;
}

function codeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// the data of an asset as given: its text, or a mapping written in its language (json, else yaml)
function textOfContent(content) {
  if (typeof content.text === 'string') return content.text;
  if (content.data !== undefined) return content.lang === 'json' ? JSON.stringify(content.data, null, 2) : yamlStringify(content.data);
  return '';
}
