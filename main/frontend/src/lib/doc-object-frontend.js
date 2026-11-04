import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

// The frontend object service layer, its pure part (design:
// doc_page_impl_obj_frontend.md), shared by the development server
// (plugin/doc-object-frontend.ts) and the page (DocObjectFrontendStore):
//
//   a frontend object    an object of the object registry whose data the page
//                        keeps itself, in assets of the asset store: one entry
//                        asset that describes it, and any number of assets of
//                        its own. its reference is frontend:{id}
//   the entry asset      yaml: { name, type, description, assetList, metadata }
//                          assetList [{ key, kind, objectId, name?, pathList? }]  its assets, by a
//                                    key unique in the object; kind groups them ("book"); a name
//                                    for people, and paths (/book/sci-fi/dune) indexing them, any
//                                    number of them, each unique in the object
//                          metadata  a free mapping, the type's own
//   an asset of it       declares it in its own metadata (object.yaml):
//                          owner: { ref: frontend:{id}, role: entry }   the entry
//                          owner: { ref: frontend:{id} }                any other
//   a type               frontend.object or a type a doc page declares
//                        (object-frontend.yaml), extending it; its modes are
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
// the placement a mode's component is rendered in
export const OBJECT_FRONTEND_PLACEMENT = 'objectFrontend';

export const OBJECT_FRONTEND_KEY_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const OBJECT_FRONTEND_MODE_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
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
  const keySet = new Set();
  const assetListRaw = Array.isArray(content.assetList) ? content.assetList : [];
  if (content.assetList !== undefined && !Array.isArray(content.assetList)) problemList.push('assetList is not a list');
  assetListRaw.forEach((item, index) => {
    if (!mappingIs(item) || typeof item.objectId !== 'string' || !item.objectId) {
      problemList.push(`assetList[${index}] is not { key, kind, objectId }`);
      return;
    }
    const key = typeof item.key === 'string' && item.key ? item.key : item.objectId;
    if (keySet.has(key)) {
      problemList.push(`assetList[${index}]: the key ${key} is used twice; this one is left out`);
      return;
    }
    keySet.add(key);
    const asset = { key, kind: typeof item.kind === 'string' ? item.kind : '', objectId: item.objectId };
    if (typeof item.name === 'string' && item.name !== '') asset.name = item.name;
    const pathList = [];
    for (const pathText of Array.isArray(item.pathList) ? item.pathList : []) {
      const { path, message } = objectFrontendAssetPathNormalize(pathText);
      if (message) problemList.push(`assetList[${index}] (${key}): the path ${JSON.stringify(pathText)} is left out: ${message}`);
      else if (!pathList.includes(path)) pathList.push(path);
    }
    if (item.pathList !== undefined && !Array.isArray(item.pathList)) problemList.push(`assetList[${index}] (${key}): pathList is a list of paths`);
    if (pathList.length > 0) asset.pathList = pathList;
    entry.assetList.push(asset);
  });
  return { entry, problemList };
}

// the text of an entry asset. the entry is data the layer keeps (like the
// workbook of a sheet), written whole; the keys in one order
export function objectFrontendEntryTextBuild(entry) {
  const content = {
    name: String(entry.name ?? ''),
    type: String(entry.type || OBJECT_FRONTEND_TYPE_ROOT),
    description: String(entry.description ?? ''),
    assetList: (entry.assetList ?? []).map((item) => ({
      key: item.key,
      kind: item.kind ?? '',
      objectId: item.objectId,
      // written when there is one: an entry of assets without names stays as short as before
      ...(item.name ? { name: item.name } : {}),
      ...(Array.isArray(item.pathList) && item.pathList.length > 0 ? { pathList: item.pathList } : {}),
    })),
    metadata: mappingIs(entry.metadata) ? entry.metadata : {},
  };
  return yamlStringify(content);
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

// ---------- the assets of an object: names, paths, references ----------
//
// an asset of a frontend object may have a name, for people (Dune), and
// paths, any number of them, indexing it the ways its object wants (by
// kind and genre, by author: /book/sci-fi/dune, /author/frank-herbert/dune).
// a path is read as an os path is: "/" separates the folders, "." and ".."
// and repeated or trailing slashes are resolved, so "book//sci-fi/./dune/"
// is /book/sci-fi/dune; it is written in that canonical form, always from
// the root of the object. the folders of the paths are implied (/book,
// /book/sci-fi) and hold nothing themselves. a path names one asset of its
// object (the writes refuse a taken one; one written twice by hand names
// the first and is reported). which paths an asset has is the object's
// choice; the recommended pattern starts with the kind (/book/...,
// /note/...), so the kinds are the first folders (objectFrontendAssetPathBuild).
//
// what names an asset within its object (an asset reference), wherever a
// mode, a block's param or a caller asks for one:
//   /book/sci-fi/dune     a path (it starts with "/")
//   book-1, key:book-1    its key
//   name:Dune             its name (names need not be unique: the first, said to be ambiguous)
//   id:w5j7pmxa7fw        the object id of the asset

export const OBJECT_FRONTEND_ASSET_PATH_SEGMENT_LENGTH_MAX = 80;

// { path, message }: the canonical form of a path ('' for an empty text), or why it is none
export function objectFrontendAssetPathNormalize(textInput) {
  const text = String(textInput ?? '').trim();
  if (text === '') return { path: '', message: '' };
  const segmentList = [];
  for (const segmentRaw of text.split('/')) {
    const segment = segmentRaw.trim();
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segmentList.length === 0) return { path: '', message: 'it goes above the root of the object' };
      segmentList.pop();
      continue;
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(segment)) return { path: '', message: 'a folder name cannot hold control characters' };
    if (segment.length > OBJECT_FRONTEND_ASSET_PATH_SEGMENT_LENGTH_MAX) return { path: '', message: `a folder name is at most ${OBJECT_FRONTEND_ASSET_PATH_SEGMENT_LENGTH_MAX} characters` };
    segmentList.push(segment);
  }
  if (segmentList.length === 0) return { path: '', message: 'the root of the object names no asset' };
  return { path: `/${segmentList.join('/')}`, message: '' };
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
// state lists them (with status). problemList: a path claimed twice
export function objectFrontendAssetIndexBuild(assetList) {
  const byKey = new Map();
  const byPath = new Map();
  const byName = new Map();
  const byObjectId = new Map();
  // folder path -> { path, folderSet: Set of child folder paths, assetPathList }
  const folderByPath = new Map([['/', { path: '/', folderSet: new Set(), assetPathList: [] }]]);
  const problemList = [];
  const folderEnsure = (path) => {
    if (folderByPath.has(path)) return folderByPath.get(path);
    const folder = { path, folderSet: new Set(), assetPathList: [] };
    folderByPath.set(path, folder);
    folderEnsure(objectFrontendAssetPathParentGet(path)).folderSet.add(path);
    return folder;
  };
  for (const asset of assetList ?? []) {
    byKey.set(asset.key, asset);
    byObjectId.set(asset.objectId, asset);
    if (asset.name) byName.set(asset.name, [...(byName.get(asset.name) ?? []), asset]);
    for (const path of asset.pathList ?? []) {
      if (byPath.has(path)) {
        problemList.push(`the path ${path} is claimed by ${byPath.get(path).key} and ${asset.key}: it names ${byPath.get(path).key}`);
        continue;
      }
      byPath.set(path, asset);
      folderEnsure(objectFrontendAssetPathParentGet(path)).assetPathList.push(path);
    }
  }
  return { byKey, byPath, byName, byObjectId, folderByPath, problemList };
}

export function objectFrontendAssetPathParentGet(path) {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

// what an asset reference names: { status, asset?, by, message }
//   found                 an asset of the object, there in the store
//   missing | deleted     an asset the object lists, gone from the store (asset says which)
//   unknown               nothing of the object answers to the reference
// a name several assets have answers the first, with the message saying so
export function objectFrontendAssetRefResolve(index, refInput) {
  const ref = String(refInput ?? '').trim();
  if (ref === '') return { status: 'unknown', by: '', message: 'name the asset: a path (/…), a key, name:…, id:…' };
  let by;
  let asset;
  let message = '';
  if (ref.startsWith('/')) {
    by = 'path';
    const { path, message: pathMessage } = objectFrontendAssetPathNormalize(ref);
    if (pathMessage) return { status: 'unknown', by, message: `${ref}: ${pathMessage}` };
    asset = index.byPath.get(path);
    if (!asset && index.folderByPath.has(path)) return { status: 'unknown', by, message: `${path} is a folder of the object, not an asset` };
  } else if (ref.startsWith('name:')) {
    by = 'name';
    const list = index.byName.get(ref.slice('name:'.length).trim()) ?? [];
    asset = list[0];
    if (list.length > 1) message = `${list.length} assets are named ${ref.slice(5).trim()}: ${list.map((item) => item.key).join(', ')}; the first is answered`;
  } else if (ref.startsWith('id:')) {
    by = 'id';
    asset = index.byObjectId.get(ref.slice('id:'.length).trim());
  } else {
    by = 'key';
    asset = index.byKey.get(ref.startsWith('key:') ? ref.slice('key:'.length).trim() : ref);
  }
  if (!asset) return { status: 'unknown', by, message: `the object has no asset ${ref}` };
  if (asset.status && asset.status !== 'found') {
    return { status: asset.status, by, asset, message: `${asset.name || asset.key} is ${asset.status === 'deleted' ? 'deleted in' : 'missing from'} the asset store (${asset.objectId})` };
  }
  return { status: 'found', by, asset, message };
}

// the candidates completing a typed path, as path completion of the doc
// page source does: the folder typed so far is listed, its folders first,
// then its assets, those whose name starts with what follows the last "/"
// (then those that hold it). a text without a leading "/" is read from
// base (default the root). kindList: only assets of these kinds, and the
// folders holding one.
//   -> [{ kind: 'folder' | 'asset', path, segment, asset?, assetCount }]
export function objectFrontendAssetPathComplete(index, textInput, { kindList = [], base = '/' } = {}) {
  const text = String(textInput ?? '');
  const isAbsolute = text.startsWith('/');
  const indexSlash = text.lastIndexOf('/');
  const dirText = indexSlash >= 0 ? text.slice(0, indexSlash + 1) : '';
  const prefix = (indexSlash >= 0 ? text.slice(indexSlash + 1) : text).toLowerCase();
  const dirJoined = isAbsolute ? dirText : `${base.replace(/\/$/, '')}/${dirText}`;
  const dirPath = objectFrontendAssetPathNormalize(dirJoined).path || '/';
  const folder = index.folderByPath.get(dirPath);
  if (!folder) return [];
  const kindSet = new Set(kindList);
  const assetIsWanted = (asset) => kindSet.size === 0 || kindSet.has(asset.kind);
  const assetCountGet = (folderPath) => {
    let count = 0;
    for (const [path, asset] of index.byPath) if ((path.startsWith(`${folderPath}/`) || folderPath === '/') && assetIsWanted(asset)) count += 1;
    return count;
  };
  const candidateList = [];
  for (const path of folder.folderSet) {
    const count = assetCountGet(path);
    if (count > 0) candidateList.push({ kind: 'folder', path, segment: path.slice(path.lastIndexOf('/') + 1), assetCount: count });
  }
  for (const path of folder.assetPathList) {
    const asset = index.byPath.get(path);
    if (assetIsWanted(asset)) candidateList.push({ kind: 'asset', path, segment: path.slice(path.lastIndexOf('/') + 1), asset, assetCount: 1 });
  }
  const rankGet = (candidate) => {
    const segment = candidate.segment.toLowerCase();
    const name = String(candidate.asset?.name ?? '').toLowerCase();
    if (prefix === '' || segment.startsWith(prefix)) return 0;
    if (name.startsWith(prefix)) return 1;
    if (segment.includes(prefix) || name.includes(prefix)) return 2;
    return -1;
  };
  return candidateList
    .map((candidate) => ({ candidate, rank: rankGet(candidate) }))
    .filter((item) => item.rank >= 0)
    .sort((a, b) => a.rank - b.rank || (a.candidate.kind === b.candidate.kind ? 0 : a.candidate.kind === 'folder' ? -1 : 1) || a.candidate.segment.localeCompare(b.candidate.segment))
    .map((item) => item.candidate);
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
    for (const path of asset.pathList ?? []) {
      const pathLower = path.toLowerCase();
      if (valueLower.startsWith('/')) {
        if (pathLower.startsWith(valueLower)) return { field: 'path', score: 4, path };
        continue;
      }
      if (pathLower.split('/').some((segment) => segment.startsWith(valueLower))) return { field: 'path', score: 4, path };
      if (pathLower.includes(valueLower)) return { field: 'path', score: 3, path };
    }
  }
  if (is('key') && String(asset.key).toLowerCase().includes(valueLower)) return { field: 'key', score: 3 };
  if (is('kind') && String(asset.kind ?? '').toLowerCase().startsWith(valueLower)) return { field: 'kind', score: 2 };
  if (is('id') && String(asset.objectId ?? '').startsWith(valueLower)) return { field: 'id', score: 1 };
  return undefined;
}

// the paths of an asset as a text and back: "a, b" (the settings tab edits them so)
export function objectFrontendAssetPathListParse(text) {
  const pathList = [];
  const problemList = [];
  for (const part of String(text ?? '').split(',')) {
    if (part.trim() === '') continue;
    const { path, message } = objectFrontendAssetPathNormalize(part);
    if (message) problemList.push(`${part.trim()}: ${message}`);
    else if (!pathList.includes(path)) pathList.push(path);
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
