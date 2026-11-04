import { computed, makeAutoObservable } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocStore, NavigationFocus } from './DocStore.js';
import {
  backlinkGroupListBuild,
  linkIndexResolve,
  referrerListGet,
} from '../lib/doc-link-index.js';
import { sourcePathNameGet } from '../lib/doc-source-path.js';
import { textLocalizedGet } from '../lib/text-localized.js';

// The links and backlinks of the page (design: doc_page_impl_nav_backlink.md):
// what the link index of the workspace says about a document, and the two
// ways a backlink is followed. The index comes with the source data
// (DocSourceStore.linkIndex) and is resolved here once per change of the
// index or of the source, into one list of links seen both ways: the links
// a document writes, and the backlinks of a file. Both the Backlinks panel
// and the object registry (the relations doc.link,
// lib/doc-object-provider-link.js) read them here; navigation stays with
// DocStore.

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
    // the resolution is kept while the index and the source are unchanged,
    // also for callers outside a reaction (the object registry's queries)
    makeAutoObservable(this, { sourceStore: false, docStore: false, linkResolved: computed({ keepAlive: true }) });
  }

  // the backlinks panel is offered (config backlink.isEnabled, default true)
  get isEnabled(): boolean {
    return this.sourceStore.configDoc?.backlink?.isEnabled !== false;
  }

  // the page received a link index (a host building its own manifest may give none)
  get isIndexAvailable(): boolean {
    return Boolean(this.sourceStore.linkIndex);
  }

  // every reference of the index resolved against the source as it is now:
  // { linkListByDoc, backlinkListByTarget }, the same links both ways
  get linkResolved(): { linkListByDoc: Map<string, Backlink[]>; backlinkListByTarget: Map<string, Backlink[]> } {
    return linkIndexResolve(this.sourceStore.linkIndex, this.sourceStore.sourceIndex) as any;
  }

  get backlinkListByTarget(): Map<string, Backlink[]> {
    return this.linkResolved.backlinkListByTarget;
  }

  // what the links depend on: when a value changes, what was derived from
  // them (the registry's answers) is derived again. plain observables, so a
  // caller outside a reaction compares like values
  versionGet(): any[] {
    return [this.sourceStore.linkIndex, this.sourceStore.fileManifest];
  }

  backlinkListGet(docPath: string): Backlink[] {
    return this.backlinkListByTarget.get(docPath) ?? [];
  }

  // the links a document writes, in order; one that resolves to nothing has targetPath ''
  linkListOfDoc(docPath: string): Backlink[] {
    return this.linkResolved.linkListByDoc.get(docPath) ?? [];
  }

  // the links written in a section of a document: those under its heading.
  // the heading is named by its id when the document is compiled on this
  // page, else the fragment is taken as its title (the rules of a fragment,
  // doc_page_impl_nav.md#fragment-targets-titles-and-declared-ids)
  linkListOfPlace(docPath: string, fragment: string): Backlink[] {
    const heading = this.sourceStore.headingListGet(docPath)?.find((item) => item.id === fragment);
    const titleLower = (heading?.title ?? fragment).toLowerCase();
    return this.linkListOfDoc(docPath).filter((link) => link.reference.headingTrail.some((title) => title.toLowerCase() === titleLower));
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
