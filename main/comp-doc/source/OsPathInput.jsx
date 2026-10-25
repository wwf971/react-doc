import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileIcon, FolderIcon, LoaderCircle } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import './DocSource.css';

// A path of the file system of the computer the development server runs on,
// typed with completion (design: doc_page_impl_source.md#os-path-completion):
// the counterpart of SourcePathInput for paths outside the source. the
// folder typed so far is listed by the server while the text changes
// (DocSourceStore.osPathCompleter, lib/doc-os-path-complete.js), so the
// candidates come a moment later: the dropdown says "listing…" meanwhile,
// and shows only what the current text's folder holds, never the answer for
// an earlier text. a listing is kept for a while, so going back and forth
// in one folder asks nothing.
//
// choosing a folder continues into it (the text ends with "/", the
// dropdown lists it); choosing a file commits it. Enter commits the text,
// Escape closes the dropdown, then restores the value. leaving the field
// commits, like SourcePathInput. a folder holding a doc page is marked.
//
//   value            the current path
//   spec             { kind: 'dir' | 'file' | 'any', extList? }: what may be chosen
//   placeholder      shown while empty
//   isDisabled       read-only
//   onChange(text)   every edit of the text (optional)
//   onCommit(text)   the text on blur / Enter / choice of a file, when it differs
const LIST_DELAY_MS = 120;

export function OsPathInput({
  value,
  spec = { kind: 'any' },
  placeholder = '',
  isDisabled = false,
  className = '',
  onChange,
  onCommit,
}) {
  const { sourceStore } = useDocStores();
  const completer = sourceStore.osPathCompleter;
  const elementRef = useRef(null);
  const listRef = useRef(null);
  const [isOpen, isOpenSet] = useState(false);
  const [typed, typedSet] = useState('');
  const [indexActive, indexActiveSet] = useState(-1);
  const [listPosition, listPositionSet] = useState(null);
  // a listing arrived: the candidates are computed again from the text
  const [, listingArrived] = useReducer((count) => count + 1, 0);
  const valueText = value === undefined || value === null ? '' : String(value);

  useEffect(() => completer?.subscribe(() => listingArrived()), [completer]);

  // the folder of the text is listed once the typing pauses
  useEffect(() => {
    if (!isOpen || !completer) return undefined;
    const timerId = setTimeout(() => completer.request(typed), LIST_DELAY_MS);
    return () => clearTimeout(timerId);
  }, [completer, isOpen, typed]);

  const complete = isOpen && completer
    ? completer.completeGet(typed, spec)
    : { status: 'ready', candidateList: [], message: '', isTruncated: false };
  const candidateList = complete.candidateList.slice(0, 60);
  const isListShown = isOpen && completer !== undefined
    && (candidateList.length > 0 || complete.status !== 'ready');

  useLayoutEffect(() => {
    if (!isListShown) return undefined;
    const positionUpdate = () => {
      const rect = elementRef.current?.getBoundingClientRect();
      if (rect) listPositionSet(listPositionBuild(rect));
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

  // the text replaced, the caret at its end, still editing
  const textSet = (text) => {
    const element = elementRef.current;
    if (element) {
      element.textContent = text;
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    typedSet(text);
    indexActiveSet(-1);
    onChange?.(text);
  };

  const choose = (candidate) => {
    if (candidate.kind === 'dir') {
      textSet(candidate.path);
      isOpenSet(true);
      return;
    }
    textSet(candidate.path);
    close();
    if (candidate.path !== valueText) onCommit?.(candidate.path);
    elementRef.current?.blur();
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
    if (event.key === 'Tab' && isOpen && candidateList.length > 0) {
      // the highlighted candidate, or the only one, is taken into the text
      const candidate = candidateList[indexActive] ?? (candidateList.length === 1 ? candidateList[0] : undefined);
      if (candidate) {
        event.preventDefault();
        textSet(candidate.path);
      }
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
      event.stopPropagation();
      if (isOpen) {
        close();
        return;
      }
      event.currentTarget.textContent = valueText;
      event.currentTarget.blur();
    }
  };

  return (
    <span className={`doc-source-path-input doc-os-path-input${className ? ` ${className}` : ''}`}>
      <EditValueInline
        ref={elementRef}
        value={valueText}
        placeholder={placeholder}
        isLocked={isDisabled || !completer}
        newlineAs=""
        commitRootRef={[listRef]}
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
        onInput={(text) => {
          typedSet(text);
          indexActiveSet(-1);
          isOpenSet(true);
          onChange?.(text);
        }}
        onKeyDown={keyDownHandle}
      />
      {isListShown && listPosition ? createPortal(
        <ul
          ref={listRef}
          className="doc-popover doc-source-path-list not-prose"
          role="listbox"
          style={{ top: listPosition.top, left: listPosition.left, minWidth: listPosition.minWidth, maxWidth: listPosition.maxWidth }}
        >
          {complete.status === 'loading' ? (
            <li className="doc-source-path-option doc-os-path-status" role="presentation">
              <LoaderCircle aria-hidden="true" size={12} strokeWidth={2} className="doc-spin" />
              <span>listing…</span>
            </li>
          ) : null}
          {complete.status === 'error' ? (
            <li className="doc-source-path-option doc-os-path-status is-error" role="presentation" title={complete.message}>
              <span>{complete.message}</span>
            </li>
          ) : null}
          {candidateList.map((candidate, index) => (
            <li
              key={candidate.path}
              className="doc-source-path-option doc-os-path-option"
              role="option"
              aria-selected={index === indexActive}
              data-active={index === indexActive ? '' : undefined}
              data-kind={candidate.kind}
              title={candidate.path}
              onPointerDown={(event) => {
                event.preventDefault();
                choose(candidate);
              }}
            >
              {candidate.kind === 'dir'
                ? <FolderIcon aria-hidden="true" size={13} strokeWidth={1.8} className="doc-os-path-option-icon" />
                : <FileIcon aria-hidden="true" size={13} strokeWidth={1.8} className="doc-os-path-option-icon" />}
              <span className="doc-source-path-option-path">{candidate.name}{candidate.kind === 'dir' ? '/' : ''}</span>
              {candidate.isDocPage ? <span className="doc-badge-outline" data-primary="">doc page</span> : null}
            </li>
          ))}
          {complete.isTruncated ? (
            <li className="doc-source-path-option doc-os-path-status" role="presentation">more entries: type more of the name</li>
          ) : null}
        </ul>,
        document.body,
      ) : null}
    </span>
  );
}

// under the text, as wide as the text at least, kept inside the window
function listPositionBuild(rect) {
  const margin = 4;
  const maxWidth = Math.max(160, window.innerWidth - margin * 2);
  const minWidth = Math.min(Math.max(rect.width, 260), maxWidth);
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - minWidth - margin));
  return { top: rect.bottom + 2, left, minWidth, maxWidth };
}
