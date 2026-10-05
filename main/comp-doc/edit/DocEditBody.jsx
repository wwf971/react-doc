import { useMemo, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { DocEditDocContext } from './DocEditDocContext.js';
import { DocEditBlock } from './DocEditBlock.jsx';
import { DocEditBorder } from './DocEditBorder.jsx';
import { DocEditBlockEditor } from './DocEditBlockEditor.jsx';
import { editFocusRelease, useEditOutsidePointer } from './use-edit-outside-pointer.js';
import './DocEdit.css';

// The document body in edit mode, rendered by DocPageView instead of the
// reading body. It looks exactly like the reading body: the compiled edit
// body with every root block wrapped in DocEditBlock, borders between them
// that take no height, and one zero-height border after the last block for
// inserting at the end. Nothing is added to the flow when edit mode is
// toggled (doc_page_impl_edit.md#no-jitter-rule).
//
// the frontmatter and whole-source sessions (started from the toolbar,
// DocEditDocControls) float their editor at the top of the body.
//
// when the document does not compile, the error is shown in place of the
// blocks; the whole source stays editable from the toolbar, so the file can
// be repaired from the page.
//
//   path       internal path of the document
//   docEdit    DocEditStore.docEditActiveGet(path)
//   mdxComps   the component mapping of the reading body

// the model while the document does not compile
const modelEmpty = { blockList: [], lineList: [], lineCount: 0 };

export const DocEditBody = observer(function DocEditBody({ path, docEdit, mdxComps }) {
  const { editStore, sourceStore } = useDocStores();
  const entry = sourceStore.entryByInternalPath.get(path);
  const format = entry?.ext === 'mdx' ? 'mdx' : 'md';
  const model = docEdit.model ?? modelEmpty;
  const contextValue = useMemo(() => ({ path, model, format }), [path, model, format]);
  const mdxCompsEdit = useMemo(() => ({ ...mdxComps, DocEditBlock }), [mdxComps]);
  const isTopSession = editStore.sessionIs(path, 'frontmatter') || editStore.sessionIs(path, 'document');
  const Body = docEdit.Body;

  return (
    <DocEditDocContext.Provider value={contextValue}>
      <div className="doc-edit-body" data-stale={editStore.docEditIsStale(path) ? '' : undefined}>
        {isTopSession ? <DocEditTopSession /> : null}
        {docEdit.status === 'error' ? (
          <div className="doc-edit-compile-error not-prose" role="alert">
            <strong>The document does not compile.</strong>
            <pre>{docEdit.message}</pre>
            <span>Edit the whole source (toolbar) to repair it.</span>
          </div>
        ) : (
          <>
            {docEdit.isContentEmpty ? (
              <p className="doc-content-empty">This document is empty. Insert the first block below.</p>
            ) : Body ? (
              <Body components={mdxCompsEdit} />
            ) : null}
            <DocEditBorder indexBefore={model.blockList.length} />
          </>
        )}
      </div>
    </DocEditDocContext.Provider>
  );
});

// the frontmatter / whole-source editor: a zero-height anchor at the top of
// the body from which the panel floats. like a block, the session is left
// (saved) by a pointer going down outside or Ctrl/⌘ + Enter, canceled by Escape.
const DocEditTopSession = observer(function DocEditTopSession() {
  const { editStore } = useDocStores();
  const elementRef = useRef(null);
  useEditOutsidePointer(elementRef, true, () => void editStore.sessionLeave());

  const keyDownHandle = (event) => {
    if (event.defaultPrevented || event.nativeEvent?.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      void editStore.sessionCancel();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      editFocusRelease(elementRef.current);
      void editStore.sessionLeave();
    }
  };

  return (
    <div ref={elementRef} className="doc-edit-top-anchor" onKeyDown={keyDownHandle}>
      <DocEditBlockEditor />
    </div>
  );
});
