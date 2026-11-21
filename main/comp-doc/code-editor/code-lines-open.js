import { useEffect, useRef } from 'react';

// Opening the dialog of the lines of a code block from elsewhere on the page
// (doc_page_impl_mdx_code.md#editing-the-lines): every code block drawn on
// the page, a tile of the icon view or a block of another view, registers how
// its dialog opens, under the key of the block (its state key, which the
// block also carries as data-code-key on its element). The editor of a list
// item opens the dialog of a chip of its text this way, after saving the item.
//
//   useCodeLinesOpener(key, open)   in the component of the block, while mounted
//   codeLinesOpen(key)              true when a block under that key opened its dialog

const openerByKey = new Map();

export function codeLinesOpen(key) {
  const open = key ? openerByKey.get(key) : undefined;
  if (!open) return false;
  open();
  return true;
}

export function useCodeLinesOpener(key, open) {
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!key) return undefined;
    const opener = () => openRef.current();
    openerByKey.set(key, opener);
    return () => {
      if (openerByKey.get(key) === opener) openerByKey.delete(key);
    };
  }, [key]);
}
