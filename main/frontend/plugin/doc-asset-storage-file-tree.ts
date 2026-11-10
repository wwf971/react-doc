import fs from 'node:fs';
import path from 'node:path';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { ASSET_STORAGE_TYPE_FILE_TREE, type AssetStorageDriver, type AssetStorageInfo, type AssetStoragePlace } from './doc-asset-storage.ts';
import {
  ASSET_GROUP_DEPTH_MAX, ASSET_ITEM_META_NAME, ASSET_ITEM_META_NAME_FORMER, AssetError, assetFormerWarn, fileWriteSafe, itemIdFromDirName,
} from './doc-asset-store.ts';

// The driver of the storage type file-tree (doc_page_impl_asset_storage.md#file-tree): one folder
// per item, one file per version, everything a plain file a person, a search and git can read.
//
//   {container}/
//     {itemId}--{name}/               an item: its place is a real folder
//       item.yaml                     the item
//       {versionId}.{fileExt}         the bytes of one version
//       {versionId}.metadata.yaml     the metadata of one version, when it has any
//       *.bak                         the previous content of a file rewritten
//     {group}/.../{itemId}--{name}/   or inside group folders: a folder without item.yaml

const itemDirAbsGet = (dirAbs: string, dirName: string) => path.join(dirAbs, ...dirName.split('/'));
const versionFileGet = (dirAbs: string, dirName: string, versionId: string, fileExt: string) => path.join(itemDirAbsGet(dirAbs, dirName), `${versionId}.${fileExt}`);
// always yaml, whatever the extension of the data file
const versionMetadataFileGet = (dirAbs: string, dirName: string, versionId: string) => path.join(itemDirAbsGet(dirAbs, dirName), `${versionId}.metadata.yaml`);

function itemPlaceList(dirAbs: string, options: { groupSkipList?: string[] } = {}): AssetStoragePlace[] {
  const list: AssetStoragePlace[] = [];
  const groupSkipSet = new Set(options.groupSkipList ?? []);
  const visit = (groupPath: string, depth: number) => {
    const dirGroupAbs = groupPath ? path.join(dirAbs, ...groupPath.split('/')) : dirAbs;
    if (!fs.existsSync(dirGroupAbs)) return;
    const entryList = fs.readdirSync(dirGroupAbs, { withFileTypes: true })
      .filter((one) => one.isDirectory() && !one.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name));
    const groupList: string[] = [];
    for (const one of entryList) {
      const dirName = groupPath ? `${groupPath}/${one.name}` : one.name;
      if (groupPath === '' && groupSkipSet.has(one.name)) continue;
      const itemId = itemIdFromDirName(one.name);
      if (itemId && fs.existsSync(path.join(dirGroupAbs, one.name, ASSET_ITEM_META_NAME))) {
        list.push({ dirName, itemId, groupPath });
        continue;
      }
      if (itemId && fs.existsSync(path.join(dirGroupAbs, one.name, ASSET_ITEM_META_NAME_FORMER))) assetFormerWarn(dirAbs);
      groupList.push(dirName);
    }
    if (depth >= ASSET_GROUP_DEPTH_MAX) return;
    for (const groupPathInner of groupList) visit(groupPathInner, depth + 1);
  };
  visit('', 0);
  return list;
}

function groupEmptyRemove(dirAbs: string, groupPath: string) {
  if (!groupPath) return;
  const partList = groupPath.split('/');
  while (partList.length > 0) {
    const dirGroupAbs = path.join(dirAbs, ...partList);
    if (!fs.existsSync(dirGroupAbs) || fs.readdirSync(dirGroupAbs).length > 0) return;
    fs.rmdirSync(dirGroupAbs);
    partList.pop();
  }
}

function infoGet(dirAbs: string): AssetStorageInfo {
  let size = 0;
  const placeList = itemPlaceList(dirAbs);
  for (const place of placeList) {
    const itemDirAbs = itemDirAbsGet(dirAbs, place.dirName);
    for (const one of fs.readdirSync(itemDirAbs, { withFileTypes: true })) {
      if (one.isFile()) size += fs.statSync(path.join(itemDirAbs, one.name)).size;
    }
  }
  return { itemCount: placeList.length, size, sizeDead: 0, fileList: [] };
}

export const assetStorageFileTreeDriver: AssetStorageDriver = {
  typeId: ASSET_STORAGE_TYPE_FILE_TREE,
  isDataFound: (dirAbs) => itemPlaceList(dirAbs).length > 0,
  itemPlaceList,
  itemMetaRead(dirAbs, dirName) {
    const file = path.join(itemDirAbsGet(dirAbs, dirName), ASSET_ITEM_META_NAME);
    if (!fs.existsSync(file)) return undefined;
    return yamlParse(fs.readFileSync(file, 'utf-8'));
  },
  itemMetaWrite(dirAbs, dirName, content) {
    fs.mkdirSync(itemDirAbsGet(dirAbs, dirName), { recursive: true });
    fileWriteSafe(path.join(itemDirAbsGet(dirAbs, dirName), ASSET_ITEM_META_NAME), yamlStringify(content));
  },
  versionRead(dirAbs, dirName, versionId, fileExt) {
    const file = versionFileGet(dirAbs, dirName, versionId, fileExt);
    return fs.existsSync(file) ? fs.readFileSync(file) : undefined;
  },
  versionWrite(dirAbs, dirName, versionId, fileExt, data) {
    fs.mkdirSync(itemDirAbsGet(dirAbs, dirName), { recursive: true });
    fileWriteSafe(versionFileGet(dirAbs, dirName, versionId, fileExt), data);
  },
  versionMetadataRead(dirAbs, dirName, versionId) {
    const file = versionMetadataFileGet(dirAbs, dirName, versionId);
    if (!fs.existsSync(file)) return {};
    const content = yamlParse(fs.readFileSync(file, 'utf-8'));
    if (!content || typeof content !== 'object' || Array.isArray(content)) return {};
    return content as Record<string, unknown>;
  },
  // an empty mapping removes the file (its previous content is kept as .bak)
  versionMetadataWrite(dirAbs, dirName, versionId, metadata) {
    const file = versionMetadataFileGet(dirAbs, dirName, versionId);
    if (Object.keys(metadata).length === 0) {
      if (fs.existsSync(file)) {
        fs.copyFileSync(file, `${file}.bak`);
        fs.rmSync(file);
      }
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fileWriteSafe(file, yamlStringify(metadata));
  },
  versionRemove(dirAbs, dirName, versionId, fileExt) {
    const file = versionFileGet(dirAbs, dirName, versionId, fileExt);
    const fileMetadata = versionMetadataFileGet(dirAbs, dirName, versionId);
    for (const one of [file, `${file}.bak`, fileMetadata, `${fileMetadata}.bak`]) {
      if (fs.existsSync(one)) fs.rmSync(one);
    }
  },
  itemPlaceSet(dirAbs, dirNameFrom, dirNameTo) {
    const dirTo = itemDirAbsGet(dirAbs, dirNameTo);
    if (fs.existsSync(dirTo)) throw new AssetError(-1, `${dirNameTo} exists already`);
    fs.mkdirSync(path.dirname(dirTo), { recursive: true });
    fs.renameSync(itemDirAbsGet(dirAbs, dirNameFrom), dirTo);
  },
  itemRemove(dirAbs, dirName) {
    fs.rmSync(itemDirAbsGet(dirAbs, dirName), { recursive: true, force: true });
  },
  groupMove(dirAbs, groupPathFrom, groupPathTo) {
    const dirFrom = path.join(dirAbs, ...groupPathFrom.split('/'));
    const dirTo = path.join(dirAbs, ...groupPathTo.split('/'));
    if (!fs.existsSync(dirFrom)) return;
    if (fs.existsSync(dirTo)) throw new AssetError(-1, `the group ${groupPathTo} exists already`);
    fs.mkdirSync(path.dirname(dirTo), { recursive: true });
    fs.renameSync(dirFrom, dirTo);
    groupEmptyRemove(dirAbs, groupPathFrom.split('/').slice(0, -1).join('/'));
  },
  groupEmptyRemove,
  infoGet,
};
