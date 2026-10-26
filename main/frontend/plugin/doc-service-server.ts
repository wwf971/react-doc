import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readYaml, type EntryFileSection } from './doc-entry.ts';

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
//     backendConfigFile: ../example_doc/.doc-page/service-backend.yaml
//                                                      the backend's config file: its host and port are
//                                                      the backend's address, its template and instance
//                                                      folders are not documents
//     backend: http://127.0.0.1:45190                  optional: the address, over the config file's
//                                                      (a backend that is not the config file's)
//     launch: true                                     optional: the development server starts the backend
//     python: python3                                  optional: the interpreter the launch runs
//
// the port is written once, in the backend's config file: the backend
// listens on it, and the plugin forwards to it. with launch the
// development server runs main/service-backend/server.py --config
// {backendConfigFile} when nothing answers at the address yet (a backend
// started by hand is used as it is) and stops it when it exits.
//
// one route is the plugin's own: POST {endpoint}/registry/docpage/sync
// tells the backend which doc pages the page has loaded (the body of the
// request is ignored; the plugin builds it from the workspace as loaded
// now, temporary mounts included) and answers the backend's answer.
//
// when the backend cannot be reached the answer is { code: -5 } (http 503),
// the code the page reads as "backend down"; every other answer is the
// backend's own.
//
// the service folders of a doc page (doc_page_impl_dir.md, the backend's
// service_kernel.py reads them the same way): the four convention folders
// of the doc page folder, or those its service config file names
// (.doc-page/service.yaml beside the entry, or the file the entry names
// with "service: { file }"; "service: false": none). they are never
// documents, and a change in them never reloads the page.

export const DOC_SERVICE_ENDPOINT_NAME = '__doc-service';

export const SERVICE_CODE_BACKEND_DOWN = -5;

// the route the plugin answers itself, under the endpoint
export const SERVICE_ROUTE_DOCPAGE_SYNC = '/registry/docpage/sync';

export const SERVICE_CONFIG_FILE_NAME = 'service.yaml';

export type ServiceFolderRole = 'template' | 'instance';
export type ServiceKind = 'app' | 'infra';

// the service folders of a doc page without a service config file,
// relative to the doc page folder
export const SERVICE_FOLDER_DEFAULT_LIST: { path: string; role: ServiceFolderRole; kind: ServiceKind; isDefault: boolean }[] = [
  { path: 'service-template-app', role: 'template', kind: 'app', isDefault: false },
  { path: 'service-template-infra', role: 'template', kind: 'infra', isDefault: false },
  { path: 'service-app', role: 'instance', kind: 'app', isDefault: true },
  { path: 'service-infra', role: 'instance', kind: 'infra', isDefault: true },
];

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export type ServiceConfig = {
  backendUrl: string;
  // the backend's config file and its folders, absolute; empty without backendConfigFile
  backendConfigFile: string;
  folderPathAbsList: string[];
  // the development server starts the backend (needs backendConfigFile)
  isLaunch: boolean;
  python: string;
};

// the backend's own defaults (service_runtime.py) for a config file without host or port
export const SERVICE_BACKEND_HOST_DEFAULT = '127.0.0.1';
export const SERVICE_BACKEND_PORT_DEFAULT = 45190;

// the backend program, beside the frontend in the package
export const SERVICE_BACKEND_SCRIPT = fileURLToPath(new URL('../../service-backend/server.py', import.meta.url));

// one service folder of a doc page
export type ServiceFolder = {
  // absolute
  pathAbs: string;
  // as written in the file (or the convention name)
  pathWritten: string;
  role: ServiceFolderRole;
  kind: ServiceKind;
  isDefault: boolean;
};

// the service folders of one doc page the page loads
export type ServiceDocPage = {
  alias: string;
  entryFile: string;
  dirPage: string;
  // the service config file, absolute, whether it exists or not
  configFile: string;
  isConfigFileExists: boolean;
  folderList: ServiceFolder[];
  problemList: string[];
};

// what the reader needs of a loaded doc page (DocPageLoaded has it)
export type ServiceDocPageInput = {
  alias: string;
  entryFile: string;
  dirPage: string;
  service: EntryFileSection;
};

// a doc page as the sync route sends it to the backend
export type ServiceSyncDocPage = {
  alias: string;
  // the doc page folder, absolute
  dir: string;
  // the service config file, absolute, when the entry names one or the
  // convention file exists; '' otherwise (the backend reads the convention folders)
  serviceFile: string;
};

// the service section of config.yaml, or undefined without one. a wrong
// section stops the server with the reason, as the asset section does.
export function serviceConfigGet(configDoc: any, configDir: string): ServiceConfig | undefined {
  const section = configDoc?.service;
  if (section === undefined || section === null) return undefined;
  const sectionShape = '{ backendConfigFile, backend?, launch?, python? } (backend alone without a config file)';
  if (typeof section !== 'object' || Array.isArray(section)) {
    throw new Error(`[doc-source] config "service" must be ${sectionShape}`);
  }
  const isBackendWritten = section.backend !== undefined && section.backend !== null;
  const isConfigFileWritten = section.backendConfigFile !== undefined && section.backendConfigFile !== null;
  if (!isBackendWritten && !isConfigFileWritten) {
    throw new Error(`[doc-source] config "service" must be ${sectionShape}`);
  }
  if (isBackendWritten && (typeof section.backend !== 'string' || !/^https?:\/\//.test(section.backend))) {
    throw new Error(`[doc-source] config service.backend must be an http url (got ${JSON.stringify(section.backend)})`);
  }
  const isLaunch = section.launch === true;
  if (isLaunch && !isConfigFileWritten) {
    throw new Error('[doc-source] config service.launch needs service.backendConfigFile: the backend is started with it');
  }
  const python = typeof section.python === 'string' && section.python !== '' ? section.python : 'python3';
  if (!isConfigFileWritten) {
    return { backendUrl: section.backend.replace(/\/+$/, ''), backendConfigFile: '', folderPathAbsList: [], isLaunch, python };
  }
  const backendConfigFile = path.resolve(configDir, String(section.backendConfigFile));
  const backendConfig = backendConfigRead(backendConfigFile);
  const backendUrl = isBackendWritten ? section.backend.replace(/\/+$/, '') : backendUrlOfConfig(backendConfig);
  return { backendUrl, backendConfigFile, folderPathAbsList: serviceFolderListRead(backendConfig, backendConfigFile), isLaunch, python };
}

function backendConfigRead(backendConfigFile: string): any {
  if (!fs.existsSync(backendConfigFile)) return {};
  return readYaml(backendConfigFile) ?? {};
}

// the address the backend listens on, as its config file says: the one
// place the port is written. a backend listening on every interface is
// reached on the loopback
export function backendUrlOfConfig(backendConfig: any): string {
  const hostWritten = typeof backendConfig?.host === 'string' && backendConfig.host !== '' ? backendConfig.host : SERVICE_BACKEND_HOST_DEFAULT;
  const host = hostWritten === '0.0.0.0' || hostWritten === '::' ? '127.0.0.1' : hostWritten;
  const port = backendConfig?.port === undefined || backendConfig?.port === null ? SERVICE_BACKEND_PORT_DEFAULT : Number(backendConfig.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`[doc-source] the backend config port must be a port number (got ${JSON.stringify(backendConfig.port)})`);
  }
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

// the template and instance folders of the backend's config file (the
// plain folders outside any doc page; the doc pages it names are read by
// the backend, and by this plugin through the doc pages the page loads)
function serviceFolderListRead(backendConfig: any, backendConfigFile: string): string[] {
  const backendDir = path.dirname(backendConfigFile);
  const folderList = [...(backendConfig.templateFolderList ?? []), ...(backendConfig.instanceFolderList ?? [])];
  return folderList
    .map((item: any) => (typeof item === 'string' ? item : item?.path))
    .filter((folderPath: any) => typeof folderPath === 'string' && folderPath !== '')
    .map((folderPath: string) => path.resolve(backendDir, folderPath));
}

// ---------- the service folders of the doc pages ----------

// the service config file of a doc page: the one its entry names, else the
// convention file beside the entry
export function serviceConfigFileGet(input: Pick<ServiceDocPageInput, 'entryFile' | 'service'>): string {
  const dirEntry = path.dirname(input.entryFile);
  return input.service ? path.resolve(dirEntry, input.service.file) : path.join(dirEntry, SERVICE_CONFIG_FILE_NAME);
}

// the service folders of every doc page the page loads; a doc page with
// "service: false" has none. a problem with a file is reported once per
// change of the file's problems (the reader runs on every configuration
// read) and leaves that entry out, never the page
export function serviceConfigOfDocPageListGet(docPageInputList: ServiceDocPageInput[]): { docPageList: ServiceDocPage[] } {
  const docPageList: ServiceDocPage[] = [];
  for (const input of docPageInputList) {
    if (input.service === false) continue;
    const docPage = serviceDocPageRead(input);
    problemListReport('doc-service', docPage.configFile, docPage.problemList);
    docPageList.push(docPage);
  }
  return { docPageList };
}

// the service folders of one doc page: its file when it exists, the
// convention folders otherwise (pure: nothing is created)
export function serviceDocPageRead(input: ServiceDocPageInput): ServiceDocPage {
  const configFile = serviceConfigFileGet(input);
  const docPage: ServiceDocPage = {
    alias: input.alias,
    entryFile: input.entryFile,
    dirPage: input.dirPage,
    configFile,
    isConfigFileExists: fs.existsSync(configFile),
    folderList: [],
    problemList: [],
  };
  if (!docPage.isConfigFileExists) {
    docPage.folderList = SERVICE_FOLDER_DEFAULT_LIST.map((item) => ({
      pathAbs: path.join(input.dirPage, item.path),
      pathWritten: item.path,
      role: item.role,
      kind: item.kind,
      isDefault: item.isDefault,
    }));
    return docPage;
  }
  let content: any;
  try {
    content = readYaml(configFile) ?? {};
  } catch (error: any) {
    docPage.problemList.push(`not valid yaml: ${String(error?.message ?? error)}`);
    return docPage;
  }
  if (typeof content !== 'object' || Array.isArray(content)) {
    docPage.problemList.push('must be a mapping { templateFolderList, instanceFolderList }');
    return docPage;
  }
  const dirBase = path.dirname(configFile);
  for (const [key, role] of [['templateFolderList', 'template'], ['instanceFolderList', 'instance']] as const) {
    const list = content[key];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) {
      docPage.problemList.push(`${key} must be a list of paths or { path, kind, isDefault }`);
      continue;
    }
    list.forEach((item: any, index: number) => {
      const folder = serviceFolderItemRead(item, dirBase, role, docPage.problemList, `${key}[${index}]`);
      if (!folder) return;
      if (docPage.folderList.some((folderKept) => folderKept.pathAbs === folder.pathAbs)) {
        docPage.problemList.push(`${key}[${index}]: ${folder.pathWritten} is listed already`);
        return;
      }
      docPage.folderList.push(folder);
    });
  }
  return docPage;
}

// one folder entry: a path, or { path, kind?, isDefault? }; kind app when absent
function serviceFolderItemRead(item: any, dirBase: string, role: ServiceFolderRole, problemList: string[], place: string): ServiceFolder | undefined {
  const mapping = typeof item === 'string' ? { path: item } : item;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || typeof mapping.path !== 'string' || mapping.path.trim() === '') {
    problemList.push(`${place}: every entry is a path or { path, kind, isDefault }`);
    return undefined;
  }
  const kind = mapping.kind === undefined ? 'app' : mapping.kind;
  if (kind !== 'app' && kind !== 'infra') {
    problemList.push(`${place}: kind is app or infra (got ${JSON.stringify(mapping.kind)})`);
    return undefined;
  }
  const pathWritten = mapping.path.trim();
  return {
    pathAbs: path.resolve(dirBase, pathWritten),
    pathWritten,
    role,
    kind,
    isDefault: role === 'instance' && mapping.isDefault === true,
  };
}

// the doc pages as the sync route sends them to the backend: every loaded
// doc page that has service folders (root ones, included ones, temporary
// mounts), with its service config file when the entry names one or the
// convention file exists
export function serviceSyncDocPageListBuild(docPageInputList: ServiceDocPageInput[]): ServiceSyncDocPage[] {
  const result: ServiceSyncDocPage[] = [];
  for (const input of docPageInputList) {
    if (input.service === false) continue;
    const configFile = serviceConfigFileGet(input);
    result.push({
      alias: input.alias,
      dir: input.dirPage,
      serviceFile: input.service || fs.existsSync(configFile) ? configFile : '',
    });
  }
  return result;
}

// ---------- what is never a document ----------

// the files and folders of the service layer, absolute: the backend's
// config file and its plain folders, and the service config file and the
// service folders of every doc page the page loads
export type ServiceFolderSet = {
  fileList: string[];
  folderList: string[];
};

export function serviceFolderSetGet(serviceConfig: ServiceConfig | undefined, docPageInputList: ServiceDocPageInput[]): ServiceFolderSet {
  const fileList: string[] = [];
  const folderList: string[] = [];
  if (serviceConfig) {
    if (serviceConfig.backendConfigFile !== '') fileList.push(serviceConfig.backendConfigFile);
    folderList.push(...serviceConfig.folderPathAbsList);
  }
  for (const docPage of serviceConfigOfDocPageListGet(docPageInputList).docPageList) {
    fileList.push(docPage.configFile);
    for (const folder of docPage.folderList) {
      if (!folderList.includes(folder.pathAbs)) folderList.push(folder.pathAbs);
    }
  }
  return { fileList, folderList };
}

// a file of the service layer: a config file (and the backup written beside
// it) or anything in a service folder. they are never documents, and a
// change in them (a database written, a dashboard rebuilt) never reloads
// the page
export function servicePathIs(folderSet: ServiceFolderSet, filePath: string): boolean {
  if (folderSet.fileList.some((file) => filePath === file || filePath === `${file}.bak`)) return true;
  return folderSet.folderList.some((folder) => pathIsInside(filePath, folder));
}

function pathIsInside(filePath: string, folder: string): boolean {
  const relative = path.relative(folder, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// the problems of a file, warned when they differ from the last report of
// that file (the readers run on every configuration read)
const problemTextReportedByFile = new Map<string, string>();
export function problemListReport(prefix: string, file: string, problemList: string[]) {
  const text = problemList.join('\n');
  if (problemTextReportedByFile.get(file) === text) return;
  problemTextReportedByFile.set(file, text);
  for (const problem of problemList) console.warn(`[${prefix}] ${file}: ${problem}`);
}

// ---------- the middleware ----------

export function docServiceMiddlewareCreate(options: {
  endpoint: string;
  backendUrlGet: () => string;
  // the doc pages loaded now, for the sync route; none without it
  docPageListGet?: () => ServiceSyncDocPage[];
}): Middleware {
  const { endpoint, backendUrlGet, docPageListGet } = options;
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== endpoint && !url.pathname.startsWith(`${endpoint}/`)) {
      next();
      return;
    }
    const backendUrl = backendUrlGet();
    const routePath = url.pathname.slice(endpoint.length) || '/';
    const backendDownAnswer = (error: any) => {
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
    };
    const responseForward = (responseBackend: IncomingMessage) => {
      const headersForward: Record<string, string> = {};
      for (const name of ['content-type', 'content-length', 'cache-control']) {
        const value = responseBackend.headers[name];
        if (value !== undefined) headersForward[name] = String(value);
      }
      res.writeHead(responseBackend.statusCode ?? 502, headersForward);
      responseBackend.pipe(res);
    };

    // the plugin's own route: the loaded doc pages, as the workspace is now
    if (routePath === SERVICE_ROUTE_DOCPAGE_SYNC && req.method === 'POST' && docPageListGet) {
      // the request body is ignored; drained so the connection completes
      req.resume();
      let body: string;
      try {
        body = JSON.stringify({ docPageList: docPageListGet() });
      } catch (error: any) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ code: -1, data: null, message: `the loaded doc pages cannot be listed: ${String(error?.message ?? error)}` }));
        return;
      }
      const requestBackend = http.request(
        new URL(`${backendUrl}${SERVICE_ROUTE_DOCPAGE_SYNC}`),
        { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(body)) } },
        responseForward,
      );
      requestBackend.on('error', backendDownAnswer);
      requestBackend.end(body);
      return;
    }

    const target = new URL(`${backendUrl}${routePath}${url.search}`);
    const headers: Record<string, string> = {};
    if (req.headers['content-type']) headers['content-type'] = String(req.headers['content-type']);
    if (req.headers['content-length']) headers['content-length'] = String(req.headers['content-length']);
    const requestBackend = http.request(target, { method: req.method, headers }, responseForward);
    requestBackend.on('error', backendDownAnswer);
    req.pipe(requestBackend);
  };
}

// ---------- the launch ----------

// whether something accepts connections at the backend's address
function backendIsListening(backendUrl: string): Promise<boolean> {
  const url = new URL(backendUrl);
  return new Promise((resolve) => {
    const socket = net.connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 80) });
    const done = (isListening: boolean) => {
      socket.destroy();
      resolve(isListening);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// the backend the development server started, kept across restarts of the
// server (a change of vite.config re-imports the plugin) so that a restart
// neither starts a second one nor stops the first
type BackendLaunched = { child: ChildProcess; backendConfigFile: string };
const BACKEND_LAUNCHED_KEY = Symbol.for('react-doc.service-backend.launched');
const BACKEND_EXIT_HOOK_KEY = Symbol.for('react-doc.service-backend.exit-hook');

// starts the backend of the config file unless one answers at its address
// already; it is stopped when the development server's process exits. its
// output goes to the server's terminal
export async function serviceBackendLaunch(serviceConfig: ServiceConfig): Promise<void> {
  const store = globalThis as any;
  const launched: BackendLaunched | undefined = store[BACKEND_LAUNCHED_KEY];
  if (launched && launched.child.exitCode === null && launched.child.signalCode === null) {
    if (launched.backendConfigFile === serviceConfig.backendConfigFile) return;
    launched.child.kill('SIGTERM');
  }
  if (await backendIsListening(serviceConfig.backendUrl)) {
    console.log(`[doc-service] a backend answers at ${serviceConfig.backendUrl} already; it is used as it is`);
    return;
  }
  const commandText = `${serviceConfig.python} ${SERVICE_BACKEND_SCRIPT} --config ${serviceConfig.backendConfigFile}`;
  console.log(`[doc-service] starting the backend: ${commandText}`);
  const child = spawn(serviceConfig.python, [SERVICE_BACKEND_SCRIPT, '--config', serviceConfig.backendConfigFile], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  child.on('error', (error) => {
    console.warn(`[doc-service] the backend cannot be started (${error.message}); the page shows "backend down". command: ${commandText}`);
  });
  child.on('exit', (code, signal) => {
    if (store[BACKEND_LAUNCHED_KEY]?.child === child) store[BACKEND_LAUNCHED_KEY] = undefined;
    if (code !== 0 && signal === null) console.warn(`[doc-service] the backend exited with code ${code}`);
  });
  store[BACKEND_LAUNCHED_KEY] = { child, backendConfigFile: serviceConfig.backendConfigFile };
  // ctrl-c reaches the backend by itself (it is of the same process group);
  // an exit of the server's process otherwise stops it here
  if (!store[BACKEND_EXIT_HOOK_KEY]) {
    store[BACKEND_EXIT_HOOK_KEY] = true;
    process.on('exit', () => store[BACKEND_LAUNCHED_KEY]?.child.kill('SIGTERM'));
  }
}
