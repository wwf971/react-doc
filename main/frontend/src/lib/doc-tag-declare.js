// Tag declaration rules shared by the vite plugin (source step) and the
// browser (side-panel step). Design: doc_page_impl_tag.md
//
// authored forms of a "tags" value:
//   tags: chapter
//   tags: [chapter, guide]
//   tags:
//     - chapter
//     - id: version
//       data: { text: v2 }
//
// normalized tag: { id, data }

// an asset is anything a tag can be attached to.
//   doc     collected source file, id = internal path  (/rootId/a.md)
//   folder  source folder,         id = internal path  (/rootId/sub)
//   item    side-panel item that is bound to neither, id = item id
export const tagAssetTypeList = ['doc', 'folder', 'item'];

export function tagAssetKeyGet(assetType, assetId) {
  return `${assetType}:${assetId}`;
}

export function tagAssetKeyParse(assetKey) {
  const key = String(assetKey ?? '');
  const indexColon = key.indexOf(':');
  if (indexColon < 0) return { assetType: '', assetId: key };
  return { assetType: key.slice(0, indexColon), assetId: key.slice(indexColon + 1) };
}

export function tagListNormalize(value) {
  if (value === undefined || value === null) return [];
  const valueList = Array.isArray(value) ? value : [value];
  const tagList = [];
  for (const valueItem of valueList) {
    const tag = tagNormalize(valueItem);
    if (tag) tagList.push(tag);
  }
  return tagList;
}

function tagNormalize(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    const id = String(value).trim();
    return id ? { id, data: {} } : undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const id = String(value.id ?? '').trim();
  if (!id) return undefined;
  const data = value.data && typeof value.data === 'object' && !Array.isArray(value.data)
    ? value.data
    : {};
  return { id, data };
}

// later declarations win:
//   same id       -> the later tag replaces the earlier one, keeping its position
//   different id  -> the later tag is appended
// origin (optional) records which step declared the tag.
export function tagListMerge(tagListBase, tagListNext, origin) {
  const tagListResult = [...(tagListBase ?? [])];
  for (const tag of tagListNext ?? []) {
    const tagMerged = origin ? { ...tag, origin } : tag;
    const indexExisting = tagListResult.findIndex((tagExisting) => tagExisting.id === tag.id);
    if (indexExisting >= 0) tagListResult[indexExisting] = tagMerged;
    else tagListResult.push(tagMerged);
  }
  return tagListResult;
}
