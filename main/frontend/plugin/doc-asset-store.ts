import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { idMs48Create, idMs48Is } from './id-ms48.ts';
import { sourcePathIsRooted, sourcePathNormalize } from '../src/lib/doc-source-path.js';
import { timeTextGet } from '../src/lib/time-text.js';

// The local store of the asset service layer, on disk (design: doc_page_impl_asset.md). A general
// store of objects with a version history, modeled after an object storage
// (s3): an object is a key with metadata, a version is a sequence of bytes
// under that key, and the store does not care whether the bytes are text.
// There is one local store; its objects live in one or more folders, named
// in the store's config file (config.yaml asset.file -> asset.yaml), and a
// new object is created in the default folder. Everything is a file: the
// folders and their files are the whole state.
//
//   asset.yaml                        the store config: folderList [{ path, isDefault }]
//   {folder}/
//     {objectId}--{name}/             one folder per object: its id (ms_48), and its name
//       object.yaml                   when it has one, after the separator "--"
//       object.yaml.bak               the previous object.yaml, before the last rewrite
//       {versionId}.{fileExt}         the bytes of one version
//       {versionId}.{fileExt}.bak     the previous bytes, before an in-place update
//       {versionId}.metadata.yaml     the metadata of one version's data, when it has any
//       {versionId}.metadata.yaml.bak the previous metadata, before it was rewritten
//
// object.yaml:
//   objectId, name, lang, contentType, fileExt, component?, saveMode?, versionIdHead,
//   isDeleted, isLocked, timeCreated,
//   versionList: [{ versionId, versionIdPrevList, time, note, size, hash, isLocked, dependencyList }]
//   eventList:   [{ eventType, time, versionId?, userId? }]
//
// what each file records: object.yaml is what the store itself keeps and
// answers questions with, the object and, for every version, its place in
// the history (predecessors, time, note), what identifies its bytes (size,
// hash), its lock and its dependencies: everything the store needs without
// reading any version file. {versionId}.metadata.yaml is what the writer of
// the data says about that data, a mapping the store never interprets (the
// version of the engine that wrote it, how a component displays it). it is
// read and written with the version's bytes, not with the object: listing
// the store reads no version file. a version without metadata has no file.
//
// dependencies (doc_page_impl_asset.md#dependencies): the data of a version
// may stand for more than its bytes: an Image version names an image file of
// the doc page source, a version may reuse another asset. every version
// records what its data depends on as dependencyList, one mapping per
// dependency with a type:
//   { type: source, path }                          a file of the source, by source path (~rootId/...)
//   { type: asset, objectId, versionId? }           a version of another object of this store;
//                                                   no versionId means the head
// the list is declared by whoever writes the data (the page knows which
// component the data is for, the store does not) and kept with the version:
// a new version copies the list of the version it is made from unless the
// write names one. the store answers the other direction too (the versions
// that depend on an object or a version), the base of resolving a deletion.
//
// locks: a locked version cannot be rewritten in place or deleted (a new
// version can still be made from it, and the head can still move to it or
// away). a locked object cannot be changed at all, its versions, head,
// metadata and deletion mark included, until it is unlocked; unlocking is
// the one write it accepts.
//
// an object has a random id and may have a name a person chooses. the name
// is unique in the store (every folder, deleted objects included), so a
// reference may name the object by either; creating an object with the name
// of an existing one returns that object and creates nothing. the id and
// the name never contain the separator "--" of the folder name, so the id
// of a folder is what stands before the first "--".
//
// the history is a DAG kept in the object metadata: a version names the
// versions it was made from (versionIdPrevList: none for the first version,
// one for an ordinary update, several for a merge). the head is the version
// a document reading "head" receives; it can be moved to any version
// (checkout), and the next new version then branches from there.
//
// eventList is what happened to the object, in order: create, updateInPlace
// (the head bytes rewritten, versionId says which version), versionCreate,
// checkout, versionDelete, metaSet, delete, restore, lock, unlock (with
// versionId for the lock of one version). every event is a
// mapping, so a key may be missing: userId is reserved for a store that
// knows who writes. times carry their zone (time-format.md).
//
// component says which component the data is for, when it is the data of a
// component block: { name } (the tag name the page created it for). it is a
// record for recovering an object no block references any more, not a rule:
// the store does not check it and a block of another component may read the
// object. absent for data that serves another purpose.
//
// saveMode says what a save of the head does when the caller names no mode:
// inPlace (the head version is rewritten; the default when the key is not
// written) or newVersion (a version is appended and becomes the head).
//
// every rewrite of an existing file first copies it to {file}.bak, then
// writes a temporary file and renames it into place, so an interrupted
// write never leaves a half-written object.yaml or data file behind.
//
// errors are AssetError with the codes of the api:
//   -1 bad request, -2 conflict (the data changed since it was read), -3 not found

export const ASSET_OBJECT_META_NAME = 'object.yaml';

// the id of the local store in a reference (store: local)
export const ASSET_STORE_ID_LOCAL = 'local';

// between the id and the name in the folder name of an object. an id is
// base 36, so it never holds it; a name is refused when it does.
export const ASSET_DIR_SEPARATOR = '--';

export const ASSET_NAME_LENGTH_MAX = 80;

export type AssetSaveMode = 'inPlace' | 'newVersion';

// the component the data of an object is for (doc_page_impl_asset.md#objects-for-components);
// name only for now, an id and a version of the component are expected later
export type AssetComponent = { name: string };

export type AssetEventType =
  | 'create' | 'updateInPlace' | 'versionCreate' | 'checkout' | 'versionDelete' | 'metaSet' | 'delete' | 'restore'
  | 'lock' | 'unlock' | 'dependencySet' | 'versionMetadataSet';

// what the writer of a version's data says about it ({versionId}.metadata.yaml);
// the store keeps it and never interprets it
export type AssetVersionMetadata = Record<string, unknown>;

// what the data of a version depends on
export type AssetDependency =
  | { type: 'source'; path: string }
  | { type: 'asset'; objectId: string; versionId?: string };

// a version that depends on an object (or one of its versions)
export type AssetDependent = { objectId: string; versionId: string; dependency: AssetDependency };

export type AssetEvent = {
  eventType: AssetEventType;
  // time-format.md: 20260520_23250530+09, the zone included
  time: string;
  // the version the event is about, for the events that concern one
  versionId?: string;
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

export type AssetObjectMeta = {
  objectId: string;
  // '' or a name unique in the store; see nameNormalize for what a name may hold
  name: string;
  // the fence language a component reads the data as ('' when it is not for a code block)
  lang: string;
  // media type of the data, as an object storage records it
  contentType: string;
  fileExt: string;
  // the component the data is for; absent when it is not a component's data
  component?: AssetComponent;
  saveMode?: AssetSaveMode;
  versionIdHead: string;
  isDeleted: boolean;
  // nothing of the object changes until it is unlocked
  isLocked: boolean;
  timeCreated: string;
  versionList: AssetVersionMeta[];
  eventList: AssetEvent[];
  // where the object was found (not written into object.yaml): the folder
  // of the store, as written in asset.yaml, and the object's folder in it
  folder: string;
  dirName: string;
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
  // as written in asset.yaml (relative to it, or absolute)
  path: string;
  pathAbs: string;
  isDefault: boolean;
};

export type AssetFolderInfo = AssetFolder & { isExists: boolean; objectCount: number };

export type AssetStoreConfig = {
  // absolute path of asset.yaml
  file: string;
  folderList: AssetFolder[];
};

// what names an object: its id, or its name
export type AssetObjectKey = { objectId?: string; name?: string };

export class AssetError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

// ---------- the store config file ----------

// the local store of the asset service layer that config.yaml names: asset.file, the store config
// file, relative to config.yaml. undefined when config.yaml has no asset
// section: the page has no asset service layer. a section that names the store in a
// form that is not read (the former asset.folder) or not at all is an error
// that says how to write it, never a silent "no store": the page would
// otherwise find out only when a write fails.
export function assetConfigOfConfigDocGet(configDoc: any, configDir: string): AssetStoreConfig | undefined {
  const asset = configDoc?.asset;
  if (asset === undefined || asset === null) return undefined;
  if (typeof asset !== 'object' || Array.isArray(asset)) {
    throw new Error(`[doc-source] config.yaml "asset" must be a mapping with "file", e.g. asset: { file: ./asset.yaml }${assetConfigMigrationText('./asset')}`);
  }
  if (asset.folder !== undefined) {
    throw new Error(`[doc-source] config.yaml "asset.folder" is no longer read: the local store of the asset service layer is described by a config file of its own, named by "asset.file".${assetConfigMigrationText(String(asset.folder))}`);
  }
  const file = asset.file;
  if (typeof file !== 'string' || !file.trim()) {
    throw new Error(`[doc-source] config.yaml "asset" needs "file": the config file of the local store of the asset service layer.${assetConfigMigrationText('./asset')}`);
  }
  return assetConfigRead(path.resolve(configDir, file.trim()));
}

// how a store is configured, for the errors above
function assetConfigMigrationText(folderPath: string): string {
  return [
    '',
    'write in config.yaml:',
    '  asset:',
    '    file: ./asset.yaml',
    'and in asset.yaml (paths are relative to asset.yaml):',
    '  folderList:',
    `    - path: ${folderPath}`,
    '      isDefault: true',
    'the object folders already on disk stay as they are; no id or data changes.',
    'restart the development server afterwards: the asset api is installed when it starts.',
  ].join('\n');
}

// asset.yaml: folderList [{ path, isDefault }], paths relative to the file.
// a missing file is an empty store, and a missing folder is created when the
// first object is written to it; without a default the first folder is it.
// a file that is not yaml, or whose folderList is not a list, is an error.
export function assetConfigRead(fileAbs: string): AssetStoreConfig {
  let content: any = {};
  if (fs.existsSync(fileAbs)) {
    try {
      content = yamlParse(fs.readFileSync(fileAbs, 'utf-8')) ?? {};
    } catch (error: any) {
      throw new Error(`[doc-source] the local store config ${fileAbs} is not valid yaml: ${String(error?.message ?? error)}`);
    }
  }
  if (typeof content !== 'object' || Array.isArray(content)) {
    throw new Error(`[doc-source] the local store config ${fileAbs} must be a mapping with "folderList"`);
  }
  if (content.folderList !== undefined && !Array.isArray(content.folderList)) {
    throw new Error(`[doc-source] "folderList" of the local store config ${fileAbs} must be a list of { path, isDefault }`);
  }
  const folderList = folderListNormalize(content.folderList, path.dirname(fileAbs));
  return { file: fileAbs, folderList };
}

export function assetConfigWrite(fileAbs: string, folderListInput: { path: string; isDefault?: boolean }[]): AssetStoreConfig {
  const folderList = folderListNormalize(folderListInput, path.dirname(fileAbs));
  if (folderList.length === 0) throw new AssetError(-1, 'the local store needs at least one folder');
  const body = yamlStringify({
    folderList: folderList.map((folder) => (folder.isDefault ? { path: folder.path, isDefault: true } : { path: folder.path })),
  });
  fs.mkdirSync(path.dirname(fileAbs), { recursive: true });
  fileWriteSafe(fileAbs, `${ASSET_CONFIG_HEADER}${body}`);
  return { file: fileAbs, folderList };
}

const ASSET_CONFIG_HEADER = [
  '# the local store of the asset service layer (doc_page_impl_asset.md): the folders',
  '# its objects',
  '# live in. a new object is created in the default folder. paths are relative',
  '# to this file. rewritten by the settings panel of the page (Asset service tab).',
  '',
].join('\n');

function folderListNormalize(listRaw: unknown, dirBase: string): AssetFolder[] {
  const folderList: AssetFolder[] = [];
  for (const item of Array.isArray(listRaw) ? listRaw : []) {
    const pathText = typeof item === 'string' ? item : String(item?.path ?? '');
    const pathTrimmed = pathText.trim();
    if (!pathTrimmed) continue;
    const pathAbs = path.resolve(dirBase, pathTrimmed);
    if (folderList.some((folder) => folder.pathAbs === pathAbs)) continue;
    folderList.push({ path: pathTrimmed, pathAbs, isDefault: typeof item === 'object' && item?.isDefault === true });
  }
  const indexDefault = folderList.findIndex((folder) => folder.isDefault);
  folderList.forEach((folder, index) => {
    folder.isDefault = index === (indexDefault === -1 ? 0 : indexDefault);
  });
  return folderList;
}

// ---------- the folder name of an object ----------

// {objectId}--{name}, or {objectId} alone for an object without a name
export function objectDirNameBuild(objectId: string, name: string): string {
  return name ? `${objectId}${ASSET_DIR_SEPARATOR}${name}` : objectId;
}

// the id part of a folder name; '' when the folder is not an object's
export function objectIdFromDirName(dirName: string): string {
  const indexSeparator = dirName.indexOf(ASSET_DIR_SEPARATOR);
  const objectId = indexSeparator === -1 ? dirName : dirName.slice(0, indexSeparator);
  return idMs48Is(objectId) ? objectId : '';
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

// ---------- the store ----------

export function assetStoreCreate(config: AssetStoreConfig) {
  const folderList = config.folderList;
  const folderDefault = folderList.find((folder) => folder.isDefault);
  const objectDirGet = (meta: AssetObjectMeta) => path.join(folderAbsGet(meta.folder), meta.dirName);
  const objectMetaPathGet = (meta: AssetObjectMeta) => path.join(objectDirGet(meta), ASSET_OBJECT_META_NAME);
  const versionPathGet = (meta: AssetObjectMeta, versionId: string) => path.join(objectDirGet(meta), `${versionId}.${meta.fileExt}`);
  // always yaml, whatever the extension of the data file
  const versionMetadataPathGet = (meta: AssetObjectMeta, versionId: string) => path.join(objectDirGet(meta), `${versionId}.metadata.yaml`);

  function folderAbsGet(folderPath: string): string {
    const folder = folderList.find((item) => item.path === folderPath);
    if (!folder) throw new AssetError(-3, `asset folder not in the store: ${folderPath}`);
    return folder.pathAbs;
  }

  // the object folders of a store folder: [{ dirName, objectId }], in name order
  function objectDirList(folder: AssetFolder): { dirName: string; objectId: string }[] {
    if (!fs.existsSync(folder.pathAbs)) return [];
    const list: { dirName: string; objectId: string }[] = [];
    for (const item of fs.readdirSync(folder.pathAbs, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const objectId = objectIdFromDirName(item.name);
      if (!objectId) continue;
      if (!fs.existsSync(path.join(folder.pathAbs, item.name, ASSET_OBJECT_META_NAME))) continue;
      list.push({ dirName: item.name, objectId });
    }
    return list;
  }

  // the folder of an object in one store folder; undefined when it is not there
  function objectDirFind(folder: AssetFolder, objectId: string): string | undefined {
    return objectDirList(folder).find((item) => item.objectId === objectId)?.dirName;
  }

  // ---------- the folders ----------

  function folderInfoList(): AssetFolderInfo[] {
    return folderList.map((folder) => ({
      ...folder,
      isExists: fs.existsSync(folder.pathAbs),
      objectCount: objectDirList(folder).length,
    }));
  }

  // rewrites asset.yaml and creates a folder of the list that does not exist
  // yet (a folder added from the page is meant to receive objects); the next
  // store created from the config sees the new folders
  function folderSet(folderListInput: { path: string; isDefault?: boolean }[]): AssetFolderInfo[] {
    const configNext = assetConfigWrite(config.file, folderListInput);
    for (const folder of configNext.folderList) fs.mkdirSync(folder.pathAbs, { recursive: true });
    return assetStoreCreate(configNext).folderInfoList();
  }

  // ---------- reading ----------

  // every object of every folder; an id present in two folders is read from
  // the first folder that has it (the folder order of asset.yaml)
  function objectList(): AssetObjectMeta[] {
    const metaList: AssetObjectMeta[] = [];
    const objectIdSeen = new Set<string>();
    for (const folder of folderList) {
      for (const item of objectDirList(folder)) {
        if (objectIdSeen.has(item.objectId)) continue;
        const meta = objectMetaRead(folder, item.dirName);
        if (!meta) continue;
        objectIdSeen.add(item.objectId);
        metaList.push(meta);
      }
    }
    metaList.sort((a, b) => a.timeCreated.localeCompare(b.timeCreated));
    return metaList;
  }

  function objectGet(objectId: string): AssetObjectMeta {
    if (!idMs48Is(objectId)) throw new AssetError(-1, `not an object id: ${String(objectId)}`);
    for (const folder of folderList) {
      const dirName = objectDirFind(folder, objectId);
      if (!dirName) continue;
      const meta = objectMetaRead(folder, dirName);
      if (meta) return meta;
    }
    throw new AssetError(-3, `asset object not found: ${objectId}`);
  }

  // the object with that name; names are unique in the store
  function objectGetByName(name: string): AssetObjectMeta {
    const nameWanted = nameNormalize(name);
    if (!nameWanted) throw new AssetError(-1, 'name is required');
    const meta = objectList().find((item) => item.name === nameWanted);
    if (!meta) throw new AssetError(-3, `asset object not found by name: ${nameWanted}`);
    return meta;
  }

  // by id when the key has one, else by name
  function objectFind(key: AssetObjectKey): AssetObjectMeta {
    if (key.objectId) return objectGet(key.objectId);
    if (key.name) return objectGetByName(key.name);
    throw new AssetError(-1, 'objectId or name is required');
  }

  // versionId 'head' or '' reads the head version
  function versionDataGet(objectId: string, versionIdRequested = 'head'): AssetVersionData {
    const meta = objectGet(objectId);
    return versionDataGetOf(meta, versionIdRequested);
  }

  function versionDataGetOf(meta: AssetObjectMeta, versionIdRequested = 'head'): AssetVersionData {
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
  function versionMetadataRead(meta: AssetObjectMeta, versionId: string): AssetVersionMetadata {
    const filePath = versionMetadataPathGet(meta, versionId);
    if (!fs.existsSync(filePath)) return {};
    const content = yamlParse(fs.readFileSync(filePath, 'utf-8'));
    if (!content || typeof content !== 'object' || Array.isArray(content)) return {};
    return content as AssetVersionMetadata;
  }

  // an empty mapping removes the file (its previous content is kept as .bak)
  function versionMetadataWrite(meta: AssetObjectMeta, versionId: string, metadata: AssetVersionMetadata) {
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
  function versionMetadataSet(objectId: string, versionIdRequested: string, metadataInput: unknown): { object: AssetObjectMeta; version: AssetVersionData } {
    const metadata = versionMetadataNormalize(metadataInput);
    const meta = objectGet(objectId);
    objectUnlockedCheck(meta);
    const versionId = versionIdResolve(meta, versionIdRequested);
    versionUnlockedCheck(meta, versionId, 'given other metadata');
    versionMetadataWrite(meta, versionId, metadata);
    meta.eventList.push({ eventType: 'versionMetadataSet', time: timeTextGet(), versionId });
    objectMetaWrite(meta);
    return { object: meta, version: versionDataGetOf(meta, versionId) };
  }

  // ---------- writing ----------

  // a new object with its first version. when the name is the name of an
  // object of the store, that object is returned (isCreated false) and
  // nothing is written: a name means one object.
  //   folder           the folder the object is created in (as written in asset.yaml); the default folder when absent
  //   dependencyList   what the data of the first version depends on (none when absent)
  //   saveMode         written into the object when given; absent: the key is not written
  //   versionMetadata  the metadata of the first version (none when absent)
  //   component        { name }: the component the data is for; absent: not written
  function objectCreate(input: {
    name?: string;
    lang?: string;
    contentType?: string;
    fileExt?: string;
    data: Buffer;
    note?: string;
    folder?: string;
    dependencyList?: unknown;
    saveMode?: unknown;
    versionMetadata?: unknown;
    component?: unknown;
  }): { object: AssetObjectMeta; version: AssetVersionData; isCreated: boolean } {
    if (!Buffer.isBuffer(input.data)) throw new AssetError(-1, 'data is required');
    const dependencyList = dependencyListNormalize(input.dependencyList ?? []);
    const versionMetadata = versionMetadataNormalize(input.versionMetadata ?? {});
    const component = componentNormalize(input.component ?? null);
    if (input.saveMode !== undefined && input.saveMode !== 'inPlace' && input.saveMode !== 'newVersion') {
      throw new AssetError(-1, `saveMode must be inPlace or newVersion, got ${String(input.saveMode)}`);
    }
    const name = nameNormalize(input.name);
    if (name) {
      const metaExisting = objectList().find((item) => item.name === name);
      if (metaExisting) return { object: metaExisting, version: versionDataGetOf(metaExisting, 'head'), isCreated: false };
    }
    const folder = input.folder ? folderList.find((item) => item.path === input.folder) : folderDefault;
    if (!folder) {
      throw new AssetError(-1, input.folder ? `asset folder not in the store: ${input.folder}` : 'the local store has no folder');
    }
    const lang = langNormalize(input.lang);
    fs.mkdirSync(folder.pathAbs, { recursive: true });
    const isObjectIdUsed = (id: string) => folderList.some((item) => objectDirFind(item, id) !== undefined);
    const objectId = idMs48Create(isObjectIdUsed);
    const versionId = idMs48Create();
    const time = timeTextGet();
    const fileExt = fileExtNormalize(input.fileExt) || fileExtByLang[lang] || 'bin';
    const meta: AssetObjectMeta = {
      objectId,
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
      dirName: objectDirNameBuild(objectId, name),
    };
    if (component) meta.component = component;
    if (input.saveMode === 'inPlace' || input.saveMode === 'newVersion') meta.saveMode = input.saveMode;
    fs.mkdirSync(objectDirGet(meta), { recursive: true });
    fileWriteSafe(versionPathGet(meta, versionId), input.data);
    versionMetadataWrite(meta, versionId, versionMetadata);
    objectMetaWrite(meta);
    return { object: meta, version: versionDataBuild(versionId, input.data, versionMetadata), isCreated: true };
  }

  // hashBase: the hash of the head data the caller changed; a different
  // head on disk means somebody else wrote meanwhile (code -2).
  //   mode   inPlace: the head version's data is rewritten (its .bak keeps the old one)
  //          newVersion: a new version is created from the head and becomes the head
  //          absent: the object's saveMode, inPlace when none is written
  //   dependencyList   what the new data depends on; absent: the list of the
  //                    version the data replaces or is made from is kept
  //   versionMetadata  the metadata of the new data; absent: the metadata of
  //                    the version the data replaces or is made from is kept
  function objectUpdate(input: {
    objectId: string;
    hashBase: string;
    data: Buffer;
    mode?: AssetSaveMode;
    note?: string;
    dependencyList?: unknown;
    versionMetadata?: unknown;
  }): { object: AssetObjectMeta; version: AssetVersionData } {
    if (!Buffer.isBuffer(input.data)) throw new AssetError(-1, 'data is required');
    const dependencyListNext = input.dependencyList === undefined ? undefined : dependencyListNormalize(input.dependencyList);
    const versionMetadataNext = input.versionMetadata === undefined ? undefined : versionMetadataNormalize(input.versionMetadata);
    const meta = objectGet(input.objectId);
    objectUnlockedCheck(meta);
    if (meta.isDeleted) throw new AssetError(-1, 'the object is deleted; restore it first');
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
      const dependencyList = dependencyListNext ?? versionHead.dependencyList.map((item) => ({ ...item }));
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
    objectMetaWrite(meta);
    return { object: meta, version: versionDataBuild(versionId, input.data, versionMetadata) };
  }

  // soft delete: the folder and every version stay; the object reads as
  // deleted until it is restored
  function objectDelete(objectId: string): AssetObjectMeta {
    const meta = objectGet(objectId);
    objectUnlockedCheck(meta);
    meta.isDeleted = true;
    meta.eventList.push({ eventType: 'delete', time: timeTextGet() });
    objectMetaWrite(meta);
    return meta;
  }

  function objectRestore(objectId: string): AssetObjectMeta {
    const meta = objectGet(objectId);
    objectUnlockedCheck(meta);
    meta.isDeleted = false;
    meta.eventList.push({ eventType: 'restore', time: timeTextGet() });
    objectMetaWrite(meta);
    return meta;
  }

  // name, lang, content type and save mode of the object. the file extension
  // of the data files is decided at creation and kept, so nothing is renamed
  // for it; a new name renames the object's folder, and must not be the
  // name of another object. saveMode null removes the key (the object falls
  // back to in place); component null removes the component the data is for.
  function objectMetaSet(
    objectId: string,
    change: { name?: string; lang?: string; contentType?: string; saveMode?: AssetSaveMode | null; component?: unknown },
  ): AssetObjectMeta {
    const meta = objectGet(objectId);
    objectUnlockedCheck(meta);
    if (change.name !== undefined) {
      const nameNext = nameNormalize(change.name);
      if (nameNext !== meta.name) {
        if (nameNext) {
          const metaOther = objectList().find((item) => item.name === nameNext && item.objectId !== meta.objectId);
          if (metaOther) throw new AssetError(-1, `the name "${nameNext}" is taken by object ${metaOther.objectId}`);
        }
        const dirPrevious = objectDirGet(meta);
        meta.name = nameNext;
        meta.dirName = objectDirNameBuild(meta.objectId, nameNext);
        fs.renameSync(dirPrevious, objectDirGet(meta));
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
    meta.eventList.push({ eventType: 'metaSet', time: timeTextGet() });
    objectMetaWrite(meta);
    return meta;
  }

  // the head moves to an existing version; a later new version branches from it
  function versionCheckout(objectId: string, versionId: string): AssetObjectMeta {
    const meta = objectGet(objectId);
    objectUnlockedCheck(meta);
    versionMetaGet(meta, versionId);
    meta.versionIdHead = versionId;
    meta.eventList.push({ eventType: 'checkout', time: timeTextGet(), versionId });
    objectMetaWrite(meta);
    return meta;
  }

  // removes a version and its data file. the head cannot be removed. the
  // versions made from the removed one now name its own previous versions,
  // so the ancestry of every remaining version is kept.
  function versionDelete(objectId: string, versionId: string): AssetObjectMeta {
    const meta = objectGet(objectId);
    objectUnlockedCheck(meta);
    const version = versionMetaGet(meta, versionId);
    versionUnlockedCheck(meta, versionId, 'deleted');
    if (meta.versionIdHead === versionId) throw new AssetError(-1, 'the head version cannot be deleted; set another head first');
    if (meta.versionList.length === 1) throw new AssetError(-1, 'the only version of an object cannot be deleted; delete the object');
    meta.versionList = meta.versionList.filter((item) => item.versionId !== versionId);
    for (const item of meta.versionList) {
      if (!item.versionIdPrevList.includes(versionId)) continue;
      const prevListNext: string[] = [];
      for (const prevId of item.versionIdPrevList) {
        const replacementList = prevId === versionId ? version.versionIdPrevList : [prevId];
        for (const id of replacementList) if (!prevListNext.includes(id)) prevListNext.push(id);
      }
      item.versionIdPrevList = prevListNext;
    }
    meta.eventList.push({ eventType: 'versionDelete', time: timeTextGet(), versionId });
    objectMetaWrite(meta);
    const filePath = versionPathGet(meta, versionId);
    const metadataPath = versionMetadataPathGet(meta, versionId);
    for (const file of [filePath, `${filePath}.bak`, metadataPath, `${metadataPath}.bak`]) {
      if (fs.existsSync(file)) fs.rmSync(file);
    }
    return meta;
  }

  // the object lock: the one write a locked object accepts is its unlock
  function objectLockSet(objectId: string, isLocked: boolean): AssetObjectMeta {
    const meta = objectGet(objectId);
    if (typeof isLocked !== 'boolean') throw new AssetError(-1, 'isLocked must be true or false');
    if (meta.isLocked === isLocked) return meta;
    meta.isLocked = isLocked;
    meta.eventList.push({ eventType: isLocked ? 'lock' : 'unlock', time: timeTextGet() });
    objectMetaWrite(meta);
    return meta;
  }

  // the lock of one version; changing it is a change of the object, so a
  // locked object refuses it
  function versionLockSet(objectId: string, versionId: string, isLocked: boolean): AssetObjectMeta {
    const meta = objectGet(objectId);
    objectUnlockedCheck(meta);
    if (typeof isLocked !== 'boolean') throw new AssetError(-1, 'isLocked must be true or false');
    const version = versionMetaGet(meta, versionId);
    if (version.isLocked === isLocked) return meta;
    version.isLocked = isLocked;
    meta.eventList.push({ eventType: isLocked ? 'lock' : 'unlock', time: timeTextGet(), versionId });
    objectMetaWrite(meta);
    return meta;
  }

  // ---------- dependencies ----------

  // what the data of a version depends on; versionId 'head' or '' reads the head
  function dependencyListGet(objectId: string, versionIdRequested = 'head'): { versionId: string; dependencyList: AssetDependency[] } {
    const meta = objectGet(objectId);
    const versionId = versionIdResolve(meta, versionIdRequested);
    return { versionId, dependencyList: versionMetaGet(meta, versionId).dependencyList };
  }

  // the list replaced. the dependencies describe the data of the version, so
  // a locked version keeps them as they are, like its bytes.
  function dependencyListSet(objectId: string, versionIdRequested: string, dependencyListInput: unknown): AssetObjectMeta {
    const meta = objectGet(objectId);
    objectUnlockedCheck(meta);
    const versionId = versionIdResolve(meta, versionIdRequested);
    versionUnlockedCheck(meta, versionId, 'given other dependencies');
    const version = versionMetaGet(meta, versionId);
    version.dependencyList = dependencyListNormalize(dependencyListInput);
    meta.eventList.push({ eventType: 'dependencySet', time: timeTextGet(), versionId });
    objectMetaWrite(meta);
    return meta;
  }

  // one dependency added, unless the version has it already
  function dependencyAdd(objectId: string, versionIdRequested: string, dependencyInput: unknown): AssetObjectMeta {
    const dependency = dependencyNormalize(dependencyInput);
    const { versionId, dependencyList } = dependencyListGet(objectId, versionIdRequested);
    if (dependencyList.some((item) => dependencyIsSame(item, dependency))) return objectGet(objectId);
    return dependencyListSet(objectId, versionId, [...dependencyList, dependency]);
  }

  function dependencyRemove(objectId: string, versionIdRequested: string, dependencyInput: unknown): AssetObjectMeta {
    const dependency = dependencyNormalize(dependencyInput);
    const { versionId, dependencyList } = dependencyListGet(objectId, versionIdRequested);
    const dependencyListNext = dependencyList.filter((item) => !dependencyIsSame(item, dependency));
    if (dependencyListNext.length === dependencyList.length) return objectGet(objectId);
    return dependencyListSet(objectId, versionId, dependencyListNext);
  }

  // the versions of the store (deleted objects included) whose data depends
  // on the object; with a versionId, on that version: a dependency without
  // versionId means the head, so it counts when the head is that version
  function dependentListGet(objectId: string, versionIdRequested = ''): AssetDependent[] {
    if (!idMs48Is(objectId)) throw new AssetError(-1, `not an object id: ${String(objectId)}`);
    const metaTarget = objectGet(objectId);
    const versionIdWanted = versionIdRequested === '' ? '' : versionIdResolve(metaTarget, versionIdRequested);
    const result: AssetDependent[] = [];
    for (const meta of objectList()) {
      for (const version of meta.versionList) {
        for (const dependency of version.dependencyList) {
          if (dependency.type !== 'asset' || dependency.objectId !== objectId) continue;
          const versionIdDepended = dependency.versionId ?? metaTarget.versionIdHead;
          if (versionIdWanted !== '' && versionIdDepended !== versionIdWanted) continue;
          result.push({ objectId: meta.objectId, versionId: version.versionId, dependency });
        }
      }
    }
    return result;
  }

  // the source files the versions of the live objects depend on, each once;
  // a build collects them (doc_page_impl_source.md#files-in-a-build)
  function dependencySourcePathList(): string[] {
    const pathSet = new Set<string>();
    for (const meta of objectList()) {
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

  // everything a built page needs: the live objects with the data of every
  // version (text as text, other bytes base64), so pinned versions keep
  // working without a server
  function snapshotBuild(): AssetSnapshot {
    const objectById: AssetSnapshot['objectById'] = {};
    for (const meta of objectList()) {
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
      objectById[meta.objectId] = { ...meta, versionDataById };
    }
    return { objectById };
  }

  // text of a reference for build-time scans; undefined when it cannot be
  // read, or when the data is not text
  function referenceTextGet(reference: { store?: string; objectId?: string; name?: string; versionId: string }): { lang: string; text: string } | undefined {
    if (reference.store !== undefined && reference.store !== ASSET_STORE_ID_LOCAL) return undefined;
    try {
      const meta = objectFind(reference);
      const version = versionDataGetOf(meta, reference.versionId);
      if (!version.isText) return undefined;
      return { lang: meta.lang, text: version.text ?? '' };
    } catch {
      return undefined;
    }
  }

  // ---------- files ----------

  function objectMetaRead(folder: AssetFolder, dirName: string): AssetObjectMeta | undefined {
    const filePath = path.join(folder.pathAbs, dirName, ASSET_OBJECT_META_NAME);
    if (!fs.existsSync(filePath)) return undefined;
    const content = yamlParse(fs.readFileSync(filePath, 'utf-8'));
    return objectMetaNormalize(content, objectIdFromDirName(dirName), folder.path, dirName);
  }

  // the file keeps one key order whatever the order the keys were set in;
  // folder and dirName are where the object was found, not part of the
  // object; component and saveMode are written only when they were set
  function objectMetaWrite(meta: AssetObjectMeta) {
    const metaFile: Record<string, unknown> = {
      objectId: meta.objectId,
      name: meta.name,
      lang: meta.lang,
      contentType: meta.contentType,
      fileExt: meta.fileExt,
    };
    if (meta.component !== undefined) metaFile.component = meta.component;
    if (meta.saveMode !== undefined) metaFile.saveMode = meta.saveMode;
    metaFile.versionIdHead = meta.versionIdHead;
    metaFile.isDeleted = meta.isDeleted;
    metaFile.isLocked = meta.isLocked;
    metaFile.timeCreated = meta.timeCreated;
    metaFile.versionList = meta.versionList;
    metaFile.eventList = meta.eventList;
    fileWriteSafe(objectMetaPathGet(meta), yamlStringify(metaFile));
  }

  return {
    config,
    folderList,
    folderInfoList,
    folderSet,
    objectList,
    objectGet,
    objectGetByName,
    objectFind,
    versionDataGet,
    versionDataGetOf,
    objectCreate,
    objectUpdate,
    objectDelete,
    objectRestore,
    objectMetaSet,
    versionCheckout,
    versionDelete,
    versionMetadataSet,
    objectLockSet,
    versionLockSet,
    dependencyListGet,
    dependencyListSet,
    dependencyAdd,
    dependencyRemove,
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
  objectById: Record<string, AssetObjectMeta & { versionDataById: Record<string, AssetSnapshotVersion> }>;
  // the references of the documents of the build, added by the plugin
  usageDocList?: AssetUsageDoc[];
};

// ---------- helpers ----------

// the effective save mode: the written one, else in place
export function saveModeGet(meta: Pick<AssetObjectMeta, 'saveMode'>): AssetSaveMode {
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
  'dependencySet', 'versionMetadataSet',
];

// ---------- version metadata ----------

// a mapping of plain values (what yaml can hold); a copy, so the caller's
// object is not kept
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
  for (const item of listInput) {
    const dependency = dependencyNormalize(item);
    if (!result.some((kept) => dependencyIsSame(kept, dependency))) result.push(dependency);
  }
  return result;
}

export function dependencyNormalize(item: any): AssetDependency {
  if (!item || typeof item !== 'object') throw new AssetError(-1, 'a dependency must be a mapping with a type');
  if (item.type === 'source') {
    const pathText = sourcePathNormalize(item.path ?? '');
    if (!sourcePathIsRooted(pathText)) {
      throw new AssetError(-1, `a source dependency names a file by its source path (~rootId/...): ${JSON.stringify(item.path)}`);
    }
    return { type: 'source', path: pathText };
  }
  if (item.type === 'asset') {
    const objectId = String(item.objectId ?? '');
    if (!idMs48Is(objectId)) throw new AssetError(-1, `an asset dependency names an object by id: ${JSON.stringify(item.objectId)}`);
    const versionId = item.versionId === undefined || item.versionId === null || item.versionId === '' || item.versionId === 'head'
      ? undefined
      : String(item.versionId);
    return versionId === undefined ? { type: 'asset', objectId } : { type: 'asset', objectId, versionId };
  }
  throw new AssetError(-1, `unknown dependency type: ${JSON.stringify(item.type)} (source or asset)`);
}

export function dependencyIsSame(a: AssetDependency, b: AssetDependency): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'source' && b.type === 'source') return a.path === b.path;
  if (a.type === 'asset' && b.type === 'asset') return a.objectId === b.objectId && (a.versionId ?? '') === (b.versionId ?? '');
  return false;
}

// the list as a file holds it: items that are not dependencies are dropped
function dependencyListRead(listInput: unknown): AssetDependency[] {
  if (!Array.isArray(listInput)) return [];
  const result: AssetDependency[] = [];
  for (const item of listInput) {
    try {
      result.push(dependencyNormalize(item));
    } catch {
      // not a dependency
    }
  }
  return result;
}

function objectUnlockedCheck(meta: AssetObjectMeta) {
  if (meta.isLocked) throw new AssetError(-1, `object ${meta.objectId} is locked; unlock it first`);
}

//   action   what the locked version cannot be, for the message
function versionUnlockedCheck(meta: AssetObjectMeta, versionId: string, action: string) {
  if (versionMetaGet(meta, versionId).isLocked) throw new AssetError(-1, `version ${versionId} is locked and cannot be ${action}`);
}

function versionIdResolve(meta: AssetObjectMeta, versionIdRequested: string): string {
  const versionId = versionIdRequested === '' || versionIdRequested === 'head' ? meta.versionIdHead : versionIdRequested;
  versionMetaGet(meta, versionId);
  return versionId;
}

function versionMetaGet(meta: AssetObjectMeta, versionId: string): AssetVersionMeta {
  const version = meta.versionList.find((item) => item.versionId === versionId);
  if (!version) throw new AssetError(-3, `version ${versionId} not found in object ${meta.objectId}`);
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
function objectMetaNormalize(content: any, objectId: string, folder: string, dirName: string): AssetObjectMeta {
  const versionList = Array.isArray(content?.versionList) ? content.versionList : [];
  const lang = String(content?.lang ?? '');
  const timeCreated = String(content?.timeCreated ?? '');
  const eventListRaw: unknown[] = Array.isArray(content?.eventList) ? content.eventList : [];
  const eventList: AssetEvent[] = [];
  for (const item of eventListRaw) {
    const event = eventNormalize(item);
    if (event) eventList.push(event);
  }
  if (eventList.length === 0) eventList.push({ eventType: 'create', time: timeCreated });
  const meta: AssetObjectMeta = {
    objectId,
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
  };
  if (content?.saveMode === 'inPlace' || content?.saveMode === 'newVersion') meta.saveMode = content.saveMode;
  // a component entry written by hand that is not { name } is ignored on read
  try {
    const component = componentNormalize(content?.component ?? null);
    if (component) meta.component = component;
  } catch {
    // left out
  }
  return meta;
}

// the component the data of an object is for: { name } with a name, or
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

function eventNormalize(item: any): AssetEvent | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const eventType = String(item.eventType ?? '') as AssetEventType;
  if (!eventTypeList.includes(eventType)) return undefined;
  const event: AssetEvent = { eventType, time: String(item.time ?? '') };
  if (item.versionId !== undefined && item.versionId !== null && item.versionId !== '') event.versionId = String(item.versionId);
  if (item.userId !== undefined && item.userId !== null && item.userId !== '') event.userId = String(item.userId);
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
