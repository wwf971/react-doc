import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { LoaderCircle, Search } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ObjectIcon } from './object-icon.jsx';
import { ObjectStatusBadge } from './ObjectViewFallback.jsx';
import './DocObject.css';

// The search of the object service layer as a panel (doc_page_impl_obj_search.md#the-ui):
// a field, filters by type and by registry, the results as rows (the icon of
// the object's type, its name, its type, where it is), and one line per
// host the search did not list in full (too many to list, how many is not
// known, did not answer) with a way to load its first objects on purpose.
// It keeps no state: the session of the search (DocObjectSearchStore, by
// sessionKey) holds the text, the filters, the result, the highlighted row.
//
//   sessionKey      the key of its session; two panels of one key are one search
//   typeList        the types it starts filtered by (an option of the session)
//   isFilterShown   the filter chips (default true)
//   placeholder, isAutoFocus
//   onChoose(hit)   a row chosen (a click, Enter): { descriptor, path, ... }
//   onClose()       Escape on an empty field
//
// the look is the insert menu's search (the shared .doc-search-* classes)

export const OBJECT_SEARCH_TYPE_FILTER_LIST = [
  { label: 'All', typeList: [] },
  { label: 'Documents', typeList: ['core.document'] },
  { label: 'Places', typeList: ['core.place'] },
  { label: 'Tasks', typeList: ['core.task'] },
  { label: 'Collections', typeList: ['core.collection'] },
  { label: 'Configs', typeList: ['core.config'] },
  { label: 'Services', typeList: ['core.service', 'service.template'] },
];

const OBJECT_SEARCH_REGISTRY_FILTER_LIST = [
  { label: 'Everywhere', registryList: ['page', 'backend'] },
  { label: 'This page', registryList: ['page'] },
  { label: 'Services', registryList: ['backend'] },
];

export const ObjectSearchPanel = observer(function ObjectSearchPanel({
  sessionKey,
  typeList,
  isFilterShown = true,
  placeholder = 'Search objects: a name, a host, an id, type:…, in:…',
  isAutoFocus = false,
  onChoose,
  onClose,
}) {
  const { objectStore } = useDocStores();
  const session = objectStore.searchStore.sessionGet(sessionKey, { typeList });
  const result = session.result;
  const hitList = session.hitList;
  const highlightList = (result?.tokenList ?? []).map((token) => token.valueLower).filter(Boolean);
  // a session found again with a text (another mount) shows its result at once
  useEffect(() => {
    if (session.status === 'idle' && session.typeList.length > 0) session.refresh();
  }, [session]);

  const choose = (hit) => {
    if (!hit) return;
    session.refChosenSet(hit.descriptor.ref);
    onChoose?.(hit);
  };
  const keyDownHandle = (event) => {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      session.indexActiveMove(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(session.hitActive);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (session.text) session.clear();
      else onClose?.();
    }
  };
  const typeFilterCurrent = OBJECT_SEARCH_TYPE_FILTER_LIST.find((item) => sameList(item.typeList, session.typeList));
  const summaryNotListedList = (result?.providerList ?? []).filter((summary) => summary.status !== 'fetched' || summary.isTruncated);
  return (
    <div className="doc-object-search not-prose">
      <div className="doc-search-field">
        <Search className="doc-search-field-icon" size={12} aria-hidden="true" />
        <input
          type="text"
          className="doc-search-field-input"
          value={session.text}
          placeholder={placeholder}
          aria-label="Search objects"
          role="combobox"
          aria-expanded={hitList.length > 0}
          aria-autocomplete="list"
          autoFocus={isAutoFocus}
          spellCheck={false}
          onChange={(event) => session.textSet(event.target.value)}
          onKeyDown={keyDownHandle}
        />
        {session.status === 'searching' ? <LoaderCircle className="doc-spin doc-search-field-icon" size={12} aria-label="searching" /> : null}
      </div>
      {isFilterShown ? (
        <div className="doc-object-search-filter">
          <div className="doc-button-group" role="group" aria-label="type">
            {OBJECT_SEARCH_TYPE_FILTER_LIST.map((item) => (
              <button key={item.label} type="button" aria-pressed={typeFilterCurrent === item} onClick={() => session.typeListSet(item.typeList)}>{item.label}</button>
            ))}
            {!typeFilterCurrent ? <button type="button" aria-pressed>{session.typeList.join(', ')}</button> : null}
          </div>
          <div className="doc-button-group" role="group" aria-label="Where">
            {OBJECT_SEARCH_REGISTRY_FILTER_LIST.map((item) => (
              <button key={item.label} type="button" aria-pressed={sameList(item.registryList, session.registryList)} onClick={() => session.registryListSet(item.registryList)}>{item.label}</button>
            ))}
          </div>
        </div>
      ) : null}
      {result && !result.isEmptyQuery ? (
        <div className="doc-search-result-list doc-object-search-result-list" role="listbox" aria-label="Objects found">
          {hitList.length === 0 ? <span className="doc-search-none">no object matches “{session.text.trim()}”</span> : null}
          {hitList.map((hit, index) => (
            <ObjectSearchResultRow
              key={hit.descriptor.ref}
              hit={hit}
              highlightList={highlightList}
              isActive={index === session.indexActive}
              onActive={() => session.indexActiveSet(index)}
              onChoose={() => choose(hit)}
            />
          ))}
        </div>
      ) : null}
      {summaryNotListedList.map((summary) => (
        <p key={summary.providerId} className="doc-note doc-object-search-summary">
          <span>{summary.label}: {summaryText(summary)}</span>
          {summary.isExpandable ? (
            <button type="button" className="doc-button" onClick={() => session.providerExpand(summary.providerId)}>Load the first {session.fetchMax}</button>
          ) : null}
        </p>
      ))}
      {session.status === 'error' ? <p className="doc-error">{session.message}</p> : null}
    </div>
  );
});

// one object found: the icon of its type, its name, its type, where it is
export const ObjectSearchResultRow = observer(function ObjectSearchResultRow({ hit, highlightList = [], isActive = false, onActive, onChoose }) {
  const { objectStore } = useDocStores();
  const { descriptor } = hit;
  const typeLabel = descriptor.typeList[0] ? objectStore.typeLabelGet(descriptor.typeList[0]) : '';
  return (
    <div
      className="doc-search-result"
      role="option"
      aria-selected={isActive}
      data-active={isActive ? '' : undefined}
      title={descriptor.ref}
      // a pointer down would take the focus from the search field
      onPointerDown={(event) => event.preventDefault()}
      onMouseEnter={onActive}
      onClick={onChoose}
    >
      <ObjectIcon descriptor={descriptor} objectStore={objectStore} size={13} />
      <span className="doc-search-result-name">{textHighlight(descriptor.label, highlightList)}</span>
      {typeLabel ? <span className="doc-search-result-label">{typeLabel}</span> : null}
      {descriptor.status !== 'found' ? <ObjectStatusBadge descriptor={descriptor} /> : null}
      <span className="doc-search-result-description">{textHighlight(hit.path, highlightList)}</span>
    </div>
  );
});

// what a host the search did not list in full says
function summaryText(summary) {
  const count = summary.count === null ? 'how many is not known' : `${summary.count}${summary.countKind === 'atLeast' ? '+' : ''} object${summary.count === 1 ? '' : 's'}`;
  if (summary.status === 'counted') return `${count}, not listed: ${summary.message}`;
  if (summary.status === 'fetched' && summary.isTruncated) return `${count}, the first ${summary.matchCount} matching listed`;
  return `${summary.status}${summary.message ? `: ${summary.message}` : ''}`;
}

// the text with every word of the search marked
export function textHighlight(text, highlightList) {
  const value = String(text ?? '');
  const valueLower = value.toLowerCase();
  const rangeList = [];
  for (const word of highlightList) {
    let index = valueLower.indexOf(word);
    while (word && index !== -1) {
      rangeList.push([index, index + word.length]);
      index = valueLower.indexOf(word, index + word.length);
    }
  }
  if (rangeList.length === 0) return value;
  rangeList.sort((a, b) => a[0] - b[0]);
  const partList = [];
  let position = 0;
  for (const [start, end] of rangeList) {
    if (start < position) continue;
    if (start > position) partList.push(value.slice(position, start));
    partList.push(<mark key={start} className="doc-search-match">{value.slice(start, end)}</mark>);
    position = end;
  }
  if (position < value.length) partList.push(value.slice(position));
  return partList;
}

function sameList(a, b) {
  return a.length === b.length && a.every((item) => b.includes(item));
}
