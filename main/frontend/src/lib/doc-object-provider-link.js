import { docRefSplit } from './doc-object-provider-doc.js';

// The links of the workspace as relations of the object registry (design:
// doc_page_impl_obj.md#documents-as-objects): the navigation layer's link
// index (doc_page_impl_nav_backlink.md#the-link-index) stays its internal
// representation, kept and changed by it alone, and resolved by it once
// (DocLinkStore.linkResolved). This provider only says its links in the
// registry's words, in both directions, so a backlink of the panel and a
// doc.link relation are one entry seen from two places.
//
//   doc.link  from doc:{the document a reference is written in}
//             to   doc:{the file it resolves to}[#{fragment}], one relation
//                  per file when a bare name matches several; a reference
//                  that resolves to nothing is kept, to doc:{target as
//                  written}, with data.isResolved false
//             key  the link's key, {document}:{position of the reference}
//                  (and :{file} for each file of an ambiguous one), stable
//                  while the document is unchanged
//             data the entry as the index keeps it: target, kind, construct,
//                  sourceLine, blockLine, headingTrail, context

export function objectProviderLinkCreate({ linkStore }) {
  return {
    id: 'doc-link',
    label: 'the links of the workspace',
    registry: 'page',
    // it owns no objects: only relations between the doc source's objects
    namespaceList: [],
    typeList: [],
    relationTypeList: ['doc.link'],
    capabilityList: ['relationQuery'],
    versionGet: () => linkStore.versionGet(),
    cacheSecond: 300,
    statusGet: () => (linkStore.isIndexAvailable
      ? { status: 'ready', message: '' }
      : { status: 'unavailable', message: 'the page received no link index (a host building its own source data)' }),

    relationQuery: (spec, registry) => {
      if (!spec.typeList.some((asked) => registry.isAssignable('doc.link', asked))) return [];
      const from = docRefSplit(spec.fromRef);
      const to = docRefSplit(spec.toRef);
      if (from) {
        // the links written in a section are relations from the section
        if (from.fragment) return linkStore.linkListOfPlace(from.path, from.fragment).map((link) => ({ ...relationOfLink(link), fromRef: spec.fromRef }));
        return linkStore.linkListOfDoc(from.path).map(relationOfLink);
      }
      if (to) {
        // the inverse: the backlinks of the document, or of the place with a
        // fragment (a link to a place is a relation to the place, not to its document)
        return linkStore.backlinkListGet(to.path).filter((link) => link.fragment === to.fragment).map(relationOfLink);
      }
      return { relationList: [], isComplete: false, message: 'the links are listed from or to a document, not all of them' };
    },
  };
}

// a link of the navigation layer as a relation of the registry
function relationOfLink(link) {
  const isResolved = link.targetPath !== '';
  const toPath = isResolved ? link.targetPath : link.reference.target;
  return {
    key: link.key,
    type: 'doc.link',
    fromRef: `doc:${link.docPath}`,
    toRef: isResolved && link.fragment ? `doc:${toPath}#${link.fragment}` : `doc:${toPath}`,
    order: link.index,
    label: link.reference.context?.label ?? '',
    data: { ...link.reference, isResolved },
  };
}
