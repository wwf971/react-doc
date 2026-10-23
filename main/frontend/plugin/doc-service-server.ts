import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readYaml } from './doc-entry.ts';

// The service api of the development server (design:
// doc_page_impl_service.md#the-vite-plugin). The services run in a
// backend of their own (main/service-backend/server.py); the plugin only
// forwards {endpoint}/* to it unchanged, so the page reaches the backend on
// its own origin and the backend needs no CORS. Both work alone: the page
// shows "backend down" without the backend, and the backend answers any
// http client without the page.
//
// config.yaml:
//   service:
//     backend: http://127.0.0.1:45190                  the backend's address
//     backendConfigFile: ../example_doc/service-backend.yaml
//                                                      optional: the backend's config file; its
//                                                      template and instance folders are not documents
//
// when the backend cannot be reached the answer is { code: -5 } (http 503),
// the code the page reads as "backend down"; every other answer is the
// backend's own.

export const DOC_SERVICE_ENDPOINT_NAME = '__doc-service';

export const SERVICE_CODE_BACKEND_DOWN = -5;

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export type ServiceConfig = {
  backendUrl: string;
  // the backend's config file and its folders, absolute; empty without backendConfigFile
  backendConfigFile: string;
  folderPathAbsList: string[];
};

// the service section of config.yaml, or undefined without one. a wrong
// section stops the server with the reason, as the asset section does.
export function serviceConfigGet(configDoc: any, configDir: string): ServiceConfig | undefined {
  const section = configDoc?.service;
  if (section === undefined || section === null) return undefined;
  if (typeof section !== 'object' || typeof section.backend !== 'string' || section.backend === '') {
    throw new Error('[doc-source] config "service" must be { backend: http://host:port, backendConfigFile? }');
  }
  const backendUrl = section.backend.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(backendUrl)) {
    throw new Error(`[doc-source] config service.backend must be an http url (got ${JSON.stringify(section.backend)})`);
  }
  if (section.backendConfigFile === undefined) {
    return { backendUrl, backendConfigFile: '', folderPathAbsList: [] };
  }
  const backendConfigFile = path.resolve(configDir, String(section.backendConfigFile));
  return { backendUrl, backendConfigFile, folderPathAbsList: serviceFolderListRead(backendConfigFile) };
}

// the template and instance folders of the backend's config file
function serviceFolderListRead(backendConfigFile: string): string[] {
  if (!fs.existsSync(backendConfigFile)) return [];
  const backendConfig = readYaml(backendConfigFile) ?? {};
  const backendDir = path.dirname(backendConfigFile);
  const folderList = [...(backendConfig.templateFolderList ?? []), ...(backendConfig.instanceFolderList ?? [])];
  return folderList
    .map((item: any) => (typeof item === 'string' ? item : item?.path))
    .filter((folderPath: any) => typeof folderPath === 'string' && folderPath !== '')
    .map((folderPath: string) => path.resolve(backendDir, folderPath));
}

// a file of the service backend: its config file or anything in its folders.
// they are never documents, and a change in them (a database written, a
// dashboard rebuilt) never reloads the page
export function servicePathIs(serviceConfig: ServiceConfig, filePath: string): boolean {
  if (serviceConfig.backendConfigFile !== '' && filePath === serviceConfig.backendConfigFile) return true;
  return serviceConfig.folderPathAbsList.some((folder) => {
    const relative = path.relative(folder, filePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}

export function docServiceMiddlewareCreate(options: {
  endpoint: string;
  backendUrlGet: () => string;
}): Middleware {
  const { endpoint, backendUrlGet } = options;
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== endpoint && !url.pathname.startsWith(`${endpoint}/`)) {
      next();
      return;
    }
    const backendUrl = backendUrlGet();
    const target = new URL(`${backendUrl}${url.pathname.slice(endpoint.length) || '/'}${url.search}`);
    const headers: Record<string, string> = {};
    if (req.headers['content-type']) headers['content-type'] = String(req.headers['content-type']);
    if (req.headers['content-length']) headers['content-length'] = String(req.headers['content-length']);
    const requestBackend = http.request(target, { method: req.method, headers }, (responseBackend) => {
      const headersForward: Record<string, string> = {};
      for (const name of ['content-type', 'content-length', 'cache-control']) {
        const value = responseBackend.headers[name];
        if (value !== undefined) headersForward[name] = String(value);
      }
      res.writeHead(responseBackend.statusCode ?? 502, headersForward);
      responseBackend.pipe(res);
    });
    requestBackend.on('error', (error: any) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({
        code: SERVICE_CODE_BACKEND_DOWN,
        data: null,
        message: `the service backend at ${backendUrl} cannot be reached (${error?.code ?? error?.message ?? 'error'})`,
      }));
    });
    req.pipe(requestBackend);
  };
}
