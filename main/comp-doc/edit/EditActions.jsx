import { Check, LoaderCircle, X } from '../../frontend/UICommon.js';
import './DocEdit.css';

// The Save / Cancel actions of every editor, placed last in the row of the
// floating bar, with the state of the pending change request. Editors never
// talk to the server: Save emits editSubmitRequest, Cancel emits
// editCancelRequest, the edit layer applies them and reports status / message.
// Leaving the editor in any other non-canceling way (clicking outside, another
// block, the toolbar) saves as well, so Save is the explicit form of leaving.
//
//   status       'editing' | 'submitting' | 'error'
//   message      shown when status is 'error'
//   titleCancel  the tooltip of Cancel, for an editor whose Escape does
//                something else (a visual editor's Escape leaves a cell)
//   children     extra actions placed after Cancel
export function EditActions({
  status = 'editing',
  message = '',
  labelSubmit = 'Save',
  titleCancel = 'Cancel (Esc)',
  isSubmitDisabled = false,
  onSubmit,
  onCancel,
  children,
}) {
  const isSubmitting = status === 'submitting';
  return (
    <>
      <span className="doc-edit-actions" role="group" aria-label="Edit actions">
        <button
          type="button"
          className="doc-button" data-primary=""
          disabled={isSubmitting || isSubmitDisabled}
          title={`${labelSubmit} (Ctrl/⌘ + Enter)`}
          onClick={() => onSubmit?.()}
        >
          {isSubmitting
            ? <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-spin" />
            : <Check aria-hidden="true" size={12} strokeWidth={2.2} />}
          <span>{labelSubmit}</span>
        </button>
        <button type="button" className="doc-button" disabled={isSubmitting} title={titleCancel} onClick={() => onCancel?.()}>
          <X aria-hidden="true" size={12} strokeWidth={2.2} />
          <span>Cancel</span>
        </button>
        {children}
      </span>
      {status === 'error' && message ? (
        <span className="doc-error doc-edit-message" role="alert">{message}</span>
      ) : null}
    </>
  );
}
