// Backends of the asset store in the browser (design: doc_page_impl_asset.md).
// DocAssetStore talks to one backend; every backend answers the same calls
// with { code, data, message } (code 0 success, negative failure), so the
// store and the ui do not know where the objects live:
//
//   assetBackendApiCreate(endpoint)        the asset api of the development
//                                          server (plugin/doc-asset-server.ts):
//                                          reads and writes the folders on disk
//   assetBackendSnapshotCreate(snapshot)   the store bundled into a build by
//                                          the vite plugin: read-only
//
// a further backend (a remote object storage) implements the same calls.
// every object call names the store (the id written in a reference).
//
//   statusGet()                                 { isWritable, storeIdList, folderList }
//   objectList(store)                           { objectList }
//   objectGet(store, objectId, versionId)       { object, version: { versionId, size, hash, isText, text?, metadata } }
//                                               metadata: the version's metadata mapping ({} when none)
//   objectGetByName(store, name, versionId)     the same, the object found by its name
//   dataUrlGet(store, objectId, versionId)      the url the bytes of a version are read from ('' when none)
//   objectCreate({ store, name, lang, contentType, fileExt, text | dataBase64, note, folder, dependencyList,
//                  saveMode, versionMetadata })
//                                               { object, version, isCreated }; isCreated false when an
//                                               object of that name exists: it is answered, nothing is created
//   objectUpdate({ store, objectId, hashBase, text | dataBase64, mode, note, dependencyList, versionMetadata })
//   versionMetadataSet(store, objectId, versionId, versionMetadata)  { object, version }
//   dependencyListGet(store, objectId, versionId)      { versionId, dependencyList }
//   dependentListGet(store, objectId, versionId)       { dependentList }   versionId '' for the whole object
//   dependencyListSet(store, objectId, versionId, dependencyList)   { object }
//   dependencyAdd(store, objectId, versionId, dependency)           { object }
//   dependencyRemove(store, objectId, versionId, dependency)        { object }
//   objectDelete(store, objectId) / objectRestore(store, objectId)
//   objectMetaSet(store, objectId, { name, lang, contentType, saveMode, component })
//   usageList(docPathList)                      { docList: [{ docPath, contentHash, usageList }] }
//                                               the asset references of the documents (all when the
//                                               list is empty; doc_page_impl_asset.md#usage)
//   versionCheckout(store, objectId, versionId)
//   versionDelete(store, objectId, versionId)
//   objectLockSet(store, objectId, isLocked)
//   versionLockSet(store, objectId, versionId, isLocked)
//   folderSet(folderList)                       { folderList }   the folders of the local store

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
  const objectQueryBuild = (store, objectId, versionId) => (
    `store=${encodeURIComponent(store)}&objectId=${encodeURIComponent(objectId)}&versionId=${encodeURIComponent(versionId)}`
  );

  return {
    kind: 'api',
    statusGet: () => requestSend('/status'),
    objectList: (store) => requestSend(`/object/list?store=${encodeURIComponent(store)}`),
    objectGet: (store, objectId, versionId = 'head') => requestSend(`/object/get?${objectQueryBuild(store, objectId, versionId)}`),
    objectGetByName: (store, name, versionId = 'head') => requestSend(
      `/object/get?store=${encodeURIComponent(store)}&name=${encodeURIComponent(name)}&versionId=${encodeURIComponent(versionId)}`,
    ),
    dataUrlGet: (store, objectId, versionId = 'head') => `${endpointNormalized}/object/data?${objectQueryBuild(store, objectId, versionId)}`,
    objectCreate: (input) => requestPost('/object/create', input),
    objectUpdate: (input) => requestPost('/object/update', input),
    objectDelete: (store, objectId) => requestPost('/object/delete', { store, objectId }),
    objectRestore: (store, objectId) => requestPost('/object/restore', { store, objectId }),
    objectMetaSet: (store, objectId, change) => requestPost('/object/meta/set', { store, objectId, ...change }),
    versionCheckout: (store, objectId, versionId) => requestPost('/version/checkout', { store, objectId, versionId }),
    versionDelete: (store, objectId, versionId) => requestPost('/version/delete', { store, objectId, versionId }),
    versionMetadataSet: (store, objectId, versionId, versionMetadata) => requestPost('/version/metadata/set', { store, objectId, versionId, versionMetadata }),
    objectLockSet: (store, objectId, isLocked) => requestPost('/object/lock/set', { store, objectId, isLocked }),
    versionLockSet: (store, objectId, versionId, isLocked) => requestPost('/version/lock/set', { store, objectId, versionId, isLocked }),
    dependencyListGet: (store, objectId, versionId = 'head') => requestSend(`/dependency/list?${objectQueryBuild(store, objectId, versionId)}`),
    dependentListGet: (store, objectId, versionId = '') => requestSend(`/dependent/list?${objectQueryBuild(store, objectId, versionId)}`),
    dependencyListSet: (store, objectId, versionId, dependencyList) => requestPost('/dependency/set', { store, objectId, versionId, dependencyList }),
    dependencyAdd: (store, objectId, versionId, dependency) => requestPost('/dependency/add', { store, objectId, versionId, dependency }),
    dependencyRemove: (store, objectId, versionId, dependency) => requestPost('/dependency/remove', { store, objectId, versionId, dependency }),
    folderSet: (folderList) => requestPost('/folder/set', { folderList }),
    usageList: (docPathList = []) => requestSend(
      `/usage/list${docPathList.length > 0 ? `?${docPathList.map((docPath) => `docPath=${encodeURIComponent(docPath)}`).join('&')}` : ''}`,
    ),
  };
}

// snapshot: { objectById: { [objectId]: { ...object, versionDataById:
// { [versionId]: { size, hash, isText, text | dataBase64, metadata } } } } },
// usageDocList }, the local store as it was at build time, with the asset
// references of the documents of the build
export function assetBackendSnapshotCreate(snapshot, storeIdLocal = 'local') {
  const objectById = snapshot?.objectById ?? {};
  const usageDocList = Array.isArray(snapshot?.usageDocList) ? snapshot.usageDocList : [];
  const readOnly = () => Promise.resolve({ code: -1, data: null, message: 'the asset store of a built page is read-only' });
  const objectMetaGet = (objectId) => {
    const entry = objectById[objectId];
    if (!entry) return undefined;
    const { versionDataById: _versionData, ...object } = entry;
    return object;
  };
  const storeCheck = (store) => (
    store === storeIdLocal ? undefined : { code: -3, data: null, message: `unknown asset store: ${store}` }
  );
  const versionResolve = (store, objectId, versionIdRequested) => {
    const failureStore = storeCheck(store);
    if (failureStore) return { failure: failureStore };
    const entry = objectById[objectId];
    if (!entry) return { failure: { code: -3, data: null, message: `asset object not found: ${objectId}` } };
    const versionId = versionIdRequested === '' || versionIdRequested === 'head' ? entry.versionIdHead : versionIdRequested;
    const versionData = entry.versionDataById[versionId];
    if (!versionData) return { failure: { code: -3, data: null, message: `version ${versionId} not found in object ${objectId}` } };
    return { entry, versionId, versionData };
  };
  // the dependencies are part of the version metadata the snapshot carries
  const dependencyListGet = (store, objectId, versionIdRequested = 'head') => {
    const resolved = versionResolve(store, objectId, versionIdRequested);
    if (resolved.failure) return Promise.resolve(resolved.failure);
    const versionMeta = resolved.entry.versionList.find((version) => version.versionId === resolved.versionId);
    return Promise.resolve({ code: 0, data: { versionId: resolved.versionId, dependencyList: versionMeta?.dependencyList ?? [] }, message: '' });
  };
  const dependentListGet = (store, objectId, versionIdRequested = '') => {
    const failureStore = storeCheck(store);
    if (failureStore) return Promise.resolve(failureStore);
    const entryTarget = objectById[objectId];
    if (!entryTarget) return Promise.resolve({ code: -3, data: null, message: `asset object not found: ${objectId}` });
    const versionIdWanted = versionIdRequested === '' ? '' : (versionIdRequested === 'head' ? entryTarget.versionIdHead : versionIdRequested);
    const dependentList = [];
    for (const entry of Object.values(objectById)) {
      for (const version of entry.versionList) {
        for (const dependency of version.dependencyList ?? []) {
          if (dependency.type !== 'asset' || dependency.objectId !== objectId) continue;
          const versionIdDepended = dependency.versionId ?? entryTarget.versionIdHead;
          if (versionIdWanted !== '' && versionIdDepended !== versionIdWanted) continue;
          dependentList.push({ objectId: entry.objectId, versionId: version.versionId, dependency });
        }
      }
    }
    return Promise.resolve({ code: 0, data: { dependentList }, message: '' });
  };
  const objectGet = (store, objectId, versionIdRequested = 'head') => {
    const resolved = versionResolve(store, objectId, versionIdRequested);
    if (resolved.failure) return Promise.resolve(resolved.failure);
    const { versionId, versionData } = resolved;
    const version = { versionId, size: versionData.size, hash: versionData.hash, isText: versionData.isText, metadata: versionData.metadata ?? {} };
    if (versionData.isText) version.text = versionData.text;
    return Promise.resolve({ code: 0, data: { object: objectMetaGet(objectId), version }, message: '' });
  };

  return {
    kind: 'snapshot',
    statusGet: () => Promise.resolve({ code: 0, data: { isWritable: false, storeIdList: [storeIdLocal], folderList: [] }, message: '' }),
    objectList: (store) => Promise.resolve(storeCheck(store) ?? {
      code: 0,
      data: { objectList: Object.keys(objectById).map(objectMetaGet) },
      message: '',
    }),
    objectGet,
    objectGetByName: (store, name, versionIdRequested = 'head') => {
      const failureStore = storeCheck(store);
      if (failureStore) return Promise.resolve(failureStore);
      const entry = Object.values(objectById).find((item) => item.name === name);
      if (!entry) return Promise.resolve({ code: -3, data: null, message: `asset object not found by name: ${name}` });
      return objectGet(store, entry.objectId, versionIdRequested);
    },
    // the bytes of a binary version as a data url; a text version has no url of its own
    dataUrlGet: (store, objectId, versionIdRequested = 'head') => {
      const resolved = versionResolve(store, objectId, versionIdRequested);
      if (resolved.failure || resolved.versionData.isText) return '';
      return `data:${resolved.entry.contentType || 'application/octet-stream'};base64,${resolved.versionData.dataBase64}`;
    },
    objectCreate: readOnly,
    objectUpdate: readOnly,
    objectDelete: readOnly,
    objectRestore: readOnly,
    objectMetaSet: readOnly,
    versionCheckout: readOnly,
    versionDelete: readOnly,
    versionMetadataSet: readOnly,
    objectLockSet: readOnly,
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
