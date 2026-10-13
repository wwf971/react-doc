import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { BlockRender } from '../../comp-mdx/text/BlockRender.jsx';
import { DocEditBlockContext, DocEditBlockFloatContext, useDocEditDoc } from './DocEditDocContext.js';
import { DocEditBlockToolbar } from './DocEditBlockToolbar.jsx';
import { DocEditBlockEditor, blockLabelGet } from './DocEditBlockEditor.jsx';
import {
  EDIT_CLICK_OWN_SELECTOR,
  clickAfterPointerDownSuppress,
  editFocusRelease,
  useEditOutsidePointer,
} from './use-edit-outside-pointer.js';
import './DocEdit.css';

// The wrapper remarkEditBlock puts around every root-level block of the
// compiled edit body (<DocEditBlock blockIndex>...</DocEditBlock>). It owns
// the floating controls of its block and, while the block's session is
// open, hands the block to its editor. The editor edits the block in its
// place and floats its controls, so nothing else on the page moves.
//
// floating controls: the first child of the wrapper is a zero-height sticky
// anchor; the toolbar (DocEditBlockToolbar) and the bar of the editor
// (EditFloatingPanel, placement above) are laid out from its bottom edge
// upward, over the gap above the block. the anchor sticks below the top of
// the scroll container by the height of what floats in it, so when the top
// of the block is scrolled out of view, the controls stay at the top of the
// block's visible range (doc_page_impl_edit.md#floating-controls).
//
// a block that is not being edited renders exactly as in reading mode: no
// outline, no background; only its toolbar appears on hover. the session is
// entered with the toolbar's Edit button, or, when EditBlockEnterMode is
// 'click', with a click anywhere on the block. entering is reported as an
// event (editBlockEnterRequest, source: this document and this block) with
// the pointer position as the event point, and travels through the event
// layer to DocEditStore (doc_page_impl_event.md); with a point the caret
// opens at the text nearest to where the block was clicked. only one block
// of a document is in edit mode at a time (the store holds one session).
// the session is left, saving the draft, when a pointer goes down outside
// the block or Ctrl/⌘ + Enter is pressed in it; Escape cancels it.
//
// geometry lock: while the block is edited, the wrapper keeps the height and
// the gaps to its neighbors that the block had in view mode (measured by
// useGeometryLock the moment the session starts, before the editor is
// rendered, and set as inline styles). the editor's in-flow root has no outer
// margins and paints the page background (DocEdit.css), so when the source
// needs more room than the rendered block it extends over the next block
// instead of pushing it down, and when it needs less the block keeps its
// height (doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule).
//
// blocks that render nothing visible (a comment, trailing component markers)
// get a small floating chip, so they can be found and edited.
export const DocEditBlock = observer(function DocEditBlock({ blockIndex, children }) {
  const { editStore, eventRouter, onEvent: onEventPage } = useDocStores();
  const { path, model, format } = useDocEditDoc();
  const elementRef = useRef(null);
  const anchorRef = useRef(null);
  const [floatElement, floatElementSet] = useState(null);
  const index = Number(blockIndex);
  const block = model.blockList[index];
  const isEditing = Boolean(block) && editStore.sessionIs(path, 'block', index);
  const geometryLock = useGeometryLock(elementRef, editStore, path, index);
  useEditOutsidePointer(elementRef, isEditing, () => void editStore.sessionLeave());
  useFloatHeightFollow(anchorRef, floatElement);
  const blockContextValue = useMemo(() => ({ path, blockIndex: index }), [path, index]);
  if (!block) return children;
  const isDeletePending = editStore.deleteConfirmIs(path, index);
  const isOpen = isDeletePending
    || editStore.insertMenuIs(path, index)
    || editStore.blockMoveIs(path, index)
    || editStore.blockAssetMoveIs(path, index)
    || editStore.blockModeMenuIs(path, index);
  const isInvisible = block.kind === 'html' || block.kind === 'marker';
  // a read-only component cannot be entered, by a click or otherwise
  const isEnterByClick = editStore.blockEnterMode === 'click' && !editStore.blockIsReadOnly(path, index);
  const textPending = editStore.blockTextPendingGet(path, index);
  const label = blockLabelGet(block);

  // entering the block's session is reported as an event; point is where
  // the pointer was (a pointer event can be passed), undefined for a report
  // without one
  const enterRequest = (point) => {
    const event = eventRouter.eventBuild({
      type: 'editBlockEnterRequest',
      source: { placement: 'editBlock', sourcePath: path, blockIndex: index },
      point,
    });
    void eventRouter.dispatch(event, { onEventHost: onEventPage });
  };

  // EditBlockEnterMode 'click': a click anywhere on the block starts its
  // session, with the caret where the block was clicked; the block's own
  // controls (buttons, editable values, form fields) and everything in its
  // floating area (the toolbar, the insert menu with its search results)
  // keep working and never enter the block. a popup of the edit layer
  // portaled to the body (the mode menu) still bubbles its clicks through
  // the React tree to here.
  const clickCaptureHandle = (event) => {
    if (!isEnterByClick || isEditing) return;
    if (event.target.closest?.(EDIT_CLICK_OWN_SELECTOR)) return;
    event.preventDefault();
    event.stopPropagation();
    enterRequest(event);
  };

  // the geometry lock keeps the wrapper at the height the block had in view
  // mode; an editor shorter than that leaves uncovered wrapper space below
  // it. a primary click on that bare space is a click outside the editor:
  // it leaves the session like a pointer going down outside the block. only
  // the wrapper itself counts, so the editor, its fields, buttons, and the
  // rendered content keep working; a right click does nothing.
  //
  // the click of that same gesture is hit-tested after the leave, once the
  // block is back in view mode and fills the space that was empty. with
  // EditBlockEnterMode 'click' that click would enter the block again, so
  // it is swallowed.
  const pointerDownHandle = (event) => {
    if (!isEditing || event.button !== 0 || event.target !== event.currentTarget) return;
    editFocusRelease(elementRef.current);
    clickAfterPointerDownSuppress();
    void editStore.sessionLeave();
  };

  // keys not handled by a control of the editor: Escape cancels, Ctrl/⌘ +
  // Enter leaves (saves). focus is released first so an inline value commits.
  // an open mode menu of the block takes Escape first: it closes, the
  // session stays.
  const keyDownHandle = (event) => {
    if (!isEditing || event.defaultPrevented || event.nativeEvent?.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (editStore.blockModeMenuIs(path, index)) {
        editStore.blockModeMenuClose();
        return;
      }
      void editStore.sessionCancel();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      editFocusRelease(elementRef.current);
      void editStore.sessionLeave();
    }
  };

  let content;
  if (isEditing) {
    content = <DocEditBlockEditor block={block} viewRendered={children} />;
  } else if (textPending !== undefined) {
    content = (
      <BlockRender data={{ text: textPending }} config={{ format, sourcePath: path }}>
        {children}
      </BlockRender>
    );
  } else if (isInvisible) {
    content = (
      <button
        type="button"
        className="doc-edit-block-chip not-prose"
        title={block.text}
        onClick={() => enterRequest(undefined)}
      >
        {block.kind === 'marker' ? 'markers' : 'comment'}: {block.text.split('\n')[0]}
      </button>
    );
  } else {
    content = children;
  }

  return (
    <DocEditBlockFloatContext.Provider value={floatElement}>
    <DocEditBlockContext.Provider value={blockContextValue}>
      <div
        ref={elementRef}
        className="doc-edit-block"
        data-block-index={index}
        data-first={index === 0 ? '' : undefined}
        data-last={index === model.blockList.length - 1 ? '' : undefined}
        data-kind={block.kind}
        data-depth={block.depth}
        data-editing={isEditing ? '' : undefined}
        data-open={isOpen ? '' : undefined}
        data-enter-click={isEnterByClick && !isEditing ? '' : undefined}
        data-delete-pending={isDeletePending ? '' : undefined}
        data-invisible={isInvisible && !isEditing ? '' : undefined}
        data-geometry-locked={isEditing && geometryLock ? '' : undefined}
        style={isEditing && geometryLock ? geometryLock : undefined}
        onClickCapture={clickCaptureHandle}
        onKeyDown={keyDownHandle}
        onPointerDown={pointerDownHandle}
      >
        <div ref={anchorRef} className="doc-edit-block-anchor not-prose">
          <div ref={floatElementSet} className="doc-edit-block-float">
            {isEditing ? null : <DocEditBlockToolbar blockIndex={index} label={label} />}
          </div>
        </div>
        {content}
      </div>
    </DocEditBlockContext.Provider>
    </DocEditBlockFloatContext.Provider>
  );
});

// the inline styles that keep the wrapper at the geometry its block had in
// view mode while the block is edited, or null while it is not. the mobx
// reaction runs synchronously when the session changes, before React renders
// the editor, so the wrapper still holds the rendered block when it is
// measured. a block that mounts already in a session (one just created) has
// no view geometry and gets none.
function useGeometryLock(elementRef, editStore, path, index) {
  const [geometryLock, geometryLockSet] = useState(null);
  useEffect(() => reaction(
    () => editStore.sessionIs(path, 'block', index),
    (isEditing) => {
      geometryLockSet(isEditing ? blockGeometryMeasure(elementRef.current) : null);
    },
  ), [elementRef, editStore, path, index]);
  return geometryLock;
}

// the height of the wrapper and its distances to the previous and the next
// block (or to the edge of the body for the first and the last block). the
// distances are the collapsed margins between the blocks; given to the
// wrapper as its own margins they collapse with the neighbors' margins to
// the same distances, whatever the editor renders in the wrapper.
function blockGeometryMeasure(wrapper) {
  if (!wrapper) return null;
  const rect = wrapper.getBoundingClientRect();
  const parent = wrapper.parentElement;
  const parentStyle = getComputedStyle(parent);
  const parentContentTop = parent.getBoundingClientRect().top + parent.clientTop + parseFloat(parentStyle.paddingTop);
  const parentContentBottom = parent.getBoundingClientRect().top + parent.clientTop + parent.clientHeight - parseFloat(parentStyle.paddingBottom);
  const previous = wrapper.previousElementSibling;
  const next = wrapper.nextElementSibling;
  const edgeTop = previous ? previous.getBoundingClientRect().bottom : parentContentTop;
  const edgeBottom = next ? next.getBoundingClientRect().top : parentContentBottom;
  return {
    height: `${rect.height}px`,
    marginTop: `${Math.max(0, rect.top - edgeTop)}px`,
    marginBottom: `${Math.max(0, edgeBottom - rect.bottom)}px`,
  };
}

// keeps --doc-edit-float-height of the anchor equal to the height of what
// floats in it (the toolbar, or the editor bar with its fields), which is
// the distance the anchor sticks below the sticky rows of the layout
function useFloatHeightFollow(anchorRef, floatElement) {
  const heightApply = () => {
    const anchor = anchorRef.current;
    if (!anchor || !floatElement) return;
    anchor.style.setProperty('--doc-edit-float-height', `${floatElement.offsetHeight}px`);
  };
  // after every commit of the block: the toolbar and the editor bar replace
  // each other when a session starts or ends
  useLayoutEffect(heightApply);
  // between commits: the bar grows with a message, a field, a wrapped row
  useLayoutEffect(() => {
    if (!floatElement) return undefined;
    const observer = new ResizeObserver(heightApply);
    observer.observe(floatElement);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floatElement]);
}
