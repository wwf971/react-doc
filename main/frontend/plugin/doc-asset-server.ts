import type { IncomingMessage, ServerResponse } from 'node:http';
import { AssetError, type AssetStore } from './doc-asset-store.ts';

// Asset api of the development server (design: doc_page_impl_asset.md). Like
// the edit api, it exists only while `vite` serves the page; a built page
// reads the bundled snapshot of the store instead and cannot write.
//
//   GET  {endpoint}/status                            -> { isWritable: true, folder }
//   GET  {endpoint}/object/list                       -> { objectList }
//   GET  {endpoint}/object/get?objectId=&versionId=   -> { object, version }   versionId default head
//   POST {endpoint}/object/create    { name, lang, text, note }          -> { object, version }
//   POST {endpoint}/object/update    { objectId, hashBase, text, mode, note } -> { object, version }
//                                     mode: inPlace | newVersion
//   POST {endpoint}/object/delete    { objectId }                        -> { object }   (soft)
//   POST {endpoint}/object/restore   { objectId }                        -> { object }
//   POST {endpoint}/object/meta/set  { objectId, name?, lang? }          -> { object }
//   POST {endpoint}/version/checkout { objectId, versionId }             -> { object }   head moves
//   POST {endpoint}/version/delete   { objectId, versionId }             -> { object }
//
// every response is { code, data, message }. code 0 is success; negative codes:
//   -1  bad request or unexpected failure
//   -2  hashBase is not the hash of the head text (changed meanwhile)
//   -3  object or version not found
//
// object: { objectId, name, lang, fileExt, versionIdHead, isDeleted,
//           timeCreated, timeUpdated, versionList: [{ versionId, versionIdPrevList, time, note }] }
// version: { versionId, text, hash }

export const DOC_ASSET_ENDPOINT_NAME = '__doc-asset';

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export function docAssetMiddlewareCreate(options: { endpoint: string; storeGet: () => AssetStore }): Middleware {
  const { endpoint, storeGet } = options;
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== endpoint && !url.pathname.startsWith(`${endpoint}/`)) {
      next();
      return;
    }
    const route = url.pathname.slice(endpoint.length);
    void routeHandle(req, route, url, storeGet())
      .then((data) => jsonSend(res, 200, { code: 0, data, message: '' }))
      .catch((error) => {
        if (error instanceof AssetError) {
          jsonSend(res, statusByCode[error.code] ?? 400, { code: error.code, data: null, message: error.message });
          return;
        }
        jsonSend(res, 500, { code: -1, data: null, message: String(error?.message ?? error) });
      });
  };
}

const statusByCode: Record<number, number> = { [-1]: 400, [-2]: 409, [-3]: 404 };

// the data of the answer, or an AssetError
async function routeHandle(req: IncomingMessage, route: string, url: URL, store: AssetStore): Promise<any> {
  const method = req.method ?? 'GET';
  if (method === 'GET') {
    if (route === '/status') return { isWritable: true, folder: store.folder };
    if (route === '/object/list') return { objectList: store.objectList() };
    if (route === '/object/get') {
      const objectId = url.searchParams.get('objectId') ?? '';
      const versionId = url.searchParams.get('versionId') ?? 'head';
      const object = store.objectGet(objectId);
      const version = store.versionTextGet(objectId, versionId);
      return { object, version };
    }
  }
  if (method === 'POST') {
    const body = await jsonBodyRead(req);
    const objectId = String(body?.objectId ?? '');
    if (route === '/object/create') {
      return store.objectCreate({ name: body?.name, lang: body?.lang, text: body?.text, note: body?.note });
    }
    if (route === '/object/update') {
      return store.objectUpdate({ objectId, hashBase: body?.hashBase, text: body?.text, mode: body?.mode, note: body?.note });
    }
    if (route === '/object/delete') return { object: store.objectDelete(objectId) };
    if (route === '/object/restore') return { object: store.objectRestore(objectId) };
    if (route === '/object/meta/set') return { object: store.objectMetaSet(objectId, { name: body?.name, lang: body?.lang }) };
    if (route === '/version/checkout') return { object: store.versionCheckout(objectId, String(body?.versionId ?? '')) };
    if (route === '/version/delete') return { object: store.versionDelete(objectId, String(body?.versionId ?? '')) };
  }
  throw new AssetError(-1, `unknown asset api route: ${method} ${route}`);
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
