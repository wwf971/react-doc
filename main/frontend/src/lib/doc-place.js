// A place in a document (design: doc_page_impl_nav.md#places-in-a-document):
// where something of a document is, for a list that points back at it (the
// blocks that use an asset object) and for a link that takes the reader there.
//
//   { docPath, sourceLine, fragment }
//
//   docPath     the source path of the document (~page:root/xx/a.md, the full form)
//   sourceLine  the line of the block's marker comment, counted in the content
//               without frontmatter: the block identity the page uses
//               elsewhere (DocComp sourceLine, the edit model's markerLine).
//               it identifies the block now and moves with every edit above it
//   fragment    the stable id declared for the place (an Anchor marker before
//               the block), '' when none: the part a link navigates with

export function docPlaceBuild({ docPath = '', sourceLine = 0, fragment = '' } = {}) {
  return {
    docPath: String(docPath ?? ''),
    sourceLine: Number.isInteger(Number(sourceLine)) ? Number(sourceLine) : 0,
    fragment: String(fragment ?? ''),
  };
}

// the navigation target of a place, in the document-link grammar: the
// document with its fragment, or the document alone. a line is not a
// navigation target: it is right only until the next edit above it.
export function docPlaceTargetGet(place) {
  if (!place?.docPath) return '';
  return place.fragment ? `${place.docPath}#${place.fragment}` : place.docPath;
}

// how a place is written for a reader: a.md#fragment, or a.md:12
export function docPlaceTextGet(place) {
  if (!place?.docPath) return '';
  if (place.fragment) return `${place.docPath}#${place.fragment}`;
  return place.sourceLine > 0 ? `${place.docPath}:${place.sourceLine}` : place.docPath;
}

// the same block: the same document and the same marker line
export function docPlaceIsSame(placeA, placeB) {
  return Boolean(placeA && placeB) && placeA.docPath === placeB.docPath && placeA.sourceLine === placeB.sourceLine;
}
