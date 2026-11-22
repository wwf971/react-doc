import { useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { EditActions } from '../../../main/comp-doc/edit/EditActions.jsx';
import { EditFloatingPanel } from '../../../main/comp-doc/edit/EditFloatingPanel.jsx';
import { mathRender, mathSourceBuild, mathSpanListGet } from './MathData.js';
import { MathSourceField } from './MathSourceField.jsx';
import './math.css';

// A block of math edited in its place (comp_math.md#a-block-of-math):
// the formula stays drawn where the document draws it, as KaTeX draws it there,
// so entering and leaving the block moves nothing; its source is typed in the
// field below it (MathSourceField), and the formula is drawn again as it is
// typed. The floating bar above it holds the label and Save / Cancel, as for
// every block.
//
//   ┌ Math block ─────────────── Save  Cancel ┐   the bar, over the gap above
//              x^2 + \frac{a}{b}                  the formula, drawn
//   ┌────────────────────────────────────────┐
//   │ x^2 + \frac{a}{b}▏                      │   its source
//   └────────────────────────────────────────┘
//
// the keys of the field: ↑ on its first line / ← at its start go on to the
// block before, ↓ / → at its end to the block after (the block is saved);
// Ctrl/⌘ + Enter saves; Escape cancels; Backspace in an empty source takes the
// block out. a click on the formula puts the caret back into the field.
//
// the draft reported is the whole block, $$ lines included (editDraftChange),
// so a leave of any kind saves it as the other editors' drafts are saved
export const MathBlockEdit = observer(function MathBlockEdit({ data = {}, config = {}, onEvent }) {
  const edit = config.edit ?? {};
  const session = edit.session ?? {};
  const isLocked = session.status === 'submitting';
  const drawRef = useRef(null);
  const [valueInitial] = useState(() => mathBlockValueGet(String(data.text ?? '')));
  const [value, valueSet] = useState(valueInitial);
  const [message, messageSet] = useState('');
  // the field mounted again (the caret back in it) after a click on the formula
  const [fieldKey, fieldKeySet] = useState(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  useLayoutEffect(() => {
    if (drawRef.current) messageSet(mathRender(drawRef.current, value, true));
  }, [value]);

  const submitRequest = () => {
    if (isLocked) return;
    void onEvent?.(valueRef.current.trim() === '' ? 'editBlockRemoveRequest' : 'editSubmitRequest');
  };
  const cancelRequest = () => {
    if (isLocked) return;
    void onEvent?.('editCancelRequest');
  };
  const leave = (how) => {
    if (isLocked) return;
    if (how === 'before' || how === 'after') {
      void onEvent?.('editFocusShiftRequest', { direction: how === 'before' ? 'previous' : 'next' });
      return;
    }
    if (how === 'done') submitRequest();
    else if (how === 'cancel') cancelRequest();
    else if (how === 'remove') void onEvent?.('editBlockRemoveRequest');
    // blur: the field is left for something of the page; a pointer outside the
    // block leaves the session (and saves), as for every block
  };

  return (
    <>
      <div
        ref={drawRef}
        className="doc-math-block-edit"
        data-empty={value.trim() === '' ? '' : undefined}
        data-error={message ? '' : undefined}
        title={message || undefined}
        onPointerDown={(event) => {
          event.preventDefault();
          fieldKeySet((key) => key + 1);
        }}
      />
      <MathSourceField
        key={fieldKey}
        anchorGet={() => drawRef.current}
        value={valueRef.current}
        isRow
        message={message}
        onChange={(valueNext) => {
          valueSet(valueNext);
          void onEvent?.('editDraftChange', { text: mathSourceBuild(valueNext, true) });
        }}
        onLeave={leave}
      />
      <EditFloatingPanel
        label={edit.label ?? 'Math block'}
        actions={<EditActions status={session.status} message={session.message} onSubmit={submitRequest} onCancel={cancelRequest} />}
      />
    </>
  );
});

// the formula of a block of math: what is between its lines of $$
function mathBlockValueGet(text) {
  const span = mathSpanListGet(text).find((one) => one.isRow);
  if (span) return span.value;
  return text.replace(/^\s*\$\$[^\n]*\n?/, '').replace(/\n?\$\$\s*$/, '');
}
