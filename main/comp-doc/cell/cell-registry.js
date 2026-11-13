import { linkCellToken } from '../link/link-cell.jsx';
import { objectCellToken } from '../object/object-cell.jsx';

// all token kinds the package registers for cells, by id ({layer}/{name}),
// the counterpart of slashActionById in slash/slash-registry.js. each is
// defined by the service layer it belongs to, beside that layer's other
// code; the cell edit layer knows none of them by name. a host adds or
// replaces kinds through DocPageMdx config.cellTokenById, and a component
// brings its own to its cells (doc_page_impl_edit_cell.md#token-kinds).
export const cellTokenById = {
  // the navigation layer: a link to a document, [label](target)
  'nav/link': linkCellToken,
  // the object service layer: a view of an object or of something inside one, {{@reference}}
  'object/view': objectCellToken,
};
