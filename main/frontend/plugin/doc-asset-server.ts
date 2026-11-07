import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ASSET_STORE_ID_LOCAL, AssetError, type AssetItemKey, type AssetStore, type AssetUsageDoc, type AssetVersionData,
  textDecodeTry,
} from './doc-asset-store.ts';
import { testCaseAssetResultSet, testCaseAssetWriteCheck } from '../../../built-in/comp-mdx/test-case-table/TestCaseTableApi.js';
import {
  objectFrontendAssetAttach, objectFrontendAssetGroupMove, objectFrontendPartitionCreate, objectFrontendPartitionDelete, objectFrontendPartitionRename, objectFrontendAssetMove, objectFrontendAssetCreate, objectFrontendAssetRemove, objectFrontendConfigForPage,
  objectFrontendAssetMetaSet, objectFrontendCreate, objectFrontendDelete, objectFrontendMetaSet, objectFrontendRegister, type ObjectFrontendConfig,
} from './doc-object-frontend.ts';

// Asset api of the development server (design: doc_page_impl_asset.md). Like
// the edit api, it exists only while `vite` serves the page; a built page
// reads the bundled snapshot of the store instead and cannot write. The api
// serves the local store; every item route names the store it means
// (store=local), the way a reference does.
//
//   GET  {endpoint}/status                                   -> { isWritable: true, storeIdList, folderList, docPageList }
//   GET  {endpoint}/item/list?store=                        -> { itemList }
//   GET  {endpoint}/item/get?store=&itemId=|name=&versionId=  -> { item, version }   versionId default head
//   POST {endpoint}/item/get/list  { store, requestList: [{ itemId, versionId }] } -> { answerList: [{ code, data, message }] }
//                                     many reads in one request, answered in that order; one that fails fails alone
//   GET  {endpoint}/item/data?store=&itemId=|name=&versionId= -> the bytes of the version, with their content type
//   GET  {endpoint}/dependency/list?store=&itemId=&versionId=   -> { versionId, dependencyList }   versionId default head
//   GET  {endpoint}/dependent/list?store=&itemId=&versionId=    -> { dependentList }   the versions depending on the
//                                                                    item (with versionId: on that version)
//   GET  {endpoint}/usage/list?docPath=&docPath=               -> { docList: [{ docPath, contentHash, usageList }] }
//                                     the asset references of the collected documents, read from disk now; with
//                                     docPath (repeatable) only those documents (a document that is gone is absent)
//   POST {endpoint}/item/create    { store, name, lang, contentType, fileExt, text | dataBase64, note, folder | docPath, dependencyList,
//                                       saveMode, versionMetadata, component, groupPath, owner }  -> { item, version, isCreated }
//                                     isCreated false: an item of that name exists and is answered, nothing is created
//   POST {endpoint}/item/update    { store, itemId, hashBase, text | dataBase64, mode, note, dependencyList, versionMetadata }
//                                                                 -> { item, version }
//                                     mode: inPlace | newVersion; absent: the item's saveMode
//                                     dependencyList, versionMetadata absent: those of the version written over / made from are kept
//                                     a text of a TestCaseTable whose result history differs from the head's is
//                                     refused (-1): the history is managed, written by /test-case/result/set only
//   POST {endpoint}/test-case/result/set { store, itemId, hashBase, docPath, caseId, testerId, operator, result,
//                                       timeTimezone?, evidence?, versionId? } -> { item, version }
//                                     one result appended to the history of a TestCaseTable item
//                                     (comp-mdx/test-case-table/TestCaseTableApi.js): the time and the id of the
//                                     entry are made here, evidence must name one md/mdx document of the doc page of
//                                     docPath (the document the block is in), and the write is the normal head
//                                     update (hashBase, locks, save mode); versionId other than head is refused
//   POST {endpoint}/version/metadata/set { store, itemId, versionId, versionMetadata } -> { item, version }
//   POST {endpoint}/dependency/set    { store, itemId, versionId, dependencyList }  -> { item }
//   POST {endpoint}/dependency/add    { store, itemId, versionId, dependency }      -> { item }
//   POST {endpoint}/dependency/remove { store, itemId, versionId, dependency }      -> { item }
//   POST {endpoint}/item/delete    { store, itemId }                                 -> { item }   (soft)
//   POST {endpoint}/item/restore   { store, itemId }                                 -> { item }
//   POST {endpoint}/item/meta/set  { store, itemId, name?, lang?, contentType?, saveMode?, component?, owner? } -> { item }
//                                     component: { name }, owner: { ref, role? }; null removes either
//   POST {endpoint}/version/checkout { store, itemId, versionId }                      -> { item }   head moves
//   POST {endpoint}/version/delete   { store, itemId, versionId }                      -> { item }
//   POST {endpoint}/item/lock/set  { store, itemId, isLocked }                       -> { item }
//   POST {endpoint}/version/lock/set { store, itemId, versionId, isLocked }            -> { item }
//   POST {endpoint}/folder/set       { configFile, folderList: [~root/path | ~page:root/path], folderDefault } -> { ok }
//                                     the folders of one doc page, written into its asset store config in place
//   POST {endpoint}/item/move      { store, itemId, groupPath, folder? }             -> { item }   -5: a folder an object owns
//                                     the item's folder moved into group folders of its store folder ('' the top)
//
// the frontend object service layer (doc_page_impl_obj_frontend.md, doc-object-frontend.ts), whose
// items keep their data in this store; every write answers { id, itemList, config }: the
// asset items it wrote, and the declarations of the doc pages as the files say now
//   GET  {endpoint}/object-frontend/config                       -> { docPageList }
//   POST {endpoint}/object-frontend/create       { docPageAlias, typeId, name, description?, metadata? }
//   POST {endpoint}/object-frontend/register     { docPageAlias, entry }        an orphan entry listed again
//   POST {endpoint}/object-frontend/delete       { id, isAssetKept? }
//   POST {endpoint}/object-frontend/meta/set     { id, name?, description?, typeId?, metadata? }
//   POST {endpoint}/object-frontend/asset/create { id, key?, kind?, name?, pathList?, lang?, text, note?, saveMode? }  (+ key, itemId)
//   POST {endpoint}/object-frontend/asset/meta/set { id, key, name?, pathList?, kind? }   how an asset is named and indexed
//   POST {endpoint}/object-frontend/asset/remove { id, key | itemId, isAssetKept? }
//   POST {endpoint}/object-frontend/asset/attach { id, itemId, key?, kind?, name?, pathList? }
//
// every json response is { code, data, message }. code 0 is success; negative codes:
//   -1  bad request or unexpected failure
//   -2  hashBase is not the hash of the head data (changed meanwhile)
//   -3  store, item or version not found
//   -4  the item or folder belongs to a read-only doc page (a package treated
//       as a doc page, doc_page_impl_package.md#a-package-as-a-doc-page)
//
// item:  { itemId, name, lang, contentType, fileExt, component?, owner?, saveMode?, versionIdHead, isDeleted, isLocked,
//            timeCreated, folder, dirName, groupPath,
//            versionList: [{ versionId, versionIdPrevList, time, note, size, hash, isLocked, dependencyList }],
//            eventList: [{ eventType, time, versionId?, userId? }] }
// dependency: { type: source, path } | { type: asset, itemId, versionId? }   (doc_page_impl_asset.md#dependencies)
// dependent:  { itemId, versionId, dependency }
// version: { versionId, size, hash, isText, text?, metadata }   text only when the bytes are utf-8 text;
//          metadata: the mapping of {versionId}.metadata.yaml, {} when the version has none
// folder:  { path (~page:root/path), pathAbs, isDefault, docEntryFile, isExists, itemCount }
// docPage: { alias, entryFile, configFileRelative, isConfigFileExists, folderList, folderDefault, rootPathList, problemList }

export const DOC_ASSET_ENDPOINT_NAME = '__doc-asset';

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

// usageScan(docPathList): the asset references of the documents named, or
// of every collected document when the list is empty; the documents are a
// matter of the doc page source service layer, which the plugin passes in
// rootAbsPathByPathGet: the roots of the source rules by their full path
// (~page:root), which name the asset folders
// fileEntryListGet: the collected files of the source ({ internalPath, name,
// ... }), what a document reference of a request (the evidence of a test
// result) is resolved against; absent: no reference resolves
export function docAssetMiddlewareCreate(options: {
  endpoint: string;
  storeGet: () => AssetStore;
  rootAbsPathByPathGet: () => Map<string, string>;
  usageScan: (docPathList: string[]) => AssetUsageDoc[];
  fileEntryListGet?: () => { internalPath: string; name: string }[];
  // the frontend objects and types the doc pages declare, as the files say now
  objectFrontendConfigGet?: () => ObjectFrontendConfig;
}): Middleware {
  const { endpoint, storeGet, rootAbsPathByPathGet, usageScan, fileEntryListGet, objectFrontendConfigGet } = options;
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
    if (req.method === 'GET' && route === '/item/data') {
      try {
        const store = storeGet();
        const item = store.itemFind(storeItemKeyGet(url.searchParams));
        const version = store.versionDataGetOf(item, url.searchParams.get('versionId') ?? 'head');
        res.statusCode = 200;
        res.setHeader('Content-Type', item.contentType || 'application/octet-stream');
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
    if (route.startsWith('/object-frontend/')) {
      void objectFrontendRouteHandle(req, route, storeGet, objectFrontendConfigGet)
        .then((data) => jsonSend(res, 200, { code: 0, data, message: '' }))
        .catch(failureSend);
      return;
    }
    void routeHandle(req, route, url, storeGet(), rootAbsPathByPathGet, fileEntryListGet)
      .then((data) => jsonSend(res, 200, { code: 0, data, message: '' }))
      .catch(failureSend);
  };
}

const statusByCode: Record<number, number> = { [-1]: 400, [-2]: 409, [-3]: 404, [-4]: 403, [-5]: 409 };

// the routes of the frontend object service layer: the store and the
// declarations read for the request, the write, then the declarations read
// again, which the answer carries
async function objectFrontendRouteHandle(
  req: IncomingMessage,
  route: string,
  storeGet: () => AssetStore,
  configGet: (() => ObjectFrontendConfig) | undefined,
): Promise<any> {
  if (!configGet) throw new AssetError(-1, 'the page has no frontend object service layer');
  const method = req.method ?? 'GET';
  if (method === 'GET' && route === '/object-frontend/config') return objectFrontendConfigForPage(configGet());
  if (method !== 'POST') throw new AssetError(-1, `unknown frontend object route: ${method} ${route}`);
  const body = (await jsonBodyRead(req)) ?? {};
  const context = { store: storeGet(), config: configGet(), storeGet };
  const writeByRoute: Record<string, () => any> = {
    '/object-frontend/create': () => objectFrontendCreate(context, body),
    '/object-frontend/register': () => objectFrontendRegister(context, body),
    '/object-frontend/delete': () => objectFrontendDelete(context, body),
    '/object-frontend/meta/set': () => objectFrontendMetaSet(context, body),
    '/object-frontend/asset/create': () => objectFrontendAssetCreate(context, body),
    '/object-frontend/asset/remove': () => objectFrontendAssetRemove(context, body),
    '/object-frontend/asset/attach': () => objectFrontendAssetAttach(context, body),
    '/object-frontend/asset/move': () => objectFrontendAssetMove(context, body),
    '/object-frontend/asset/group/move': () => objectFrontendAssetGroupMove(context, body),
    '/object-frontend/asset/meta/set': () => objectFrontendAssetMetaSet(context, body),
    '/object-frontend/partition/create': () => objectFrontendPartitionCreate(context, body),
    '/object-frontend/partition/rename': () => objectFrontendPartitionRename(context, body),
    '/object-frontend/partition/delete': () => objectFrontendPartitionDelete(context, body),
  };
  const write = writeByRoute[route];
  if (!write) throw new AssetError(-1, `unknown frontend object route: ${method} ${route}`);
  const result = write();
  return { ...result, config: objectFrontendConfigForPage(configGet()) };
}

// the data of the answer, or an AssetError
async function routeHandle(
  req: IncomingMessage,
  route: string,
  url: URL,
  store: AssetStore,
  rootAbsPathByPathGet: () => Map<string, string>,
  fileEntryListGet?: () => { internalPath: string; name: string }[],
): Promise<any> {
  const method = req.method ?? 'GET';
  if (method === 'GET') {
    if (route === '/status') {
      return { isWritable: true, storeIdList: [ASSET_STORE_ID_LOCAL], folderList: store.folderInfoList(), docPageList: store.docPageInfoList() };
    }
    if (route === '/item/list') {
      storeIdCheck(url.searchParams.get('store'));
      return { itemList: store.itemList() };
    }
    if (route === '/item/get') {
      const item = store.itemFind(storeItemKeyGet(url.searchParams));
      const version = store.versionDataGetOf(item, url.searchParams.get('versionId') ?? 'head');
      return { item, version: versionResponseBuild(version) };
    }
    if (route === '/dependency/list') {
      const item = store.itemFind(storeItemKeyGet(url.searchParams));
      return store.dependencyListGet(item.itemId, url.searchParams.get('versionId') ?? 'head');
    }
    if (route === '/dependent/list') {
      const item = store.itemFind(storeItemKeyGet(url.searchParams));
      return { dependentList: store.dependentListGet(item.itemId, url.searchParams.get('versionId') ?? '') };
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
    if (route === '/item/get/list') {
      if (!Array.isArray(body?.requestList)) throw new AssetError(-1, 'requestList is required');
      return { answerList: body.requestList.map((one: any) => itemGetAnswerBuild(store, one)) };
    }
    const itemId = String(body?.itemId ?? '');
    if (route === '/item/create') {
      const result = store.itemCreate({
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
        groupPath: body?.groupPath ? String(body.groupPath) : undefined,
        owner: body?.owner,
      });
      return { item: result.item, version: versionResponseBuild(result.version), isCreated: result.isCreated };
    }
    if (route === '/item/update') {
      const data = bodyDataGet(body);
      testCaseHistoryGuard(store, itemId, data);
      const result = store.itemUpdate({
        itemId,
        hashBase: body?.hashBase,
        data,
        mode: body?.mode,
        note: body?.note,
        dependencyList: body?.dependencyList,
        versionMetadata: body?.versionMetadata,
      });
      return { item: result.item, version: versionResponseBuild(result.version) };
    }
    if (route === '/test-case/result/set') {
      let result;
      try {
        result = testCaseAssetResultSet(store, {
          itemId,
          hashBase: body?.hashBase,
          docPath: String(body?.docPath ?? ''),
          caseId: String(body?.caseId ?? ''),
          testerId: String(body?.testerId ?? ''),
          operator: body?.operator,
          result: body?.result,
          timeTimezone: body?.timeTimezone,
          evidence: body?.evidence,
          versionId: body?.versionId,
        }, fileEntryListGet?.() ?? []);
      } catch (error) {
        // what the data refuses is a bad request; the store's own errors keep their code
        if (error instanceof AssetError) throw error;
        throw new AssetError(-1, String((error as any)?.message ?? error));
      }
      return { item: result.item, version: versionResponseBuild(result.version) };
    }
    if (route === '/version/metadata/set') {
      const result = store.versionMetadataSet(itemId, String(body?.versionId ?? ''), body?.versionMetadata);
      return { item: result.item, version: versionResponseBuild(result.version) };
    }
    if (route === '/dependency/set') {
      return { item: store.dependencyListSet(itemId, String(body?.versionId ?? ''), body?.dependencyList) };
    }
    if (route === '/dependency/add') {
      return { item: store.dependencyAdd(itemId, String(body?.versionId ?? ''), body?.dependency) };
    }
    if (route === '/dependency/remove') {
      return { item: store.dependencyRemove(itemId, String(body?.versionId ?? ''), body?.dependency) };
    }
    if (route === '/item/delete') return { item: store.itemDelete(itemId) };
    if (route === '/item/restore') return { item: store.itemRestore(itemId) };
    if (route === '/item/meta/set') {
      return {
        item: store.itemMetaSet(itemId, {
          name: body?.name,
          lang: body?.lang,
          contentType: body?.contentType,
          saveMode: body?.saveMode,
          component: body?.component,
          owner: body?.owner,
        }),
      };
    }
    if (route === '/item/move') {
      return { item: store.itemMove(itemId, { groupPath: String(body?.groupPath ?? ''), folder: typeof body?.folder === 'string' && body.folder ? body.folder : undefined }) };
    }
    if (route === '/version/checkout') return { item: store.versionCheckout(itemId, String(body?.versionId ?? '')) };
    if (route === '/version/delete') return { item: store.versionDelete(itemId, String(body?.versionId ?? '')) };
    if (route === '/item/lock/set') return { item: store.itemLockSet(itemId, body?.isLocked) };
    if (route === '/version/lock/set') {
      return { item: store.versionLockSet(itemId, String(body?.versionId ?? ''), body?.isLocked) };
    }
  }
  throw new AssetError(-1, `unknown asset api route: ${method} ${route}`);
}

// the generic head write may not rewrite the result history of a
// TestCaseTable item (comp-mdx/test-case-table/comp_test_case_table.md):
// the history is appended through /test-case/result/set, with an operator
// and a time of the server. a structural edit that keeps the history passes
function testCaseHistoryGuard(store: AssetStore, itemId: string, data: Buffer) {
  const head = store.versionDataGetOf(store.itemGet(itemId), 'head');
  const textNext = textDecodeTry(data);
  try {
    testCaseAssetWriteCheck(head.isText ? head.text ?? '' : '', textNext ?? '');
  } catch (error) {
    throw new AssetError(-1, String((error as any)?.message ?? error));
  }
}

// the api serves the local store only; a reference into another store is not found here
function storeIdCheck(storeId: unknown) {
  if (storeId === undefined || storeId === null || storeId === '') throw new AssetError(-1, 'store is required');
  if (storeId !== ASSET_STORE_ID_LOCAL) throw new AssetError(-3, `unknown asset store: ${String(storeId)}`);
}

// the item a read names: by itemId, or by name
function storeItemKeyGet(searchParams: URLSearchParams): AssetItemKey {
  storeIdCheck(searchParams.get('store'));
  return { itemId: searchParams.get('itemId') ?? '', name: searchParams.get('name') ?? '' };
}

// one read of a list, in the form of an answer of its own
function itemGetAnswerBuild(store: AssetStore, one: any) {
  try {
    const item = store.itemFind({ itemId: String(one?.itemId ?? ''), name: '' });
    const version = store.versionDataGetOf(item, String(one?.versionId ?? 'head'));
    return { code: 0, data: { item, version: versionResponseBuild(version) }, message: '' };
  } catch (error) {
    if (error instanceof AssetError) return { code: error.code, data: null, message: error.message };
    throw error;
  }
}

// the data of a write: text (utf-8) or dataBase64 (any bytes)
function bodyDataGet(body: any): Buffer {
  if (typeof body?.text === 'string') return Buffer.from(body.text, 'utf-8');
  if (typeof body?.dataBase64 === 'string') return Buffer.from(body.dataBase64, 'base64');
  throw new AssetError(-1, 'text or dataBase64 is required');
}

// the version without its bytes; the bytes are read through /item/data
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
