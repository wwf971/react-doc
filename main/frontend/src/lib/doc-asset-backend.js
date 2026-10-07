// Backends of the asset store in the browser (design: doc_page_impl_asset.md).
// DocAssetStore talks to one backend; every backend answers the same calls
// with { code, data, message } (code 0 success, negative failure), so the
// store and the ui do not know where the objects live:
//
//   assetBackendApiCreate(endpoint)        the asset api of the development
//                                          server (plugin/doc-asset-server.ts):
//                                          reads and writes the folder on disk
//   assetBackendSnapshotCreate(snapshot)   the store bundled into a build by
//                                          the vite plugin: read-only
//
// a further backend (a remote object storage) implements the same calls.
//
//   statusGet()                        { isWritable }
//   objectList()                       { objectList }
//   objectGet(objectId, versionId)     { object, version: { versionId, text, hash } }
//   objectCreate({ name, lang, text, note })
//   objectUpdate({ objectId, hashBase, text, mode, note })
//   objectDelete(objectId) / objectRestore(objectId)
//   objectMetaSet(objectId, { name, lang })
//   versionCheckout(objectId, versionId)
//   versionDelete(objectId, versionId)

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

  return {
    kind: 'api',
    statusGet: () => requestSend('/status'),
    objectList: () => requestSend('/object/list'),
    objectGet: (objectId, versionId = 'head') => requestSend(
      `/object/get?objectId=${encodeURIComponent(objectId)}&versionId=${encodeURIComponent(versionId)}`,
    ),
    objectCreate: (input) => requestPost('/object/create', input),
    objectUpdate: (input) => requestPost('/object/update', input),
    objectDelete: (objectId) => requestPost('/object/delete', { objectId }),
    objectRestore: (objectId) => requestPost('/object/restore', { objectId }),
    objectMetaSet: (objectId, change) => requestPost('/object/meta/set', { objectId, ...change }),
    versionCheckout: (objectId, versionId) => requestPost('/version/checkout', { objectId, versionId }),
    versionDelete: (objectId, versionId) => requestPost('/version/delete', { objectId, versionId }),
  };
}

// snapshot: { objectById: { [objectId]: { ...object, textByVersionId } } }
export function assetBackendSnapshotCreate(snapshot) {
  const objectById = snapshot?.objectById ?? {};
  const readOnly = () => Promise.resolve({ code: -1, data: null, message: 'the asset store of a built page is read-only' });
  const objectMetaGet = (objectId) => {
    const entry = objectById[objectId];
    if (!entry) return undefined;
    const { textByVersionId: _text, ...object } = entry;
    return object;
  };

  return {
    kind: 'snapshot',
    statusGet: () => Promise.resolve({ code: 0, data: { isWritable: false }, message: '' }),
    objectList: () => Promise.resolve({
      code: 0,
      data: { objectList: Object.keys(objectById).map(objectMetaGet) },
      message: '',
    }),
    objectGet: (objectId, versionIdRequested = 'head') => {
      const entry = objectById[objectId];
      if (!entry) return Promise.resolve({ code: -3, data: null, message: `asset object not found: ${objectId}` });
      const versionId = versionIdRequested === '' || versionIdRequested === 'head' ? entry.versionIdHead : versionIdRequested;
      const text = entry.textByVersionId[versionId];
      if (text === undefined) {
        return Promise.resolve({ code: -3, data: null, message: `version ${versionId} not found in object ${objectId}` });
      }
      return Promise.resolve({
        code: 0,
        data: { object: objectMetaGet(objectId), version: { versionId, text, hash: '' } },
        message: '',
      });
    },
    objectCreate: readOnly,
    objectUpdate: readOnly,
    objectDelete: readOnly,
    objectRestore: readOnly,
    objectMetaSet: readOnly,
    versionCheckout: readOnly,
    versionDelete: readOnly,
  };
}
