import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EDIT_POPUP_CLASS } from '../../../main/comp-doc/edit/use-edit-outside-pointer.js';
import './MathSourceField.css';

// The source of a formula, typed below it (comp_math.md):
// the editor of the atom kind math (math-atom.js), and of a block of math
// (MathBlockEdit). The formula stays where it is drawn, and the field floats under it, out of the
// flow of the page: opening and closing it moves nothing. The formula is drawn
// again as the source is typed (by whoever shows it: onChange); what KaTeX
// says is wrong is the line under the field.
//
//   ┌──────────────────────────────┐
//   │ x^2 + \frac{a}{b}▏            │   the source, in the code font of the page
//   └──────────────────────────────┘
//    Undefined control sequence: \fra   only while something is wrong
//
//   anchorGet()   the element of the formula (looked up again at every layout:
//                 the editor may draw it anew)
//   value         the source when the field opens; then the field's own
//   isRow         a formula of its own lines: its source may take several
//   message       what is wrong with the formula, '' when nothing
//   onChange(value)
//   onLeave(how)  'before' | 'after': the caret goes on before or after the
//                 formula (an arrow key at an edge of the source); 'done':
//                 the formula is typed (Enter); 'cancel': Escape (a formula
//                 among a text is typed so too; a block of math is left as
//                 it was, as Escape leaves every block); 'remove': the formula
//                 is taken out (Backspace in an empty source); 'blur': the
//                 focus went elsewhere
//
// the keys:
//   Enter              a formula in the line: done. a formula of its own
//                      lines: a line break; Ctrl/⌘ + Enter is done
//   Escape             cancel
//   ← at the start     before it; → at the end: after it
//   ↑ on the first line, ↓ on the last: before it, after it. in a formula
//                      of its own lines the caret first goes to the start
//                      (↑) or the end (↓) of the source, and leaves from there
//   Backspace, empty   the formula is taken out
export function MathSourceField({ anchorGet, value: valueInitial = '', isRow = false, message = '', onChange, onLeave }) {
  const isBlock = isRow;
  const fieldRef = useRef(null);
  const textareaRef = useRef(null);
  const [value, valueSet] = useState(String(valueInitial ?? ''));
  const [place, placeSet] = useState(null);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  // under the formula, kept inside the window; follows it when it is drawn
  // larger or smaller, and when the page scrolls
  useLayoutEffect(() => {
    let frame = 0;
    const placeMeasure = () => {
      const anchor = anchorGet();
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      const widthWindow = window.innerWidth - margin * 2;
      const width = Math.min(isBlock ? Math.max(rect.width, 320) : 420, widthWindow);
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - margin - width));
      placeSet((placeBefore) => (placeBefore && placeBefore.left === left && placeBefore.top === rect.bottom + 4 && placeBefore.width === width
        ? placeBefore
        : { left, top: rect.bottom + 4, width }));
    };
    placeMeasure();
    const placeLater = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(placeMeasure);
    };
    const anchor = anchorGet();
    const observer = anchor && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(placeLater) : undefined;
    if (anchor) observer?.observe(anchor);
    window.addEventListener('scroll', placeLater, { capture: true, passive: true });
    window.addEventListener('resize', placeLater);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('scroll', placeLater, { capture: true });
      window.removeEventListener('resize', placeLater);
    };
  }, [anchorGet, isBlock, value]);

  // the caret in the source at once, at its end: once the field is placed (a
  // field still hidden takes no focus)
  const isPlaced = place !== null;
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !isPlaced) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [isPlaced]);

  // as high as its lines
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value, place?.width]);

  const leave = (how) => onLeaveRef.current?.(how);

  const keyDownHandle = (event) => {
    if (event.nativeEvent?.isComposing) return;
    const textarea = event.currentTarget;
    const isCollapsed = textarea.selectionStart === textarea.selectionEnd;
    const caret = textarea.selectionStart;
    const isModified = event.metaKey || event.ctrlKey || event.altKey;
    const take = (how) => {
      event.preventDefault();
      event.stopPropagation();
      leave(how);
    };
    if (event.key === 'Escape') return take('cancel');
    if (event.key === 'Enter') {
      if (!isBlock || event.metaKey || event.ctrlKey) return take('done');
      event.stopPropagation();
      return undefined;
    }
    if (event.key === 'Backspace' && value === '' && !isModified) return take('remove');
    if (!isCollapsed || event.shiftKey || isModified) {
      event.stopPropagation();
      return undefined;
    }
    if (event.key === 'ArrowLeft' && caret === 0) return take('before');
    if (event.key === 'ArrowRight' && caret === value.length) return take('after');
    const isLineFirst = !value.slice(0, caret).includes('\n');
    const isLineLast = !value.slice(caret).includes('\n');
    // a formula of its own lines: ↑ on the first line goes to the start of
    // the source, ↓ on the last to its end, and only from there out of it
    const edgeGo = (offset) => {
      event.preventDefault();
      event.stopPropagation();
      textarea.setSelectionRange(offset, offset);
    };
    if (event.key === 'ArrowUp' && isLineFirst) return isBlock && caret > 0 ? edgeGo(0) : take('before');
    if (event.key === 'ArrowDown' && isLineLast) return isBlock && caret < value.length ? edgeGo(value.length) : take('after');
    // the keys of the source are its own: nothing around it takes them
    event.stopPropagation();
    return undefined;
  };

  // the focus gone elsewhere than the field: it closes (not into it again)
  const blurHandle = (event) => {
    if (fieldRef.current?.contains(event.relatedTarget)) return;
    leave('blur');
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={fieldRef}
      className={`doc-edit-math-field not-prose ${EDIT_POPUP_CLASS}`}
      data-block={isBlock ? '' : undefined}
      style={place ? { left: `${place.left}px`, top: `${place.top}px`, width: `${place.width}px` } : { visibility: 'hidden' }}
      // the pointer in the field is the field's: no block, item or text below it takes it
      onPointerDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        className="doc-edit-math-field-source"
        value={value}
        rows={1}
        spellCheck={false}
        aria-label="The LaTeX source of the formula"
        placeholder={isBlock ? 'a formula of its own lines, in LaTeX' : 'a formula, in LaTeX'}
        onChange={(event) => {
          const next = isBlock ? event.target.value : event.target.value.replace(/\n/g, ' ');
          valueSet(next);
          onChange?.(next);
        }}
        onKeyDown={keyDownHandle}
        onBlur={blurHandle}
      />
      {message ? <div className="doc-edit-math-field-message" role="status" title={message}>{message}</div> : null}
    </div>,
    document.body,
  );
}
