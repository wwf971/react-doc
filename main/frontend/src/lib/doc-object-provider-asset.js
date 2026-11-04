import { objectRefParse } from './doc-object-ref.js';

// The asset service layer as a provider of the object registry (design:
// doc_page_impl_obj.md#the-providers-of-the-page): every object of its
// index is an asset.object, asset:{store}/{objectId}. The asset store keeps
// its own representation (the index, the versions); the registry asks it.

export function objectProviderAssetCreate({ assetStore }) {
  const descriptorBuild = (store, object) => ({
    ref: `asset:${store}/${object.objectId}`,
    typeList: ['asset.object'],
    label: object.name || object.objectId,
    description: `${object.lang || object.contentType || 'data'} · ${object.versionList?.length ?? 0} version(s)${object.isLocked ? ' · locked' : ''}`,
    summary: {
      store,
      lang: object.lang,
      versionCount: object.versionList?.length ?? 0,
      versionIdHead: object.versionIdHead,
      isLocked: object.isLocked === true,
      compName: object.component?.compName ?? '',
    },
    capabilityList: ['read'],
    open: { kind: 'asset', store, objectId: object.objectId },
  });

  const entryList = () => Object.entries(assetStore.objectById)
    .filter(([, state]) => state?.object && !state.object.isDeleted)
    .map(([key, state]) => ({ store: key.slice(0, key.indexOf('/')), object: state.object }));

  const statusGet = () => (assetStore.backendKind === 'none'
    ? { status: 'unavailable', message: assetStore.unavailableReason || 'the page has no asset service layer' }
    : { status: 'ready', message: '' });

  return {
    id: 'asset',
    label: 'the asset store',
    registry: 'page',
    namespaceList: ['asset'],
    typeList: ['asset.object'],
    relationTypeList: [],
    capabilityList: ['query', 'resolve', 'read'],
    versionGet: () => assetStore.objectById,
    cacheSecond: 300,
    statusGet,

    // an object of the store opens in the asset panel
    open: (descriptor) => {
      const open = descriptor.open;
      if (open?.kind !== 'asset' || !assetStore.panelOpen) return false;
      assetStore.panelOpen(open.store, open.objectId);
      return true;
    },

    query: async () => {
      await assetStore.indexLoad();
      return entryList().map(({ store, object }) => descriptorBuild(store, object));
    },

    resolve: async (refList) => {
      await assetStore.indexLoad();
      return refList.map((ref) => {
        const local = objectRefParse(ref)?.local ?? '';
        const indexSlash = local.indexOf('/');
        const store = local.slice(0, indexSlash);
        const object = indexSlash > 0 ? assetStore.objectGet(store, local.slice(indexSlash + 1)) : undefined;
        return object && !object.isDeleted ? descriptorBuild(store, object) : null;
      });
    },

    // what the index knows of the object: its versions and their notes (the
    // data of a version is read by the components that use it)
    read: async (ref) => {
      await assetStore.indexLoad();
      const local = objectRefParse(ref)?.local ?? '';
      const indexSlash = local.indexOf('/');
      const store = local.slice(0, indexSlash);
      const object = indexSlash > 0 ? assetStore.objectGet(store, local.slice(indexSlash + 1)) : undefined;
      if (!object) throw new Error(`${ref} is not an object of the asset store`);
      return {
        descriptor: descriptorBuild(store, object),
        content: {
          objectId: object.objectId,
          name: object.name,
          lang: object.lang,
          versionIdHead: object.versionIdHead,
          versionList: (object.versionList ?? []).map((version) => ({ versionId: version.versionId, time: version.time, note: version.note, size: version.size })),
        },
      };
    },
  };
}
