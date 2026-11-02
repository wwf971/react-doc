import { docTargetResolve } from './doc-target-resolve.js';
import { sourcePathIsRooted } from './doc-source-path.js';

// The link index of the workspace (design: doc_page_impl_nav_backlink.md#the-link-index):
// every reference every document writes, read on the development server and
// at build time by plugin/doc-link-index.ts from the scan that also prunes a
// build, and handed to the page with the source data. This module is what
// the page does with it, free of stores and the DOM: the backlinks of a file
// are the references of the index that resolve to it, resolved the way the
// page resolves a link (lib/doc-target-resolve.js).
//
//   linkIndex   { version, byDoc: { [docPath]: { contentHash, linkList: [reference] } } }
//   reference   { target, kind, construct, sourceLine?, blockLine, headingTrail, context? }
//               (DocSourceDependency of plugin/doc-source-dependency.ts, without its sourcePath)
//   backlink    { docPath, reference, index, fragment, targetPath, key }
//               docPath: the document the reference is written in; index:
//               its position in that document's list; fragment: the place
//               after "#" in its target, '' when none; key: stable identity

export const LINK_INDEX_VERSION = 1;

export function linkIndexBuild(byDoc) {
  return { version: LINK_INDEX_VERSION, byDoc };
}

// the files a reference resolves to, as the page resolves it: a document or
// an asset target by the link grammar, the document's own doc page first
// (DocLink); a source target only as a rooted source path (SourceLink)
export function referenceEntryListGet(reference, fromPath, sourceIndex) {
  const target = String(reference?.target ?? '');
  if (reference?.kind === 'source') {
    if (!sourcePathIsRooted(target.split('#', 1)[0])) return [];
    return docTargetResolve(target, fromPath, sourceIndex, { isLocalFirst: false }).entryList;
  }
  return docTargetResolve(target, fromPath, sourceIndex).entryList;
}

export function referenceFragmentGet(reference) {
  const target = String(reference?.target ?? '');
  const indexHash = target.indexOf('#');
  return indexHash >= 0 ? target.slice(indexHash + 1) : '';
}

// every backlink of the index, by the path it resolves to. a reference
// that resolves to several files (an ambiguous name) is a backlink of each
// of them, so a document never misses a link that may reach it; a
// document's references to itself are left out.
export function linkIndexInvert(linkIndex, sourceIndex) {
  const backlinkListByTarget = new Map();
  for (const [docPath, doc] of Object.entries(linkIndex?.byDoc ?? {})) {
    const linkList = Array.isArray(doc?.linkList) ? doc.linkList : [];
    linkList.forEach((reference, index) => {
      for (const entry of referenceEntryListGet(reference, docPath, sourceIndex)) {
        if (entry.internalPath === docPath) continue;
        const backlinkList = backlinkListByTarget.get(entry.internalPath) ?? [];
        backlinkList.push({
          docPath,
          reference,
          index,
          fragment: referenceFragmentGet(reference),
          targetPath: entry.internalPath,
          key: `${docPath}:${index}`,
        });
        backlinkListByTarget.set(entry.internalPath, backlinkList);
      }
    });
  }
  for (const backlinkList of backlinkListByTarget.values()) backlinkList.sort(backlinkCompare);
  return backlinkListByTarget;
}

// by document, then by where the reference is written in it
export function backlinkCompare(backlinkA, backlinkB) {
  if (backlinkA.docPath !== backlinkB.docPath) return backlinkA.docPath < backlinkB.docPath ? -1 : 1;
  const lineA = backlinkA.reference.sourceLine ?? backlinkA.reference.blockLine ?? 0;
  const lineB = backlinkB.reference.sourceLine ?? backlinkB.reference.blockLine ?? 0;
  if (lineA !== lineB) return lineA - lineB;
  return backlinkA.index - backlinkB.index;
}

// the backlinks of a file grouped by the document they are written in:
// [{ docPath, backlinkList }], the documents ordered by orderGet(docPath)
// (a position in the side panel; Infinity for a document without one, which
// then follows by path)
export function backlinkGroupListBuild(backlinkList, orderGet = () => 0) {
  const groupByDocPath = new Map();
  for (const backlink of backlinkList) {
    const group = groupByDocPath.get(backlink.docPath) ?? { docPath: backlink.docPath, backlinkList: [] };
    group.backlinkList.push(backlink);
    groupByDocPath.set(backlink.docPath, group);
  }
  return [...groupByDocPath.values()].sort((groupA, groupB) => {
    const orderA = orderGet(groupA.docPath);
    const orderB = orderGet(groupB.docPath);
    if (orderA !== orderB) return orderA < orderB ? -1 : 1;
    return groupA.docPath < groupB.docPath ? -1 : groupA.docPath > groupB.docPath ? 1 : 0;
  });
}

// the documents that reference a file, with how many references each:
// [{ docPath, count }], in the order of the backlinks
export function referrerListGet(backlinkListByTarget, targetPath) {
  const countByDocPath = new Map();
  for (const backlink of backlinkListByTarget.get(targetPath) ?? []) {
    countByDocPath.set(backlink.docPath, (countByDocPath.get(backlink.docPath) ?? 0) + 1);
  }
  return [...countByDocPath].map(([docPath, count]) => ({ docPath, count }));
}
