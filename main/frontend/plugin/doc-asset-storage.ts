import fs from 'node:fs';
import path from 'node:path';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

// The asset storage service layer (design: doc_page_impl_asset_storage.md): where the asset store
// keeps the bytes of its items. The store is what documents and frontend objects name (store:
// local); a storage point is one place, or one way, the store keeps a part of its items.
//
//   storage type     a contract: a common set of apis (item, partition) and the sets it adds
//                    (pack, cache, notify, auth, backup); types extend one another
//   storage point    one instance of a type with its config: the two built-in ones (file-tree,
//                    file-pack) and those a workspace or a doc page declares in asset-storage.yaml
//   partition        what a storage point holds for a frontend object: "the partition real of
//                    the object frontend:{id} of the type {typeId}", with its items. a partition
//                    is bound to one point, in the partition.yaml of its folder
//   driver           the code of a type: how the items of one container (a store folder, a
//                    partition folder) are listed, read and written
//
// this file holds the types, the config of the points, the partition file and the driver
// interface; the drivers are doc-asset-storage-file-tree.ts and doc-asset-storage-file-pack.ts.

// ---------- the storage types ----------

export const ASSET_STORAGE_TYPE_ROOT = 'storage';
export const ASSET_STORAGE_TYPE_FILE_TREE = 'file-tree';
export const ASSET_STORAGE_TYPE_FILE_PACK = 'file-pack';
export const ASSET_STORAGE_TYPE_REMOTE = 'remote';
export const ASSET_STORAGE_TYPE_REMOTE_NOTIFY = 'remote-notify';

// the built-in point of a type carries the id of its type
export const ASSET_STORAGE_POINT_FILE_TREE = ASSET_STORAGE_TYPE_FILE_TREE;
export const ASSET_STORAGE_POINT_FILE_PACK = ASSET_STORAGE_TYPE_FILE_PACK;

// a set of apis a type promises; isImplemented: the page has it today
export type AssetStorageApiSet = { id: string; label: string; description: string; apiList: string[]; isImplemented: boolean };

export const ASSET_STORAGE_API_SET_LIST: AssetStorageApiSet[] = [
  {
    id: 'item',
    label: 'Items',
    description: 'single data items with their versions: the api of the asset store, the same whatever point holds an item',
    apiList: ['itemList', 'itemGet', 'versionDataGet', 'itemCreate', 'itemUpdate', 'itemMetaSet', 'itemMove', 'itemDelete', 'itemRestore', 'versionCheckout', 'versionDelete', 'itemLockSet', 'versionLockSet'],
    isImplemented: true,
  },
  {
    id: 'partition',
    label: 'Partitions',
    description: 'the partitions of frontend objects a point holds, each named by its object, the type of that object and its own name',
    apiList: ['partitionList', 'partitionGet', 'partitionCreate', 'partitionRename', 'partitionDelete', 'partitionStorageSet', 'partitionClaim'],
    isImplemented: true,
  },
  {
    id: 'pack',
    label: 'Pack files',
    description: 'the merged files of a partition: their sizes, how much of them is dead, and compaction',
    apiList: ['packInfoGet', 'packCompact'],
    isImplemented: true,
  },
  {
    id: 'cache',
    label: 'Cache',
    description: 'the local copies of what a remote point holds: what is cached, how old, read again, dropped',
    apiList: ['cacheInfoGet', 'cacheRefresh', 'cacheClear', 'cachePolicySet'],
    isImplemented: false,
  },
  {
    id: 'auth',
    label: 'Authorization',
    description: 'who the page is to a point that asks: the state, signing in and out',
    apiList: ['authStatusGet', 'authSignIn', 'authSignOut'],
    isImplemented: false,
  },
  {
    id: 'notify',
    label: 'Change notification',
    description: 'a point that tells the page of a change made elsewhere, instead of being asked',
    apiList: ['notifySubscribe', 'notifyUnsubscribe', 'notifyStatusGet'],
    isImplemented: false,
  },
  {
    id: 'backup',
    label: 'Backups',
    description: 'copies of whole partitions, of this point or of another one, kept and brought back',
    apiList: ['backupCreate', 'backupList', 'backupRestore', 'backupDelete'],
    isImplemented: false,
  },
];

export type AssetStorageType = {
  id: string;
  // the type it extends ('' for the root): it promises the api sets of its ancestors too
  extends: string;
  label: string;
  description: string;
  // the api sets it adds to those of its ancestors
  apiSetList: string[];
  // a contract no point can be made of (the root)
  isAbstract: boolean;
  // the page has a driver for it; false: a contract designed for a later implementation
  isImplemented: boolean;
  // where the bytes are: in the folders of the doc page, or behind a network
  place: 'local' | 'remote';
  // the content of the items can be read, searched and compared as plain files on disk
  isContentSearchable: boolean;
  // it may hold items that belong to no partition (the items of a doc page's asset folders)
  isStandaloneItemHeld: boolean;
  // the keys of a point's config it reads, with their defaults
  configKeyList: { key: string; description: string; valueDefault: unknown }[];
};

export const ASSET_STORAGE_PACK_SIZE_MAX_DEFAULT = 32 * 1024 * 1024;

export const ASSET_STORAGE_TYPE_LIST: AssetStorageType[] = [
  {
    id: ASSET_STORAGE_TYPE_ROOT,
    extends: '',
    label: 'Storage',
    description: 'what every storage type promises: items with versions, and partitions of frontend objects',
    apiSetList: ['item', 'partition'],
    isAbstract: true,
    isImplemented: true,
    place: 'local',
    isContentSearchable: false,
    isStandaloneItemHeld: false,
    configKeyList: [],
  },
  {
    id: ASSET_STORAGE_TYPE_FILE_TREE,
    extends: ASSET_STORAGE_TYPE_ROOT,
    label: 'File tree',
    description: 'one folder per item, one file per version: everything readable, searchable and compared by git as plain files',
    apiSetList: [],
    isAbstract: false,
    isImplemented: true,
    place: 'local',
    isContentSearchable: true,
    isStandaloneItemHeld: true,
    configKeyList: [],
  },
  {
    id: ASSET_STORAGE_TYPE_FILE_PACK,
    extends: ASSET_STORAGE_TYPE_ROOT,
    label: 'File pack',
    description: 'the items of a partition merged into a few pack files: nothing of their content is found by a search of the disk or indexed by an editor',
    apiSetList: ['pack'],
    isAbstract: false,
    isImplemented: true,
    place: 'local',
    isContentSearchable: false,
    isStandaloneItemHeld: false,
    configKeyList: [
      { key: 'packSizeMax', description: 'the size in bytes a pack file grows to before the next one is started', valueDefault: ASSET_STORAGE_PACK_SIZE_MAX_DEFAULT },
      { key: 'isCompressed', description: 'the bytes of a version are deflated', valueDefault: true },
    ],
  },
  {
    id: ASSET_STORAGE_TYPE_REMOTE,
    extends: ASSET_STORAGE_TYPE_ROOT,
    label: 'Remote',
    description: 'a backend or a cloud service holding the partitions, read through a local cache',
    apiSetList: ['cache', 'auth'],
    isAbstract: false,
    isImplemented: false,
    place: 'remote',
    isContentSearchable: false,
    isStandaloneItemHeld: false,
    configKeyList: [
      { key: 'url', description: 'where the point is reached', valueDefault: '' },
      { key: 'cacheMode', description: 'readThrough (cached on first read), pinned (kept until refreshed) or none', valueDefault: 'readThrough' },
    ],
  },
  {
    id: ASSET_STORAGE_TYPE_REMOTE_NOTIFY,
    extends: ASSET_STORAGE_TYPE_REMOTE,
    label: 'Remote with notification',
    description: 'a remote point that tells the page when an item or a partition changed elsewhere',
    apiSetList: ['notify'],
    isAbstract: false,
    isImplemented: false,
    place: 'remote',
    isContentSearchable: false,
    isStandaloneItemHeld: false,
    configKeyList: [
      { key: 'notifyChannel', description: 'how changes arrive: webSocket, serverSentEvent or poll', valueDefault: 'webSocket' },
    ],
  },
];

export function assetStorageTypeGet(typeId: string): AssetStorageType | undefined {
  return ASSET_STORAGE_TYPE_LIST.find((one) => one.id === typeId);
}

// a type and its ancestors, the nearest first
export function assetStorageTypeAncestorListGet(typeId: string): AssetStorageType[] {
  const result: AssetStorageType[] = [];
  for (let type = assetStorageTypeGet(typeId); type && !result.includes(type); type = assetStorageTypeGet(type.extends)) result.push(type);
  return result;
}

// whether one type is another: itself, or one extending it
export function assetStorageTypeIs(typeId: string, typeIdWanted: string): boolean {
  return assetStorageTypeAncestorListGet(typeId).some((one) => one.id === typeIdWanted);
}

// every api set a type promises: its ancestors' first
export function assetStorageTypeApiSetListGet(typeId: string): string[] {
  const result: string[] = [];
  for (const type of assetStorageTypeAncestorListGet(typeId).reverse()) {
    for (const id of type.apiSetList) if (!result.includes(id)) result.push(id);
  }
  return result;
}

// ---------- the storage points ----------
//
// the built-in points need no file. a workspace and a doc page declare more in a file found by
// convention (doc_page_impl_asset_storage.md#declaring-storage-points):
//
//   .doc-workspace/asset-storage.yaml    the points every doc page of the workspace may use
//   .doc-page/asset-storage.yaml         the points of one doc page, for its own objects
//   "assetStorage: { file }"             of the workspace file or of an entry: another file;
//   "assetStorage: false"                none
//
//   storagePointList:
//     - id: pack-small                   unique in the workspace; file-tree and file-pack are taken
//       type: file-pack                  a storage type
//       label: Small packs
//       isEnabled: true                  false: declared, used by nothing
//       config: { packSizeMax: 4194304 } the keys of its type
//       auth: { kind: token }            for a type with the api set auth

export const ASSET_STORAGE_CONFIG_FILE_NAME = 'asset-storage.yaml';

export type AssetStoragePointStatus = 'ready' | 'disabled' | 'typeUnknown' | 'typeNotImplemented';

export type AssetStoragePoint = {
  id: string;
  typeId: string;
  label: string;
  description: string;
  // who declares it; a point of a doc page is seen by the objects of that doc page only
  scope: 'builtIn' | 'workspace' | 'docPage';
  docPageAlias: string;
  // the file declaring it, relative to the config directory ('' for a built-in point)
  file: string;
  isEnabled: boolean;
  config: Record<string, unknown>;
  auth?: Record<string, unknown>;
  status: AssetStoragePointStatus;
  statusMessage: string;
};

export type AssetStorageConfig = {
  typeList: AssetStorageType[];
  apiSetList: AssetStorageApiSet[];
  pointList: AssetStoragePoint[];
  // the files read, each with what was wrong in it
  fileList: { file: string; scope: 'workspace' | 'docPage'; docPageAlias: string; isExists: boolean; problemList: string[] }[];
  // absolute: the files to watch, whether they exist or not
  pathList: string[];
};

export type AssetStorageDocPageInput = { alias: string; entryFile: string; assetStorage?: undefined | false | { file: string } };

const problemWarnedSet = new Set<string>();
const POINT_KEY_LIST = ['id', 'type', 'label', 'description', 'isEnabled', 'config', 'auth'];
const POINT_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;

function pointBuiltInBuild(typeId: string): AssetStoragePoint {
  const type = assetStorageTypeGet(typeId)!;
  return {
    id: typeId, typeId, label: type.label, description: type.description, scope: 'builtIn', docPageAlias: '', file: '',
    isEnabled: true, config: {}, status: 'ready', statusMessage: '',
  };
}

export function assetStoragePointBuiltInListGet(): AssetStoragePoint[] {
  return [pointBuiltInBuild(ASSET_STORAGE_TYPE_FILE_TREE), pointBuiltInBuild(ASSET_STORAGE_TYPE_FILE_PACK)];
}

// the points of the page: the built-in ones, the workspace's, then those of each doc page. an id
// declared twice keeps its first declaration
export function assetStorageConfigRead(input: {
  docPageInputList: AssetStorageDocPageInput[];
  // the workspace file's own asset-storage file, absolute; undefined: the workspace has none
  workspaceFile?: string;
  configDir: string;
}): AssetStorageConfig {
  const pointList = assetStoragePointBuiltInListGet();
  const fileList: AssetStorageConfig['fileList'] = [];
  const pathList: string[] = [];
  const fileRead = (fileAbs: string, scope: 'workspace' | 'docPage', docPageAlias: string) => {
    pathList.push(fileAbs);
    const record = { file: pathRelativeGet(fileAbs, input.configDir), scope, docPageAlias, isExists: fs.existsSync(fileAbs), problemList: [] as string[] };
    fileList.push(record);
    if (!record.isExists) return;
    let content: any;
    try {
      content = yamlParse(fs.readFileSync(fileAbs, 'utf-8')) ?? {};
    } catch (error: any) {
      record.problemList.push(`the file does not parse: ${String(error?.message ?? error)}`);
      return;
    }
    if (!mappingIs(content) || (content.storagePointList !== undefined && !Array.isArray(content.storagePointList))) {
      record.problemList.push('the file holds a mapping { storagePointList: [{ id, type, ... }] }');
      return;
    }
    for (const key of Object.keys(content)) {
      if (key !== 'storagePointList') record.problemList.push(`unknown key "${key}" at the top level (known: storagePointList)`);
    }
    (content.storagePointList ?? []).forEach((item: any, index: number) => {
      const place = `storagePointList[${index}]`;
      if (!mappingIs(item)) {
        record.problemList.push(`${place}: a storage point is a mapping { id, type }`);
        return;
      }
      for (const key of Object.keys(item)) {
        if (!POINT_KEY_LIST.includes(key)) record.problemList.push(`${place}: unknown key "${key}" (known: ${POINT_KEY_LIST.join(', ')})`);
      }
      const id = String(item.id ?? '');
      if (!POINT_ID_REGEX.test(id)) {
        record.problemList.push(`${place}: "id" is lower case letters, digits, ".", "_" and "-"`);
        return;
      }
      const pointSame = pointList.find((one) => one.id === id);
      if (pointSame) {
        record.problemList.push(`${place}: the storage point ${id} is declared already (${pointSame.scope === 'builtIn' ? 'built in' : pointSame.file}); this one is left out`);
        return;
      }
      const typeId = String(item.type ?? '');
      const type = assetStorageTypeGet(typeId);
      const isEnabled = item.isEnabled !== false;
      let status: AssetStoragePointStatus = 'ready';
      let statusMessage = '';
      if (!type || type.isAbstract) {
        status = 'typeUnknown';
        statusMessage = `no storage type ${JSON.stringify(typeId)} (types: ${ASSET_STORAGE_TYPE_LIST.filter((one) => !one.isAbstract).map((one) => one.id).join(', ')})`;
      } else if (!type.isImplemented) {
        status = 'typeNotImplemented';
        statusMessage = `the storage type ${typeId} is a contract the page does not implement yet`;
      } else if (!isEnabled) {
        status = 'disabled';
        statusMessage = 'disabled in its file (isEnabled: false)';
      }
      // a point of a type that is a contract only is no mistake: it is listed with that state
      if (status === 'typeUnknown') record.problemList.push(`${place}: ${statusMessage}`);
      const point: AssetStoragePoint = {
        id, typeId, label: String(item.label ?? '') || id, description: String(item.description ?? ''), scope, docPageAlias, file: record.file,
        isEnabled, config: mappingIs(item.config) ? item.config : {}, status, statusMessage,
      };
      if (mappingIs(item.auth)) point.auth = item.auth;
      pointList.push(point);
    });
  };
  if (input.workspaceFile) fileRead(input.workspaceFile, 'workspace', '');
  for (const docPage of input.docPageInputList) {
    if (docPage.assetStorage === false) continue;
    const dirEntry = path.dirname(docPage.entryFile);
    fileRead(docPage.assetStorage ? path.resolve(dirEntry, docPage.assetStorage.file) : path.join(dirEntry, ASSET_STORAGE_CONFIG_FILE_NAME), 'docPage', docPage.alias);
  }
  // the files are read for every request: a problem is said once
  for (const record of fileList) {
    for (const problem of record.problemList) {
      const text = `[doc-asset-storage] ${record.file}: ${problem}`;
      if (problemWarnedSet.has(text)) continue;
      problemWarnedSet.add(text);
      console.warn(text);
    }
  }
  return { typeList: ASSET_STORAGE_TYPE_LIST, apiSetList: ASSET_STORAGE_API_SET_LIST, pointList, fileList, pathList };
}

// the config of a page without any declared point
export function assetStorageConfigDefaultGet(): AssetStorageConfig {
  return { typeList: ASSET_STORAGE_TYPE_LIST, apiSetList: ASSET_STORAGE_API_SET_LIST, pointList: assetStoragePointBuiltInListGet(), fileList: [], pathList: [] };
}

// what the page receives: no absolute path
export function assetStorageConfigForPage(config: AssetStorageConfig) {
  return { typeList: config.typeList, apiSetList: config.apiSetList, pointList: config.pointList, fileList: config.fileList };
}

// the point an object of a doc page means by an id: a built-in one, the workspace's, or its own
// doc page's
export function assetStoragePointFind(config: AssetStorageConfig | undefined, pointId: string, docPageAlias: string): AssetStoragePoint | undefined {
  const pointList = config?.pointList ?? assetStoragePointBuiltInListGet();
  return pointList.find((one) => one.id === pointId && (one.scope !== 'docPage' || one.docPageAlias === docPageAlias));
}

// ---------- the partition file ----------
//
// what a partition says of itself, in its folder (item/{partition}/partition.yaml): who it belongs
// to, and which storage point holds its items. a partition without the file is held by file-tree,
// which is every partition made before the file existed.
//
//   storagePoint: file-pack            the point holding its items
//   storageType: file-pack             the type its data was written by: what reads it when the
//                                      point is gone or was declared again as another type
//   owner: { ref: frontend:{id}, typeId: cv.profile }
//   partition: real

export const ASSET_STORAGE_PARTITION_FILE_NAME = 'partition.yaml';

export type AssetStoragePartitionFile = { storagePoint: string; storageType: string; owner?: { ref: string; typeId?: string }; partition?: string };

// undefined: no file, or one that says nothing usable
export function assetStoragePartitionFileRead(partitionDirAbs: string): AssetStoragePartitionFile | undefined {
  const file = path.join(partitionDirAbs, ASSET_STORAGE_PARTITION_FILE_NAME);
  if (!fs.existsSync(file)) return undefined;
  let content: any;
  try {
    content = yamlParse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return undefined;
  }
  if (!mappingIs(content) || typeof content.storagePoint !== 'string' || content.storagePoint === '') return undefined;
  const result: AssetStoragePartitionFile = { storagePoint: content.storagePoint, storageType: String(content.storageType ?? '') };
  if (mappingIs(content.owner) && typeof content.owner.ref === 'string') {
    result.owner = { ref: content.owner.ref };
    if (typeof content.owner.typeId === 'string' && content.owner.typeId) result.owner.typeId = content.owner.typeId;
  }
  if (typeof content.partition === 'string') result.partition = content.partition;
  return result;
}

export function assetStoragePartitionFileWrite(partitionDirAbs: string, content: AssetStoragePartitionFile) {
  fs.mkdirSync(partitionDirAbs, { recursive: true });
  const file = path.join(partitionDirAbs, ASSET_STORAGE_PARTITION_FILE_NAME);
  const text = [
    '# which storage point holds the items of this partition, and whose partition it is',
    '# (doc_page_impl_asset_storage.md#the-partition-file). written by the page.',
    yamlStringify(content),
  ].join('\n');
  const fileTmp = `${file}.tmp`;
  fs.writeFileSync(fileTmp, text, 'utf-8');
  fs.renameSync(fileTmp, file);
}

export function assetStoragePartitionFileRemove(partitionDirAbs: string) {
  fs.rmSync(path.join(partitionDirAbs, ASSET_STORAGE_PARTITION_FILE_NAME), { force: true });
}

// a partition of a store folder as the store knows it: which point holds it, and whether that
// point can be used now
export type AssetStoragePartitionBind = {
  partition: string;
  pointId: string;
  typeId: string;
  // the point named is not usable: its reason ('' when it is). the items of such a partition are
  // not read, and nothing is written into it
  unavailableReason: string;
  // the point named is gone or of another type, and the data is read by the type it was written
  // by, through this point (doc_page_impl_asset_storage.md#claiming-a-partition-back)
  pointIdClaimed?: string;
  config: Record<string, unknown>;
};

// the bind of a partition from its file and the points: the point it names when that is ready and
// of the type the data was written by; else the first ready point of that type the doc page sees
// (the partition is claimed back through it); else unavailable
export function assetStoragePartitionBindResolve(
  partition: string,
  file: AssetStoragePartitionFile,
  config: AssetStorageConfig | undefined,
  docPageAlias: string,
): AssetStoragePartitionBind {
  const point = assetStoragePointFind(config, file.storagePoint, docPageAlias);
  const typeIdWritten = file.storageType || point?.typeId || '';
  if (point && point.status === 'ready' && point.typeId === typeIdWritten) {
    return { partition, pointId: point.id, typeId: point.typeId, unavailableReason: '', config: point.config };
  }
  const pointList = config?.pointList ?? assetStoragePointBuiltInListGet();
  const pointClaim = pointList.find((one) => one.status === 'ready' && one.typeId === typeIdWritten && (one.scope !== 'docPage' || one.docPageAlias === docPageAlias));
  if (pointClaim) {
    return { partition, pointId: file.storagePoint, typeId: typeIdWritten, unavailableReason: '', pointIdClaimed: pointClaim.id, config: pointClaim.config };
  }
  const reason = !point
    ? `the storage point ${file.storagePoint} is not declared, and no point of the type ${typeIdWritten || '?'} can read its data`
    : `the storage point ${point.id} cannot be used: ${point.statusMessage || `it is of the type ${point.typeId}, the data was written by ${typeIdWritten}`}`;
  return { partition, pointId: file.storagePoint, typeId: typeIdWritten, unavailableReason: reason, config: {} };
}

// the partitions of an item folder that say where they are stored: the folders at its top holding
// a partition.yaml
export function assetStoragePartitionBindListRead(itemDirAbs: string, config: AssetStorageConfig | undefined, docPageAlias: string): AssetStoragePartitionBind[] {
  if (!fs.existsSync(itemDirAbs)) return [];
  const result: AssetStoragePartitionBind[] = [];
  for (const one of fs.readdirSync(itemDirAbs, { withFileTypes: true })) {
    if (!one.isDirectory() || one.name.startsWith('.')) continue;
    const file = assetStoragePartitionFileRead(path.join(itemDirAbs, one.name));
    if (file) result.push(assetStoragePartitionBindResolve(one.name, file, config, docPageAlias));
  }
  return result.sort((a, b) => a.partition.localeCompare(b.partition));
}

// ---------- the driver of a type ----------
//
// a container is a folder holding items by one type: a store folder (file-tree), or the folder of
// a partition. inside it an item has a place, dirName: its group folders and its own folder name
// ("book/{itemId}--{name}"). for file-tree the place is a real folder; for a type without
// folders it is kept with the item, so the store names items the same way everywhere.

export type AssetStoragePlace = { dirName: string; itemId: string; groupPath: string };

export type AssetStorageInfo = {
  itemCount: number;
  // the bytes on disk
  size: number;
  // of them, what no item reads any more (kept until a compaction); 0 for a type without any
  sizeDead: number;
  fileList: { name: string; size: number }[];
};

export type AssetStorageDriver = {
  typeId: string;
  // the container holds data of this type
  isDataFound(dirAbs: string): boolean;
  // the items of the container, a folder before the folders inside it, in name order; the
  // folders at its top named in groupSkipList are another container's and are not entered
  itemPlaceList(dirAbs: string, options?: { groupSkipList?: string[] }): AssetStoragePlace[];
  // the mapping of an item (what item.yaml holds); undefined when the item is not there
  itemMetaRead(dirAbs: string, dirName: string): unknown | undefined;
  itemMetaWrite(dirAbs: string, dirName: string, content: Record<string, unknown>): void;
  versionRead(dirAbs: string, dirName: string, versionId: string, fileExt: string): Buffer | undefined;
  versionWrite(dirAbs: string, dirName: string, versionId: string, fileExt: string, data: Buffer): void;
  versionMetadataRead(dirAbs: string, dirName: string, versionId: string): Record<string, unknown>;
  // an empty mapping removes it
  versionMetadataWrite(dirAbs: string, dirName: string, versionId: string, metadata: Record<string, unknown>): void;
  versionRemove(dirAbs: string, dirName: string, versionId: string, fileExt: string): void;
  // the place of an item changed inside the container (a rename, another group)
  itemPlaceSet(dirAbs: string, dirNameFrom: string, dirNameTo: string): void;
  // an item removed with everything of it: only after it was copied elsewhere
  itemRemove(dirAbs: string, dirName: string): void;
  groupMove(dirAbs: string, groupPathFrom: string, groupPathTo: string): void;
  // a group left empty goes away, with the groups above it that become empty
  groupEmptyRemove(dirAbs: string, groupPath: string): void;
  infoGet(dirAbs: string): AssetStorageInfo;
  // the ids of the items changed in the container since this was last asked: for a type whose
  // files do not say which item a change is about
  changeItemIdListGet?(dirAbs: string): string[];
  // what the type keeps dead is dropped
  compact?(dirAbs: string): AssetStorageInfo;
};

function pathRelativeGet(filePath: string, configDir: string): string {
  return path.relative(configDir, filePath).split(path.sep).join('/');
}

function mappingIs(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
