import fs from 'node:fs';
import path from 'node:path';
import {
  DOC_MANAGED_MODE_LIST,
  DOC_MANAGED_STORAGE_LIST,
  DocManagedError,
  docManagedBlockContentRead,
  docManagedDirAdd,
  docManagedDocCreate,
  docManagedDocListRead,
  docManagedDocModeSet,
  docManagedFolderListGet,
  docManagedRootCreate,
  docManagedRootListRead,
  docManagedRootRead,
  docManagedRootSet,
  type DocManagedDoc,
  type DocManagedRoot,
} from './doc-managed-store.ts';
import { sourceEntryManagedNowGet, type SourceEntryManaged } from './doc-source-access.ts';
import { sourcePathBuild, sourcePathParse } from '../src/lib/doc-source-path.js';
import { docManagedBlockOutlineGet } from '../src/lib/doc-managed-block.js';

// Managed documents in the source layer of the development server (design:
// doc_page_impl_doc_managed.md#in-the-source): the virtual roots of the doc
// pages the page loads, read as roots of their source (doc-source.ts asks
// here for the documents and folders of an addManaged rule), and the routes
// of the source api that only they have:
//
//   GET  {source}/managed/list                 the virtual roots of every doc page, with their documents
//   GET  {source}/managed/doc/block?path=       the blocks of a document of mode block (its outline)
//   POST {source}/managed/root/create          { docPageAlias, alias, name?, mode?, storage? }
//   POST {source}/managed/root/set             { rootPath, name?, mode?, storage? }   storage: every
//                                              document written again in that form
//   POST {source}/managed/doc/mode/set         { path, mode }
//   POST {source}/managed/dir/create           { dirPath }   a folder kept although empty
//
// a document is created in a virtual root by the ordinary file/create, and moved
// in, out or inside one by file/move (doc-relocate.ts), so these routes are only
// what a folder of files has no counterpart for.

type Answer = { code: number; data: any; message: string };

// the root an addManaged rule names, read now; undefined (and a warning) when it cannot be read
export function docManagedRootOfRuleRead(rule: any, configDir: string): DocManagedRoot | undefined {
  const dirAbs = path.resolve(configDir, rule.path);
  try {
    return docManagedRootRead(dirAbs);
  } catch (error: any) {
    console.warn(`[doc-source] a virtual root cannot be read: ${error?.message ?? error}`);
    return undefined;
  }
}

// the folders of a root: the root itself (''), every folder a document is in, and those kept
export function docManagedDirRelPathListGet(root: DocManagedRoot, docList: DocManagedDoc[]): string[] {
  const relPathSet = new Set<string>(['']);
  const ancestorAdd = (relPath: string) => {
    const segmentList = relPath.split('/').filter(Boolean);
    for (let index = 1; index <= segmentList.length; index += 1) relPathSet.add(segmentList.slice(0, index).join('/'));
  };
  for (const doc of docList) ancestorAdd(doc.record.path.split('/').slice(0, -1).join('/'));
  for (const relPath of root.dirList) ancestorAdd(relPath);
  return [...relPathSet].sort();
}

// the folders holding the virtual roots of every doc page loaded, absolute
export function docManagedFolderListOfConfigGet(configDoc: any): string[] {
  const folderList: string[] = [];
  for (const docPage of (configDoc.docEntry?.docPageList ?? []) as any[]) {
    try {
      folderList.push(...docManagedFolderListGet(docPage.entryFile, docPage.docManaged));
    } catch {
      // the loader reported it
    }
  }
  return folderList;
}

// what a client is told of a managed document (the manifest entry carries it)
export function docManagedInfoBuild(managed: SourceEntryManaged, rootAlias: string) {
  const { record, storage } = managed.doc;
  return { docId: record.docId, rootAlias, mode: record.mode, storage, timeUpdated: record.timeUpdated };
}

// ---------- routes ----------

export type DocManagedRouteContext = {
  // the doc pages loaded now: { alias, entryFile, docManaged, isReadOnly, dirPage }
  docPageListGet: () => any[];
  // the managed entries of the manifest now, by source path
  entryGet: (internalPath: string) => { managed?: SourceEntryManaged; rootAlias: string; docPageAlias: string } | undefined;
  readOnlyReasonGet: (absPath: string) => string;
  // the files written by a route, told before the watcher sees them
  pathListMark: (absPathList: string[]) => void;
  // the configuration read again (a root made or changed): '' or why it does not load
  configurationReload: () => string;
};

export const DOC_MANAGED_ROUTE_LIST = ['/managed/list', '/managed/doc/block', '/managed/root/create', '/managed/root/set', '/managed/doc/mode/set', '/managed/dir/create'];

export function docManagedRouteHandle(route: string, method: string, url: URL, body: any, context: DocManagedRouteContext): Answer {
  try {
    if (route === '/managed/list') return listAnswer(context);
    if (route === '/managed/doc/block') return blockAnswer(url.searchParams.get('path') ?? '', context);
    if (method !== 'POST') return { code: -1, data: null, message: `${route.slice(1)} answers POST only` };
    if (route === '/managed/root/create') return rootCreate(body, context);
    if (route === '/managed/root/set') return rootSet(body, context);
    if (route === '/managed/doc/mode/set') return docModeSet(body, context);
    if (route === '/managed/dir/create') return dirCreate(body, context);
  } catch (error: any) {
    return { code: typeof error?.code === 'number' ? error.code : -1, data: null, message: String(error?.message ?? error) };
  }
  return { code: -1, data: null, message: `unknown route ${route}` };
}

// every doc page with the folder its new roots go to, and its roots with their documents
function listAnswer(context: DocManagedRouteContext): Answer {
  const docPageList = context.docPageListGet().map((docPage) => {
    let folderList: string[] = [];
    let message = '';
    try {
      folderList = docManagedFolderListGet(docPage.entryFile, docPage.docManaged);
    } catch (error: any) {
      message = String(error?.message ?? error);
    }
    const rootList = folderList.flatMap((folder) => docManagedRootListRead(folder)).map((root) => ({
      rootPath: sourcePathBuild(root.alias, '', docPage.alias),
      rootId: root.rootId,
      alias: root.alias,
      name: root.name,
      mode: root.mode,
      storage: root.storage,
      dirList: root.dirList,
      folder: path.relative(docPage.dirPage, root.dirAbs),
      problemList: root.problemList,
      docList: docManagedDocListRead(root).map((doc) => ({
        path: sourcePathBuild(root.alias, doc.record.path, docPage.alias),
        docId: doc.record.docId,
        mode: doc.record.mode,
        storage: doc.storage,
        timeCreated: doc.record.timeCreated,
        timeUpdated: doc.record.timeUpdated,
        size: doc.fileList.reduce((sum, file) => sum + (fs.existsSync(file) ? fs.statSync(file).size : 0), 0),
        fileList: doc.fileList.map((file) => path.basename(file)),
      })),
    }));
    return {
      docPageAlias: docPage.alias,
      isEnabled: docPage.docManaged !== false,
      isReadOnly: docPage.isReadOnly === true,
      folder: folderList[0] ? path.relative(docPage.dirPage, folderList[0]) : '',
      message,
      rootList,
    };
  });
  return { code: 0, data: { docPageList, modeList: DOC_MANAGED_MODE_LIST, storageList: DOC_MANAGED_STORAGE_LIST }, message: '' };
}

function blockAnswer(internalPath: string, context: DocManagedRouteContext): Answer {
  const entry = context.entryGet(internalPath);
  if (!entry?.managed) return { code: -3, data: null, message: `not a managed document: ${internalPath}` };
  const { doc } = sourceEntryManagedNowGet(entry.managed);
  const content = docManagedBlockContentRead(doc);
  if (!content) return { code: 0, data: { mode: doc.record.mode, isStructured: false, rowList: [] }, message: '' };
  return { code: 0, data: { mode: doc.record.mode, isStructured: content.raw === undefined, rowList: docManagedBlockOutlineGet(content) }, message: '' };
}

function docPageOfAliasGet(context: DocManagedRouteContext, alias: string) {
  const docPage = context.docPageListGet().find((item) => item.alias === alias);
  if (!docPage) throw new DocManagedError(-3, `no doc page "${alias}" is loaded`);
  return docPage;
}

function rootCreate(body: any, context: DocManagedRouteContext): Answer {
  const docPage = docPageOfAliasGet(context, String(body?.docPageAlias ?? ''));
  if (docPage.docManaged === false) return { code: -1, data: null, message: `the doc page "${docPage.alias}" has no managed documents (docManaged: false)` };
  const folder = docManagedFolderListGet(docPage.entryFile, docPage.docManaged)[0];
  if (!folder) return { code: -1, data: null, message: `the doc page "${docPage.alias}" names no folder for virtual roots` };
  const reason = context.readOnlyReasonGet(folder);
  if (reason) return { code: -4, data: null, message: reason };
  const alias = String(body?.alias ?? '').trim();
  const isAliasTaken = (docPage.rootList ?? []).some((root: any) => root.alias === alias);
  if (isAliasTaken) return { code: -2, data: null, message: `the doc page "${docPage.alias}" has a root "${alias}" already` };
  const root = docManagedRootCreate(folder, { alias, name: String(body?.name ?? '').trim(), mode: body?.mode, storage: body?.storage });
  context.pathListMark([root.dirAbs, path.join(root.dirAbs, 'root.yaml')]);
  const message = context.configurationReload();
  if (message) {
    fs.rmSync(root.dirAbs, { recursive: true, force: true });
    context.configurationReload();
    return { code: -1, data: null, message };
  }
  return { code: 0, data: { rootPath: sourcePathBuild(root.alias, '', docPage.alias) }, message: '' };
}

// the root a source path names, of a doc page loaded now
function rootOfPathGet(rootPath: string, context: DocManagedRouteContext): { root: DocManagedRoot; docPage: any } {
  const parsed = sourcePathParse(rootPath);
  if (!parsed) throw new DocManagedError(-1, `not a source path: ${rootPath}`);
  const docPageList = context.docPageListGet().filter((item) => parsed.docPageAlias === '' || item.alias === parsed.docPageAlias);
  for (const docPage of docPageList) {
    const rootOne = (docPage.rootList ?? []).find((root: any) => root.alias === parsed.rootAlias && root.kind === 'managed');
    if (rootOne) return { root: docManagedRootRead(rootOne.path), docPage };
  }
  throw new DocManagedError(-3, `not a virtual root: ${rootPath}`);
}

function rootSet(body: any, context: DocManagedRouteContext): Answer {
  const { root } = rootOfPathGet(String(body?.rootPath ?? ''), context);
  const reason = context.readOnlyReasonGet(root.dirAbs);
  if (reason) return { code: -4, data: null, message: reason };
  const change: any = {};
  if (typeof body?.name === 'string') change.name = body.name.trim();
  if (body?.mode !== undefined) change.mode = body.mode;
  if (body?.storage !== undefined) change.storage = body.storage;
  context.pathListMark(docManagedDocListRead(root).flatMap((doc) => doc.fileList));
  const rootNext = docManagedRootSet(root, change);
  context.pathListMark(docManagedDocListRead(rootNext).flatMap((doc) => doc.fileList));
  const message = context.configurationReload();
  return { code: message ? -1 : 0, data: { rootPath: body.rootPath, mode: rootNext.mode, storage: rootNext.storage }, message };
}

function docModeSet(body: any, context: DocManagedRouteContext): Answer {
  const internalPath = String(body?.path ?? '');
  const entry = context.entryGet(internalPath);
  if (!entry?.managed) return { code: -3, data: null, message: `not a managed document: ${internalPath}` };
  const { root, doc } = sourceEntryManagedNowGet(entry.managed);
  const reason = context.readOnlyReasonGet(root.dirAbs);
  if (reason) return { code: -4, data: null, message: reason };
  context.pathListMark(doc.fileList);
  const docNext = docManagedDocModeSet(root, doc, body?.mode);
  context.pathListMark(docNext.fileList);
  const message = context.configurationReload();
  return { code: message ? -1 : 0, data: { path: internalPath, mode: docNext.record.mode }, message };
}

function dirCreate(body: any, context: DocManagedRouteContext): Answer {
  const dirPath = String(body?.dirPath ?? '');
  const parsed = sourcePathParse(dirPath);
  if (!parsed || parsed.relPath === '') return { code: -1, data: null, message: `a folder inside a virtual root: ${dirPath}` };
  const { root } = rootOfPathGet(sourcePathBuild(parsed.rootAlias, '', parsed.docPageAlias), context);
  const reason = context.readOnlyReasonGet(root.dirAbs);
  if (reason) return { code: -4, data: null, message: reason };
  context.pathListMark([path.join(root.dirAbs, 'root.yaml')]);
  docManagedDirAdd(root, parsed.relPath);
  const message = context.configurationReload();
  return { code: message ? -1 : 0, data: { dirPath }, message };
}

// a document written into a folder of a virtual root by file/create: { code, data: { doc }, message }
export function docManagedFileCreate(rootDir: string, relPath: string, text: string): DocManagedDoc {
  const root = docManagedRootRead(rootDir);
  return docManagedDocCreate(root, { path: relPath, text });
}
