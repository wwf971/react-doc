// react-doc migrate <path>: a doc page written before asset items were called items, and
// before a frontend object had a folder of its own, rewritten into the form the page reads
// (design: main/doc_page_impl_cli.md#migrating-a-doc-page; what changed: main/update-20261107-repl.md).
//
//   {itemId}--{name}/object.yaml         -> item.yaml, its key objectId -> itemId
//     (the entry asset of a frontend object: assetList [{ objectId }] -> { itemId }, in every version)
//   a fenced block "asset" of a document: objectId: ... -> itemId: ...
//   objectList of .doc-page/object-frontend.yaml, each { id, entry }:
//     -> .doc-page/object-frontend/{id}--{name}/object.yaml, its assets in item/ beside it
//
//   typeList of .doc-page/object-frontend.yaml   -> .doc-page/type.yaml
//   typeList of the object.yaml of an object     -> type.yaml beside it
//
// It runs on a folder holding doc pages, any number of them, and a second run changes
// nothing.
//
// Files are moved and rewritten, never committed; `git add` the folder for git to see renames.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ITEM_META_NAME_FORMER = 'object.yaml';
const ITEM_META_NAME = 'item.yaml';
const OBJECT_META_NAME = 'object.yaml';
const OBJECT_FOLDER_NAME = 'object-frontend';
const OBJECT_ITEM_FOLDER_NAME = 'item';
const ITEM_DIR_REGEX = /^[0-9a-z]{6,16}(--.*)?$/;
const DIR_SKIP_SET = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'service-backup']);

// every folder below dir, a folder before those inside it; what is skipped is never read
function dirListWalk(dir, result = []) {
  for (const one of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!one.isDirectory() || DIR_SKIP_SET.has(one.name)) continue;
    const dirInner = path.join(dir, one.name);
    result.push(dirInner);
    dirListWalk(dirInner, result);
  }
  return result;
}

function fileListWalk(dir, result = []) {
  for (const one of fs.readdirSync(dir, { withFileTypes: true })) {
    if (one.isDirectory()) {
      if (!DIR_SKIP_SET.has(one.name) && one.name !== '.doc-page') fileListWalk(path.join(dir, one.name), result);
    } else if (one.isFile()) {
      result.push(path.join(dir, one.name));
    }
  }
  return result;
}

function textKeyRename(text) {
  return text.replace(/(^|[\s{,])objectId:/gm, '$1itemId:');
}

// the keys of a former item file; a text that is no mapping is only renamed by words
function itemMetaTextRewrite(text, yaml) {
  let content;
  try {
    content = yaml.parse(text);
  } catch {
    return textKeyRename(text);
  }
  if (!content || typeof content !== 'object' || Array.isArray(content) || content.objectId === undefined) return textKeyRename(text);
  const { objectId, ...rest } = content;
  for (const version of rest.versionList ?? []) {
    for (const dependency of version.dependencyList ?? []) {
      if (dependency.objectId !== undefined) {
        dependency.itemId = dependency.objectId;
        delete dependency.objectId;
      }
    }
  }
  return yaml.stringify({ itemId: objectId, ...rest });
}

function itemFolderMigrate(dirItem, yaml, report, isDryRun) {
  const fileFormer = path.join(dirItem, ITEM_META_NAME_FORMER);
  const content = yaml.parse(fs.readFileSync(fileFormer, 'utf-8')) ?? {};
  report.itemList.push(dirItem);
  if (isDryRun) return;
  // the entry of a frontend object names its assets by id: every version of it
  if (content.owner?.role === 'entry') {
    for (const version of content.versionList ?? []) {
      const fileVersion = path.join(dirItem, `${version.versionId}.${content.fileExt}`);
      if (!fs.existsSync(fileVersion)) continue;
      const textBefore = fs.readFileSync(fileVersion, 'utf-8');
      const textNext = textKeyRename(textBefore);
      if (textNext === textBefore) continue;
      fs.writeFileSync(fileVersion, textNext);
      const bytes = Buffer.from(textNext, 'utf-8');
      version.size = bytes.length;
      version.hash = createHash('sha1').update(bytes).digest('hex');
    }
  }
  fs.writeFileSync(path.join(dirItem, ITEM_META_NAME), itemMetaTextRewrite(yaml.stringify(content), yaml));
  fs.rmSync(fileFormer);
  const backupFormer = `${fileFormer}.bak`;
  if (fs.existsSync(backupFormer)) {
    fs.writeFileSync(path.join(dirItem, `${ITEM_META_NAME}.bak`), itemMetaTextRewrite(fs.readFileSync(backupFormer, 'utf-8'), yaml));
    fs.rmSync(backupFormer);
  }
}

// objectId: of the fenced blocks "asset" of a document
function documentTextRewrite(text) {
  return text.replace(/^([ \t>]*)(`{3,}|~{3,})asset[ \t]*\r?\n[\s\S]*?^[ \t>]*\2[ \t]*\r?$/gm, (block) => textKeyRename(block));
}

function asciiNameGet(name) {
  const text = String(name ?? '');
  if (/^[\x20-\x7E]*$/.test(text)) return text.trim();
  return text.replace(/[^\x20-\x7E]+/g, '-').replace(/^[-\s.]+|[-\s.]+$/g, '');
}

// the items below a doc page folder, by id, in the form they have now
function itemDirByIdGet(dirPage) {
  const byId = new Map();
  for (const dir of [dirPage, ...dirListWalk(dirPage)]) {
    const base = path.basename(dir);
    if (ITEM_DIR_REGEX.test(base) && fs.existsSync(path.join(dir, ITEM_META_NAME))) byId.set(base.split('--')[0], dir);
  }
  return byId;
}

// one line of objectList made a folder of its own
function objectMigrate(dirMeta, line, yaml, report) {
  const itemDirById = itemDirByIdGet(path.dirname(dirMeta));
  const dirEntry = itemDirById.get(line.entry);
  if (!dirEntry) {
    report.problemList.push(`the entry ${line.entry} of the object ${line.id} is not found; it stays in objectList`);
    return false;
  }
  const dirGroup = path.dirname(dirEntry);
  const isGroupOwn = path.basename(dirGroup) === line.id || path.basename(dirGroup).startsWith(`${line.id}--`);
  const metaEntry = yaml.parse(fs.readFileSync(path.join(dirEntry, ITEM_META_NAME), 'utf-8'));
  let entry = {};
  try {
    entry = yaml.parse(fs.readFileSync(path.join(dirEntry, `${metaEntry.versionIdHead}.${metaEntry.fileExt}`), 'utf-8')) ?? {};
  } catch { /* the name is only for the folder */ }
  const nameAscii = asciiNameGet(entry.name) || asciiNameGet(entry.type);
  const dirName = isGroupOwn ? path.basename(dirGroup) : (nameAscii ? `${line.id}--${nameAscii}` : line.id);
  const dirObject = path.join(dirMeta, OBJECT_FOLDER_NAME, dirName);
  const dirItemFolder = path.join(dirObject, OBJECT_ITEM_FOLDER_NAME);
  fs.mkdirSync(dirItemFolder, { recursive: true });
  const ref = `frontend:${line.id}`;
  for (const [, dirItem] of itemDirById) {
    const meta = yaml.parse(fs.readFileSync(path.join(dirItem, ITEM_META_NAME), 'utf-8'));
    if (meta?.owner?.ref !== ref) continue;
    fs.renameSync(dirItem, path.join(dirItemFolder, path.basename(dirItem)));
  }
  if (isGroupOwn && fs.existsSync(dirGroup) && fs.readdirSync(dirGroup).length === 0) fs.rmdirSync(dirGroup);
  fs.writeFileSync(path.join(dirObject, OBJECT_META_NAME), [
    '# a frontend object of this doc page (doc_page_impl_obj_frontend.md#the-folder-of-an-object)',
    `id: ${line.id}`,
    `entry: ${line.entry}`,
    '',
  ].join('\n'));
  report.objectList.push(dirObject);
  return true;
}

function objectListMigrate(dirMeta, yaml, report, isDryRun) {
  const file = path.join(dirMeta, 'object-frontend.yaml');
  if (!fs.existsSync(file)) return;
  const source = fs.readFileSync(file, 'utf-8');
  const document = yaml.parseDocument(source);
  const lineList = document.toJS()?.objectList;
  if (!Array.isArray(lineList) || lineList.length === 0) return;
  if (isDryRun) {
    report.objectList.push(...lineList.map((line) => path.join(dirMeta, OBJECT_FOLDER_NAME, String(line.id))));
    return;
  }
  const indexMovedList = [];
  lineList.forEach((line, index) => {
    if (objectMigrate(dirMeta, line, yaml, report)) indexMovedList.push(index);
  });
  if (indexMovedList.length === 0) return;
  fs.writeFileSync(`${file}.bak`, source);
  // every line moved: the block leaves the text, so that the rest keeps how it was written
  const pair = document.contents.items.find((one) => one.key?.value === 'objectList');
  if (indexMovedList.length === lineList.length && pair?.key?.range && pair.value?.range) {
    fs.writeFileSync(file, `${source.slice(0, pair.key.range[0])}${source.slice(pair.value.range[2])}`);
    return;
  }
  for (const index of indexMovedList.reverse()) document.deleteIn(['objectList', index]);
  fs.writeFileSync(file, String(document));
}

// typeList of a file moved into the type file beside it, as it is written; the file is removed
// when it holds nothing else
function typeListMigrate(file, fileType, yaml, report, isDryRun) {
  if (!fs.existsSync(file)) return;
  const source = fs.readFileSync(file, 'utf-8');
  const document = yaml.parseDocument(source);
  const pair = document.contents?.items?.find((one) => one.key?.value === 'typeList');
  if (!pair?.key?.range || !pair.value?.range) return;
  if ((pair.value.items ?? []).length === 0 && !document.toJS()?.objectList?.length && document.contents.items.length > 1) return;
  if (fs.existsSync(fileType)) {
    report.problemList.push(`${file} declares types and ${fileType} exists: move them by hand`);
    return;
  }
  report.typeFileList.push(fileType);
  if (isDryRun) return;
  const textType = source.slice(pair.key.range[0], pair.value.range[1]).trimEnd();
  fs.writeFileSync(fileType, ['# types of this doc page (doc_page_impl_type.md#declaring-a-type)', textType, ''].join('\n'));
  const isOnlyKey = document.contents.items.length === 1;
  fs.writeFileSync(`${file}.bak`, source);
  if (isOnlyKey && path.basename(file) === 'object-frontend.yaml') {
    fs.rmSync(file);
    return;
  }
  fs.writeFileSync(file, `${source.slice(0, pair.key.range[0])}${source.slice(pair.value.range[2])}`);
}

function typeFileListMigrate(dirMeta, yaml, report, isDryRun) {
  typeListMigrate(path.join(dirMeta, 'object-frontend.yaml'), path.join(dirMeta, 'type.yaml'), yaml, report, isDryRun);
  const dirObjectAll = path.join(dirMeta, OBJECT_FOLDER_NAME);
  if (!fs.existsSync(dirObjectAll)) return;
  for (const one of fs.readdirSync(dirObjectAll, { withFileTypes: true })) {
    if (one.isDirectory()) typeListMigrate(path.join(dirObjectAll, one.name, OBJECT_META_NAME), path.join(dirObjectAll, one.name, 'type.yaml'), yaml, report, isDryRun);
  }
}

// the migration of everything below dirTarget: { itemList, documentList, objectList, typeFileList, problemList }
export async function docMigrate(dirTarget, { isDryRun = false } = {}) {
  const yaml = await import('yaml');
  const report = { itemList: [], documentList: [], objectList: [], typeFileList: [], problemList: [] };
  const dirList = [dirTarget, ...dirListWalk(dirTarget)];
  for (const dir of dirList) {
    const base = path.basename(dir);
    // inside the folder of a frontend object, object.yaml is the object's: it holds no objectId
    if (!ITEM_DIR_REGEX.test(base) || !fs.existsSync(path.join(dir, ITEM_META_NAME_FORMER))) continue;
    if (!/^objectId:/m.test(fs.readFileSync(path.join(dir, ITEM_META_NAME_FORMER), 'utf-8'))) continue;
    itemFolderMigrate(dir, yaml, report, isDryRun);
  }
  for (const file of fileListWalk(dirTarget)) {
    if (!/\.mdx?$/i.test(file)) continue;
    const textBefore = fs.readFileSync(file, 'utf-8');
    const textNext = documentTextRewrite(textBefore);
    if (textNext === textBefore) continue;
    report.documentList.push(file);
    if (!isDryRun) fs.writeFileSync(file, textNext);
  }
  for (const dir of dirList) {
    if (path.basename(dir) !== '.doc-page') continue;
    objectListMigrate(dir, yaml, report, isDryRun);
    typeFileListMigrate(dir, yaml, report, isDryRun);
  }
  return report;
}
