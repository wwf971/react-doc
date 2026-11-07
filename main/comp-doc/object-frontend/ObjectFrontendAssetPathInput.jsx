import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { FileText, FolderIcon, TriangleAlert } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import '../source/DocSource.css';
import './ObjectFrontend.css';

// A path of an asset of a frontend object, typed with completion (design:
// doc_page_impl_obj_frontend.md#naming-and-finding-the-assets): the
// counterpart of SourcePathInput for the paths an object gives its assets,
// with the same field and dropdown. the folder typed so far is listed (its
// folders, with how many assets they hold, then its assets, with their name,
// kind, and state when the store lacks them), read from the layer's index
// of the object (objectFrontendStore.assetComplete), so it costs nothing per
// keystroke. an asset has as many paths as its object gives it, so one
// asset may be reached by several folders.
//
// choosing a folder continues into it (the text ends with "/"); choosing an
// asset commits its path and reports it (onChoose). Tab takes the
// highlighted (or only) candidate, Enter commits the text, Escape closes
// the dropdown and then restores the value; leaving the field commits.
// a component of a mode, a settings form, any block may use it.
//
//   object           the frontend object (frontend:{id}, or its id)
//   value            the current path (or any asset reference)
//   kindList         only assets of these kinds (and the folders holding one)
//   base             where a text without a leading "/" is read from (default the root)
//   isMissingWarned  a warning icon before the text when it names no asset of
//                    the object, or one the store lacks (its place kept when hidden)
//   placeholder, isDisabled, className
//   onChange(text)   every edit of the text
//   onCommit(text)   the text on blur / Enter / a chosen asset, when it differs
//   onChoose(asset, path)   an asset chosen in the dropdown
export const ObjectFrontendAssetPathInput = observer(function ObjectFrontendAssetPathInput({
  object,
  value,
  kindList = [],
  base = '/',
  isMissingWarned = false,
  placeholder = '/kind/…',
  isDisabled = false,
  className = '',
  onChange,
  onCommit,
  onChoose,
}) {
  const { objectFrontendStore } = useDocStores();
  const elementRef = useRef(null);
  const listRef = useRef(null);
  const [isOpen, isOpenSet] = useState(false);
  const [typed, typedSet] = useState('');
  const [indexActive, indexActiveSet] = useState(-1);
  const [listPosition, listPositionSet] = useState(null);
  const valueText = value === undefined || value === null ? '' : String(value);

  const candidateList = isOpen ? objectFrontendStore.assetComplete(object, typed, { kindList, base }).slice(0, 60) : [];
  const isListShown = isOpen && candidateList.length > 0;

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
    if (candidate.kind === 'folder') {
      textSet(`${candidate.path}/`);
      isOpenSet(true);
      return;
    }
    textSet(candidate.path);
    close();
    onChoose?.(candidate.asset, candidate.path);
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
      const candidate = candidateList[indexActive] ?? (candidateList.length === 1 ? candidateList[0] : undefined);
      if (candidate) {
        event.preventDefault();
        textSet(candidate.kind === 'folder' ? `${candidate.path}/` : candidate.path);
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

  // why the text shown names no usable asset ('' when it does, or is
  // empty); while typing, only once nothing in the dropdown continues it
  // (a folder on the way is no mistake)
  const textShown = isOpen ? typed : valueText;
  const isWarningTime = !isOpen || candidateList.length === 0;
  const resolved = isMissingWarned && isWarningTime && textShown.trim() !== '' ? objectFrontendStore.assetResolve(object, textShown) : undefined;
  const warningText = resolved && resolved.status !== 'found' && resolved.status !== 'loading' ? resolved.message : '';

  return (
    <span className={`doc-source-path-input doc-object-frontend-path-input${className ? ` ${className}` : ''}`}>
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
      <EditValueInline
        ref={elementRef}
        value={valueText}
        placeholder={placeholder}
        isLocked={isDisabled}
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
        // a popup of the edit layer: a pointer in it is not outside an editing session
        <ul
          ref={listRef}
          className="doc-popover doc-source-path-list doc-edit-popup not-prose"
          role="listbox"
          style={{ top: listPosition.top, left: listPosition.left, minWidth: listPosition.minWidth, maxWidth: listPosition.maxWidth }}
        >
          {candidateList.map((candidate, index) => (
            <li
              key={`${candidate.kind}:${candidate.path}`}
              className="doc-source-path-option doc-object-frontend-path-option"
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
              {candidate.kind === 'folder'
                ? <FolderIcon aria-hidden="true" size={13} strokeWidth={1.8} className="doc-os-path-option-icon" />
                : <FileText aria-hidden="true" size={13} strokeWidth={1.8} className="doc-os-path-option-icon" />}
              <span className="doc-source-path-option-path">{candidate.segment}{candidate.kind === 'folder' ? '/' : ''}</span>
              {candidate.kind === 'folder'
                ? <span className="doc-object-frontend-path-option-note">{candidate.assetCount} asset{candidate.assetCount === 1 ? '' : 's'}</span>
                : <span className="doc-object-frontend-path-option-note">{candidate.asset.name || candidate.asset.key}</span>}
              {candidate.kind === 'asset' && candidate.asset.kind ? <span className="doc-badge">{candidate.asset.kind}</span> : null}
              {candidate.kind === 'asset' && candidate.asset.status !== 'found'
                ? <span className="doc-badge-outline" data-error="" title={`the asset ${candidate.asset.itemId} is ${candidate.asset.status} in the store`}>{candidate.asset.status}</span>
                : null}
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
  const maxWidth = Math.max(160, window.innerWidth - margin * 2);
  const minWidth = Math.min(Math.max(rect.width, 280), maxWidth);
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - minWidth - margin));
  return { top: rect.bottom + 2, left, minWidth, maxWidth };
}
