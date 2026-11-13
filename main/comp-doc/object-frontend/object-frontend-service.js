import { stringify as yamlStringify } from 'yaml';

// The api of a mode (design: doc_page_impl_obj_frontend.md#the-entry-component): what the
// component of a mode is given as config.objectFrontend. Built by the entry component for the
// block it draws, by otherGet for a second object a mode reads, and by the layer's store for
// what answers the inner paths of a type (expose.objectInner), which reads its object the same way.
//
// it holds the object as the files say now (getters: a component is an observer and re-renders),
// its assets by any asset reference, and the switches of its block. a component never reaches
// the asset store or the document itself
export function objectFrontendServiceBuild({ objectFrontendStore, ref, mode, modeList, param, paramBlock = {}, blockSwitch, docState, blockKey, navArrival }) {
  const stateGet = () => objectFrontendStore.objectGet(ref);
  return Object.freeze({
    ref,
    get id() { return stateGet().id; },
    get object() { return stateGet(); },
    mode: mode ? { id: mode.id, label: mode.label, category: mode.category, typeId: mode.typeId } : undefined,
    modeList: modeList.map(({ id, label, description, category, typeId }) => ({ id, label, description, category, typeId })),
    param,
    get isWritable() { return objectFrontendStore.writeUnavailableReasonOf(ref) === ''; },
    get writeUnavailableReason() { return objectFrontendStore.writeUnavailableReasonOf(ref); },
    // whether the mode offers what changes the object now: the object can be written, and the
    // document is in edit mode. in reading mode a mode shows its object read-only, without its
    // edit controls (doc_page_impl_obj_frontend.md#reading-and-editing)
    get isEditable() { return objectFrontendStore.writeUnavailableReasonOf(ref) === '' && docState?.isEditing === true; },
    // why not ('' when it is): the reason the object cannot be written, else the document's
    get editUnavailableReason() { return objectFrontendStore.writeUnavailableReasonOf(ref) || (docState?.isEditing ? '' : docState?.editReason ?? 'the document is in reading mode'); },
    // the state of the document the block is in (config.docState)
    docState,
    // the structural write in progress (an asset being created or removed)
    get write() { return objectFrontendStore.write; },
    // every read and write of one asset takes an asset reference: a path
    // (/book/sci-fi/dune), a key (book-1), name:…, id:…
    // (doc_page_impl_obj_frontend.md#naming-and-finding-the-assets)
    assetList: (kind) => stateGet().assetList.filter((asset) => kind === undefined || asset.kind === kind),
    // { status: found | missing | deleted | unknown | loading, asset?, by, message }
    assetResolve: (assetRef) => objectFrontendStore.assetResolve(ref, assetRef),
    assetGet: (assetRef) => objectFrontendStore.assetResolve(ref, assetRef).asset,
    // { tokenList, hitList: [{ asset, score, matchList, pathMatched }] }: the assets found by words
    assetSearch: (text, options) => objectFrontendStore.assetSearch(ref, text, options),
    // [{ kind: folder | asset, path, segment, asset?, assetCount }]: what completes a typed path
    assetComplete: (text, options) => objectFrontendStore.assetComplete(ref, text, options),
    // { status, message, text, asset, assetStatus } of an asset's head
    assetTextGet: (assetRef) => objectFrontendStore.assetTextGet(ref, assetRef),
    // { status, message, data, asset, assetStatus } of an asset whose text is yaml (or json)
    // (parsed once per text and shared: to be read, not changed)
    assetDataGet: (assetRef) => objectFrontendStore.assetDataGet(ref, assetRef),
    // a new asset: { key?, kind?, name?, pathList?, lang?, text } or { ..., data } (written as yaml),
    // placed in { partition?, groupPath? } (inside the partition; absent: the folder of its kind);
    // { code, data: { key, itemId } }. a path another asset has is refused
    assetCreate: (input) => objectFrontendStore.assetCreate(stateGet().id, {
      key: input.key,
      kind: input.kind,
      name: input.name,
      pathList: input.pathList,
      lang: input.lang ?? 'yaml',
      text: input.text ?? yamlStringify(input.data ?? {}),
      note: input.note,
      groupPath: input.groupPath,
      partition: input.partition,
    }),
    // the folders the object splits its items into ({ id, label, description, isGitIgnored, isDefault,
    // isDeclared, isPresent, assetCount, storage }): what a mode creating something offers and names; with one,
    // nothing is asked (doc_page_impl_obj_frontend.md#partitions). an asset made without a partition
    // goes to the default one. storage: the storage point holding the partition and what its type
    // promises ({ pointId, typeId, label, typeLabel, place, isContentSearchable, apiSetList,
    // isAvailable, unavailableReason }, doc_page_impl_asset_storage.md): the apis of a mode are the
    // same whatever the point, and a mode reads this to say where the data is
    get partitionList() { return stateGet().partitionList; },
    get partitionDefault() { return stateGet().partitionList.find((one) => one.isDefault); },
    // the storage points the object may bind a partition to, and the storage of a whole partition
    // changed to one of them (its items written by the type of that point; no key, name or path changes)
    get storagePointList() { return objectFrontendStore.storagePointListGet(stateGet().id); },
    partitionStorageSet: (partition, storagePoint) => objectFrontendStore.partitionStorageSet(stateGet().id, partition, storagePoint),
    // { code, message }: a partition made (its folder and an empty list; bound to storagePoint, by
    // default the point its type declares for it), renamed (its folder moved with what it holds),
    // deleted (its assets off their lists and deleted softly)
    partitionCreate: (partition, storagePoint) => objectFrontendStore.partitionCreate(stateGet().id, partition, storagePoint),
    partitionRename: (partitionFrom, partitionTo) => objectFrontendStore.partitionRename(stateGet().id, partitionFrom, partitionTo),
    partitionDelete: (partition) => objectFrontendStore.partitionDelete(stateGet().id, partition),
    // the assets its type holds, and where one lies on disk, which nothing else depends on:
    // its folder inside the object's folder ('' the top), or a whole folder renamed
    get assetKindList() { return objectFrontendStore.assetKindListGet(ref); },
    assetMove: (assetRef, groupPath) => {
      const asset = objectFrontendStore.assetResolve(ref, assetRef).asset;
      return asset ? objectFrontendStore.assetMove(stateGet().id, asset.key, groupPath) : Promise.resolve({ code: -1, message: `the object has no asset ${assetRef}` });
    },
    assetGroupMove: (groupFrom, groupTo) => objectFrontendStore.assetGroupMove(stateGet().id, groupFrom, groupTo),
    assetWrite: (assetRef, textOrData, note) => objectFrontendStore.assetWrite(ref, assetRef, typeof textOrData === 'string' ? textOrData : yamlStringify(textOrData ?? {}), note),
    // how an asset is named and indexed: { name?, pathList?, kind? } (paths replaced whole)
    assetMetaSet: (assetRef, change) => {
      const asset = objectFrontendStore.assetResolve(ref, assetRef).asset;
      return asset ? objectFrontendStore.assetMetaSet(stateGet().id, asset.key, change) : Promise.resolve({ code: -1, message: `the object has no asset ${assetRef}` });
    },
    assetRemove: (assetRef, options = {}) => {
      const asset = objectFrontendStore.assetResolve(ref, assetRef).asset;
      return asset ? objectFrontendStore.assetRemove(stateGet().id, asset.key, options.isAssetKept === true) : Promise.resolve({ code: -1, message: `the object has no asset ${assetRef}` });
    },
    metadataSet: (patch) => objectFrontendStore.metadataSet(ref, patch),
    // a turn to mount something heavy, one block per frame (useObjectFrontendDrawTurn). blockKey
    // is the block, the same in every mount of it (reading and edit mode): a block drawn once
    // draws at once when it is mounted again
    blockKey,
    drawTurnAsk: (id) => objectFrontendStore.blockDrawAsk(id),
    drawTurnIs: (id) => objectFrontendStore.blockDrawIs(id),
    // the block switched to another mode / other parameters: the block's own
    // parameters, changed a key at a time (null removes one) unless isReplaced;
    // { isSaved: false } keeps the switch out of the document
    modeSet: (modeId, options) => blockSwitch({ mode: modeId }, options),
    // both at once: { mode, param } (param replaces the block's own)
    blockSet: (change, options) => blockSwitch({ mode: change.mode, param: change.param }, options),
    paramSet: (paramChange, options = {}) => {
      const paramNext = options.isReplaced ? { ...paramChange } : { ...paramBlock, ...paramChange };
      for (const key of Object.keys(paramNext)) if (paramNext[key] === null || paramNext[key] === undefined) delete paramNext[key];
      return blockSwitch({ param: paramNext }, options);
    },
    open: () => objectFrontendStore.settingsOpen(stateGet().id),
    // the api of another frontend object, for a mode whose data lies in two objects (a CV
    // reading a profile): the same reads and writes, without the switches of a block
    // the documents of the object (doc_page_impl_obj_frontend.md#documents-of-an-object): the
    // source path of the document of an asset ('' when it is not one), and where a reader was
    // going when this block was opened for them: { target, hash, key, version } of a document
    // of this object, undefined otherwise (#the-home-document)
    docPathGet: (assetRef) => objectFrontendStore.docPathGet(ref, assetRef),
    navArrival,
    otherGet: (refOther) => objectFrontendServiceBuild({
      objectFrontendStore,
      ref: refOther,
      modeList: [],
      param: {},
      blockSwitch: () => Promise.resolve({ code: -1, message: 'another object has no block to switch' }),
    }),
  });
}
