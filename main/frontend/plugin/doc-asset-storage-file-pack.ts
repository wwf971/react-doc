import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  ASSET_STORAGE_PACK_SIZE_MAX_DEFAULT, ASSET_STORAGE_TYPE_FILE_PACK, type AssetStorageDriver, type AssetStorageInfo, type AssetStoragePlace,
} from './doc-asset-storage.ts';
import { AssetError, itemIdFromDirName } from './doc-asset-store.ts';

// The driver of the storage type file-pack (doc_page_impl_asset_storage.md#file-pack): the items
// of one partition merged into a few pack files. Nothing of the content is a plain file: a search
// of the disk, the index of an editor and a text comparison do not see it.
//
//   {partition}/
//     item-0001.pack                  the pack files, read in name order; the last one is written to
//     item-0002.pack                  started when the one before reached packSizeMax
//
// a pack file is a log of chunks, only ever appended to:
//
//   file    "RDPACK1\n"  chunk*
//   chunk   headLength (u32, big endian)  bodyLength (u32)  head  body
//   head    packed(json): { type, itemId, versionId?, dirName?, encoding? }
//   body    by type:
//     item              packed(json): what item.yaml holds; dirName in the head is its place
//     version           the bytes of one version, packed (encoding deflate) or as they are (raw:
//                       a point with isCompressed false, whose content is then plain in the file)
//     metadata          packed(json): the metadata of one version
//     versionRemove     none: the version and its metadata are gone
//     itemRemove        none: the item is gone with everything of it
//
// the last chunk about a thing is what holds: rewriting an item, a version or its metadata
// appends a chunk, and the one before stays in the file, dead, until a compaction writes the live
// chunks into new files. so the bytes before an in-place save are kept, as the .bak of file-tree,
// and an interrupted write leaves a tail that is not a whole chunk, which reading stops at and
// the next write cuts off.
//
// packed(bytes) is raw deflate, then every byte xor 0xA5: deflate keeps what it cannot shrink as
// it is (a short text in a script without repetition), and the mask is what makes sure no text of
// an item is ever found in the file as text.
//
// a reader needs no library: the format is read with a few lines in any runtime that can inflate
// (node:zlib here, DecompressionStream in a browser).

const PACK_MAGIC = Buffer.from('RDPACK1\n', 'utf-8');
const PACK_FILE_REGEX = /^item-(\d{4,})\.pack$/;
// compaction by itself: when more is dead than alive, and it is worth it
const PACK_COMPACT_DEAD_MIN = 1024 * 1024;

type PackChunkHead = { type: 'item' | 'version' | 'metadata' | 'versionRemove' | 'itemRemove'; itemId: string; versionId?: string; dirName?: string; encoding?: 'deflate' | 'raw' };

type PackVersionPlace = { fileName: string; offset: number; length: number; encoding: 'deflate' | 'raw'; chunkLength: number };

type PackIndex = {
  stamp: string;
  fileList: { name: string; size: number; sizeValid: number }[];
  itemById: Map<string, { dirName: string; content: Record<string, unknown>; chunkLength: number }>;
  versionByKey: Map<string, PackVersionPlace>;
  metadataByKey: Map<string, { metadata: Record<string, unknown>; chunkLength: number }>;
  // the last chunk about each item: what a change of the files is told by
  itemStampById: Map<string, string>;
};

export type AssetStorageFilePackConfig = { packSizeMax?: unknown; isCompressed?: unknown };

const indexByDir = new Map<string, PackIndex>();
const itemStampSeenByDir = new Map<string, Map<string, string>>();

const versionKeyGet = (itemId: string, versionId: string) => `${itemId}/${versionId}`;

function itemIdOfDirNameGet(dirName: string): string {
  const itemId = itemIdFromDirName(dirName.split('/').pop() ?? '');
  if (!itemId) throw new AssetError(-1, `not the place of an item: ${dirName}`);
  return itemId;
}

function packFileNameListGet(dirAbs: string): string[] {
  if (!fs.existsSync(dirAbs)) return [];
  return fs.readdirSync(dirAbs).filter((name) => PACK_FILE_REGEX.test(name)).sort();
}

function stampGet(dirAbs: string, fileNameList: string[]): string {
  return fileNameList.map((name) => {
    const stat = fs.statSync(path.join(dirAbs, name));
    return `${name}:${stat.size}:${stat.mtimeMs}`;
  }).join('|');
}

const PACK_MASK = 0xa5;

function maskApply(bytes: Buffer): Buffer {
  const result = Buffer.allocUnsafe(bytes.length);
  for (let index = 0; index < bytes.length; index++) result[index] = bytes[index] ^ PACK_MASK;
  return result;
}

const bytesPack = (bytes: Buffer): Buffer => maskApply(zlib.deflateRawSync(bytes));
const bytesUnpack = (bytes: Buffer): Buffer => zlib.inflateRawSync(maskApply(bytes));

function jsonDeflate(value: unknown): Buffer {
  return bytesPack(Buffer.from(JSON.stringify(value), 'utf-8'));
}

function jsonInflate(bytes: Buffer): any {
  return JSON.parse(bytesUnpack(bytes).toString('utf-8'));
}

function chunkBuild(head: PackChunkHead, body: Buffer): Buffer {
  const headBytes = jsonDeflate(head);
  const prelude = Buffer.alloc(8);
  prelude.writeUInt32BE(headBytes.length, 0);
  prelude.writeUInt32BE(body.length, 4);
  return Buffer.concat([prelude, headBytes, body]);
}

// one chunk taken into the index. bodyGet: its body, read only for the types that need it
function indexChunkApply(index: PackIndex, fileName: string, offsetBody: number, head: PackChunkHead, bodyLength: number, chunkLength: number, bodyGet: () => Buffer) {
  const { itemId } = head;
  index.itemStampById.set(itemId, `${fileName}:${offsetBody}`);
  if (head.type === 'item') {
    index.itemById.set(itemId, { dirName: String(head.dirName ?? itemId), content: jsonInflate(bodyGet()), chunkLength });
    return;
  }
  if (head.type === 'itemRemove') {
    index.itemById.delete(itemId);
    index.itemStampById.delete(itemId);
    for (const key of [...index.versionByKey.keys()]) if (key.startsWith(`${itemId}/`)) index.versionByKey.delete(key);
    for (const key of [...index.metadataByKey.keys()]) if (key.startsWith(`${itemId}/`)) index.metadataByKey.delete(key);
    return;
  }
  const key = versionKeyGet(itemId, String(head.versionId ?? ''));
  if (head.type === 'version') {
    index.versionByKey.set(key, { fileName, offset: offsetBody, length: bodyLength, encoding: head.encoding === 'raw' ? 'raw' : 'deflate', chunkLength });
  } else if (head.type === 'metadata') {
    const metadata = jsonInflate(bodyGet());
    if (metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0) index.metadataByKey.set(key, { metadata, chunkLength });
    else index.metadataByKey.delete(key);
  } else if (head.type === 'versionRemove') {
    index.versionByKey.delete(key);
    index.metadataByKey.delete(key);
  }
}

// the index of a container: read from its pack files, and kept while they stay as they were read
function indexGet(dirAbs: string): PackIndex {
  const fileNameList = packFileNameListGet(dirAbs);
  const stamp = stampGet(dirAbs, fileNameList);
  const indexKept = indexByDir.get(dirAbs);
  if (indexKept && indexKept.stamp === stamp) return indexKept;
  const index: PackIndex = { stamp, fileList: [], itemById: new Map(), versionByKey: new Map(), metadataByKey: new Map(), itemStampById: new Map() };
  for (const fileName of fileNameList) {
    const bytes = fs.readFileSync(path.join(dirAbs, fileName));
    let offset = PACK_MAGIC.length;
    if (bytes.length < offset || !bytes.subarray(0, offset).equals(PACK_MAGIC)) {
      console.warn(`[doc-asset-storage] ${path.join(dirAbs, fileName)} is not a pack file (its first bytes are not RDPACK1); it is not read`);
      index.fileList.push({ name: fileName, size: bytes.length, sizeValid: bytes.length });
      continue;
    }
    while (offset + 8 <= bytes.length) {
      const headLength = bytes.readUInt32BE(offset);
      const bodyLength = bytes.readUInt32BE(offset + 4);
      const offsetBody = offset + 8 + headLength;
      if (offsetBody + bodyLength > bytes.length) break;
      let head: PackChunkHead;
      try {
        head = jsonInflate(bytes.subarray(offset + 8, offsetBody));
      } catch {
        break;
      }
      indexChunkApply(index, fileName, offsetBody, head, bodyLength, 8 + headLength + bodyLength, () => bytes.subarray(offsetBody, offsetBody + bodyLength));
      offset = offsetBody + bodyLength;
    }
    if (offset < bytes.length) console.warn(`[doc-asset-storage] ${path.join(dirAbs, fileName)}: ${bytes.length - offset} byte(s) at its end are not a whole chunk (a write was interrupted); they are not read`);
    index.fileList.push({ name: fileName, size: bytes.length, sizeValid: offset });
  }
  indexByDir.set(dirAbs, index);
  return index;
}

function sizeLiveGet(index: PackIndex): number {
  let size = 0;
  for (const one of index.itemById.values()) size += one.chunkLength;
  for (const one of index.versionByKey.values()) size += one.chunkLength;
  for (const one of index.metadataByKey.values()) size += one.chunkLength;
  return size;
}

function infoOfIndexGet(index: PackIndex): AssetStorageInfo {
  const size = index.fileList.reduce((sum, one) => sum + one.size, 0);
  const sizeLive = sizeLiveGet(index) + index.fileList.length * PACK_MAGIC.length;
  return { itemCount: index.itemById.size, size, sizeDead: Math.max(0, size - sizeLive), fileList: index.fileList.map(({ name, size: sizeOne }) => ({ name, size: sizeOne })) };
}

function bodyRead(dirAbs: string, place: PackVersionPlace): Buffer {
  const fd = fs.openSync(path.join(dirAbs, place.fileName), 'r');
  try {
    const bytes = Buffer.alloc(place.length);
    fs.readSync(fd, bytes, 0, place.length, place.offset);
    return place.encoding === 'raw' ? bytes : bytesUnpack(bytes);
  } finally {
    fs.closeSync(fd);
  }
}

export function assetStorageFilePackDriverCreate(config: AssetStorageFilePackConfig = {}): AssetStorageDriver {
  const packSizeMax = Number.isFinite(Number(config.packSizeMax)) && Number(config.packSizeMax) > 0 ? Number(config.packSizeMax) : ASSET_STORAGE_PACK_SIZE_MAX_DEFAULT;
  const isCompressed = config.isCompressed !== false;

  // a chunk appended to the last pack file (a new one when that is full), and taken into the index
  function chunkAppend(dirAbs: string, head: PackChunkHead, body: Buffer) {
    const index = indexGet(dirAbs);
    fs.mkdirSync(dirAbs, { recursive: true });
    const chunk = chunkBuild(head, body);
    let fileLast = index.fileList[index.fileList.length - 1];
    if (!fileLast || (fileLast.sizeValid > PACK_MAGIC.length && fileLast.sizeValid + chunk.length > packSizeMax)) {
      const numberNext = fileLast ? Number(PACK_FILE_REGEX.exec(fileLast.name)![1]) + 1 : 1;
      fileLast = { name: `item-${String(numberNext).padStart(4, '0')}.pack`, size: PACK_MAGIC.length, sizeValid: PACK_MAGIC.length };
      fs.writeFileSync(path.join(dirAbs, fileLast.name), PACK_MAGIC);
      index.fileList.push(fileLast);
    }
    const file = path.join(dirAbs, fileLast.name);
    // what an interrupted write left at the end is cut off first
    if (fileLast.size > fileLast.sizeValid) fs.truncateSync(file, fileLast.sizeValid);
    fs.appendFileSync(file, chunk);
    const headLength = chunk.readUInt32BE(0);
    indexChunkApply(index, fileLast.name, fileLast.sizeValid + 8 + headLength, head, body.length, chunk.length, () => body);
    fileLast.sizeValid += chunk.length;
    fileLast.size = fileLast.sizeValid;
    index.stamp = stampGet(dirAbs, index.fileList.map((one) => one.name));
    const info = infoOfIndexGet(index);
    if (info.sizeDead > PACK_COMPACT_DEAD_MIN && info.sizeDead > info.size - info.sizeDead) compact(dirAbs);
  }

  // the live chunks written into new pack files, which replace the ones there
  function compact(dirAbs: string): AssetStorageInfo {
    const index = indexGet(dirAbs);
    const fileNameOldList = index.fileList.map((one) => one.name);
    const chunkList: Buffer[] = [];
    for (const [itemId, item] of [...index.itemById.entries()].sort((a, b) => a[1].dirName.localeCompare(b[1].dirName))) {
      chunkList.push(chunkBuild({ type: 'item', itemId, dirName: item.dirName }, jsonDeflate(item.content)));
      for (const [key, place] of index.versionByKey) {
        if (!key.startsWith(`${itemId}/`)) continue;
        const versionId = key.slice(itemId.length + 1);
        const bytes = Buffer.alloc(place.length);
        const fd = fs.openSync(path.join(dirAbs, place.fileName), 'r');
        try {
          fs.readSync(fd, bytes, 0, place.length, place.offset);
        } finally {
          fs.closeSync(fd);
        }
        chunkList.push(chunkBuild({ type: 'version', itemId, versionId, encoding: place.encoding }, bytes));
        const metadata = index.metadataByKey.get(key);
        if (metadata) chunkList.push(chunkBuild({ type: 'metadata', itemId, versionId }, jsonDeflate(metadata.metadata)));
      }
    }
    const fileNewList: { name: string; partList: Buffer[]; size: number }[] = [];
    for (const chunk of chunkList) {
      let fileLast = fileNewList[fileNewList.length - 1];
      if (!fileLast || (fileLast.size > PACK_MAGIC.length && fileLast.size + chunk.length > packSizeMax)) {
        fileLast = { name: `item-${String(fileNewList.length + 1).padStart(4, '0')}.pack`, partList: [PACK_MAGIC], size: PACK_MAGIC.length };
        fileNewList.push(fileLast);
      }
      fileLast.partList.push(chunk);
      fileLast.size += chunk.length;
    }
    // written beside the old files first, so that a failure here loses nothing
    for (const one of fileNewList) fs.writeFileSync(path.join(dirAbs, `${one.name}.tmp`), Buffer.concat(one.partList));
    for (const name of fileNameOldList) fs.rmSync(path.join(dirAbs, name), { force: true });
    for (const one of fileNewList) fs.renameSync(path.join(dirAbs, `${one.name}.tmp`), path.join(dirAbs, one.name));
    indexByDir.delete(dirAbs);
    return infoOfIndexGet(indexGet(dirAbs));
  }

  function itemPlaceList(dirAbs: string): AssetStoragePlace[] {
    return [...indexGet(dirAbs).itemById.entries()]
      .map(([itemId, item]) => ({ dirName: item.dirName, itemId, groupPath: item.dirName.split('/').slice(0, -1).join('/') }))
      .sort((a, b) => a.dirName.localeCompare(b.dirName));
  }

  function itemDirNameSet(dirAbs: string, itemId: string, dirNameNext: string) {
    const item = indexGet(dirAbs).itemById.get(itemId);
    if (!item) throw new AssetError(-3, `asset item not found in the pack: ${itemId}`);
    chunkAppend(dirAbs, { type: 'item', itemId, dirName: dirNameNext }, jsonDeflate(item.content));
  }

  return {
    typeId: ASSET_STORAGE_TYPE_FILE_PACK,
    isDataFound: (dirAbs) => packFileNameListGet(dirAbs).length > 0,
    itemPlaceList,
    itemMetaRead(dirAbs, dirName) {
      return indexGet(dirAbs).itemById.get(itemIdOfDirNameGet(dirName))?.content;
    },
    itemMetaWrite(dirAbs, dirName, content) {
      chunkAppend(dirAbs, { type: 'item', itemId: itemIdOfDirNameGet(dirName), dirName }, jsonDeflate(content));
    },
    versionRead(dirAbs, dirName, versionId) {
      const place = indexGet(dirAbs).versionByKey.get(versionKeyGet(itemIdOfDirNameGet(dirName), versionId));
      return place ? bodyRead(dirAbs, place) : undefined;
    },
    versionWrite(dirAbs, dirName, versionId, _fileExt, data) {
      chunkAppend(dirAbs, { type: 'version', itemId: itemIdOfDirNameGet(dirName), versionId, encoding: isCompressed ? 'deflate' : 'raw' }, isCompressed ? bytesPack(data) : data);
    },
    versionMetadataRead(dirAbs, dirName, versionId) {
      return indexGet(dirAbs).metadataByKey.get(versionKeyGet(itemIdOfDirNameGet(dirName), versionId))?.metadata ?? {};
    },
    versionMetadataWrite(dirAbs, dirName, versionId, metadata) {
      const itemId = itemIdOfDirNameGet(dirName);
      if (Object.keys(metadata).length === 0 && !indexGet(dirAbs).metadataByKey.has(versionKeyGet(itemId, versionId))) return;
      chunkAppend(dirAbs, { type: 'metadata', itemId, versionId }, jsonDeflate(metadata));
    },
    versionRemove(dirAbs, dirName, versionId) {
      chunkAppend(dirAbs, { type: 'versionRemove', itemId: itemIdOfDirNameGet(dirName), versionId }, Buffer.alloc(0));
    },
    itemPlaceSet(dirAbs, dirNameFrom, dirNameTo) {
      itemDirNameSet(dirAbs, itemIdOfDirNameGet(dirNameFrom), dirNameTo);
    },
    itemRemove(dirAbs, dirName) {
      const itemId = itemIdOfDirNameGet(dirName);
      if (!indexGet(dirAbs).itemById.has(itemId) && ![...indexGet(dirAbs).versionByKey.keys()].some((key) => key.startsWith(`${itemId}/`))) return;
      chunkAppend(dirAbs, { type: 'itemRemove', itemId }, Buffer.alloc(0));
    },
    groupMove(dirAbs, groupPathFrom, groupPathTo) {
      const placeList = itemPlaceList(dirAbs);
      const isIn = (groupPath: string, group: string) => groupPath === group || groupPath.startsWith(`${group}/`);
      if (placeList.some((one) => isIn(one.groupPath, groupPathTo))) throw new AssetError(-1, `the group ${groupPathTo} exists already`);
      for (const place of placeList) {
        if (!isIn(place.groupPath, groupPathFrom)) continue;
        itemDirNameSet(dirAbs, place.itemId, `${groupPathTo}${place.dirName.slice(groupPathFrom.length)}`);
      }
    },
    // a group of a pack is only a part of the places of its items: nothing is left behind
    groupEmptyRemove() {},
    infoGet: (dirAbs) => infoOfIndexGet(indexGet(dirAbs)),
    changeItemIdListGet(dirAbs) {
      const stampNow = indexGet(dirAbs).itemStampById;
      const stampSeen = itemStampSeenByDir.get(dirAbs) ?? new Map<string, string>();
      const itemIdList: string[] = [];
      for (const [itemId, stamp] of stampNow) if (stampSeen.get(itemId) !== stamp) itemIdList.push(itemId);
      for (const itemId of stampSeen.keys()) if (!stampNow.has(itemId)) itemIdList.push(itemId);
      itemStampSeenByDir.set(dirAbs, new Map(stampNow));
      return itemIdList;
    },
    compact,
  };
}

// the pack files of a container: what a partition changing its storage leaves behind is removed
export function assetStorageFilePackFileListRemove(dirAbs: string) {
  for (const name of packFileNameListGet(dirAbs)) fs.rmSync(path.join(dirAbs, name), { force: true });
  indexByDir.delete(dirAbs);
  itemStampSeenByDir.delete(dirAbs);
}
