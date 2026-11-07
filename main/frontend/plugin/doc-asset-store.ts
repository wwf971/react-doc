import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { idMs48Create, idMs48Is } from './id-ms48.ts';
import {
  sourcePathBuild,
  sourcePathFullGet,
  sourcePathIsRooted,
  sourcePathLocalGet,
  sourcePathNormalize,
  sourcePathParse,
} from '../src/lib/doc-source-path.js';
import { lineOperationApply, lineOperationListApply } from './doc-edit-lines.ts';
import { yamlScalarTextBuild, yamlStringListSetBuild, yamlValueSetOperationBuild } from './doc-yaml-edit.ts';
import { timeTextGet } from '../src/lib/time-text.js';

// The local store of the asset service layer, on disk (design: doc_page_impl_asset.md). A general
// store of items with a version history, modeled after an object storage
// (s3): an item is a key with metadata, a version is a sequence of bytes
// under that key, and the store does not care whether the bytes are text.
// There is one local store; its items live in the folders of the doc
// pages the page loads (its own and the ones it includes), each doc page
// naming its folders in its asset store config file (.doc-page/asset.yaml
// beside its entry by convention), and a new item is created in the
// default folder of the doc page of the document it is created from.
// Everything is a file: the folders and their files are the whole state.
//
//   .doc-page/asset.yaml              the asset store config of one doc page:
//                                     folderList [~root/path], folderDefault
//   {folder}/
//     {itemId}--{name}/             one folder per item: its id (ms_48), and its name
//       item.yaml                   when it has one, after the separator "--"
//     {group}/.../{itemId}--{name}/ or inside group folders, to any depth (8 levels
//                                     are read): a folder without item.yaml is a group,
//                                     read in turn; a group changes nothing of its items
//                                     (the items of a frontend object are kept in the group
//                                     {id}--{name} of that item, doc_page_impl_obj_frontend.md)
//       item.yaml.bak               the previous item.yaml, before the last rewrite
//       {versionId}.{fileExt}         the bytes of one version
//       {versionId}.{fileExt}.bak     the previous bytes, before an in-place update
//       {versionId}.metadata.yaml     the metadata of one version's data, when it has any
//       {versionId}.metadata.yaml.bak the previous metadata, before it was rewritten
//
// item.yaml:
//   itemId, name, lang, contentType, fileExt, component?, saveMode?, versionIdHead,
//   isDeleted, isLocked, timeCreated,
//   versionList: [{ versionId, versionIdPrevList, time, note, size, hash, isLocked, dependencyList }]
//   eventList:   [{ eventType, time, versionId?, userId?, placeFrom?, placeTo? }]
//
// what each file records: item.yaml is what the store itself keeps and
// answers questions with, the item and, for every version, its place in
// the history (predecessors, time, note), what identifies its bytes (size,
// hash), its lock and its dependencies: everything the store needs without
// reading any version file. {versionId}.metadata.yaml is what the writer of
// the data says about that data, a mapping the store never interprets (the
// version of the engine that wrote it, how a component displays it). it is
// read and written with the version's bytes, not with the item: listing
// the store reads no version file. a version without metadata has no file.
//
// dependencies (doc_page_impl_asset.md#dependencies): the data of a version
// may stand for more than its bytes: an Image version names an image file of
// the doc page source, a version may reuse another asset. every version
// records what its data depends on as dependencyList, one mapping per
// dependency with a type:
//   { type: source, path }                          a file of the source, by source path (~page:root/...)
//   { type: asset, itemId, versionId? }           a version of another item of this store;
//                                                   no versionId means the head
// the list is declared by whoever writes the data (the page knows which
// component the data is for, the store does not) and kept with the version:
// a new version copies the list of the version it is made from unless the
// write names one. the store answers the other direction too (the versions
// that depend on an item or a version), the base of resolving a deletion.
//
// locks: a locked version cannot be rewritten in place or deleted (a new
// version can still be made from it, and the head can still move to it or
// away). a locked item cannot be changed at all, its versions, head,
// metadata and deletion mark included, until it is unlocked; unlocking is
// the one write it accepts.
//
// an item has a random id and may have a name a person chooses. the name
// is unique in the store (every folder, deleted items included), so a
// reference may name the item by either; creating an item with the name
// of an existing one returns that item and creates nothing. the id and
// the name never contain the separator "--" of the folder name, so the id
// of a folder is what stands before the first "--".
//
// the history is a DAG kept in the item metadata: a version names the
// versions it was made from (versionIdPrevList: none for the first version,
// one for an ordinary update, several for a merge). the head is the version
// a document reading "head" receives; it can be moved to any version
// (checkout), and the next new version then branches from there.
//
// eventList is what happened to the item, in order: create, updateInPlace
// (the head bytes rewritten, versionId says which version), versionCreate,
// checkout, versionDelete, metaSet, delete, restore, lock, unlock (with
// versionId for the lock of one version). every event is a
// mapping, so a key may be missing: userId is reserved for a store that
// knows who writes. times carry their zone (time-format.md).
//
// owner says which object the data belongs to, when it is a part of a larger
// one: { ref, role? }, a reference of the object registry (frontend:{id} for
// a frontend object) and the part it plays (entry: the object's entry asset;
// absent: one of its assets). like component it is a declaration for
// recovering what belongs together, never checked by the store.
//
// component says which component the data is for, when it is the data of a
// component block: { name } (the tag name the page created it for). it is a
// record for recovering an item no block references any more, not a rule:
// the store does not check it and a block of another component may read the
// item. absent for data that serves another purpose.
//
// saveMode says what a save of the head does when the caller names no mode:
// inPlace (the head version is rewritten; the default when the key is not
// written) or newVersion (a version is appended and becomes the head).
//
// every rewrite of an existing file first copies it to {file}.bak, then
// writes a temporary file and renames it into place, so an interrupted
// write never leaves a half-written item.yaml or data file behind.
//
// a folder may be owned by an object (the item folder of a frontend object): the place of an
// item there belongs to the layer of that object. a write that makes an item arrive, leave or
// change its place in such a folder says which layer it is (asLayer), and any other is refused
// with -5, whichever way it comes (doc_page_impl_asset.md#folders-owned-by-an-object). data,
// versions and locks are not places: they are written as for any item.
//
// errors are AssetError with the codes of the api:
//   -1 bad request, -2 conflict (the data changed since it was read), -3 not found,
//   -4 a read-only folder, -5 a place that belongs to the layer of an object

export const ASSET_ITEM_META_NAME = 'item.yaml';
// the name the file had when items were called objects: an item folder holding
// it is not read, and is reported once (react-doc migrate rewrites it)
export const ASSET_ITEM_META_NAME_FORMER = 'object.yaml';
const assetFormerWarnedSet = new Set<string>();

function assetFormerWarn(folderAbs: string) {
  if (assetFormerWarnedSet.has(folderAbs)) return;
  assetFormerWarnedSet.add(folderAbs);
  console.warn(`[doc-asset] ${folderAbs} holds asset items in the former form (object.yaml), which is not read: run "react-doc migrate <doc page folder>" (main/update-20261107-repl.md)`);
}

// the id of the local store in a reference (store: local)
export const ASSET_STORE_ID_LOCAL = 'local';

// between the id and the name in the folder name of an item. an id is
// base 36, so it never holds it; a name is refused when it does.
export const ASSET_DIR_SEPARATOR = '--';

export const ASSET_NAME_LENGTH_MAX = 80;
// how deep group folders inside a store folder are read
export const ASSET_GROUP_DEPTH_MAX = 8;

export type AssetSaveMode = 'inPlace' | 'newVersion';

// the component the data of an item is for (doc_page_impl_asset.md#items-for-components);
// name only for now, an id and a version of the component are expected later
export type AssetComponent = { name: string };

// the object the data belongs to (doc_page_impl_obj_frontend.md#how-an-asset-comes-to-belong):
// a reference of the object registry, and the part it plays there
export type AssetOwner = { ref: string; role?: string };

export type AssetEventType =
  | 'create' | 'updateInPlace' | 'versionCreate' | 'checkout' | 'versionDelete' | 'metaSet' | 'delete' | 'restore'
  | 'lock' | 'unlock' | 'dependencySet' | 'versionMetadataSet' | 'move';

// what the writer of a version's data says about it ({versionId}.metadata.yaml);
// the store keeps it and never interprets it
export type AssetVersionMetadata = Record<string, unknown>;

// what the data of a version depends on
export type AssetDependency =
  | { type: 'source'; path: string }
  | { type: 'asset'; itemId: string; versionId?: string };

// a version that depends on an item (or one of its versions)
export type AssetDependent = { itemId: string; versionId: string; dependency: AssetDependency };

export type AssetEvent = {
  eventType: AssetEventType;
  // time-format.md: 20260520_23250530+09, the zone included
  time: string;
  // the version the event is about, for the events that concern one
  versionId?: string;
  // a move: where the item's folder was and is now ({folder}/{groupPath})
  placeFrom?: string;
  placeTo?: string;
  // reserved: who did it, once a store knows its users
  userId?: string;
};

export type AssetVersionMeta = {
  versionId: string;
  versionIdPrevList: string[];
  time: string;
  note: string;
  size: number;
  hash: string;
  // not rewritten in place, not deleted
  isLocked: boolean;
  dependencyList: AssetDependency[];
};

export type AssetItemMeta = {
  itemId: string;
  // '' or a name unique in the store; see nameNormalize for what a name may hold
  name: string;
  // the fence language a component reads the data as ('' when it is not for a code block)
  lang: string;
  // media type of the data, as an object storage records it
  contentType: string;
  fileExt: string;
  // the component the data is for; absent when it is not a component's data
  component?: AssetComponent;
  // the object it is a part of; absent when it stands alone
  owner?: AssetOwner;
  saveMode?: AssetSaveMode;
  versionIdHead: string;
  isDeleted: boolean;
  // nothing of the item changes until it is unlocked
  isLocked: boolean;
  timeCreated: string;
  versionList: AssetVersionMeta[];
  eventList: AssetEvent[];
  // where the item was found (not written into item.yaml): the folder
  // of the store, as written in asset.yaml, the item's folder in it (a
  // path with "/" when it is inside groups), and the groups ('' at the top)
  folder: string;
  dirName: string;
  groupPath: string;
  // the object whose folder holds the item, read from where it was found: a fact of the
  // scan, beside owner, which is what the item itself declares. neither decides that the
  // item belongs to the object: the object says that
  folderOwner?: AssetOwner;
};

// the bytes of one version, with the text when the bytes are valid utf-8,
// and the version's metadata ({} when it has none)
export type AssetVersionData = {
  versionId: string;
  bytes: Buffer;
  size: number;
  hash: string;
  isText: boolean;
  text?: string;
  metadata: AssetVersionMetadata;
};

export type AssetFolder = {
  // the full source path that names it (~page:root/path; asset.yaml writes
  // the local form ~root/path of its doc page): its identity in the store
  // and in item metadata
  path: string;
  pathAbs: string;
  // the default folder of the store: the default folder of the page's own doc page
  isDefault: boolean;
  // the doc page that names it: its entry, relative to the config directory
  docEntryFile: string;
  // the folder of a read-only doc page (a package treated as a doc page,
  // doc_page_impl_package.md#a-package-as-a-doc-page): every write is refused
  // by the store itself (-4), whichever way it comes
  isReadOnly?: boolean;
  // a folder owned by an object of the registry, not named in any asset.yaml:
  // the item folder of a frontend object (doc_page_impl_asset.md#folders-owned-by-an-object)
  owner?: AssetOwner;
};

export type AssetFolderInfo = AssetFolder & { isExists: boolean; itemCount: number };

// the asset store config of one doc page
export type AssetDocPage = {
  // its entry, relative to the config directory
  entryFile: string;
  // its asset store config file, absolute, and relative to the config directory
  configFile: string;
  configFileRelative: string;
  // the file exists; without it the doc page uses the default folders
  isConfigFileExists: boolean;
  // its folders, as source paths, in its order; its default folder ('' for none)
  folderList: string[];
  folderDefault: string;
  // a read-only doc page: the store writes nothing into its folders or its config file
  isReadOnly?: boolean;
  // the alias of the doc page, and the full paths of its roots
  // (~alias:root): a document of one of them creates its items in this
  // doc page's default folder; its asset folders lie in them
  alias: string;
  rootPathList: string[];
  // what was wrong with its config (a folder not named by a source path, an
  // unknown root): those folders are left out, the rest is read
  problemList: string[];
};

export type AssetStoreConfig = {
  docPageList: AssetDocPage[];
  // every folder of every doc page, the page's own first, each once
  folderList: AssetFolder[];
  // config.yaml folderManaged.isLazy (doc_page_impl_dir.md#managed-folders-made-when-first-used):
  // a folder is made by the first item written to it, never when it is
  // named; false: naming a folder makes it. absent: true
  isFolderLazy?: boolean;
  // the roots of the source rules, which name the folders; absent in a config
  // without owned folders
  rootAbsPathByPath?: Map<string, string>;
};

// what the store config reader needs of a doc page (plugin/doc-entry.ts DocPageLoaded)
export type AssetDocPageInput = {
  alias: string;
  entryFile: string;
  dirPage: string;
  rootList: { alias: string; path: string }[];
  asset: undefined | false | { file: string };
  isReadOnly?: boolean;
  // the folders objects of the doc page own: the layer owning them says which
  // (doc-object-frontend.ts), the store only reads them like the others
  folderOwnedList?: { pathAbs: string; owner: AssetOwner }[];
};

// what names an item: its id, or its name
export type AssetItemKey = { itemId?: string; name?: string };

export class AssetError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

// ---------- the store config files ----------
//
// every doc page the page loads has its own asset store config; the store
// is all of them (doc_page_impl_asset.md#the-local-store-folders-fully-reflected):
//
//   where      the entry's "asset: { file }", relative to the entry; absent:
//              asset.yaml beside the entry (.doc-page/asset.yaml); "asset: false":
//              the doc page has no folders
//   folders    folderList of that file: source paths of the doc page
//              (~root/path, local to it; the full form ~page:root/path names
//              a root of another doc page), resolved against the roots of
//              the page's source rules; folderDefault names one of them (the
//              first otherwise). the store names every folder in the full form
//   no file    the default folders: ASSET_FOLDER_DEFAULT_LIST, relative to the
//              folder of the doc page, named by the root of the doc page that
//              holds that folder. a folder that does not exist is created when
//              the first item is written to it
//
// a folder named by two doc pages belongs to the first (the page's own
// first, then the included ones in loading order).

export const ASSET_CONFIG_FILE_NAME = 'asset.yaml';
// the default folders of a doc page without an asset store config file,
// relative to the doc page folder (inside its metadata folder, so that the
// folder of the doc page shows its documents); the first is the default folder
export const ASSET_FOLDER_DEFAULT_LIST = ['.doc-page/asset'];

// config.yaml no longer names the store: a doc page does
export function assetConfigFormerReject(configDoc: any, configFile: string) {
  if (configDoc?.asset === undefined) return;
  throw new Error([
    `[doc-source] config.yaml "asset" is no longer read: every doc page names its own asset folders,`,
    `in .doc-page/asset.yaml beside its entry (or the file its entry names with "asset: { file }"),`,
    'as source paths:',
    '  folderList:',
    '    - ~root/.doc-page/asset',
    '  folderDefault: ~root/.doc-page/asset',
    `without the file the doc page uses ${ASSET_FOLDER_DEFAULT_LIST.join(', ')} of its folder. (${configFile})`,
  ].join('\n'));
}

export function assetConfigOfDocPageListGet(
  docPageInputList: AssetDocPageInput[],
  rootAbsPathByPath: Map<string, string>,
  configDir: string,
): AssetStoreConfig {
  const docPageList: AssetDocPage[] = [];
  const folderList: AssetFolder[] = [];
  for (const docPageInput of docPageInputList) {
    if (docPageInput.asset === false) continue;
    const docPage = assetDocPageRead(docPageInput, rootAbsPathByPath, configDir);
    for (const folderPath of docPage.folderList) {
      const pathAbs = sourcePathAbsGet(folderPath, rootAbsPathByPath);
      if (!pathAbs) continue;
      const folderSame = folderList.find((folder) => folder.pathAbs === pathAbs);
      if (folderSame) {
        if (folderSame.docEntryFile !== docPage.entryFile) {
          docPage.problemList.push(`${folderPath} is a folder of ${folderSame.docEntryFile} already`);
        }
        continue;
      }
      folderList.push({ path: folderPath, pathAbs, isDefault: false, docEntryFile: docPage.entryFile, isReadOnly: docPageInput.isReadOnly === true });
    }
    for (const owned of docPageInput.folderOwnedList ?? []) {
      const folderPath = sourcePathOfAbsGet(owned.pathAbs, docPage, rootAbsPathByPath);
      if (!folderPath) {
        docPage.problemList.push(`no root of the doc page holds ${owned.pathAbs}, the folder of ${owned.owner.ref}`);
        continue;
      }
      if (folderList.some((folder) => folder.pathAbs === owned.pathAbs)) continue;
      folderList.push({
        path: folderPath, pathAbs: owned.pathAbs, isDefault: false, docEntryFile: docPage.entryFile,
        isReadOnly: docPageInput.isReadOnly === true, owner: owned.owner,
      });
    }
    for (const problem of docPage.problemList) console.warn(`[doc-asset] ${docPage.configFileRelative}: ${problem}`);
    docPageList.push(docPage);
  }
  const docPageOwn = docPageList[0];
  const folderDefault = folderList.find((folder) => folder.path === docPageOwn?.folderDefault) ?? folderList.find((folder) => !folder.owner);
  if (folderDefault) folderDefault.isDefault = true;
  return { docPageList, folderList, rootAbsPathByPath };
}

// the full source path of a folder of a doc page: named by its first root holding it
function sourcePathOfAbsGet(pathAbs: string, docPage: AssetDocPage, rootAbsPathByPath: Map<string, string>): string {
  for (const rootPath of docPage.rootPathList) {
    const rootAbs = rootAbsPathByPath.get(rootPath);
    const parsed = sourcePathParse(rootPath);
    if (!rootAbs || !parsed) continue;
    const relative = path.relative(rootAbs, pathAbs);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    return sourcePathBuild(parsed.rootAlias, relative.split(path.sep).join('/'), parsed.docPageAlias);
  }
  return '';
}

// the asset store config of one doc page: its file when it exists, its
// default folders otherwise
function assetDocPageRead(input: AssetDocPageInput, rootAbsPathByPath: Map<string, string>, configDir: string): AssetDocPage {
  const dirEntry = path.dirname(input.entryFile);
  const configFile = input.asset ? path.resolve(dirEntry, input.asset.file) : path.join(dirEntry, ASSET_CONFIG_FILE_NAME);
  const docPage: AssetDocPage = {
    entryFile: pathRelativeGet(input.entryFile, configDir),
    configFile,
    configFileRelative: pathRelativeGet(configFile, configDir),
    isConfigFileExists: fs.existsSync(configFile),
    folderList: [],
    folderDefault: '',
    isReadOnly: input.isReadOnly === true,
    alias: input.alias,
    rootPathList: input.rootList.map((root) => sourcePathBuild(root.alias, '', input.alias)),
    problemList: [],
  };
  if (!docPage.isConfigFileExists) {
    docPage.folderList = assetFolderDefaultListGet(input, rootAbsPathByPath);
    if (docPage.folderList.length === 0) {
      docPage.problemList.push(`no root of the doc page holds its folder ${input.dirPage}; it has no default asset folder`);
    }
    docPage.folderDefault = docPage.folderList[0] ?? '';
    return docPage;
  }
  let content: any;
  try {
    content = yamlParse(fs.readFileSync(configFile, 'utf-8')) ?? {};
  } catch (error: any) {
    throw new Error(`[doc-source] the asset store config ${configFile} is not valid yaml: ${String(error?.message ?? error)}`);
  }
  if (typeof content !== 'object' || Array.isArray(content)) {
    throw new Error(`[doc-source] the asset store config ${configFile} must be a mapping with "folderList"`);
  }
  if (content.folderList !== undefined && !Array.isArray(content.folderList)) {
    throw new Error(`[doc-source] "folderList" of the asset store config ${configFile} must be a list of source paths (~root/path)`);
  }
  for (const one of content.folderList ?? []) {
    // the former form { path, isDefault } is still read. a local path is a
    // root of this doc page
    const pathText = sourcePathFullGet(sourcePathNormalize(typeof one === 'string' ? one : String(one?.path ?? '')), input.alias);
    if (pathText === '') continue;
    const problem = assetFolderPathProblemGet(pathText, rootAbsPathByPath);
    if (problem) {
      docPage.problemList.push(problem);
      continue;
    }
    if (docPage.folderList.includes(pathText)) continue;
    docPage.folderList.push(pathText);
    if (typeof one === 'object' && one?.isDefault === true && docPage.folderDefault === '') docPage.folderDefault = pathText;
  }
  if (typeof content.folderDefault === 'string' && content.folderDefault.trim() !== '') {
    const folderDefault = sourcePathFullGet(sourcePathNormalize(content.folderDefault), input.alias);
    if (docPage.folderList.includes(folderDefault)) docPage.folderDefault = folderDefault;
    else docPage.problemList.push(`folderDefault ${folderDefault} is not in folderList`);
  }
  if (docPage.folderDefault === '') docPage.folderDefault = docPage.folderList[0] ?? '';
  return docPage;
}

// the default folders of a doc page as full source paths: each folder of
// ASSET_FOLDER_DEFAULT_LIST in the doc page folder, named by the doc page's
// first root that holds it
function assetFolderDefaultListGet(input: AssetDocPageInput, rootAbsPathByPath: Map<string, string>): string[] {
  const result: string[] = [];
  for (const folderName of ASSET_FOLDER_DEFAULT_LIST) {
    const folderAbs = path.join(input.dirPage, folderName);
    for (const root of input.rootList) {
      const rootPath = sourcePathBuild(root.alias, '', input.alias);
      const rootAbs = rootAbsPathByPath.get(rootPath);
      if (!rootAbs) continue;
      const relative = path.relative(rootAbs, folderAbs);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      result.push(sourcePathBuild(root.alias, relative.split(path.sep).join('/'), input.alias));
      break;
    }
  }
  return result;
}

// why a folder (a full source path) cannot be an asset folder; '' when it can
export function assetFolderPathProblemGet(pathText: string, rootAbsPathByPath: Map<string, string>): string {
  const parsed = sourcePathParse(pathText);
  if (!parsed) {
    return `${pathText} is not a source path; name an asset folder as ~root/path, relative to a root of the doc page`;
  }
  const rootPath = sourcePathBuild(parsed.rootAlias, '', parsed.docPageAlias);
  if (!rootAbsPathByPath.has(rootPath)) {
    return `${pathText}: no source rule declares the root ${rootPath} (roots: ${[...rootAbsPathByPath.keys()].join(', ') || 'none'})`;
  }
  if (parsed.relPath === '') return `${pathText} is a whole root; an asset folder is a folder inside a root`;
  return '';
}

function sourcePathAbsGet(pathText: string, rootAbsPathByPath: Map<string, string>): string {
  const parsed = sourcePathParse(pathText);
  const rootAbs = parsed ? rootAbsPathByPath.get(sourcePathBuild(parsed.rootAlias, '', parsed.docPageAlias)) : undefined;
  return parsed && rootAbs ? path.join(rootAbs, ...parsed.relPath.split('/')) : '';
}

// the doc page a document belongs to, from its full source path
function docPageAliasOfPath(docPath: string | undefined): string {
  return sourcePathParse(docPath ?? '')?.docPageAlias ?? '';
}

// a folder path as the asset store config of a doc page writes it: the
// local form for a root of that doc page, the full form for any other
function folderPathTextGet(pathFull: string, docPageAlias: string): string {
  return sourcePathParse(pathFull)?.docPageAlias === docPageAlias ? sourcePathLocalGet(pathFull) : pathFull;
}

function pathRelativeGet(filePath: string, configDir: string): string {
  return path.relative(configDir, filePath).split(path.sep).join('/');
}

// the text of a new asset store config file
export function assetConfigTextBuild(folderList: string[], folderDefault: string): string {
  return [
    '# the asset store config of this doc page (doc_page_impl_asset.md): the folders',
    '# its asset items live in, as source paths (~root/path, a root of this doc',
    '# page; ~page:root/path names a root of another doc page). a new item of a',
    '# document of this doc page is created in folderDefault. rewritten in place by',
    '# the settings panel of the page (Asset service tab).',
    'folderList:',
    ...folderList.map((folderPath) => `  - ${yamlScalarTextBuild(folderPath)}`),
    `folderDefault: ${yamlScalarTextBuild(folderDefault)}`,
    '',
  ].join('\n');
}

// the new text of an asset store config file: its folders and default
// folder written in place (doc-yaml-edit.ts), the rest of the file as it was
export function assetConfigTextApply(text: string, folderList: string[], folderDefault: string): string {
  const listResult = yamlStringListSetBuild(text, ['folderList'], folderList);
  if (listResult.code !== 0) throw new AssetError(-1, `folderList: ${listResult.message}`);
  const textList = lineOperationListApply(text, listResult.data.operationList);
  const defaultResult = yamlValueSetOperationBuild(textList, ['folderDefault'], yamlScalarTextBuild(folderDefault));
  if (defaultResult.code !== 0) throw new AssetError(-1, `folderDefault: ${defaultResult.message}`);
  return lineOperationApply(textList, defaultResult.data.operation);
}

// ---------- the folder name of an item ----------

// {itemId}--{name}, or {itemId} alone for an item without a name. A folder name holds
// ASCII only, whatever the name is, since other characters are what file systems, archives and
// other machines disagree on: the rest of a name is left out of its folder, and stays in
// item.yaml (doc_page_impl_asset.md#stores-items-versions)
export function itemDirNameBuild(itemId: string, name: string): string {
  const nameAscii = dirNameAsciiBuild(name);
  return nameAscii ? `${itemId}${ASSET_DIR_SEPARATOR}${nameAscii}` : itemId;
}

// what of a name can go in a folder name: a name in ASCII as it is; in any other, its
// ASCII parts joined by "-" (営業 report 2 is "report 2"), '' when it has none
function dirNameAsciiBuild(name: string): string {
  if (/^[\x20-\x7E]*$/.test(name)) return name;
  return name.replace(/[^\x20-\x7E]+/g, '-').replace(/^[-\s.]+|[-\s.]+$/g, '');
}

// the id part of a folder name; '' when the folder is not an item's
export function itemIdFromDirName(dirName: string): string {
  const indexSeparator = dirName.indexOf(ASSET_DIR_SEPARATOR);
  const itemId = indexSeparator === -1 ? dirName : dirName.slice(0, indexSeparator);
  return idMs48Is(itemId) ? itemId : '';
}

// a name as the store accepts it: trimmed, at most ASSET_NAME_LENGTH_MAX
// characters, without the folder separator, without the characters a file
// name cannot hold on the major operating systems (/ \ : * ? " < > | and
// control characters), and not ending with a dot (windows). '' is no name.
export function nameNormalize(nameInput: unknown): string {
  const name = String(nameInput ?? '').trim();
  if (name === '') return '';
  if (name.length > ASSET_NAME_LENGTH_MAX) throw new AssetError(-1, `the name is longer than ${ASSET_NAME_LENGTH_MAX} characters`);
  if (name.includes(ASSET_DIR_SEPARATOR)) throw new AssetError(-1, `the name cannot contain "${ASSET_DIR_SEPARATOR}"`);
  // eslint-disable-next-line no-control-regex
  if (/[/\\:*?"<>|\u0000-\u001f]/.test(name)) throw new AssetError(-1, 'the name cannot contain / \\ : * ? " < > | or control characters');
  if (name.endsWith('.')) throw new AssetError(-1, 'the name cannot end with a dot');
  return name;
}

// where an item's folder lies, for the record of a move
function placeTextBuild(folder: string, groupPath: string): string {
  return groupPath ? `${folder}/${groupPath}` : folder;
}

// a folder moved; folders of two disks cannot be renamed one into the other
function dirMove(dirFrom: string, dirTo: string) {
  try {
    fs.renameSync(dirFrom, dirTo);
  } catch (error: any) {
    if (error?.code !== 'EXDEV') throw error;
    fs.cpSync(dirFrom, dirTo, { recursive: true });
    fs.rmSync(dirFrom, { recursive: true, force: true });
  }
}

// ---------- the store ----------

export function assetStoreCreate(config: AssetStoreConfig) {
  const folderList = config.folderList;
  const folderDefault = folderList.find((folder) => folder.isDefault);
  const itemDirGet = (meta: AssetItemMeta) => path.join(folderAbsGet(meta.folder), ...meta.dirName.split('/'));
  const itemMetaPathGet = (meta: AssetItemMeta) => path.join(itemDirGet(meta), ASSET_ITEM_META_NAME);
  const versionPathGet = (meta: AssetItemMeta, versionId: string) => path.join(itemDirGet(meta), `${versionId}.${meta.fileExt}`);
  // always yaml, whatever the extension of the data file
  const versionMetadataPathGet = (meta: AssetItemMeta, versionId: string) => path.join(itemDirGet(meta), `${versionId}.metadata.yaml`);

  function folderAbsGet(folderPath: string): string {
    const folder = folderList.find((one) => one.path === folderPath);
    if (!folder) throw new AssetError(-3, `asset folder not in the store: ${folderPath}`);
    return folder.pathAbs;
  }

  // the item folders of a store folder: [{ dirName, itemId, groupPath }],
  // a folder before the folders inside it, in name order. a folder holding
  // item.yaml whose name starts with an id is an item (nothing inside it
  // is read for items); any other folder is a group and is read in turn,
  // to ASSET_GROUP_DEPTH_MAX levels; dot folders are never read
  function itemDirList(folder: AssetFolder): { dirName: string; itemId: string; groupPath: string }[] {
    const list: { dirName: string; itemId: string; groupPath: string }[] = [];
    const visit = (groupPath: string, depth: number) => {
      const dirAbs = groupPath ? path.join(folder.pathAbs, ...groupPath.split('/')) : folder.pathAbs;
      if (!fs.existsSync(dirAbs)) return;
      const entryList = fs.readdirSync(dirAbs, { withFileTypes: true })
        .filter((one) => one.isDirectory() && !one.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name));
      const groupList: string[] = [];
      for (const one of entryList) {
        const dirName = groupPath ? `${groupPath}/${one.name}` : one.name;
        const itemId = itemIdFromDirName(one.name);
        if (itemId && fs.existsSync(path.join(dirAbs, one.name, ASSET_ITEM_META_NAME))) {
          list.push({ dirName, itemId, groupPath });
          continue;
        }
        if (itemId && fs.existsSync(path.join(dirAbs, one.name, ASSET_ITEM_META_NAME_FORMER))) assetFormerWarn(folder.pathAbs);
        groupList.push(dirName);
      }
      if (depth >= ASSET_GROUP_DEPTH_MAX) return;
      for (const groupPathInner of groupList) visit(groupPathInner, depth + 1);
    };
    visit('', 0);
    return list;
  }

  // the folder of an item in one store folder; undefined when it is not there
  function itemDirFind(folder: AssetFolder, itemId: string): string | undefined {
    return itemDirList(folder).find((one) => one.itemId === itemId)?.dirName;
  }

  // ---------- the folders ----------

  function folderInfoList(): AssetFolderInfo[] {
    return folderList.map((folder) => ({
      ...folder,
      isExists: fs.existsSync(folder.pathAbs),
      itemCount: itemDirList(folder).length,
    }));
  }

  // the doc pages and their folders, as the settings panel shows them
  function docPageInfoList(): Omit<AssetDocPage, 'configFile'>[] {
    return config.docPageList.map(({ configFile: _configFile, ...docPage }) => docPage);
  }

  // the folders of one doc page rewritten in its asset store config file, in
  // place (a file that does not exist yet is created); the folders are
  // created on disk (a folder added from the page is meant to receive
  // items). rootAbsPathByPath: the roots of the page, to check the paths.
  // a path in the local form is a root of the doc page; the file is written
  // in that form for the doc page's own roots. the store created from the
  // config read again sees the new folders.
  function folderSet(
    input: { configFile: string; folderList: string[]; folderDefault?: string },
    rootAbsPathByPath: Map<string, string>,
  ): void {
    const docPage = config.docPageList.find((one) => one.configFileRelative === input.configFile);
    if (!docPage) throw new AssetError(-3, `not the asset store config of a doc page of this page: ${input.configFile}`);
    if (docPage.isReadOnly) throw new AssetError(-4, `the asset folders of the doc page "${docPage.alias}" are read-only: it is a package`);
    const folderListNext: string[] = [];
    for (const one of input.folderList) {
      const pathText = sourcePathFullGet(sourcePathNormalize(String(one ?? '')), docPage.alias);
      if (pathText === '' || folderListNext.includes(pathText)) continue;
      const problem = assetFolderPathProblemGet(pathText, rootAbsPathByPath);
      if (problem) throw new AssetError(-1, problem);
      folderListNext.push(pathText);
    }
    if (folderListNext.length === 0) throw new AssetError(-1, 'a doc page with an asset store needs at least one folder');
    const folderDefaultInput = sourcePathFullGet(sourcePathNormalize(input.folderDefault ?? docPage.folderDefault), docPage.alias);
    const folderDefault = folderListNext.includes(folderDefaultInput) ? folderDefaultInput : folderListNext[0];
    const folderListText = folderListNext.map((folderPath) => folderPathTextGet(folderPath, docPage.alias));
    const folderDefaultText = folderPathTextGet(folderDefault, docPage.alias);
    const textNext = docPage.isConfigFileExists
      ? assetConfigTextApply(fs.readFileSync(docPage.configFile, 'utf-8'), folderListText, folderDefaultText)
      : assetConfigTextBuild(folderListText, folderDefaultText);
    if (docPage.isConfigFileExists) fs.copyFileSync(docPage.configFile, `${docPage.configFile}.bak`);
    fs.mkdirSync(path.dirname(docPage.configFile), { recursive: true });
    fileWriteSafe(docPage.configFile, textNext);
    // a folder named is made only with folderManaged.isLazy off; otherwise
    // the first item written to it makes it (itemCreate)
    if (config.isFolderLazy === false) {
      for (const folderPath of folderListNext) {
        const pathAbs = sourcePathAbsGet(folderPath, rootAbsPathByPath);
        if (pathAbs) fs.mkdirSync(pathAbs, { recursive: true });
      }
    }
  }

  // a folder a new object owns, known to this store from now on (the config
  // read again finds it by the object's file); nothing is made on disk until
  // the first item is written to it
  function folderOwnedAdd(input: { pathAbs: string; owner: AssetOwner; docPageAlias: string }): AssetFolder {
    const docPage = config.docPageList.find((one) => one.alias === input.docPageAlias);
    const folderPath = docPage ? sourcePathOfAbsGet(input.pathAbs, docPage, config.rootAbsPathByPath ?? new Map()) : '';
    if (!docPage || !folderPath) throw new AssetError(-1, `no root of the doc page ${input.docPageAlias} holds ${input.pathAbs}`);
    const folder: AssetFolder = { path: folderPath, pathAbs: input.pathAbs, isDefault: false, docEntryFile: docPage.entryFile, isReadOnly: docPage.isReadOnly === true, owner: input.owner };
    folderList.push(folder);
    return folder;
  }

  // a place in a folder owned by an object is its layer's: asLayer says which layer asks
  // (frontend, of the references frontend:{id})
  function folderOwnerPlaceCheck(folderPath: string, asLayer: string | undefined, what: string) {
    const owner = folderList.find((one) => one.path === folderPath)?.owner;
    if (!owner) return;
    if (asLayer && owner.ref.startsWith(`${asLayer}:`)) return;
    throw new AssetError(-5, `${folderPath} is owned by ${owner.ref}: ${what} goes through the layer of that object (doc_page_impl_asset.md#folders-owned-by-an-object)`);
  }

  // a write into the folder of a read-only doc page is refused here, the one
  // place every write of the store passes (itemWriteGuard below)
  function folderWritableCheck(folderPath: string) {
    if (folderList.find((one) => one.path === folderPath)?.isReadOnly) {
      throw new AssetError(-4, `the asset folder ${folderPath} is read-only: its doc page is a package`);
    }
  }
  function itemWriteGuard<Args extends any[], Result>(write: (itemId: string, ...rest: Args) => Result) {
    return (itemId: string, ...rest: Args): Result => {
      folderWritableCheck(itemGet(itemId).folder);
      return write(itemId, ...rest);
    };
  }

  // the folder a new item goes to: the one named, else the default folder
  // of the doc page the document it is created from belongs to, else the
  // default folder of the store
  function folderForCreateGet(folderPath: string | undefined, docPath: string | undefined): AssetFolder | undefined {
    if (folderPath) return folderList.find((one) => one.path === sourcePathFullGet(folderPath, docPageAliasOfPath(docPath)));
    const docPageAlias = docPageAliasOfPath(docPath);
    const docPage = docPageAlias ? config.docPageList.find((one) => one.alias === docPageAlias) : undefined;
    const folderOfDocPage = docPage ? folderList.find((one) => one.path === docPage.folderDefault) : undefined;
    return folderOfDocPage ?? folderDefault;
  }

  // ---------- reading ----------

  // every item of every folder; an id present in two folders is read from
  // the first folder that has it (the folder order of asset.yaml)
  function itemList(): AssetItemMeta[] {
    const metaList: AssetItemMeta[] = [];
    const itemIdSeen = new Set<string>();
    for (const folder of folderList) {
      for (const one of itemDirList(folder)) {
        if (itemIdSeen.has(one.itemId)) continue;
        const meta = itemMetaRead(folder, one.dirName);
        if (!meta) continue;
        itemIdSeen.add(one.itemId);
        metaList.push(meta);
      }
    }
    metaList.sort((a, b) => a.timeCreated.localeCompare(b.timeCreated));
    return metaList;
  }

  function itemGet(itemId: string): AssetItemMeta {
    if (!idMs48Is(itemId)) throw new AssetError(-1, `not an item id: ${String(itemId)}`);
    for (const folder of folderList) {
      const dirName = itemDirFind(folder, itemId);
      if (!dirName) continue;
      const meta = itemMetaRead(folder, dirName);
      if (meta) return meta;
    }
    throw new AssetError(-3, `asset item not found: ${itemId}`);
  }

  // the item with that name; names are unique in the store
  function itemGetByName(name: string): AssetItemMeta {
    const nameWanted = nameNormalize(name);
    if (!nameWanted) throw new AssetError(-1, 'name is required');
    const meta = itemList().find((one) => one.name === nameWanted);
    if (!meta) throw new AssetError(-3, `asset item not found by name: ${nameWanted}`);
    return meta;
  }

  // by id when the key has one, else by name
  function itemFind(key: AssetItemKey): AssetItemMeta {
    if (key.itemId) return itemGet(key.itemId);
    if (key.name) return itemGetByName(key.name);
    throw new AssetError(-1, 'itemId or name is required');
  }

  // versionId 'head' or '' reads the head version
  function versionDataGet(itemId: string, versionIdRequested = 'head'): AssetVersionData {
    const meta = itemGet(itemId);
    return versionDataGetOf(meta, versionIdRequested);
  }

  function versionDataGetOf(meta: AssetItemMeta, versionIdRequested = 'head'): AssetVersionData {
    const versionId = versionIdResolve(meta, versionIdRequested);
    const filePath = versionPathGet(meta, versionId);
    if (!fs.existsSync(filePath)) {
      throw new AssetError(-3, `data file of version ${versionId} is missing: ${filePath}`);
    }
    return versionDataBuild(versionId, fs.readFileSync(filePath), versionMetadataRead(meta, versionId));
  }

  // ---------- the metadata of a version ----------

  // the mapping of {versionId}.metadata.yaml; {} when the file is missing or
  // does not hold a mapping
  function versionMetadataRead(meta: AssetItemMeta, versionId: string): AssetVersionMetadata {
    const filePath = versionMetadataPathGet(meta, versionId);
    if (!fs.existsSync(filePath)) return {};
    const content = yamlParse(fs.readFileSync(filePath, 'utf-8'));
    if (!content || typeof content !== 'object' || Array.isArray(content)) return {};
    return content as AssetVersionMetadata;
  }

  // an empty mapping removes the file (its previous content is kept as .bak)
  function versionMetadataWrite(meta: AssetItemMeta, versionId: string, metadata: AssetVersionMetadata) {
    const filePath = versionMetadataPathGet(meta, versionId);
    if (Object.keys(metadata).length === 0) {
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, `${filePath}.bak`);
        fs.rmSync(filePath);
      }
      return;
    }
    fileWriteSafe(filePath, yamlStringify(metadata));
  }

  // the metadata of one version replaced; versionId 'head' or '' is the head.
  // it describes the version's data, so a locked version keeps it, like its bytes
  function versionMetadataSet(itemId: string, versionIdRequested: string, metadataInput: unknown): { item: AssetItemMeta; version: AssetVersionData } {
    const metadata = versionMetadataNormalize(metadataInput);
    const meta = itemGet(itemId);
    itemUnlockedCheck(meta);
    const versionId = versionIdResolve(meta, versionIdRequested);
    versionUnlockedCheck(meta, versionId, 'given other metadata');
    versionMetadataWrite(meta, versionId, metadata);
    meta.eventList.push({ eventType: 'versionMetadataSet', time: timeTextGet(), versionId });
    itemMetaWrite(meta);
    return { item: meta, version: versionDataGetOf(meta, versionId) };
  }

  // ---------- writing ----------

  // a new item with its first version. when the name is the name of an
  // item of the store, that item is returned (isCreated false) and
  // nothing is written: a name means one item.
  //   folder           the folder the item is created in (its source path, as in asset.yaml)
  //   docPath          absent folder: the document the item is created from; the item goes
  //                    to the default folder of that document's doc page (the store's default otherwise)
  //   dependencyList   what the data of the first version depends on (none when absent)
  //   saveMode         written into the item when given; absent: the key is not written
  //   versionMetadata  the metadata of the first version (none when absent)
  //   component        { name }: the component the data is for; absent: not written
  //   groupPath        the group folders it is created in ("a/b", made when missing); '' or absent: the top
  //   owner            { ref, role? }: the object it is a part of; absent: not written
  //   asLayer          the layer asking, for a folder an object owns (folderOwnerPlaceCheck)
  function itemCreate(input: {
    name?: string;
    lang?: string;
    contentType?: string;
    fileExt?: string;
    data: Buffer;
    note?: string;
    folder?: string;
    docPath?: string;
    dependencyList?: unknown;
    saveMode?: unknown;
    versionMetadata?: unknown;
    component?: unknown;
    groupPath?: string;
    owner?: unknown;
    asLayer?: string;
  }): { item: AssetItemMeta; version: AssetVersionData; isCreated: boolean } {
    if (!Buffer.isBuffer(input.data)) throw new AssetError(-1, 'data is required');
    const groupPath = groupPathNormalize(input.groupPath);
    const owner = ownerNormalize(input.owner ?? null);
    const dependencyList = dependencyListNormalize(input.dependencyList ?? []);
    const versionMetadata = versionMetadataNormalize(input.versionMetadata ?? {});
    const component = componentNormalize(input.component ?? null);
    if (input.saveMode !== undefined && input.saveMode !== 'inPlace' && input.saveMode !== 'newVersion') {
      throw new AssetError(-1, `saveMode must be inPlace or newVersion, got ${String(input.saveMode)}`);
    }
    const name = nameNormalize(input.name);
    if (name) {
      const metaExisting = itemList().find((one) => one.name === name);
      if (metaExisting) return { item: metaExisting, version: versionDataGetOf(metaExisting, 'head'), isCreated: false };
    }
    const folder = folderForCreateGet(input.folder, input.docPath);
    if (folder) folderWritableCheck(folder.path);
    if (!folder) {
      throw new AssetError(-1, input.folder ? `asset folder not in the store: ${input.folder}` : 'the local store has no folder');
    }
    folderOwnerPlaceCheck(folder.path, input.asLayer, 'a new item');
    const lang = langNormalize(input.lang);
    fs.mkdirSync(folder.pathAbs, { recursive: true });
    const isItemIdUsed = (id: string) => folderList.some((one) => itemDirFind(one, id) !== undefined);
    const itemId = idMs48Create(isItemIdUsed);
    const versionId = idMs48Create();
    const time = timeTextGet();
    const fileExt = fileExtNormalize(input.fileExt) || fileExtByLang[lang] || 'bin';
    const meta: AssetItemMeta = {
      itemId,
      name,
      lang,
      contentType: String(input.contentType ?? '').trim() || contentTypeByLang[lang] || 'application/octet-stream',
      fileExt,
      versionIdHead: versionId,
      isDeleted: false,
      isLocked: false,
      timeCreated: time,
      versionList: [versionMetaBuild(versionId, [], time, input.note, input.data, dependencyList)],
      eventList: [{ eventType: 'create', time, versionId }],
      folder: folder.path,
      dirName: dirNameInGroupBuild(groupPath, itemDirNameBuild(itemId, name)),
      groupPath,
    };
    if (component) meta.component = component;
    if (owner) meta.owner = owner;
    if (folder.owner) meta.folderOwner = folder.owner;
    if (input.saveMode === 'inPlace' || input.saveMode === 'newVersion') meta.saveMode = input.saveMode;
    fs.mkdirSync(itemDirGet(meta), { recursive: true });
    fileWriteSafe(versionPathGet(meta, versionId), input.data);
    versionMetadataWrite(meta, versionId, versionMetadata);
    itemMetaWrite(meta);
    return { item: meta, version: versionDataBuild(versionId, input.data, versionMetadata), isCreated: true };
  }

  // hashBase: the hash of the head data the caller changed; a different
  // head on disk means somebody else wrote meanwhile (code -2).
  //   mode   inPlace: the head version's data is rewritten (its .bak keeps the old one)
  //          newVersion: a new version is created from the head and becomes the head
  //          absent: the item's saveMode, inPlace when none is written
  //   dependencyList   what the new data depends on; absent: the list of the
  //                    version the data replaces or is made from is kept
  //   versionMetadata  the metadata of the new data; absent: the metadata of
  //                    the version the data replaces or is made from is kept
  function itemUpdate(input: {
    itemId: string;
    hashBase: string;
    data: Buffer;
    mode?: AssetSaveMode;
    note?: string;
    dependencyList?: unknown;
    versionMetadata?: unknown;
  }): { item: AssetItemMeta; version: AssetVersionData } {
    if (!Buffer.isBuffer(input.data)) throw new AssetError(-1, 'data is required');
    const dependencyListNext = input.dependencyList === undefined ? undefined : dependencyListNormalize(input.dependencyList);
    const versionMetadataNext = input.versionMetadata === undefined ? undefined : versionMetadataNormalize(input.versionMetadata);
    const meta = itemGet(input.itemId);
    itemUnlockedCheck(meta);
    if (meta.isDeleted) throw new AssetError(-1, 'the item is deleted; restore it first');
    const mode = input.mode ?? saveModeGet(meta);
    if (mode !== 'inPlace' && mode !== 'newVersion') {
      throw new AssetError(-1, `mode must be inPlace or newVersion, got ${String(mode)}`);
    }
    if (mode === 'inPlace') versionUnlockedCheck(meta, meta.versionIdHead, 'rewritten in place; save as a new version');
    const head = versionDataGetOf(meta, 'head');
    if (typeof input.hashBase !== 'string' || head.hash !== input.hashBase) {
      throw new AssetError(-2, 'the asset changed since it was loaded; the update was not applied');
    }
    const time = timeTextGet();
    let versionId = head.versionId;
    const versionHead = versionMetaGet(meta, head.versionId);
    const versionMetadata = versionMetadataNext ?? head.metadata;
    if (mode === 'newVersion') {
      versionId = idMs48Create((id) => meta.versionList.some((version) => version.versionId === id));
      const dependencyList = dependencyListNext ?? versionHead.dependencyList.map((one) => ({ ...one }));
      meta.versionList.push(versionMetaBuild(versionId, [head.versionId], time, input.note, input.data, dependencyList));
      meta.versionIdHead = versionId;
      meta.eventList.push({ eventType: 'versionCreate', time, versionId });
    } else {
      versionHead.size = input.data.length;
      versionHead.hash = bytesHashGet(input.data);
      if (input.note !== undefined) versionHead.note = String(input.note);
      if (dependencyListNext !== undefined) versionHead.dependencyList = dependencyListNext;
      meta.eventList.push({ eventType: 'updateInPlace', time, versionId });
    }
    fileWriteSafe(versionPathGet(meta, versionId), input.data);
    // a new version always gets its own file; in place, the file is written
    // only when the update names metadata
    if (mode === 'newVersion' || versionMetadataNext !== undefined) versionMetadataWrite(meta, versionId, versionMetadata);
    itemMetaWrite(meta);
    return { item: meta, version: versionDataBuild(versionId, input.data, versionMetadata) };
  }

  // soft delete: the folder and every version stay; the item reads as
  // deleted until it is restored
  function itemDelete(itemId: string): AssetItemMeta {
    const meta = itemGet(itemId);
    itemUnlockedCheck(meta);
    meta.isDeleted = true;
    meta.eventList.push({ eventType: 'delete', time: timeTextGet() });
    itemMetaWrite(meta);
    return meta;
  }

  function itemRestore(itemId: string): AssetItemMeta {
    const meta = itemGet(itemId);
    itemUnlockedCheck(meta);
    meta.isDeleted = false;
    meta.eventList.push({ eventType: 'restore', time: timeTextGet() });
    itemMetaWrite(meta);
    return meta;
  }

  // name, lang, content type and save mode of the item. the file extension
  // of the data files is decided at creation and kept, so nothing is renamed
  // for it; a new name renames the item's folder, and must not be the
  // name of another item. saveMode null removes the key (the item falls
  // back to in place); component null removes the component the data is for.
  function itemMetaSet(
    itemId: string,
    change: { name?: string; lang?: string; contentType?: string; saveMode?: AssetSaveMode | null; component?: unknown; owner?: unknown },
  ): AssetItemMeta {
    const meta = itemGet(itemId);
    itemUnlockedCheck(meta);
    if (change.name !== undefined) {
      const nameNext = nameNormalize(change.name);
      if (nameNext !== meta.name) {
        if (nameNext) {
          const metaOther = itemList().find((one) => one.name === nameNext && one.itemId !== meta.itemId);
          if (metaOther) throw new AssetError(-1, `the name "${nameNext}" is taken by item ${metaOther.itemId}`);
        }
        const dirPrevious = itemDirGet(meta);
        meta.name = nameNext;
        meta.dirName = dirNameInGroupBuild(meta.groupPath, itemDirNameBuild(meta.itemId, nameNext));
        fs.renameSync(dirPrevious, itemDirGet(meta));
      }
    }
    if (change.lang !== undefined) meta.lang = langNormalize(change.lang);
    if (change.contentType !== undefined) meta.contentType = String(change.contentType).trim() || 'application/octet-stream';
    if (change.saveMode !== undefined) {
      if (change.saveMode === null) delete meta.saveMode;
      else if (change.saveMode === 'inPlace' || change.saveMode === 'newVersion') meta.saveMode = change.saveMode;
      else throw new AssetError(-1, `saveMode must be inPlace or newVersion, got ${String(change.saveMode)}`);
    }
    if (change.component !== undefined) {
      const component = componentNormalize(change.component);
      if (component) meta.component = component;
      else delete meta.component;
    }
    if (change.owner !== undefined) {
      const owner = ownerNormalize(change.owner);
      if (owner) meta.owner = owner;
      else delete meta.owner;
    }
    meta.eventList.push({ eventType: 'metaSet', time: timeTextGet() });
    itemMetaWrite(meta);
    return meta;
  }

  // the item's folder moved into other groups ('' the top), of its store folder or of another
  // one named by folder, of any doc page; the groups it needs are made, the one it left is
  // removed when nothing is left in it. what the item is does not change: a group, like a store
  // folder, is only where its folder is, and every reference names the item by its id or name.
  // refused for a locked item, into a read-only folder, and in or out of a folder an object
  // owns unless its layer asks (asLayer)
  function itemMove(itemId: string, change: { groupPath: string; folder?: string; asLayer?: string }): AssetItemMeta {
    const meta = itemGet(itemId);
    itemUnlockedCheck(meta);
    const groupPath = groupPathNormalize(change.groupPath);
    const folderNext = change.folder ?? meta.folder;
    if (groupPath === meta.groupPath && folderNext === meta.folder) return meta;
    folderWritableCheck(folderNext);
    folderOwnerPlaceCheck(meta.folder, change.asLayer, 'moving an item');
    folderOwnerPlaceCheck(folderNext, change.asLayer, 'moving an item');
    const dirPrevious = itemDirGet(meta);
    const folderPrevious = meta.folder;
    const groupPathPrevious = meta.groupPath;
    const placeFrom = placeTextBuild(meta.folder, meta.groupPath);
    const dirNameNext = dirNameInGroupBuild(groupPath, path.basename(dirPrevious));
    const dirNext = path.join(folderAbsGet(folderNext), ...dirNameNext.split('/'));
    if (fs.existsSync(dirNext)) throw new AssetError(-1, `${dirNameNext} exists already in ${folderNext}`);
    fs.mkdirSync(path.dirname(dirNext), { recursive: true });
    dirMove(dirPrevious, dirNext);
    meta.folder = folderNext;
    meta.groupPath = groupPath;
    meta.dirName = dirNameNext;
    const folderOwnerNext = folderList.find((one) => one.path === folderNext)?.owner;
    if (folderOwnerNext) meta.folderOwner = folderOwnerNext;
    else delete meta.folderOwner;
    groupEmptyRemove(folderPrevious, groupPathPrevious);
    meta.eventList.push({ eventType: 'move', time: timeTextGet(), placeFrom, placeTo: placeTextBuild(folderNext, groupPath) });
    itemMetaWrite(meta);
    return meta;
  }

  // a group folder renamed or moved (groupPathFrom -> groupPathTo, both in
  // the store folder folderPath); every item inside goes with it. refused
  // when the target exists, or when a locked item is inside
  function groupMove(folderPath: string, groupPathFromInput: string, groupPathToInput: string, options: { asLayer?: string } = {}): void {
    const groupPathFrom = groupPathNormalize(groupPathFromInput);
    const groupPathTo = groupPathNormalize(groupPathToInput);
    if (!groupPathFrom || !groupPathTo) throw new AssetError(-1, 'a group is named by a path of folders inside the store folder');
    if (groupPathFrom === groupPathTo) return;
    folderWritableCheck(folderPath);
    folderOwnerPlaceCheck(folderPath, options.asLayer, 'moving a group');
    const folderAbs = folderAbsGet(folderPath);
    const dirFrom = path.join(folderAbs, ...groupPathFrom.split('/'));
    const dirTo = path.join(folderAbs, ...groupPathTo.split('/'));
    if (!fs.existsSync(dirFrom)) return;
    if (fs.existsSync(dirTo)) throw new AssetError(-1, `the group ${groupPathTo} exists already`);
    const folder = folderList.find((one) => one.path === folderPath)!;
    for (const one of itemDirList(folder)) {
      if (one.groupPath !== groupPathFrom && !one.groupPath.startsWith(`${groupPathFrom}/`)) continue;
      const meta = itemMetaRead(folder, one.dirName);
      if (meta?.isLocked) throw new AssetError(-1, `the item ${meta.itemId} in the group is locked`);
    }
    fs.mkdirSync(path.dirname(dirTo), { recursive: true });
    fs.renameSync(dirFrom, dirTo);
    groupEmptyRemove(folderPath, groupPathFrom.split('/').slice(0, -1).join('/'));
  }

  // a group folder that holds nothing any more (no file, no folder) is removed,
  // and so are the groups above it that become empty
  function groupEmptyRemove(folderPath: string, groupPath: string) {
    if (!groupPath) return;
    const folderAbs = folderAbsGet(folderPath);
    const partList = groupPath.split('/');
    while (partList.length > 0) {
      const dirAbs = path.join(folderAbs, ...partList);
      if (!fs.existsSync(dirAbs) || fs.readdirSync(dirAbs).length > 0) return;
      fs.rmdirSync(dirAbs);
      partList.pop();
    }
  }

  // the head moves to an existing version; a later new version branches from it
  function versionCheckout(itemId: string, versionId: string): AssetItemMeta {
    const meta = itemGet(itemId);
    itemUnlockedCheck(meta);
    versionMetaGet(meta, versionId);
    meta.versionIdHead = versionId;
    meta.eventList.push({ eventType: 'checkout', time: timeTextGet(), versionId });
    itemMetaWrite(meta);
    return meta;
  }

  // removes a version and its data file. the head cannot be removed. the
  // versions made from the removed one now name its own previous versions,
  // so the ancestry of every remaining version is kept.
  function versionDelete(itemId: string, versionId: string): AssetItemMeta {
    const meta = itemGet(itemId);
    itemUnlockedCheck(meta);
    const version = versionMetaGet(meta, versionId);
    versionUnlockedCheck(meta, versionId, 'deleted');
    if (meta.versionIdHead === versionId) throw new AssetError(-1, 'the head version cannot be deleted; set another head first');
    if (meta.versionList.length === 1) throw new AssetError(-1, 'the only version of an item cannot be deleted; delete the item');
    meta.versionList = meta.versionList.filter((one) => one.versionId !== versionId);
    for (const one of meta.versionList) {
      if (!one.versionIdPrevList.includes(versionId)) continue;
      const prevListNext: string[] = [];
      for (const prevId of one.versionIdPrevList) {
        const replacementList = prevId === versionId ? version.versionIdPrevList : [prevId];
        for (const id of replacementList) if (!prevListNext.includes(id)) prevListNext.push(id);
      }
      one.versionIdPrevList = prevListNext;
    }
    meta.eventList.push({ eventType: 'versionDelete', time: timeTextGet(), versionId });
    itemMetaWrite(meta);
    const filePath = versionPathGet(meta, versionId);
    const metadataPath = versionMetadataPathGet(meta, versionId);
    for (const file of [filePath, `${filePath}.bak`, metadataPath, `${metadataPath}.bak`]) {
      if (fs.existsSync(file)) fs.rmSync(file);
    }
    return meta;
  }

  // the item lock: the one write a locked item accepts is its unlock
  function itemLockSet(itemId: string, isLocked: boolean): AssetItemMeta {
    const meta = itemGet(itemId);
    if (typeof isLocked !== 'boolean') throw new AssetError(-1, 'isLocked must be true or false');
    if (meta.isLocked === isLocked) return meta;
    meta.isLocked = isLocked;
    meta.eventList.push({ eventType: isLocked ? 'lock' : 'unlock', time: timeTextGet() });
    itemMetaWrite(meta);
    return meta;
  }

  // the lock of one version; changing it is a change of the item, so a
  // locked item refuses it
  function versionLockSet(itemId: string, versionId: string, isLocked: boolean): AssetItemMeta {
    const meta = itemGet(itemId);
    itemUnlockedCheck(meta);
    if (typeof isLocked !== 'boolean') throw new AssetError(-1, 'isLocked must be true or false');
    const version = versionMetaGet(meta, versionId);
    if (version.isLocked === isLocked) return meta;
    version.isLocked = isLocked;
    meta.eventList.push({ eventType: isLocked ? 'lock' : 'unlock', time: timeTextGet(), versionId });
    itemMetaWrite(meta);
    return meta;
  }

  // ---------- dependencies ----------

  // what the data of a version depends on; versionId 'head' or '' reads the head
  function dependencyListGet(itemId: string, versionIdRequested = 'head'): { versionId: string; dependencyList: AssetDependency[] } {
    const meta = itemGet(itemId);
    const versionId = versionIdResolve(meta, versionIdRequested);
    return { versionId, dependencyList: versionMetaGet(meta, versionId).dependencyList };
  }

  // the list replaced. the dependencies describe the data of the version, so
  // a locked version keeps them as they are, like its bytes.
  function dependencyListSet(itemId: string, versionIdRequested: string, dependencyListInput: unknown): AssetItemMeta {
    const meta = itemGet(itemId);
    itemUnlockedCheck(meta);
    const versionId = versionIdResolve(meta, versionIdRequested);
    versionUnlockedCheck(meta, versionId, 'given other dependencies');
    const version = versionMetaGet(meta, versionId);
    version.dependencyList = dependencyListNormalize(dependencyListInput);
    meta.eventList.push({ eventType: 'dependencySet', time: timeTextGet(), versionId });
    itemMetaWrite(meta);
    return meta;
  }

  // one dependency added, unless the version has it already
  function dependencyAdd(itemId: string, versionIdRequested: string, dependencyInput: unknown): AssetItemMeta {
    const dependency = dependencyNormalize(dependencyInput);
    const { versionId, dependencyList } = dependencyListGet(itemId, versionIdRequested);
    if (dependencyList.some((one) => dependencyIsSame(one, dependency))) return itemGet(itemId);
    return dependencyListSet(itemId, versionId, [...dependencyList, dependency]);
  }

  function dependencyRemove(itemId: string, versionIdRequested: string, dependencyInput: unknown): AssetItemMeta {
    const dependency = dependencyNormalize(dependencyInput);
    const { versionId, dependencyList } = dependencyListGet(itemId, versionIdRequested);
    const dependencyListNext = dependencyList.filter((one) => !dependencyIsSame(one, dependency));
    if (dependencyListNext.length === dependencyList.length) return itemGet(itemId);
    return dependencyListSet(itemId, versionId, dependencyListNext);
  }

  // the versions of the store (deleted items included) whose data depends
  // on the item; with a versionId, on that version: a dependency without
  // versionId means the head, so it counts when the head is that version
  function dependentListGet(itemId: string, versionIdRequested = ''): AssetDependent[] {
    if (!idMs48Is(itemId)) throw new AssetError(-1, `not an item id: ${String(itemId)}`);
    const metaTarget = itemGet(itemId);
    const versionIdWanted = versionIdRequested === '' ? '' : versionIdResolve(metaTarget, versionIdRequested);
    const result: AssetDependent[] = [];
    for (const meta of itemList()) {
      for (const version of meta.versionList) {
        for (const dependency of version.dependencyList) {
          if (dependency.type !== 'asset' || dependency.itemId !== itemId) continue;
          const versionIdDepended = dependency.versionId ?? metaTarget.versionIdHead;
          if (versionIdWanted !== '' && versionIdDepended !== versionIdWanted) continue;
          result.push({ itemId: meta.itemId, versionId: version.versionId, dependency });
        }
      }
    }
    return result;
  }

  // the source files the versions of the live items depend on, each once;
  // a build collects them (doc_page_impl_source.md#files-in-a-build)
  function dependencySourcePathList(): string[] {
    const pathSet = new Set<string>();
    for (const meta of itemList()) {
      if (meta.isDeleted) continue;
      for (const version of meta.versionList) {
        for (const dependency of version.dependencyList) {
          if (dependency.type === 'source') pathSet.add(dependency.path);
        }
      }
    }
    return [...pathSet];
  }

  // ---------- build ----------

  // everything a built page needs: the live items with the data of every
  // version (text as text, other bytes base64), so pinned versions keep
  // working without a server
  function snapshotBuild(): AssetSnapshot {
    const itemById: AssetSnapshot['itemById'] = {};
    for (const meta of itemList()) {
      if (meta.isDeleted) continue;
      const versionDataById: Record<string, AssetSnapshotVersion> = {};
      for (const version of meta.versionList) {
        const filePath = versionPathGet(meta, version.versionId);
        if (!fs.existsSync(filePath)) continue;
        const data = versionDataBuild(version.versionId, fs.readFileSync(filePath), versionMetadataRead(meta, version.versionId));
        versionDataById[version.versionId] = data.isText
          ? { size: data.size, hash: data.hash, isText: true, text: data.text, metadata: data.metadata }
          : { size: data.size, hash: data.hash, isText: false, dataBase64: data.bytes.toString('base64'), metadata: data.metadata };
      }
      itemById[meta.itemId] = { ...meta, versionDataById };
    }
    return { itemById };
  }

  // text of a reference for build-time scans; undefined when it cannot be
  // read, or when the data is not text
  function referenceTextGet(reference: { store?: string; itemId?: string; name?: string; versionId: string }): { lang: string; text: string } | undefined {
    if (reference.store !== undefined && reference.store !== ASSET_STORE_ID_LOCAL) return undefined;
    try {
      const meta = itemFind(reference);
      const version = versionDataGetOf(meta, reference.versionId);
      if (!version.isText) return undefined;
      return { lang: meta.lang, text: version.text ?? '' };
    } catch {
      return undefined;
    }
  }

  // ---------- files ----------

  // dirName: the item's folder in the store folder, through its groups ("a/b/{id}--{name}")
  function itemMetaRead(folder: AssetFolder, dirName: string): AssetItemMeta | undefined {
    const partList = dirName.split('/');
    const filePath = path.join(folder.pathAbs, ...partList, ASSET_ITEM_META_NAME);
    if (!fs.existsSync(filePath)) return undefined;
    const content = yamlParse(fs.readFileSync(filePath, 'utf-8'));
    const meta = itemMetaNormalize(content, itemIdFromDirName(partList[partList.length - 1]), folder.path, dirName, partList.slice(0, -1).join('/'));
    if (folder.owner) meta.folderOwner = folder.owner;
    return meta;
  }

  // the file keeps one key order whatever the order the keys were set in;
  // folder and dirName are where the item was found, not part of the
  // item; component and saveMode are written only when they were set
  function itemMetaWrite(meta: AssetItemMeta) {
    const metaFile: Record<string, unknown> = {
      itemId: meta.itemId,
      name: meta.name,
      lang: meta.lang,
      contentType: meta.contentType,
      fileExt: meta.fileExt,
    };
    if (meta.component !== undefined) metaFile.component = meta.component;
    if (meta.owner !== undefined) metaFile.owner = meta.owner;
    if (meta.saveMode !== undefined) metaFile.saveMode = meta.saveMode;
    metaFile.versionIdHead = meta.versionIdHead;
    metaFile.isDeleted = meta.isDeleted;
    metaFile.isLocked = meta.isLocked;
    metaFile.timeCreated = meta.timeCreated;
    metaFile.versionList = meta.versionList;
    metaFile.eventList = meta.eventList;
    fileWriteSafe(itemMetaPathGet(meta), yamlStringify(metaFile));
  }

  return {
    config,
    folderList,
    folderOwnedAdd,
    folderInfoList,
    docPageInfoList,
    folderSet,
    itemList,
    itemGet,
    itemGetByName,
    itemFind,
    versionDataGet,
    versionDataGetOf,
    itemCreate,
    itemUpdate: (input: Parameters<typeof itemUpdate>[0]) => {
      folderWritableCheck(itemGet(input.itemId).folder);
      return itemUpdate(input);
    },
    itemDelete: itemWriteGuard(itemDelete),
    itemRestore: itemWriteGuard(itemRestore),
    itemMetaSet: itemWriteGuard(itemMetaSet),
    itemMove: itemWriteGuard(itemMove),
    groupMove: (folderPath: string, ...rest: any[]) => {
      folderWritableCheck(folderPath);
      return (groupMove as any)(folderPath, ...rest);
    },
    versionCheckout: itemWriteGuard(versionCheckout),
    versionDelete: itemWriteGuard(versionDelete),
    versionMetadataSet: itemWriteGuard(versionMetadataSet),
    itemLockSet: itemWriteGuard(itemLockSet),
    versionLockSet: itemWriteGuard(versionLockSet),
    dependencyListGet,
    dependencyListSet: itemWriteGuard(dependencyListSet),
    dependencyAdd: itemWriteGuard(dependencyAdd),
    dependencyRemove: itemWriteGuard(dependencyRemove),
    dependentListGet,
    dependencySourcePathList,
    snapshotBuild,
    referenceTextGet,
  };
}

export type AssetStore = ReturnType<typeof assetStoreCreate>;

export type AssetSnapshotVersion =
  | { size: number; hash: string; isText: true; text: string; metadata: AssetVersionMetadata }
  | { size: number; hash: string; isText: false; dataBase64: string; metadata: AssetVersionMetadata };

// the asset references of one document (doc_page_impl_asset.md#usage):
// usageList as assetUsageListScan of doc-asset-ref.js returns it
export type AssetUsageDoc = { docPath: string; contentHash: string; usageList: unknown[] };

export type AssetSnapshot = {
  itemById: Record<string, AssetItemMeta & { versionDataById: Record<string, AssetSnapshotVersion> }>;
  // the references of the documents of the build, added by the plugin
  usageDocList?: AssetUsageDoc[];
  // the frontend objects and types the doc pages declare, added by the plugin
  objectFrontend?: { docPageList: unknown[] };
};

// ---------- helpers ----------

// the effective save mode: the written one, else in place
export function saveModeGet(meta: Pick<AssetItemMeta, 'saveMode'>): AssetSaveMode {
  return meta.saveMode === 'newVersion' ? 'newVersion' : 'inPlace';
}

// the file extension and the media type the data files of a language get
const fileExtByLang: Record<string, string> = {
  '': 'txt',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  md: 'md',
  markdown: 'md',
  mdx: 'mdx',
  html: 'html',
  css: 'css',
  js: 'js',
  ts: 'ts',
  csv: 'csv',
  mermaid: 'mmd',
};

const contentTypeByLang: Record<string, string> = {
  '': 'text/plain',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  json: 'application/json',
  md: 'text/markdown',
  markdown: 'text/markdown',
  mdx: 'text/mdx',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/typescript',
  csv: 'text/csv',
  mermaid: 'text/plain',
};

const eventTypeList: AssetEventType[] = [
  'create', 'updateInPlace', 'versionCreate', 'checkout', 'versionDelete', 'metaSet', 'delete', 'restore', 'lock', 'unlock',
  'dependencySet', 'versionMetadataSet', 'move',
];

// ---------- version metadata ----------

// a mapping of plain values (what yaml can hold); a copy, so the caller's
// item is not kept
export function versionMetadataNormalize(input: unknown): AssetVersionMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AssetError(-1, 'versionMetadata must be a mapping');
  }
  return JSON.parse(JSON.stringify(input));
}

// ---------- dependencies ----------

export function dependencyListNormalize(listInput: unknown): AssetDependency[] {
  if (!Array.isArray(listInput)) throw new AssetError(-1, 'dependencyList must be a list');
  const result: AssetDependency[] = [];
  for (const one of listInput) {
    const dependency = dependencyNormalize(one);
    if (!result.some((kept) => dependencyIsSame(kept, dependency))) result.push(dependency);
  }
  return result;
}

export function dependencyNormalize(one: any): AssetDependency {
  if (!one || typeof one !== 'object') throw new AssetError(-1, 'a dependency must be a mapping with a type');
  if (one.type === 'source') {
    const pathText = sourcePathNormalize(one.path ?? '');
    if (!sourcePathIsRooted(pathText)) {
      throw new AssetError(-1, `a source dependency names a file by its source path (~page:root/...): ${JSON.stringify(one.path)}`);
    }
    return { type: 'source', path: pathText };
  }
  if (one.type === 'asset') {
    const itemId = String(one.itemId ?? '');
    if (!idMs48Is(itemId)) throw new AssetError(-1, `an asset dependency names an item by id: ${JSON.stringify(one.itemId)}`);
    const versionId = one.versionId === undefined || one.versionId === null || one.versionId === '' || one.versionId === 'head'
      ? undefined
      : String(one.versionId);
    return versionId === undefined ? { type: 'asset', itemId } : { type: 'asset', itemId, versionId };
  }
  throw new AssetError(-1, `unknown dependency type: ${JSON.stringify(one.type)} (source or asset)`);
}

export function dependencyIsSame(a: AssetDependency, b: AssetDependency): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'source' && b.type === 'source') return a.path === b.path;
  if (a.type === 'asset' && b.type === 'asset') return a.itemId === b.itemId && (a.versionId ?? '') === (b.versionId ?? '');
  return false;
}

// the list as a file holds it: items that are not dependencies are dropped
function dependencyListRead(listInput: unknown): AssetDependency[] {
  if (!Array.isArray(listInput)) return [];
  const result: AssetDependency[] = [];
  for (const one of listInput) {
    try {
      result.push(dependencyNormalize(one));
    } catch {
      // not a dependency
    }
  }
  return result;
}

function itemUnlockedCheck(meta: AssetItemMeta) {
  if (meta.isLocked) throw new AssetError(-1, `item ${meta.itemId} is locked; unlock it first`);
}

//   action   what the locked version cannot be, for the message
function versionUnlockedCheck(meta: AssetItemMeta, versionId: string, action: string) {
  if (versionMetaGet(meta, versionId).isLocked) throw new AssetError(-1, `version ${versionId} is locked and cannot be ${action}`);
}

function versionIdResolve(meta: AssetItemMeta, versionIdRequested: string): string {
  const versionId = versionIdRequested === '' || versionIdRequested === 'head' ? meta.versionIdHead : versionIdRequested;
  versionMetaGet(meta, versionId);
  return versionId;
}

function versionMetaGet(meta: AssetItemMeta, versionId: string): AssetVersionMeta {
  const version = meta.versionList.find((one) => one.versionId === versionId);
  if (!version) throw new AssetError(-3, `version ${versionId} not found in item ${meta.itemId}`);
  return version;
}

function versionMetaBuild(
  versionId: string,
  versionIdPrevList: string[],
  time: string,
  note: unknown,
  data: Buffer,
  dependencyList: AssetDependency[],
): AssetVersionMeta {
  return {
    versionId,
    versionIdPrevList,
    time,
    note: String(note ?? ''),
    size: data.length,
    hash: bytesHashGet(data),
    isLocked: false,
    dependencyList,
  };
}

function versionDataBuild(versionId: string, bytes: Buffer, metadata: AssetVersionMetadata): AssetVersionData {
  const text = textDecodeTry(bytes);
  return {
    versionId,
    bytes,
    size: bytes.length,
    hash: bytesHashGet(bytes),
    isText: text !== undefined,
    text,
    metadata,
  };
}

function langNormalize(lang: unknown): string {
  const langText = String(lang ?? '').trim().toLowerCase();
  if (langText === 'asset') throw new AssetError(-1, 'lang "asset" names a reference, not data');
  return langText;
}

function fileExtNormalize(fileExt: unknown): string {
  return String(fileExt ?? '').trim().replace(/^\.+/, '').toLowerCase().replace(/[^0-9a-z]/g, '');
}

// the metadata as the file holds it. a file without eventList (written
// before events were recorded) gets the one event its creation was.
function itemMetaNormalize(content: any, itemId: string, folder: string, dirName: string, groupPath = ''): AssetItemMeta {
  const versionList = Array.isArray(content?.versionList) ? content.versionList : [];
  const lang = String(content?.lang ?? '');
  const timeCreated = String(content?.timeCreated ?? '');
  const eventListRaw: unknown[] = Array.isArray(content?.eventList) ? content.eventList : [];
  const eventList: AssetEvent[] = [];
  for (const one of eventListRaw) {
    const event = eventNormalize(one);
    if (event) eventList.push(event);
  }
  if (eventList.length === 0) eventList.push({ eventType: 'create', time: timeCreated });
  const meta: AssetItemMeta = {
    itemId,
    name: String(content?.name ?? ''),
    lang,
    contentType: String(content?.contentType ?? '') || contentTypeByLang[lang] || 'application/octet-stream',
    fileExt: String(content?.fileExt ?? 'bin'),
    versionIdHead: String(content?.versionIdHead ?? ''),
    isDeleted: content?.isDeleted === true,
    isLocked: content?.isLocked === true,
    timeCreated,
    versionList: versionList.map((version: any) => ({
      versionId: String(version?.versionId ?? ''),
      versionIdPrevList: Array.isArray(version?.versionIdPrevList) ? version.versionIdPrevList.map(String) : [],
      time: String(version?.time ?? ''),
      note: String(version?.note ?? ''),
      size: Number.isFinite(Number(version?.size)) ? Number(version.size) : 0,
      hash: String(version?.hash ?? ''),
      isLocked: version?.isLocked === true,
      dependencyList: dependencyListRead(version?.dependencyList),
    })),
    eventList,
    folder,
    dirName,
    groupPath,
  };
  if (content?.saveMode === 'inPlace' || content?.saveMode === 'newVersion') meta.saveMode = content.saveMode;
  try {
    const owner = ownerNormalize(content?.owner ?? null);
    if (owner) meta.owner = owner;
  } catch {
    // an owner written by hand that is not { ref } is ignored on read
  }
  // a component entry written by hand that is not { name } is ignored on read
  try {
    const component = componentNormalize(content?.component ?? null);
    if (component) meta.component = component;
  } catch {
    // left out
  }
  return meta;
}

// the component the data of an item is for: { name } with a name, or
// undefined for null; anything else is a bad request
export function componentNormalize(value: unknown): AssetComponent | undefined {
  if (value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AssetError(-1, 'component must be a mapping { name }, or null to remove it');
  }
  const name = String((value as { name?: unknown }).name ?? '').trim();
  if (!name) throw new AssetError(-1, 'component needs a name (the tag name of the component)');
  return { name };
}

// the item an item's data belongs to: { ref, role? } with a reference
// {namespace}:{local}, or undefined for null; anything else is a bad request
export function ownerNormalize(value: unknown): AssetOwner | undefined {
  if (value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AssetError(-1, 'owner must be a mapping { ref, role? }, or null to remove it');
  }
  const ref = String((value as { ref?: unknown }).ref ?? '').trim();
  if (!/^[a-zA-Z][a-zA-Z0-9.-]*:.+$/.test(ref)) throw new AssetError(-1, 'owner.ref must be an item reference {namespace}:{local}');
  const role = String((value as { role?: unknown }).role ?? '').trim();
  return role ? { ref, role } : { ref };
}

// a path of group folders: "a/b", trimmed of slashes; '' is the top. a part
// may not be empty, "." or "..", nor start with a dot (dot folders are not read)
export function groupPathNormalize(value: unknown): string {
  const text = String(value ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (text === '') return '';
  const partList = text.split('/');
  if (partList.length > ASSET_GROUP_DEPTH_MAX) throw new AssetError(-1, `a group is at most ${ASSET_GROUP_DEPTH_MAX} folders deep`);
  for (const part of partList) {
    // eslint-disable-next-line no-control-regex
    if (part === '' || part.startsWith('.') || /[\\:*?"<>|\u0000-\u001f]/.test(part)) {
      throw new AssetError(-1, `not a group folder name: "${part}"`);
    }
    if (/[^\x20-\x7E]/.test(part)) throw new AssetError(-1, `a group folder name is in ASCII only: "${part}"`);
  }
  return partList.join('/');
}

function dirNameInGroupBuild(groupPath: string, dirNameOwn: string): string {
  return groupPath ? `${groupPath}/${dirNameOwn}` : dirNameOwn;
}

function eventNormalize(one: any): AssetEvent | undefined {
  if (!one || typeof one !== 'object') return undefined;
  const eventType = String(one.eventType ?? '') as AssetEventType;
  if (!eventTypeList.includes(eventType)) return undefined;
  const event: AssetEvent = { eventType, time: String(one.time ?? '') };
  if (one.versionId !== undefined && one.versionId !== null && one.versionId !== '') event.versionId = String(one.versionId);
  if (one.userId !== undefined && one.userId !== null && one.userId !== '') event.userId = String(one.userId);
  if (typeof one.placeFrom === 'string') event.placeFrom = one.placeFrom;
  if (typeof one.placeTo === 'string') event.placeTo = one.placeTo;
  return event;
}

// an existing file is copied to {file}.bak first; the new content is written
// to {file}.tmp and renamed into place
export function fileWriteSafe(filePath: string, content: string | Buffer) {
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, `${filePath}.bak`);
  const filePathTmp = `${filePath}.tmp`;
  if (typeof content === 'string') fs.writeFileSync(filePathTmp, content, 'utf-8');
  else fs.writeFileSync(filePathTmp, content);
  fs.renameSync(filePathTmp, filePath);
}

// sha1 of the bytes, hex; the hash of a text is the hash of its utf-8 bytes
export function bytesHashGet(bytes: Buffer): string {
  return createHash('sha1').update(bytes).digest('hex');
}

export function textHashGet(text: string): string {
  return bytesHashGet(Buffer.from(text, 'utf-8'));
}

// the text of the bytes when they are valid utf-8 without NUL characters;
// undefined otherwise (the data is binary for the page)
const textDecoderStrict = new TextDecoder('utf-8', { fatal: true });
export function textDecodeTry(bytes: Buffer): string | undefined {
  try {
    const text = textDecoderStrict.decode(bytes);
    if (text.includes('\u0000')) return undefined;
    return text;
  } catch {
    return undefined;
  }
}

// time-format.md: 20260520_23250530+09 (lib/time-text.js)
export { timeTextGet };
