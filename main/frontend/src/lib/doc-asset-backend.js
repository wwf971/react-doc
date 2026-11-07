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
// a further backend (a remote object storage) implements the same calls.
// every item call names the store (the id written in a reference).
//
//   statusGet()                                 { isWritable, storeIdList, folderList }
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
    statusGet: () => Promise.resolve({ code: 0, data: { isWritable: false, storeIdList: [storeIdLocal], folderList: [] }, message: '' }),
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
