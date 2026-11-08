import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument, stringify as yamlStringify } from 'yaml';
import { readYaml, type EntryFileSection } from './doc-entry.ts';
import { TYPE_CONFIG_FILE_NAME, typeDeclaredIsFrontend, type TypeDeclared } from './doc-type-config.ts';
import { idMs48Create, idMs48Is } from './id-ms48.ts';
import { lineOperationListApply } from './doc-edit-lines.ts';
import { yamlSeqItemInsertBuild, yamlSeqItemRemoveBuild } from './doc-yaml-edit.ts';
import {
  ASSET_GROUP_DEPTH_MAX, ASSET_ITEM_META_NAME, AssetError, fileWriteSafe, groupPathNormalize, itemDirNameBuild, itemIdFromDirName, nameNormalize,
  type AssetItemMeta, type AssetOwner, type AssetStore,
} from './doc-asset-store.ts';
import {
  OBJECT_FRONTEND_CONFIG_FILE_NAME, OBJECT_FRONTEND_FOLDER_NAME, OBJECT_FRONTEND_ITEM_FOLDER_NAME, OBJECT_FRONTEND_KEY_REGEX, OBJECT_FRONTEND_LIST_NAME, OBJECT_FRONTEND_META_NAME,
  OBJECT_FRONTEND_PARTITION_REGEX, OBJECT_FRONTEND_ROLE_ENTRY, OBJECT_FRONTEND_TYPE_ROOT,
  objectFrontendAssetAcceptCheck, objectFrontendAssetKeyFree, objectFrontendAssetKindListResolve, objectFrontendAssetListMerge, objectFrontendAssetPathNormalize,
  objectFrontendEntryParse, objectFrontendEntryTextBuild, objectFrontendListCovers, objectFrontendListGroupPathGet, objectFrontendListParse, objectFrontendListTextBuild, objectFrontendRefBuild,
  objectFrontendPartitionGroupPathBuild, objectFrontendPartitionListResolve,
} from '../src/lib/doc-object-frontend.js';
import { assetPathCompile } from '../src/lib/doc-object-frontend-asset-path.js';

// The frontend object service layer on the development server (design:
// doc_page_impl_obj_frontend.md). The page keeps the objects; the server
// reads what the doc pages declare and makes the structural writes, each in
// one request so that the files never say half of a change:
//
//   .doc-page/object-frontend.yaml     read when it exists (the convention)
//   entry "objectFrontend: { file }"   another file, relative to the entry
//   entry "objectFrontend: false"      the doc page has no frontend objects
//
//   folderList: [./object-frontend]    the folders holding its object folders (this one by default;
//                                      relative to the file; the first is where a new object goes)
//   objectList:                        objects whose items lie in an asset folder of the doc page,
//     - id: w5a1b2c3d4e                  not in a folder of their own; its id: the reference is frontend:{id}
//       entry: w5a1b2c3d5f             the item id of its entry asset
//
// an object has a folder of its own, by convention in .doc-page/object-frontend/, and
// is what that folder says; a copy of the folder is a copy of the object
// (doc_page_impl_dir.md#frontend-objects):
//
//   {id}--{name}/                      in ASCII; follows the name of the object
//     object.yaml                      id, entry; isDeleted (the object was deleted, its files stay)
//     type.yaml                        optional: types that travel with it (doc-type-config.ts)
//     item/                            its asset items: a folder of the asset store owned by the
//                                      object, the entry among them, at any depth in folders of its own;
//                                      each declares the object in its owner
//       item-list.yaml                 the item lists: in item/ or a folder inside it, each listing the
//       {folder}/item-list.yaml          assets lying there and below (an object without a folder of its
//                                      own lists them in its entry, assetList)
//
// the lists say what belongs to an object: not the folder, not the owner of an item. every write
// here keeps the three in agreement, a record in the list nearest to its item, and what disagrees
// because somebody worked on the files is reported by the page, never repaired unasked
// (doc_page_impl_obj_frontend.md#how-an-asset-comes-to-belong).
//
// the yaml files of the doc page and object.yaml are written in place (doc-yaml-edit.ts), with a
// .bak beside them; an item list is data the layer keeps, written whole.
//
// every problem of a file is reported with the file ([doc-object-frontend])
// and skips the item, never the page.

// one object a doc page declares; dir: its folder relative to the config
// directory ('' when it is listed in objectList); listList: its item lists, as read
export type ObjectFrontendDecl = { id: string; entry: string; docPageAlias: string; dir: string; listList: ObjectFrontendList[] };

// an item list: where it lies in the item folder ('' its top), its records, what could not be read
export type ObjectFrontendList = { groupPath: string; assetList: any[]; problemList: string[] };

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
  objectList: ObjectFrontendDecl[];
  // the objects deleted with their files kept (isDeleted of their object.yaml), by id
  objectIdDeletedList: string[];
  problemList: string[];
};

export type ObjectFrontendConfig = {
  docPageList: ObjectFrontendDocPage[];
  // the declared types (doc-type-config.ts): what the writes check; not sent to the page, which has them
  typeList: TypeDeclared[];
  // absolute, by alias: the file of each doc page (not sent to the page)
  fileAbsByAlias: Map<string, string>;
  // absolute: the files to watch
  pathList: string[];
  // absolute: the folders holding object folders, whether they exist or not
  folderList: string[];
  // absolute, by alias: where a new object of the doc page goes
  folderNewByAlias: Map<string, string>;
  // absolute, by id: the folder of an object that has one, deleted ones too (not sent to the page)
  objectDirAbsById: Map<string, string>;
};

export type ObjectFrontendDocPageInput = { alias: string; entryFile: string; objectFrontend?: EntryFileSection; isReadOnly?: boolean };

const TOP_KEY_LIST = ['objectList', 'folderList'];
const META_KEY_LIST = ['id', 'entry', 'isDeleted'];
const TYPE_LIST_MOVED_MESSAGE = 'types are declared in type.yaml now and this "typeList" is not read: run "react-doc migrate" (doc_page_impl_type.md#declaring-a-type)';
const ITEM_KEY_LIST = ['id', 'entry'];

// ---------- reading ----------

// the declarations of every doc page loaded, in loading order. a type id
// declared twice is kept from the first doc page; an object id twice, the same
export function objectFrontendConfigOfDocPageListGet(
  docPageInputList: ObjectFrontendDocPageInput[],
  configDir: string,
  assetFolderByAlias: Map<string, string> = new Map(),
  typeList: TypeDeclared[] = [],
): ObjectFrontendConfig {
  const docPageList: ObjectFrontendDocPage[] = [];
  const fileAbsByAlias = new Map<string, string>();
  const pathList: string[] = [];
  const folderList: string[] = [];
  const folderNewByAlias = new Map<string, string>();
  const objectDirAbsById = new Map<string, string>();
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
      objectList: [],
      objectIdDeletedList: [],
      problemList: [],
    };
    docPageList.push(docPage);
    if (section === false) continue;
    fileAbsByAlias.set(input.alias, file);
    pathList.push(file);
    const content = configFileRead(file, docPage, section);
    if (content) {
      for (const key of Object.keys(content)) {
        if (key === 'typeList') docPage.problemList.push(TYPE_LIST_MOVED_MESSAGE);
        else if (!TOP_KEY_LIST.includes(key)) docPage.problemList.push(`unknown key "${key}" at the top level (known: ${TOP_KEY_LIST.join(', ')})`);
      }
      docPage.objectList = objectListRead(content.objectList, docPage, objectIdSet);
    }
    const folderListOfPage = objectFolderListRead(content?.folderList, file, input.entryFile, docPage);
    folderList.push(...folderListOfPage);
    folderNewByAlias.set(input.alias, folderListOfPage[0]);
    for (const folder of folderListOfPage) {
      for (const meta of objectDirListRead(folder, docPage)) {
        pathList.push(meta.file);
        if (objectIdSet.has(meta.id)) {
          docPage.problemList.push(`${meta.dirRelative}: the object ${meta.id} is listed already; this one is left out`);
          continue;
        }
        objectIdSet.add(meta.id);
        objectDirAbsById.set(meta.id, meta.dirAbs);
        if (meta.content.isDeleted === true) {
          docPage.objectIdDeletedList.push(meta.id);
          continue;
        }
        const listList = objectListListRead(path.join(meta.dirAbs, OBJECT_FRONTEND_ITEM_FOLDER_NAME));
        for (const list of listList) pathList.push(listFileGet(path.join(meta.dirAbs, OBJECT_FRONTEND_ITEM_FOLDER_NAME), list.groupPath));
        docPage.objectList.push({ id: meta.id, entry: meta.entry, docPageAlias: docPage.alias, dir: pathRelativeGet(meta.dirAbs, configDir), listList });
      }
    }
  }
  return { docPageList, typeList, fileAbsByAlias, pathList, folderList, folderNewByAlias, objectDirAbsById };
}

// the mapping of the doc page's file; undefined when it has none or it says nothing usable
function configFileRead(file: string, docPage: ObjectFrontendDocPage, section: EntryFileSection | undefined): Record<string, any> | undefined {
  docPage.isFileExists = fs.existsSync(file);
  if (!docPage.isFileExists) {
    if (section && typeof section === 'object') docPage.problemList.push('the file the entry names (objectFrontend.file) is not found');
    return undefined;
  }
  try {
    const content = readYaml(file) ?? {};
    if (mappingIs(content)) return content;
    docPage.problemList.push('the file holds a mapping { objectList, folderList }');
  } catch (error: any) {
    docPage.problemList.push(`the file does not parse: ${String(error?.message ?? error)}`);
  }
  return undefined;
}

// the folders holding the object folders of a doc page: the convention beside
// the entry, or folderList of its file, relative to the file
function objectFolderListRead(value: unknown, file: string, entryFile: string, docPage: ObjectFrontendDocPage): string[] {
  const folderConvention = path.join(path.dirname(entryFile), OBJECT_FRONTEND_FOLDER_NAME);
  if (value === undefined || value === null) return [folderConvention];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    docPage.problemList.push('"folderList" is a list of folders, relative to the file; the folder of the convention is used');
    return [folderConvention];
  }
  return [...new Set(value.map((item: string) => path.resolve(path.dirname(file), item)))];
}

// the object folders found in a folder: each {id}(--{name}) holding object.yaml.
// a folder that is not one is reported and skipped; dot folders are never read
function objectDirListRead(folder: string, docPage: ObjectFrontendDocPage) {
  if (!fs.existsSync(folder)) return [];
  const result: { id: string; entry: string; dirAbs: string; dirRelative: string; file: string; content: Record<string, any> }[] = [];
  const dirList = fs.readdirSync(folder, { withFileTypes: true })
    .filter((one) => one.isDirectory() && !one.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const one of dirList) {
    const dirAbs = path.join(folder, one.name);
    const file = path.join(dirAbs, OBJECT_FRONTEND_META_NAME);
    const dirRelative = `${OBJECT_FRONTEND_FOLDER_NAME}/${one.name}`;
    if (!fs.existsSync(file)) {
      docPage.problemList.push(`${dirRelative}: a folder without ${OBJECT_FRONTEND_META_NAME} is no object; it is left out`);
      continue;
    }
    let content: any;
    try {
      content = readYaml(file) ?? {};
    } catch (error: any) {
      docPage.problemList.push(`${dirRelative}/${OBJECT_FRONTEND_META_NAME} does not parse: ${String(error?.message ?? error)}`);
      continue;
    }
    if (!mappingIs(content)) {
      docPage.problemList.push(`${dirRelative}/${OBJECT_FRONTEND_META_NAME} holds a mapping { id, entry }`);
      continue;
    }
    for (const key of Object.keys(content)) {
      if (key === 'typeList') docPage.problemList.push(`${dirRelative}/${OBJECT_FRONTEND_META_NAME}: ${TYPE_LIST_MOVED_MESSAGE}`);
      else if (!META_KEY_LIST.includes(key)) docPage.problemList.push(`${dirRelative}/${OBJECT_FRONTEND_META_NAME}: unknown key "${key}" (known: ${META_KEY_LIST.join(', ')})`);
    }
    const id = String(content.id ?? '');
    const entry = String(content.entry ?? '');
    if (!idMs48Is(id) || !idMs48Is(entry)) {
      docPage.problemList.push(`${dirRelative}/${OBJECT_FRONTEND_META_NAME}: "id" and "entry" are ids (the object's, its entry asset's)`);
      continue;
    }
    if (itemIdFromDirName(one.name) !== id) {
      docPage.problemList.push(`${dirRelative}: the folder name starts with another id than its object ${id}; it is left out`);
      continue;
    }
    result.push({ id, entry, dirAbs, dirRelative, file, content });
  }
  return result;
}

// the item lists of an item folder: item-list.yaml in it and in the folders inside it that are
// not items (an item is a folder holding item.yaml), as deep as the store reads groups
export function objectListListRead(itemDirAbs: string): ObjectFrontendList[] {
  const listList: ObjectFrontendList[] = [];
  const visit = (groupPath: string, depth: number) => {
    const dirAbs = path.join(itemDirAbs, ...groupPath.split('/').filter(Boolean));
    if (!fs.existsSync(dirAbs)) return;
    const file = path.join(dirAbs, OBJECT_FRONTEND_LIST_NAME);
    if (fs.existsSync(file)) {
      const { assetList, problemList } = objectFrontendListParse(fs.readFileSync(file, 'utf-8'), groupPath);
      listList.push({ groupPath, assetList, problemList });
    }
    if (depth >= ASSET_GROUP_DEPTH_MAX) return;
    for (const one of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      if (!one.isDirectory() || one.name.startsWith('.')) continue;
      if (fs.existsSync(path.join(dirAbs, one.name, ASSET_ITEM_META_NAME))) continue;
      visit(groupPath ? `${groupPath}/${one.name}` : one.name, depth + 1);
    }
  };
  visit('', 0);
  return listList;
}

function listFileGet(itemDirAbs: string, groupPath: string): string {
  return path.join(itemDirAbs, ...groupPath.split('/').filter(Boolean), OBJECT_FRONTEND_LIST_NAME);
}

// what the asset store reads for a doc page: the item folder of each object it holds,
// deleted ones too, whose items stay findable until a person removes the files
export function objectFrontendFolderOwnedListGet(input: ObjectFrontendDocPageInput): { pathAbs: string; owner: AssetOwner }[] {
  return objectDirListOfDocPageRead(input).map((meta) => ({ pathAbs: path.join(meta.dirAbs, OBJECT_FRONTEND_ITEM_FOLDER_NAME), owner: { ref: objectFrontendRefBuild(meta.id) } }));
}

// what the type registry reads for a doc page: the type.yaml of each of its objects that has one
export function objectFrontendTypeFileListGet(input: ObjectFrontendDocPageInput): string[] {
  return objectDirListOfDocPageRead(input)
    .map((meta) => path.join(meta.dirAbs, TYPE_CONFIG_FILE_NAME))
    .filter((file) => fs.existsSync(file));
}

function objectDirListOfDocPageRead(input: ObjectFrontendDocPageInput) {
  if (input.objectFrontend === false) return [];
  const section = input.objectFrontend;
  const file = section && typeof section === 'object'
    ? path.resolve(path.dirname(input.entryFile), section.file)
    : path.join(path.dirname(input.entryFile), OBJECT_FRONTEND_CONFIG_FILE_NAME);
  const docPageSilent: any = { problemList: [] };
  const content = configFileRead(file, docPageSilent, section);
  return objectFolderListRead(content?.folderList, file, input.entryFile, docPageSilent).flatMap((folder) => objectDirListRead(folder, docPageSilent));
}

function objectListRead(value: unknown, docPage: ObjectFrontendDocPage, objectIdSet: Set<string>): ObjectFrontendDecl[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    docPage.problemList.push('"objectList" is a list of objects { id, entry }');
    return [];
  }
  const objectList: ObjectFrontendDecl[] = [];
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
    objectList.push({ id, entry, docPageAlias: docPage.alias, dir: '', listList: [] });
  });
  return objectList;
}

// what the page receives: the doc pages and what they declare, no absolute path
export function objectFrontendConfigForPage(config: ObjectFrontendConfig) {
  return { docPageList: config.docPageList };
}

// ---------- writing ----------
// every write reads the files again (the store and the config are created
// for the request), changes what it must, and answers the asset items it
// wrote, so the page takes them without reading the store again

// storeGet: a store of the files as they are now, for a write that moved a store folder
type WriteContext = { store: AssetStore; config: ObjectFrontendConfig; storeGet?: () => AssetStore };

// what the layer says it is when it writes into a folder an object owns
const OBJECT_FRONTEND_LAYER = 'frontend';

export type ObjectFrontendWriteResult = {
  id: string;
  // the asset items written or removed by the request, as they are now
  itemList: AssetItemMeta[];
  // the config as the files say now
  config: ReturnType<typeof objectFrontendConfigForPage>;
};

// a new object of a type, in a doc page: its entry asset in the item folder of a new
// object folder, then object.yaml beside it. object.yaml is written last: it is what
// makes the object exist; when it fails the new folder goes away again
export function objectFrontendCreate(
  context: WriteContext,
  input: { docPageAlias: string; typeId: string; name: string; description?: string; metadata?: Record<string, unknown> },
): ObjectFrontendWriteResult {
  const { store, config } = context;
  const docPage = docPageWritableGet(config, input.docPageAlias);
  const folderNew = config.folderNewByAlias.get(docPage.alias);
  if (!docPage.assetFolder || !folderNew) throw new AssetError(-1, `the doc page ${docPage.alias} has no asset store for the assets of its objects`);
  const typeId = String(input.typeId || OBJECT_FRONTEND_TYPE_ROOT);
  if (!typeDeclaredIsFrontend(config.typeList, typeId)) throw new AssetError(-1, `the type ${typeId} is no type of a frontend object: it is not declared below ${OBJECT_FRONTEND_TYPE_ROOT}`);
  const name = nameNormalize(input.name);
  const idUsedSet = new Set(config.docPageList.flatMap((item) => [...item.objectList.map((object) => object.id), ...item.objectIdDeletedList]));
  const id = idMs48Create((idOne: string) => idUsedSet.has(idOne));
  const ref = objectFrontendRefBuild(id);
  const entryText = objectFrontendEntryTextBuild({
    name, type: typeId, description: input.description ?? '', assetList: [], metadata: input.metadata ?? {},
  });
  const dirAbs = path.join(folderNew, objectFrontendDirNameBuild(id, name, typeId));
  const folder = store.folderOwnedAdd({ pathAbs: path.join(dirAbs, OBJECT_FRONTEND_ITEM_FOLDER_NAME), owner: { ref }, docPageAlias: docPage.alias });
  try {
    const { item } = store.itemCreate({
      lang: 'yaml',
      data: Buffer.from(entryText, 'utf-8'),
      note: `the entry of the frontend object ${name || id}`,
      folder: folder.path,
      owner: { ref, role: OBJECT_FRONTEND_ROLE_ENTRY },
      asLayer: OBJECT_FRONTEND_LAYER,
    });
    fileWriteSafe(path.join(dirAbs, OBJECT_FRONTEND_META_NAME), objectFrontendMetaTextBuild({ id, entry: item.itemId }));
    return writeResultBuild(context, id, [store.itemGet(item.itemId)]);
  } catch (error) {
    fs.rmSync(dirAbs, { recursive: true, force: true });
    throw error;
  }
}

export function objectFrontendMetaTextBuild(content: { id: string; entry: string; typeList?: unknown[] }): string {
  return `# a frontend object of this doc page (doc_page_impl_obj_frontend.md#the-folder-of-an-object)\n${yamlStringify(content)}`;
}

// an orphan entry (an entry asset whose object no doc page lists: the object was
// deleted keeping its assets, or its line removed by hand) listed again: an object
// with a folder of its own is no longer marked deleted, any other gets a line in
// the doc page named
export function objectFrontendRegister(context: WriteContext, input: { docPageAlias: string; entry: string }): ObjectFrontendWriteResult {
  const { store } = context;
  const item = store.itemGet(String(input.entry ?? ''));
  const id = objectIdOfOwnerGet(item, OBJECT_FRONTEND_ROLE_ENTRY);
  if (!id) throw new AssetError(-1, `the asset ${item.itemId} is not the entry of a frontend object (owner.role entry)`);
  if (declFind(context.config, id)) throw new AssetError(-1, `the object ${id} is listed already`);
  const dirAbs = context.config.objectDirAbsById.get(id);
  if (dirAbs) {
    objectMetaDeletedSet(dirAbs, false);
    return writeResultBuild(context, id, []);
  }
  docPageWritableGet(context.config, input.docPageAlias);
  configDeclAdd(context, input.docPageAlias, { id, entry: item.itemId });
  return writeResultBuild(context, id, []);
}

// an object removed: it stops being declared first (it no longer exists: its folder
// says isDeleted, or its line leaves the yaml file), then its assets are deleted
// (softly: their files stay, and a restore of the entry with the declaration written
// again brings it back), or kept with isAssetKept (they still declare the object: an
// orphan entry). the folder of an object is removed by a person, never by the page
export function objectFrontendDelete(context: WriteContext, input: { id: string; isAssetKept?: boolean }): ObjectFrontendWriteResult {
  const { store } = context;
  const decl = declGet(context.config, input.id);
  const dirAbs = context.config.objectDirAbsById.get(decl.id);
  docPageWritableGet(context.config, decl.docPageAlias);
  if (dirAbs) objectMetaDeletedSet(dirAbs, true);
  else configDeclRemove(context, decl);
  const itemList: AssetItemMeta[] = [];
  if (input.isAssetKept !== true) {
    const ref = objectFrontendRefBuild(decl.id);
    for (const meta of store.itemList()) {
      if (meta.isDeleted || meta.owner?.ref !== ref || meta.isLocked) continue;
      itemList.push(store.itemDelete(meta.itemId));
    }
  }
  return writeResultBuild(context, decl.id, itemList);
}

// isDeleted of the object.yaml of an object's folder, line by line: the rest of the file
// (its types, its comments) stays as it was written
function objectMetaDeletedSet(dirAbs: string, isDeleted: boolean) {
  const file = path.join(dirAbs, OBJECT_FRONTEND_META_NAME);
  const source = fs.readFileSync(file, 'utf-8');
  const textKept = source.replace(/^isDeleted:.*\n?/m, '');
  fileWriteWithBackup(file, source, isDeleted ? `${textKept}${textKept === '' || textKept.endsWith('\n') ? '' : '\n'}isDeleted: true\n` : textKept);
}

// the name, description, type and metadata of an object, in its entry; a new
// name renames its folder ({id}--{name}) with everything in it
export function objectFrontendMetaSet(
  context: WriteContext,
  input: { id: string; name?: string; description?: string; typeId?: string; metadata?: Record<string, unknown> },
): ObjectFrontendWriteResult {
  const { store } = context;
  const decl = declGet(context.config, input.id);
  const { meta, entry, hash } = entryRead(store, decl);
  if (input.typeId !== undefined && !typeDeclaredIsFrontend(context.config.typeList, input.typeId)) {
    throw new AssetError(-1, `the type ${input.typeId} is no type of a frontend object: it is not declared below ${OBJECT_FRONTEND_TYPE_ROOT}`);
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
  store.itemUpdate({ itemId: meta.itemId, hashBase: hash, data: Buffer.from(objectFrontendEntryTextBuild(entryNext), 'utf-8'), mode: 'inPlace' });
  const dirAbs = context.config.objectDirAbsById.get(decl.id);
  if (nameNext !== entry.name && dirAbs) {
    fs.renameSync(dirAbs, path.join(path.dirname(dirAbs), objectFrontendDirNameBuild(decl.id, nameNext, entryNext.type)));
  } else if (nameNext !== entry.name && groupIsOwn(meta, decl.id)) {
    store.groupMove(meta.folder, meta.groupPath, groupPathRenamed(meta.groupPath, objectFrontendDirNameBuild(decl.id, nameNext, entryNext.type)), { asLayer: OBJECT_FRONTEND_LAYER });
  }
  const storeNow = context.storeGet?.() ?? store;
  return writeResultBuild(context, decl.id, storeNow.itemList().filter((one) => one.owner?.ref === objectFrontendRefBuild(decl.id)));
}

// what the type of an object accepts, or the write stops here (before anything is written)
function assetAcceptRequire(context: WriteContext, entry: any, input: { kind?: unknown; lang?: unknown; pathList?: unknown; isIncoming?: boolean }) {
  const { typeList } = context.config;
  const pathList = Array.isArray(input.pathList) ? input.pathList.map((one) => objectFrontendAssetPathNormalize(one).path) : [];
  const result = objectFrontendAssetAcceptCheck(objectFrontendAssetKindListResolve(entry.type, typeList), { ...input, pathList });
  if (result.message) throw new AssetError(-1, result.message);
  return result;
}

// a new asset of an object: created in its item folder (at groupPath, or the folder of its
// kind), declaring the object, then recorded under a key unique in the object, in the list
// nearest to where it lies
export function objectFrontendAssetCreate(
  context: WriteContext,
  input: {
    id: string; key?: string; kind?: string; name?: string; pathList?: unknown; lang?: string; text: string; note?: string;
    saveMode?: 'inPlace' | 'newVersion'; groupPath?: string; partition?: string;
  },
): ObjectFrontendWriteResult & { key: string; itemId: string } {
  const { store } = context;
  const decl = declGet(context.config, input.id);
  const listing = listingRead(context, decl);
  const { meta, entry } = listing;
  const lang = String(input.lang ?? 'yaml');
  const { kind, kindDeclared } = assetAcceptRequire(context, entry, { kind: input.kind, lang, pathList: input.pathList });
  if (input.key !== undefined && input.key !== '' && !OBJECT_FRONTEND_KEY_REGEX.test(input.key)) {
    throw new AssetError(-1, 'a key is letters, digits, "_", "-" and "."');
  }
  const key = objectFrontendAssetKeyFree(listing, input.key ?? '', kind);
  if (!key) throw new AssetError(-1, `the object has an asset of the key ${input.key} already`);
  const naming = assetNamingRead(listing.assetList, '', input);
  const groupPath = partitionPlaceRequire(context, listing, input.partition, input.groupPath ?? kindDeclared?.groupPath);
  const place = itemPlaceOfObjectGet(store, decl, meta, entry, groupPath);
  const { item } = store.itemCreate({
    lang,
    data: Buffer.from(String(input.text ?? ''), 'utf-8'),
    note: input.note ?? `${kind || 'an asset'} of the frontend object ${entry.name || decl.id}`,
    folder: place.folder,
    groupPath: place.groupPath,
    owner: { ref: objectFrontendRefBuild(decl.id) },
    saveMode: input.saveMode,
    asLayer: OBJECT_FRONTEND_LAYER,
  });
  const record = { key, kind, itemId: item.itemId, ...naming, listGroupPath: listGroupPathFor(listing, place.groupPath) };
  try {
    listingWrite(store, listing, [...listing.assetList, record]);
  } catch (error) {
    store.itemDelete(item.itemId);
    throw error;
  }
  return { ...writeResultBuild(context, decl.id, [store.itemGet(item.itemId), store.itemGet(meta.itemId)]), key, itemId: item.itemId };
}

// an asset taken out of an object, or an item of its folder sent away (named by itemId: it is
// not listed): off its list, then deleted (softly), or, with isAssetKept, released (its owner
// removed, its folder moved to folder and groupPath, by default the top of the default asset
// folder of the doc page). what declares another object is only moved out
export function objectFrontendAssetRemove(
  context: WriteContext,
  input: { id: string; key?: string; itemId?: string; isAssetKept?: boolean; folder?: string; groupPath?: string },
): ObjectFrontendWriteResult {
  const { store } = context;
  const decl = declGet(context.config, input.id);
  const listing = listingRead(context, decl);
  const { meta } = listing;
  const asset = listing.assetList.find((one: any) => (input.key ? one.key === input.key : one.itemId === input.itemId));
  const itemId = asset?.itemId ?? String(input.itemId ?? '');
  if (!asset && !(itemId && idMs48Is(itemId))) throw new AssetError(-3, `the object has no asset ${input.key ?? input.itemId}`);
  if (itemId === meta.itemId) throw new AssetError(-1, 'the entry of an object does not leave it; delete the object');
  if (asset) listingWrite(store, listing, listing.assetList.filter((one: any) => one !== asset));
  const itemList = [store.itemGet(meta.itemId)];
  if (!idMs48Is(itemId)) return writeResultBuild(context, decl.id, itemList);
  let assetMeta: AssetItemMeta;
  try {
    assetMeta = store.itemGet(itemId);
  } catch (error) {
    // listed and gone from the store: taking it off the list was all there was to do
    if (asset && error instanceof AssetError && error.code === -3) return writeResultBuild(context, decl.id, itemList);
    throw error;
  }
  const ref = objectFrontendRefBuild(decl.id);
  const isDeclaring = assetMeta.owner?.ref === ref;
  const isInFolder = assetMeta.folderOwner?.ref === ref;
  if (!isDeclaring && !isInFolder) {
    if (asset) return writeResultBuild(context, decl.id, itemList);
    throw new AssetError(-1, `the item ${itemId} is neither an asset of this object nor in its folder`);
  }
  if (input.isAssetKept === true) {
    if (isDeclaring) store.itemMetaSet(itemId, { owner: null });
    const docPage = context.config.docPageList.find((one) => one.alias === decl.docPageAlias);
    const folder = input.folder || docPage?.assetFolder || undefined;
    itemList.push(store.itemMove(itemId, { groupPath: input.groupPath ?? '', folder, asLayer: OBJECT_FRONTEND_LAYER }));
  } else {
    if (assetMeta.owner && !isDeclaring) throw new AssetError(-1, `the item ${itemId} declares ${assetMeta.owner.ref}: move it out, it is not this object's to delete`);
    if (!assetMeta.isDeleted) itemList.push(store.itemDelete(itemId));
  }
  return writeResultBuild(context, decl.id, itemList);
}

// an item of the store made an asset of an object: what comes in, through the one door. the
// type says whether it takes it; then the item declares the object, moves into its folder, and
// is recorded in the list nearest to where it lies, which is what makes it belong. covers an
// item coming from elsewhere, a stray (it declares the object, the lists lost it), and an item
// of unknown source (found in the folder, declaring nothing). an item of another object comes
// only with isOwnerReplaced
export function objectFrontendAssetAttach(
  context: WriteContext,
  input: { id: string; itemId: string; key?: string; kind?: string; name?: string; pathList?: unknown; groupPath?: string; partition?: string; isOwnerReplaced?: boolean },
): ObjectFrontendWriteResult {
  const { store } = context;
  const decl = declGet(context.config, input.id);
  const listing = listingRead(context, decl);
  const { meta, entry } = listing;
  if (listing.assetList.some((one: any) => one.itemId === input.itemId)) throw new AssetError(-1, 'the item is an asset of the object already');
  const assetMeta = store.itemGet(String(input.itemId ?? ''));
  const ref = objectFrontendRefBuild(decl.id);
  if (assetMeta.itemId === meta.itemId) throw new AssetError(-1, 'the entry is not one of the assets it lists');
  if (assetMeta.isLocked) throw new AssetError(-1, 'the item is locked: unlock it first');
  if (assetMeta.isDeleted) throw new AssetError(-1, 'the item is deleted: restore it first');
  if (assetMeta.owner?.role === OBJECT_FRONTEND_ROLE_ENTRY) throw new AssetError(-1, `the item is the entry of ${assetMeta.owner.ref}`);
  const ownerOther = assetMeta.owner && assetMeta.owner.ref !== ref ? assetMeta.owner.ref : '';
  if (ownerOther && input.isOwnerReplaced !== true) throw new AssetError(-1, `the item belongs to ${ownerOther}: it is taken from there with isOwnerReplaced`);
  const { kind, kindDeclared } = assetAcceptRequire(context, entry, { kind: input.kind, lang: assetMeta.lang, pathList: input.pathList, isIncoming: true });
  const key = objectFrontendAssetKeyFree(listing, input.key ?? '', kind);
  if (!key) throw new AssetError(-1, `the object has an asset of the key ${input.key} already`);
  const naming = assetNamingRead(listing.assetList, '', input);
  // an item already in the folder keeps its place unless a place is named; the place is checked
  // before anything is written
  const isInFolder = assetMeta.folderOwner?.ref === ref;
  const isPlaced = !isInFolder || input.groupPath !== undefined || input.partition !== undefined;
  const groupPathPlaced = isPlaced ? partitionPlaceRequire(context, listing, input.partition, input.groupPath ?? kindDeclared?.groupPath) : '';
  const declOther = ownerOther ? declFind(context.config, ownerOther.slice('frontend:'.length)) : undefined;
  if (declOther) assetListRemove(context, declOther, assetMeta.itemId);
  if (assetMeta.owner?.ref !== ref) store.itemMetaSet(assetMeta.itemId, { owner: { ref } });
  let groupPathNow = assetMeta.groupPath;
  if (isPlaced) {
    const place = itemPlaceOfObjectGet(store, decl, meta, entry, groupPathPlaced);
    store.itemMove(assetMeta.itemId, { folder: place.folder, groupPath: place.groupPath, asLayer: OBJECT_FRONTEND_LAYER });
    groupPathNow = place.groupPath;
  }
  listingWrite(store, listing, [...listing.assetList, { key, kind, itemId: assetMeta.itemId, ...naming, listGroupPath: listGroupPathFor(listing, groupPathNow) }]);
  const itemList = [store.itemGet(assetMeta.itemId), store.itemGet(meta.itemId)];
  if (declOther) itemList.push(store.itemGet(declOther.entry));
  return writeResultBuild(context, decl.id, itemList);
}

// an item leaves the lists of the object that had it
function assetListRemove(context: WriteContext, decl: ObjectFrontendDecl, itemId: string) {
  const listing = listingRead(context, decl);
  listingWrite(context.store, listing, listing.assetList.filter((one: any) => one.itemId !== itemId));
}

// where a listed asset lies on disk: the folder of the object, at groupPath ('' its top). it
// also brings home an asset lying elsewhere, and declares the object when the asset does not.
// its record follows it to the list nearest to its new place; its key, name and paths do not change
export function objectFrontendAssetMove(context: WriteContext, input: { id: string; key: string; groupPath?: string }): ObjectFrontendWriteResult {
  const { store } = context;
  const decl = declGet(context.config, input.id);
  const listing = listingRead(context, decl);
  const { meta, entry } = listing;
  const asset = listing.assetList.find((one: any) => one.key === input.key);
  if (!asset) throw new AssetError(-3, `the object has no asset ${input.key}`);
  const assetMeta = store.itemGet(asset.itemId);
  const ref = objectFrontendRefBuild(decl.id);
  if (assetMeta.owner && assetMeta.owner.ref !== ref) throw new AssetError(-1, `the item declares ${assetMeta.owner.ref}: remove it from this object, or take it with attach`);
  if (assetMeta.isLocked) throw new AssetError(-1, 'the item is locked: unlock it first');
  partitionGitIgnoreRequire(context, listing, input.groupPath ?? '');
  if (!assetMeta.owner) store.itemMetaSet(assetMeta.itemId, { owner: { ref } });
  const place = itemPlaceOfObjectGet(store, decl, meta, entry, input.groupPath ?? '');
  const item = store.itemMove(assetMeta.itemId, { folder: place.folder, groupPath: place.groupPath, asLayer: OBJECT_FRONTEND_LAYER });
  const listGroupPath = listGroupPathFor(listing, place.groupPath);
  if (listGroupPath !== asset.listGroupPath) {
    listingWrite(store, listing, listing.assetList.map((one: any) => (one === asset ? { ...asset, listGroupPath } : one)));
  }
  return writeResultBuild(context, decl.id, [item, store.itemGet(meta.itemId)]);
}

// a folder inside the item folder of an object renamed or moved, with every asset in it and the
// lists it holds; the records of its assets kept in a list above it follow them to the list
// nearest to their new place
export function objectFrontendAssetGroupMove(context: WriteContext, input: { id: string; groupFrom: string; groupTo: string }): ObjectFrontendWriteResult {
  const { store } = context;
  const decl = declGet(context.config, input.id);
  const { meta, entry } = entryRead(store, decl);
  partitionGitIgnoreRequire(context, listingRead(context, decl), input.groupTo);
  const placeFrom = itemPlaceOfObjectGet(store, decl, meta, entry, input.groupFrom);
  const placeTo = itemPlaceOfObjectGet(store, decl, meta, entry, input.groupTo);
  store.groupMove(placeFrom.folder, placeFrom.groupPath, placeTo.groupPath, { asLayer: OBJECT_FRONTEND_LAYER });
  const storeNow = context.storeGet?.() ?? store;
  const ref = objectFrontendRefBuild(decl.id);
  const listing = listingRead({ ...context, store: storeNow }, decl);
  if (listing.itemDirAbs) {
    const assetListNext = listing.assetList.map((one: any) => {
      const item = storeNow.itemList().find((itemOne) => itemOne.itemId === one.itemId);
      const isMoved = item?.folderOwner?.ref === ref && objectFrontendListCovers(placeTo.groupPath, item.groupPath);
      return isMoved ? { ...one, listGroupPath: listGroupPathFor(listing, item!.groupPath) } : one;
    });
    listingWrite(storeNow, listing, assetListNext);
  }
  return writeResultBuild(context, decl.id, storeNow.itemList().filter((one) => one.owner?.ref === ref || one.folderOwner?.ref === ref));
}

// how an asset of an object is named and indexed, in its record: its name, its paths (replaced
// whole; [] removes them), its kind. a path another asset of the object has is refused
export function objectFrontendAssetMetaSet(
  context: WriteContext,
  input: { id: string; key: string; name?: string | null; pathList?: unknown; kind?: string },
): ObjectFrontendWriteResult {
  const { store } = context;
  const decl = declGet(context.config, input.id);
  const listing = listingRead(context, decl);
  const asset = listing.assetList.find((one: any) => one.key === input.key);
  if (!asset) throw new AssetError(-3, `the object has no asset ${input.key}`);
  const naming = assetNamingRead(listing.assetList, asset.key, { name: input.name === null ? '' : input.name ?? asset.name, pathList: input.pathList ?? asset.pathList ?? [] });
  const assetNext: any = { key: asset.key, kind: input.kind ?? asset.kind, itemId: asset.itemId, ...naming, listGroupPath: asset.listGroupPath };
  listingWrite(store, listing, listing.assetList.map((one: any) => (one === asset ? assetNext : one)));
  return writeResultBuild(context, decl.id, [store.itemGet(listing.meta.itemId)]);
}

// ---------- the partitions of an object ----------
// what every frontend object offers for its partitions, whatever its type
// (doc_page_impl_obj_frontend.md#the-apis-of-partitions): made, renamed, deleted. the list is read
// with the object (its declarations carry the item lists, the page counts the assets)

// a partition made: its folder with an empty item list, so that a record never lands above it.
// a type declaring partitions names the ones there may be; one kept out of git must be ignored first
export function objectFrontendPartitionCreate(context: WriteContext, input: { id: string; partition: string }): ObjectFrontendWriteResult {
  const decl = declGet(context.config, input.id);
  const listing = listingRead(context, decl);
  if (!listing.itemDirAbs) throw new AssetError(-1, `the object ${decl.id} has no folder of its own: it has no partitions`);
  docPageWritableGet(context.config, decl.docPageAlias);
  const groupPath = partitionPlaceRequire(context, listing, partitionIdRequire(input.partition), '');
  const file = listFileGet(listing.itemDirAbs, groupPath);
  if (fs.existsSync(file)) throw new AssetError(-1, `the partition ${groupPath} exists already`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fileWriteSafe(file, objectFrontendListTextBuild([]));
  return writeResultBuild(context, decl.id, []);
}

// a partition renamed: its folder moved with its items and its lists, so every record follows;
// the paths of the assets are the object's and do not change. the new name must not be in use
export function objectFrontendPartitionRename(context: WriteContext, input: { id: string; partitionFrom: string; partitionTo: string }): ObjectFrontendWriteResult {
  const decl = declGet(context.config, input.id);
  const listing = listingRead(context, decl);
  if (!listing.itemDirAbs) throw new AssetError(-1, `the object ${decl.id} has no folder of its own: it has no partitions`);
  const from = partitionIdRequire(input.partitionFrom);
  const to = partitionPlaceRequire(context, listing, partitionIdRequire(input.partitionTo), '');
  if (!fs.existsSync(path.join(listing.itemDirAbs, from))) throw new AssetError(-3, `the object has no partition ${from}`);
  if (fs.existsSync(path.join(listing.itemDirAbs, to))) throw new AssetError(-1, `the partition ${to} exists already: move its assets one by one, or rename it first`);
  const hasItem = context.store.itemList().some((one) => one.folderOwner?.ref === objectFrontendRefBuild(decl.id) && (one.groupPath === from || one.groupPath.startsWith(`${from}/`)));
  if (hasItem) return objectFrontendAssetGroupMove(context, { id: decl.id, groupFrom: from, groupTo: to });
  // nothing in it but its list: the folder is moved as it is
  fs.renameSync(path.join(listing.itemDirAbs, from), path.join(listing.itemDirAbs, to));
  return writeResultBuild(context, decl.id, []);
}

// a partition deleted: its assets off their lists and deleted softly (their files stay, as for an
// object deleted), then its list and its folder, when nothing is left in them
export function objectFrontendPartitionDelete(context: WriteContext, input: { id: string; partition: string }): ObjectFrontendWriteResult {
  const { store } = context;
  const decl = declGet(context.config, input.id);
  const listing = listingRead(context, decl);
  if (!listing.itemDirAbs) throw new AssetError(-1, `the object ${decl.id} has no folder of its own: it has no partitions`);
  docPageWritableGet(context.config, decl.docPageAlias);
  const partition = partitionIdRequire(input.partition);
  const dirAbs = path.join(listing.itemDirAbs, partition);
  if (!fs.existsSync(dirAbs)) throw new AssetError(-3, `the object has no partition ${partition}`);
  const ref = objectFrontendRefBuild(decl.id);
  const isIn = (groupPath: string) => groupPath === partition || groupPath.startsWith(`${partition}/`);
  const itemList = store.itemList().filter((one) => one.folderOwner?.ref === ref && isIn(one.groupPath));
  if (itemList.some((one) => one.isLocked && !one.isDeleted)) throw new AssetError(-1, `the partition ${partition} holds a locked asset: unlock it first`);
  const itemIdSet = new Set(itemList.map((one) => one.itemId));
  listingWrite(store, listing, listing.assetList.filter((one: any) => !itemIdSet.has(one.itemId) && !(one.listGroupPath !== null && isIn(one.listGroupPath))));
  const itemListDeleted = itemList.filter((one) => !one.isDeleted).map((one) => store.itemDelete(one.itemId));
  for (const file of [path.join(dirAbs, OBJECT_FRONTEND_LIST_NAME), path.join(dirAbs, `${OBJECT_FRONTEND_LIST_NAME}.bak`)]) fs.rmSync(file, { force: true });
  if (fs.existsSync(dirAbs) && fs.readdirSync(dirAbs).length === 0) fs.rmdirSync(dirAbs);
  return writeResultBuild(context, decl.id, itemListDeleted);
}

function partitionIdRequire(value: unknown): string {
  const id = String(value ?? '');
  if (!OBJECT_FRONTEND_PARTITION_REGEX.test(id)) throw new AssetError(-1, `a partition is a folder name: letters, digits, "_", "-" and "." (${JSON.stringify(value)})`);
  return id;
}

// { name?, pathList? } of an asset as a write gives them: the name trimmed,
// the paths in their canonical form, each once, none another asset of the
// object (other than keyOwn) has
function assetNamingRead(assetList: any[], keyOwn: string, input: { name?: unknown; pathList?: unknown }): { name?: string; pathList?: string[] } {
  const naming: { name?: string; pathList?: string[] } = {};
  const name = String(input.name ?? '').trim();
  if (name.length > 200) throw new AssetError(-1, 'the name of an asset is at most 200 characters');
  if (name) naming.name = name;
  if (input.pathList === undefined || input.pathList === null) return naming;
  if (!Array.isArray(input.pathList)) throw new AssetError(-1, 'pathList is a list of paths (/kind/...)');
  const pathList: string[] = [];
  // every path a pattern stands for names one asset: compared path by path, not by the text
  const ownerByPath = new Map<string, any>();
  for (const one of assetList) {
    if (one.key === keyOwn) continue;
    for (const pattern of one.pathList ?? []) for (const text of assetPathCompile(pattern, { isAbsolute: true }).textList) if (!ownerByPath.has(text)) ownerByPath.set(text, one);
  }
  for (const pathText of input.pathList) {
    const { path, message } = objectFrontendAssetPathNormalize(pathText);
    if (message) throw new AssetError(-1, `the path ${JSON.stringify(pathText)}: ${message}`);
    if (!path || pathList.includes(path)) continue;
    const textList = assetPathCompile(path, { isAbsolute: true }).textList;
    const taken = textList.find((text) => ownerByPath.has(text));
    if (taken) {
      const owner = ownerByPath.get(taken);
      throw new AssetError(-1, `the path ${taken}${textList.length > 1 ? ` (one of those ${path} stands for)` : ''} is the path of ${owner.name || owner.key} already`);
    }
    pathList.push(path);
  }
  if (pathList.length > 0) naming.pathList = pathList;
  return naming;
}

// ---------- helpers ----------

// ---------- the lists of an object ----------
// an object with a folder of its own records its assets in item lists (item-list.yaml) in its
// item folder; one without, in its entry. a write reads them all, changes the records it must
// (each with listGroupPath: the folder of its list, null for the entry) and writes back only
// the lists that changed (doc_page_impl_obj_frontend.md#the-item-lists)

type Listing = {
  meta: AssetItemMeta;
  entry: any;
  hash: string;
  // the item folder of the object; '' for an object without a folder of its own
  itemDirAbs: string;
  // every record, merged, each with listGroupPath
  assetList: any[];
  // the folders holding a list
  listGroupPathList: string[];
};

function listingRead(context: WriteContext, decl: ObjectFrontendDecl): Listing {
  const { meta, entry, hash } = entryRead(context.store, decl);
  const dirAbs = context.config.objectDirAbsById.get(decl.id);
  const itemDirAbs = dirAbs ? path.join(dirAbs, OBJECT_FRONTEND_ITEM_FOLDER_NAME) : '';
  const listList = itemDirAbs ? objectListListRead(itemDirAbs) : [];
  const { assetList } = objectFrontendAssetListMerge(entry.assetList, listList);
  return { meta, entry, hash, itemDirAbs, assetList, listGroupPathList: listList.map((list) => list.groupPath) };
}

// ---------- partitions ----------
// the folders an object splits its items into, declared by its type (partitionList), some kept out of
// git (doc_page_impl_obj_frontend.md#partitions)

// the folder a write places an item in: groupPathInside within the partition named, which the type
// must declare when it declares any; a partition kept out of git must be ignored by git already
function partitionPlaceRequire(context: WriteContext, listing: Listing, partition: string | undefined, groupPathInside: string | undefined): string {
  const partitionDeclaredList = objectFrontendPartitionListResolve(listing.entry.type, context.config.typeList);
  const { groupPath, message } = objectFrontendPartitionGroupPathBuild(partitionDeclaredList, partition, groupPathInside);
  if (message) throw new AssetError(-1, message);
  partitionGitIgnoreRequire(context, listing, groupPath);
  return groupPath;
}

// a write into a partition its type keeps out of git (isGitIgnored) is refused while git does not
// ignore that folder: private data never lands where a commit takes it. outside a repository, or
// without git, there is nothing to check
function partitionGitIgnoreRequire(context: WriteContext, listing: Listing, groupPath: string) {
  if (!listing.itemDirAbs) return;
  const first = String(groupPath ?? '').split('/')[0];
  const partition = (objectFrontendPartitionListResolve(listing.entry.type, context.config.typeList) ?? []).find((one: any) => one.id === first);
  if (!partition?.isGitIgnored) return;
  const probe = path.join(listing.itemDirAbs, first, OBJECT_FRONTEND_LIST_NAME);
  let status = 0;
  try {
    execFileSync('git', ['check-ignore', '-q', probe], { cwd: listing.itemDirAbs, stdio: 'ignore' });
  } catch (error: any) {
    status = typeof error?.status === 'number' ? error.status : 128;
  }
  if (status === 1) {
    throw new AssetError(-1, `the partition ${first} is kept out of git (isGitIgnored of its type), but git does not ignore ${path.join(listing.itemDirAbs, first)}: add it to the .gitignore first`);
  }
}

// the list the record of an asset lying at groupPath (in the item folder) goes to; null: the entry
function listGroupPathFor(listing: Listing, groupPath: string): string | null {
  return listing.itemDirAbs ? objectFrontendListGroupPathGet(listing.listGroupPathList, groupPath) : null;
}

// the lists whose records differ from the listing written: the entry (in place), an item list
// (whole; one left empty is removed, so a folder keeps no list of nothing)
function listingWrite(store: AssetStore, listing: Listing, assetListNext: any[]) {
  const ENTRY = '\u0000entry';
  const byList = (assetList: any[]) => {
    const map = new Map<string, any[]>();
    for (const one of assetList) {
      const id = one.listGroupPath === null || one.listGroupPath === undefined ? ENTRY : one.listGroupPath;
      map.set(id, [...(map.get(id) ?? []), one]);
    }
    return map;
  };
  const before = byList(listing.assetList);
  const after = byList(assetListNext);
  const recordOf = ({ listGroupPath, ...record }: any) => record;
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    // the records a list keeps stay in its order; one coming from another list goes last
    const afterList = after.get(id) ?? [];
    const keyBeforeList = (before.get(id) ?? []).map((one) => one.key);
    const recordList = [
      ...keyBeforeList.map((key) => afterList.find((one) => one.key === key)).filter(Boolean),
      ...afterList.filter((one) => !keyBeforeList.includes(one.key)),
    ].map(recordOf);
    if (JSON.stringify((before.get(id) ?? []).map(recordOf)) === JSON.stringify(recordList)) continue;
    if (id === ENTRY) {
      const entryNext = { ...listing.entry, assetList: recordList };
      store.itemUpdate({ itemId: listing.meta.itemId, hashBase: listing.hash, data: Buffer.from(objectFrontendEntryTextBuild(entryNext), 'utf-8'), mode: 'inPlace' });
      continue;
    }
    const file = listFileGet(listing.itemDirAbs, id);
    if (recordList.length === 0) {
      // with its backup, and the folders it leaves empty, up to the item folder
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}.bak`, { force: true });
      for (let dirAbs = path.dirname(file); dirAbs.startsWith(`${listing.itemDirAbs}${path.sep}`); dirAbs = path.dirname(dirAbs)) {
        if (!fs.existsSync(dirAbs) || fs.readdirSync(dirAbs).length > 0) break;
        fs.rmdirSync(dirAbs);
      }
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fileWriteSafe(file, objectFrontendListTextBuild(recordList));
  }
}

function writeResultBuild(context: WriteContext, id: string, itemList: AssetItemMeta[]): ObjectFrontendWriteResult {
  return { id, itemList, config: objectFrontendConfigForPage(context.config) };
}

function docPageWritableGet(config: ObjectFrontendConfig, alias: string): ObjectFrontendDocPage {
  const docPage = config.docPageList.find((one) => one.alias === alias);
  if (!docPage) throw new AssetError(-3, `not a doc page of this page: ${alias}`);
  if (docPage.isDisabled) throw new AssetError(-1, `the doc page ${alias} has no frontend objects (objectFrontend: false of its entry)`);
  if (docPage.isReadOnly) throw new AssetError(-4, `the frontend objects of the doc page ${alias} are read-only: it is a package`);
  return docPage;
}

function declFind(config: ObjectFrontendConfig, id: string): ObjectFrontendDecl | undefined {
  for (const docPage of config.docPageList) {
    const decl = docPage.objectList.find((one) => one.id === id);
    if (decl) return decl;
  }
  return undefined;
}

function declGet(config: ObjectFrontendConfig, id: string): ObjectFrontendDecl {
  const decl = declFind(config, String(id ?? ''));
  if (!decl) throw new AssetError(-3, `no doc page lists the frontend object ${String(id)}`);
  return decl;
}

// the entry asset of an object with its head: what it says, and the hash a write starts from
function entryRead(store: AssetStore, decl: ObjectFrontendDecl) {
  const meta = store.itemGet(decl.entry);
  if (meta.isDeleted) throw new AssetError(-1, `the entry asset ${meta.itemId} of the object ${decl.id} is deleted; restore it first`);
  const head = store.versionDataGetOf(meta, 'head');
  if (!head.isText) throw new AssetError(-1, `the entry asset ${meta.itemId} is not text`);
  const { entry } = objectFrontendEntryParse(head.text ?? '');
  return { meta, entry, hash: head.hash };
}

// where an asset of an object belongs: the item folder the object owns, at groupPath; an object
// without one (listed in objectList) keeps its assets in the group folder of its entry
function itemPlaceOfObjectGet(store: AssetStore, decl: ObjectFrontendDecl, entryMeta: AssetItemMeta, entry: any, groupPath = ''): { folder: string; groupPath: string } {
  const ref = objectFrontendRefBuild(decl.id);
  const groupInside = groupPathNormalize(groupPath);
  const folderOwned = store.folderList.find((folder) => folder.owner?.ref === ref);
  if (folderOwned) return { folder: folderOwned.path, groupPath: groupInside };
  const groupBase = groupIsOwn(entryMeta, decl.id) ? entryMeta.groupPath : objectFrontendDirNameBuild(decl.id, entry.name, entry.type);
  return { folder: entryMeta.folder, groupPath: groupInside ? `${groupBase}/${groupInside}` : groupBase };
}

// the id of the object an asset declares, with the role asked for ('' when none)
function objectIdOfOwnerGet(meta: AssetItemMeta, role: string): string {
  const ref = meta.owner?.ref ?? '';
  if (!ref.startsWith('frontend:') || (meta.owner?.role ?? '') !== role) return '';
  return ref.slice('frontend:'.length);
}

// the folder of an object: {id}--{name}, in ASCII like every folder of the store. a name
// with no ASCII in it (データベース移行) gives way to the type, which always is, so that a person
// browsing the disk still sees what the folder holds
export function objectFrontendDirNameBuild(id: string, name: string, typeId: string): string {
  const dirName = itemDirNameBuild(id, name);
  return dirName === id ? itemDirNameBuild(id, typeId) : dirName;
}

// the entry is in the group folder of its object ({id} or {id}--{name}, the last folder of its group path)
function groupIsOwn(meta: AssetItemMeta, id: string): boolean {
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
function configDeclAdd(context: WriteContext, alias: string, decl: { id: string; entry: string }) {
  const file = context.config.fileAbsByAlias.get(alias);
  if (!file) throw new AssetError(-1, `the doc page ${alias} has no frontend object file`);
  const lineList = [`- id: ${decl.id}`, `  entry: ${decl.entry}`];
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

function configDeclRemove(context: WriteContext, decl: ObjectFrontendDecl) {
  const file = context.config.fileAbsByAlias.get(decl.docPageAlias);
  if (!file || !fs.existsSync(file)) throw new AssetError(-3, `the file of the doc page ${decl.docPageAlias} is not found`);
  const source = fs.readFileSync(file, 'utf-8');
  const document = parseDocument(source);
  if (document.errors.length > 0) throw new AssetError(-1, `the file does not parse: ${document.errors[0].message}`);
  const seq: any = document.getIn(['objectList'], true);
  const index = (seq?.items ?? []).findIndex((node: any) => String(node?.get?.('id') ?? '') === decl.id);
  if (index < 0) throw new AssetError(-3, `the file does not list the object ${decl.id}`);
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
