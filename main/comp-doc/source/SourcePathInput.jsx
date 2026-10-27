import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { TriangleAlert, Undo2 } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { EDIT_POPUP_CLASS } from '../edit/use-edit-outside-pointer.js';
import './DocSource.css';

// A source path typed with completion from the doc page source service layer
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
// where a list positioned inside would be cut off. being outside, it
// carries the edit-popup marker (use-edit-outside-pointer.js): a pointer
// choosing a folder in it is not a click outside the editor the field
// belongs to (the location prompt of a pasted image).
//
//   value            the current path
//   spec             what the path names (lib/doc-source-complete.js):
//                    { kind: 'dir' | 'file' | 'any', extList?, rootList?, dirPath?, isMatch? }
//   placeholder      shown while empty
//   isDisabled       read-only
//   onChange(text)   every edit of the text (optional)
//   onCommit(text)   the text on blur / Enter / choice, when it differs
//   valueRevert      a value an earlier edit replaced (optional); with
//                    onRevert, a revert button before the path writes it back
//   onRevert()       write valueRevert back
//   isMissingWarned  a warning icon before the path when the text shown (also
//                    while typing) names nothing of the kind of spec in the
//                    source (DocSourceStore.pathMissingWarningGet). the icon's
//                    place is always kept, so the field never moves when the
//                    warning comes and goes
//
// a path is shown and committed in the full form ~page:root/path
// (doc_page_impl_source.md#source-paths): a workspace holds several doc
// pages, and the form is exact wherever the value is read. a value written
// in the local form ~root/path (a doc page's own file may) is shown in the
// full form of docPageAlias, and is written again only when edited.
//
// the revert button sits before the path and has two meanings. while the
// path is being edited and its text differs from the value it had when the
// editing started, it resets the text to that value (nothing is written,
// the field stays in edit mode). otherwise, when valueRevert differs from
// the value, it calls onRevert, which is another write.
export const SourcePathInput = observer(function SourcePathInput({
  value,
  spec = { kind: 'dir' },
  placeholder = '',
  isDisabled = false,
  className = '',
  onChange,
  onCommit,
  valueRevert,
  onRevert,
  isMissingWarned = false,
  // the doc page a local path (~root/dir) typed here belongs to; the main
  // doc page of the workspace when absent
  docPageAlias = '',
}) {
  const { sourceStore } = useDocStores();
  const elementRef = useRef(null);
  const listRef = useRef(null);
  const revertRef = useRef(null);
  const [isFocused, isFocusedSet] = useState(false);
  const [isOpen, isOpenSet] = useState(false);
  const [typed, typedSet] = useState('');
  const [indexActive, indexActiveSet] = useState(-1);
  const [listPosition, listPositionSet] = useState(null);
  const valueText = value === undefined || value === null ? '' : sourceStore.pathFullGet(String(value), '', docPageAlias);
  const valueRevertText = valueRevert === undefined || valueRevert === null ? valueRevert : sourceStore.pathFullGet(String(valueRevert), '', docPageAlias);
  // what is typed, in the full form when it names a root
  const textFullGet = (text) => sourceStore.pathFullGet(text, '', docPageAlias);

  const candidateList = isOpen ? sourceStore.pathComplete(typed, spec).slice(0, 40) : [];
  const isListShown = isOpen && candidateList.length > 0;
  // the kind of a candidate is told only when the list mixes both
  const isKindShown = spec.kind === 'any';
  const isTextChanged = isFocused && typed !== valueText;
  const isValueRevertable = !isTextChanged && onRevert !== undefined
    && valueRevertText !== undefined && String(valueRevertText ?? '') !== valueText;
  const isRevertShown = !isDisabled && (isTextChanged || isValueRevertable);

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
    const textFull = textFullGet(text);
    if (textFull !== valueText) onCommit?.(textFull);
  };

  const choose = (candidate) => {
    const element = elementRef.current;
    if (element) element.textContent = candidate.path;
    typedSet(candidate.path);
    onChange?.(candidate.path);
    commit(candidate.path);
  };

  // the text back to the value, the caret at its end; still editing
  const textReset = () => {
    const element = elementRef.current;
    if (!element) return;
    element.textContent = valueText;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    typedSet(valueText);
    indexActiveSet(-1);
    onChange?.(valueText);
  };

  const revertClickHandle = () => {
    if (isTextChanged) {
      textReset();
      return;
    }
    // the text is unchanged, so leaving the field commits nothing
    elementRef.current?.blur();
    onRevert?.();
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

  const warningText = isMissingWarned ? sourceStore.pathMissingWarningGet(isFocused ? typed : valueText, spec, docPageAlias) : '';

  return (
    <span className={`doc-source-path-input${className ? ` ${className}` : ''}`}>
      {isMissingWarned ? (
        <span
          className="doc-source-path-warning"
          data-shown={warningText ? '' : undefined}
          title={warningText || undefined}
          role={warningText ? 'img' : undefined}
          aria-label={warningText || undefined}
          aria-hidden={warningText ? undefined : 'true'}
        >
          <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />
        </span>
      ) : null}
      {isRevertShown ? (
        <button
          ref={revertRef}
          type="button"
          className="doc-source-path-revert"
          title={isTextChanged ? `Reset the text to ${valueText || '(empty)'}` : `Revert to ${valueRevertText || '(empty)'}`}
          aria-label={isTextChanged ? 'Reset the text' : 'Revert to the previous value'}
          // the field keeps the focus: a text reset stays in edit mode
          onPointerDown={(event) => event.preventDefault()}
          onClick={revertClickHandle}
        >
          <Undo2 aria-hidden="true" size={12} strokeWidth={2} />
        </button>
      ) : null}
      <EditValueInline
        ref={elementRef}
        value={valueText}
        placeholder={placeholder}
        isLocked={isDisabled}
        newlineAs=""
        commitRootRef={[listRef, revertRef]}
        role="combobox"
        aria-expanded={isListShown}
        aria-autocomplete="list"
        onFocus={(event) => {
          typedSet(event.currentTarget.textContent.replace(/\n/g, ''));
          isFocusedSet(true);
          isOpenSet(true);
        }}
        onBlur={() => {
          isFocusedSet(false);
          close();
        }}
        onCommit={(text) => {
          const textFull = textFullGet(text);
          if (textFull !== valueText) onCommit?.(textFull);
        }}
        onInput={inputHandle}
        onKeyDown={keyDownHandle}
      />
      {isListShown && listPosition ? createPortal(
        <ul
          ref={listRef}
          className={`doc-popover doc-source-path-list not-prose ${EDIT_POPUP_CLASS}`}
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
