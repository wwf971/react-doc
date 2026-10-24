import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import {
  lineOperationApply,
  lineOperationIsValid,
  lineOperationListApply,
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
//          or { internalPath, hashBase, operationList }  several operations built on
//                                         the same text, applied together (moving blocks)
//   POST {endpoint}/side-panel/text        -> { code: 0, data: { file, fieldName, text } }
//        body { file, nodePath, language, text, textBase }   doc-side-panel-text.ts
//   POST {endpoint}/side-panel/move        -> { code: 0, data: { fileChangeList } }
//        body { item, target, hashBaseByFile }   doc-side-panel-move.ts; one or
//        two files, written together; fileChangeList [{ file, hashBefore,
//        hashAfter, textBefore, textAfter }], empty when nothing moved
//   POST {endpoint}/config/value           -> { code: 0, data: { file, keyPath, value } }
//        body { file, keyPath, value, valueBase }   a value of one config declaration of
//                                             the doc page (doc_page_impl_config.md#the-doc-page-layer)
//
// every response is { code, data, message }. code 0 is success; negative codes:
//   -1  bad request or unexpected failure
//   -2  hashBase is not the hash of the file on disk (changed elsewhere), the
//       side-panel label is no longer the one the edit started from, a
//       side-panel file of a move changed since the page loaded it, or the
//       config value in the file is no longer the one the page displayed
//   -3  the path is not an editable document of the collected source, the
//       file is not a loaded side-panel file, or the key path is not inside a
//       config declaration the configuration loads
//
// only md/mdx files of the current file manifest can be read or written, so
// the source rules of config.yaml also bound what the page may edit. only
// the side-panel files the configuration loads can have a label rewritten;
// only an existing key of a config declaration of the doc page can receive
// a value (config.yaml, the default layer, is never written from the page). every yaml file is edited in place (doc-yaml-edit.ts),
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

// the config value route: the config declarations of the doc page
export type DocEditConfigOptions = {
  configDir: string;
  // the declarations the configuration loads now: file relative to the
  // config directory, yaml address of the declared mapping
  declarationListGet: () => { file: string; path: (string | number)[] }[];
  // as DocEditSidePanelOptions.onFileListWritten
  onFileListWritten: (fileList: { filePath: string; text: string }[]) => string;
};

export type DocEditMiddlewareOptions = {
  endpoint: string;
  fileEntryListGet: () => DocEditFileEntry[];
  sidePanel?: DocEditSidePanelOptions;
  config?: DocEditConfigOptions;
};

// what follows the address of a declaration in a config/value key path:
// [Key] or [compConfig, CompName, Key]
const COMP_CONFIG_KEY = 'compConfig';

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
    const operationList = Array.isArray(body?.operationList) ? body.operationList : undefined;
    const isOperationValid = operationList
      ? operationList.length > 0 && operationList.every((operation: unknown) => lineOperationIsValid(operation))
      : lineOperationIsValid(body?.operation);
    if (typeof body?.hashBase !== 'string' || !isOperationValid) {
      jsonSend(res, 400, { code: -1, data: null, message: 'request needs hashBase and a valid line operation (or a list of them)' });
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
      textNext = operationList
        ? lineOperationListApply(textCurrent, operationList as LineOperation[])
        : lineOperationApply(textCurrent, body.operation as LineOperation);
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

// writes one value of a config declaration of the doc page in place.
//   file        the file of the declaration, relative to the config directory
//   keyPath     the yaml address of the declaration, then [Key] or
//               [compConfig, CompName, Key]; the key must be declared already
//               (a new key, or a new declaration, is not written from the page)
//   value       null, boolean, number, string, or a list of strings
//   valueBase   the value the page displayed for the key, as the file
//               declares it; when the file says otherwise now, the write is
//               refused (-2)
// the previous file is kept as {file}.bak before the write.
function configValueRouteHandle(res: ServerResponse, body: any, config: DocEditConfigOptions | undefined) {
  if (!config) {
    jsonSend(res, 404, { code: -3, data: null, message: 'the page has no config declaration to write' });
    return;
  }
  const file = String(body?.file ?? '');
  const keyPath = body?.keyPath;
  if (!Array.isArray(keyPath) || !keyPath.every((step) => (typeof step === 'string' && step.trim() !== '') || Number.isInteger(step))) {
    jsonSend(res, 400, { code: -1, data: null, message: 'keyPath must be a list of keys and list indexes' });
    return;
  }
  const declaration = config.declarationListGet().find((declarationOne) => (
    declarationOne.file === file && configKeyPathIsInside(keyPath, declarationOne.path)
  ));
  if (!declaration) {
    jsonSend(res, 404, {
      code: -3,
      data: null,
      message: `${keyPath.join('.')} of ${file} is not a key of a config declaration the doc page loads`,
    });
    return;
  }
  const valueText = yamlValueTextBuild(body?.value);
  if (valueText === undefined) {
    jsonSend(res, 400, { code: -1, data: null, message: 'value must be null, a boolean, a number, a string, or a list of strings' });
    return;
  }
  const filePath = path.resolve(config.configDir, file);
  const textCurrent = fs.readFileSync(filePath, 'utf-8');
  const valueCurrent = yamlValueGet(textCurrent, keyPath);
  if (valueCurrent === undefined) {
    jsonSend(res, 404, { code: -3, data: null, message: `${keyPath.join('.')} is not declared in ${file}; keys are added in the file` });
    return;
  }
  if ('valueBase' in (body ?? {}) && JSON.stringify(valueCurrent ?? null) !== JSON.stringify(body.valueBase ?? null)) {
    jsonSend(res, 409, {
      code: -2,
      data: { file, keyPath, value: valueCurrent },
      message: `the value of ${keyPath.join('.')} changed in ${file} since it was displayed; the edit was not applied`,
    });
    return;
  }
  const result = yamlValueSetOperationBuild(textCurrent, keyPath, valueText);
  if (result.code !== 0) {
    jsonSend(res, 400, { code: -1, data: null, message: `${file}: ${result.message}` });
    return;
  }
  const textNext = lineOperationApply(textCurrent, result.data.operation);
  fileWriteWithBackup(filePath, textNext);
  const messageLoad = config.onFileListWritten([{ filePath, text: textNext }]);
  if (messageLoad !== '') {
    fs.writeFileSync(filePath, textCurrent, 'utf-8');
    jsonSend(res, 400, {
      code: -1,
      data: null,
      message: `the configuration would not load after the edit (${messageLoad}); the file was left as it was`,
    });
    return;
  }
  jsonSend(res, 200, { code: 0, data: { file, keyPath, value: body.value }, message: '' });
}

// keyPath is a key of the declaration at declarationPath: [...declarationPath, Key]
// or [...declarationPath, compConfig, CompName, Key]
function configKeyPathIsInside(keyPath: (string | number)[], declarationPath: (string | number)[]): boolean {
  if (!declarationPath.every((step, index) => keyPath[index] === step)) return false;
  const rest = keyPath.slice(declarationPath.length);
  if (!rest.every((step) => typeof step === 'string')) return false;
  if (rest.length === 1) return rest[0] !== COMP_CONFIG_KEY;
  return rest.length === 3 && rest[0] === COMP_CONFIG_KEY;
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
