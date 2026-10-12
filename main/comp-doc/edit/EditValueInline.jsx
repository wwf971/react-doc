import { forwardRef, useEffect, useRef } from 'react';
import './DocEdit.css';

// One short value edited where it is displayed: a span made editable, so the
// row keeps its height when editing starts. Uncontrolled while typing; the
// value is committed on Enter or when focus leaves, restored on Escape. An
// unchanged value is not committed. A click that does not move focus (the
// panel, a note) still leaves the field: the pointer down blurs it, and the
// blur commits. Clearing the text shows the placeholder again; a cleared
// contenteditable often keeps a <br>, which is not :empty, so that <br> is
// removed. Used by component editors (ImageEdit, StockTableEdit), by
// SourcePathInput, and by the asset store's new-folder field.
//
//   value            current value
//   placeholder      shown while the value is empty
//   isLocked         read-only while a change request is pending
//   newlineAs        what a newline becomes in the committed text
//   commitRootRef    clicks inside this element do not leave the field
//                    (a completion dropdown beside the text)
//   onCommit(value)  the edited value, only when it differs
//   onInput(value)   every edit of the text
export const EditValueInline = forwardRef(function EditValueInline({
  value,
  placeholder = '',
  isLocked = false,
  className = '',
  newlineAs = ' ',
  commitRootRef,
  onCommit,
  onInput,
  onKeyDown,
  onBlur,
  onFocus,
  onPaste,
  role = 'textbox',
  ...rest
}, ref) {
  const elementRef = useRef(null);
  const valueText = value === undefined || value === null ? '' : String(value);
  const valueTextRef = useRef(valueText);
  valueTextRef.current = valueText;
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;
  const newlineAsRef = useRef(newlineAs);
  newlineAsRef.current = newlineAs;
  const commitRootHeldRef = useRef(commitRootRef);
  commitRootHeldRef.current = commitRootRef;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;

  const refSet = (node) => {
    elementRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  const textRead = (element) => element.textContent.replace(/\n/g, newlineAsRef.current);

  const commit = () => {
    const element = elementRef.current;
    if (!element || isLockedRef.current) return;
    const valueNext = textRead(element);
    if (valueNext !== valueTextRef.current) onCommitRef.current?.(valueNext);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    const element = elementRef.current;
    if (!element || document.activeElement === element) return;
    element.textContent = valueText;
  }, [valueText]);

  // a click on something that does not take focus does not blur a
  // contenteditable by itself, so the pointer down blurs it and the blur
  // commits. a click inside commitRootRef (the completion list) stays.
  useEffect(() => {
    const pointerDownHandle = (event) => {
      if (event.button !== 0) return;
      const element = elementRef.current;
      if (!element || !element.isConnected || isLockedRef.current) return;
      if (event.target === element || element.contains(event.target)) return;
      const root = commitRootHeldRef.current?.current;
      if (root && (event.target === root || root.contains(event.target))) return;
      if (document.activeElement === element) {
        element.blur();
        return;
      }
      // focus already left without a blur event: do what the blur would do
      if (!element.textContent.trim()) element.textContent = '';
      onBlurRef.current?.();
      commitRef.current();
      setTimeout(() => {
        const current = elementRef.current;
        if (!current || !current.isConnected || document.activeElement === current) return;
        if (!current.textContent.trim()) current.textContent = '';
      }, 0);
    };
    document.addEventListener('pointerdown', pointerDownHandle, true);
    return () => document.removeEventListener('pointerdown', pointerDownHandle, true);
  }, []);

  // leaving an empty contenteditable, the browser puts a <br> back after
  // the blur event, so the placeholder is restored on the next turn
  const emptyRestore = () => {
    const element = elementRef.current;
    if (!element || !element.isConnected || document.activeElement === element) return;
    if (element.textContent.trim()) return;
    element.textContent = '';
  };

  const blurHandle = (event) => {
    const element = elementRef.current;
    if (element && !element.textContent.trim()) {
      element.textContent = '';
      setTimeout(emptyRestore, 0);
    }
    onBlur?.(event);
    commitRef.current();
  };

  const keyDownHandle = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent?.isComposing) return;
    // Ctrl/⌘ + Enter is left to the block: it saves the whole block, the
    // value commits on the blur that comes with it
    if (event.key === 'Enter' && !(event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.textContent = valueTextRef.current;
      event.currentTarget.blur();
    }
  };

  const inputHandle = (event) => {
    onInput?.(textRead(event.currentTarget));
  };

  const pasteHandle = (event) => {
    if (onPaste) {
      onPaste(event);
      return;
    }
    event.preventDefault();
    const text = (event.clipboardData?.getData('text/plain') ?? '').replace(/\n/g, newlineAsRef.current);
    document.execCommand('insertText', false, text);
  };

  return (
    <span
      ref={refSet}
      className={`doc-edit-value${className ? ` ${className}` : ''}`}
      role={role}
      contentEditable={isLocked ? 'false' : 'plaintext-only'}
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={placeholder}
      data-locked={isLocked ? '' : undefined}
      {...rest}
      onFocus={onFocus}
      onBlur={blurHandle}
      onInput={onInput ? inputHandle : undefined}
      onKeyDown={keyDownHandle}
      onPaste={pasteHandle}
    />
  );
});
