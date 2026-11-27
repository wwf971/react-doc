import { useLayoutEffect, useRef, useState } from 'react';
import { EditActions } from '../../../main/comp-doc/edit/EditActions.jsx';
import { EditFloatingPanel } from '../../../main/comp-doc/edit/EditFloatingPanel.jsx';
import { mathRender } from './MathData.js';
import { MathSourceField } from './MathSourceField.jsx';
import 'katex/dist/katex.min.css';
import './math.css';

// A block of math held as data (comp_math.md#a-block-of-math-as-data): data.raw, its formula in LaTeX,
// where a block of a document is held as data (placement commentBlock: a card of a card diagram). What
// MathBlock draws for such a block; registered alone by an app with no documents (math-formula-comp.js:
// mathFormulaDefine), since it needs nothing of the document renderer. The stylesheet of KaTeX is
// imported here too: an app has not the page's (main/frontend/src/style.css)
//   otherwise     -> MathFormula: the formula drawn by KaTeX, set apart and centred
//   config.isEdit -> MathFormulaEdit: its mode Formula, the formula drawn where it stands; a click
//                    types its source below it (MathSourceField), drawn again as it is typed
export function MathFormulaBlock({ data = {}, config = {}, onEvent }) {
  const value = String(data.raw ?? '');
  if (config.isEdit) return <MathFormulaEdit value={value} config={config} onEvent={onEvent} />;
  return <MathFormula value={value} />;
}

// the formula drawn, set apart and centred; what is wrong with it on hover (KaTeX draws it as far as
// it goes, the faulty part in red)
function MathFormula({ value }) {
  const ref = useRef(null);
  const [message, messageSet] = useState('');
  useLayoutEffect(() => {
    if (ref.current) messageSet(mathRender(ref.current, value, true));
  }, [value]);
  return <div ref={ref} className="doc-math-formula" data-empty={value.trim() === '' ? '' : undefined} data-error={message ? '' : undefined} data-label="A formula" title={message || undefined} />;
}

// its mode Formula. In place (config.edit.isInPlace: an owner keeping it open, a card of a card
// diagram): the formula stands as read; a click opens its source below it, out of the flow (nothing
// moves), drawn again as it is typed; Enter on a new line, Ctrl/⌘ + Enter or a click elsewhere keeps
// it (one change reported, editDraftChange { raw }), Escape gives it up. While its source is open, a
// drag on it does not move what holds it (nodrag nopan). In a session of a block (a block of it in a
// document, its marker and a fence): its source open at once, each change reported as the draft, the
// floating bar of the block with Save and Cancel
function MathFormulaEdit({ value, config, onEvent }) {
  const edit = config.edit ?? {};
  const isInPlace = edit.isInPlace === true;
  const session = edit.session ?? {};
  const isLocked = session.status === 'submitting';
  const drawRef = useRef(null);
  const [isOpen, isOpenSet] = useState(!isInPlace);
  const [typed, typedSet] = useState(value);
  const [message, messageSet] = useState('');
  // the field mounted again (the caret back in it) after a click on the formula
  const [fieldKey, fieldKeySet] = useState(0);
  const typedRef = useRef(typed);
  typedRef.current = typed;
  // what is drawn: the source being typed while it is open, else the data (an undo of the owner
  // changes it under the formula)
  const shown = isOpen ? typed : value;

  useLayoutEffect(() => {
    if (drawRef.current) messageSet(mathRender(drawRef.current, shown, true));
  }, [shown]);

  const open = () => {
    if (isLocked) return;
    if (!isOpen) {
      typedSet(value);
      isOpenSet(true);
    }
    fieldKeySet((key) => key + 1);
  };
  const close = (isKept) => {
    if (isInPlace) {
      isOpenSet(false);
      if (isKept && typedRef.current !== value) void onEvent?.('editDraftChange', { raw: typedRef.current });
      return;
    }
    if (isKept) void onEvent?.('editSubmitRequest');
    else void onEvent?.('editCancelRequest');
  };
  const leave = (how) => {
    if (isLocked) return;
    if (how === 'cancel') close(false);
    else if (how === 'remove') {
      typedSet('');
      typedRef.current = '';
      close(true);
    } else if (how === 'done' || how === 'blur' || (isInPlace && (how === 'before' || how === 'after'))) close(true);
  };

  return (
    <>
      <div
        ref={drawRef}
        className={`doc-math-formula is-editing${isOpen ? ' is-open nodrag nopan' : ''}`}
        data-empty={shown.trim() === '' ? '' : undefined}
        data-error={message ? '' : undefined}
        data-label="A formula: click to type it"
        title={message || (isOpen ? undefined : 'Click to type its LaTeX')}
        onPointerDown={(event) => {
          // open: the caret stays in its source (the field is mounted again with it)
          if (!isOpen) return;
          event.preventDefault();
          fieldKeySet((key) => key + 1);
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (!isOpen) open();
        }}
      />
      {isOpen ? (
        <MathSourceField
          key={fieldKey}
          anchorGet={() => drawRef.current}
          value={typedRef.current}
          isRow
          message={message}
          onChange={(valueNext) => {
            typedSet(valueNext);
            if (!isInPlace) void onEvent?.('editDraftChange', { raw: valueNext });
          }}
          onLeave={leave}
        />
      ) : null}
      {!isInPlace ? (
        <EditFloatingPanel
          label={edit.label ?? 'Math'}
          actions={<EditActions status={session.status} message={session.message} onSubmit={() => close(true)} onCancel={() => close(false)} />}
        />
      ) : null}
    </>
  );
}
