import { objectRefParse } from './doc-object-ref.js';
import { OBJECT_FRONTEND_NAMESPACE, OBJECT_FRONTEND_TYPE_ROOT, objectFrontendAssetSearch, objectFrontendRefBuild } from './doc-object-frontend.js';
import { stringify as yamlStringify } from 'yaml';
import { typeDefineNormalize } from './doc-object-type.js';

// The frontend object service layer as a provider of the object registry
// (design: doc_page_impl_obj_frontend.md#in-the-object-registry): every object
// a doc page lists is frontend:{id}, of the type its entry names (a type of
// a doc page, below frontend.object), with its assets as members (core.member
// to asset:local/{itemId}, keyed by their key). The layer keeps its own
// representation (DocObjectFrontendStore over the asset store); the registry
// asks it, and it brings the types the doc pages declare.
//
// It is also how the layer is written by anyone who is not a mode of an
// object (an agent, the palette, another component): the standard writes of
// the registry (doc_page_impl_obj.md#writing-through-the-registry), each a
// structural write of the layer:
//   create { typeId, content: { name, description, metadata }, place: { docPageAlias | docPath } }
//                               a new object of a frontend type
//   create { memberOf: { ref: frontend:{id}, key?, data: { kind, name?, pathList? } }, content: { text | data, lang } }
//                               a new asset of the object, listed under its key
//   update frontend:{id} { name?, description?, typeId?, metadata? }   metadata a key at a time, null removes one
//   delete frontend:{id} { isMemberKept? }                            its assets deleted too, or kept
//   relationCreate { fromRef: frontend:{id}, type: core.member, toRef: asset:local/{itemId}, key?, data: { kind } }
//                               an asset of the store attached to it
//   relationUpdate { fromRef, key | toRef, data: { kind?, name?, pathList? } }   how an asset is named and indexed
//   relationDelete { fromRef, key | toRef, isTargetDeleted? }        an asset taken out (kept, or deleted)
//   relationQuery { fromRef, text? }                                 its assets; with text, those the asset search finds
// the data of one asset is written by the asset store's own provider
// (update asset:local/{itemId} { text | data }).

export function objectProviderFrontendCreate({ objectFrontendStore }) {
  const descriptorBuild = (state) => ({
    ref: state.ref,
    typeList: [state.typeId],
    label: state.name || state.id,
    description: `${objectFrontendStore.typeLabelGet(state.typeId)} · ${state.assetList.length} asset(s) · ${state.docPageAlias}`,
    summary: { assetCount: state.assetList.length, docPageAlias: state.docPageAlias, typeId: state.typeId },
    capabilityList: ['read', 'update', 'delete', 'relationCreate', 'relationUpdate', 'relationDelete'],
    open: { kind: 'objectFrontend', id: state.id },
  });

  // what a read answers: the entry as content, each asset with its reference
  const readBuild = (state) => ({
    descriptor: descriptorBuild(state),
    content: {
      name: state.name,
      type: state.typeId,
      description: state.description,
      metadata: state.metadata,
      docPageAlias: state.docPageAlias,
      entryItemId: state.entryItemId,
      assetList: state.assetList.map(({ key, kind, name, pathList, itemId, status }) => ({
        key, kind, name: name ?? '', pathList: pathList ?? [], itemId, ref: `asset:local/${itemId}`, status,
      })),
      modeList: objectFrontendStore.modeListGet(state.typeId).map(({ id, label, category, comp }) => ({ id, label, category, comp })),
      assetKindList: objectFrontendStore.assetKindListGet(state.id),
      // what does not agree (doc_page_impl_obj_frontend.md#what-disagrees)
      disagreement: {
        strayList: state.strayList.map((item) => item.itemId),
        unknownList: state.unknownList.map((item) => item.itemId),
        outsideList: state.outsideList.map((asset) => asset.key),
      },
    },
  });

  // the objects whose entries are read: the others are loaded by the asking
  const stateFoundList = () => objectFrontendStore.declList
    .map((decl) => objectFrontendStore.objectGet(decl.id))
    .filter((state) => state.status === 'found');

  // waits for the declarations and the entries of the objects asked for
  // (the declarations are read once; a change of a file reads them again on
  // its own, DocObjectFrontendStore.init)
  const ready = async (idList) => {
    if (objectFrontendStore.config.status !== 'done') await objectFrontendStore.configLoad();
    const { assetStore } = objectFrontendStore.stores;
    await assetStore.indexLoad();
    const declList = objectFrontendStore.declList.filter((decl) => !idList || idList.includes(decl.id));
    await Promise.all(declList.map((decl) => assetStore.refLoad({ store: 'local', itemId: decl.entry, versionId: 'head' })));
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
    // relationText: its relation query takes the text itself (the asset search)
    capabilityList: ['query', 'resolve', 'read', 'relationQuery', 'relationText', 'create', 'update', 'delete', 'relationCreate', 'relationUpdate', 'relationDelete'],
    // objects of frontend.object and every type below it
    createTypeList: [OBJECT_FRONTEND_TYPE_ROOT],
    versionGet: () => [objectFrontendStore.config, objectFrontendStore.stores.assetStore.itemById],
    cacheSecond: 300,
    statusGet: () => (objectFrontendStore.isAvailable
      ? { status: 'ready', message: '' }
      : { status: 'unavailable', message: objectFrontendStore.unavailableReason || 'the page has no asset service layer' }),

    // the types the doc pages declare, defined by this provider
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
      return readBuild(state);
    },

    // the modes of a frontend object type, inherited ones included: what an
    // author or an agent chooses from for a block (type/get)
    typeInfoGet: (typeId) => {
      if (!objectFrontendStore.typeIsFrontend(typeId)) return undefined;
      return {
        assetKindList: objectFrontendStore.assetKindListOfTypeGet(typeId),
        modeList: objectFrontendStore.modeListGet(typeId).map(({ id, label, description, category, comp, param, isDefault, typeId: typeIdDeclared }) => ({
          id, label, description, category, comp, param, isDefault, typeId: typeIdDeclared,
        })),
      };
    },

    create: async (spec) => {
      const memberOf = spec.memberOf;
      if (memberOf) {
        const id = idOfRef(memberOf.ref);
        if (!id) throw codeError(-1, `${memberOf.ref} is not a frontend object`);
        if (spec.typeId && spec.typeId !== 'asset.item') throw codeError(-1, `a member of a frontend object is an asset (asset.item), not a ${spec.typeId}`);
        const content = spec.content ?? {};
        const result = resultCheck(await objectFrontendStore.assetCreate(id, {
          key: memberOf.key, kind: memberOf.data?.kind ?? content.kind, name: memberOf.data?.name, pathList: memberOf.data?.pathList,
          lang: content.lang ?? 'yaml', text: textOfContent(content), note: content.note,
        }));
        return {
          descriptor: { ref: `asset:local/${result.data.itemId}`, typeList: ['asset.item'], label: result.data.key },
          content: { key: result.data.key, memberOf: objectFrontendRefBuild(id), relationKey: `member/${result.data.key}` },
        };
      }
      const content = spec.content ?? {};
      const docPageAlias = spec.place?.docPageAlias ?? docPageAliasOfPath(spec.place?.docPath) ?? '';
      const result = resultCheck(await objectFrontendStore.create({
        docPageAlias: docPageAlias || objectFrontendStore.settingsCreateDocPageAlias,
        typeId: spec.typeId,
        name: String(content.name ?? spec.label ?? ''),
        description: content.description,
      }));
      const id = result.data.id;
      if (content.metadata && typeof content.metadata === 'object') resultCheck(await objectFrontendStore.metaSet(id, { metadata: content.metadata }));
      await ready([id]);
      return { descriptor: descriptorBuild(objectFrontendStore.objectGet(id)) };
    },

    update: async (ref, patch = {}) => {
      const id = idOfRef(ref);
      await ready([id]);
      const state = objectFrontendStore.objectGet(id);
      if (state.status !== 'found') throw codeError(-3, state.message || `${ref} is not a frontend object`);
      const change = {};
      for (const key of ['name', 'description', 'typeId']) if (patch[key] !== undefined) change[key] = String(patch[key]);
      if (patch.metadata !== undefined) {
        if (!patch.metadata || typeof patch.metadata !== 'object' || Array.isArray(patch.metadata)) throw codeError(-1, 'metadata is a mapping, changed a key at a time (null removes one)');
        const metadata = { ...state.metadata };
        for (const [key, value] of Object.entries(patch.metadata)) {
          if (value === null) delete metadata[key];
          else metadata[key] = value;
        }
        change.metadata = metadata;
      }
      const keyUnknownList = Object.keys(patch).filter((key) => !['name', 'description', 'typeId', 'metadata'].includes(key));
      if (keyUnknownList.length > 0) throw codeError(-1, `a frontend object is changed by name, description, typeId, metadata (not ${keyUnknownList.join(', ')}); its assets by relationCreate / relationDelete and the update of each asset`);
      resultCheck(await objectFrontendStore.metaSet(id, change));
      await ready([id]);
      return readBuild(objectFrontendStore.objectGet(id));
    },

    delete: async (ref, options = {}) => {
      resultCheck(await objectFrontendStore.delete(idOfRef(ref), options.isMemberKept === true));
    },

    relationCreate: async (spec) => {
      if (spec.type !== 'core.member') throw codeError(-1, `a frontend object keeps core.member relations only (its assets), not ${spec.type}`);
      const itemId = assetItemIdOfRef(spec.toRef);
      if (!itemId) throw codeError(-1, `the member of a frontend object is an asset: asset:local/{itemId}, not ${spec.toRef}`);
      resultCheck(await objectFrontendStore.assetAttach(idOfRef(spec.fromRef), itemId, {
        key: spec.key, kind: spec.data?.kind, name: spec.data?.name, pathList: spec.data?.pathList, groupPath: spec.data?.groupPath, isOwnerReplaced: spec.data?.isOwnerReplaced,
      }));
      return { relation: { fromRef: spec.fromRef, toRef: spec.toRef, type: 'core.member' } };
    },

    relationDelete: async (spec) => {
      const id = idOfRef(spec.fromRef);
      await ready([id]);
      const state = objectFrontendStore.objectGet(id);
      const keyOfTarget = spec.toRef ? state.assetList.find((asset) => `asset:local/${asset.itemId}` === spec.toRef)?.key : undefined;
      const key = String(spec.key ?? '').replace(/^member\//, '') || keyOfTarget;
      if (!key) throw codeError(-3, `${spec.fromRef} has no member ${spec.key ?? spec.toRef}`);
      resultCheck(await objectFrontendStore.assetRemove(id, key, spec.isTargetDeleted !== true));
    },

    // from an object: its assets, in the order of its entry; to an asset: the
    // object it belongs to
    // how an asset is named and indexed in its object: the data of its
    // member entry ({ kind, name, pathList }, paths replaced whole)
    relationUpdate: async (spec) => {
      const id = idOfRef(spec.fromRef);
      await ready([id]);
      const state = objectFrontendStore.objectGet(id);
      const keyOfTarget = spec.toRef ? state.assetList.find((asset) => `asset:local/${asset.itemId}` === spec.toRef)?.key : undefined;
      const key = String(spec.key ?? '').replace(/^member\//, '') || keyOfTarget;
      if (!key) throw codeError(-3, `${spec.fromRef} has no member ${spec.key ?? spec.toRef}`);
      const { groupPath, ...data } = spec.data ?? {};
      const keyUnknownList = Object.keys(data).filter((item) => !['kind', 'name', 'pathList'].includes(item));
      if (keyUnknownList.length > 0) throw codeError(-1, `the entry of an asset holds kind, name, pathList (not ${keyUnknownList.join(', ')}); its data is the asset's own (object/update)`);
      if (groupPath !== undefined) resultCheck(await objectFrontendStore.assetMove(id, key, String(groupPath)));
      if (Object.keys(data).length > 0) resultCheck(await objectFrontendStore.assetMetaSet(id, key, data));
      return { relation: { fromRef: spec.fromRef, key: `member/${key}`, type: 'core.member' } };
    },

    // from an object: its assets, in the order of its entry, or with a text
    // the ones the asset search finds, best first (the object search's
    // words: kind:, name:, path:, key:, id:); to an asset: the object it
    // belongs to. the data of each: its kind, name, paths and state
    relationQuery: async ({ fromRef, toRef, text }) => {
      await ready();
      const relationList = [];
      const stateList = fromRef ? [objectFrontendStore.objectGet(idOfRef(fromRef))] : stateFoundList();
      for (const state of stateList) {
        if (state.status !== 'found') continue;
        const assetList = text ? objectFrontendAssetSearch(state.assetList, text).hitList.map((hit) => hit.asset) : state.assetList;
        assetList.forEach((asset, index) => {
          const toRefAsset = `asset:local/${asset.itemId}`;
          if (toRef && toRef !== toRefAsset) return;
          relationList.push({
            key: `member/${asset.key}`,
            type: 'core.member',
            fromRef: objectFrontendRefBuild(state.id),
            toRef: toRefAsset,
            order: index,
            label: asset.name || asset.key,
            data: { kind: asset.kind, name: asset.name ?? '', pathList: asset.pathList ?? [], status: asset.status },
          });
        });
      }
      return fromRef || toRef
        ? { relationList }
        : { relationList, isComplete: false, message: 'only the objects whose entries are loaded' };
    },
  };
}

// a result of the layer's store as a provider answers: its data, or an error with its code
function resultCheck(result) {
  if (result?.code !== 0) throw codeError(result?.code ?? -1, result?.message || 'the change was not written');
  return result;
}

function codeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// the data of an asset as written: its text, or a mapping written as yaml
function textOfContent(content) {
  if (typeof content.text === 'string') return content.text;
  if (content.data !== undefined) return content.lang === 'json' ? JSON.stringify(content.data, null, 2) : yamlStringify(content.data);
  return '';
}

function assetItemIdOfRef(ref) {
  const match = /^asset:local\/([0-9a-z]+)$/.exec(String(ref ?? ''));
  return match ? match[1] : '';
}

// ~alias:root/a.md -> alias
function docPageAliasOfPath(docPath) {
  const match = /^~([^:/]+):/.exec(String(docPath ?? ''));
  return match ? match[1] : undefined;
}
