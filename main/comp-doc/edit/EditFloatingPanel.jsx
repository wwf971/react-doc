import { useLayoutEffect, useRef, useState } from 'react';
import './DocEdit.css';

// The floating bar of an editor: everything that exists only for editing
// and has no place in the block itself. It is absolutely positioned against
// the block wrapper, above the block by default, and overlaps the content
// around it, so the block keeps its place and height when editing starts
// (doc_page_impl_edit.md#no-jitter-rule). One compact row holds the label,
// the editor's controls, and the Save / Cancel actions; fields that need more
// room (ImageEdit) go into the body below the row.
//
//   label        what is being edited, first in the row
//   head         controls after the label (level, list type, add row, ...)
//   actions      the EditActions of the editor, last in the row
//   children     the body below the row (fields), optional
//   placement    'above' (default; falls back to 'below' when the bar would
//                be out of view or covered) | 'below'
//
// pressing a button of the bar does not take the focus away from the
// editing surface, so a control (H1..H6) applies to the text being typed.
export function EditFloatingPanel({ label, head, actions, children, placement = 'above', className = '' }) {
  const elementRef = useRef(null);
  const [placementShown, placementShownSet] = useState(placement);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || placement !== 'above') return;
    // the bar is placed above first; when its top-left corner is off-screen
    // or hidden behind a sticky header, it goes below the block instead
    const rect = element.getBoundingClientRect();
    const elementAtCorner = document.elementFromPoint(rect.left + 2, rect.top + 2);
    if (!elementAtCorner || !element.contains(elementAtCorner)) placementShownSet('below');
  }, [placement]);

  const mouseDownHandle = (event) => {
    if (event.target.closest?.('button')) event.preventDefault();
  };

  return (
    <div
      ref={elementRef}
      className={`doc-edit-panel not-prose${className ? ` ${className}` : ''}`}
      data-placement={placementShown}
      role="toolbar"
      aria-label={label ? `Edit ${label}` : 'Edit'}
      onMouseDown={mouseDownHandle}
    >
      <div className="doc-edit-panel-row">
        {label ? <span className="doc-edit-panel-label">{label}</span> : null}
        {head}
        {actions}
      </div>
      {children ? <div className="doc-edit-panel-body">{children}</div> : null}
    </div>
  );
}
