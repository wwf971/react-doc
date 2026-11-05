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
import { sidePanelNodeBuild, sidePanelNodeRequestIsValid } from './doc-side-panel-node.ts';
import {
  SourceFileDeleteRequestError,
  sourceFileBackupMove,
  sourceFileBackupRestore,
  sourceFileDeleteListResolve,
  type SourceFileMoved,
} from './doc-source-file.ts';
import { sidePanelTextOperationBuild } from './doc-side-panel-text.ts';
import { yamlValueGet, yamlValueSetOperationBuild, yamlValueTextBuild } from './doc-yaml-edit.ts';
import { workspaceEditBuild } from './doc-workspace-edit.ts';
import { sourcePathLocalGet } from '../src/lib/doc-source-path.js';

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
//        optional filePathDeleteList: [source path]   collected files deleted with the
//                                         write (a block deleted with the files its
//                                         component offered; doc_page_impl_block_ops.md
//                                         #deleting-blocks). allowed with one deleteLines
//                                         operation only; every file is moved to a
//                                         recoverable backup beside it before the
//                                         document is written (sourceFileDeleteApply,
//                                         with doc-source-file.ts)
//   POST {endpoint}/side-panel/text        -> { code: 0, data: { file, fieldName, text } }
//        body { file, nodePath, language, text, textBase }   doc-side-panel-text.ts
//   POST {endpoint}/side-panel/move        -> { code: 0, data: { fileChangeList } }
//        body { item, target, hashBaseByFile }   doc-side-panel-move.ts; one or
//        two files, written together; fileChangeList [{ file, hashBefore,
//        hashAfter, textBefore, textAfter }], empty when nothing moved
//   POST {endpoint}/side-panel/node        -> { code: 0, data: { fileChangeList, fileCreated, fileDeletedList } }
//        body { file, request, hashBase, fileCreate?, filePathDeleteList? }
//        fileCreated: the source path of the created file ('' none),
//        fileDeletedList: the source paths of the deleted files;
//        one node of a side-panel file inserted, removed or bound to another
//        document or folder (doc-side-panel-node.ts). fileCreate { dirPath,
//        name, text }: a document created for an inserted node, in the same
//        request; filePathDeleteList: the document of a removed node,
//        deleted with it into a recoverable backup (doc-source-file.ts)
//   POST {endpoint}/config/value           -> { code: 0, data: { file, keyPath, value } }
//        body { file, keyPath, value, valueBase }   a value of one config declaration of
//                                             the doc page (doc_page_impl_config.md#the-doc-page-layer)
//   POST {endpoint}/workspace/edit         -> { code: 0, data: { file, hash } }
//        body { request, hashBase }   one change of the workspace file (doc-workspace-edit.ts);
//                                     hashBase: the hash the page read it with
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
//   -4  the file belongs to a read-only doc page (a package treated as a doc
//       page, doc_page_impl_package.md#a-package-as-a-doc-page)
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

// the file operations of the doc page source service layer that a write
// of this api performs with it (doc_page_impl_source.md#creating-and-deleting-files)
export type DocEditSourceFileOptions = {
  // a file created in a folder of the source: the source api's own creation
  // (doc-source.ts sourceFileCreate), { code, data: { path, entry }, message }
  create: (body: { dirPath: string; name: string; text: string }) => { code: number; data: any; message: string };
  // the files created, deleted or written as backups by a write, told before
  // anything is reported: the watcher's report of them is not a change made
  // elsewhere, and must not reload the page
  pathListMark: (absPathList: string[]) => void;
  // the source as it is now reported to the page as data (a deletion that
  // came with a document write, which reports only the document)
  dataReport: () => void;
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

// the workspace file route: the file config.yaml names (workspace.file)
export type DocEditWorkspaceOptions = {
  // absolute; '' when the workspace is not a file of its own
  fileGet: () => string;
  // as DocEditSidePanelOptions.onFileListWritten
  onFileListWritten: (fileList: { filePath: string; text: string }[]) => string;
};

export type DocEditMiddlewareOptions = {
  endpoint: string;
  fileEntryListGet: () => DocEditFileEntry[];
  // why a file may not be written ('' when it may): it is in a read-only doc page
  readOnlyReasonGet?: (absPath: string) => string;
  sidePanel?: DocEditSidePanelOptions;
  config?: DocEditConfigOptions;
  workspace?: DocEditWorkspaceOptions;
  sourceFile?: DocEditSourceFileOptions;
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

// a write into a read-only doc page answered with its reason; true when refused
function readOnlySend(res: ServerResponse, options: DocEditMiddlewareOptions, absPath: string): boolean {
  const reason = options.readOnlyReasonGet?.(absPath) ?? '';
  if (reason === '') return false;
  jsonSend(res, 403, { code: -4, data: null, message: reason });
  return true;
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
    if (readOnlySend(res, options, entry.absPath)) return;
    const operationList = Array.isArray(body?.operationList) ? body.operationList : undefined;
    const isOperationValid = operationList
      ? operationList.length > 0 && operationList.every((operation: unknown) => lineOperationIsValid(operation))
      : lineOperationIsValid(body?.operation);
    if (typeof body?.hashBase !== 'string' || !isOperationValid) {
      jsonSend(res, 400, { code: -1, data: null, message: 'request needs hashBase and a valid line operation (or a list of them)' });
      return;
    }
    const filePathDeleteList = body?.filePathDeleteList ?? [];
    if (!Array.isArray(filePathDeleteList) || !filePathDeleteList.every((item: unknown) => typeof item === 'string')) {
      jsonSend(res, 400, { code: -1, data: null, message: 'filePathDeleteList must be a list of source paths' });
      return;
    }
    if (filePathDeleteList.length > 0 && (operationList || body.operation.action !== 'deleteLines')) {
      jsonSend(res, 400, { code: -1, data: null, message: 'files are deleted with one deleteLines operation only (a block deletion)' });
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
    if (filePathDeleteList.length === 0) {
      fs.writeFileSync(entry.absPath, textNext, 'utf-8');
    } else {
      try {
        const fileList = sourceFileDeleteListResolve(filePathDeleteList, fileEntryListGet(), [entry.absPath]);
        options.sourceFile?.pathListMark(fileList.map((item) => item.absPath));
        const movedList = sourceFileDeleteApply(entry, textCurrent, textNext, filePathDeleteList, fileEntryListGet());
        options.sourceFile?.pathListMark(movedList.map((item) => item.backup));
        options.sourceFile?.dataReport();
      } catch (error: any) {
        if (!(error instanceof SourceFileDeleteRequestError)) throw error;
        jsonSend(res, 400, { code: -1, data: null, message: error.message });
        return;
      }
    }
    jsonSend(res, 200, { code: 0, data: sourceDataBuild(entry, textNext), message: '' });
    return;
  }

  if (req.method === 'POST' && route === '/side-panel/text') {
    const body = await jsonBodyRead(req);
    sidePanelTextRouteHandle(res, body, options.sidePanel, options);
    return;
  }

  if (req.method === 'POST' && route === '/side-panel/move') {
    const body = await jsonBodyRead(req);
    sidePanelMoveRouteHandle(res, body, options.sidePanel, options);
    return;
  }

  if (req.method === 'POST' && route === '/side-panel/node') {
    const body = await jsonBodyRead(req);
    sidePanelNodeRouteHandle(res, body, options);
    return;
  }

  if (req.method === 'POST' && route === '/config/value') {
    const body = await jsonBodyRead(req);
    configValueRouteHandle(res, body, options.config, options);
    return;
  }

  if (req.method === 'POST' && route === '/workspace/edit') {
    const body = await jsonBodyRead(req);
    workspaceEditRouteHandle(res, body, options.workspace);
    return;
  }

  jsonSend(res, 404, { code: -1, data: null, message: `unknown edit api route: ${req.method} ${route}` });
}

// one change of the workspace file, built in place by doc-workspace-edit.ts.
// the file must be the one the hash names (-2 otherwise); the
// configuration must load after the write, else the file is written back.
function workspaceEditRouteHandle(res: ServerResponse, body: any, workspace: DocEditWorkspaceOptions | undefined) {
  const filePath = workspace?.fileGet() ?? '';
  if (!workspace || filePath === '' || !fs.existsSync(filePath)) {
    jsonSend(res, 404, { code: -3, data: null, message: 'the workspace is not a file of its own (config.yaml workspace.file); nothing to edit' });
    return;
  }
  const textCurrent = fs.readFileSync(filePath, 'utf-8');
  if (typeof body?.hashBase === 'string' && body.hashBase !== textHashGet(textCurrent)) {
    jsonSend(res, 409, { code: -2, data: null, message: 'the workspace file changed since the page read it; the edit was not applied' });
    return;
  }
  const result = workspaceEditBuild(textCurrent, body?.request);
  if (result.code !== 0) {
    jsonSend(res, 400, { code: -1, data: null, message: result.message });
    return;
  }
  if (result.data.text === textCurrent) {
    jsonSend(res, 200, { code: 0, data: { hash: textHashGet(textCurrent) }, message: '' });
    return;
  }
  fileWriteWithBackup(filePath, result.data.text);
  const messageLoad = workspace.onFileListWritten([{ filePath, text: result.data.text }]);
  if (messageLoad !== '') {
    fs.writeFileSync(filePath, textCurrent, 'utf-8');
    jsonSend(res, 400, {
      code: -1,
      data: null,
      message: `the workspace would not load after the edit (${messageLoad.replace(/^\[doc-source\] /, '')}); the file was left as it was`,
    });
    return;
  }
  jsonSend(res, 200, { code: 0, data: { hash: textHashGet(result.data.text) }, message: '' });
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
function configValueRouteHandle(res: ServerResponse, body: any, config: DocEditConfigOptions | undefined, options: DocEditMiddlewareOptions) {
  if (!config) {
    jsonSend(res, 404, { code: -3, data: null, message: 'the page has no config declaration to write' });
    return;
  }
  const file = String(body?.file ?? '');
  if (readOnlySend(res, options, path.resolve(config.configDir, file))) return;
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
function sidePanelTextRouteHandle(res: ServerResponse, body: any, sidePanel: DocEditSidePanelOptions | undefined, options: DocEditMiddlewareOptions) {
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
  if (readOnlySend(res, options, filePath)) return;
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
function sidePanelMoveRouteHandle(res: ServerResponse, body: any, sidePanel: DocEditSidePanelOptions | undefined, options: DocEditMiddlewareOptions) {
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
    if (readOnlySend(res, options, filePath)) return;
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

// one node of a side-panel file inserted, removed or bound to another
// document or folder (doc-side-panel-node.ts). the file must be one the
// configuration loads, with the hash the page built its side panel from.
// a document created for an inserted node (fileCreate) and the document of a
// removed node (filePathDeleteList) go in the same request as the yaml
// write, through the file operations of the source layer: two requests
// would leave a node without its document, or a document without its node,
// when the second one fails. the order: the file first (created, or moved
// into its backup), then the yaml; a yaml write that fails, or a
// configuration that does not load afterwards, puts the file back.
function sidePanelNodeRouteHandle(res: ServerResponse, body: any, options: DocEditMiddlewareOptions) {
  const { sidePanel, sourceFile } = options;
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
  if (readOnlySend(res, options, filePath)) return;
  const request = body?.request;
  if (!sidePanelNodeRequestIsValid(request)) {
    jsonSend(res, 400, { code: -1, data: null, message: 'request needs an action (insert | remove | bind) with its yaml addresses' });
    return;
  }
  const fileCreate = body?.fileCreate;
  const filePathDeleteList: unknown = body?.filePathDeleteList ?? [];
  if (fileCreate !== undefined && (request.action !== 'insert' || request.node.kind !== 'doc')) {
    jsonSend(res, 400, { code: -1, data: null, message: 'a file is created for an inserted document node only' });
    return;
  }
  if (!Array.isArray(filePathDeleteList) || !filePathDeleteList.every((item) => typeof item === 'string')) {
    jsonSend(res, 400, { code: -1, data: null, message: 'filePathDeleteList must be a list of source paths' });
    return;
  }
  if (filePathDeleteList.length > 0 && request.action !== 'remove') {
    jsonSend(res, 400, { code: -1, data: null, message: 'files are deleted with a removed node only' });
    return;
  }
  if ((fileCreate !== undefined || filePathDeleteList.length > 0) && !sourceFile) {
    jsonSend(res, 404, { code: -3, data: null, message: 'the server creates and deletes no source file' });
    return;
  }
  const textBefore = fs.readFileSync(filePath, 'utf-8');
  if (typeof body?.hashBase !== 'string' || body.hashBase !== textHashGet(textBefore)) {
    jsonSend(res, 409, { code: -2, data: null, message: `${file} changed since the side panel was loaded; nothing was changed` });
    return;
  }
  const result = sidePanelNodeBuild(textBefore, request);
  if (result.code !== 0) {
    jsonSend(res, 400, { code: -1, data: null, message: `${file}: ${result.message}` });
    return;
  }
  const textAfter = result.data.text;

  // the file of the source, before the yaml
  let fileCreated: { path: string; absPath: string } | undefined;
  let movedList: SourceFileMoved[] = [];
  let pathDeletedList: string[] = [];
  if (fileCreate !== undefined && sourceFile) {
    const docText = String(request.action === 'insert' && request.node.kind === 'doc' ? request.node.doc : '');
    const created = sourceFile.create({
      dirPath: String(fileCreate?.dirPath ?? ''),
      name: String(fileCreate?.name ?? ''),
      text: typeof fileCreate?.text === 'string' ? fileCreate.text : '',
    });
    if (created.code !== 0) {
      jsonSend(res, created.code === -2 ? 409 : 400, { code: created.code, data: null, message: created.message });
      return;
    }
    fileCreated = { path: created.data.path, absPath: created.data.entry.absPath };
    sourceFile.pathListMark([fileCreated.absPath]);
    // the node names the file it was created for
    if (sourcePathLocalGet(fileCreated.path) !== sourcePathLocalGet(docText)) {
      fs.rmSync(fileCreated.absPath, { force: true });
      jsonSend(res, 400, { code: -1, data: null, message: `the node names ${docText}, the file was created as ${fileCreated.path}; nothing was kept` });
      return;
    }
  }
  if (filePathDeleteList.length > 0 && sourceFile) {
    try {
      const fileList = sourceFileDeleteListResolve(filePathDeleteList, options.fileEntryListGet());
      sourceFile.pathListMark(fileList.map((item) => item.absPath));
      movedList = sourceFileBackupMove(fileList);
      pathDeletedList = fileList.map((item) => item.internalPath);
      sourceFile.pathListMark(movedList.map((item) => item.backup));
    } catch (error: any) {
      if (!(error instanceof SourceFileDeleteRequestError)) throw error;
      jsonSend(res, 400, { code: -1, data: null, message: error.message });
      return;
    }
  }
  const sourceFileRestore = () => {
    if (fileCreated) fs.rmSync(fileCreated.absPath, { force: true });
    sourceFileBackupRestore(movedList);
  };

  try {
    fileWriteWithBackup(filePath, textAfter);
  } catch (error) {
    sourceFileRestore();
    throw error;
  }
  const messageLoad = sidePanel.onFileListWritten([{ filePath, text: textAfter }]);
  if (messageLoad !== '') {
    fs.writeFileSync(filePath, textBefore, 'utf-8');
    sourceFileRestore();
    sidePanel.onFileListWritten([{ filePath, text: textBefore }]);
    jsonSend(res, 400, {
      code: -1,
      data: null,
      message: `the configuration would not load after the change (${messageLoad}); the files were left as they were`,
    });
    return;
  }
  jsonSend(res, 200, {
    code: 0,
    data: {
      fileChangeList: [{ file, hashBefore: textHashGet(textBefore), hashAfter: textHashGet(textAfter), textBefore, textAfter }],
      fileCreated: fileCreated?.path ?? '',
      fileDeletedList: pathDeletedList,
    },
    message: '',
  });
}

// the absolute path of a side-panel file named relative to the config
// directory, when the configuration loads it
function sidePanelFilePathGet(sidePanel: DocEditSidePanelOptions, file: string): string | undefined {
  if (file === '') return undefined;
  const filePath = path.resolve(sidePanel.configDir, file);
  const isFileLoaded = sidePanel.fileListGet().some((loaded) => path.resolve(loaded) === filePath);
  return isFileLoaded ? filePath : undefined;
}

// the write of a block deletion together with the files chosen for it
// (doc_page_impl_block_ops.md#deleting-blocks): every path is resolved
// through the collected source first (an unknown path, a path that is not
// a regular file (a symlink is not), or the document itself refuses the
// whole request), then each file is renamed into its backup
// (doc-source-file.ts), and the document is written last. a failure caught
// on the way puts the renamed files back and the document back to its
// previous text, then rethrows for the middleware's error response. this is
// best effort for caught errors, not a transaction: a crash in the middle,
// or a failure of the restoring itself, leaves what was done. the server
// does not know which block the files belonged to: the page chooses among
// what the component offered, and the server checks that the files are
// collected regular files
export function sourceFileDeleteApply(
  entry: DocEditFileEntry,
  textCurrent: string,
  textNext: string,
  filePathDeleteList: string[],
  fileEntryList: DocEditFileEntry[],
): SourceFileMoved[] {
  const fileList = sourceFileDeleteListResolve(filePathDeleteList, fileEntryList, [entry.absPath]);
  const movedList = sourceFileBackupMove(fileList);
  try {
    fs.writeFileSync(entry.absPath, textNext, 'utf-8');
  } catch (error) {
    sourceFileBackupRestore(movedList);
    try {
      if (fs.readFileSync(entry.absPath, 'utf-8') !== textCurrent) fs.writeFileSync(entry.absPath, textCurrent, 'utf-8');
    } catch {
      // the document could not be read or written back
    }
    throw error;
  }
  return movedList;
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
