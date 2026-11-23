import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { idMs48Create, idMs48Is } from './id-ms48.ts';
import { lineOperationApply, textHashGet } from './doc-edit-lines.ts';
import { yamlScalarTextBuild, yamlValueSetOperationBuild, yamlValueTextBuild } from './doc-yaml-edit.ts';
import { fileWriteSafe, itemDirNameBuild } from './doc-asset-store.ts';
import { sourceAliasIsValid } from '../src/lib/doc-source-path.js';
import { timeTextGet } from '../src/lib/time-text.js';
import {
  DOC_MANAGED_PACK_EXT,
  docManagedPackDecode,
  docManagedPackEncode,
  docManagedPackRecordRead,
} from '../src/lib/doc-managed-pack.js';
import { docManagedBlockContentBuild, docManagedBlockTextBuild } from '../src/lib/doc-managed-block.js';

// The store of managed documents (design: doc_page_impl_doc_managed.md): the
// documents the page keeps itself, under virtual roots, in folders of the
// metadata folder of a doc page. A virtual root is one folder, flat: its
// documents lie directly in it, named by id, whatever the path they have in
// the root; the path is in the record of each. The folder is the root, so
// copying it into the doc-managed folder of another doc page moves the root
// with its documents.
//
//   .doc-page/doc-managed/{rootId}--{alias}/
//     root.yaml                       rootId, alias, name, mode, storage, dirList
//     plain form (git-friendly, the default on a local file system):
//       {docId}--{name}.doc.yaml       the record: docId, path, mode, times, hash
//       {docId}--{name}.md | .mdx      mode text: the text as it is
//       {docId}--{name}.block.yaml     mode block: the blocks (doc-managed-block.js)
//     pack form (one binary file per document, the form a cloud keeps):
//       {docId}--{name}.rdoc           the record and the content (doc-managed-pack.js)
//     .{file}.{uuid}.deleted          a document deleted from the page, its files kept
//                                     as hidden backups (doc-source-file.ts)
//
// the core of this module, read first:
//   docManagedRootRead / docManagedDocListRead   what a root holds
//   docManagedTextRead / docManagedTextWrite     a document read and written as text,
//                                                whatever its mode and form
//   docManagedDocCreate / docManagedDocPathSet / docManagedDocMove   documents made and moved
//   docManagedRootCreate / docManagedRootSet     roots made, a form or a mode changed

export const DOC_MANAGED_FOLDER_NAME = 'doc-managed';
export const DOC_MANAGED_CONFIG_FILE_NAME = 'doc-managed.yaml';
export const DOC_MANAGED_ROOT_FILE_NAME = 'root.yaml';
export const DOC_MANAGED_MODE_LIST = ['text', 'block'] as const;
export const DOC_MANAGED_STORAGE_LIST = ['plain', 'pack'] as const;
export type DocManagedMode = typeof DOC_MANAGED_MODE_LIST[number];
export type DocManagedStorage = typeof DOC_MANAGED_STORAGE_LIST[number];

const SEPARATOR = '--';
const SUFFIX_RECORD = '.doc.yaml';
const SUFFIX_BLOCK = '.block.yaml';
const SUFFIX_PACK = `.${DOC_MANAGED_PACK_EXT}`;
const DOC_EXT_LIST = ['md', 'mdx'];

export class DocManagedError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export type DocManagedRoot = {
  rootId: string;
  // the root segment of the source paths of its documents (~{alias}/...)
  alias: string;
  // what a reader is shown ('' for the alias)
  name: string;
  // the mode and the form of a new document
  mode: DocManagedMode;
  storage: DocManagedStorage;
  // folders kept although no document is in them, paths in the root
  dirList: string[];
  // the folder of the root, absolute
  dirAbs: string;
  problemList: string[];
};

export type DocManagedRecord = {
  docId: string;
  // where the document is in its root: folders and its file name (a.md, guide/b.mdx)
  path: string;
  mode: DocManagedMode;
  timeCreated: string;
  timeUpdated: string;
  // sha1 of its text, as the source reads it
  hash: string;
};

export type DocManagedDoc = {
  record: DocManagedRecord;
  // the form it is found in
  storage: DocManagedStorage;
  // {docId}--{name}: what its files are named after
  base: string;
  // the file holding its content (the text, the blocks, the pack file), absolute
  fileMain: string;
  // every file of the document, absolute
  fileList: string[];
};

// ---------- roots ----------

// the folders holding the virtual roots of a doc page: the convention folder
// beside its entry, or those of its config file (folderList, relative to it);
// none with "docManaged: false". section: the "docManaged" of the entry as written
export function docManagedFolderListGet(entryFile: string, section: undefined | false | { file: string }): string[] {
  if (section === false) return [];
  const dirMeta = path.dirname(entryFile);
  const configFile = section ? path.resolve(dirMeta, section.file) : path.join(dirMeta, DOC_MANAGED_CONFIG_FILE_NAME);
  if (!fs.existsSync(configFile)) {
    if (section) throw new DocManagedError(-1, `[doc-managed] the config file the entry names does not exist: ${configFile}`);
    return [path.join(dirMeta, DOC_MANAGED_FOLDER_NAME)];
  }
  const content = yamlParse(fs.readFileSync(configFile, 'utf-8')) ?? {};
  const folderList = Array.isArray(content?.folderList) ? content.folderList : [];
  if (!folderList.every((item: unknown) => typeof item === 'string' && item.trim() !== '')) {
    throw new DocManagedError(-1, `[doc-managed] folderList of ${configFile} must be a list of folders`);
  }
  return folderList.map((item: string) => path.resolve(path.dirname(configFile), item));
}

// the roots in a folder: every folder holding root.yaml. a folder that does
// not exist holds none
export function docManagedRootListRead(folderAbs: string): DocManagedRoot[] {
  if (!fs.existsSync(folderAbs)) return [];
  const rootList: DocManagedRoot[] = [];
  for (const item of fs.readdirSync(folderAbs, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name.startsWith('.')) continue;
    const dirAbs = path.join(folderAbs, item.name);
    if (!fs.existsSync(path.join(dirAbs, DOC_MANAGED_ROOT_FILE_NAME))) continue;
    rootList.push(docManagedRootRead(dirAbs));
  }
  return rootList.sort((rootA, rootB) => rootA.alias.localeCompare(rootB.alias));
}

export function docManagedRootRead(dirAbs: string): DocManagedRoot {
  const file = path.join(dirAbs, DOC_MANAGED_ROOT_FILE_NAME);
  let content: any;
  try {
    content = yamlParse(fs.readFileSync(file, 'utf-8')) ?? {};
  } catch (error: any) {
    throw new DocManagedError(-1, `[doc-managed] ${file} does not parse: ${error?.message ?? error}`);
  }
  const problemList: string[] = [];
  const folderName = path.basename(dirAbs);
  const rootIdOfFolder = folderName.split(SEPARATOR, 1)[0];
  const rootId = idMs48Is(content.rootId) ? content.rootId : rootIdOfFolder;
  if (!idMs48Is(rootId)) throw new DocManagedError(-1, `[doc-managed] ${file}: rootId is not an id`);
  const alias = String(content.alias ?? '');
  if (!sourceAliasIsValid(alias)) {
    throw new DocManagedError(-1, `[doc-managed] ${file}: the alias of a root must be one word (letters, digits, "_", "-", "."): ${JSON.stringify(alias)}`);
  }
  const mode: DocManagedMode = DOC_MANAGED_MODE_LIST.includes(content.mode) ? content.mode : 'text';
  if (content.mode !== undefined && mode !== content.mode) problemList.push(`mode ${JSON.stringify(content.mode)} is not one of ${DOC_MANAGED_MODE_LIST.join(', ')}; text is used`);
  const storage: DocManagedStorage = DOC_MANAGED_STORAGE_LIST.includes(content.storage) ? content.storage : 'plain';
  if (content.storage !== undefined && storage !== content.storage) problemList.push(`storage ${JSON.stringify(content.storage)} is not one of ${DOC_MANAGED_STORAGE_LIST.join(', ')}; plain is used`);
  const dirList = Array.isArray(content.dirList) ? content.dirList.map((one: unknown) => relPathNormalize(String(one))).filter(Boolean) : [];
  return { rootId, alias, name: String(content.name ?? ''), mode, storage, dirList, dirAbs, problemList };
}

// a new root in folderAbs (made with it when missing): its folder and root.yaml
export function docManagedRootCreate(
  folderAbs: string,
  { alias, name = '', mode = 'text', storage = 'plain' }: { alias: string; name?: string; mode?: DocManagedMode; storage?: DocManagedStorage },
): DocManagedRoot {
  if (!sourceAliasIsValid(alias)) throw new DocManagedError(-1, `the alias of a root must be one word (letters, digits, "_", "-", "."): ${JSON.stringify(alias)}`);
  if (!DOC_MANAGED_MODE_LIST.includes(mode)) throw new DocManagedError(-1, `the mode is one of ${DOC_MANAGED_MODE_LIST.join(', ')}`);
  if (!DOC_MANAGED_STORAGE_LIST.includes(storage)) throw new DocManagedError(-1, `the storage is one of ${DOC_MANAGED_STORAGE_LIST.join(', ')}`);
  const rootListExisting = docManagedRootListRead(folderAbs);
  if (rootListExisting.some((root) => root.alias === alias)) throw new DocManagedError(-2, `a virtual root "${alias}" exists already`);
  const rootId = idMs48Create((id) => rootListExisting.some((root) => root.rootId === id));
  const dirAbs = path.join(folderAbs, `${rootId}${SEPARATOR}${alias}`);
  fs.mkdirSync(dirAbs, { recursive: true });
  const lineList = [
    '# a virtual root of managed documents (doc_page_impl_doc_managed.md); its documents lie beside this file',
    `rootId: ${rootId}`,
    `alias: ${alias}`,
    ...(name ? [`name: ${yamlScalarTextBuild(name)}`] : []),
    `mode: ${mode}`,
    `storage: ${storage}`,
    '',
  ];
  fs.writeFileSync(path.join(dirAbs, DOC_MANAGED_ROOT_FILE_NAME), lineList.join('\n'), 'utf-8');
  return docManagedRootRead(dirAbs);
}

// the name, the mode of new documents, or the storage form of a root; a form
// changed writes every document of the root in the new form
export function docManagedRootSet(root: DocManagedRoot, change: { name?: string; mode?: DocManagedMode; storage?: DocManagedStorage }): DocManagedRoot {
  if (change.mode !== undefined && !DOC_MANAGED_MODE_LIST.includes(change.mode)) throw new DocManagedError(-1, `the mode is one of ${DOC_MANAGED_MODE_LIST.join(', ')}`);
  if (change.storage !== undefined && !DOC_MANAGED_STORAGE_LIST.includes(change.storage)) throw new DocManagedError(-1, `the storage is one of ${DOC_MANAGED_STORAGE_LIST.join(', ')}`);
  const fieldList: [string, string][] = [];
  if (change.name !== undefined) fieldList.push(['name', yamlScalarTextBuild(change.name)]);
  if (change.mode !== undefined) fieldList.push(['mode', change.mode]);
  if (change.storage !== undefined) fieldList.push(['storage', change.storage]);
  rootFileFieldListSet(root, fieldList);
  const rootNext = docManagedRootRead(root.dirAbs);
  if (change.storage !== undefined && change.storage !== root.storage) {
    for (const doc of docManagedDocListRead(rootNext)) docManagedDocStorageSet(rootNext, doc, change.storage);
  }
  return rootNext;
}

// a folder of the root kept although no document is in it (a folder made from
// the page, before its first document); one a document is in needs none
export function docManagedDirAdd(root: DocManagedRoot, relPath: string): DocManagedRoot {
  const relPathNormalized = relPathNormalize(relPath);
  if (!relPathNormalized) throw new DocManagedError(-1, 'a folder of a root has a path');
  if (root.dirList.includes(relPathNormalized)) return root;
  rootFileFieldListSet(root, [['dirList', yamlValueTextBuild([...root.dirList, relPathNormalized].sort())!]]);
  return docManagedRootRead(root.dirAbs);
}

function rootFileFieldListSet(root: DocManagedRoot, fieldList: [string, string][]) {
  const file = path.join(root.dirAbs, DOC_MANAGED_ROOT_FILE_NAME);
  let text = fs.readFileSync(file, 'utf-8');
  for (const [key, valueText] of fieldList) {
    const result = yamlValueSetOperationBuild(text, [key], valueText);
    if (result.code !== 0) throw new DocManagedError(-1, `${file}: ${result.message}`);
    text = lineOperationApply(text, result.data.operation);
  }
  fileWriteSafe(file, text);
}

// ---------- documents ----------

// the documents of a root, by path. the files of one document share its id;
// a document found in both forms (a change of form cut short) is read in the
// form of the root, and its other files are reported
export function docManagedDocListRead(root: DocManagedRoot): DocManagedDoc[] {
  const fileListById = new Map<string, string[]>();
  for (const item of fs.readdirSync(root.dirAbs, { withFileTypes: true })) {
    if (!item.isFile() || item.name.startsWith('.') || item.name === DOC_MANAGED_ROOT_FILE_NAME) continue;
    if (item.name.endsWith('.bak') || item.name.endsWith('.tmp')) continue;
    const docId = docIdOfFileNameGet(item.name);
    if (!docId) continue;
    const list = fileListById.get(docId) ?? [];
    list.push(path.join(root.dirAbs, item.name));
    fileListById.set(docId, list);
  }
  const docList: DocManagedDoc[] = [];
  for (const [docId, fileList] of fileListById) {
    const doc = docOfFileListRead(root, docId, fileList);
    if (doc) docList.push(doc);
  }
  return docList.sort((docA, docB) => docA.record.path.localeCompare(docB.record.path));
}

export function docManagedDocFind(root: DocManagedRoot, docId: string): DocManagedDoc | undefined {
  return docManagedDocListRead(root).find((doc) => doc.record.docId === docId);
}

function docOfFileListRead(root: DocManagedRoot, docId: string, fileList: string[]): DocManagedDoc | undefined {
  const filePack = fileList.find((file) => file.endsWith(SUFFIX_PACK));
  const fileRecord = fileList.find((file) => file.endsWith(SUFFIX_RECORD));
  const storage: DocManagedStorage | undefined = filePack && fileRecord ? root.storage : filePack ? 'pack' : fileRecord ? 'plain' : undefined;
  if (!storage) return undefined;
  let record: DocManagedRecord;
  let fileMain: string;
  let fileListOwn: string[];
  if (storage === 'pack') {
    record = recordNormalize(docManagedPackRecordRead(fs.readFileSync(filePack!)), docId, filePack!);
    fileMain = filePack!;
    fileListOwn = [filePack!];
  } else {
    record = recordNormalize(yamlParse(fs.readFileSync(fileRecord!, 'utf-8')) ?? {}, docId, fileRecord!);
    const base = fileRecord!.slice(0, -SUFFIX_RECORD.length);
    fileMain = record.mode === 'block' ? `${base}${SUFFIX_BLOCK}` : `${base}.${extOfPathGet(record.path)}`;
    fileListOwn = [fileRecord!, ...(fs.existsSync(fileMain) ? [fileMain] : [])];
  }
  const base = path.basename(fileMain).replace(/\.(doc\.yaml|block\.yaml|rdoc|mdx?)$/, '');
  return { record, storage, base, fileMain, fileList: fileListOwn };
}

// the text of a document, whatever its mode and form; read once per change of its file
const textCacheByFile = new Map<string, { key: string; text: string }>();
export function docManagedTextRead(doc: DocManagedDoc): string {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(doc.fileMain);
  } catch {
    // a plain document whose content file is missing: an empty text
    return '';
  }
  const key = `${stat.mtimeMs}:${stat.size}`;
  const cached = textCacheByFile.get(doc.fileMain);
  if (cached && cached.key === key) return cached.text;
  const text = textOfDocRead(doc);
  textCacheByFile.set(doc.fileMain, { key, text });
  return text;
}

function textOfDocRead(doc: DocManagedDoc): string {
  if (doc.storage === 'pack') {
    const { body } = docManagedPackDecode(fs.readFileSync(doc.fileMain), (bytes: Uint8Array) => zlib.inflateRawSync(bytes));
    return doc.record.mode === 'block' ? docManagedBlockTextBuild(JSON.parse(body)) : body;
  }
  const text = fs.readFileSync(doc.fileMain, 'utf-8');
  return doc.record.mode === 'block' ? docManagedBlockTextBuild(yamlParse(text)) : text;
}

// the blocks of a document of mode block (doc-managed-block.js), undefined for mode text
export function docManagedBlockContentRead(doc: DocManagedDoc): any {
  if (doc.record.mode !== 'block' || !fs.existsSync(doc.fileMain)) return undefined;
  if (doc.storage === 'pack') {
    return JSON.parse(docManagedPackDecode(fs.readFileSync(doc.fileMain), (bytes: Uint8Array) => zlib.inflateRawSync(bytes)).body);
  }
  return yamlParse(fs.readFileSync(doc.fileMain, 'utf-8'));
}

// the text written, in the mode and form of the document; mode block reads it
// into blocks, keeping the ids of what stayed. answers the document as written
export function docManagedTextWrite(root: DocManagedRoot, doc: DocManagedDoc, text: string): DocManagedDoc {
  const record = { ...doc.record, timeUpdated: timeTextGet(), hash: textHashGet(text) };
  return docWrite(root, { record, storage: doc.storage, base: doc.base, docPrev: doc }, text);
}

// a new document at a path of the root, in the mode given (else the root's)
// and the form of the root. docId: kept when the document comes from another
// root (a move), else new
export function docManagedDocCreate(
  root: DocManagedRoot,
  { path: pathGiven, text, mode, docId, timeCreated }: { path: string; text: string; mode?: DocManagedMode; docId?: string; timeCreated?: string },
): DocManagedDoc {
  const relPath = docPathCheck(pathGiven);
  const docList = docManagedDocListRead(root);
  if (docList.some((doc) => doc.record.path === relPath)) throw new DocManagedError(-2, `the root ${root.alias} has a document ${relPath} already`);
  if (docId && docList.some((doc) => doc.record.docId === docId)) throw new DocManagedError(-2, `the root ${root.alias} has a document ${docId} already`);
  const docIdNew = docId ?? idMs48Create((id) => docList.some((doc) => doc.record.docId === id));
  const time = timeTextGet();
  const record: DocManagedRecord = {
    docId: docIdNew,
    path: relPath,
    mode: mode ?? root.mode,
    timeCreated: timeCreated ?? time,
    timeUpdated: time,
    hash: textHashGet(text),
  };
  return docWrite(root, { record, storage: root.storage, base: baseBuild(docIdNew, relPath) }, text);
}

// a document given another path in its root: the record changes, and its files
// are renamed when the name of its file changes (they follow it, as an asset's folder does)
export function docManagedDocPathSet(root: DocManagedRoot, doc: DocManagedDoc, pathNew: string): DocManagedDoc {
  const relPath = docPathCheck(pathNew);
  if (relPath === doc.record.path) return doc;
  if (docManagedDocListRead(root).some((one) => one.record.path === relPath)) throw new DocManagedError(-2, `the root ${root.alias} has a document ${relPath} already`);
  return docRewrite(root, doc, { record: { ...doc.record, path: relPath, timeUpdated: timeTextGet() }, storage: doc.storage, base: baseBuild(doc.record.docId, relPath) });
}

// a document moved into another root, keeping its id, its times and, when the
// mode of the target is the same, its blocks
export function docManagedDocMove(rootFrom: DocManagedRoot, doc: DocManagedDoc, rootTo: DocManagedRoot, pathNew: string): DocManagedDoc {
  if (rootFrom.dirAbs === rootTo.dirAbs) return docManagedDocPathSet(rootFrom, doc, pathNew);
  const relPath = docPathCheck(pathNew);
  const docListTo = docManagedDocListRead(rootTo);
  if (docListTo.some((one) => one.record.path === relPath)) throw new DocManagedError(-2, `the root ${rootTo.alias} has a document ${relPath} already`);
  if (docListTo.some((one) => one.record.docId === doc.record.docId)) throw new DocManagedError(-2, `the root ${rootTo.alias} has a document ${doc.record.docId} already`);
  const text = docManagedTextRead(doc);
  const blockContent = doc.record.mode === 'block' ? docManagedBlockContentRead(doc) : undefined;
  const record = { ...doc.record, path: relPath, timeUpdated: timeTextGet() };
  const docNew = docWrite(rootTo, { record, storage: rootTo.storage, base: baseBuild(doc.record.docId, relPath) }, text, {
    blockContent: extOfPathGet(relPath) === extOfPathGet(doc.record.path) ? blockContent : undefined,
    blockContentPrev: blockContent,
  });
  fileListRemove(doc.fileList, []);
  return docNew;
}

// a document of mode text read into blocks, or one of mode block kept as its text
export function docManagedDocModeSet(root: DocManagedRoot, doc: DocManagedDoc, mode: DocManagedMode): DocManagedDoc {
  if (!DOC_MANAGED_MODE_LIST.includes(mode)) throw new DocManagedError(-1, `the mode is one of ${DOC_MANAGED_MODE_LIST.join(', ')}`);
  if (doc.record.mode === mode) return doc;
  const text = docManagedTextRead(doc);
  return docWrite(root, { record: { ...doc.record, mode, timeUpdated: timeTextGet() }, storage: doc.storage, base: doc.base }, text, { fileListPrev: doc.fileList });
}

// a document written in the other form: plain into pack, pack into plain
export function docManagedDocStorageSet(root: DocManagedRoot, doc: DocManagedDoc, storage: DocManagedStorage): DocManagedDoc {
  if (doc.storage === storage) return doc;
  return docRewrite(root, doc, { record: doc.record, storage, base: doc.base });
}

// a document written again under another record, form or name, its text and
// (in the same format) its blocks as they are; the files it leaves removed
function docRewrite(root: DocManagedRoot, doc: DocManagedDoc, target: { record: DocManagedRecord; storage: DocManagedStorage; base: string }): DocManagedDoc {
  const text = docManagedTextRead(doc);
  const blockContent = doc.record.mode === 'block' ? docManagedBlockContentRead(doc) : undefined;
  const isFormatSame = extOfPathGet(target.record.path) === extOfPathGet(doc.record.path);
  return docWrite(root, target, text, { blockContent: isFormatSame ? blockContent : undefined, blockContentPrev: blockContent, fileListPrev: doc.fileList });
}

// writes a document: its record and content in the form given, then removes the
// files of its former content it does not keep (written first, removed after, so
// a failure loses nothing). option.blockContent: the blocks to write as they are;
// else a text of mode block is read into blocks, keeping the ids of
// option.blockContentPrev (or of docPrev's)
function docWrite(
  root: DocManagedRoot,
  { record, storage, base, docPrev }: { record: DocManagedRecord; storage: DocManagedStorage; base: string; docPrev?: DocManagedDoc },
  text: string,
  option: { blockContent?: any; blockContentPrev?: any; fileListPrev?: string[] } = {},
): DocManagedDoc {
  const format = extOfPathGet(record.path);
  const blockContentPrev = option.blockContentPrev ?? (docPrev ? docManagedBlockContentRead(docPrev) : undefined);
  const content = record.mode === 'block'
    ? option.blockContent ?? docManagedBlockContentBuild(text, { format, contentPrev: blockContentPrev })
    : undefined;
  const recordWritten = { ...record, hash: textHashGet(text) };
  const fileList: string[] = [];
  let fileMain: string;
  if (storage === 'pack') {
    fileMain = path.join(root.dirAbs, `${base}${SUFFIX_PACK}`);
    const body = record.mode === 'block' ? JSON.stringify(content) : text;
    fileWriteSafe(fileMain, Buffer.from(docManagedPackEncode({ record: recordWritten, body }, (bytes: Uint8Array) => zlib.deflateRawSync(bytes))));
    fileList.push(fileMain);
  } else {
    fileMain = path.join(root.dirAbs, record.mode === 'block' ? `${base}${SUFFIX_BLOCK}` : `${base}.${format}`);
    fileWriteSafe(fileMain, record.mode === 'block' ? yamlStringify(content, { lineWidth: 0, blockQuote: 'literal' }) : text);
    const fileRecord = path.join(root.dirAbs, `${base}${SUFFIX_RECORD}`);
    fileWriteSafe(fileRecord, yamlStringify(recordWritten, { lineWidth: 0 }));
    fileList.push(fileRecord, fileMain);
  }
  fileListRemove([...(option.fileListPrev ?? []), ...(docPrev?.fileList ?? [])], fileList);
  // a write of a managed document leaves no .bak: its history is the kernel's and
  // git's, and a backup beside every file would be one more file git lists
  for (const file of fileList) if (fs.existsSync(`${file}.bak`)) fs.rmSync(`${file}.bak`);
  textCacheByFile.set(fileMain, { key: fileStatKeyGet(fileMain), text });
  return { record: recordWritten, storage, base, fileMain, fileList };
}

// the files of a document it no longer has, with their backups
function fileListRemove(fileListPrev: string[], fileListKept: string[]) {
  for (const file of fileListPrev) {
    if (fileListKept.includes(file)) continue;
    for (const one of [file, `${file}.bak`, `${file}.tmp`]) if (fs.existsSync(one)) fs.rmSync(one);
  }
}

function fileStatKeyGet(file: string): string {
  const stat = fs.statSync(file);
  return `${stat.mtimeMs}:${stat.size}`;
}

// ---------- names ----------

// {docId}--{name}: the name the ASCII part of its file name without the extension
function baseBuild(docId: string, relPath: string): string {
  const fileName = relPath.split('/').at(-1) ?? '';
  return itemDirNameBuild(docId, fileName.replace(/\.(mdx?)$/, ''));
}

// the id a file of a root belongs to; '' for a file that is not a document's
export function docIdOfFileNameGet(fileName: string): string {
  const indexSeparator = fileName.indexOf(SEPARATOR);
  const head = indexSeparator === -1 ? fileName.split('.', 1)[0] : fileName.slice(0, indexSeparator);
  return idMs48Is(head) ? head : '';
}

function extOfPathGet(relPath: string): string {
  const ext = path.extname(relPath).slice(1).toLowerCase();
  return DOC_EXT_LIST.includes(ext) ? ext : 'md';
}

// a path of a document in a root: folders and a file name ending with .md or .mdx
export function docPathCheck(pathGiven: string): string {
  const relPath = relPathNormalize(pathGiven);
  if (!relPath) throw new DocManagedError(-1, 'a managed document has a path in its root');
  if (!DOC_EXT_LIST.includes(path.extname(relPath).slice(1).toLowerCase())) {
    throw new DocManagedError(-1, `a managed document is a .md or .mdx document: ${relPath}`);
  }
  if (relPath.split('/').some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))) {
    throw new DocManagedError(-1, `a path of a managed document has no "." or ".." segment, nor one starting with a dot: ${relPath}`);
  }
  if (/[\\:*?"<>|\u0000-\u001f]/.test(relPath)) throw new DocManagedError(-1, `a path of a managed document holds a character a file name cannot: ${relPath}`);
  return relPath;
}

function relPathNormalize(text: string): string {
  return String(text ?? '').replace(/\\/g, '/').split('/').filter((segment) => segment !== '').join('/');
}

function recordNormalize(content: any, docId: string, file: string): DocManagedRecord {
  if (content?.docId !== undefined && content.docId !== docId) {
    throw new DocManagedError(-1, `[doc-managed] ${file}: its record names the document ${content.docId}, its name ${docId}`);
  }
  const mode: DocManagedMode = DOC_MANAGED_MODE_LIST.includes(content?.mode) ? content.mode : 'text';
  return {
    docId,
    path: relPathNormalize(String(content?.path ?? `${docId}.md`)),
    mode,
    timeCreated: String(content?.timeCreated ?? ''),
    timeUpdated: String(content?.timeUpdated ?? ''),
    hash: String(content?.hash ?? ''),
  };
}
