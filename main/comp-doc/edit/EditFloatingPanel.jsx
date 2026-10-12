import { useContext } from 'react';
import { createPortal } from 'react-dom';
import { DocEditBlockContext, DocEditBlockFloatContext } from './DocEditDocContext.js';
import { DocEditBlockModeButton } from './DocEditBlockModeButton.jsx';
import './DocEdit.css';

// The floating bar of an editor: everything that exists only for editing
// and has no place in the block itself. It overlaps the content around the
// block, so the block keeps its place and height when editing starts
// (doc_page_impl_edit.md#no-jitter-rule). One compact row holds the label,
// the editor's controls, and the Save / Cancel actions; fields that need more
// room (ImageEdit) go into the body below the row.
//
// in a block whose component has more than one edit mode (or view mode),
// the mode switch of the block follows the label (DocEditBlockModeButton),
// so the author can move to another edit mode without leaving the block
// first: choosing one saves this session and opens the block again in it.
//
//   label        what is being edited, first in the row
//   head         controls after the label (level, list type, add row, ...)
//   actions      the EditActions of the editor, last in the row
//   children     the body below the row (fields), optional
//   placement    'above' (default): the bar goes into the floating area of
//                the block (DocEditBlock), over the gap above the block, and
//                stays at the top of the block's visible range while the
//                block is scrolled; 'below': absolutely under the block
//
// pressing a button of the bar does not take the focus away from the
// editing surface, so a control (H1..H6) applies to the text being typed.
export function EditFloatingPanel({ label, head, actions, children, placement = 'above', className = '' }) {
  const floatElement = useContext(DocEditBlockFloatContext);
  // the block the bar belongs to; null for the frontmatter / whole-source panel
  const editBlock = useContext(DocEditBlockContext);

  const mouseDownHandle = (event) => {
    if (event.target.closest?.('button')) event.preventDefault();
  };

  const panel = (
    <div
      className={`doc-edit-panel not-prose${className ? ` ${className}` : ''}`}
      data-placement={placement}
      role="toolbar"
      aria-label={label ? `Edit ${label}` : 'Edit'}
      onMouseDown={mouseDownHandle}
    >
      <div className="doc-edit-panel-row">
        {label ? <span className="doc-edit-panel-label">{label}</span> : null}
        {editBlock ? <DocEditBlockModeButton blockIndex={editBlock.blockIndex} size="panel" /> : null}
        {head}
        {actions}
      </div>
      {children ? <div className="doc-edit-panel-body">{children}</div> : null}
    </div>
  );

  if (placement === 'above' && floatElement) return createPortal(panel, floatElement);
  return panel;
}
