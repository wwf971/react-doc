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
//                          assetList [{ key, kind, objectId }]  its assets, by a key
//                                    unique in the object; kind groups them ("book")
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
    entry.assetList.push({ key, kind: typeof item.kind === 'string' ? item.kind : '', objectId: item.objectId });
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
    assetList: (entry.assetList ?? []).map((item) => ({ key: item.key, kind: item.kind ?? '', objectId: item.objectId })),
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
