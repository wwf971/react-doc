import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import {
  AppWindow,
  FileCode,
  FileText,
  FolderIcon,
  FolderOpenIcon,
  FolderTreeIcon,
  Search,
  SeparatorHorizontal,
  X,
} from '../../frontend/UICommon.js';
import { textHighlight } from '../object/ObjectSearchPanel.jsx';
import { useEditOutsidePointer } from '../edit/use-edit-outside-pointer.js';
import { useWheelContain } from '../popup/use-wheel-contain.js';
import './SidePanelItem.css';

// The search of the side panel (design:
// doc_page_impl_side_panel.md#searching-the-items): a field at the top of
// the side panel, above the first doc page, finding items by their names.
// It takes the place of the search button of fumadocs, which the page hides
// (a unified search of the page is to replace both, doc_page_impl_TODO.md#unified-search).
//
//   [🔍 Search the side panel        ×]
//   ┌ results (floating over the tree) ──┐
//   │ ▤ Image [grid]                     │  ◄ the label, matched words marked
//   │   example › MDX Components         │  ◄ where it is: section, folders
//   │ ▤ Image                            │
//   │   example › MDX Components         │
//   └────────────────────────────────────┘
//
// the state is DocSidePanelStore's (searchQuery, searchIsOpen,
// searchIndexActive). ArrowDown / ArrowUp move in the results, Enter goes to
// the one the keys are on (the first when none is), Escape closes the
// results, then clears the query; a pointer going down outside closes them,
// and the field focused again shows them. choosing a result opens its section
// and folders, navigates to it when it has a route, and marks its row
// (searchChoose). an item mirroring a source folder is found by its own name;
// the files below it are not searched. the wheel over the results scrolls
// them and never the document under them, even when they do not overflow
// (useWheelContain).
export const DocSidePanelSearch = observer(function DocSidePanelSearch() {
  const { sidePanelStore } = useDocStores();
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const query = sidePanelStore.searchQuery;
  const isOpen = sidePanelStore.searchIsOpen;
  useEditOutsidePointer(rootRef, isOpen, () => sidePanelStore.searchOpenSet(false));
  useWheelContain(listRef, isOpen);
  const { wordList, resultList, countMatched } = sidePanelStore.searchResult;
  const indexActive = sidePanelStore.searchIndexActive;
  const listId = 'doc-side-panel-search-result-list';

  const keyDownHandle = (event) => {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) sidePanelStore.searchOpenSet(true);
      sidePanelStore.searchIndexActiveMove(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      sidePanelStore.searchChoose();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (isOpen) sidePanelStore.searchOpenSet(false);
      else sidePanelStore.searchQuerySet('');
    }
  };

  return (
    <div ref={rootRef} className="doc-side-panel-search">
      <div className="doc-search-field doc-side-panel-search-field">
        <Search className="doc-search-field-icon" size={14} aria-hidden="true" />
        <input
          type="text"
          className="doc-search-field-input"
          value={query}
          placeholder="Search the side panel"
          aria-label="Search the items of the side panel by their names"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          spellCheck={false}
          onChange={(event) => sidePanelStore.searchQuerySet(event.target.value)}
          onFocus={() => sidePanelStore.searchOpenSet(true)}
          // the field keeps the focus after a choice: a click shows the results again
          onClick={() => sidePanelStore.searchOpenSet(true)}
          onKeyDown={keyDownHandle}
        />
        {query !== '' ? (
          <button
            type="button"
            className="doc-side-panel-search-clear"
            title="Clear the search"
            aria-label="Clear the search"
            onClick={() => sidePanelStore.searchQuerySet('')}
          >
            <X size={13} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {isOpen ? (
        <div ref={listRef} id={listId} className="doc-search-result-list doc-side-panel-search-result-list" role="listbox" aria-label="Items found">
          {resultList.length === 0 ? (
            <span className="doc-search-none">no item is named “{query.trim()}”</span>
          ) : resultList.map(({ entry }, index) => {
            const KindIcon = kindIconByKind[entry.kind] ?? FileText;
            return (
              <div
                key={entry.itemId}
                className="doc-search-result doc-side-panel-search-result"
                role="option"
                aria-selected={index === indexActive}
                data-active={index === indexActive ? '' : undefined}
                title={[...entry.pathList, entry.text].join(' › ')}
                // a pointer down would take the focus from the field
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => sidePanelStore.searchChoose(entry.itemId)}
              >
                <KindIcon className="doc-side-panel-search-result-icon" size={13} aria-hidden="true" />
                <span className="doc-side-panel-search-result-text">
                  <span className="doc-side-panel-search-result-name">{textHighlight(entry.text, wordList)}</span>
                  {entry.pathList.length > 0 ? (
                    <span className="doc-side-panel-search-result-path">{entry.pathList.join(' › ')}</span>
                  ) : null}
                </span>
              </div>
            );
          })}
          {countMatched > resultList.length ? (
            <span className="doc-search-none">{countMatched - resultList.length} more: type more of the name</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

// what an item is, at a glance (side-panel-search.js kinds)
const kindIconByKind = {
  doc: FileText,
  folder: FolderIcon,
  folderDoc: FolderOpenIcon,
  sourceFolder: FolderTreeIcon,
  panel: AppWindow,
  inline: FileCode,
  separator: SeparatorHorizontal,
};
