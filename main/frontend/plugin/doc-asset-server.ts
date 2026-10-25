import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ASSET_STORE_ID_LOCAL, AssetError, type AssetObjectKey, type AssetStore, type AssetUsageDoc, type AssetVersionData,
} from './doc-asset-store.ts';

// Asset api of the development server (design: doc_page_impl_asset.md). Like
// the edit api, it exists only while `vite` serves the page; a built page
// reads the bundled snapshot of the store instead and cannot write. The api
// serves the local store; every object route names the store it means
// (store=local), the way a reference does.
//
//   GET  {endpoint}/status                                   -> { isWritable: true, storeIdList, folderList, docPageList }
//   GET  {endpoint}/object/list?store=                        -> { objectList }
//   GET  {endpoint}/object/get?store=&objectId=|name=&versionId=  -> { object, version }   versionId default head
//   GET  {endpoint}/object/data?store=&objectId=|name=&versionId= -> the bytes of the version, with their content type
//   GET  {endpoint}/dependency/list?store=&objectId=&versionId=   -> { versionId, dependencyList }   versionId default head
//   GET  {endpoint}/dependent/list?store=&objectId=&versionId=    -> { dependentList }   the versions depending on the
//                                                                    object (with versionId: on that version)
//   GET  {endpoint}/usage/list?docPath=&docPath=               -> { docList: [{ docPath, contentHash, usageList }] }
//                                     the asset references of the collected documents, read from disk now; with
//                                     docPath (repeatable) only those documents (a document that is gone is absent)
//   POST {endpoint}/object/create    { store, name, lang, contentType, fileExt, text | dataBase64, note, folder | docPath, dependencyList,
//                                       saveMode, versionMetadata, component }  -> { object, version, isCreated }
//                                     isCreated false: an object of that name exists and is answered, nothing is created
//   POST {endpoint}/object/update    { store, objectId, hashBase, text | dataBase64, mode, note, dependencyList, versionMetadata }
//                                                                 -> { object, version }
//                                     mode: inPlace | newVersion; absent: the object's saveMode
//                                     dependencyList, versionMetadata absent: those of the version written over / made from are kept
//   POST {endpoint}/version/metadata/set { store, objectId, versionId, versionMetadata } -> { object, version }
//   POST {endpoint}/dependency/set    { store, objectId, versionId, dependencyList }  -> { object }
//   POST {endpoint}/dependency/add    { store, objectId, versionId, dependency }      -> { object }
//   POST {endpoint}/dependency/remove { store, objectId, versionId, dependency }      -> { object }
//   POST {endpoint}/object/delete    { store, objectId }                                 -> { object }   (soft)
//   POST {endpoint}/object/restore   { store, objectId }                                 -> { object }
//   POST {endpoint}/object/meta/set  { store, objectId, name?, lang?, contentType?, saveMode?, component? } -> { object }
//                                     component: { name }, or null to remove it
//   POST {endpoint}/version/checkout { store, objectId, versionId }                      -> { object }   head moves
//   POST {endpoint}/version/delete   { store, objectId, versionId }                      -> { object }
//   POST {endpoint}/object/lock/set  { store, objectId, isLocked }                       -> { object }
//   POST {endpoint}/version/lock/set { store, objectId, versionId, isLocked }            -> { object }
//   POST {endpoint}/folder/set       { configFile, folderList: [~root/path | ~page:root/path], folderDefault } -> { ok }
//                                     the folders of one doc page, written into its asset store config in place
//
// every json response is { code, data, message }. code 0 is success; negative codes:
//   -1  bad request or unexpected failure
//   -2  hashBase is not the hash of the head data (changed meanwhile)
//   -3  store, object or version not found
//
// object:  { objectId, name, lang, contentType, fileExt, component?, saveMode?, versionIdHead, isDeleted, isLocked,
//            timeCreated, folder, dirName,
//            versionList: [{ versionId, versionIdPrevList, time, note, size, hash, isLocked, dependencyList }],
//            eventList: [{ eventType, time, versionId?, userId? }] }
// dependency: { type: source, path } | { type: asset, objectId, versionId? }   (doc_page_impl_asset.md#dependencies)
// dependent:  { objectId, versionId, dependency }
// version: { versionId, size, hash, isText, text?, metadata }   text only when the bytes are utf-8 text;
//          metadata: the mapping of {versionId}.metadata.yaml, {} when the version has none
// folder:  { path (~page:root/path), pathAbs, isDefault, docEntryFile, isExists, objectCount }
// docPage: { alias, entryFile, configFileRelative, isConfigFileExists, folderList, folderDefault, rootPathList, problemList }

export const DOC_ASSET_ENDPOINT_NAME = '__doc-asset';

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

// usageScan(docPathList): the asset references of the documents named, or
// of every collected document when the list is empty; the documents are a
// matter of the doc page source service layer, which the plugin passes in
// rootAbsPathByPathGet: the roots of the source rules by their full path
// (~page:root), which name the asset folders
export function docAssetMiddlewareCreate(options: {
  endpoint: string;
  storeGet: () => AssetStore;
  rootAbsPathByPathGet: () => Map<string, string>;
  usageScan: (docPathList: string[]) => AssetUsageDoc[];
}): Middleware {
  const { endpoint, storeGet, rootAbsPathByPathGet, usageScan } = options;
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== endpoint && !url.pathname.startsWith(`${endpoint}/`)) {
      next();
      return;
    }
    const route = url.pathname.slice(endpoint.length);
    const failureSend = (error: any) => {
      if (error instanceof AssetError) {
        jsonSend(res, statusByCode[error.code] ?? 400, { code: error.code, data: null, message: error.message });
        return;
      }
      jsonSend(res, 500, { code: -1, data: null, message: String(error?.message ?? error) });
    };
    if (req.method === 'GET' && route === '/object/data') {
      try {
        const store = storeGet();
        const object = store.objectFind(storeObjectKeyGet(url.searchParams));
        const version = store.versionDataGetOf(object, url.searchParams.get('versionId') ?? 'head');
        res.statusCode = 200;
        res.setHeader('Content-Type', object.contentType || 'application/octet-stream');
        res.setHeader('Content-Length', String(version.size));
        res.setHeader('Cache-Control', 'no-store');
        res.end(version.bytes);
      } catch (error) {
        failureSend(error);
      }
      return;
    }
    if (req.method === 'GET' && route === '/usage/list') {
      try {
        jsonSend(res, 200, { code: 0, data: { docList: usageScan(url.searchParams.getAll('docPath')) }, message: '' });
      } catch (error) {
        failureSend(error);
      }
      return;
    }
    void routeHandle(req, route, url, storeGet(), rootAbsPathByPathGet)
      .then((data) => jsonSend(res, 200, { code: 0, data, message: '' }))
      .catch(failureSend);
  };
}

const statusByCode: Record<number, number> = { [-1]: 400, [-2]: 409, [-3]: 404 };

// the data of the answer, or an AssetError
async function routeHandle(
  req: IncomingMessage,
  route: string,
  url: URL,
  store: AssetStore,
  rootAbsPathByPathGet: () => Map<string, string>,
): Promise<any> {
  const method = req.method ?? 'GET';
  if (method === 'GET') {
    if (route === '/status') {
      return { isWritable: true, storeIdList: [ASSET_STORE_ID_LOCAL], folderList: store.folderInfoList(), docPageList: store.docPageInfoList() };
    }
    if (route === '/object/list') {
      storeIdCheck(url.searchParams.get('store'));
      return { objectList: store.objectList() };
    }
    if (route === '/object/get') {
      const object = store.objectFind(storeObjectKeyGet(url.searchParams));
      const version = store.versionDataGetOf(object, url.searchParams.get('versionId') ?? 'head');
      return { object, version: versionResponseBuild(version) };
    }
    if (route === '/dependency/list') {
      const object = store.objectFind(storeObjectKeyGet(url.searchParams));
      return store.dependencyListGet(object.objectId, url.searchParams.get('versionId') ?? 'head');
    }
    if (route === '/dependent/list') {
      const object = store.objectFind(storeObjectKeyGet(url.searchParams));
      return { dependentList: store.dependentListGet(object.objectId, url.searchParams.get('versionId') ?? '') };
    }
  }
  if (method === 'POST') {
    const body = await jsonBodyRead(req);
    if (route === '/folder/set') {
      if (typeof body?.configFile !== 'string' || !Array.isArray(body?.folderList)) {
        throw new AssetError(-1, 'configFile and folderList are required');
      }
      store.folderSet(
        { configFile: body.configFile, folderList: body.folderList, folderDefault: body.folderDefault },
        rootAbsPathByPathGet(),
      );
      // the store as the file says now
      return { ok: true };
    }
    storeIdCheck(body?.store);
    const objectId = String(body?.objectId ?? '');
    if (route === '/object/create') {
      const result = store.objectCreate({
        name: body?.name,
        lang: body?.lang,
        contentType: body?.contentType,
        fileExt: body?.fileExt,
        data: bodyDataGet(body),
        note: body?.note,
        folder: body?.folder ? String(body.folder) : undefined,
        docPath: body?.docPath ? String(body.docPath) : undefined,
        dependencyList: body?.dependencyList,
        saveMode: body?.saveMode,
        versionMetadata: body?.versionMetadata,
        component: body?.component,
      });
      return { object: result.object, version: versionResponseBuild(result.version), isCreated: result.isCreated };
    }
    if (route === '/object/update') {
      const result = store.objectUpdate({
        objectId,
        hashBase: body?.hashBase,
        data: bodyDataGet(body),
        mode: body?.mode,
        note: body?.note,
        dependencyList: body?.dependencyList,
        versionMetadata: body?.versionMetadata,
      });
      return { object: result.object, version: versionResponseBuild(result.version) };
    }
    if (route === '/version/metadata/set') {
      const result = store.versionMetadataSet(objectId, String(body?.versionId ?? ''), body?.versionMetadata);
      return { object: result.object, version: versionResponseBuild(result.version) };
    }
    if (route === '/dependency/set') {
      return { object: store.dependencyListSet(objectId, String(body?.versionId ?? ''), body?.dependencyList) };
    }
    if (route === '/dependency/add') {
      return { object: store.dependencyAdd(objectId, String(body?.versionId ?? ''), body?.dependency) };
    }
    if (route === '/dependency/remove') {
      return { object: store.dependencyRemove(objectId, String(body?.versionId ?? ''), body?.dependency) };
    }
    if (route === '/object/delete') return { object: store.objectDelete(objectId) };
    if (route === '/object/restore') return { object: store.objectRestore(objectId) };
    if (route === '/object/meta/set') {
      return {
        object: store.objectMetaSet(objectId, {
          name: body?.name,
          lang: body?.lang,
          contentType: body?.contentType,
          saveMode: body?.saveMode,
          component: body?.component,
        }),
      };
    }
    if (route === '/version/checkout') return { object: store.versionCheckout(objectId, String(body?.versionId ?? '')) };
    if (route === '/version/delete') return { object: store.versionDelete(objectId, String(body?.versionId ?? '')) };
    if (route === '/object/lock/set') return { object: store.objectLockSet(objectId, body?.isLocked) };
    if (route === '/version/lock/set') {
      return { object: store.versionLockSet(objectId, String(body?.versionId ?? ''), body?.isLocked) };
    }
  }
  throw new AssetError(-1, `unknown asset api route: ${method} ${route}`);
}

// the api serves the local store only; a reference into another store is not found here
function storeIdCheck(storeId: unknown) {
  if (storeId === undefined || storeId === null || storeId === '') throw new AssetError(-1, 'store is required');
  if (storeId !== ASSET_STORE_ID_LOCAL) throw new AssetError(-3, `unknown asset store: ${String(storeId)}`);
}

// the object a read names: by objectId, or by name
function storeObjectKeyGet(searchParams: URLSearchParams): AssetObjectKey {
  storeIdCheck(searchParams.get('store'));
  return { objectId: searchParams.get('objectId') ?? '', name: searchParams.get('name') ?? '' };
}

// the data of a write: text (utf-8) or dataBase64 (any bytes)
function bodyDataGet(body: any): Buffer {
  if (typeof body?.text === 'string') return Buffer.from(body.text, 'utf-8');
  if (typeof body?.dataBase64 === 'string') return Buffer.from(body.dataBase64, 'base64');
  throw new AssetError(-1, 'text or dataBase64 is required');
}

// the version without its bytes; the bytes are read through /object/data
function versionResponseBuild(version: AssetVersionData) {
  return {
    versionId: version.versionId,
    size: version.size,
    hash: version.hash,
    isText: version.isText,
    ...(version.isText ? { text: version.text } : {}),
    metadata: version.metadata,
  };
}

function jsonBodyRead(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunkList: Buffer[] = [];
    req.on('data', (chunk) => chunkList.push(Buffer.from(chunk)));
    req.on('end', () => {
      const text = Buffer.concat(chunkList).toString('utf-8');
      if (text === '') {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new AssetError(-1, 'request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function jsonSend(res: ServerResponse, statusCode: number, payload: { code: number; data: any; message: string }) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}
