import { objectRefParse } from './doc-object-ref.js';
import { OBJECT_FRONTEND_NAMESPACE, OBJECT_FRONTEND_TYPE_ROOT, objectFrontendRefBuild } from './doc-object-frontend.js';
import { typeDefineNormalize } from './doc-object-type.js';

// The frontend object service layer as a provider of the object registry
// (design: doc_page_impl_obj_frontend.md#in-the-object-registry): every object
// a doc page lists is frontend:{id}, of the type its entry names (a type of
// a doc page, below frontend.object), with its assets as members (core.member
// to asset:local/{objectId}, keyed by their key). The layer keeps its own
// representation (DocObjectFrontendStore over the asset store); the registry
// asks it, and it brings the types the doc pages declare.

export function objectProviderFrontendCreate({ objectFrontendStore }) {
  const descriptorBuild = (state) => ({
    ref: state.ref,
    typeList: [state.typeId],
    label: state.name || state.id,
    description: `${objectFrontendStore.typeLabelGet(state.typeId)} · ${state.assetList.length} asset(s) · ${state.docPageAlias}`,
    summary: { assetCount: state.assetList.length, docPageAlias: state.docPageAlias, typeId: state.typeId },
    capabilityList: ['read'],
    open: { kind: 'objectFrontend', id: state.id },
  });

  // the objects whose entries are read: the others are loaded by the asking
  const stateFoundList = () => objectFrontendStore.itemList
    .map((item) => objectFrontendStore.objectGet(item.id))
    .filter((state) => state.status === 'found');

  // waits for the declarations and the entries of the objects asked for
  // (the declarations are read once; a change of a file reads them again on
  // its own, DocObjectFrontendStore.init)
  const ready = async (idList) => {
    if (objectFrontendStore.config.status !== 'done') await objectFrontendStore.configLoad();
    const { assetStore } = objectFrontendStore.stores;
    await assetStore.indexLoad();
    const itemList = objectFrontendStore.itemList.filter((item) => !idList || idList.includes(item.id));
    await Promise.all(itemList.map((item) => assetStore.refLoad({ store: 'local', objectId: item.entry, versionId: 'head' })));
  };

  const idOfRef = (ref) => {
    const parsed = objectRefParse(ref);
    return parsed?.namespace === OBJECT_FRONTEND_NAMESPACE ? parsed.local : '';
  };

  return {
    id: 'frontend',
    label: 'the frontend objects',
    registry: 'page',
    namespaceList: [OBJECT_FRONTEND_NAMESPACE],
    get typeList() {
      return [OBJECT_FRONTEND_TYPE_ROOT, ...objectFrontendStore.typeDeclaredList.map((type) => type.id)];
    },
    relationTypeList: ['core.member'],
    capabilityList: ['query', 'resolve', 'read', 'relationQuery'],
    versionGet: () => [objectFrontendStore.config, objectFrontendStore.stores.assetStore.objectById],
    cacheSecond: 300,
    statusGet: () => (objectFrontendStore.isAvailable
      ? { status: 'ready', message: '' }
      : { status: 'unavailable', message: objectFrontendStore.unavailableReason || 'the page has no asset service layer' }),

    // the types the doc pages declare, defined by this provider
    typeDefineGet: () => ({
      typeList: objectFrontendStore.typeDeclaredList.map((type) => typeDefineNormalize({
        id: type.id,
        kind: 'object',
        label: type.label,
        description: type.description,
        icon: type.icon,
        extendList: type.extendList,
        summaryKeyList: type.summaryKeyList,
      }, type.definedBy)),
      problemList: [],
    }),

    // an object opens in the Frontend objects tab of the settings panel
    open: (descriptor) => {
      if (descriptor.open?.kind !== 'objectFrontend') return false;
      return objectFrontendStore.settingsOpen(descriptor.open.id);
    },

    query: async () => {
      await ready();
      return stateFoundList().map(descriptorBuild);
    },

    resolve: async (refList) => {
      const idList = refList.map(idOfRef);
      await ready(idList.filter(Boolean));
      return idList.map((id) => {
        if (!id) return null;
        const state = objectFrontendStore.objectGet(id);
        return state.status === 'found' ? descriptorBuild(state) : null;
      });
    },

    read: async (ref) => {
      const id = idOfRef(ref);
      await ready([id]);
      const state = objectFrontendStore.objectGet(id);
      if (state.status !== 'found') throw new Error(state.message || `${ref} is not a frontend object`);
      return {
        descriptor: descriptorBuild(state),
        content: {
          name: state.name,
          type: state.typeId,
          description: state.description,
          metadata: state.metadata,
          docPageAlias: state.docPageAlias,
          entryObjectId: state.entryObjectId,
          assetList: state.assetList.map(({ key, kind, objectId, status }) => ({ key, kind, objectId, status })),
          modeList: objectFrontendStore.modeListGet(state.typeId).map(({ id, label, category, comp }) => ({ id, label, category, comp })),
        },
      };
    },

    // from an object: its assets, in the order of its entry; to an asset: the
    // object it belongs to
    relationQuery: async ({ fromRef, toRef }) => {
      await ready();
      const relationList = [];
      const stateList = fromRef ? [objectFrontendStore.objectGet(idOfRef(fromRef))] : stateFoundList();
      for (const state of stateList) {
        if (state.status !== 'found') continue;
        state.assetList.forEach((asset, index) => {
          const toRefAsset = `asset:local/${asset.objectId}`;
          if (toRef && toRef !== toRefAsset) return;
          relationList.push({
            key: `member/${asset.key}`,
            type: 'core.member',
            fromRef: objectFrontendRefBuild(state.id),
            toRef: toRefAsset,
            order: index,
            label: asset.key,
            data: { kind: asset.kind, status: asset.status },
          });
        });
      }
      return fromRef || toRef
        ? { relationList }
        : { relationList, isComplete: false, message: 'only the objects whose entries are loaded' };
    },
  };
}
