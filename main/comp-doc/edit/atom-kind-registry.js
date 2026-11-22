import { mathAtomKind } from '../../../built-in/comp-mdx/math/math-atom.js';

// all kinds of atoms the package registers, by id ({layer}/{name}), as
// slash-registry.js holds the slash actions: a thing a component writes inside
// a text that the editor of the text types as one character, drawn as a chip,
// its value edited by the component below the chip
// (doc_page_impl_edit_structure.md#atoms-of-a-kind). each is defined by the
// component it belongs to; the edit layer knows none of them by name. a host
// adds or replaces kinds through DocPageMdx config.atomKindById.
export const atomKindById = {
  // a formula of LaTeX, $…$ in a line or $$ on lines of its own: the built-in
  // component math (built-in/comp-mdx/math, comp_math.md)
  'text/math': mathAtomKind,
};
