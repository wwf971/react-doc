import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { BlockRender } from '../../comp-mdx/text/BlockRender.jsx';
import { useDocEditDoc } from './DocEditDocContext.js';
import { DocEditBorder } from './DocEditBorder.jsx';
import { DocEditBlockEditor } from './DocEditBlockEditor.jsx';
import { editFocusRelease, useEditOutsidePointer } from './use-edit-outside-pointer.js';
import './DocEdit.css';

// The wrapper remarkEditBlock puts around every root-level block of the
// compiled edit body (<DocEditBlock blockIndex>...</DocEditBlock>). It draws
// the border above its block, enters the block's edit session on click, and,
// while that session is open, hands the block to its editor. The editor
// edits the block in its place and floats its controls, so nothing else on
// the page moves.
//
// a block that is not being edited renders exactly as in reading mode; only
// one block of a document is in edit mode at a time (the store holds one
// session). the session is left, saving the draft, when a pointer goes down
// outside the block or Ctrl/⌘ + Enter is pressed in it; Escape cancels it.
//
// blocks that render nothing visible (a comment, trailing component markers)
// get a small floating chip, so they can be found and edited.
export const DocEditBlock = observer(function DocEditBlock({ blockIndex, children }) {
  const { editStore } = useDocStores();
  const { path, model, format } = useDocEditDoc();
  const elementRef = useRef(null);
  const index = Number(blockIndex);
  const block = model.blockList[index];
  const isEditing = Boolean(block) && editStore.sessionIs(path, 'block', index);
  useEditOutsidePointer(elementRef, isEditing, () => void editStore.sessionLeave());
  if (!block) return children;
  const isDeletePending = editStore.deleteConfirmIs(path, index);
  const isInvisible = block.kind === 'html' || block.kind === 'marker';
  const textPending = editStore.blockTextPendingGet(path, index);

  // a click anywhere on the block starts its session; the block's own
  // controls (buttons, editable values, form fields) keep working
  const clickCaptureHandle = (event) => {
    if (isEditing) return;
    if (event.target.closest?.(clickOwnSelector)) return;
    event.preventDefault();
    event.stopPropagation();
    void editStore.sessionBlockStart(path, index);
  };

  // keys not handled by a control of the editor: Escape cancels, Ctrl/⌘ +
  // Enter leaves (saves). focus is released first so an inline value commits.
  const keyDownHandle = (event) => {
    if (!isEditing || event.defaultPrevented || event.nativeEvent?.isComposing) return;
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
        onClick={() => void editStore.sessionBlockStart(path, index)}
      >
        {block.kind === 'marker' ? 'markers' : 'comment'}: {block.text.split('\n')[0]}
      </button>
    );
  } else {
    content = children;
  }

  return (
    <>
      <DocEditBorder indexBefore={index} />
      <div
        ref={elementRef}
        className="doc-edit-block"
        data-block-index={index}
        data-first={index === 0 ? '' : undefined}
        data-last={index === model.blockList.length - 1 ? '' : undefined}
        data-kind={block.kind}
        data-depth={block.depth}
        data-editing={isEditing ? '' : undefined}
        data-delete-pending={isDeletePending ? '' : undefined}
        data-invisible={isInvisible && !isEditing ? '' : undefined}
        onClickCapture={clickCaptureHandle}
        onKeyDown={keyDownHandle}
      >
        {content}
      </div>
    </>
  );
});

const clickOwnSelector = 'button, [role="button"], input, select, textarea, summary, [contenteditable]:not([contenteditable="false"])';
