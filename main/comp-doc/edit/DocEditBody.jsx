import { useMemo, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { MdxBody } from '../../frontend/src/lib/MdxBody.jsx';
import { DocEditDocContext, useDocEditDoc } from './DocEditDocContext.js';
import { Plus } from '../../frontend/UICommon.js';
import { DocEditBlock } from './DocEditBlock.jsx';
import { DocEditBlockEditor } from './DocEditBlockEditor.jsx';
import { DocEditInsertMenu } from './DocEditInsertMenu.jsx';
import { editFocusRelease, useEditOutsidePointer } from './use-edit-outside-pointer.js';
import './DocEdit.css';

// The document body in edit mode, rendered by DocPageView instead of the
// reading body. It looks exactly like the reading body: the compiled edit
// body with every root block wrapped in DocEditBlock, whose controls float.
// Nothing is added to the flow when edit mode is toggled
// (doc_page_impl_edit.md#no-jitter-rule). blocks are inserted from the
// toolbar of a neighbor block; an empty document offers its insert button
// in the notice that replaces the body.
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
              <DocEditEmptyNotice />
            ) : Body ? (
              // the stable adapter keeps the mounted blocks across a save:
              // only the changed block renders anew (lib/MdxBody.jsx)
              <MdxBody key={path} Body={Body} components={mdxCompsEdit} />
            ) : null}
          </>
        )}
      </div>
    </DocEditDocContext.Provider>
  );
});

// an empty document has no block toolbar to insert from: the notice carries
// the insert button; its menu creates block 0
const DocEditEmptyNotice = observer(function DocEditEmptyNotice() {
  const { editStore } = useDocStores();
  const { path } = useDocEditDoc();
  const elementRef = useRef(null);
  const isMenuHere = editStore.insertMenuIs(path, -1);
  useEditOutsidePointer(elementRef, isMenuHere, () => editStore.insertMenuClose());

  return (
    <div ref={elementRef} className="doc-edit-empty not-prose">
      <span className="doc-content-empty">This document is empty.</span>
      <div className="doc-edit-toolbar" data-open={isMenuHere ? '' : undefined}>
        <div className="doc-edit-toolbar-actions">
          <button type="button" disabled={editStore.isSubmitting} aria-pressed={isMenuHere}
            title="Insert the first block" aria-label="Insert the first block"
            onClick={() => void (isMenuHere ? editStore.insertMenuClose() : editStore.insertMenuOpen(path, -1, 0))}>
            <Plus aria-hidden="true" size={11} strokeWidth={2.2} />
            <span>Insert a block</span>
          </button>
        </div>
        {isMenuHere ? <DocEditInsertMenu /> : null}
      </div>
    </div>
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
