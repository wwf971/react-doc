import { useEffect, useRef } from 'react';
import './DocEdit.css';

// One short value edited where it is displayed: a span made editable, so the
// row keeps its height when editing starts. Uncontrolled while typing; the
// value is committed on Enter or when focus leaves, restored on Escape. An
// unchanged value is not committed. Used by component editors for fields
// and cells (ImageEdit, StockTableEdit).
//
//   value            current value
//   placeholder      shown while the value is empty
//   isLocked         read-only while a change request is pending
//   onCommit(value)  the edited value, only when it differs
export function EditValueInline({ value, placeholder = '', isLocked = false, className = '', onCommit }) {
  const elementRef = useRef(null);
  const valueText = value === undefined || value === null ? '' : String(value);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || document.activeElement === element) return;
    element.textContent = valueText;
  }, [valueText]);

  const commit = () => {
    const element = elementRef.current;
    if (!element) return;
    const valueNext = element.textContent.replace(/\n/g, ' ');
    if (valueNext !== valueText) onCommit?.(valueNext);
  };

  const keyDownHandle = (event) => {
    if (event.nativeEvent?.isComposing) return;
    // Ctrl/⌘ + Enter is left to the block: it saves the whole block, the
    // value commits on the blur that comes with it
    if (event.key === 'Enter' && !(event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.textContent = valueText;
      event.currentTarget.blur();
    }
  };

  return (
    <span
      ref={elementRef}
      className={`doc-edit-value${className ? ` ${className}` : ''}`}
      role="textbox"
      contentEditable={isLocked ? 'false' : 'plaintext-only'}
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={placeholder}
      data-locked={isLocked ? '' : undefined}
      onBlur={commit}
      onKeyDown={keyDownHandle}
      onPaste={(event) => {
        event.preventDefault();
        document.execCommand('insertText', false, (event.clipboardData?.getData('text/plain') ?? '').replace(/\n/g, ' '));
      }}
    />
  );
}
