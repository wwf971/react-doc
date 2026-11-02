import { makeAutoObservable } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocStore, NavigationFocus } from './DocStore.js';
import {
  backlinkGroupListBuild,
  linkIndexInvert,
  referrerListGet,
} from '../lib/doc-link-index.js';
import { sourcePathNameGet } from '../lib/doc-source-path.js';
import { textLocalizedGet } from '../lib/text-localized.js';

// The backlinks of the page (design: doc_page_impl_nav_backlink.md): what
// the link index of the workspace says about the current document, and the
// two ways a backlink is followed. The index comes with the source data
// (DocSourceStore.linkIndex) and is inverted here once per change of the
// index or of the source; navigation stays with DocStore.

export type Backlink = {
  docPath: string;
  reference: {
    target: string;
    kind: 'document' | 'source' | 'asset';
    construct: string;
    sourceLine?: number;
    blockLine: number;
    headingTrail: string[];
    context?: { before: string; label: string; after: string };
  };
  index: number;
  fragment: string;
  targetPath: string;
  key: string;
};

export type BacklinkGroup = { docPath: string; backlinkList: Backlink[] };

export class DocLinkStore {
  sourceStore: DocSourceStore;
  docStore: DocStore;

  constructor({ sourceStore, docStore }: { sourceStore: DocSourceStore; docStore: DocStore }) {
    this.sourceStore = sourceStore;
    this.docStore = docStore;
    makeAutoObservable(this, { sourceStore: false, docStore: false });
  }

  // the backlinks panel is offered (config backlink.isEnabled, default true)
  get isEnabled(): boolean {
    return this.sourceStore.configDoc?.backlink?.isEnabled !== false;
  }

  // the page received a link index (a host building its own manifest may give none)
  get isIndexAvailable(): boolean {
    return Boolean(this.sourceStore.linkIndex);
  }

  // every backlink of the index by the path it resolves to, resolved
  // against the source as it is now
  get backlinkListByTarget(): Map<string, Backlink[]> {
    return linkIndexInvert(this.sourceStore.linkIndex, this.sourceStore.sourceIndex) as Map<string, Backlink[]>;
  }

  backlinkListGet(docPath: string): Backlink[] {
    return this.backlinkListByTarget.get(docPath) ?? [];
  }

  // the documents that reference a file, with how many references each
  referrerListGet(docPath: string): { docPath: string; count: number }[] {
    return referrerListGet(this.backlinkListByTarget, docPath);
  }

  // the position of a document in the side panel (its first item), for the
  // order of the groups; a document without an item comes last
  get orderByDocPath(): Map<string, number> {
    const orderByDocPath = new Map<string, number>();
    const items: any[] = this.docStore.treeModel?.items ?? [];
    items.forEach((item, index) => {
      if (item.docPath && !orderByDocPath.has(item.docPath)) orderByDocPath.set(item.docPath, index);
    });
    return orderByDocPath;
  }

  // the backlinks of the current document, grouped by the document they
  // are written in, in side-panel order
  get backlinkGroupListCurrent(): BacklinkGroup[] {
    const docPath = this.docStore.docCurrentPath;
    if (!docPath) return [];
    const orderByDocPath = this.orderByDocPath;
    return backlinkGroupListBuild(
      this.backlinkListGet(docPath),
      (path: string) => orderByDocPath.get(path) ?? Number.POSITIVE_INFINITY,
    ) as BacklinkGroup[];
  }

  get backlinkCountCurrent(): number {
    return this.backlinkGroupListCurrent.reduce((count, group) => count + group.backlinkList.length, 0);
  }

  // how a document is called in the list: its side-panel label, else its
  // title, else its file name
  docLabelGet(docPath: string): string {
    const itemId = this.docStore.treeModel?.itemIdsByDocPath?.get(docPath)?.[0];
    const item = itemId ? this.docStore.treeModel.itemById.get(itemId) : undefined;
    const textItem = item?.textLocalized !== undefined
      ? textLocalizedGet(item.textLocalized, this.docStore.languageDisplay).text
      : '';
    if (textItem) return textItem;
    const entry = this.sourceStore.entryByInternalPath.get(docPath);
    return entry?.title || sourcePathNameGet(docPath) || docPath;
  }

  // ---------- following a backlink ----------

  // the focus a backlink asks the navigation for: the reference as written,
  // where it is, and the heading to fall back on
  static focusGet(backlink: Backlink): NavigationFocus {
    const { reference } = backlink;
    const heading = reference.headingTrail[reference.headingTrail.length - 1];
    return {
      kind: 'link',
      target: reference.target,
      sourceLine: reference.sourceLine,
      blockLine: reference.blockLine,
      ...(heading ? { heading } : {}),
    };
  }

  // opens the document the backlink is written in, at the reference
  backlinkOpen(backlink: Backlink): boolean {
    return this.docStore.navigate(backlink.docPath, '', { focus: DocLinkStore.focusGet(backlink) });
  }

  // goes to the place of the current document the backlink points at
  backlinkTargetOpen(backlink: Backlink): boolean {
    if (!backlink.fragment) return false;
    return this.docStore.navigate(`${backlink.targetPath}#${backlink.fragment}`);
  }

  backlinkTargetIsCurrent(backlink: Backlink): boolean {
    return Boolean(backlink.fragment)
      && backlink.targetPath === this.docStore.docCurrentPath
      && backlink.fragment === this.docStore.docCurrentHash;
  }
}
