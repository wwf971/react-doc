import { makeAutoObservable } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocStore } from './DocStore.js';
import type { DocConfigStore } from './DocConfigStore.js';
import { tagAssetKeyGet } from '../lib/doc-tag-declare.js';
import { tagAssetGet, tagDisplayGet, tagModelBuild } from '../lib/doc-tag-model.js';
import { tagOverviewBuild } from '../lib/doc-tag-overview.js';

// Tag service of the doc page. Design: doc_page_impl_tag.md
// The tag model is derived from the source manifest (source step) and the
// side-panel tree (side-panel step), so it follows HMR and config changes.
// Renderers query tags here instead of reading side-panel yaml nodes, because
// the tags of one asset can be declared in several places.

export type TagAttached = { id: string; data: Record<string, any>; origin?: any };
export type TagDisplay = { id: string; compName: string; data: Record<string, any> };
export type TagAsset = { assetKey: string; assetType: string; assetId: string };

export class DocTagStore {
  sourceStore: DocSourceStore;
  docStore: DocStore;
  configStore: DocConfigStore;
  // tag whose overview popup is open; '' when closed
  overviewTagId = '';
  // stable query object handed to registered components through config
  tagService: Readonly<Record<string, (...args: any[]) => any>>;

  constructor(sourceStore: DocSourceStore, docStore: DocStore, configStore: DocConfigStore) {
    this.sourceStore = sourceStore;
    this.docStore = docStore;
    this.configStore = configStore;
    this.tagService = Object.freeze({
      assetKeyGet: (assetType: string, assetId: string) => tagAssetKeyGet(assetType, assetId),
      assetListGet: (tagId: string) => this.assetListGet(tagId),
      overviewGet: (tagId: string) => this.overviewGet(tagId),
      tagDefineGet: (tagId: string) => this.tagDefineGet(tagId),
      tagDisplayListGet: (assetKey: string) => this.tagDisplayListGet(assetKey),
      tagIdListGet: () => this.tagIdList,
      tagListGet: (assetKey: string) => this.tagListGet(assetKey),
      tagListGetByDoc: (docPath: string) => this.tagListGetByDoc(docPath),
    });
    makeAutoObservable(this, {
      configStore: false,
      docStore: false,
      sourceStore: false,
      tagService: false,
    });
  }

  get tagModel() {
    return tagModelBuild({
      configDoc: this.sourceStore.configDoc,
      fileManifest: this.sourceStore.fileManifest,
      declarationListSidePanel: this.docStore.treeModel.tagDeclarationList,
    });
  }

  // every tag known to the page: defined in config, or attached somewhere
  get tagIdList(): string[] {
    return this.tagModel.tagIdList;
  }

  tagListGet(assetKey: string): TagAttached[] {
    return this.tagModel.tagListByAssetKey.get(assetKey) ?? [];
  }

  tagListGetByDoc(docPath: string): TagAttached[] {
    return this.tagListGet(tagAssetKeyGet('doc', docPath));
  }

  tagDisplayListGet(assetKey: string): TagDisplay[] {
    return this.tagListGet(assetKey).map((tag) => tagDisplayGet(this.tagModel, tag));
  }

  tagDefineGet(tagId: string): any {
    return this.tagModel.tagDefineById.get(tagId);
  }

  assetListGet(tagId: string): TagAsset[] {
    return (this.tagModel.assetKeyListByTagId.get(tagId) ?? []).map(tagAssetGet);
  }

  // ---------- tag overview ----------

  overviewGet(tagId: string): any {
    return tagOverviewBuild({
      treeModel: this.docStore.treeModel,
      tagModel: this.tagModel,
      entryByPath: this.sourceStore.entryByInternalPath,
      tagId,
    });
  }

  get isOverviewPopupOn(): boolean {
    return this.configStore.valueGlobalGet('TagsOverviewPopupIsOn') === true;
  }

  overviewOpen(tagId: string): boolean {
    if (!this.isOverviewPopupOn || !tagId) return false;
    this.overviewTagId = tagId;
    return true;
  }

  overviewClose() {
    this.overviewTagId = '';
  }
}
