import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FolderTreeIcon, Search, X } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { sourceTreeSearch } from '../../frontend/src/lib/doc-source-complete.js';
import { sourcePathAncestorListGet } from '../../frontend/src/lib/doc-source-path.js';
import { SourcePathInput } from './SourcePathInput.jsx';
import { SourceTreeSelect } from './SourceTreeSelect.jsx';
import './DocSource.css';

// A path of the source chosen by typing or by browsing
// (doc_page_impl_source.md#choosing-a-path): the path with completion
// (SourcePathInput) and the same candidates as a tree (SourceTreeSelect over
// DocSourceStore.pathTreeGet). Both read one specification, so what can be
// typed is what can be browsed: a document (kind file, extList md / mdx),
// a folder (kind dir), anything. It only shows and reports; the value
// belongs to the caller.
//
//   [label] [~example/edit-in-place.md      ] [⌸]   ◄ browse button: isTreeCollapsible only
//   [🔍 edit                              ×]        ◄ searching the tree: isTreeSearchable
//   ▾ 📁 ~example
//       🗎 [edit]-in-place.md                       ◄ the value, selected; the match highlighted
//   message                                         ◄ the caller's, e.g. why the value cannot be used
//
//   value              the chosen path ('' none)
//   spec               what may be chosen (lib/doc-source-complete.js)
//   isTreeCollapsible  the tree is hidden behind a browse button (the
//                      location prompt); otherwise it is always shown
//   isTreeSearchable   a search field above the tree narrows it to the
//                      nodes matching what is typed (default on). Enter or
//                      ArrowDown in it chooses the first match and moves
//                      into the tree; Escape clears it
//   onChange(text)     every edit of the typed text (optional)
//   onSelect(path)     a path was typed and committed, or chosen in the tree
//   onActivate(path)   a node of the tree was double-clicked or took Enter:
//                      "this one, go on" (optional)
export const SourcePathPicker = observer(function SourcePathPicker({
  value,
  spec = { kind: 'dir' },
  label = '',
  placeholder = '',
  message = '',
  isDisabled = false,
  isTreeCollapsible = false,
  isTreeSearchable = true,
  className = '',
  onChange,
  onSelect,
  onActivate,
}) {
  const { sourceStore } = useDocStores();
  const elementRef = useRef(null);
  const [isTreeOpen, isTreeOpenSet] = useState(false);
  const [searchText, searchTextSet] = useState('');
  const isTreeShown = !isTreeCollapsible || isTreeOpen;
  const valueText = String(value ?? '');
  const nodeList = isTreeShown ? sourceStore.pathTreeGet(spec) : [];

  const searchKeyDownHandle = (event) => {
    if (event.key === 'Escape' && searchText !== '') {
      // the dialog around the picker leaves an Escape that was taken alone
      event.preventDefault();
      searchTextSet('');
      return;
    }
    if (event.key !== 'Enter' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const nodeFirst = nodeMatchFirstGet(sourceTreeSearch(nodeList, searchText).nodeList);
    if (nodeFirst && !isDisabled) onSelect?.(nodeFirst.id);
    elementRef.current?.querySelector('.doc-source-tree')?.focus();
  };

  return (
    <div ref={elementRef} className={`doc-source-picker${className ? ` ${className}` : ''}`}>
      <div className="doc-source-picker-row">
        {label ? <span className="doc-source-picker-label">{label}</span> : null}
        <SourcePathInput
          value={valueText}
          spec={spec}
          placeholder={placeholder}
          isDisabled={isDisabled}
          onChange={onChange}
          onCommit={(text) => onSelect?.(text)}
        />
        {isTreeCollapsible ? (
          <button
            type="button"
            className="doc-source-picker-browse"
            title="Browse the source"
            aria-label="Browse the source"
            aria-pressed={isTreeOpen}
            disabled={isDisabled}
            onClick={() => isTreeOpenSet(!isTreeOpen)}
          >
            <FolderTreeIcon aria-hidden="true" size={12} strokeWidth={2} />
          </button>
        ) : null}
      </div>
      {isTreeShown && isTreeSearchable ? (
        <label className="doc-source-picker-search">
          <Search aria-hidden="true" size={12} strokeWidth={2} />
          <input
            type="text"
            value={searchText}
            placeholder="Search by name"
            aria-label="Search the tree by name"
            spellCheck={false}
            disabled={isDisabled}
            onChange={(event) => searchTextSet(event.target.value)}
            onKeyDown={searchKeyDownHandle}
          />
          {searchText !== '' ? (
            <button type="button" title="Clear the search" aria-label="Clear the search" onClick={() => searchTextSet('')}>
              <X aria-hidden="true" size={12} strokeWidth={2} />
            </button>
          ) : null}
        </label>
      ) : null}
      {isTreeShown ? (
        <SourceTreeSelect
          className="doc-source-picker-tree"
          nodeList={nodeList}
          valueId={valueText}
          idExpandedInitialList={sourcePathAncestorListGet(valueText)}
          searchText={isTreeSearchable ? searchText : ''}
          onSelect={(path) => {
            if (!isDisabled) onSelect?.(path);
          }}
          onActivate={(path) => {
            if (!isDisabled) onActivate?.(path);
          }}
        />
      ) : null}
      {message ? <p className="doc-source-picker-message" role="alert">{message}</p> : null}
    </div>
  );
});

// the first node of a searched tree that matches and can be chosen
function nodeMatchFirstGet(nodeList) {
  for (const node of nodeList) {
    if (node.labelMatchList?.length > 0 && !node.isDisabled) return node;
    const child = nodeMatchFirstGet(node.childList ?? []);
    if (child) return child;
  }
  return undefined;
}
