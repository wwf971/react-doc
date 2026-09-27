import { tagAssetKeyGet, tagAssetKeyParse, tagListMerge } from './doc-tag-declare.js';

// Resolves every tag declaration of the doc page into one tag model.
// Design: doc_page_impl_tag.md
//
//   1. default        every asset has no tags
//   2. source step    tags declared by source rules (manifest entry.tagList)
//   3. side panel     tags declared on side-panel items, in tree order
//   -> each step merges over the earlier ones with tagListMerge():
//      same tag id replaces, a different tag id is appended
//
// declaration: { assetKey, tagList, origin }
// tagModel: {
//   tagListByAssetKey   assetKey -> [{ id, data, origin }]
//   assetKeyListByTagId tagId -> [assetKey]
//   tagDefineById       tagId -> { id, text, compName, data, isDefined }
//   tagIdList           defined tags first, then undeclared ones in first-use order
// }
export function tagModelBuild({ configDoc, fileManifest, declarationListSidePanel = [] }) {
  const declarationList = [
    ...tagDeclarationListSourceGet(fileManifest),
    ...declarationListSidePanel,
  ];

  const tagListByAssetKey = new Map();
  for (const declaration of declarationList) {
    const tagListMerged = tagListMerge(
      tagListByAssetKey.get(declaration.assetKey),
      declaration.tagList,
      declaration.origin,
    );
    if (tagListMerged.length > 0) tagListByAssetKey.set(declaration.assetKey, tagListMerged);
  }

  const assetKeyListByTagId = new Map();
  for (const [assetKey, tagList] of tagListByAssetKey) {
    for (const tag of tagList) {
      const assetKeyList = assetKeyListByTagId.get(tag.id) ?? [];
      assetKeyList.push(assetKey);
      assetKeyListByTagId.set(tag.id, assetKeyList);
    }
  }

  const tagDefineById = tagDefineByIdBuild(configDoc);
  for (const tagId of assetKeyListByTagId.keys()) {
    if (!tagDefineById.has(tagId)) tagDefineById.set(tagId, tagDefineDefaultGet(tagId));
  }

  return {
    tagListByAssetKey,
    assetKeyListByTagId,
    tagDefineById,
    tagIdList: [...tagDefineById.keys()],
  };
}

// what a renderer needs to display one attached tag:
// definition display data, overridden by the data declared with the tag.
export function tagDisplayGet(tagModel, tag) {
  const define = tagModel.tagDefineById.get(tag.id) ?? tagDefineDefaultGet(tag.id);
  return {
    id: tag.id,
    compName: define.compName,
    data: {
      ...define.data,
      ...tag.data,
      tagId: tag.id,
      text: tag.data?.text ?? define.text,
    },
  };
}

export function tagAssetGet(assetKey) {
  const { assetType, assetId } = tagAssetKeyParse(assetKey);
  return { assetKey, assetType, assetId };
}

function tagDeclarationListSourceGet(fileManifest = []) {
  const declarationList = [];
  for (const entry of fileManifest) {
    if (!Array.isArray(entry.tagList) || entry.tagList.length === 0) continue;
    declarationList.push({
      assetKey: tagAssetKeyGet('doc', entry.internalPath),
      // source tags already carry the rule that declared them
      tagList: entry.tagList,
      origin: undefined,
    });
  }
  return declarationList;
}

// config:
//   tag:
//     defineById:
//       chapter:
//         text: Chapter
//         display: { component: Tag, data: { colorBorder: '#d97706', colorBackground: '#fef3c7' } }
function tagDefineByIdBuild(configDoc) {
  const tagDefineById = new Map();
  const defineById = configDoc?.tag?.defineById ?? {};
  for (const [tagId, define] of Object.entries(defineById)) {
    const defineValue = define && typeof define === 'object' ? define : {};
    tagDefineById.set(tagId, {
      id: tagId,
      text: String(defineValue.text ?? tagId),
      compName: String(defineValue.display?.component ?? 'Tag'),
      data: defineValue.display?.data ?? {},
      isDefined: true,
    });
  }
  return tagDefineById;
}

function tagDefineDefaultGet(tagId) {
  return { id: tagId, text: tagId, compName: 'Tag', data: {}, isDefined: false };
}
