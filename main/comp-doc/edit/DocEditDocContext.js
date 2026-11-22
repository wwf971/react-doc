import { createContext, useContext } from 'react';
import { useDocStores } from '../../frontend/src/store/context.js';

// the document the edit body is rendering: { path, format, mdxComps }. block
// wrappers and borders are rendered from inside the compiled body, where
// they only know their block index; the context gives them the rest.
//
// the model of the document is not in it: it is new on every write, and a
// context that changes draws every component reading it again, every block
// of the document (doc_page_impl_edit.md#a-write-draws-only-what-changed).
// a block reads what it draws from the store, per block (DocEditBlock); a
// component that needs the whole model reads it with useDocEditModel.
// mdxComps (the components the body is drawn with) is in it: when they change
// every block is drawn again, although its text did not.
export const DocEditDocContext = createContext(null);

export function useDocEditDoc() {
  const value = useContext(DocEditDocContext);
  if (!value) throw new Error('edit layer components must be rendered inside <DocEditBody/>');
  return value;
}

// the model of the document of the edit body (lib/doc-edit-block.js), read
// from the store: an observer reading it is drawn again on every write
const modelEmpty = { blockList: [], lineList: [], lineCount: 0 };

export function useDocEditModel() {
  const { editStore } = useDocStores();
  const { path } = useDocEditDoc();
  return editStore.docEditByPath[path]?.model ?? modelEmpty;
}

// the floating area of the block being rendered: the element inside the
// block's sticky anchor that EditFloatingPanel portals its bar into, so the
// bar stays at the top of the block's visible range (DocEditBlock). null
// outside a block (the frontmatter / whole-source panel).
export const DocEditBlockFloatContext = createContext(null);

// how far the block being drawn moved since the compile that made its
// elements: { path, shift }. a block moved by lines added above it is not
// drawn again (DocEditBlock); what its elements say of lines of the file (the
// sourceLine of a component, the data-source-line of a code block, the line
// of a link) is the line of that compile, and the reader of such a line adds
// the shift: useDocEditLineGet. only for its own document (path): a document
// drawn inside a block (a popup of a link, a document a component shows)
// counts its lines in its own text
export const DocEditLineShiftContext = createContext(null);

// (path) => (line) => the line now, of a line written on an element of the
// document at path (undefined: the document of the page, as the components
// of the page's body take it): the line plus the shift of the block it is
// drawn in
export function useDocEditLineGet(path) {
  const value = useContext(DocEditLineShiftContext);
  const { docStore } = useDocStores();
  const pathOwn = path ?? docStore?.docCurrentPath;
  const shift = value && value.path === pathOwn ? value.shift : 0;
  return (line) => {
    const number = Number(line);
    return Number.isFinite(number) && number > 0 && shift ? number + shift : line;
  };
}

// the block being rendered: { path, blockIndex }. a component rendered in
// the edit body learns its block from it (RegisteredComp puts it in the
// source of the component's events), so it can ask for its data to be
// replaced (dataReplaceRequest). null outside the edit body.
export const DocEditBlockContext = createContext(null);
