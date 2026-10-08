// Stable adapter for the body function of a compiled document.
//
// every compilation of a document produces a new `Body` function. rendered
// directly as <Body components={...} />, a recompiled document is a new
// element type to React, and the whole document subtree is replaced: every
// component remounts and loses its state, even when one block changed.
// rendered through this one component, whose type never changes, React
// reconciles the elements the body returns against the mounted tree, so the
// blocks that did not change keep their DOM and their state.
//
// the `key` of the element is the content path of the document, so a
// different document still resets component state.
//
//   Body         the compiled body of this compiler's output (MdxRenderer /
//                compileDoc), a function of { components }
//   components   the component mapping of the page
export function MdxBody({ Body, components }) {
  return Body({ components });
}
