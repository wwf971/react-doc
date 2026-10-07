import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { idMs48Create, idMs48Is } from './id-ms48.ts';

// The asset store on disk (design: doc_page_impl_asset.md). A general store
// of text objects with a version history, kept entirely in one folder, so
// the folder and its files are the whole state: nothing lives only in
// memory or in a database.
//
//   {folder}/
//     {objectId}/                     one folder per object (ms_48 id)
//       object.yaml                   the object: name, lang, head, versions
//       object.yaml.bak               the previous object.yaml, before the last rewrite
//       {versionId}.{fileExt}         the text of one version
//       {versionId}.{fileExt}.bak     the previous text, before an in-place update
//
// object.yaml:
//   objectId, name, lang, fileExt, versionIdHead, isDeleted,
//   timeCreated, timeUpdated,
//   versionList: [{ versionId, versionIdPrevList, time, note }]
//
// the history is a DAG: a version names the versions it was made from
// (versionIdPrevList: none for the first version, one for an ordinary
// update, several for a merge). the head is the version a document reading
// "head" receives; it can be moved to any version (checkout), and the next
// new version then branches from there.
//
// every rewrite of an existing file first copies it to {file}.bak, then
// writes a temporary file and renames it into place, so an interrupted
// write never leaves a half-written object.yaml or data file behind.
//
// errors are AssetError with the codes of the api:
//   -1 bad request, -2 conflict (the text changed since it was read), -3 not found

export const ASSET_OBJECT_META_NAME = 'object.yaml';

export type AssetVersionMeta = {
  versionId: string;
  versionIdPrevList: string[];
  time: string;
  note: string;
};

export type AssetObjectMeta = {
  objectId: string;
  name: string;
  lang: string;
  fileExt: string;
  versionIdHead: string;
  isDeleted: boolean;
  timeCreated: string;
  timeUpdated: string;
  versionList: AssetVersionMeta[];
};

export type AssetVersionText = { versionId: string; text: string; hash: string };

export type AssetUpdateMode = 'inPlace' | 'newVersion';

export class AssetError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

// text objects are stored with a file extension readable by editors
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

export function assetStoreCreate(folderAbs: string) {
  const objectDirGet = (objectId: string) => path.join(folderAbs, objectId);
  const objectMetaPathGet = (objectId: string) => path.join(objectDirGet(objectId), ASSET_OBJECT_META_NAME);
  const versionPathGet = (meta: AssetObjectMeta, versionId: string) =>
    path.join(objectDirGet(meta.objectId), `${versionId}.${meta.fileExt}`);

  // ---------- reading ----------

  function objectList(): AssetObjectMeta[] {
    if (!fs.existsSync(folderAbs)) return [];
    const metaList: AssetObjectMeta[] = [];
    for (const item of fs.readdirSync(folderAbs, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const meta = objectMetaRead(item.name);
      if (meta) metaList.push(meta);
    }
    metaList.sort((a, b) => a.timeCreated.localeCompare(b.timeCreated));
    return metaList;
  }

  function objectGet(objectId: string): AssetObjectMeta {
    if (!idMs48Is(objectId)) throw new AssetError(-1, `not an object id: ${String(objectId)}`);
    const meta = objectMetaRead(objectId);
    if (!meta) throw new AssetError(-3, `asset object not found: ${objectId}`);
    return meta;
  }

  // versionId 'head' or '' reads the head version
  function versionTextGet(objectId: string, versionIdRequested = 'head'): AssetVersionText {
    const meta = objectGet(objectId);
    const versionId = versionIdResolve(meta, versionIdRequested);
    const filePath = versionPathGet(meta, versionId);
    if (!fs.existsSync(filePath)) {
      throw new AssetError(-3, `data file of version ${versionId} is missing: ${filePath}`);
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    return { versionId, text, hash: textHashGet(text) };
  }

  // ---------- writing ----------

  function objectCreate(input: { name?: string; lang?: string; text: string; note?: string }): { object: AssetObjectMeta; version: AssetVersionText } {
    if (typeof input.text !== 'string') throw new AssetError(-1, 'text is required');
    const lang = langNormalize(input.lang);
    fs.mkdirSync(folderAbs, { recursive: true });
    const objectId = idMs48Create((id) => fs.existsSync(objectDirGet(id)));
    const versionId = idMs48Create();
    const time = timeTextGet();
    const meta: AssetObjectMeta = {
      objectId,
      name: String(input.name ?? '').trim(),
      lang,
      fileExt: fileExtByLang[lang] ?? 'txt',
      versionIdHead: versionId,
      isDeleted: false,
      timeCreated: time,
      timeUpdated: time,
      versionList: [{ versionId, versionIdPrevList: [], time, note: String(input.note ?? '') }],
    };
    fs.mkdirSync(objectDirGet(objectId), { recursive: true });
    fileWriteSafe(versionPathGet(meta, versionId), input.text);
    objectMetaWrite(meta);
    return { object: meta, version: { versionId, text: input.text, hash: textHashGet(input.text) } };
  }

  // hashBase: the hash of the head text the caller changed; a different
  // head on disk means somebody else wrote meanwhile (code -2).
  //   inPlace      the head version's text is rewritten (its .bak keeps the old one)
  //   newVersion   a new version is created from the head and becomes the head
  function objectUpdate(input: { objectId: string; hashBase: string; text: string; mode: AssetUpdateMode; note?: string }): { object: AssetObjectMeta; version: AssetVersionText } {
    if (typeof input.text !== 'string') throw new AssetError(-1, 'text is required');
    if (input.mode !== 'inPlace' && input.mode !== 'newVersion') {
      throw new AssetError(-1, `mode must be inPlace or newVersion, got ${String(input.mode)}`);
    }
    const meta = objectGet(input.objectId);
    if (meta.isDeleted) throw new AssetError(-1, 'the object is deleted; restore it first');
    const head = versionTextGet(meta.objectId, 'head');
    if (typeof input.hashBase !== 'string' || head.hash !== input.hashBase) {
      throw new AssetError(-2, 'the asset changed since it was loaded; the update was not applied');
    }
    const time = timeTextGet();
    let versionId = head.versionId;
    if (input.mode === 'newVersion') {
      versionId = idMs48Create((id) => meta.versionList.some((version) => version.versionId === id));
      meta.versionList.push({
        versionId,
        versionIdPrevList: [head.versionId],
        time,
        note: String(input.note ?? ''),
      });
      meta.versionIdHead = versionId;
    } else if (input.note !== undefined) {
      versionMetaGet(meta, versionId).note = String(input.note);
    }
    meta.timeUpdated = time;
    fileWriteSafe(versionPathGet(meta, versionId), input.text);
    objectMetaWrite(meta);
    return { object: meta, version: { versionId, text: input.text, hash: textHashGet(input.text) } };
  }

  // soft delete: the folder and every version stay; the object reads as
  // deleted until it is restored
  function objectDelete(objectId: string): AssetObjectMeta {
    const meta = objectGet(objectId);
    meta.isDeleted = true;
    meta.timeUpdated = timeTextGet();
    objectMetaWrite(meta);
    return meta;
  }

  function objectRestore(objectId: string): AssetObjectMeta {
    const meta = objectGet(objectId);
    meta.isDeleted = false;
    meta.timeUpdated = timeTextGet();
    objectMetaWrite(meta);
    return meta;
  }

  // name and lang of the object. the file extension of the data files is
  // decided at creation and kept, so changing lang renames nothing.
  function objectMetaSet(objectId: string, change: { name?: string; lang?: string }): AssetObjectMeta {
    const meta = objectGet(objectId);
    if (change.name !== undefined) meta.name = String(change.name).trim();
    if (change.lang !== undefined) meta.lang = langNormalize(change.lang);
    meta.timeUpdated = timeTextGet();
    objectMetaWrite(meta);
    return meta;
  }

  // the head moves to an existing version; a later new version branches from it
  function versionCheckout(objectId: string, versionId: string): AssetObjectMeta {
    const meta = objectGet(objectId);
    versionMetaGet(meta, versionId);
    meta.versionIdHead = versionId;
    meta.timeUpdated = timeTextGet();
    objectMetaWrite(meta);
    return meta;
  }

  // removes a version and its data file. the head cannot be removed. the
  // versions made from the removed one now name its own previous versions,
  // so the ancestry of every remaining version is kept.
  function versionDelete(objectId: string, versionId: string): AssetObjectMeta {
    const meta = objectGet(objectId);
    const version = versionMetaGet(meta, versionId);
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
    meta.timeUpdated = timeTextGet();
    objectMetaWrite(meta);
    const filePath = versionPathGet(meta, versionId);
    for (const file of [filePath, `${filePath}.bak`]) {
      if (fs.existsSync(file)) fs.rmSync(file);
    }
    return meta;
  }

  // ---------- build ----------

  // everything a built page needs: the live objects with the text of every
  // version, so pinned versions keep working without a server
  function snapshotBuild(): AssetSnapshot {
    const objectById: AssetSnapshot['objectById'] = {};
    for (const meta of objectList()) {
      if (meta.isDeleted) continue;
      const textByVersionId: Record<string, string> = {};
      for (const version of meta.versionList) {
        const filePath = versionPathGet(meta, version.versionId);
        if (fs.existsSync(filePath)) textByVersionId[version.versionId] = fs.readFileSync(filePath, 'utf-8');
      }
      objectById[meta.objectId] = { ...meta, textByVersionId };
    }
    return { objectById };
  }

  // text of a reference for build-time scans; undefined when it cannot be read
  function referenceTextGet(reference: { objectId: string; versionId: string }): { lang: string; text: string } | undefined {
    try {
      const meta = objectGet(reference.objectId);
      const version = versionTextGet(meta.objectId, reference.versionId);
      return { lang: meta.lang, text: version.text };
    } catch {
      return undefined;
    }
  }

  // ---------- files ----------

  function objectMetaRead(objectId: string): AssetObjectMeta | undefined {
    const filePath = objectMetaPathGet(objectId);
    if (!fs.existsSync(filePath)) return undefined;
    const content = yamlParse(fs.readFileSync(filePath, 'utf-8'));
    return objectMetaNormalize(content, objectId);
  }

  function objectMetaWrite(meta: AssetObjectMeta) {
    fileWriteSafe(objectMetaPathGet(meta.objectId), yamlStringify(meta));
  }

  return {
    folder: folderAbs,
    objectList,
    objectGet,
    versionTextGet,
    objectCreate,
    objectUpdate,
    objectDelete,
    objectRestore,
    objectMetaSet,
    versionCheckout,
    versionDelete,
    snapshotBuild,
    referenceTextGet,
  };
}

export type AssetStore = ReturnType<typeof assetStoreCreate>;

export type AssetSnapshot = {
  objectById: Record<string, AssetObjectMeta & { textByVersionId: Record<string, string> }>;
};

// ---------- helpers ----------

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

function langNormalize(lang: unknown): string {
  const langText = String(lang ?? '').trim().toLowerCase();
  if (langText === 'asset') throw new AssetError(-1, 'lang "asset" names a reference, not data');
  return langText;
}

function objectMetaNormalize(content: any, objectId: string): AssetObjectMeta {
  const versionList = Array.isArray(content?.versionList) ? content.versionList : [];
  return {
    objectId,
    name: String(content?.name ?? ''),
    lang: String(content?.lang ?? ''),
    fileExt: String(content?.fileExt ?? 'txt'),
    versionIdHead: String(content?.versionIdHead ?? ''),
    isDeleted: content?.isDeleted === true,
    timeCreated: String(content?.timeCreated ?? ''),
    timeUpdated: String(content?.timeUpdated ?? ''),
    versionList: versionList.map((version: any) => ({
      versionId: String(version?.versionId ?? ''),
      versionIdPrevList: Array.isArray(version?.versionIdPrevList) ? version.versionIdPrevList.map(String) : [],
      time: String(version?.time ?? ''),
      note: String(version?.note ?? ''),
    })),
  };
}

// an existing file is copied to {file}.bak first; the new text is written
// to {file}.tmp and renamed into place
export function fileWriteSafe(filePath: string, text: string) {
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, `${filePath}.bak`);
  const filePathTmp = `${filePath}.tmp`;
  fs.writeFileSync(filePathTmp, text, 'utf-8');
  fs.renameSync(filePathTmp, filePath);
}

export function textHashGet(text: string): string {
  return createHash('sha1').update(text, 'utf-8').digest('hex');
}

// time-format.md: 20260520_23250530+09 (local time, 10 ms, whole-hour zone)
export function timeTextGet(date = new Date()): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const zoneHours = -Math.round(date.getTimezoneOffset() / 60);
  const zoneText = `${zoneHours < 0 ? '-' : '+'}${pad(Math.abs(zoneHours))}`;
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${pad(Math.floor(date.getMilliseconds() / 10))}`
    + zoneText;
}
