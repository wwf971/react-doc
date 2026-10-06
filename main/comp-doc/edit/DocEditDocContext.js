import { createContext, useContext } from 'react';

// the document the edit body is rendering: { path, model, format }. block
// wrappers and borders are rendered from inside the compiled body, where
// they only know their block index; the context gives them the rest.
export const DocEditDocContext = createContext(null);

export function useDocEditDoc() {
  const value = useContext(DocEditDocContext);
  if (!value) throw new Error('edit layer components must be rendered inside <DocEditBody/>');
  return value;
}

// the floating area of the block being rendered: the element inside the
// block's sticky anchor that EditFloatingPanel portals its bar into, so the
// bar stays at the top of the block's visible range (DocEditBlock). null
// outside a block (the frontmatter / whole-source panel).
export const DocEditBlockFloatContext = createContext(null);
