import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import './DocSource.css';

// A source path typed with completion from the source layer
// (doc_page_impl_source.md#path-completion): an editable span (the text is
// the value) and, while it has focus, a dropdown with the folders or files
// of the source that match what is typed (DocSourceStore.pathComplete).
// Arrow keys move in the dropdown, Enter takes the highlighted entry (or
// commits the text when nothing is highlighted), Escape restores the value.
// Used by the settings panel for keys of type sourcePath and by the
// location prompt of file creation.
//
//   value            the current path
//   spec             { kind: 'dir' | 'file', extList? } what the path names
//   placeholder      shown while empty
//   isDisabled       read-only
//   onChange(text)   every edit of the text (optional)
//   onCommit(text)   the text on blur / Enter / choice, when it differs
export const SourcePathInput = observer(function SourcePathInput({
  value,
  spec = { kind: 'dir' },
  placeholder = '',
  isDisabled = false,
  className = '',
  onChange,
  onCommit,
}) {
  const { sourceStore } = useDocStores();
  const elementRef = useRef(null);
  const [isOpen, isOpenSet] = useState(false);
  const [typed, typedSet] = useState('');
  const [indexActive, indexActiveSet] = useState(-1);
  const valueText = value === undefined || value === null ? '' : String(value);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || document.activeElement === element) return;
    element.textContent = valueText;
  }, [valueText]);

  const candidateList = isOpen ? sourceStore.pathComplete(typed, spec).slice(0, 40) : [];

  const commit = (text) => {
    isOpenSet(false);
    indexActiveSet(-1);
    if (text !== valueText) onCommit?.(text);
  };

  const choose = (candidate) => {
    const element = elementRef.current;
    if (element) element.textContent = candidate;
    typedSet(candidate);
    onChange?.(candidate);
    commit(candidate);
  };

  const inputHandle = (event) => {
    const text = event.currentTarget.textContent.replace(/\n/g, '');
    typedSet(text);
    indexActiveSet(-1);
    isOpenSet(true);
    onChange?.(text);
  };

  const keyDownHandle = (event) => {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        isOpenSet(true);
        return;
      }
      if (candidateList.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      indexActiveSet((indexActive + step + candidateList.length) % candidateList.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (indexActive >= 0 && candidateList[indexActive] !== undefined) {
        choose(candidateList[indexActive]);
        return;
      }
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (isOpen) {
        isOpenSet(false);
        indexActiveSet(-1);
        return;
      }
      event.currentTarget.textContent = valueText;
      event.currentTarget.blur();
    }
  };

  return (
    <span className={`doc-source-path-input${className ? ` ${className}` : ''}`}>
      <span
        ref={elementRef}
        className="doc-source-path-text"
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        contentEditable={isDisabled ? 'false' : 'plaintext-only'}
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder={placeholder}
        data-disabled={isDisabled ? '' : undefined}
        onFocus={(event) => {
          typedSet(event.currentTarget.textContent);
          isOpenSet(true);
        }}
        onBlur={(event) => commit(event.currentTarget.textContent.replace(/\n/g, ''))}
        onInput={inputHandle}
        onKeyDown={keyDownHandle}
        onPaste={(event) => {
          event.preventDefault();
          document.execCommand('insertText', false, (event.clipboardData?.getData('text/plain') ?? '').replace(/\n/g, ''));
        }}
      />
      {isOpen && candidateList.length > 0 ? (
        <ul className="doc-source-path-list not-prose" role="listbox">
          {candidateList.map((candidate, index) => (
            <li
              key={candidate}
              className="doc-source-path-option"
              role="option"
              aria-selected={index === indexActive}
              data-active={index === indexActive ? '' : undefined}
              // the choice happens on pointer down, before the blur of the text commits what was typed
              onPointerDown={(event) => {
                event.preventDefault();
                choose(candidate);
              }}
            >
              {candidate}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
});
