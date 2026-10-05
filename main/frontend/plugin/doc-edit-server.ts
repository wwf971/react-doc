import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  lineOperationApply,
  lineOperationIsValid,
  textHashGet,
  type LineOperation,
} from './doc-edit-lines.ts';

// Edit api of the development server. It exists only while `vite` serves the
// page: a built page has no server behind it and shows no edit controls.
// design: doc_page_impl_edit.md
//
//   GET  {endpoint}/status                 -> { code: 0, data: { isWritable: true } }
//   GET  {endpoint}/source?path=/root/a.md -> { code: 0, data: { internalPath, text, hash } }
//   POST {endpoint}/source/apply           -> { code: 0, data: { internalPath, text, hash } }
//        body { internalPath, hashBase, operation }   operation: doc-edit-lines.ts
//
// every response is { code, data, message }. code 0 is success; negative codes:
//   -1  bad request or unexpected failure
//   -2  hashBase is not the hash of the file on disk (changed elsewhere)
//   -3  the path is not an editable document of the collected source
//
// only md/mdx files of the current file manifest can be read or written, so
// the source rules of config.yaml also bound what the page may edit.

export const DOC_EDIT_ENDPOINT_NAME = '__doc-edit';

export type DocEditFileEntry = {
  absPath: string;
  ext: string;
  internalPath: string;
};

export type DocEditMiddlewareOptions = {
  endpoint: string;
  fileEntryListGet: () => DocEditFileEntry[];
};

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export function docEditMiddlewareCreate(options: DocEditMiddlewareOptions): Middleware {
  const { endpoint, fileEntryListGet } = options;

  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== endpoint && !url.pathname.startsWith(`${endpoint}/`)) {
      next();
      return;
    }
    const route = url.pathname.slice(endpoint.length);
    void routeHandle(req, res, route, url, fileEntryListGet).catch((error) => {
      jsonSend(res, 500, { code: -1, data: null, message: String(error?.message ?? error) });
    });
  };
}

async function routeHandle(
  req: IncomingMessage,
  res: ServerResponse,
  route: string,
  url: URL,
  fileEntryListGet: () => DocEditFileEntry[],
): Promise<void> {
  if (req.method === 'GET' && route === '/status') {
    jsonSend(res, 200, { code: 0, data: { isWritable: true }, message: '' });
    return;
  }

  if (req.method === 'GET' && route === '/source') {
    const internalPath = url.searchParams.get('path') ?? '';
    const entry = editableEntryGet(fileEntryListGet(), internalPath);
    if (!entry) {
      jsonSend(res, 404, { code: -3, data: null, message: `not an editable document of the source: ${internalPath}` });
      return;
    }
    const text = fs.readFileSync(entry.absPath, 'utf-8');
    jsonSend(res, 200, { code: 0, data: sourceDataBuild(entry, text), message: '' });
    return;
  }

  if (req.method === 'POST' && route === '/source/apply') {
    const body = await jsonBodyRead(req);
    const internalPath = String(body?.internalPath ?? '');
    const entry = editableEntryGet(fileEntryListGet(), internalPath);
    if (!entry) {
      jsonSend(res, 404, { code: -3, data: null, message: `not an editable document of the source: ${internalPath}` });
      return;
    }
    if (typeof body?.hashBase !== 'string' || !lineOperationIsValid(body?.operation)) {
      jsonSend(res, 400, { code: -1, data: null, message: 'request needs hashBase and a valid line operation' });
      return;
    }
    const textCurrent = fs.readFileSync(entry.absPath, 'utf-8');
    const hashCurrent = textHashGet(textCurrent);
    if (hashCurrent !== body.hashBase) {
      jsonSend(res, 409, {
        code: -2,
        data: sourceDataBuild(entry, textCurrent),
        message: 'the document changed on disk since it was loaded; the edit was not applied',
      });
      return;
    }
    let textNext: string;
    try {
      textNext = lineOperationApply(textCurrent, body.operation as LineOperation);
    } catch (error: any) {
      jsonSend(res, 400, { code: -1, data: null, message: String(error?.message ?? error) });
      return;
    }
    fs.writeFileSync(entry.absPath, textNext, 'utf-8');
    jsonSend(res, 200, { code: 0, data: sourceDataBuild(entry, textNext), message: '' });
    return;
  }

  jsonSend(res, 404, { code: -1, data: null, message: `unknown edit api route: ${req.method} ${route}` });
}

function editableEntryGet(entryList: DocEditFileEntry[], internalPath: string): DocEditFileEntry | undefined {
  if (!internalPath) return undefined;
  const entry = entryList.find((item) => item.internalPath === internalPath);
  if (!entry || (entry.ext !== 'md' && entry.ext !== 'mdx')) return undefined;
  return entry;
}

function sourceDataBuild(entry: DocEditFileEntry, text: string) {
  return { internalPath: entry.internalPath, text, hash: textHashGet(text) };
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
        reject(new Error('request body is not valid JSON'));
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
