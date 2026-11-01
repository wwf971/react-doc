import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';

// The remote api of the development server (design:
// doc_page_impl_api.md#remote-callers). The apis of the page run in the
// browser, where the stores are; a caller outside the page (an AI agent, a
// script, a test) reaches them through this bridge: an http route of the
// development server forwards the request to a connected page over the
// HMR socket and answers with what the page answered.
//
//   GET  {endpoint}/status                 -> { pageList: [{ pageId, title, docPath, url, time }], pageIdDefault }
//   GET  {endpoint}/list?pageId=           -> { apiList: [{ id, label, description, category, paramList, isAvailable, reason, hotkey }] }
//   GET  {endpoint}/context?pageId=        -> where the reader is: the workspace, the doc page, the document, the block, the page state
//   POST {endpoint}/call                   -> the result of the api, as the page answered it
//        body { api, params?, pageId?, principalId? }
//
// every response is { code, data, message }, the api's codes
// (lib/doc-api.js: 0 done, -1 failed, -2 unknown api, -3 unavailable, -4
// wrong params, -5 timeout) and the bridge's own:
//   -6  no page is connected (http 503), the page named is not connected, or
//       the page did not answer in time (http 504)
//
// pages: a page says hello over the socket when it loads (doc-api-hello,
// with its pageId and the document shown), again when its document
// changes, and bye when it unloads; the socket closing removes it as well.
// without pageId a request goes to the page that said hello last, so one
// open tab needs no id; several tabs are told apart by /status.

export const DOC_API_ENDPOINT_NAME = '__doc-api';
const REQUEST_TIMEOUT_MS = 15000;

type PageInfo = { pageId: string; title: string; docPath: string; url: string; time: number };
type PageEntry = { info: PageInfo; client: { send: (event: string, data?: any) => void; socket?: any } };
type ApiResult = { code: number; data?: any; message: string };
type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export function docApiBridgeCreate(server: ViteDevServer, { endpoint }: { endpoint: string }) {
  const pageById = new Map<string, PageEntry>();
  const pending = new Map<string, { resolve: (result: ApiResult) => void; timer: ReturnType<typeof setTimeout> }>();
  let requestCount = 0;

  const pageRemove = (pageId: string) => {
    pageById.delete(pageId);
  };

  server.ws.on('doc-api-hello', (data: any, client: any) => {
    const pageId = String(data?.pageId ?? '');
    if (pageId === '') return;
    const info: PageInfo = {
      pageId,
      title: String(data?.title ?? ''),
      docPath: String(data?.docPath ?? ''),
      url: String(data?.url ?? ''),
      time: Number(data?.time) || Date.now(),
    };
    const isNew = !pageById.has(pageId);
    pageById.set(pageId, { info, client });
    if (isNew && client?.socket?.on) client.socket.on('close', () => pageRemove(pageId));
  });
  server.ws.on('doc-api-bye', (data: any) => pageRemove(String(data?.pageId ?? '')));
  server.ws.on('doc-api-response', (data: any) => {
    const requestId = String(data?.requestId ?? '');
    const waiting = pending.get(requestId);
    if (!waiting) return;
    pending.delete(requestId);
    clearTimeout(waiting.timer);
    waiting.resolve(resultNormalize(data?.result));
  });

  // the page a request goes to: the one named, else the one that said hello last
  const pageGet = (pageId: string): { page?: PageEntry; message: string } => {
    if (pageId !== '') {
      const page = pageById.get(pageId);
      return page ? { page, message: '' } : { message: `no page with the id ${pageId} is connected (GET ${endpoint}/status lists them)` };
    }
    let pageLast: PageEntry | undefined;
    for (const page of pageById.values()) {
      if (!pageLast || page.info.time > pageLast.info.time) pageLast = page;
    }
    return pageLast ? { page: pageLast, message: '' } : { message: 'no page is connected to the development server (open the page in a browser)' };
  };

  const request = (pageId: string, payload: Record<string, any>): Promise<ApiResult> => {
    const { page, message } = pageGet(pageId);
    if (!page) return Promise.resolve({ code: -6, data: null, message });
    requestCount += 1;
    const requestId = `${Date.now().toString(36)}-${requestCount}`;
    return new Promise<ApiResult>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve({ code: -6, data: null, message: `the page ${page.info.pageId} did not answer within ${REQUEST_TIMEOUT_MS} ms` });
      }, REQUEST_TIMEOUT_MS);
      pending.set(requestId, { resolve, timer });
      try {
        page.client.send('doc-api-request', { requestId, pageId: page.info.pageId, ...payload });
      } catch (error: any) {
        pending.delete(requestId);
        clearTimeout(timer);
        pageRemove(page.info.pageId);
        resolve({ code: -6, data: null, message: `the page ${page.info.pageId} cannot be reached: ${String(error?.message ?? error)}` });
      }
    });
  };

  const statusGet = () => {
    const pageList = [...pageById.values()].map((page) => page.info).sort((a, b) => b.time - a.time);
    return { pageList, pageIdDefault: pageList[0]?.pageId ?? '' };
  };

  const middleware: Middleware = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== endpoint && !url.pathname.startsWith(`${endpoint}/`)) {
      next();
      return;
    }
    const route = url.pathname.slice(endpoint.length);
    void routeHandle(req, res, route, url).catch((error) => {
      jsonSend(res, 500, { code: -1, data: null, message: String(error?.message ?? error) });
    });
  };

  const routeHandle = async (req: IncomingMessage, res: ServerResponse, route: string, url: URL) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && route === '/status') {
      jsonSend(res, 200, { code: 0, data: statusGet(), message: '' });
      return;
    }
    if (req.method === 'GET' && (route === '/list' || route === '/context')) {
      const result = await request(url.searchParams.get('pageId') ?? '', { kind: route.slice(1), principalId: url.searchParams.get('principalId') ?? '' });
      jsonSend(res, statusOfCode(result.code), result);
      return;
    }
    if (req.method === 'POST' && route === '/call') {
      const body = await bodyJsonRead(req);
      if (!body || typeof body !== 'object' || typeof body.api !== 'string') {
        jsonSend(res, 400, { code: -4, data: null, message: 'the body names "api" ({layer}/{name}), with "params" (a mapping), "pageId" and "principalId" optional' });
        return;
      }
      const result = await request(String(body.pageId ?? ''), {
        kind: 'call',
        api: body.api,
        params: body.params ?? {},
        principalId: String(body.principalId ?? ''),
      });
      jsonSend(res, statusOfCode(result.code), result);
      return;
    }
    jsonSend(res, 404, { code: -1, data: null, message: `unknown route ${req.method} ${route} (GET /status, /list, /context; POST /call)` });
  };

  return { middleware, statusGet, request };
}

// a result of the page as { code, data, message }
function resultNormalize(result: any): ApiResult {
  if (result && typeof result === 'object' && typeof result.code === 'number') {
    return { code: result.code, data: result.data ?? null, message: String(result.message ?? '') };
  }
  return { code: -1, data: null, message: 'the page answered without a result' };
}

// the bridge's codes map to http statuses; an api's own result is 200
function statusOfCode(code: number): number {
  if (code === -6) return 503;
  return 200;
}

async function bodyJsonRead(req: IncomingMessage): Promise<any> {
  const chunkList: Buffer[] = [];
  for await (const chunk of req) chunkList.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  const text = Buffer.concat(chunkList).toString('utf-8');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function jsonSend(res: ServerResponse, statusCode: number, payload: ApiResult) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}
