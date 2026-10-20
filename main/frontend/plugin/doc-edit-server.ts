import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import {
  lineOperationApply,
  lineOperationIsValid,
  textHashGet,
  type LineOperation,
} from './doc-edit-lines.ts';
import { sidePanelMoveBuild, sidePanelMoveRequestIsValid } from './doc-side-panel-move.ts';
import { sidePanelTextOperationBuild } from './doc-side-panel-text.ts';
import { yamlValueGet, yamlValueSetOperationBuild, yamlValueTextBuild } from './doc-yaml-edit.ts';

// Edit api of the development server. It exists only while `vite` serves the
// page: a built page has no server behind it and shows no edit controls.
// design: doc_page_impl_edit.md
//
//   GET  {endpoint}/status                 -> { code: 0, data: { isWritable: true } }
//   GET  {endpoint}/source?path=~root/a.md -> { code: 0, data: { internalPath, text, hash } }
//   POST {endpoint}/source/apply           -> { code: 0, data: { internalPath, text, hash } }
//        body { internalPath, hashBase, operation }   operation: doc-edit-lines.ts
//   POST {endpoint}/side-panel/text        -> { code: 0, data: { file, fieldName, text } }
//        body { file, nodePath, language, text, textBase }   doc-side-panel-text.ts
//   POST {endpoint}/side-panel/move        -> { code: 0, data: { fileChangeList } }
//        body { item, target, hashBaseByFile }   doc-side-panel-move.ts; one or
//        two files, written together; fileChangeList [{ file, hashBefore,
//        hashAfter, textBefore, textAfter }], empty when nothing moved
//   POST {endpoint}/config/value           -> { code: 0, data: { file, keyPath, value } }
//        body { keyPath, value, valueBase }   a value of config.yaml globalConfig / compConfig
//                                             (doc_page_impl_config.md#config-layers)
//
// every response is { code, data, message }. code 0 is success; negative codes:
//   -1  bad request or unexpected failure
//   -2  hashBase is not the hash of the file on disk (changed elsewhere), the
//       side-panel label is no longer the one the edit started from, a
//       side-panel file of a move changed since the page loaded it, or the
//       config value in the file is no longer the one the page displayed
//   -3  the path is not an editable document of the collected source, the
//       file is not a loaded side-panel file, or the page has no config file
//
// only md/mdx files of the current file manifest can be read or written, so
// the source rules of config.yaml also bound what the page may edit. only
// the side-panel files the configuration loads can have a label rewritten;
// only the config key sections of config.yaml (and its local layer) can
// receive a value. every yaml file is edited in place (doc-yaml-edit.ts),
// and a backup of the previous content is kept beside it as {file}.bak.

export const DOC_EDIT_ENDPOINT_NAME = '__doc-edit';

export type DocEditFileEntry = {
  absPath: string;
  ext: string;
  internalPath: string;
};

// the side-panel label route; absent when the page has no side-panel file
export type DocEditSidePanelOptions = {
  configDir: string;
  // absolute paths of the side-panel files the configuration currently loads
  fileListGet: () => string[];
  // called after files were rewritten, with their new texts, so the plugin
  // can report the new configuration to the page as data, once. answers ''
  // when the configuration loads, else why it does not (then nothing is
  // reported)
  onFileListWritten: (fileList: { filePath: string; text: string }[]) => string;
};

// the config value route: the files of the global config layer
export type DocEditConfigOptions = {
  // config.yaml, then its local layer (config.0.yaml, which may not exist).
  // a key is written where it is declared: the local layer when that file
  // declares it, otherwise config.yaml
  fileList: string[];
  onFileWritten: (filePath: string, text: string) => void;
};

export type DocEditMiddlewareOptions = {
  endpoint: string;
  fileEntryListGet: () => DocEditFileEntry[];
  sidePanel?: DocEditSidePanelOptions;
  config?: DocEditConfigOptions;
};

// the sections of config.yaml the config/value route may write, with the
// depth of a value below them: globalConfig.Key, compConfig.Name.Key
const configKeyPathDepthBySection: Record<string, number> = { globalConfig: 2, compConfig: 3 };

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export function docEditMiddlewareCreate(options: DocEditMiddlewareOptions): Middleware {
  const { endpoint } = options;

  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== endpoint && !url.pathname.startsWith(`${endpoint}/`)) {
      next();
      return;
    }
    const route = url.pathname.slice(endpoint.length);
    void routeHandle(req, res, route, url, options).catch((error) => {
      jsonSend(res, 500, { code: -1, data: null, message: String(error?.message ?? error) });
    });
  };
}

async function routeHandle(
  req: IncomingMessage,
  res: ServerResponse,
  route: string,
  url: URL,
  options: DocEditMiddlewareOptions,
): Promise<void> {
  const { fileEntryListGet } = options;
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

  if (req.method === 'POST' && route === '/side-panel/text') {
    const body = await jsonBodyRead(req);
    sidePanelTextRouteHandle(res, body, options.sidePanel);
    return;
  }

  if (req.method === 'POST' && route === '/side-panel/move') {
    const body = await jsonBodyRead(req);
    sidePanelMoveRouteHandle(res, body, options.sidePanel);
    return;
  }

  if (req.method === 'POST' && route === '/config/value') {
    const body = await jsonBodyRead(req);
    configValueRouteHandle(res, body, options.config);
    return;
  }

  jsonSend(res, 404, { code: -1, data: null, message: `unknown edit api route: ${req.method} ${route}` });
}

// writes one value of the global config layer into config.yaml, or into its
// local layer when that file declares the key (the local layer overrides
// config.yaml key by key, so writing config.yaml would change nothing).
//   keyPath     ['globalConfig', Key] or ['compConfig', CompName, Key]
//   value       null, boolean, number, string, or a list of strings
//   valueBase   the value the page displayed for the key, as the file
//               declares it (undefined: the key was not declared); when
//               the file says otherwise now, the write is refused (-2)
// the previous file is kept as {file}.bak before the write.
function configValueRouteHandle(res: ServerResponse, body: any, config: DocEditConfigOptions | undefined) {
  if (!config) {
    jsonSend(res, 404, { code: -3, data: null, message: 'the page has no config file to write' });
    return;
  }
  const keyPath = body?.keyPath;
  if (!configKeyPathIsValid(keyPath)) {
    jsonSend(res, 400, { code: -1, data: null, message: 'keyPath must be [globalConfig, Key] or [compConfig, CompName, Key]' });
    return;
  }
  const valueText = yamlValueTextBuild(body?.value);
  if (valueText === undefined) {
    jsonSend(res, 400, { code: -1, data: null, message: 'value must be null, a boolean, a number, a string, or a list of strings' });
    return;
  }
  const filePath = configFileForKeyPathGet(config.fileList, keyPath);
  if (!filePath) {
    jsonSend(res, 404, { code: -3, data: null, message: 'the config file does not exist' });
    return;
  }
  const textCurrent = fs.readFileSync(filePath, 'utf-8');
  if ('valueBase' in (body ?? {})) {
    const valueCurrent = yamlValueGet(textCurrent, keyPath);
    if (JSON.stringify(valueCurrent ?? null) !== JSON.stringify(body.valueBase ?? null)) {
      jsonSend(res, 409, {
        code: -2,
        data: { file: filePath, keyPath, value: valueCurrent },
        message: `the value of ${keyPath.join('.')} changed in ${path.basename(filePath)} since it was displayed; the edit was not applied`,
      });
      return;
    }
  }
  const result = yamlValueSetOperationBuild(textCurrent, keyPath, valueText);
  if (result.code !== 0) {
    jsonSend(res, 400, { code: -1, data: null, message: `${path.basename(filePath)}: ${result.message}` });
    return;
  }
  const textNext = lineOperationApply(textCurrent, result.data.operation);
  fileWriteWithBackup(filePath, textNext);
  config.onFileWritten(filePath, textNext);
  jsonSend(res, 200, { code: 0, data: { file: filePath, keyPath, value: body.value }, message: '' });
}

function configKeyPathIsValid(keyPath: unknown): keyPath is string[] {
  if (!Array.isArray(keyPath) || keyPath.length === 0) return false;
  if (!keyPath.every((step) => typeof step === 'string' && step.trim() !== '')) return false;
  const depth = configKeyPathDepthBySection[keyPath[0]];
  return depth !== undefined && keyPath.length === depth;
}

// the file of the layer that declares the key: the last file of the list
// (the local layer) that exists and holds the key, else the first file (config.yaml)
function configFileForKeyPathGet(fileList: string[], keyPath: string[]): string | undefined {
  for (const filePath of [...fileList].reverse()) {
    if (!fs.existsSync(filePath)) continue;
    if (yamlValueGet(fs.readFileSync(filePath, 'utf-8'), keyPath) !== undefined) return filePath;
  }
  const fileBase = fileList[0];
  return fileBase && fs.existsSync(fileBase) ? fileBase : undefined;
}

// the previous content is kept as {file}.bak, then the file is rewritten
function fileWriteWithBackup(filePath: string, text: string) {
  fs.copyFileSync(filePath, `${filePath}.bak`);
  fs.writeFileSync(filePath, text, 'utf-8');
}

// rewrites one side-panel label in its file. the file is named as the plugin
// annotated it (relative to the config directory) and must be one of the
// files the configuration loads; the operation is built from the parsed
// yaml and applied line by line, so the rest of the file is untouched.
function sidePanelTextRouteHandle(res: ServerResponse, body: any, sidePanel: DocEditSidePanelOptions | undefined) {
  if (!sidePanel) {
    jsonSend(res, 404, { code: -3, data: null, message: 'the page has no side panel file' });
    return;
  }
  const file = String(body?.file ?? '');
  const filePath = sidePanelFilePathGet(sidePanel, file);
  if (!filePath) {
    jsonSend(res, 404, { code: -3, data: null, message: `not a side panel file of the configuration: ${file}` });
    return;
  }
  const textCurrent = fs.readFileSync(filePath, 'utf-8');
  const result = sidePanelTextOperationBuild(textCurrent, {
    nodePath: body?.nodePath,
    language: body?.language,
    text: body?.text,
    textBase: body?.textBase,
  });
  if (result.code !== 0) {
    jsonSend(res, result.code === -2 ? 409 : 400, { code: result.code, data: null, message: result.message });
    return;
  }
  const textNext = lineOperationApply(textCurrent, result.data.operation);
  fileWriteWithBackup(filePath, textNext);
  sidePanel.onFileListWritten([{ filePath, text: textNext }]);
  jsonSend(res, 200, { code: 0, data: { file, fieldName: result.data.fieldName, text: body.text }, message: '' });
}

// moves one side-panel item into another place of its side panel, in its
// file or into another one. both files must be files the configuration
// loads, and both must still have the hash the page loaded them with
// (hashBaseByFile, from configDoc.docEntry.fileHashByFile): the yaml
// addresses of the request are only right for those texts. nothing is
// written unless every file of the move can be; each written file is kept
// as {file}.bak before. the answer names every file changed with its text
// before and after, what a history of the page records to undo the move.
function sidePanelMoveRouteHandle(res: ServerResponse, body: any, sidePanel: DocEditSidePanelOptions | undefined) {
  if (!sidePanel) {
    jsonSend(res, 404, { code: -3, data: null, message: 'the page has no side panel file' });
    return;
  }
  const request = { item: body?.item, target: body?.target };
  if (!sidePanelMoveRequestIsValid(request)) {
    jsonSend(res, 400, { code: -1, data: null, message: 'request needs item { file, path } and target { file, listPath, index }' });
    return;
  }
  const fileList = [...new Set([request.item.file, request.target.file])];
  const textByFile: Record<string, string> = {};
  const filePathByFile: Record<string, string> = {};
  for (const file of fileList) {
    const filePath = sidePanelFilePathGet(sidePanel, file);
    if (!filePath) {
      jsonSend(res, 404, { code: -3, data: null, message: `not a side panel file of the configuration: ${file}` });
      return;
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    const hashBase = body?.hashBaseByFile?.[file];
    if (typeof hashBase !== 'string' || hashBase !== textHashGet(text)) {
      jsonSend(res, 409, {
        code: -2,
        data: null,
        message: `${file} changed since the side panel was loaded; the item was not moved`,
      });
      return;
    }
    textByFile[file] = text;
    filePathByFile[file] = filePath;
  }
  const result = sidePanelMoveBuild(textByFile, request);
  if (result.code !== 0) {
    jsonSend(res, 400, { code: -1, data: null, message: result.message });
    return;
  }
  const fileChangeList = Object.entries(result.data.textAfterByFile).map(([file, textAfter]) => ({
    file,
    hashBefore: textHashGet(textByFile[file]),
    hashAfter: textHashGet(textAfter),
    textBefore: textByFile[file],
    textAfter,
  }));
  for (const change of fileChangeList) fileWriteWithBackup(filePathByFile[change.file], change.textAfter);
  if (fileChangeList.length > 0) {
    const messageLoad = sidePanel.onFileListWritten(
      fileChangeList.map((change) => ({ filePath: filePathByFile[change.file], text: change.textAfter })),
    );
    // valid yaml can still be a configuration that does not load (the item
    // includes a side panel that would now include it): the files go back
    if (messageLoad !== '') {
      for (const change of fileChangeList) fs.writeFileSync(filePathByFile[change.file], change.textBefore, 'utf-8');
      sidePanel.onFileListWritten(fileChangeList.map((change) => ({ filePath: filePathByFile[change.file], text: change.textBefore })));
      jsonSend(res, 400, {
        code: -1,
        data: null,
        message: `the configuration would not load after the move (${messageLoad}); the files were left as they were`,
      });
      return;
    }
  }
  jsonSend(res, 200, { code: 0, data: { fileChangeList }, message: '' });
}

// the absolute path of a side-panel file named relative to the config
// directory, when the configuration loads it
function sidePanelFilePathGet(sidePanel: DocEditSidePanelOptions, file: string): string | undefined {
  if (file === '') return undefined;
  const filePath = path.resolve(sidePanel.configDir, file);
  const isFileLoaded = sidePanel.fileListGet().some((loaded) => path.resolve(loaded) === filePath);
  return isFileLoaded ? filePath : undefined;
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
