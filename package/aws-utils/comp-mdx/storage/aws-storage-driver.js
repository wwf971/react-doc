// The page driver of the storage type aws-utils.remote (contract: doc/storage-contract.md): how
// the item and partition api sets of the asset storage layer are asked of the storage service on
// AWS, over https with CORS, straight from the browser. One driver per storage point; the page
// half of the storage layer (react-doc: main/frontend/src/store/DocAssetRemoteStore.ts) holds what
// was read, the cache and the state, and calls the methods below.
//
// every method answers { code, message, data } and nothing else at the top level, with the codes
// of the contract; -9 is this driver's own: the service was not reached. an answer AWS gives
// itself (a 401 of the authorizer, a 429, a 413) is turned into that shape here.
//
//   point           the storage point as declared: config.url, config.space (absent: its id)
//   credentialGet   Promise<{ code, data: { token }, message }>: the access token of the session
//                   of the auth provider the point names

const CODE_AUTH_REQUIRED = -7;
const CODE_UNREACHABLE = -9;

// the routes of the writes that take { space, partitionId, ... } and answer as the contract says
const ROUTE_BY_METHOD = {
  partitionCreate: '/partition/create',
  partitionRename: '/partition/rename',
  partitionDelete: '/partition/delete',
  partitionRestore: '/partition/restore',
  itemMetaSet: '/item/meta/set',
  itemMove: '/item/move',
  itemDelete: '/item/delete',
  itemRestore: '/item/restore',
  itemLockSet: '/item/lock/set',
  itemRemove: '/item/remove',
  versionCheckout: '/version/checkout',
  versionDelete: '/version/delete',
  versionLockSet: '/version/lock/set',
  dependencyListSet: '/dependency/set',
  dependencyAdd: '/dependency/add',
  dependencyRemove: '/dependency/remove',
  groupMove: '/group/move',
  recordSet: '/record/set',
  recordRemove: '/record/remove',
  recordOrderSet: '/record/order/set',
  spaceEnsure: '/space/ensure',
  spaceMetaSet: '/space/meta/set',
  spaceDelete: '/space/delete',
};

export function awsStorageDriverCreate({ point, credentialGet }) {
  const url = String(point?.config?.url ?? '').replace(/\/+$/, '');
  const space = String(point?.config?.space || point?.id || '');
  const label = point?.label || point?.id || url;
  let statusPromise;

  // one request: GET with a query string, POST with a json body. isPublic: no token is sent
  const request = async (method, route, args = {}, { isPublic = false } = {}) => {
    const headerMap = {};
    if (!isPublic) {
      const credential = await credentialGet();
      if (credential.code !== 0) return { code: credential.code, data: null, message: credential.message };
      headerMap.Authorization = `Bearer ${credential.data.token}`;
    }
    let target = `${url}${route}`;
    const init = { method, headers: headerMap, cache: 'no-store' };
    if (method === 'GET') {
      const query = Object.entries(args).filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
      if (query) target += `?${query}`;
    } else {
      headerMap['Content-Type'] = 'application/json';
      init.body = JSON.stringify(args);
    }
    let response;
    try {
      response = await fetch(target, init);
    } catch (error) {
      return { code: CODE_UNREACHABLE, data: null, message: `the storage service of ${label} was not reached (${String(error?.message ?? error)})` };
    }
    const payload = await response.json().catch(() => undefined);
    if (!payload || typeof payload.code !== 'number') {
      // an answer AWS gave itself, before the code of the service ran: turned into the one shape by its status
      // (doc/storage-contract.md#requests)
      if (response.status === 401) return { code: CODE_AUTH_REQUIRED, message: `the storage service of ${label} did not accept the session: sign in again`, data: null };
      if (response.status === 403) return { code: -8, message: `the storage service of ${label} refused the request`, data: null };
      if (response.status === 429) return { code: -10, message: `the storage service of ${label} is asked too often: wait a while and try again`, data: null };
      if (response.status === 413) return { code: -10, message: `the request is larger than the storage service of ${label} takes`, data: null };
      return { code: -1, message: `the storage service of ${label} answered ${response.status} without a result`, data: null };
    }
    return { code: payload.code, message: String(payload.message ?? ''), data: payload.data ?? null };
  };
  const get = (route, args, options) => request('GET', route, args, options);
  const post = (route, args) => request('POST', route, { space, ...args });

  // what the service says of itself, asked once: its limits decide how data travels
  const statusGet = () => {
    if (!statusPromise) {
      statusPromise = get('/status', {}, { isPublic: true }).then((result) => {
        if (result.code !== 0) statusPromise = undefined;
        return result;
      });
    }
    return statusPromise;
  };
  const dataInlineMaxGet = async () => {
    const status = await statusGet();
    const max = Number(status.data?.limit?.dataInlineMax);
    return Number.isFinite(max) && max > 0 ? max : 256 * 1024;
  };

  // the data of a version as the service takes it: inline while small, through an upload when not
  //   input   { text } or { bytes }
  const dataSend = async (partitionId, input, contentType) => {
    const bytes = input.bytes ?? new TextEncoder().encode(String(input.text ?? ''));
    if (bytes.length <= await dataInlineMaxGet()) {
      return { code: 0, data: input.bytes ? { dataBase64: bytesToBase64(bytes) } : { text: String(input.text ?? '') } };
    }
    const begun = await post('/data/upload/begin', { partitionId, size: bytes.length, contentType });
    if (begun.code !== 0) return begun;
    try {
      const response = await fetch(begun.data.url, { method: begun.data.method ?? 'PUT', headers: begun.data.headerMap ?? {}, body: bytes });
      if (!response.ok) return { code: -1, data: null, message: `the upload of ${bytes.length} bytes was refused (${response.status})` };
    } catch (error) {
      return { code: CODE_UNREACHABLE, data: null, message: `the upload was not sent (${String(error?.message ?? error)})` };
    }
    return { code: 0, data: { uploadId: begun.data.uploadId } };
  };

  // a version as the page takes it: text when it is text, bytes otherwise, whatever way it came
  const versionRead = async (version) => {
    if (!version) return version;
    const { dataBase64, dataUrl, ...rest } = version;
    if (rest.isText && typeof rest.text === 'string') return rest;
    let bytes;
    if (typeof dataBase64 === 'string') bytes = base64ToBytes(dataBase64);
    else if (dataUrl) {
      const response = await fetch(dataUrl);
      if (!response.ok) throw new Error(`the bytes of version ${version.versionId} were not read (${response.status})`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (rest.isText) return { ...rest, text: bytes ? new TextDecoder().decode(bytes) : '' };
    return { ...rest, bytes: bytes ?? new Uint8Array(0) };
  };
  const answerRead = async (result) => {
    if (result.code !== 0 || !result.data?.version) return result;
    try {
      return { ...result, data: { ...result.data, version: await versionRead(result.data.version) } };
    } catch (error) {
      return { code: CODE_UNREACHABLE, data: null, message: String(error?.message ?? error) };
    }
  };

  // a write carrying the data of one version: item/create, item/update. the service answers the
  // version without its data (the writer has it), so what was sent is put back into the answer
  const dataWrite = async (route, { text, bytes, partitionId, ...args }) => {
    const sent = await dataSend(partitionId, { text, bytes }, args.contentType);
    if (sent.code !== 0) return sent;
    const result = await answerRead(await post(route, { partitionId, ...args, ...sent.data }));
    const version = result.code === 0 ? result.data?.version : undefined;
    if (!version) return result;
    const isDataAnswered = version.isText ? typeof version.text === 'string' && (version.text !== '' || version.size === 0) : version.bytes?.length === version.size;
    if (isDataAnswered) return result;
    const bytesSent = bytes ?? new TextEncoder().encode(String(text ?? ''));
    const versionFilled = version.isText
      ? { ...version, text: bytes ? new TextDecoder().decode(bytes) : String(text ?? '') }
      : { ...version, bytes: bytesSent };
    return { ...result, data: { ...result.data, version: versionFilled } };
  };

  const driver = {
    typeId: 'aws-utils.remote',
    space,
    statusGet,
    accountGet: () => get('/account'),
    spaceList: () => get('/space/list'),
    spaceGet: () => get('/space/get', { space }),
    partitionList: () => get('/partition/list', { space }),
    partitionGet: ({ partitionId, revisionKnown }) => get('/partition/get', { space, partitionId, revisionKnown }),
    itemGetList: async ({ partitionId, requestList }) => {
      const result = await post('/item/get/list', { partitionId, requestList });
      if (result.code !== 0) return result;
      const answerList = await Promise.all((result.data?.answerList ?? []).map((answer) => answerRead(answer)));
      return { code: 0, data: { answerList }, message: '' };
    },
    itemCreate: (args) => dataWrite('/item/create', args),
    itemUpdate: (args) => dataWrite('/item/update', args),
    versionMetadataSet: async (args) => answerRead(await post('/version/metadata/set', args)),
    // an item with the history it is given: every version sent as its size asks
    itemImport: async ({ partitionId, item, versionList, record, ...args }) => {
      const versionSentList = [];
      for (const version of versionList ?? []) {
        const sent = await dataSend(partitionId, version.isText === false || version.bytes ? { bytes: version.bytes } : { text: version.text }, item?.contentType);
        if (sent.code !== 0) return sent;
        versionSentList.push({ versionId: version.versionId, metadata: version.metadata ?? {}, ...sent.data });
      }
      return post('/item/import', { partitionId, item, versionList: versionSentList, ...(record ? { record } : {}), ...args });
    },
  };
  for (const [method, route] of Object.entries(ROUTE_BY_METHOD)) driver[method] = (args) => post(route, args);
  return driver;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 ?? ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
