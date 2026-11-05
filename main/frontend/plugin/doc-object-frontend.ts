import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { readYaml, type EntryFileSection } from './doc-entry.ts';
import { idMs48Create, idMs48Is } from './id-ms48.ts';
import { lineOperationListApply } from './doc-edit-lines.ts';
import { yamlSeqItemInsertBuild, yamlSeqItemRemoveBuild } from './doc-yaml-edit.ts';
import {
  AssetError, fileWriteSafe, nameNormalize, objectDirNameBuild,
  type AssetObjectMeta, type AssetStore,
} from './doc-asset-store.ts';
import {
  OBJECT_FRONTEND_CONFIG_FILE_NAME, OBJECT_FRONTEND_KEY_REGEX, OBJECT_FRONTEND_MODE_ID_REGEX, OBJECT_FRONTEND_ROLE_ENTRY,
  OBJECT_FRONTEND_TYPE_ID_REGEX, OBJECT_FRONTEND_TYPE_PREFIX_RESERVED_LIST, OBJECT_FRONTEND_TYPE_ROOT,
  objectFrontendAssetKeyFree, objectFrontendAssetPathNormalize, objectFrontendEntryParse, objectFrontendEntryTextBuild,
  objectFrontendRefBuild,
} from '../src/lib/doc-object-frontend.js';

// The frontend object service layer on the development server (design:
// doc_page_impl_obj_frontend.md). The page keeps the objects; the server
// reads what the doc pages declare and makes the structural writes, each in
// one request so that the files never say half of a change:
//
//   .doc-page/object-frontend.yaml     read when it exists (the convention)
//   entry "objectFrontend: { file }"   another file, relative to the entry
//   entry "objectFrontend: false"      the doc page has no frontend objects
//
//   typeList:                          the types of its objects (each extends frontend.object,
//     - id: example.reading-list         directly or through another declared type)
//       label: Reading list
//       description: ...
//       icon: book                     a name of the page's icon set
//       extendList: [frontend.object]  default
//       modeList:                      the ways an object of it is drawn
//         - id: shelf
//           label: Shelf
//           comp: ReadingList          a component of the registry, by tag name or id
//           category: view             free: view, edit, ... (how the modes are grouped)
//           param: { layout: table }   what the component starts with; a block adds its own
//           isDefault: true
//   objectList:                        the objects of the doc page, in its order
//     - id: w5a1b2c3d4e                its id: the reference is frontend:{id}
//       entry: w5a1b2c3d5f             the object id of its entry asset
//
// the assets of an object live in the asset folder of its doc page (its
// default folder), gathered in the group folder {id}--{name}, the entry
// among them; each declares the object in its owner. the yaml file is
// written in place (doc-yaml-edit.ts), with a .bak beside it.
//
// every problem of a file is reported with the file ([doc-object-frontend])
// and skips the item, never the page.

export type ObjectFrontendMode = {
  id: string;
  label: string;
  description: string;
  category: string;
  comp: string;
  param: Record<string, unknown>;
  isDefault: boolean;
};

export type ObjectFrontendType = {
  id: string;
  kind: 'object';
  label: string;
  description: string;
  icon: string;
  extendList: string[];
  summaryKeyList: string[];
  modeList: ObjectFrontendMode[];
  definedBy: { kind: 'docPage'; alias: string; file: string };
};

export type ObjectFrontendItem = { id: string; entry: string; docPageAlias: string };

export type ObjectFrontendDocPage = {
  // a package treated as a doc page: its objects are read, never written
  isReadOnly?: boolean;
  alias: string;
  // relative to the config directory
  entryFile: string;
  file: string;
  isFileExists: boolean;
  // objectFrontend: false of the entry
  isDisabled: boolean;
  // the asset folder its objects are created in ('' when the doc page has none)
  assetFolder: string;
  typeList: ObjectFrontendType[];
  objectList: ObjectFrontendItem[];
  problemList: string[];
};

export type ObjectFrontendConfig = {
  docPageList: ObjectFrontendDocPage[];
  // absolute, by alias: the file of each doc page (not sent to the page)
  fileAbsByAlias: Map<string, string>;
  // absolute: the files to watch
  pathList: string[];
};

export type ObjectFrontendDocPageInput = { alias: string; entryFile: string; objectFrontend?: EntryFileSection; isReadOnly?: boolean };

const TOP_KEY_LIST = ['typeList', 'objectList'];
const TYPE_KEY_LIST = ['id', 'label', 'description', 'icon', 'extendList', 'summaryKeyList', 'modeList'];
const MODE_KEY_LIST = ['id', 'label', 'description', 'category', 'comp', 'param', 'isDefault'];
const ITEM_KEY_LIST = ['id', 'entry'];

// ---------- reading ----------

// the declarations of every doc page loaded, in loading order. a type id
// declared twice is kept from the first doc page; an object id twice, the same
export function objectFrontendConfigOfDocPageListGet(
  docPageInputList: ObjectFrontendDocPageInput[],
  configDir: string,
  assetFolderByAlias: Map<string, string> = new Map(),
): ObjectFrontendConfig {
  const docPageList: ObjectFrontendDocPage[] = [];
  const fileAbsByAlias = new Map<string, string>();
  const pathList: string[] = [];
  const typeIdSet = new Set<string>();
  const objectIdSet = new Set<string>();
  for (const input of docPageInputList) {
    const section = input.objectFrontend;
    const file = section && typeof section === 'object'
      ? path.resolve(path.dirname(input.entryFile), section.file)
      : path.join(path.dirname(input.entryFile), OBJECT_FRONTEND_CONFIG_FILE_NAME);
    const docPage: ObjectFrontendDocPage = {
      isReadOnly: input.isReadOnly === true,
      alias: input.alias,
      entryFile: pathRelativeGet(input.entryFile, configDir),
      file: pathRelativeGet(file, configDir),
      isFileExists: false,
      isDisabled: section === false,
      assetFolder: assetFolderByAlias.get(input.alias) ?? '',
      typeList: [],
      objectList: [],
      problemList: [],
    };
    docPageList.push(docPage);
    if (section === false) continue;
    fileAbsByAlias.set(input.alias, file);
    pathList.push(file);
    docPage.isFileExists = fs.existsSync(file);
    if (!docPage.isFileExists) {
      if (section && typeof section === 'object') docPage.problemList.push('the file the entry names (objectFrontend.file) is not found');
      continue;
    }
    let content: any;
    try {
      content = readYaml(file) ?? {};
    } catch (error: any) {
      docPage.problemList.push(`the file does not parse: ${String(error?.message ?? error)}`);
      continue;
    }
    if (!mappingIs(content)) {
      docPage.problemList.push('the file holds a mapping { typeList, objectList }');
      continue;
    }
    for (const key of Object.keys(content)) {
      if (!TOP_KEY_LIST.includes(key)) docPage.problemList.push(`unknown key "${key}" at the top level (known: ${TOP_KEY_LIST.join(', ')})`);
    }
    docPage.typeList = typeListRead(content.typeList, docPage, typeIdSet);
    docPage.objectList = objectListRead(content.objectList, docPage, objectIdSet);
  }
  // a type extends frontend.object, or a type some doc page declares
  const typeIdDeclaredSet = new Set(docPageList.flatMap((docPage) => docPage.typeList.map((type) => type.id)));
  for (const docPage of docPageList) {
    for (const type of docPage.typeList) {
      const extendList = type.extendList.filter((parentId) => {
        if (parentId === OBJECT_FRONTEND_TYPE_ROOT || typeIdDeclaredSet.has(parentId)) return true;
        docPage.problemList.push(`the type ${type.id} extends ${parentId}, which is no frontend object type; it is left out`);
        return false;
      });
      type.extendList = extendList.length > 0 ? extendList : [OBJECT_FRONTEND_TYPE_ROOT];
    }
  }
  return { docPageList, fileAbsByAlias, pathList };
}

function typeListRead(value: unknown, docPage: ObjectFrontendDocPage, typeIdSet: Set<string>): ObjectFrontendType[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    docPage.problemList.push('"typeList" is a list of types { id, label, modeList }');
    return [];
  }
  const typeList: ObjectFrontendType[] = [];
  value.forEach((item: any, index: number) => {
    const place = `typeList[${index}]`;
    if (!mappingIs(item)) {
      docPage.problemList.push(`${place}: a type is a mapping { id, label, modeList }`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!TYPE_KEY_LIST.includes(key)) docPage.problemList.push(`${place}: unknown key "${key}" (known: ${TYPE_KEY_LIST.join(', ')})`);
    }
    const id = String(item.id ?? '');
    if (!OBJECT_FRONTEND_TYPE_ID_REGEX.test(id)) {
      docPage.problemList.push(`${place}: "id" is dotted, lowercase: {prefix}.{name} (example.reading-list)`);
      return;
    }
    const prefix = id.slice(0, id.indexOf('.'));
    if (OBJECT_FRONTEND_TYPE_PREFIX_RESERVED_LIST.includes(prefix)) {
      docPage.problemList.push(`${place}: the prefix "${prefix}" of ${id} is the page's own; choose a prefix of the doc page`);
      return;
    }
    if (typeIdSet.has(id)) {
      docPage.problemList.push(`${place}: the type ${id} is declared already; this one is left out`);
      return;
    }
    typeIdSet.add(id);
    const extendList = Array.isArray(item.extendList) ? item.extendList.map(String) : [OBJECT_FRONTEND_TYPE_ROOT];
    typeList.push({
      id,
      kind: 'object',
      label: typeof item.label === 'string' && item.label ? item.label : id,
      description: typeof item.description === 'string' ? item.description : '',
      icon: typeof item.icon === 'string' ? item.icon : '',
      extendList,
      summaryKeyList: Array.isArray(item.summaryKeyList) ? item.summaryKeyList.map(String) : [],
      modeList: modeListRead(item.modeList, `${place}.modeList`, docPage),
      definedBy: { kind: 'docPage', alias: docPage.alias, file: docPage.file },
    });
  });
  return typeList;
}

function modeListRead(value: unknown, place: string, docPage: ObjectFrontendDocPage): ObjectFrontendMode[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    docPage.problemList.push(`${place}: a list of modes { id, label, comp, param }`);
    return [];
  }
  const modeList: ObjectFrontendMode[] = [];
  value.forEach((item: any, index: number) => {
    const placeOne = `${place}[${index}]`;
    if (!mappingIs(item)) {
      docPage.problemList.push(`${placeOne}: a mode is a mapping { id, label, comp, param }`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!MODE_KEY_LIST.includes(key)) docPage.problemList.push(`${placeOne}: unknown key "${key}" (known: ${MODE_KEY_LIST.join(', ')})`);
    }
    const id = String(item.id ?? '');
    if (!OBJECT_FRONTEND_MODE_ID_REGEX.test(id)) {
      docPage.problemList.push(`${placeOne}: "id" is letters, digits, "_" and "-"`);
      return;
    }
    if (modeList.some((mode) => mode.id === id)) {
      docPage.problemList.push(`${placeOne}: the mode ${id} is declared twice; this one is left out`);
      return;
    }
    if (typeof item.comp !== 'string' || item.comp.trim() === '') {
      docPage.problemList.push(`${placeOne}: "comp" names the component that draws the mode (a tag name or an id)`);
      return;
    }
    if (item.param !== undefined && !mappingIs(item.param)) {
      docPage.problemList.push(`${placeOne}: "param" is a mapping`);
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

function objectListRead(value: unknown, docPage: ObjectFrontendDocPage, objectIdSet: Set<string>): ObjectFrontendItem[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    docPage.problemList.push('"objectList" is a list of objects { id, entry }');
    return [];
  }
  const objectList: ObjectFrontendItem[] = [];
  value.forEach((item: any, index: number) => {
    const place = `objectList[${index}]`;
    if (!mappingIs(item)) {
      docPage.problemList.push(`${place}: an object is a mapping { id, entry }`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!ITEM_KEY_LIST.includes(key)) docPage.problemList.push(`${place}: unknown key "${key}" (known: ${ITEM_KEY_LIST.join(', ')})`);
    }
    const id = String(item.id ?? '');
    const entry = String(item.entry ?? '');
    if (!idMs48Is(id) || !idMs48Is(entry)) {
      docPage.problemList.push(`${place}: "id" and "entry" are ids (the object's, its entry asset's)`);
      return;
    }
    if (objectIdSet.has(id)) {
      docPage.problemList.push(`${place}: the object ${id} is listed already; this one is left out`);
      return;
    }
    objectIdSet.add(id);
    objectList.push({ id, entry, docPageAlias: docPage.alias });
  });
  return objectList;
}

// what the page receives: the doc pages and what they declare, no absolute path
export function objectFrontendConfigForPage(config: ObjectFrontendConfig) {
  return { docPageList: config.docPageList };
}

// ---------- writing ----------
// every write reads the files again (the store and the config are created
// for the request), changes what it must, and answers the asset objects it
// wrote, so the page takes them without reading the store again

type WriteContext = { store: AssetStore; config: ObjectFrontendConfig };

export type ObjectFrontendWriteResult = {
  id: string;
  // the asset objects written or removed by the request, as they are now
  objectList: AssetObjectMeta[];
  // the config as the files say now
  config: ReturnType<typeof objectFrontendConfigForPage>;
};

// a new object of a type, in a doc page: its group folder and its entry
// asset in the asset folder of the doc page, then the line in its yaml file
// (made when missing). the yaml is written last: it is what makes the object
// exist; when it fails the entry asset is deleted again (softly)
export function objectFrontendCreate(
  context: WriteContext,
  input: { docPageAlias: string; typeId: string; name: string; description?: string; metadata?: Record<string, unknown> },
): ObjectFrontendWriteResult {
  const { store, config } = context;
  const docPage = docPageWritableGet(config, input.docPageAlias);
  if (!docPage.assetFolder) throw new AssetError(-1, `the doc page ${docPage.alias} has no asset folder for the assets of its objects`);
  const typeId = String(input.typeId || OBJECT_FRONTEND_TYPE_ROOT);
  if (typeId !== OBJECT_FRONTEND_TYPE_ROOT && !config.docPageList.some((item) => item.typeList.some((type) => type.id === typeId))) {
    throw new AssetError(-1, `no doc page declares the type ${typeId}`);
  }
  const name = nameNormalize(input.name);
  const idUsedSet = new Set(config.docPageList.flatMap((item) => item.objectList.map((object) => object.id)));
  const id = idMs48Create((idOne: string) => idUsedSet.has(idOne));
  const ref = objectFrontendRefBuild(id);
  const entryText = objectFrontendEntryTextBuild({
    name, type: typeId, description: input.description ?? '', assetList: [], metadata: input.metadata ?? {},
  });
  const { object } = store.objectCreate({
    lang: 'yaml',
    data: Buffer.from(entryText, 'utf-8'),
    note: `the entry of the frontend object ${name || id}`,
    folder: docPage.assetFolder,
    groupPath: objectDirNameBuild(id, name),
    owner: { ref, role: OBJECT_FRONTEND_ROLE_ENTRY },
  });
  try {
    configItemAdd(context, docPage.alias, { id, entry: object.objectId });
  } catch (error) {
    store.objectDelete(object.objectId);
    throw error;
  }
  return writeResultBuild(context, id, [store.objectGet(object.objectId)]);
}

// an orphan entry (an entry asset whose object no doc page lists: its line
// was removed by hand) listed again, in the doc page named
export function objectFrontendRegister(context: WriteContext, input: { docPageAlias: string; entry: string }): ObjectFrontendWriteResult {
  const { store } = context;
  const object = store.objectGet(String(input.entry ?? ''));
  const id = objectIdOfOwnerGet(object, OBJECT_FRONTEND_ROLE_ENTRY);
  if (!id) throw new AssetError(-1, `the asset ${object.objectId} is not the entry of a frontend object (owner.role entry)`);
  if (itemFind(context.config, id)) throw new AssetError(-1, `the object ${id} is listed already`);
  docPageWritableGet(context.config, input.docPageAlias);
  configItemAdd(context, input.docPageAlias, { id, entry: object.objectId });
  return writeResultBuild(context, id, []);
}

// an object removed: its line leaves the yaml file first (it no longer
// exists), then its assets are deleted (softly: their files stay, and a
// restore of the entry with the line written again brings it back), or kept
// with isAssetKept (they still declare the object: an orphan entry)
export function objectFrontendDelete(context: WriteContext, input: { id: string; isAssetKept?: boolean }): ObjectFrontendWriteResult {
  const { store } = context;
  const item = itemGet(context.config, input.id);
  configItemRemove(context, item);
  const objectList: AssetObjectMeta[] = [];
  if (input.isAssetKept !== true) {
    const ref = objectFrontendRefBuild(item.id);
    for (const meta of store.objectList()) {
      if (meta.isDeleted || meta.owner?.ref !== ref || meta.isLocked) continue;
      objectList.push(store.objectDelete(meta.objectId));
    }
  }
  return writeResultBuild(context, item.id, objectList);
}

// the name, description, type and metadata of an object, in its entry; a new
// name renames its group folder ({id}--{name}) with everything in it
export function objectFrontendMetaSet(
  context: WriteContext,
  input: { id: string; name?: string; description?: string; typeId?: string; metadata?: Record<string, unknown> },
): ObjectFrontendWriteResult {
  const { store } = context;
  const item = itemGet(context.config, input.id);
  const { meta, entry, hash } = entryRead(store, item);
  if (input.typeId !== undefined && input.typeId !== OBJECT_FRONTEND_TYPE_ROOT
    && !context.config.docPageList.some((docPage) => docPage.typeList.some((type) => type.id === input.typeId))) {
    throw new AssetError(-1, `no doc page declares the type ${input.typeId}`);
  }
  if (input.metadata !== undefined && !mappingIs(input.metadata)) throw new AssetError(-1, 'metadata is a mapping');
  const nameNext = input.name === undefined ? entry.name : nameNormalize(input.name);
  const entryNext = {
    ...entry,
    name: nameNext,
    description: input.description ?? entry.description,
    type: input.typeId ?? entry.type,
    metadata: input.metadata ?? entry.metadata,
  };
  store.objectUpdate({ objectId: meta.objectId, hashBase: hash, data: Buffer.from(objectFrontendEntryTextBuild(entryNext), 'utf-8'), mode: 'inPlace' });
  if (nameNext !== entry.name && groupIsOwn(meta, item.id)) {
    store.groupMove(meta.folder, meta.groupPath, groupPathRenamed(meta.groupPath, objectDirNameBuild(item.id, nameNext)));
  }
  return writeResultBuild(context, item.id, store.objectList().filter((one) => one.owner?.ref === objectFrontendRefBuild(item.id)));
}

// a new asset of an object: created in its group folder, declaring the
// object, then listed in the entry under a key unique in the object
export function objectFrontendAssetCreate(
  context: WriteContext,
  input: {
    id: string; key?: string; kind?: string; name?: string; pathList?: unknown; lang?: string; text: string; note?: string;
    saveMode?: 'inPlace' | 'newVersion';
  },
): ObjectFrontendWriteResult & { key: string; objectId: string } {
  const { store } = context;
  const item = itemGet(context.config, input.id);
  const { meta, entry, hash } = entryRead(store, item);
  const kind = String(input.kind ?? '');
  if (input.key !== undefined && input.key !== '' && !OBJECT_FRONTEND_KEY_REGEX.test(input.key)) {
    throw new AssetError(-1, 'a key is letters, digits, "_", "-" and "."');
  }
  const key = objectFrontendAssetKeyFree(entry, input.key ?? '', kind);
  if (!key) throw new AssetError(-1, `the object has an asset of the key ${input.key} already`);
  const naming = assetNamingRead(entry, '', input);
  const { object } = store.objectCreate({
    lang: String(input.lang ?? 'yaml'),
    data: Buffer.from(String(input.text ?? ''), 'utf-8'),
    note: input.note ?? `${kind || 'an asset'} of the frontend object ${entry.name || item.id}`,
    folder: meta.folder,
    groupPath: groupIsOwn(meta, item.id) ? meta.groupPath : objectDirNameBuild(item.id, entry.name),
    owner: { ref: objectFrontendRefBuild(item.id) },
    saveMode: input.saveMode,
  });
  const entryNext = { ...entry, assetList: [...entry.assetList, { key, kind, objectId: object.objectId, ...naming }] };
  try {
    store.objectUpdate({ objectId: meta.objectId, hashBase: hash, data: Buffer.from(objectFrontendEntryTextBuild(entryNext), 'utf-8'), mode: 'inPlace' });
  } catch (error) {
    store.objectDelete(object.objectId);
    throw error;
  }
  return { ...writeResultBuild(context, item.id, [store.objectGet(object.objectId), store.objectGet(meta.objectId)]), key, objectId: object.objectId };
}

// an asset taken out of an object: out of the entry's list, then deleted
// (softly), or, with isAssetKept, released (its owner removed, its folder
// moved to the top of the asset folder)
export function objectFrontendAssetRemove(
  context: WriteContext,
  input: { id: string; key?: string; objectId?: string; isAssetKept?: boolean },
): ObjectFrontendWriteResult {
  const { store } = context;
  const item = itemGet(context.config, input.id);
  const { meta, entry, hash } = entryRead(store, item);
  const asset = entry.assetList.find((one) => (input.key ? one.key === input.key : one.objectId === input.objectId));
  const objectId = asset?.objectId ?? String(input.objectId ?? '');
  if (asset) {
    const entryNext = { ...entry, assetList: entry.assetList.filter((one) => one !== asset) };
    store.objectUpdate({ objectId: meta.objectId, hashBase: hash, data: Buffer.from(objectFrontendEntryTextBuild(entryNext), 'utf-8'), mode: 'inPlace' });
  }
  const objectList = [store.objectGet(meta.objectId)];
  if (objectId && idMs48Is(objectId)) {
    const assetMeta = store.objectGet(objectId);
    if (assetMeta.owner?.ref === objectFrontendRefBuild(item.id)) {
      if (input.isAssetKept === true) {
        store.objectMetaSet(objectId, { owner: null });
        objectList.push(store.objectMove(objectId, { groupPath: '' }));
      } else if (!assetMeta.isDeleted) {
        objectList.push(store.objectDelete(objectId));
      }
    }
  } else if (!asset) {
    throw new AssetError(-3, `the object has no asset ${input.key ?? input.objectId}`);
  }
  return writeResultBuild(context, item.id, objectList);
}

// an asset of the store made an asset of an object: it declares the object,
// moves into its group folder, and is listed in the entry. an asset that
// declares the object already (a stray: not listed) is only listed
export function objectFrontendAssetAttach(
  context: WriteContext,
  input: { id: string; objectId: string; key?: string; kind?: string; name?: string; pathList?: unknown },
): ObjectFrontendWriteResult {
  const { store } = context;
  const item = itemGet(context.config, input.id);
  const { meta, entry, hash } = entryRead(store, item);
  if (entry.assetList.some((one) => one.objectId === input.objectId)) throw new AssetError(-1, 'the asset is an asset of the object already');
  const assetMeta = store.objectGet(String(input.objectId ?? ''));
  const ref = objectFrontendRefBuild(item.id);
  if (assetMeta.owner && assetMeta.owner.ref !== ref) throw new AssetError(-1, `the asset belongs to ${assetMeta.owner.ref}`);
  if (assetMeta.objectId === meta.objectId) throw new AssetError(-1, 'the entry is not one of the assets it lists');
  const kind = String(input.kind ?? '');
  const key = objectFrontendAssetKeyFree(entry, input.key ?? '', kind);
  if (!key) throw new AssetError(-1, `the object has an asset of the key ${input.key} already`);
  const naming = assetNamingRead(entry, '', input);
  if (!assetMeta.owner) store.objectMetaSet(assetMeta.objectId, { owner: { ref } });
  if (assetMeta.folder === meta.folder && groupIsOwn(meta, item.id) && assetMeta.groupPath !== meta.groupPath) {
    store.objectMove(assetMeta.objectId, { groupPath: meta.groupPath });
  }
  const entryNext = { ...entry, assetList: [...entry.assetList, { key, kind, objectId: assetMeta.objectId, ...naming }] };
  store.objectUpdate({ objectId: meta.objectId, hashBase: hash, data: Buffer.from(objectFrontendEntryTextBuild(entryNext), 'utf-8'), mode: 'inPlace' });
  return writeResultBuild(context, item.id, [store.objectGet(assetMeta.objectId), store.objectGet(meta.objectId)]);
}

// how an asset of an object is named and indexed, in its entry: its name,
// its paths (replaced whole; [] removes them), its kind. a path another
// asset of the object has is refused
export function objectFrontendAssetMetaSet(
  context: WriteContext,
  input: { id: string; key: string; name?: string | null; pathList?: unknown; kind?: string },
): ObjectFrontendWriteResult {
  const { store } = context;
  const item = itemGet(context.config, input.id);
  const { meta, entry, hash } = entryRead(store, item);
  const asset = entry.assetList.find((one) => one.key === input.key);
  if (!asset) throw new AssetError(-3, `the object has no asset ${input.key}`);
  const naming = assetNamingRead(entry, asset.key, { name: input.name === null ? '' : input.name ?? asset.name, pathList: input.pathList ?? asset.pathList ?? [] });
  const assetNext: any = { key: asset.key, kind: input.kind ?? asset.kind, objectId: asset.objectId, ...naming };
  const entryNext = { ...entry, assetList: entry.assetList.map((one) => (one === asset ? assetNext : one)) };
  store.objectUpdate({ objectId: meta.objectId, hashBase: hash, data: Buffer.from(objectFrontendEntryTextBuild(entryNext), 'utf-8'), mode: 'inPlace' });
  return writeResultBuild(context, item.id, [store.objectGet(meta.objectId)]);
}

// { name?, pathList? } of an asset as a write gives them: the name trimmed,
// the paths in their canonical form, each once, none another asset of the
// object (other than keyOwn) has
function assetNamingRead(entry: any, keyOwn: string, input: { name?: unknown; pathList?: unknown }): { name?: string; pathList?: string[] } {
  const naming: { name?: string; pathList?: string[] } = {};
  const name = String(input.name ?? '').trim();
  if (name.length > 200) throw new AssetError(-1, 'the name of an asset is at most 200 characters');
  if (name) naming.name = name;
  if (input.pathList === undefined || input.pathList === null) return naming;
  if (!Array.isArray(input.pathList)) throw new AssetError(-1, 'pathList is a list of paths (/kind/...)');
  const pathList: string[] = [];
  for (const pathText of input.pathList) {
    const { path, message } = objectFrontendAssetPathNormalize(pathText);
    if (message) throw new AssetError(-1, `the path ${JSON.stringify(pathText)}: ${message}`);
    if (!path || pathList.includes(path)) continue;
    const owner = entry.assetList.find((one: any) => one.key !== keyOwn && (one.pathList ?? []).includes(path));
    if (owner) throw new AssetError(-1, `the path ${path} is the path of ${owner.name || owner.key} already`);
    pathList.push(path);
  }
  if (pathList.length > 0) naming.pathList = pathList;
  return naming;
}

// ---------- helpers ----------

function writeResultBuild(context: WriteContext, id: string, objectList: AssetObjectMeta[]): ObjectFrontendWriteResult {
  return { id, objectList, config: objectFrontendConfigForPage(context.config) };
}

function docPageWritableGet(config: ObjectFrontendConfig, alias: string): ObjectFrontendDocPage {
  const docPage = config.docPageList.find((item) => item.alias === alias);
  if (!docPage) throw new AssetError(-3, `not a doc page of this page: ${alias}`);
  if (docPage.isDisabled) throw new AssetError(-1, `the doc page ${alias} has no frontend objects (objectFrontend: false of its entry)`);
  if (docPage.isReadOnly) throw new AssetError(-4, `the frontend objects of the doc page ${alias} are read-only: it is a package`);
  return docPage;
}

function itemFind(config: ObjectFrontendConfig, id: string): ObjectFrontendItem | undefined {
  for (const docPage of config.docPageList) {
    const item = docPage.objectList.find((one) => one.id === id);
    if (item) return item;
  }
  return undefined;
}

function itemGet(config: ObjectFrontendConfig, id: string): ObjectFrontendItem {
  const item = itemFind(config, String(id ?? ''));
  if (!item) throw new AssetError(-3, `no doc page lists the frontend object ${String(id)}`);
  return item;
}

// the entry asset of an object with its head: what it says, and the hash a write starts from
function entryRead(store: AssetStore, item: ObjectFrontendItem) {
  const meta = store.objectGet(item.entry);
  if (meta.isDeleted) throw new AssetError(-1, `the entry asset ${meta.objectId} of the object ${item.id} is deleted; restore it first`);
  const head = store.versionDataGetOf(meta, 'head');
  if (!head.isText) throw new AssetError(-1, `the entry asset ${meta.objectId} is not text`);
  const { entry } = objectFrontendEntryParse(head.text ?? '');
  return { meta, entry, hash: head.hash };
}

// the id of the object an asset declares, with the role asked for ('' when none)
function objectIdOfOwnerGet(meta: AssetObjectMeta, role: string): string {
  const ref = meta.owner?.ref ?? '';
  if (!ref.startsWith('frontend:') || (meta.owner?.role ?? '') !== role) return '';
  return ref.slice('frontend:'.length);
}

// the entry is in the group folder of its object ({id} or {id}--{name}, the last folder of its group path)
function groupIsOwn(meta: AssetObjectMeta, id: string): boolean {
  const groupLast = meta.groupPath.split('/').pop() ?? '';
  return groupLast === id || groupLast.startsWith(`${id}--`);
}

function groupPathRenamed(groupPath: string, groupNameNext: string): string {
  const partList = groupPath.split('/');
  partList[partList.length - 1] = groupNameNext;
  return partList.join('/');
}

// the line of an object added to the objectList of the doc page's file, in
// place; a file that does not exist is written with the line
function configItemAdd(context: WriteContext, alias: string, item: { id: string; entry: string }) {
  const file = context.config.fileAbsByAlias.get(alias);
  if (!file) throw new AssetError(-1, `the doc page ${alias} has no frontend object file`);
  const lineList = [`- id: ${item.id}`, `  entry: ${item.entry}`];
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fileWriteSafe(file, [
      '# the frontend objects of this doc page and their types (doc_page_impl_obj_frontend.md)',
      'typeList: []',
      'objectList:',
      ...lineList.map((line) => `  ${line}`),
      '',
    ].join('\n'));
    return;
  }
  const source = fs.readFileSync(file, 'utf-8');
  const document = parseDocument(source);
  if (document.errors.length > 0) throw new AssetError(-1, `${alias}: the file does not parse: ${document.errors[0].message}`);
  let textNext: string;
  if (document.contents === null) {
    textNext = `${source}${source === '' || source.endsWith('\n') ? '' : '\n'}objectList:\n${lineList.map((line) => `  ${line}`).join('\n')}\n`;
  } else {
    const result = yamlSeqItemInsertBuild(source, document, ['objectList'], -1, lineList, 0);
    if (result.code !== 0) throw new AssetError(-1, `${alias}: the object is not added to the file: ${result.message}`);
    textNext = lineOperationListApply(source, result.data.operationList);
  }
  fileWriteWithBackup(file, source, textNext);
}

function configItemRemove(context: WriteContext, item: ObjectFrontendItem) {
  const file = context.config.fileAbsByAlias.get(item.docPageAlias);
  if (!file || !fs.existsSync(file)) throw new AssetError(-3, `the file of the doc page ${item.docPageAlias} is not found`);
  const source = fs.readFileSync(file, 'utf-8');
  const document = parseDocument(source);
  if (document.errors.length > 0) throw new AssetError(-1, `the file does not parse: ${document.errors[0].message}`);
  const seq: any = document.getIn(['objectList'], true);
  const index = (seq?.items ?? []).findIndex((node: any) => String(node?.get?.('id') ?? '') === item.id);
  if (index < 0) throw new AssetError(-3, `the file does not list the object ${item.id}`);
  const result = yamlSeqItemRemoveBuild(source, document, ['objectList'], index);
  if (result.code !== 0) throw new AssetError(-1, `the object is not removed from the file: ${result.message}`);
  fileWriteWithBackup(file, source, lineOperationListApply(source, result.data.operationList));
}

function fileWriteWithBackup(file: string, textBefore: string, textNext: string) {
  fs.writeFileSync(`${file}.bak`, textBefore);
  fileWriteSafe(file, textNext);
}

function pathRelativeGet(filePath: string, configDir: string): string {
  return path.relative(configDir, filePath).split(path.sep).join('/');
}

function mappingIs(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
