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
//                    partition folder) are listed, read and written. a local type has its driver
//                    here, on the development server; a remote type has its driver in the page
//                    (driverPlace: page), since a built page must reach its backend with no
//                    server between them, and the server then only keeps the bind of a partition
//
// this file holds the built-in types, the types a package declares (asset-storage-type.yaml), the
// config of the points, the partition file and the interface of a server driver; the server
// drivers are doc-asset-storage-file-tree.ts and doc-asset-storage-file-pack.ts, the page drivers
// are registered with DocAssetRemoteStore (src/store/DocAssetRemoteStore.ts).

// ---------- the storage types ----------

export const ASSET_STORAGE_TYPE_ROOT = 'storage';
export const ASSET_STORAGE_TYPE_FILE_TREE = 'file-tree';
export const ASSET_STORAGE_TYPE_FILE_PACK = 'file-pack';
export const ASSET_STORAGE_TYPE_REMOTE = 'remote';

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
    apiList: ['partitionList', 'partitionGet', 'partitionCreate', 'partitionRename', 'partitionDelete', 'partitionStorageSet', 'partitionCopy', 'partitionClaim'],
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
    apiList: ['cacheInfoGet', 'cacheRefresh', 'cacheClear'],
    isImplemented: true,
  },
  {
    id: 'auth',
    label: 'Authorization',
    description: 'who the page is to a point that asks: the state, signing in and out',
    apiList: ['authStatusGet', 'authSignIn', 'authSignOut'],
    isImplemented: true,
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

// where the driver of a type runs: on the development server (a local type: it reads and writes
// the folders), or in the page (a remote type: the browser talks to its backend)
export type AssetStorageDriverPlace = 'server' | 'page';

export type AssetStorageType = {
  id: string;
  // the type it extends ('' for the root): it promises the api sets of its ancestors too
  extends: string;
  label: string;
  description: string;
  // the api sets it adds to those of its ancestors
  apiSetList: string[];
  // the api sets a point of it promises only when its config turns them on: { id, configKey }
  apiSetOptionalList: { id: string; configKey: string }[];
  driverPlace: AssetStorageDriverPlace;
  // who defines it: the page itself, or a package (asset-storage-type.yaml at its top)
  definedBy: { kind: 'builtIn' } | { kind: 'package'; name: string; file: string };
  // of a type whose driver runs in the page: the module holding it, absolute, and its export
  pageDriver?: { entryFile: string; export: string };
  // a component of the registry drawing what is its own of a point (its account, its space), in
  // the Asset service tab
  panelComp?: string;
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
    apiSetOptionalList: [],
    driverPlace: 'server',
    definedBy: { kind: 'builtIn' },
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
    apiSetOptionalList: [],
    driverPlace: 'server',
    definedBy: { kind: 'builtIn' },
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
    apiSetOptionalList: [],
    driverPlace: 'server',
    definedBy: { kind: 'builtIn' },
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
    // the contract every remote type extends: no point is made of it, a package brings a type
    // below it with the driver of one backend (asset-storage-type.yaml)
    id: ASSET_STORAGE_TYPE_REMOTE,
    extends: ASSET_STORAGE_TYPE_ROOT,
    label: 'Remote',
    description: 'a backend or a cloud service holding the partitions, reached by the page itself and read through a cache the page keeps',
    apiSetList: ['cache', 'auth'],
    apiSetOptionalList: [{ id: 'notify', configKey: 'isNotifyEnabled' }],
    driverPlace: 'page',
    definedBy: { kind: 'builtIn' },
    isAbstract: false,
    isImplemented: false,
    place: 'remote',
    isContentSearchable: false,
    isStandaloneItemHeld: false,
    configKeyList: [
      { key: 'url', description: 'where the point is reached', valueDefault: '' },
      { key: 'cacheMode', description: 'readThrough (the cache is shown at once and checked against the point), pinned (the cache is trusted until refreshed) or none', valueDefault: 'readThrough' },
      { key: 'isRefreshedOnFocus', description: 'the point is asked again when the page gets the focus back', valueDefault: false },
      { key: 'refreshIntervalSec', description: 'the point is asked again every so many seconds while the page is open; 0: never by itself', valueDefault: 0 },
      { key: 'isNotifyEnabled', description: 'the point tells the page of a change made elsewhere (the api set notify): only where its type and its backend offer it', valueDefault: false },
    ],
  },
];

// typeList: the types of the page (the built-in ones and those of its packages); absent, the
// built-in ones
export function assetStorageTypeGet(typeId: string, typeList: AssetStorageType[] = ASSET_STORAGE_TYPE_LIST): AssetStorageType | undefined {
  return typeList.find((one) => one.id === typeId);
}

// a type and its ancestors, the nearest first
export function assetStorageTypeAncestorListGet(typeId: string, typeList: AssetStorageType[] = ASSET_STORAGE_TYPE_LIST): AssetStorageType[] {
  const result: AssetStorageType[] = [];
  for (let type = assetStorageTypeGet(typeId, typeList); type && !result.includes(type); type = assetStorageTypeGet(type.extends, typeList)) result.push(type);
  return result;
}

// whether one type is another: itself, or one extending it
export function assetStorageTypeIs(typeId: string, typeIdWanted: string, typeList: AssetStorageType[] = ASSET_STORAGE_TYPE_LIST): boolean {
  return assetStorageTypeAncestorListGet(typeId, typeList).some((one) => one.id === typeIdWanted);
}

// every api set a type promises: its ancestors' first. with the config of a point, the optional
// sets that config turns on too
export function assetStorageTypeApiSetListGet(typeId: string, typeList: AssetStorageType[] = ASSET_STORAGE_TYPE_LIST, configOfPoint?: Record<string, unknown>): string[] {
  const result: string[] = [];
  for (const type of assetStorageTypeAncestorListGet(typeId, typeList).reverse()) {
    for (const id of type.apiSetList) if (!result.includes(id)) result.push(id);
    for (const optional of type.apiSetOptionalList ?? []) {
      if (configOfPoint?.[optional.configKey] === true && !result.includes(optional.id)) result.push(optional.id);
    }
  }
  return result;
}

// every config key a type reads, its ancestors' first; a key declared again nearer replaces it
export function assetStorageTypeConfigKeyListGet(typeId: string, typeList: AssetStorageType[] = ASSET_STORAGE_TYPE_LIST): AssetStorageType['configKeyList'] {
  const result: AssetStorageType['configKeyList'] = [];
  for (const type of assetStorageTypeAncestorListGet(typeId, typeList).reverse()) {
    for (const one of type.configKeyList) {
      const index = result.findIndex((other) => other.key === one.key);
      if (index >= 0) result[index] = one;
      else result.push(one);
    }
  }
  return result;
}

// ---------- the storage types of packages ----------
//
// a package brings storage types in a file at its top, as it brings types of objects in type.yaml
// (doc_page_impl_package.md#storage-types-of-a-package). a type of a package extends remote, or a
// type below it, and names the module of its driver, which the page imports and runs:
//
//   # {package}/asset-storage-type.yaml
//   storageTypeList:
//     - id: aws-utils.remote             {packageName}.{name}: lower case letters, digits, "-"
//       extends: remote
//       label: AWS
//       description: ...
//       apiSetList: []                   the sets it adds to those of the type it extends
//       configKeyList:                   the keys of a point's config it reads, beside its ancestors'
//         - { key: space, description: ..., valueDefault: '' }
//       driver: { entry: ./storage/driver.js, export: storageDriverCreate }   relative to the file
//       panelComp: AwsStoragePointPanel  optional: a component of the registry, for the Asset service tab

export const ASSET_STORAGE_TYPE_FILE_NAME = 'asset-storage-type.yaml';

export type AssetStorageTypePackageInput = { name: string; dir: string };

export type AssetStorageTypeDeclared = {
  typeList: AssetStorageType[];
  fileList: { file: string; packageName: string; isExists: boolean; problemList: string[] }[];
  // absolute: the files to watch, whether they exist or not
  pathList: string[];
};

const TYPE_KEY_LIST = ['id', 'extends', 'label', 'description', 'apiSetList', 'configKeyList', 'driver', 'panelComp', 'isContentSearchable'];

export function assetStorageTypeDeclaredRead(packageList: AssetStorageTypePackageInput[], configDir: string): AssetStorageTypeDeclared {
  const result: AssetStorageTypeDeclared = { typeList: [], fileList: [], pathList: [] };
  const typeKnownList = () => [...ASSET_STORAGE_TYPE_LIST, ...result.typeList];
  for (const onePackage of packageList) {
    const fileAbs = path.join(onePackage.dir, ASSET_STORAGE_TYPE_FILE_NAME);
    result.pathList.push(fileAbs);
    if (!fs.existsSync(fileAbs)) continue;
    const record = { file: pathRelativeGet(fileAbs, configDir), packageName: onePackage.name, isExists: true, problemList: [] as string[] };
    result.fileList.push(record);
    let content: any;
    try {
      content = yamlParse(fs.readFileSync(fileAbs, 'utf-8')) ?? {};
    } catch (error: any) {
      record.problemList.push(`the file does not parse: ${String(error?.message ?? error)}`);
      continue;
    }
    if (!mappingIs(content) || !Array.isArray(content.storageTypeList)) {
      record.problemList.push('the file holds a mapping { storageTypeList: [{ id, extends, driver }] }');
      continue;
    }
    content.storageTypeList.forEach((item: any, index: number) => {
      const place = `storageTypeList[${index}]`;
      if (!mappingIs(item)) {
        record.problemList.push(`${place}: a storage type is a mapping { id, extends, driver }`);
        return;
      }
      for (const key of Object.keys(item)) {
        if (!TYPE_KEY_LIST.includes(key)) record.problemList.push(`${place}: unknown key "${key}" (known: ${TYPE_KEY_LIST.join(', ')})`);
      }
      const id = String(item.id ?? '');
      if (!new RegExp(`^${onePackage.name.replace(/[-]/g, '\\-')}\\.[a-z0-9][a-z0-9-]*$`).test(id)) {
        record.problemList.push(`${place}: the id of a storage type of the package ${onePackage.name} is "${onePackage.name}.{name}", in lower case letters, digits and "-" (${JSON.stringify(item.id)})`);
        return;
      }
      if (assetStorageTypeGet(id, typeKnownList())) {
        record.problemList.push(`${place}: the storage type ${id} is declared already; this one is left out`);
        return;
      }
      const typeBase = assetStorageTypeGet(String(item.extends ?? ''), typeKnownList());
      if (!typeBase || typeBase.driverPlace !== 'page') {
        record.problemList.push(`${place}: "extends" names a storage type whose driver runs in the page: ${ASSET_STORAGE_TYPE_REMOTE}, or a type below it (${JSON.stringify(item.extends)})`);
        return;
      }
      const driver = item.driver;
      if (!mappingIs(driver) || typeof driver.entry !== 'string' || !driver.entry.trim() || typeof driver.export !== 'string' || !driver.export.trim()) {
        record.problemList.push(`${place}: "driver" is { entry, export }: the module of the page driver, relative to this file, and the function it exports`);
        return;
      }
      const entryFile = path.resolve(path.dirname(fileAbs), driver.entry.trim());
      if (!fs.existsSync(entryFile)) {
        record.problemList.push(`${place}: the driver module is not found: ${driver.entry}`);
        return;
      }
      const configKeyList: AssetStorageType['configKeyList'] = [];
      for (const one of Array.isArray(item.configKeyList) ? item.configKeyList : []) {
        if (mappingIs(one) && typeof one.key === 'string' && one.key) configKeyList.push({ key: one.key, description: String(one.description ?? ''), valueDefault: one.valueDefault ?? '' });
        else record.problemList.push(`${place}: an item of "configKeyList" is { key, description, valueDefault }`);
      }
      const type: AssetStorageType = {
        id,
        extends: typeBase.id,
        label: String(item.label ?? '') || id,
        description: String(item.description ?? ''),
        apiSetList: Array.isArray(item.apiSetList) ? item.apiSetList.map(String) : [],
        apiSetOptionalList: [],
        driverPlace: 'page',
        definedBy: { kind: 'package', name: onePackage.name, file: record.file },
        pageDriver: { entryFile, export: driver.export.trim() },
        isAbstract: false,
        isImplemented: true,
        place: typeBase.place,
        isContentSearchable: item.isContentSearchable === true,
        isStandaloneItemHeld: false,
        configKeyList,
      };
      if (typeof item.panelComp === 'string' && item.panelComp.trim()) type.panelComp = item.panelComp.trim();
      result.typeList.push(type);
    });
  }
  problemListWarn(result.fileList);
  return result;
}

// the page drivers the page imports: one per declared type that names a module
export function assetStoragePageDriverListGet(typeList: AssetStorageType[]): { typeId: string; entryFile: string; export: string }[] {
  return typeList.filter((one) => one.pageDriver).map((one) => ({ typeId: one.id, entryFile: one.pageDriver!.entryFile, export: one.pageDriver!.export }));
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

export type AssetStoragePointStatus = 'ready' | 'disabled' | 'typeUnknown' | 'typeNotImplemented' | 'configInvalid';

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
  // where its driver runs: a point of the page is read and written by the page, and the
  // development server keeps only the binds of the partitions it holds
  driverPlace: AssetStorageDriverPlace;
  // the api sets it promises: those of its type, and the optional ones its config turns on
  apiSetList: string[];
};

export type AssetStorageConfig = {
  typeList: AssetStorageType[];
  apiSetList: AssetStorageApiSet[];
  pointList: AssetStoragePoint[];
  // the files read, each with what was wrong in it (scope package: a file declaring storage types)
  fileList: { file: string; scope: 'workspace' | 'docPage' | 'package'; docPageAlias: string; isExists: boolean; problemList: string[] }[];
  // absolute: the files to watch, whether they exist or not
  pathList: string[];
};

export type AssetStorageDocPageInput = { alias: string; entryFile: string; assetStorage?: undefined | false | { file: string } };

const problemWarnedSet = new Set<string>();

// the files are read for every request: a problem is said once
function problemListWarn(fileList: { file: string; problemList: string[] }[]) {
  for (const record of fileList) {
    for (const problem of record.problemList) {
      const text = `[doc-asset-storage] ${record.file}: ${problem}`;
      if (problemWarnedSet.has(text)) continue;
      problemWarnedSet.add(text);
      console.warn(text);
    }
  }
}
const POINT_KEY_LIST = ['id', 'type', 'label', 'description', 'isEnabled', 'config', 'auth'];
const POINT_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;

function pointBuiltInBuild(typeId: string): AssetStoragePoint {
  const type = assetStorageTypeGet(typeId)!;
  return {
    id: typeId, typeId, label: type.label, description: type.description, scope: 'builtIn', docPageAlias: '', file: '',
    isEnabled: true, config: {}, status: 'ready', statusMessage: '', driverPlace: 'server', apiSetList: assetStorageTypeApiSetListGet(typeId),
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
  // the storage types the packages of the page declare (assetStorageTypeDeclaredRead)
  typeDeclared?: AssetStorageTypeDeclared;
}): AssetStorageConfig {
  const pointList = assetStoragePointBuiltInListGet();
  const typeList = [...ASSET_STORAGE_TYPE_LIST, ...(input.typeDeclared?.typeList ?? [])];
  const fileList: AssetStorageConfig['fileList'] = (input.typeDeclared?.fileList ?? []).map((one) => ({
    file: one.file, scope: 'package' as const, docPageAlias: one.packageName, isExists: one.isExists, problemList: one.problemList,
  }));
  const pathList: string[] = [...(input.typeDeclared?.pathList ?? [])];
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
      const type = assetStorageTypeGet(typeId, typeList);
      const isEnabled = item.isEnabled !== false;
      const config = mappingIs(item.config) ? item.config : {};
      let status: AssetStoragePointStatus = 'ready';
      let statusMessage = '';
      if (!type || type.isAbstract) {
        status = 'typeUnknown';
        statusMessage = `no storage type ${JSON.stringify(typeId)} (types: ${typeList.filter((one) => !one.isAbstract).map((one) => one.id).join(', ')}; a type of a package needs that package imported)`;
      } else if (!type.isImplemented) {
        status = 'typeNotImplemented';
        statusMessage = `the storage type ${typeId} is a contract without a driver: a package brings a type below it for one backend`;
      } else if (!isEnabled) {
        status = 'disabled';
        statusMessage = 'disabled in its file (isEnabled: false)';
      } else if (type.place === 'remote' && (typeof config.url !== 'string' || !/^https?:\/\//.test(config.url))) {
        status = 'configInvalid';
        statusMessage = 'a remote storage point names where it is reached: config.url, an http(s) url';
      }
      // a point of a type that is a contract only is no mistake: it is listed with that state
      if (status === 'typeUnknown') record.problemList.push(`${place}: ${statusMessage}`);
      const point: AssetStoragePoint = {
        id, typeId, label: String(item.label ?? '') || id, description: String(item.description ?? ''), scope, docPageAlias, file: record.file,
        isEnabled, config, status, statusMessage,
        driverPlace: type?.driverPlace ?? 'server',
        apiSetList: type ? assetStorageTypeApiSetListGet(typeId, typeList, config) : [],
      };
      if (status === 'configInvalid') record.problemList.push(`${place}: ${statusMessage}`);
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
  problemListWarn(fileList.filter((one) => one.scope !== 'package'));
  return { typeList, apiSetList: ASSET_STORAGE_API_SET_LIST, pointList, fileList, pathList };
}

// the config of a page without any declared point
export function assetStorageConfigDefaultGet(): AssetStorageConfig {
  return { typeList: ASSET_STORAGE_TYPE_LIST, apiSetList: ASSET_STORAGE_API_SET_LIST, pointList: assetStoragePointBuiltInListGet(), fileList: [], pathList: [] };
}

// what the page receives: no absolute path (the module of a page driver is imported by the plugin
// and reaches the page with the code, not as a path)
export function assetStorageConfigForPage(config: AssetStorageConfig) {
  return {
    typeList: config.typeList.map(({ pageDriver: _pageDriver, ...type }) => type),
    apiSetList: config.apiSetList, pointList: config.pointList, fileList: config.fileList,
  };
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
  // the point is driven by the page: the development server reads and writes no item of the
  // partition, it keeps the bind (doc_page_impl_asset_storage.md#points-of-the-page)
  driverPlace?: AssetStorageDriverPlace;
  // whose partition it is, as its file says: what a point of the page is asked with
  owner?: { ref: string; typeId?: string };
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
  const owner = file.owner ? { owner: file.owner } : {};
  if (point && point.status === 'ready' && point.typeId === typeIdWritten) {
    return { partition, pointId: point.id, typeId: point.typeId, unavailableReason: '', config: point.config, driverPlace: point.driverPlace, ...owner };
  }
  // the data of a point of the page lies at its backend, which another point does not reach: only
  // a local partition is read through another point of its type
  const typeWritten = assetStorageTypeGet(typeIdWritten, config?.typeList);
  const pointList = config?.pointList ?? assetStoragePointBuiltInListGet();
  const pointClaim = typeWritten?.driverPlace === 'page'
    ? undefined
    : pointList.find((one) => one.status === 'ready' && one.typeId === typeIdWritten && (one.scope !== 'docPage' || one.docPageAlias === docPageAlias));
  if (pointClaim) {
    return { partition, pointId: file.storagePoint, typeId: typeIdWritten, unavailableReason: '', pointIdClaimed: pointClaim.id, config: pointClaim.config, driverPlace: pointClaim.driverPlace, ...owner };
  }
  const reason = !point
    ? `the storage point ${file.storagePoint} is not declared${typeWritten?.driverPlace === 'page' ? '' : `, and no point of the type ${typeIdWritten || '?'} can read its data`}`
    : `the storage point ${point.id} cannot be used: ${point.statusMessage || `it is of the type ${point.typeId}, the data was written by ${typeIdWritten}`}`;
  return { partition, pointId: file.storagePoint, typeId: typeIdWritten, unavailableReason: reason, config: {}, driverPlace: typeWritten?.driverPlace ?? point?.driverPlace ?? 'server', ...owner };
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
