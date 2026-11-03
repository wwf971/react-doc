import { referenceEntryListGet, referenceFragmentGet } from './doc-link-index.js';
import { objectRefParse } from './doc-object-ref.js';

// The links of the workspace as relations of the object registry (design:
// doc_page_impl_obj.md#documents-as-objects): the navigation layer's link
// index (doc_page_impl_nav_backlink.md#the-link-index) stays its internal
// representation, kept and changed by it alone; this provider answers
// relation queries from it, in both directions, the way the backlinks
// panel inverts it.
//
//   doc.link  from doc:{the document a reference is written in}
//             to   doc:{the file it resolves to}[#{fragment}], one relation
//                  per file when a bare name matches several; a reference
//                  that resolves to nothing is kept, to doc:{target as
//                  written}, with data.isResolved false
//             key  {document}:{position of the reference}, stable while the
//                  document is unchanged
//             data the entry as the index keeps it: target, kind, construct,
//                  sourceLine, blockLine, headingTrail, context

export function objectProviderLinkCreate({ sourceStore, linkStore }) {
  const relationListOfDoc = (docPath) => {
    const linkList = sourceStore.linkIndex?.byDoc?.[docPath]?.linkList ?? [];
    const relationList = [];
    linkList.forEach((reference, index) => {
      const fragment = referenceFragmentGet(reference);
      const entryList = referenceEntryListGet(reference, docPath, sourceStore.sourceIndex);
      const data = { ...reference, isResolved: entryList.length > 0 };
      if (entryList.length === 0) {
        relationList.push({ key: `${docPath}:${index}`, type: 'doc.link', fromRef: `doc:${docPath}`, toRef: `doc:${reference.target}`, order: index, label: reference.context?.label ?? '', data });
        return;
      }
      for (const entry of entryList) {
        if (entry.internalPath === docPath) continue;
        relationList.push({
          key: entryList.length > 1 ? `${docPath}:${index}:${entry.internalPath}` : `${docPath}:${index}`,
          type: 'doc.link',
          fromRef: `doc:${docPath}`,
          toRef: fragment ? `doc:${entry.internalPath}#${fragment}` : `doc:${entry.internalPath}`,
          order: index,
          label: reference.context?.label ?? '',
          data,
        });
      }
    });
    return relationList;
  };

  // the document part and the fragment of a doc reference
  const docRefSplit = (ref) => {
    const parsed = objectRefParse(ref);
    if (parsed?.namespace !== 'doc') return undefined;
    const indexHash = parsed.local.indexOf('#');
    return indexHash < 0 ? { path: parsed.local, fragment: '' } : { path: parsed.local.slice(0, indexHash), fragment: parsed.local.slice(indexHash + 1) };
  };

  return {
    id: 'doc-link',
    label: 'the links of the workspace',
    registry: 'page',
    // it owns no objects: only relations between the doc source's objects
    namespaceList: [],
    typeList: [],
    relationTypeList: ['doc.link'],
    capabilityList: ['relationQuery'],
    versionGet: () => [sourceStore.linkIndex, sourceStore.fileManifest],
    cacheSecond: 300,
    statusGet: () => (sourceStore.linkIndex
      ? { status: 'ready', message: '' }
      : { status: 'unavailable', message: 'the page received no link index (a host building its own source data)' }),

    relationQuery: (spec, registry) => {
      if (!spec.typeList.some((asked) => registry.isAssignable('doc.link', asked))) return [];
      const from = docRefSplit(spec.fromRef);
      const to = docRefSplit(spec.toRef);
      if (from) {
        // the links written in a section are those under its heading
        const relationList = relationListOfDoc(from.path);
        return from.fragment ? relationList.filter((relation) => relation.data.headingTrail?.length > 0) : relationList;
      }
      if (to) {
        // the inverse: the backlinks of the document (of the place, with a fragment)
        const backlinkList = linkStore.backlinkListGet(to.path).filter((backlink) => !to.fragment || backlink.fragment === to.fragment);
        return backlinkList.map((backlink) => ({
          key: backlink.key,
          type: 'doc.link',
          fromRef: `doc:${backlink.docPath}`,
          toRef: backlink.fragment ? `doc:${backlink.targetPath}#${backlink.fragment}` : `doc:${backlink.targetPath}`,
          order: backlink.index,
          label: backlink.reference.context?.label ?? '',
          data: { ...backlink.reference, isResolved: true },
        }));
      }
      return { relationList: [], isComplete: false, message: 'the links are listed from or to a document, not all of them' };
    },
  };
}
