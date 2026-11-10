import fs from 'node:fs';
import path from 'node:path';
import { readYaml } from './doc-entry.ts';
import {
  OBJECT_FRONTEND_MODE_ID_REGEX, OBJECT_FRONTEND_PARTITION_REGEX, OBJECT_FRONTEND_TYPE_ID_REGEX, OBJECT_FRONTEND_TYPE_PREFIX_RESERVED_LIST, OBJECT_FRONTEND_TYPE_ROOT,
} from '../src/lib/doc-object-frontend.js';

// The types declared in yaml (design: doc_page_impl_type.md#declaring-a-type): what doc pages,
// their frontend objects and packages add to the type registry, all in one grammar.
//
//   .doc-page/type.yaml                      a doc page: read when it exists (the convention)
//   entry "type: { file }"                   another file, relative to the entry
//   entry "type: [{ file }, { file }]"       several; "type: { typeList }" written in place
//   entry "type: false"                      the doc page declares none
//   .doc-page/object-frontend/{id}/type.yaml the types of one object, which travel with its folder
//   {package}/type.yaml                      a package: this name only
//
//   typeList:
//     - id: example.reading-list             dotted, lowercase; {prefix}.{name}, a prefix of its own
//       kind: object                         object (default) or relation
//       label: Reading list
//       description: ...
//       icon: book                           a name of the page's icon set
//       extendList: [frontend.object]        absent: frontend.object for a type with modes or
//                                            kinds of assets, else the root of its kind
//       summaryKeyList: [isDone]             what the summary of an object of it promises
//       modeList: [{ id, label, comp, ... }]       below frontend.object: the components drawing it
//       assetKindList: [{ id, label, ... }]        below frontend.object: what it accepts
//       partitionList: [{ id, label, ... }]        below frontend.object: the folders its items are split
//                                                  into, some kept out of git (doc_page_impl_obj_frontend.md#partitions)
//
// every problem is reported with the file and skips the item, never the page. the same
// declaration twice is one type (objects carry theirs); a different one is a problem, and the
// first is kept, in the order: doc pages as they are loaded, each with its objects, then packages.

export const TYPE_CONFIG_FILE_NAME = 'type.yaml';
const TOP_KEY_LIST = ['typeList'];
const TYPE_KEY_LIST = ['id', 'kind', 'label', 'description', 'icon', 'extendList', 'summaryKeyList', 'modeList', 'assetKindList', 'partitionList'];
const MODE_KEY_LIST = ['id', 'label', 'description', 'category', 'comp', 'param', 'isDefault'];
const ASSET_KIND_KEY_LIST = ['id', 'label', 'langList', 'pathPrefix', 'groupPath', 'isIncomingRefused'];
const PARTITION_KEY_LIST = ['id', 'label', 'description', 'isGitIgnored', 'isDefault', 'storagePoint'];

export type TypeSection = undefined | false | { file: string } | { typeList: unknown } | ({ file: string } | { typeList: unknown })[];

export type TypeMode = {
  id: string;
  label: string;
  description: string;
  category: string;
  comp: string;
  param: Record<string, unknown>;
  isDefault: boolean;
};

export type TypeAssetKind = {
  id: string;
  label: string;
  langList?: string[];
  pathPrefix?: string;
  // the folder under item/ a new asset of the kind goes to, unless the write names one
  groupPath?: string;
  // made by the modes of the type only: nothing comes in from elsewhere
  isIncomingRefused?: boolean;
};

// a partition: a folder of the item folder of an object, holding its items and their item list;
// isGitIgnored: kept out of git, its data the checkout's own (real data, what is tried out)
// storagePoint: the storage point the partition is bound to when it is made ('' or absent: file-tree;
// doc_page_impl_asset_storage.md#which-point-a-partition-is-bound-to)
export type TypePartition = { id: string; label: string; description: string; isGitIgnored: boolean; isDefault: boolean; storagePoint?: string };

export type TypeDeclared = {
  id: string;
  kind: 'object' | 'relation';
  label: string;
  description: string;
  icon: string;
  extendList: string[];
  summaryKeyList: string[];
  modeList?: TypeMode[];
  assetKindList?: TypeAssetKind[];
  partitionList?: TypePartition[];
  definedBy: { kind: 'docPage'; alias: string; file: string } | { kind: 'package'; name: string; file: string };
};

export type TypeProblem = { alias: string; file: string; message: string };

export type TypeDeclaredConfig = {
  typeList: TypeDeclared[];
  problemList: TypeProblem[];
  // absolute: the files that count, whether they exist or not (a change reloads the page)
  pathList: string[];
};

export type TypeDocPageInput = {
  alias: string;
  entryFile: string;
  type?: TypeSection;
  packageName?: string;
  // type.yaml of its object folders, absolute (doc-object-frontend.ts)
  typeFileOfObjectList?: string[];
};

export type TypePackageInput = { name: string; dir: string };

function mappingIs(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// the "type" of an entry as written
export function typeSectionRead(value: any, filePath: string): TypeSection {
  if (value === undefined || value === null) return undefined;
  if (value === false) return false;
  const one = (item: any) => {
    if (mappingIs(item) && typeof item.file === 'string' && item.file.trim() !== '' && Object.keys(item).length === 1) return { file: item.file.trim() };
    if (mappingIs(item) && item.typeList !== undefined && Object.keys(item).length === 1) return { typeList: item.typeList };
    throw new Error(`[doc-source] "type" of an entry is { file }, { typeList }, a list of them, or false: ${filePath}`);
  };
  return Array.isArray(value) ? value.map(one) : one(value);
}

export function typeDeclaredConfigGet(docPageList: TypeDocPageInput[], packageList: TypePackageInput[], configDir: string): TypeDeclaredConfig {
  const config: TypeDeclaredConfig = { typeList: [], problemList: [], pathList: [] };
  const textById = new Map<string, string>();
  const relative = (file: string) => path.relative(configDir, file).split(path.sep).join('/');
  const typeListTake = (value: unknown, file: string, owner: string, definedBy: any, place: string) => {
    if (value === undefined || value === null) return;
    const problem = (message: string) => config.problemList.push({ alias: owner, file: relative(file), message });
    if (!Array.isArray(value)) {
      problem(`${place}"typeList" is a list of types { id, label, extendList, modeList }`);
      return;
    }
    value.forEach((item: any, index: number) => {
      const type = typeRead(item, `${place}typeList[${index}]`, problem);
      if (!type) return;
      const text = JSON.stringify(item);
      if (textById.has(type.id)) {
        if (textById.get(type.id) !== text) problem(`${place}typeList[${index}]: the type ${type.id} is declared already, otherwise; this one is left out`);
        return;
      }
      textById.set(type.id, text);
      config.typeList.push({ ...type, definedBy: { ...definedBy, file: relative(file) } });
    });
  };
  const fileTake = (file: string, owner: string, definedBy: any, isNamed: boolean) => {
    config.pathList.push(file);
    if (!fs.existsSync(file)) {
      if (isNamed) config.problemList.push({ alias: owner, file: relative(file), message: 'the file the entry names is not found' });
      return;
    }
    let content: any;
    try {
      content = readYaml(file) ?? {};
    } catch (error: any) {
      config.problemList.push({ alias: owner, file: relative(file), message: `the file does not parse: ${String(error?.message ?? error)}` });
      return;
    }
    if (!mappingIs(content)) {
      config.problemList.push({ alias: owner, file: relative(file), message: 'the file holds a mapping { typeList }' });
      return;
    }
    for (const key of Object.keys(content)) {
      if (!TOP_KEY_LIST.includes(key)) config.problemList.push({ alias: owner, file: relative(file), message: `unknown key "${key}" at the top level (known: ${TOP_KEY_LIST.join(', ')})` });
    }
    typeListTake(content.typeList, file, owner, definedBy, '');
  };
  for (const docPage of docPageList) {
    const definedBy = { kind: 'docPage', alias: docPage.alias };
    const dirEntry = path.dirname(docPage.entryFile);
    const section = docPage.type;
    // a package treated as a doc page keeps its types at the top of its folder (below)
    if (!docPage.packageName && section !== false) {
      if (section === undefined) fileTake(path.join(dirEntry, TYPE_CONFIG_FILE_NAME), docPage.alias, definedBy, false);
      else {
        for (const item of Array.isArray(section) ? section : [section]) {
          if ('file' in item) fileTake(path.resolve(dirEntry, item.file), docPage.alias, definedBy, true);
          else typeListTake(item.typeList, docPage.entryFile, docPage.alias, definedBy, '"type" of the entry: ');
        }
      }
    }
    for (const file of docPage.typeFileOfObjectList ?? []) fileTake(file, docPage.alias, definedBy, false);
  }
  for (const item of packageList) fileTake(path.join(item.dir, TYPE_CONFIG_FILE_NAME), item.name, { kind: 'package', name: item.name }, false);
  frontendKeyListCheck(config);
  return config;
}

function typeRead(item: any, place: string, problem: (message: string) => void): Omit<TypeDeclared, 'definedBy'> | undefined {
  if (!mappingIs(item)) {
    problem(`${place}: a type is a mapping { id, label, extendList, modeList }`);
    return undefined;
  }
  for (const key of Object.keys(item)) {
    if (!TYPE_KEY_LIST.includes(key)) problem(`${place}: unknown key "${key}" (known: ${TYPE_KEY_LIST.join(', ')})`);
  }
  const id = String(item.id ?? '');
  if (!OBJECT_FRONTEND_TYPE_ID_REGEX.test(id)) {
    problem(`${place}: "id" is dotted, lowercase: {prefix}.{name} (example.reading-list)`);
    return undefined;
  }
  const prefix = id.slice(0, id.indexOf('.'));
  if (OBJECT_FRONTEND_TYPE_PREFIX_RESERVED_LIST.includes(prefix)) {
    problem(`${place}: the prefix "${prefix}" of ${id} is the page's own; choose a prefix of your own`);
    return undefined;
  }
  if (item.kind !== undefined && item.kind !== 'object' && item.kind !== 'relation') {
    problem(`${place}: "kind" is object or relation`);
    return undefined;
  }
  const kind = item.kind === 'relation' ? 'relation' : 'object';
  const isOfFrontend = item.modeList !== undefined || item.assetKindList !== undefined || item.partitionList !== undefined;
  const extendDefault = kind === 'relation' ? 'core.relation' : (isOfFrontend ? OBJECT_FRONTEND_TYPE_ROOT : 'core.object');
  return {
    id,
    kind,
    label: typeof item.label === 'string' && item.label ? item.label : id,
    description: typeof item.description === 'string' ? item.description : '',
    icon: typeof item.icon === 'string' ? item.icon : '',
    extendList: Array.isArray(item.extendList) ? item.extendList.map(String) : [extendDefault],
    summaryKeyList: Array.isArray(item.summaryKeyList) ? item.summaryKeyList.map(String) : [],
    ...(item.modeList === undefined ? {} : { modeList: modeListRead(item.modeList, `${place}.modeList`, problem) }),
    ...(item.assetKindList === undefined ? {} : { assetKindList: assetKindListRead(item.assetKindList, `${place}.assetKindList`, problem) }),
    ...(item.partitionList === undefined ? {} : { partitionList: partitionListRead(item.partitionList, `${place}.partitionList`, problem) }),
  };
}

// the partitions of a type: each a folder name of ASCII (doc_page_impl_dir.md#folder-names-of-assets)
function partitionListRead(value: unknown, place: string, problem: (message: string) => void): TypePartition[] {
  if (!Array.isArray(value)) {
    problem(`${place}: a list of partitions { id, label, description, isGitIgnored, isDefault, storagePoint }`);
    return [];
  }
  const partitionList: TypePartition[] = [];
  value.forEach((item: any, index: number) => {
    const placeOne = `${place}[${index}]`;
    if (!mappingIs(item) || typeof item.id !== 'string' || !OBJECT_FRONTEND_PARTITION_REGEX.test(item.id)) {
      problem(`${placeOne}: a partition is a mapping whose "id" is its folder: letters, digits, "_", "-" and "."`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!PARTITION_KEY_LIST.includes(key)) problem(`${placeOne}: unknown key "${key}" (known: ${PARTITION_KEY_LIST.join(', ')})`);
    }
    if (partitionList.some((one) => one.id === item.id)) {
      problem(`${placeOne}: the partition ${item.id} is declared twice; this one is left out`);
      return;
    }
    partitionList.push({
      id: item.id,
      label: typeof item.label === 'string' && item.label ? item.label : item.id,
      description: typeof item.description === 'string' ? item.description : '',
      isGitIgnored: item.isGitIgnored === true,
      isDefault: item.isDefault === true,
      ...(typeof item.storagePoint === 'string' && item.storagePoint ? { storagePoint: item.storagePoint } : {}),
    });
  });
  if (partitionList.filter((one) => one.isDefault).length > 1) problem(`${place}: one partition is the default (isDefault); the first is used`);
  return partitionList;
}

function modeListRead(value: unknown, place: string, problem: (message: string) => void): TypeMode[] {
  if (!Array.isArray(value)) {
    problem(`${place}: a list of modes { id, label, comp, param }`);
    return [];
  }
  const modeList: TypeMode[] = [];
  value.forEach((item: any, index: number) => {
    const placeOne = `${place}[${index}]`;
    if (!mappingIs(item)) {
      problem(`${placeOne}: a mode is a mapping { id, label, comp, param }`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!MODE_KEY_LIST.includes(key)) problem(`${placeOne}: unknown key "${key}" (known: ${MODE_KEY_LIST.join(', ')})`);
    }
    const id = String(item.id ?? '');
    if (!OBJECT_FRONTEND_MODE_ID_REGEX.test(id)) {
      problem(`${placeOne}: "id" is letters, digits, "_" and "-"`);
      return;
    }
    if (modeList.some((mode) => mode.id === id)) {
      problem(`${placeOne}: the mode ${id} is declared twice; this one is left out`);
      return;
    }
    if (typeof item.comp !== 'string' || item.comp.trim() === '') {
      problem(`${placeOne}: "comp" names the component that draws the mode (a tag name or an id)`);
      return;
    }
    if (item.param !== undefined && !mappingIs(item.param)) {
      problem(`${placeOne}: "param" is a mapping`);
      return;
    }
    modeList.push({
      id,
      label: typeof item.label === 'string' && item.label ? item.label : id,
      description: typeof item.description === 'string' ? item.description : '',
      category: typeof item.category === 'string' && item.category ? item.category : 'view',
      comp: item.comp.trim(),
      param: item.param ?? {},
      isDefault: item.isDefault === true,
    });
  });
  return modeList;
}

function assetKindListRead(value: unknown, place: string, problem: (message: string) => void): TypeAssetKind[] {
  if (!Array.isArray(value)) {
    problem(`${place}: a list of kinds { id, label, langList, pathPrefix, groupPath, isIncomingRefused }`);
    return [];
  }
  const kindList: TypeAssetKind[] = [];
  value.forEach((item: any, index: number) => {
    const placeOne = `${place}[${index}]`;
    if (!mappingIs(item) || typeof item.id !== 'string' || item.id === '') {
      problem(`${placeOne}: a kind is a mapping with an "id"`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!ASSET_KIND_KEY_LIST.includes(key)) problem(`${placeOne}: unknown key "${key}" (known: ${ASSET_KIND_KEY_LIST.join(', ')})`);
    }
    kindList.push({
      id: item.id,
      label: typeof item.label === 'string' && item.label ? item.label : item.id,
      ...(Array.isArray(item.langList) ? { langList: item.langList.map(String) } : {}),
      ...(typeof item.pathPrefix === 'string' ? { pathPrefix: item.pathPrefix } : {}),
      ...(typeof item.groupPath === 'string' ? { groupPath: item.groupPath } : {}),
      ...(item.isIncomingRefused === true ? { isIncomingRefused: true } : {}),
    });
  });
  return kindList;
}

// whether a declared type is frontend.object or below it
export function typeDeclaredIsFrontend(typeList: { id: string; extendList: string[] }[], typeId: string, seen = new Set<string>()): boolean {
  if (typeId === OBJECT_FRONTEND_TYPE_ROOT) return true;
  if (seen.has(typeId)) return false;
  seen.add(typeId);
  const type = typeList.find((one) => one.id === typeId);
  return Boolean(type) && type!.extendList.some((parentId) => typeDeclaredIsFrontend(typeList, parentId, seen));
}

// modes and kinds of assets mean something for a frontend object only
function frontendKeyListCheck(config: TypeDeclaredConfig) {
  for (const type of config.typeList) {
    if ((type.modeList === undefined && type.assetKindList === undefined && type.partitionList === undefined) || typeDeclaredIsFrontend(config.typeList, type.id)) continue;
    const owner = type.definedBy.kind === 'package' ? type.definedBy.name : type.definedBy.alias;
    config.problemList.push({ alias: owner, file: type.definedBy.file, message: `the type ${type.id} has modes or kinds of assets, which are for types below ${OBJECT_FRONTEND_TYPE_ROOT}; they are left out` });
    delete type.modeList;
    delete type.assetKindList;
    delete type.partitionList;
  }
}
