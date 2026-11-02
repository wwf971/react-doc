import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  docSourceDependenciesCollect,
  type DocSourceDependency,
  type DocSourceDependencyCollect,
} from './doc-source-dependency.ts';
import { linkIndexBuild } from '../src/lib/doc-link-index.js';

// The link index of the workspace (design: doc_page_impl_nav_backlink.md#the-link-index),
// built on the development server when the source is scanned and at build
// time: for every document of the manifest, the references it writes, as
// the dependency scan of pruning finds them (doc-source-dependency.ts), each
// with where it is written. The index travels to the page with the source
// data (virtual:doc-source docLinkIndex, the doc-source-change event), and
// the page inverts it into the backlinks of a document (lib/doc-link-index.js).
//
// a document is scanned again only when its content changed, so a saved
// file costs one scan. the references are kept as written (their target
// text), never resolved here: the page resolves them against the source as
// it is when it asks, with the same resolver as every link.

export type DocLinkIndexReference = Omit<DocSourceDependency, 'sourcePath'>;
export type DocLinkIndexDoc = { contentHash: string; linkList: DocLinkIndexReference[] };
export type DocLinkIndex = { version: number; byDoc: Record<string, DocLinkIndexDoc> };

type DocEntry = { internalPath: string; ext: string; absPath: string };

export class DocLinkIndexBuilder {
  private docByPath = new Map<string, DocLinkIndexDoc>();

  build(
    entries: DocEntry[],
    configDoc: any,
    collectByCompId: Record<string, DocSourceDependencyCollect> = {},
  ): DocLinkIndex {
    const byDoc: Record<string, DocLinkIndexDoc> = {};
    const pathSet = new Set<string>();
    for (const entry of entries) {
      if (entry.ext !== 'md' && entry.ext !== 'mdx') continue;
      let text: string;
      try {
        text = fs.readFileSync(entry.absPath, 'utf-8');
      } catch {
        continue;
      }
      pathSet.add(entry.internalPath);
      const contentHash = createHash('sha256').update(text).digest('hex');
      const docCached = this.docByPath.get(entry.internalPath);
      if (docCached && docCached.contentHash === contentHash) {
        byDoc[entry.internalPath] = docCached;
        continue;
      }
      const doc = { contentHash, linkList: documentReferenceListGet(text, entry, configDoc, collectByCompId) };
      this.docByPath.set(entry.internalPath, doc);
      byDoc[entry.internalPath] = doc;
    }
    for (const docPath of [...this.docByPath.keys()]) {
      if (!pathSet.has(docPath)) this.docByPath.delete(docPath);
    }
    return linkIndexBuild(byDoc) as DocLinkIndex;
  }
}

// the references of one document, without the path they are written in
// (the index keys them by it). a document that cannot be scanned has none.
export function documentReferenceListGet(
  text: string,
  entry: { internalPath: string; ext: string },
  configDoc: any,
  collectByCompId: Record<string, DocSourceDependencyCollect> = {},
): DocLinkIndexReference[] {
  let dependencyList: DocSourceDependency[];
  try {
    dependencyList = docSourceDependenciesCollect(text, entry, configDoc, collectByCompId).dependencyList;
  } catch (error) {
    console.warn(`[doc-source] link index: ${entry.internalPath} could not be scanned: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  return dependencyList.map(({ sourcePath: _sourcePath, ...reference }) => reference);
}
