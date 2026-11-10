import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import {
  ASSET_PATH_SEGMENT_LENGTH_MAX, assetPathCompile, assetPathIndexBuild, assetPathIndexComplete, assetPathIndexGet, assetPathIndexNodeGet,
  assetPathListSplit, assetPathNormalize,
} from './doc-object-frontend-asset-path.js';

// The frontend object service layer, its pure part (design:
// doc_page_impl_obj_frontend.md), shared by the development server
// (plugin/doc-object-frontend.ts) and the page (DocObjectFrontendStore):
//
//   a frontend object    an object of the object registry whose data the page
//                        keeps itself, in assets of the asset store: one entry
//                        asset that describes it, and any number of assets of
//                        its own. its reference is frontend:{id}
//   the entry asset      yaml: { name, type, description, metadata }
//                          metadata  a free mapping, the type's own
//   the item lists       item-list.yaml in the item folder of the object or in a folder inside
//                        it: { assetList }, the assets lying there and below, each a record
//                          { key, kind, itemId, name?, pathList? }  by a key unique in the object;
//                          kind groups them ("book"); a name for people, and paths
//                          (/book/sci-fi/dune) indexing them, each unique in the object
//                        an object without a folder of its own lists them in its entry
//                        (assetList), as every object did before item lists
//   an asset of it       declares it in its own metadata (item.yaml):
//                          owner: { ref: frontend:{id}, role: entry }   the entry
//                          owner: { ref: frontend:{id} }                any other
//   a type               frontend.object or a type a doc page declares
//                        (type.yaml, doc_page_impl_type.md), extending it; its modes are
//                        the ways it is drawn: { id, label, comp, param, category }
//   a mode               a component and the parameters it starts with; a
//                        type has its own modes and those of its ancestors
//                        (the nearest declaration of an id wins)
//   the entry component  ObjectFrontend, a block naming the object, the mode
//                        and the parameters: { object, mode, param }

export const OBJECT_FRONTEND_NAMESPACE = 'frontend';
export const OBJECT_FRONTEND_TYPE_ROOT = 'frontend.object';
export const OBJECT_FRONTEND_ROLE_ENTRY = 'entry';
export const OBJECT_FRONTEND_COMP_NAME = 'ObjectFrontend';
export const OBJECT_FRONTEND_CONFIG_FILE_NAME = 'object-frontend.yaml';
// the folder of the doc page holding its object folders, and inside an object folder
// {id}--{name}: the file that makes it an object, the folder of its asset items
export const OBJECT_FRONTEND_FOLDER_NAME = 'object-frontend';
export const OBJECT_FRONTEND_META_NAME = 'object.yaml';
export const OBJECT_FRONTEND_ITEM_FOLDER_NAME = 'item';
// the list of the assets lying in a folder of an object's item folder and below it, down to
// the folders holding a list of their own (doc_page_impl_obj_frontend.md#the-item-lists)
export const OBJECT_FRONTEND_LIST_NAME = 'item-list.yaml';
// the placement a mode's component is rendered in
export const OBJECT_FRONTEND_PLACEMENT = 'objectFrontend';

export const OBJECT_FRONTEND_KEY_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const OBJECT_FRONTEND_MODE_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
// a partition is a folder of the item folder: an ASCII name (doc_page_impl_obj_frontend.md#partitions)
export const OBJECT_FRONTEND_PARTITION_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const OBJECT_FRONTEND_TYPE_ID_REGEX = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
// the first part of a type id names who defines it; these are the page's own
export const OBJECT_FRONTEND_TYPE_PREFIX_RESERVED_LIST = ['core', 'doc', 'docPage', 'docDir', 'asset', 'service', 'serviceTemplate', 'serviceConfig', 'frontend'];

// the modes every frontend object has, declared on frontend.object: a
// doc page's type adds its own, and may declare one of these ids again
export const OBJECT_FRONTEND_MODE_BUILTIN_LIST = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'what the object is: its name, type, assets, metadata and modes',
    category: 'view',
    comp: 'common/ObjectFrontendOverview',
    param: {},
    isDefault: false,
  },
];

// ---------- references ----------

export function objectFrontendRefBuild(id) {
  return `${OBJECT_FRONTEND_NAMESPACE}:${id}`;
}

// the id of a frontend object named by its reference, or by its bare id; '' otherwise
export function objectFrontendIdOfRefGet(ref) {
  const text = String(ref ?? '').trim();
  const prefix = `${OBJECT_FRONTEND_NAMESPACE}:`;
  const id = text.startsWith(prefix) ? text.slice(prefix.length) : text;
  return /^[0-9a-z]+$/.test(id) ? id : '';
}

// ---------- the entry asset ----------

// { entry, problemList }: what the text of an entry asset says, every key
// read as far as it can be; a key that cannot be read is a problem
export function objectFrontendEntryParse(text) {
  const problemList = [];
  const entry = { name: '', type: OBJECT_FRONTEND_TYPE_ROOT, description: '', assetList: [], metadata: {} };
  let content;
  try {
    content = yamlParse(String(text ?? '')) ?? {};
  } catch (error) {
    return { entry, problemList: [`the entry asset does not parse: ${String(error?.message ?? error)}`] };
  }
  if (!mappingIs(content)) return { entry, problemList: ['the entry asset holds no mapping'] };
  entry.name = typeof content.name === 'string' ? content.name : '';
  if (typeof content.type === 'string' && content.type.trim()) entry.type = content.type.trim();
  else problemList.push(`the entry names no type; it is a ${OBJECT_FRONTEND_TYPE_ROOT}`);
  entry.description = typeof content.description === 'string' ? content.description : '';
  if (content.metadata !== undefined && !mappingIs(content.metadata)) problemList.push('metadata is not a mapping');
  else entry.metadata = content.metadata ?? {};
  entry.assetList = assetRecordListRead(content.assetList, 'assetList', problemList);
  return { entry, problemList };
}

// the records { key, kind, itemId, name?, pathList? } of a list, every one read as far as it
// can be; place: what a problem says the list is ("assetList", "history/item-list.yaml")
function assetRecordListRead(value, place, problemList) {
  const recordList = [];
  if (value === undefined || value === null) return recordList;
  if (!Array.isArray(value)) {
    problemList.push(`${place} is not a list`);
    return recordList;
  }
  const keySet = new Set();
  value.forEach((item, index) => {
    if (!mappingIs(item) || typeof item.itemId !== 'string' || !item.itemId) {
      problemList.push(`${place}[${index}] is not { key, kind, itemId }`);
      return;
    }
    const key = typeof item.key === 'string' && item.key ? item.key : item.itemId;
    if (keySet.has(key)) {
      problemList.push(`${place}[${index}]: the key ${key} is used twice; this one is left out`);
      return;
    }
    keySet.add(key);
    const asset = { key, kind: typeof item.kind === 'string' ? item.kind : '', itemId: item.itemId };
    if (typeof item.name === 'string' && item.name !== '') asset.name = item.name;
    const pathList = [];
    for (const pathText of Array.isArray(item.pathList) ? item.pathList : []) {
      const { path, message } = objectFrontendAssetPathNormalize(pathText);
      if (message) problemList.push(`${place}[${index}] (${key}): the path ${JSON.stringify(pathText)} is left out: ${message}`);
      else if (!pathList.includes(path)) pathList.push(path);
    }
    if (item.pathList !== undefined && !Array.isArray(item.pathList)) problemList.push(`${place}[${index}] (${key}): pathList is a list of paths`);
    if (pathList.length > 0) asset.pathList = pathList;
    recordList.push(asset);
  });
  return recordList;
}

// a record as it is written: the keys in one order, a name and paths only when there are some
function assetRecordBuild(item) {
  return {
    key: item.key,
    kind: item.kind ?? '',
    itemId: item.itemId,
    ...(item.name ? { name: item.name } : {}),
    ...(Array.isArray(item.pathList) && item.pathList.length > 0 ? { pathList: item.pathList } : {}),
  };
}

// the text of an entry asset. the entry is data the layer keeps (like the
// workbook of a sheet), written whole; the keys in one order
export function objectFrontendEntryTextBuild(entry) {
  const content = {
    name: String(entry.name ?? ''),
    type: String(entry.type || OBJECT_FRONTEND_TYPE_ROOT),
    description: String(entry.description ?? ''),
    // the list of an object without a folder of its own; one with a folder keeps item lists
    ...((entry.assetList ?? []).length > 0 ? { assetList: entry.assetList.map(assetRecordBuild) } : {}),
    metadata: mappingIs(entry.metadata) ? entry.metadata : {},
  };
  return yamlStringify(content);
}

// ---------- the item lists ----------
// an object with a folder of its own lists its assets in item-list.yaml files inside its item
// folder: each lists the assets lying in its folder and below. so a folder kept out of git
// takes its items and their records along, and what is left is an object without them
// (doc_page_impl_obj_frontend.md#the-item-lists)

// { assetList, problemList } of the text of an item list; groupPath: where it lies ('' the top)
export function objectFrontendListParse(text, groupPath = '') {
  const place = groupPath ? `${groupPath}/${OBJECT_FRONTEND_LIST_NAME}` : OBJECT_FRONTEND_LIST_NAME;
  let content;
  try {
    content = yamlParse(String(text ?? '')) ?? {};
  } catch (error) {
    return { assetList: [], problemList: [`${place} does not parse: ${String(error?.message ?? error)}`] };
  }
  if (!mappingIs(content)) return { assetList: [], problemList: [`${place} holds a mapping { assetList }`] };
  const problemList = Object.keys(content).filter((key) => key !== 'assetList').map((key) => `${place}: unknown key "${key}" (known: assetList)`);
  return { assetList: assetRecordListRead(content.assetList, place, problemList), problemList };
}

export function objectFrontendListTextBuild(assetList) {
  return [
    '# the assets of the frontend object lying in this folder and below, down to a folder with an',
    `# ${OBJECT_FRONTEND_LIST_NAME} of its own: written by the page (doc_page_impl_obj_frontend.md#the-item-lists)`,
    yamlStringify({ assetList: (assetList ?? []).map(assetRecordBuild) }),
  ].join('\n');
}

// the list an asset lying at groupPath is recorded in: the nearest folder holding a list, from
// its own folder up to the top of the item folder. with none, a list is made in the first
// folder of its path (the top for an asset at the top), never above it: an asset of a folder
// kept out of git is then never recorded in a list git keeps. listGroupPathList: the lists there are
export function objectFrontendListGroupPathGet(listGroupPathList, groupPath) {
  const listSet = new Set(listGroupPathList ?? []);
  const partList = String(groupPath ?? '').split('/').filter(Boolean);
  for (let length = partList.length; length >= 0; length--) {
    const groupPathUp = partList.slice(0, length).join('/');
    if (listSet.has(groupPathUp)) return groupPathUp;
  }
  return partList[0] ?? '';
}

// whether a list at listGroupPath covers an asset lying at groupPath (in its folder or below)
export function objectFrontendListCovers(listGroupPath, groupPath) {
  return !listGroupPath || groupPath === listGroupPath || String(groupPath ?? '').startsWith(`${listGroupPath}/`);
}

// the assets of an object, from the list in its entry and its item lists, each record with the
// list it is in (listGroupPath: null for the entry): { assetList, problemList }. a key or an item
// listed twice keeps its first record; the entry comes first, then the lists by their folder
export function objectFrontendAssetListMerge(entryAssetList, listList) {
  const assetList = [];
  const problemList = [];
  const keySet = new Set();
  const itemIdSet = new Set();
  const sourceList = [
    { listGroupPath: null, assetList: entryAssetList ?? [], place: 'the entry' },
    ...[...(listList ?? [])].sort((a, b) => String(a.groupPath).localeCompare(String(b.groupPath)))
      .map((list) => ({ listGroupPath: list.groupPath ?? '', assetList: list.assetList ?? [], place: list.groupPath ? `${list.groupPath}/${OBJECT_FRONTEND_LIST_NAME}` : OBJECT_FRONTEND_LIST_NAME })),
  ];
  for (const list of listList ?? []) problemList.push(...(list.problemList ?? []));
  for (const source of sourceList) {
    for (const record of source.assetList) {
      if (keySet.has(record.key)) {
        problemList.push(`${source.place}: the key ${record.key} is listed already; this record is left out`);
        continue;
      }
      if (itemIdSet.has(record.itemId)) {
        problemList.push(`${source.place}: the item ${record.itemId} is listed already; this record is left out`);
        continue;
      }
      keySet.add(record.key);
      itemIdSet.add(record.itemId);
      assetList.push({ ...record, listGroupPath: source.listGroupPath });
    }
  }
  return { assetList, problemList };
}

// a key unique among the assets of an entry, from what is asked for (the
// kind and a number when nothing is asked for)
export function objectFrontendAssetKeyFree(entry, keyWanted, kind) {
  const keySet = new Set((entry.assetList ?? []).map((item) => item.key));
  if (keyWanted) return keySet.has(keyWanted) ? '' : keyWanted;
  const base = kind && OBJECT_FRONTEND_KEY_REGEX.test(kind) ? kind : 'asset';
  for (let index = 1; ; index++) {
    const key = `${base}-${index}`;
    if (!keySet.has(key)) return key;
  }
}

// ---------- what a type accepts ----------

// the assets a type declares it holds: assetKindList of its declaration, or of the nearest
// ancestor that has one; undefined when none says, and then any asset is accepted
// (doc_page_impl_obj_frontend.md#what-a-type-accepts)
export function objectFrontendAssetKindListResolve(typeId, typeList) {
  return typeKeyResolve(typeId, typeList, 'assetKindList');
}

// the partitions a type declares: partitionList of its declaration or of the nearest ancestor that
// has one; undefined when none says (doc_page_impl_obj_frontend.md#partitions)
export function objectFrontendPartitionListResolve(typeId, typeList) {
  return typeKeyResolve(typeId, typeList, 'partitionList');
}

// a list a type declares under key, or the nearest ancestor's
function typeKeyResolve(typeId, typeList, key) {
  const typeById = new Map((typeList ?? []).map((type) => [type.id, type]));
  const visitedSet = new Set();
  const queue = [typeId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visitedSet.has(id)) continue;
    visitedSet.add(id);
    const type = typeById.get(id);
    if (!type) continue;
    if (Array.isArray(type[key])) return type[key];
    queue.push(...(type.extendList ?? []));
  }
  return undefined;
}

// ---------- partitions ----------
// the folders of the item folder an object splits its items into, each with its own item list
// (doc_page_impl_obj_frontend.md#partitions)

// the partitions of an object: those its type declares, then the folders at the top of its item
// folder holding an item list or saying their storage point. each { id, label, description,
// isGitIgnored, isDeclared, isPresent, storagePoint? }
// isDefault: where a write naming none goes; assetCount: the assets lying in it (groupPathList: the
// places of the object's assets); storagePoint: the point its type binds it to when it is made
export function objectFrontendPartitionListBuild(partitionDeclaredList, listGroupPathList, groupPathList = [], partitionBoundList = []) {
  const presentSet = new Set([...(listGroupPathList ?? []).map((groupPath) => String(groupPath).split('/')[0]), ...partitionBoundList].filter(Boolean));
  const partitionDefault = objectFrontendPartitionDefaultGet(partitionDeclaredList);
  const partitionList = (partitionDeclaredList ?? []).map((one) => ({ ...one, isDefault: one === partitionDefault, isDeclared: true, isPresent: presentSet.has(one.id) }));
  for (const id of presentSet) {
    if (partitionList.some((one) => one.id === id)) continue;
    partitionList.push({ id, label: id, description: '', isGitIgnored: false, isDefault: false, isDeclared: false, isPresent: true });
  }
  const countById = new Map();
  for (const groupPath of groupPathList ?? []) {
    const first = String(groupPath ?? '').split('/')[0];
    countById.set(first, (countById.get(first) ?? 0) + 1);
  }
  return partitionList.map((one) => ({ ...one, assetCount: countById.get(one.id) ?? 0 }));
}

// the partition an item lying at groupPath is in: the first folder of its path when that is a
// partition of the object, '' otherwise
export function objectFrontendPartitionOf(partitionList, groupPath) {
  const first = String(groupPath ?? '').split('/')[0];
  return first && (partitionList ?? []).some((one) => one.id === first) ? first : '';
}

// what a form making something says of where it goes (doc_page_impl_obj_frontend.md#partitions):
// "item/playground/book, kept out of git". partition: one of partitionList, or undefined for none
export function objectFrontendPartitionPlaceText(partition, groupPathInside = '') {
  const folder = ['item', partition?.id, groupPathInside].filter(Boolean).join('/');
  if (!partition) return `${folder}/`;
  // a storage point other than file-tree is said too: the item is then no folder of plain files
  // (doc_page_impl_asset_storage.md)
  const storage = partition.storage && partition.storage.typeId !== 'file-tree' ? `, held by ${partition.storage.pointId}` : '';
  return `${folder}/, ${partition.isGitIgnored ? 'kept out of git' : 'tracked by git'}${storage}`;
}

// the partition a write naming none goes to: the one declared isDefault, else the first; undefined
// when the type declares none
export function objectFrontendPartitionDefaultGet(partitionDeclaredList) {
  return (partitionDeclaredList ?? []).find((one) => one.isDefault) ?? (partitionDeclaredList ?? [])[0];
}

// the folder a write places an item in: groupPath inside the partition named; naming none, the
// default partition of a type that declares some (a groupPath already starting with a declared
// partition is taken as it is). { groupPath, message }, message '' when the partition is one the
// object may use
export function objectFrontendPartitionGroupPathBuild(partitionDeclaredList, partition, groupPathInside) {
  const inside = String(groupPathInside ?? '').split('/').filter(Boolean).join('/');
  if (partition === undefined || partition === null || partition === '') {
    const isPlaced = (partitionDeclaredList ?? []).some((one) => inside === one.id || inside.startsWith(`${one.id}/`));
    const partitionDefault = isPlaced ? undefined : objectFrontendPartitionDefaultGet(partitionDeclaredList);
    if (!partitionDefault) return { groupPath: inside, message: '' };
    return { groupPath: inside ? `${partitionDefault.id}/${inside}` : partitionDefault.id, message: '' };
  }
  if (!OBJECT_FRONTEND_PARTITION_REGEX.test(partition)) return { groupPath: '', message: `a partition is a folder name: letters, digits, "_", "-" and "." (${JSON.stringify(partition)})` };
  if (partitionDeclaredList && !partitionDeclaredList.some((one) => one.id === partition)) {
    return { groupPath: '', message: `the type declares no partition ${partition} (its partitions: ${partitionDeclaredList.map((one) => one.id).join(', ')})` };
  }
  return { groupPath: inside ? `${partition}/${inside}` : partition, message: '' };
}

// whether an object of that type takes an asset: { message, kind, kindDeclared }; message is
// '' when it does. isIncoming: it comes from outside the object (attached, adopted), not
// made by a mode. a kind left out is the only kind there is
export function objectFrontendAssetAcceptCheck(kindList, input) {
  const kindText = String(input.kind ?? '');
  if (kindList === undefined) return { message: '', kind: kindText, kindDeclared: undefined };
  const kind = kindText || (kindList.length === 1 ? kindList[0].id : '');
  const kindDeclared = kindList.find((one) => one.id === kind);
  const kindAll = kindList.map((one) => one.id).join(', ') || '(none)';
  if (!kind) return { message: `say the kind of the asset: ${kindAll}`, kind, kindDeclared };
  if (!kindDeclared) return { message: `this type holds no asset of the kind ${kind} (it holds ${kindAll})`, kind, kindDeclared };
  if (input.isIncoming && kindDeclared.isIncomingRefused === true) return { message: `an asset of the kind ${kind} is made by the modes of this type, it cannot come from elsewhere`, kind, kindDeclared };
  const lang = String(input.lang ?? '');
  if (Array.isArray(kindDeclared.langList) && kindDeclared.langList.length > 0 && !kindDeclared.langList.includes(lang)) {
    return { message: `an asset of the kind ${kind} is in ${kindDeclared.langList.join(', ')}, not ${lang || 'bytes without a language'}`, kind, kindDeclared };
  }
  const pathPrefix = String(kindDeclared.pathPrefix ?? '');
  // paths index an asset several ways: one of them, when it has any, files it under its kind
  const pathList = input.pathList ?? [];
  // a pattern files it so when one of the paths it stands for does
  const isFiled = (pattern) => {
    const { textList } = assetPathCompile(pattern, { isAbsolute: true });
    return (textList.length > 0 ? textList : [String(pattern)]).some((path) => path.startsWith(pathPrefix));
  };
  if (pathPrefix && pathList.length > 0 && !pathList.some(isFiled)) {
    return { message: `one path of the kind ${kind} starts with ${pathPrefix}, not ${pathList.join(', ')}`, kind, kindDeclared };
  }
  return { message: '', kind, kindDeclared };
}

// ---------- the assets of an object: names, paths, references ----------
//
// an asset of a frontend object may have a name, for people (Dune), and
// paths, any number of them, indexing it the ways its object wants (by
// kind and genre, by author: /book/sci-fi/dune, /author/frank-herbert/dune).
// a path is an asset path pattern (doc-object-frontend-asset-path.js,
// doc_page_impl_obj_frontend_asset_path.md): a plain path, read as an os
// path is ("book//sci-fi/./dune/" is /book/sci-fi/dune), or one with
// unordered groups and choices, standing for several paths
// (/book/{sci-fi/frank-herbert/}dune). it is written in its canonical form,
// always from the root of the object. the folders of the paths are implied
// (/book, /book/sci-fi) and hold nothing themselves. every path a pattern
// stands for names one asset of its object (the writes refuse a taken one;
// one written twice by hand names the first and is reported). which paths
// an asset has is the object's choice; the recommended pattern starts with
// the kind (/book/..., /note/...), so the kinds are the first folders
// (objectFrontendAssetPathBuild).
//
// what names an asset within its object (an asset reference), wherever a
// mode, a block's param or a caller asks for one:
//   /book/sci-fi/dune     a path (it starts with "/")
//   book-1, key:book-1    its key
//   name:Dune             its name (names need not be unique: the first, said to be ambiguous)
//   id:w5j7pmxa7fw        the object id of the asset

export const OBJECT_FRONTEND_ASSET_PATH_SEGMENT_LENGTH_MAX = ASSET_PATH_SEGMENT_LENGTH_MAX;

// { path, message }: the canonical form of a path pattern, from the root ('' for an empty text),
// or why it is none. the grammar is the asset path grammar (doc-object-frontend-asset-path.js):
// a plain path, or one with unordered groups ({a/b/}x, {a, b}) and choices ([a, b])
export function objectFrontendAssetPathNormalize(textInput) {
  const text = String(textInput ?? '').trim();
  if (text === '') return { path: '', message: '' };
  const { path, message } = assetPathNormalize(text, { isAbsolute: true });
  if (message) return { path: '', message: message.replace(/^it goes above the root/, 'it goes above the root of the object') };
  if (!path) return { path: '', message: 'the root of the object names no asset' };
  return { path, message: '' };
}

// a name made a folder name of the recommended pattern: lowercase, letters
// and digits joined by "-" (Frank Herbert -> frank-herbert; Gödel, Escher,
// Bach -> gödel-escher-bach)
export function objectFrontendAssetPathSegmentBuild(text) {
  return String(text ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    .slice(0, OBJECT_FRONTEND_ASSET_PATH_SEGMENT_LENGTH_MAX);
}

// the recommended path of an asset: its kind first, then the segments its
// object chooses, each made a folder name: ('book', 'Sci-Fi', 'Dune') -> /book/sci-fi/dune
export function objectFrontendAssetPathBuild(kind, ...segmentList) {
  return objectFrontendAssetPathNormalize([kind, ...segmentList].map(objectFrontendAssetPathSegmentBuild).filter(Boolean).join('/')).path;
}

// the index of the assets of an object: by key, by path, by name, by id,
// and the folders the paths imply. assetList: the assets as the object
// state lists them (with status). a path pattern indexes the asset under
// every path it stands for. problemList: a path claimed twice, a pattern
// that is none
//   pathIndex   the asset path index (doc-object-frontend-asset-path.js): folders, completion
//   byPath      every concrete path -> its asset
export function objectFrontendAssetIndexBuild(assetList) {
  const byKey = new Map();
  const byName = new Map();
  const byItemId = new Map();
  for (const asset of assetList ?? []) {
    byKey.set(asset.key, asset);
    byItemId.set(asset.itemId, asset);
    if (asset.name) byName.set(asset.name, [...(byName.get(asset.name) ?? []), asset]);
  }
  const pathIndex = assetPathIndexBuild((assetList ?? []).map((asset) => ({ entry: asset, pathList: asset.pathList ?? [] })), { labelOf: (asset) => asset.key, isAbsolute: true });
  return { byKey, byPath: pathIndex.entryByPath, byName, byItemId, pathIndex, problemList: pathIndex.problemList };
}

export function objectFrontendAssetPathParentGet(path) {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

// what an asset reference names: { status, asset?, by, message }
//   found                 an asset of the object, there in the store
//   missing | deleted     an asset the object lists, gone from the store (asset says which)
//   unknown               nothing of the object answers to the reference
// a name several assets have answers the first, with the message saying so. a path with
// groups or choices names the asset every path it stands for names (an asset's own pattern)
export function objectFrontendAssetRefResolve(index, refInput) {
  const ref = String(refInput ?? '').trim();
  if (ref === '') return { status: 'unknown', by: '', message: 'name the asset: a path (/…), a key, name:…, id:…' };
  let by;
  let asset;
  let message = '';
  if (ref.startsWith('/')) {
    by = 'path';
    const compiled = assetPathCompile(ref, { isAbsolute: true });
    if (compiled.message) return { status: 'unknown', by, message: `${ref}: ${compiled.message}` };
    if (compiled.pathList.length === 0) return { status: 'unknown', by, message: `${ref}: the root of the object names no asset` };
    const assetSet = new Set(compiled.pathList.map((one) => assetPathIndexGet(index.pathIndex, one)));
    if (assetSet.size > 1) return { status: 'unknown', by, message: `${compiled.path} stands for paths of several assets (or of none): name one path` };
    [asset] = [...assetSet];
    if (!asset && compiled.pathList.length === 1 && assetPathIndexNodeGet(index.pathIndex, compiled.pathList[0])) {
      return { status: 'unknown', by, message: `${compiled.path} is a folder of the object, not an asset` };
    }
  } else if (ref.startsWith('name:')) {
    by = 'name';
    const list = index.byName.get(ref.slice('name:'.length).trim()) ?? [];
    asset = list[0];
    if (list.length > 1) message = `${list.length} assets are named ${ref.slice(5).trim()}: ${list.map((item) => item.key).join(', ')}; the first is answered`;
  } else if (ref.startsWith('id:')) {
    by = 'id';
    asset = index.byItemId.get(ref.slice('id:'.length).trim());
  } else {
    by = 'key';
    asset = index.byKey.get(ref.startsWith('key:') ? ref.slice('key:'.length).trim() : ref);
  }
  if (!asset) return { status: 'unknown', by, message: `the object has no asset ${ref}` };
  if (asset.status && asset.status !== 'found') {
    return { status: asset.status, by, asset, message: `${asset.name || asset.key} is ${asset.status === 'deleted' ? 'deleted in' : 'missing from'} the asset store (${asset.itemId})` };
  }
  return { status: 'found', by, asset, message };
}

// the candidates completing a typed path, as path completion of the doc
// page source does: the folder typed so far is listed, its folders first,
// then its assets, those whose name starts with what follows the last "/"
// (then those that hold it). a text without a leading "/" is read from
// base (default the root). kindList: only assets of these kinds, and the
// folders holding one. a folder is every folder some path of a pattern runs
// through, so an asset at /book/{sci-fi/frank-herbert/}dune is under both
//   -> [{ kind: 'folder' | 'asset', path, segment, asset?, assetCount }]
export function objectFrontendAssetPathComplete(index, textInput, { kindList = [], base = '/' } = {}) {
  const kindSet = new Set(kindList);
  const candidateList = assetPathIndexComplete(index.pathIndex, textInput, {
    base,
    isEntryWanted: (asset) => kindSet.size === 0 || kindSet.has(asset.kind),
    labelOf: (asset) => asset.name ?? '',
  });
  return candidateList.map((one) => (one.kind === 'folder'
    ? { kind: 'folder', path: one.path, segment: one.segment, assetCount: one.entryCount }
    : { kind: 'asset', path: one.path, segment: one.segment, asset: one.entry, assetCount: 1 }));
}

// a search of the assets of an object by words, as the object registry's
// search reads them (doc_page_impl_obj_search.md#the-grammar): words in any
// order, every one matching some field, a word narrowed by a key:
//   kind:book   name:dune   key:book-1   id:w5j7…   path:sci-fi  (a path word starting with "/": a prefix)
// the score adds where each word matched: the start of the name (8), the
// name (5), the start of a folder of a path (4), a path (3), the key (3),
// the kind (2), the id (1). kindList: only these kinds.
//   -> { tokenList, hitList: [{ asset, score, matchList: [{ token, field }], pathMatched }] }  best first
export function objectFrontendAssetSearch(assetList, textInput, { kindList = [], limit = 100 } = {}) {
  const tokenList = searchTokenListGet(textInput);
  const kindSet = new Set(kindList);
  const hitList = [];
  for (const asset of assetList ?? []) {
    if (kindSet.size > 0 && !kindSet.has(asset.kind)) continue;
    let score = 0;
    const matchList = [];
    let pathMatched = '';
    let isHit = true;
    for (const token of tokenList) {
      const match = assetTokenMatch(asset, token);
      if (!match) {
        isHit = false;
        break;
      }
      score += match.score;
      matchList.push({ token: token.text, field: match.field });
      if (match.path && !pathMatched) pathMatched = match.path;
    }
    if (!isHit) continue;
    hitList.push({ asset, score, matchList, pathMatched: pathMatched || asset.pathList?.[0] || '' });
  }
  hitList.sort((a, b) => b.score - a.score || String(a.asset.name || a.asset.key).localeCompare(String(b.asset.name || b.asset.key)));
  return { tokenList, hitList: hitList.slice(0, limit), isTruncated: hitList.length > limit };
}

const SEARCH_KEY_LIST = ['kind', 'name', 'key', 'id', 'path'];

// words split by spaces, "quoted words" one word, key:word narrowed to a field
function searchTokenListGet(textInput) {
  const tokenList = [];
  const regex = /(\w+:)?"([^"]*)"|(\S+)/g;
  const text = String(textInput ?? '');
  let match;
  while ((match = regex.exec(text)) !== null) {
    let raw = match[3] ?? `${match[1] ?? ''}${match[2]}`;
    let field = '';
    const indexColon = raw.indexOf(':');
    if (indexColon > 0 && SEARCH_KEY_LIST.includes(raw.slice(0, indexColon))) {
      field = raw.slice(0, indexColon);
      raw = raw.slice(indexColon + 1);
    }
    const value = raw.trim();
    if (value) tokenList.push({ text: match[0], field, value, valueLower: value.toLowerCase() });
  }
  return tokenList;
}

function assetTokenMatch(asset, token) {
  const valueLower = token.valueLower;
  const is = (field) => token.field === '' || token.field === field;
  const name = String(asset.name ?? '').toLowerCase();
  if (is('name') && name.startsWith(valueLower)) return { field: 'name', score: 8 };
  if (is('name') && name.includes(valueLower)) return { field: 'name', score: 5 };
  if (is('path')) {
    // every path a pattern stands for, the canonical one first
    const pathTextList = (asset.pathList ?? []).flatMap((pattern) => {
      const { textList } = assetPathCompile(pattern, { isAbsolute: true });
      return textList.length > 0 ? textList : [String(pattern)];
    });
    for (const path of pathTextList) {
      const pathLower = path.toLowerCase();
      if (valueLower.startsWith('/')) {
        if (pathLower.startsWith(valueLower)) return { field: 'path', score: 4, path };
        continue;
      }
      if (pathLower.split('/').some((segment) => segment.startsWith(valueLower))) return { field: 'path', score: 4, path };
    }
    if (!valueLower.startsWith('/')) {
      const path = pathTextList.find((one) => one.toLowerCase().includes(valueLower));
      if (path) return { field: 'path', score: 3, path };
    }
  }
  if (is('key') && String(asset.key).toLowerCase().includes(valueLower)) return { field: 'key', score: 3 };
  if (is('kind') && String(asset.kind ?? '').toLowerCase().startsWith(valueLower)) return { field: 'kind', score: 2 };
  if (is('id') && String(asset.itemId ?? '').startsWith(valueLower)) return { field: 'id', score: 1 };
  return undefined;
}

// the paths of an asset as a text and back: "a, b" (the settings tab edits them so); a comma
// inside a choice [a, b] stays in its pattern
export function objectFrontendAssetPathListParse(text) {
  const pathList = [];
  const problemList = [];
  for (const part of assetPathListSplit(text)) {
    const { path, message } = objectFrontendAssetPathNormalize(part);
    if (message) problemList.push(`${part}: ${message}`);
    else if (path && !pathList.includes(path)) pathList.push(path);
  }
  return { pathList, problemList };
}

// ---------- the block of the entry component ----------

// { object, mode, param, message } of the yaml of an ObjectFrontend block;
// message says what could not be read
export function objectFrontendBlockRead(raw) {
  const result = { object: '', mode: '', param: {}, message: '' };
  let content;
  try {
    content = yamlParse(String(raw ?? '')) ?? {};
  } catch (error) {
    return { ...result, message: `the yaml of the block is not valid: ${String(error?.message ?? error)}` };
  }
  if (!mappingIs(content)) return { ...result, message: 'the block holds no mapping { object, mode, param }' };
  result.object = String(content.object ?? content.ref ?? '').trim();
  result.mode = typeof content.mode === 'string' ? content.mode.trim() : '';
  if (content.param !== undefined && content.param !== null && !mappingIs(content.param)) {
    return { ...result, message: 'param is a mapping of the parameters the mode reads' };
  }
  result.param = content.param ?? {};
  return result;
}

// the yaml of an ObjectFrontend block: an empty param and an absent mode are
// not written
export function objectFrontendBlockTextBuild({ object, mode, param }) {
  const content = { object: String(object ?? '') };
  if (mode) content.mode = String(mode);
  if (mappingIs(param) && Object.keys(param).length > 0) content.param = param;
  return yamlStringify(content);
}

// ---------- modes ----------

// the modes of a type: its own declarations first, then those of its
// ancestors, nearest first (rank of the type registry); an id declared on a
// nearer type hides the same id farther away. modeListByType: typeId ->
// [mode]; ancestorList: the ancestors of the type in rank order, the root
// (frontend.object) among them. every mode says where it is declared
// (typeId) and the default is the nearest one marked isDefault, else the
// first mode of the nearest type that has one
export function objectFrontendModeListResolve(typeId, ancestorList, modeListByType) {
  const typeIdList = [typeId, ...ancestorList.filter((item) => item !== typeId)];
  if (!typeIdList.includes(OBJECT_FRONTEND_TYPE_ROOT)) typeIdList.push(OBJECT_FRONTEND_TYPE_ROOT);
  const modeList = [];
  const idSet = new Set();
  for (const typeIdOne of typeIdList) {
    const own = typeIdOne === OBJECT_FRONTEND_TYPE_ROOT
      ? [...(modeListByType[typeIdOne] ?? []), ...OBJECT_FRONTEND_MODE_BUILTIN_LIST]
      : modeListByType[typeIdOne] ?? [];
    for (const mode of own) {
      if (idSet.has(mode.id)) continue;
      idSet.add(mode.id);
      modeList.push({ ...mode, typeId: typeIdOne });
    }
  }
  const modeDefault = modeList.find((mode) => mode.isDefault) ?? modeList[0];
  return modeList.map((mode) => ({ ...mode, isDefault: mode === modeDefault }));
}

// the mode a block asks for, else the default; undefined when the type has
// none of that id (the block shows why)
export function objectFrontendModeChoose(modeList, modeId) {
  if (!modeId) return modeList.find((mode) => mode.isDefault) ?? modeList[0];
  return modeList.find((mode) => mode.id === modeId);
}

// the parameters a mode's component receives: the mode's own, then the
// block's over them (a key at a time)
export function objectFrontendParamMerge(paramMode, paramBlock) {
  return { ...(mappingIs(paramMode) ? paramMode : {}), ...(mappingIs(paramBlock) ? paramBlock : {}) };
}

function mappingIs(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
