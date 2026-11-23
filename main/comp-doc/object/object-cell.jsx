import { cellBraceTextBuild } from '../../frontend/src/lib/doc-cell.js';
import { objectRefIsValid } from '../../frontend/src/lib/doc-object-ref.js';
import { cellTokenDefine } from '../cell/cell-define.js';
import { ObjectViewHost } from './ObjectViewHost.jsx';
import { objectSlashActionBuild } from './object-slash.js';

// A view of an object in a cell (doc_page_impl_edit_cell.md#token-kinds,
// doc_page_impl_obj.md#writing-a-reference): the token kind the object
// service layer offers the cell editing kit. The token is a brace token with
// the sigil "@", holding a reference of the registry, of an object or of
// something inside one:
//
//   {{@frontend:w5j7ozoijzl}}                      a frontend object
//   {{@frontend:w5j7ozoijzl#/book/sci-fi/dune}}    one of its data items, by a path
//   {{@doc:~example:root/guide.md#setup}}          a section of a document
//
// It is drawn by the view of the object's types in the context inline, as
// every consumer of the registry draws an object (ObjectViewHost): the cell
// knows no type. It is typed with /object, or by typing "{{@". Marked in the
// typed text, its card is the view of its types in the context panel
// (doc_page_impl_edit_cell.md#the-card-of-a-token): whatever type it names says
// what is shown there and what may be changed (a value of a profile typed in
// place); the fallback shows the object's card.
export const OBJECT_CELL_SIGIL = '@';

export const objectCellToken = cellTokenDefine({
  name: 'object',
  label: 'Object',
  description: 'a view of an object, or of something inside one: {{@reference}}',
  brace: { sigil: OBJECT_CELL_SIGIL },
  read: (body) => (objectRefIsValid(body) ? { ref: body } : undefined),
  Render: ObjectCellRender,
  // the label the registry knows it by; the reference while it knows nothing
  textGet: (token, cell) => cell?.object?.resolveStateGet(token.data.ref).descriptor.label ?? token.data.ref,
  slashAction: objectSlashActionBuild({ textBuild: (ref) => cellBraceTextBuild(ref, OBJECT_CELL_SIGIL) }),
  Card: ObjectCellCard,
  // drawn, a click on the object opens it as before: the card is offered while the text is typed
  cardPlaceList: ['surface'],
});

function ObjectCellRender({ token, cell }) {
  return <ObjectViewHost objectRef={token.data.ref} context="inline" isEditable={false} sourcePath={cell?.sourcePath} />;
}

// the card of a token naming an object: the object in the context panel, where it may be changed
// (the cell is being typed, so the consumer allows it; the view and its layer decide), and closed
// by the view when its work is done (config.objectView.close)
function ObjectCellCard({ token, cell, close }) {
  return <ObjectViewHost objectRef={token.data.ref} context="panel" isEditable sourcePath={cell?.sourcePath} onClose={close} />;
}
