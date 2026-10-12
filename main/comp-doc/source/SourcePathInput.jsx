import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import './DocSource.css';

// A source path typed with completion from the source layer
// (doc_page_impl_source.md#path-completion): the text is an EditValueInline
// (so leaving it, including a click outside, commits, and an empty field
// shows its placeholder) and, while it has focus, a dropdown with the
// folders or files of the source that match what is typed
// (DocSourceStore.pathComplete, filtered by the spec). Arrow keys move in
// the dropdown, Enter takes the highlighted entry (or commits the text when
// nothing is highlighted), Escape restores the value. Used by the settings
// panel for keys of type sourcePath and by the location prompt of file
// creation.
//
// the dropdown is rendered into document.body at a fixed position under the
// text, not inside the field: the field is often placed in a scrolling or
// clipping container (every item of the settings panel hides its overflow),
// where a list positioned inside would be cut off.
//
//   value            the current path
//   spec             what the path names (lib/doc-source-complete.js):
//                    { kind: 'dir' | 'file' | 'any', extList?, rootIdList?, dirPath?, isMatch? }
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
  const listRef = useRef(null);
  const [isOpen, isOpenSet] = useState(false);
  const [typed, typedSet] = useState('');
  const [indexActive, indexActiveSet] = useState(-1);
  const [listPosition, listPositionSet] = useState(null);
  const valueText = value === undefined || value === null ? '' : String(value);

  const candidateList = isOpen ? sourceStore.pathComplete(typed, spec).slice(0, 40) : [];
  const isListShown = isOpen && candidateList.length > 0;
  // the kind of a candidate is told only when the list mixes both
  const isKindShown = spec.kind === 'any';

  // the list follows the text: placed when it opens, and again when the
  // page scrolls or the window resizes while it is open
  useLayoutEffect(() => {
    if (!isListShown) return undefined;
    const positionUpdate = () => {
      const rect = elementRef.current?.getBoundingClientRect();
      if (!rect) return;
      listPositionSet(listPositionBuild(rect));
    };
    positionUpdate();
    window.addEventListener('scroll', positionUpdate, true);
    window.addEventListener('resize', positionUpdate);
    return () => {
      window.removeEventListener('scroll', positionUpdate, true);
      window.removeEventListener('resize', positionUpdate);
    };
  }, [isListShown]);

  const close = () => {
    isOpenSet(false);
    indexActiveSet(-1);
  };

  const commit = (text) => {
    close();
    if (text !== valueText) onCommit?.(text);
  };

  const choose = (candidate) => {
    const element = elementRef.current;
    if (element) element.textContent = candidate.path;
    typedSet(candidate.path);
    onChange?.(candidate.path);
    commit(candidate.path);
  };

  const inputHandle = (text) => {
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
        close();
        return;
      }
      event.currentTarget.textContent = valueText;
      event.currentTarget.blur();
    }
  };

  return (
    <span className={`doc-source-path-input${className ? ` ${className}` : ''}`}>
      <EditValueInline
        ref={elementRef}
        value={valueText}
        placeholder={placeholder}
        isLocked={isDisabled}
        newlineAs=""
        commitRootRef={listRef}
        role="combobox"
        aria-expanded={isListShown}
        aria-autocomplete="list"
        onFocus={(event) => {
          typedSet(event.currentTarget.textContent.replace(/\n/g, ''));
          isOpenSet(true);
        }}
        onBlur={close}
        onCommit={(text) => {
          if (text !== valueText) onCommit?.(text);
        }}
        onInput={inputHandle}
        onKeyDown={keyDownHandle}
      />
      {isListShown && listPosition ? createPortal(
        <ul
          ref={listRef}
          className="doc-source-path-list not-prose"
          role="listbox"
          style={{ top: listPosition.top, left: listPosition.left, minWidth: listPosition.minWidth, maxWidth: listPosition.maxWidth }}
        >
          {candidateList.map((candidate, index) => (
            <li
              key={candidate.path}
              className="doc-source-path-option"
              role="option"
              aria-selected={index === indexActive}
              data-active={index === indexActive ? '' : undefined}
              data-kind={candidate.kind}
              // the choice happens on pointer down, before the blur of the text commits what was typed
              onPointerDown={(event) => {
                event.preventDefault();
                choose(candidate);
              }}
            >
              <span className="doc-source-path-option-path">{candidate.path}</span>
              {isKindShown ? <span className="doc-source-path-option-kind">{candidate.kind}</span> : null}
            </li>
          ))}
        </ul>,
        document.body,
      ) : null}
    </span>
  );
});

// under the text, as wide as the text at least, kept inside the window
function listPositionBuild(rect) {
  const margin = 4;
  const maxWidth = Math.max(120, window.innerWidth - margin * 2);
  const minWidth = Math.min(rect.width, maxWidth);
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - minWidth - margin));
  return { top: rect.bottom + 2, left, minWidth, maxWidth };
}
