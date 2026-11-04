import { stringify as yamlStringify } from 'yaml';
import { objectRefParse } from './doc-object-ref.js';

// The asset service layer as a provider of the object registry (design:
// doc_page_impl_obj.md#the-providers-of-the-page): every object of its
// index is an asset.object, asset:{store}/{objectId}. The asset store keeps
// its own representation (the index, the versions); the registry asks it.
//
// the writes of the registry (doc_page_impl_obj.md#writing-through-the-registry):
//   create { typeId: asset.object, content: { text | data, lang, name? }, place: { folder | docPath } }
//   update asset:{store}/{id} { text | data, note?, mode? }   the head, by the object's save mode unless mode
//   delete asset:{store}/{id}                                 the deletion mark (its files stay)
// an asset of a frontend object is added and taken out through that object
// (create with memberOf, relationDelete), so its entry lists it.

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
    capabilityList: object.isLocked ? ['read'] : ['read', 'update', 'delete'],
    open: { kind: 'asset', store, objectId: object.objectId },
  });

  const entryList = () => Object.entries(assetStore.objectById)
    .filter(([, state]) => state?.object && !state.object.isDeleted)
    .map(([key, state]) => ({ store: key.slice(0, key.indexOf('/')), object: state.object }));

  const statusGet = () => (assetStore.backendKind === 'none'
    ? { status: 'unavailable', message: assetStore.unavailableReason || 'the page has no asset service layer' }
    : { status: 'ready', message: '' });

  // the object of a reference, with its head loaded
  const objectOfRefGet = async (ref) => {
    await assetStore.indexLoad();
    const local = objectRefParse(ref)?.local ?? '';
    const indexSlash = local.indexOf('/');
    const store = local.slice(0, indexSlash);
    const object = indexSlash > 0 ? assetStore.objectGet(store, local.slice(indexSlash + 1)) : undefined;
    if (!object) throw codeError(-3, `${ref} is not an object of the asset store`);
    await assetStore.refLoad({ store, objectId: object.objectId, versionId: 'head' });
    return { store, object: assetStore.objectGet(store, object.objectId) };
  };

  const readBuild = (store, object) => {
    const head = assetStore.versionGet(store, object.objectId, object.versionIdHead);
    return {
      descriptor: descriptorBuild(store, object),
      content: {
        objectId: object.objectId,
        name: object.name,
        lang: object.lang,
        owner: object.owner,
        versionIdHead: object.versionIdHead,
        // the head's data, when it is text (an image is read through its url)
        text: head?.isText ? head.text : undefined,
        versionList: (object.versionList ?? []).map((version) => ({ versionId: version.versionId, time: version.time, note: version.note, size: version.size })),
      },
    };
  };

  return {
    id: 'asset',
    label: 'the asset store',
    registry: 'page',
    namespaceList: ['asset'],
    typeList: ['asset.object'],
    relationTypeList: [],
    capabilityList: ['query', 'resolve', 'read', 'create', 'update', 'delete'],
    createTypeList: ['asset.object'],
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

    // what the index knows of the object, its versions and their notes, and
    // the text of its head when it is text
    read: async (ref) => {
      const { store, object } = await objectOfRefGet(ref);
      return readBuild(store, object);
    },

    create: async (spec) => {
      const content = spec.content ?? {};
      const result = await assetStore.objectCreate({
        store: spec.place?.store ?? 'local',
        name: content.name ?? spec.label,
        lang: content.lang ?? 'yaml',
        text: textOfContent(content),
        note: content.note,
        folder: spec.place?.folder,
        docPath: spec.place?.docPath,
      });
      resultCheck(result);
      if (result.data?.isCreated === false) throw codeError(-1, `the name ${content.name ?? spec.label} is taken by the asset ${result.data.object.objectId}`);
      return { descriptor: descriptorBuild(spec.place?.store ?? 'local', result.data.object) };
    },

    update: async (ref, patch = {}) => {
      const { store, object } = await objectOfRefGet(ref);
      if (patch.text === undefined && patch.data === undefined) throw codeError(-1, 'an asset is changed by its data: { text } or { data } (written in its language), with note and mode optional');
      resultCheck(await assetStore.objectUpdate(store, object.objectId, { text: textOfContent({ ...patch, lang: object.lang }) }, patch.mode, patch.note ?? ''));
      return readBuild(store, assetStore.objectGet(store, object.objectId));
    },

    delete: async (ref) => {
      const { store, object } = await objectOfRefGet(ref);
      resultCheck(await assetStore.objectDelete(store, object.objectId));
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
