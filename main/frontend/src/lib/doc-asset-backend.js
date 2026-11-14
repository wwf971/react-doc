// Backends of the asset service layer in the browser (design: doc_page_impl_asset.md).
// DocAssetStore talks to one backend; every backend answers the same calls
// with { code, data, message } (code 0 success, negative failure), so the
// store and the ui do not know where the items live:
//
//   assetBackendApiCreate(endpoint)        the asset api of the development
//                                          server (plugin/doc-asset-server.ts):
//                                          reads and writes the folders on disk
//   assetBackendSnapshotCreate(snapshot)   the store bundled into a build by
//                                          the vite plugin: read-only
//
//   assetBackendRouteCreate(base, { remoteGet, ... })   one of the two above, with the items of the
//                                          partitions held by storage points of the page (remote
//                                          types) answered by DocAssetRemoteStore instead: what
//                                          DocAssetStore talks to
//
// every item call names the store (the id written in a reference).
//
//   statusGet()                                 { isWritable, storeIdList, folderList, storage }: storage is
//                                               { typeList, apiSetList, pointList, fileList }, the storage points
//                                               of the page (doc_page_impl_asset_storage.md)
//   itemList(store)                           { itemList }
//   itemGet(store, itemId, versionId)       { item, version: { versionId, size, hash, isText, text?, metadata } }
//                                               metadata: the version's metadata mapping ({} when none)
//   itemGetByName(store, name, versionId)     the same, the item found by its name
//   itemGetList(store, requestList)              { answerList }: many itemGet in one call, [{ itemId, versionId }]
//                                               answered in that order, each { code, data, message }
//   dataUrlGet(store, itemId, versionId)      the url the bytes of a version are read from ('' when none)
//   itemCreate({ store, name, lang, contentType, fileExt, text | dataBase64, note, folder, dependencyList,
//                  saveMode, versionMetadata })
//                                               { item, version, isCreated }; isCreated false when an
//                                               item of that name exists: it is answered, nothing is created
//   itemUpdate({ store, itemId, hashBase, text | dataBase64, mode, note, dependencyList, versionMetadata })
//   testCaseResultSet({ store, itemId, hashBase, docPath, caseId, testerId, operator, result, timeTimezone,
//                       evidence, versionId })   { item, version }: one test result appended to the
//                                               history of a TestCaseTable item, at its head
//   versionMetadataSet(store, itemId, versionId, versionMetadata)  { item, version }
//   dependencyListGet(store, itemId, versionId)      { versionId, dependencyList }
//   dependentListGet(store, itemId, versionId)       { dependentList }   versionId '' for the whole item
//   dependencyListSet(store, itemId, versionId, dependencyList)   { item }
//   dependencyAdd(store, itemId, versionId, dependency)           { item }
//   dependencyRemove(store, itemId, versionId, dependency)        { item }
//   itemDelete(store, itemId) / itemRestore(store, itemId)
//   itemMetaSet(store, itemId, { name, lang, contentType, saveMode, component })
//   usageList(docPathList)                      { docList: [{ docPath, contentHash, usageList }] }
//                                               the asset references of the documents (all when the
//                                               list is empty; doc_page_impl_asset.md#usage)
//   versionCheckout(store, itemId, versionId)
//   versionDelete(store, itemId, versionId)
//   itemLockSet(store, itemId, isLocked)
//   versionLockSet(store, itemId, versionId, isLocked)
//   folderSet(configFile, folderList, folderDefault)  the folders of one doc page (~root/path, or ~page:root/path),
//                                               written into its asset store config
//   itemMove(store, itemId, { groupPath, folder? })  the item's folder moved: into group folders, or another store folder
//   objectFrontendConfigGet()                   { docPageList }: the frontend objects and types the doc
//                                               pages declare (doc_page_impl_obj_frontend.md)
//   objectFrontendWrite(route, body)            a write of the frontend object service layer (create,
//                                               register, delete, meta/set, asset/create, asset/remove,
//                                               asset/attach): { id, itemList, config }

export function assetBackendApiCreate(endpoint) {
  const endpointNormalized = String(endpoint ?? '').replace(/\/+$/, '');

  const requestSend = async (route, init) => {
    try {
      const response = await fetch(`${endpointNormalized}${route}`, { cache: 'no-store', ...init });
      const payload = await response.json().catch(() => undefined);
      if (!payload || typeof payload.code !== 'number') {
        return { code: -1, data: null, message: `asset api answered ${response.status} without a result` };
      }
      return payload;
    } catch (error) {
      return { code: -1, data: null, message: `asset api is not reachable: ${String(error?.message ?? error)}` };
    }
  };
  const requestPost = (route, body) => requestSend(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const itemQueryBuild = (store, itemId, versionId) => (
    `store=${encodeURIComponent(store)}&itemId=${encodeURIComponent(itemId)}&versionId=${encodeURIComponent(versionId)}`
  );

  return {
    kind: 'api',
    statusGet: () => requestSend('/status'),
    itemList: (store) => requestSend(`/item/list?store=${encodeURIComponent(store)}`),
    itemGet: (store, itemId, versionId = 'head') => requestSend(`/item/get?${itemQueryBuild(store, itemId, versionId)}`),
    itemGetList: (store, requestList) => requestPost('/item/get/list', { store, requestList }),
    itemGetByName: (store, name, versionId = 'head') => requestSend(
      `/item/get?store=${encodeURIComponent(store)}&name=${encodeURIComponent(name)}&versionId=${encodeURIComponent(versionId)}`,
    ),
    dataUrlGet: (store, itemId, versionId = 'head') => `${endpointNormalized}/item/data?${itemQueryBuild(store, itemId, versionId)}`,
    itemCreate: (input) => requestPost('/item/create', input),
    itemUpdate: (input) => requestPost('/item/update', input),
    testCaseResultSet: (input) => requestPost('/test-case/result/set', input),
    itemDelete: (store, itemId) => requestPost('/item/delete', { store, itemId }),
    itemRestore: (store, itemId) => requestPost('/item/restore', { store, itemId }),
    itemMetaSet: (store, itemId, change) => requestPost('/item/meta/set', { store, itemId, ...change }),
    versionCheckout: (store, itemId, versionId) => requestPost('/version/checkout', { store, itemId, versionId }),
    versionDelete: (store, itemId, versionId) => requestPost('/version/delete', { store, itemId, versionId }),
    versionMetadataSet: (store, itemId, versionId, versionMetadata) => requestPost('/version/metadata/set', { store, itemId, versionId, versionMetadata }),
    itemLockSet: (store, itemId, isLocked) => requestPost('/item/lock/set', { store, itemId, isLocked }),
    versionLockSet: (store, itemId, versionId, isLocked) => requestPost('/version/lock/set', { store, itemId, versionId, isLocked }),
    dependencyListGet: (store, itemId, versionId = 'head') => requestSend(`/dependency/list?${itemQueryBuild(store, itemId, versionId)}`),
    dependentListGet: (store, itemId, versionId = '') => requestSend(`/dependent/list?${itemQueryBuild(store, itemId, versionId)}`),
    dependencyListSet: (store, itemId, versionId, dependencyList) => requestPost('/dependency/set', { store, itemId, versionId, dependencyList }),
    dependencyAdd: (store, itemId, versionId, dependency) => requestPost('/dependency/add', { store, itemId, versionId, dependency }),
    dependencyRemove: (store, itemId, versionId, dependency) => requestPost('/dependency/remove', { store, itemId, versionId, dependency }),
    folderSet: (configFile, folderList, folderDefault) => requestPost('/folder/set', { configFile, folderList, folderDefault }),
    itemMove: (store, itemId, place) => requestPost('/item/move', { store, itemId, groupPath: place.groupPath ?? '', folder: place.folder }),
    objectFrontendConfigGet: () => requestSend('/object-frontend/config'),
    objectFrontendWrite: (route, body) => requestPost(`/object-frontend/${route}`, body),
    usageList: (docPathList = []) => requestSend(
      `/usage/list${docPathList.length > 0 ? `?${docPathList.map((docPath) => `docPath=${encodeURIComponent(docPath)}`).join('&')}` : ''}`,
    ),
  };
}

// snapshot: { itemById: { [itemId]: { ...item, versionDataById:
// { [versionId]: { size, hash, isText, text | dataBase64, metadata } } } } },
// usageDocList }, the local store as it was at build time, with the asset
// references of the documents of the build
export function assetBackendSnapshotCreate(snapshot, storeIdLocal = 'local') {
  const itemById = snapshot?.itemById ?? {};
  const usageDocList = Array.isArray(snapshot?.usageDocList) ? snapshot.usageDocList : [];
  const readOnly = () => Promise.resolve({ code: -1, data: null, message: 'the asset service layer of a built page is read-only' });
  const itemMetaGet = (itemId) => {
    const entry = itemById[itemId];
    if (!entry) return undefined;
    const { versionDataById: _versionData, ...item } = entry;
    return item;
  };
  const storeCheck = (store) => (
    store === storeIdLocal ? undefined : { code: -3, data: null, message: `unknown asset store: ${store}` }
  );
  const versionResolve = (store, itemId, versionIdRequested) => {
    const failureStore = storeCheck(store);
    if (failureStore) return { failure: failureStore };
    const entry = itemById[itemId];
    if (!entry) return { failure: { code: -3, data: null, message: `asset item not found: ${itemId}` } };
    const versionId = versionIdRequested === '' || versionIdRequested === 'head' ? entry.versionIdHead : versionIdRequested;
    const versionData = entry.versionDataById[versionId];
    if (!versionData) return { failure: { code: -3, data: null, message: `version ${versionId} not found in item ${itemId}` } };
    return { entry, versionId, versionData };
  };
  // the dependencies are part of the version metadata the snapshot carries
  const dependencyListGet = (store, itemId, versionIdRequested = 'head') => {
    const resolved = versionResolve(store, itemId, versionIdRequested);
    if (resolved.failure) return Promise.resolve(resolved.failure);
    const versionMeta = resolved.entry.versionList.find((version) => version.versionId === resolved.versionId);
    return Promise.resolve({ code: 0, data: { versionId: resolved.versionId, dependencyList: versionMeta?.dependencyList ?? [] }, message: '' });
  };
  const dependentListGet = (store, itemId, versionIdRequested = '') => {
    const failureStore = storeCheck(store);
    if (failureStore) return Promise.resolve(failureStore);
    const entryTarget = itemById[itemId];
    if (!entryTarget) return Promise.resolve({ code: -3, data: null, message: `asset item not found: ${itemId}` });
    const versionIdWanted = versionIdRequested === '' ? '' : (versionIdRequested === 'head' ? entryTarget.versionIdHead : versionIdRequested);
    const dependentList = [];
    for (const entry of Object.values(itemById)) {
      for (const version of entry.versionList) {
        for (const dependency of version.dependencyList ?? []) {
          if (dependency.type !== 'asset' || dependency.itemId !== itemId) continue;
          const versionIdDepended = dependency.versionId ?? entryTarget.versionIdHead;
          if (versionIdWanted !== '' && versionIdDepended !== versionIdWanted) continue;
          dependentList.push({ itemId: entry.itemId, versionId: version.versionId, dependency });
        }
      }
    }
    return Promise.resolve({ code: 0, data: { dependentList }, message: '' });
  };
  const itemGet = (store, itemId, versionIdRequested = 'head') => {
    const resolved = versionResolve(store, itemId, versionIdRequested);
    if (resolved.failure) return Promise.resolve(resolved.failure);
    const { versionId, versionData } = resolved;
    const version = { versionId, size: versionData.size, hash: versionData.hash, isText: versionData.isText, metadata: versionData.metadata ?? {} };
    if (versionData.isText) version.text = versionData.text;
    return Promise.resolve({ code: 0, data: { item: itemMetaGet(itemId), version }, message: '' });
  };

  return {
    kind: 'snapshot',
    statusGet: () => Promise.resolve({
      code: 0,
      data: { isWritable: false, storeIdList: [storeIdLocal], folderList: snapshot?.folderList ?? [], storage: snapshot?.storage ?? null },
      message: '',
    }),
    itemList: (store) => Promise.resolve(storeCheck(store) ?? {
      code: 0,
      data: { itemList: Object.keys(itemById).map(itemMetaGet) },
      message: '',
    }),
    itemGet,
    itemGetList: async (store, requestList) => ({
      code: 0,
      data: { answerList: await Promise.all(requestList.map((one) => itemGet(store, one.itemId, one.versionId))) },
      message: '',
    }),
    itemGetByName: (store, name, versionIdRequested = 'head') => {
      const failureStore = storeCheck(store);
      if (failureStore) return Promise.resolve(failureStore);
      const entry = Object.values(itemById).find((one) => one.name === name);
      if (!entry) return Promise.resolve({ code: -3, data: null, message: `asset item not found by name: ${name}` });
      return itemGet(store, entry.itemId, versionIdRequested);
    },
    // the bytes of a binary version as a data url; a text version has no url of its own
    dataUrlGet: (store, itemId, versionIdRequested = 'head') => {
      const resolved = versionResolve(store, itemId, versionIdRequested);
      if (resolved.failure || resolved.versionData.isText) return '';
      return `data:${resolved.entry.contentType || 'application/octet-stream'};base64,${resolved.versionData.dataBase64}`;
    },
    itemCreate: readOnly,
    itemUpdate: readOnly,
    itemMove: readOnly,
    // the declarations the build carried
    objectFrontendConfigGet: () => Promise.resolve({ code: 0, data: { docPageList: snapshot?.objectFrontend?.docPageList ?? [] }, message: '' }),
    objectFrontendWrite: readOnly,
    testCaseResultSet: readOnly,
    itemDelete: readOnly,
    itemRestore: readOnly,
    itemMetaSet: readOnly,
    versionCheckout: readOnly,
    versionDelete: readOnly,
    versionMetadataSet: readOnly,
    itemLockSet: readOnly,
    versionLockSet: readOnly,
    dependencyListGet,
    dependentListGet,
    dependencyListSet: readOnly,
    dependencyAdd: readOnly,
    dependencyRemove: readOnly,
    folderSet: readOnly,
    usageList: (docPathList = []) => Promise.resolve({
      code: 0,
      data: { docList: docPathList.length > 0 ? usageDocList.filter((doc) => docPathList.includes(doc.docPath)) : usageDocList },
      message: '',
    }),
  };
}

// The backend the asset store talks to (doc_page_impl_asset_storage.md#points-of-the-page): the
// development server or the snapshot of a build for everything they hold, and the storage points
// of the page for the items of the partitions bound to them. The asset store asks one backend and
// does not know which half answered; an item is routed by its id, which is unique in the store.
//
//   base                         assetBackendApiCreate(...) or assetBackendSnapshotCreate(...)
//   remoteGet()                  the DocAssetRemoteStore of the page (undefined until it is there)
//   writeUnavailableReasonGet()  why base cannot be written ('' when it can): a write that goes to
//                                base is refused with it, so a built page still writes what a
//                                storage point of the page holds
export function assetBackendRouteCreate(base, { remoteGet, writeUnavailableReasonGet = () => '' }) {
  const remote = () => remoteGet?.();
  const isRemote = (itemId) => remote()?.itemIs(String(itemId ?? '')) === true;
  const refuse = (message) => Promise.resolve({ code: -1, data: null, message });
  // a write that base holds: refused where base cannot be written
  const baseWrite = (write) => {
    const reason = writeUnavailableReasonGet();
    return reason ? refuse(reason) : write();
  };
  const dataOf = (input) => {
    if (typeof input.dataBase64 === 'string') {
      const binary = atob(input.dataBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return { bytes };
    }
    return { text: String(input.text ?? '') };
  };
  // a write of one item: the point's when the point holds the item, else base's
  const itemWrite = (itemId, method, args, write) => (isRemote(itemId) ? remote().itemCall(itemId, method, args) : baseWrite(write));
  return {
    ...base,
    itemList: async (store) => {
      const result = await base.itemList(store);
      const itemListRemote = remote()?.itemList ?? [];
      if (result.code !== 0 || itemListRemote.length === 0) return result;
      return { ...result, data: { ...result.data, itemList: [...result.data.itemList, ...itemListRemote] } };
    },
    itemGet: (store, itemId, versionId = 'head') => (isRemote(itemId)
      ? remote().versionListGet([{ itemId, versionId }]).then((answerList) => answerList[0])
      : base.itemGet(store, itemId, versionId)),
    itemGetList: async (store, requestList) => {
      const indexRemoteList = [];
      const indexBaseList = [];
      requestList.forEach((request, index) => (isRemote(request.itemId) ? indexRemoteList : indexBaseList).push(index));
      if (indexRemoteList.length === 0) return base.itemGetList(store, requestList);
      const answerList = new Array(requestList.length);
      const [answerRemoteList, resultBase] = await Promise.all([
        remote().versionListGet(indexRemoteList.map((index) => requestList[index])),
        indexBaseList.length > 0 ? base.itemGetList(store, indexBaseList.map((index) => requestList[index])) : Promise.resolve({ code: 0, data: { answerList: [] }, message: '' }),
      ]);
      indexRemoteList.forEach((index, position) => { answerList[index] = answerRemoteList[position]; });
      indexBaseList.forEach((index, position) => {
        answerList[index] = resultBase.code === 0 ? resultBase.data.answerList[position] : { code: resultBase.code, data: null, message: resultBase.message };
      });
      return { code: 0, data: { answerList }, message: '' };
    },
    dataUrlGet: (store, itemId, versionId = 'head') => (isRemote(itemId) ? remote().dataUrlGet(itemId, versionId) : base.dataUrlGet(store, itemId, versionId)),
    itemCreate: (input) => baseWrite(() => base.itemCreate(input)),
    itemUpdate: (input) => itemWrite(input.itemId, 'itemUpdate', {
      hashBase: input.hashBase, mode: input.mode, note: input.note, dependencyList: input.dependencyList, versionMetadata: input.versionMetadata, ...dataOf(input),
    }, () => base.itemUpdate(input)),
    testCaseResultSet: (input) => (isRemote(input.itemId)
      ? refuse('a test result is not recorded into an item held by a storage point of the page yet')
      : baseWrite(() => base.testCaseResultSet(input))),
    itemDelete: (store, itemId) => itemWrite(itemId, 'itemDelete', {}, () => base.itemDelete(store, itemId)),
    itemRestore: (store, itemId) => itemWrite(itemId, 'itemRestore', {}, () => base.itemRestore(store, itemId)),
    itemMetaSet: (store, itemId, change) => {
      if (!isRemote(itemId)) return baseWrite(() => base.itemMetaSet(store, itemId, change));
      // an item of a point has no name of the store: people name it in its record
      if (change.name) return refuse('an item held by a storage point of the page has no name of the store: name it as an asset of its object');
      const { name: _name, ...changeOfPoint } = change;
      return remote().itemCall(itemId, 'itemMetaSet', changeOfPoint);
    },
    versionCheckout: (store, itemId, versionId) => itemWrite(itemId, 'versionCheckout', { versionId }, () => base.versionCheckout(store, itemId, versionId)),
    versionDelete: (store, itemId, versionId) => itemWrite(itemId, 'versionDelete', { versionId }, () => base.versionDelete(store, itemId, versionId)),
    versionMetadataSet: (store, itemId, versionId, versionMetadata) => itemWrite(itemId, 'versionMetadataSet', { versionId, versionMetadata }, () => base.versionMetadataSet(store, itemId, versionId, versionMetadata)),
    itemLockSet: (store, itemId, isLocked) => itemWrite(itemId, 'itemLockSet', { isLocked }, () => base.itemLockSet(store, itemId, isLocked)),
    versionLockSet: (store, itemId, versionId, isLocked) => itemWrite(itemId, 'versionLockSet', { versionId, isLocked }, () => base.versionLockSet(store, itemId, versionId, isLocked)),
    // the dependencies of a version travel with the metadata of its item
    dependencyListGet: (store, itemId, versionId = 'head') => {
      if (!isRemote(itemId)) return base.dependencyListGet(store, itemId, versionId);
      const item = remote().itemList.find((one) => one.itemId === itemId);
      const versionIdResolved = versionId === 'head' || versionId === '' ? item.versionIdHead : versionId;
      const version = item.versionList.find((one) => one.versionId === versionIdResolved);
      return Promise.resolve(version
        ? { code: 0, data: { versionId: versionIdResolved, dependencyList: version.dependencyList ?? [] }, message: '' }
        : { code: -3, data: null, message: `version ${versionIdResolved} not found in item ${itemId}` });
    },
    // base knows the items it holds; what depends on an item of a point from another point is not asked
    dependentListGet: (store, itemId, versionId = '') => (isRemote(itemId)
      ? Promise.resolve({ code: 0, data: { dependentList: [] }, message: '' })
      : base.dependentListGet(store, itemId, versionId)),
    dependencyListSet: (store, itemId, versionId, dependencyList) => itemWrite(itemId, 'dependencyListSet', { versionId, dependencyList }, () => base.dependencyListSet(store, itemId, versionId, dependencyList)),
    dependencyAdd: (store, itemId, versionId, dependency) => itemWrite(itemId, 'dependencyAdd', { versionId, dependency }, () => base.dependencyAdd(store, itemId, versionId, dependency)),
    dependencyRemove: (store, itemId, versionId, dependency) => itemWrite(itemId, 'dependencyRemove', { versionId, dependency }, () => base.dependencyRemove(store, itemId, versionId, dependency)),
    folderSet: (configFile, folderList, folderDefault) => baseWrite(() => base.folderSet(configFile, folderList, folderDefault)),
    itemMove: (store, itemId, place) => (isRemote(itemId)
      ? refuse('an item held by a storage point of the page is moved by its object')
      : baseWrite(() => base.itemMove(store, itemId, place))),
    // a structural write of a frontend object: the page's own when it concerns a partition a
    // point of the page holds, else the development server's
    objectFrontendWrite: (route, body) => remote()?.objectFrontendWrite(route, body) ?? baseWrite(() => base.objectFrontendWrite(route, body)),
  };
}
