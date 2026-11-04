import { observer } from 'mobx-react-lite';
import { FileText, Search } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { textHighlight } from '../object/ObjectSearchPanel.jsx';
import '../object/DocObject.css';
import './ObjectFrontend.css';

// The search of the assets of one frontend object as a panel (design:
// doc_page_impl_obj_frontend.md#naming-and-finding-the-assets), in the look
// and with the grammar of the object registry's search (ObjectSearchPanel,
// the shared .doc-search-* classes): words in any order, every one matching
// the name, a path, the key, the kind or the id, a word narrowed by kind:,
// name:, path:, key:, id: (a path word starting with "/" is a prefix). the
// kinds of the object's assets are filter buttons. a row shows the name,
// the kind, the path the words matched (else its first), and the state of
// an asset the store lacks. it keeps no state: the session (by sessionKey)
// holds the text, the kinds, the highlighted row.
//
//   object          the frontend object (frontend:{id}, or its id)
//   sessionKey      the key of its session; two panels of one key are one search
//   kindList        the kinds it starts narrowed to
//   isKindFilterShown   the kind buttons (default true)
//   placeholder, isAutoFocus
//   onChoose(hit)   a row chosen (a click, Enter): { asset, pathMatched, ... }
//   onClose()       Escape on an empty field
export const ObjectFrontendAssetSearchPanel = observer(function ObjectFrontendAssetSearchPanel({
  object,
  sessionKey,
  kindList,
  isKindFilterShown = true,
  placeholder = 'Search the assets: a name, a path, kind:…, path:/…',
  isAutoFocus = false,
  onChoose,
  onClose,
}) {
  const { objectFrontendStore } = useDocStores();
  const session = objectFrontendStore.assetSearchSessionGet(sessionKey, { object, kindList });
  const state = objectFrontendStore.objectGet(object);
  const result = session.result;
  const highlightList = result.tokenList.map((token) => token.valueLower).filter(Boolean);
  const kindAllList = [...new Set(state.assetList.map((asset) => asset.kind).filter(Boolean))];

  const choose = (hit) => {
    if (hit) onChoose?.(hit);
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
      event.stopPropagation();
      if (session.text) session.clear();
      else onClose?.();
    }
  };

  return (
    <div className="doc-object-search doc-object-frontend-asset-search not-prose">
      <div className="doc-search-field">
        <Search className="doc-search-field-icon" size={12} aria-hidden="true" />
        <input
          type="text"
          className="doc-search-field-input"
          value={session.text}
          placeholder={placeholder}
          aria-label="Search the assets of the object"
          role="combobox"
          aria-expanded={result.hitList.length > 0}
          aria-autocomplete="list"
          autoFocus={isAutoFocus}
          spellCheck={false}
          onChange={(event) => session.textSet(event.target.value)}
          onKeyDown={keyDownHandle}
        />
      </div>
      {isKindFilterShown && kindAllList.length > 1 ? (
        <div className="doc-object-search-filter">
          <div className="doc-button-group" role="group" aria-label="kind">
            <button type="button" aria-pressed={session.kindList.length === 0} onClick={() => session.kindListSet([])}>All</button>
            {kindAllList.map((kind) => (
              <button key={kind} type="button" aria-pressed={session.kindList.length === 1 && session.kindList[0] === kind} onClick={() => session.kindListSet([kind])}>{kind}</button>
            ))}
          </div>
        </div>
      ) : null}
      {state.status !== 'found' ? <p className="doc-note">{state.status === 'loading' ? 'reading the object…' : state.message}</p> : (
        <div className="doc-search-result-list doc-object-search-result-list" role="listbox" aria-label="Assets found">
          {result.hitList.length === 0 ? <span className="doc-search-none">{session.text.trim() ? `no asset matches “${session.text.trim()}”` : 'the object has no asset of these kinds'}</span> : null}
          {result.hitList.map((hit, index) => (
            <div
              key={hit.asset.key}
              className="doc-search-result"
              role="option"
              aria-selected={index === session.indexActive}
              data-active={index === session.indexActive ? '' : undefined}
              title={`${hit.asset.key} · ${hit.asset.objectId}${(hit.asset.pathList ?? []).length > 1 ? `\n${hit.asset.pathList.join('\n')}` : ''}`}
              // a pointer down would take the focus from the search field
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(hit)}
            >
              <FileText size={13} aria-hidden="true" className="doc-object-icon" />
              <span className="doc-search-result-name">{textHighlight(hit.asset.name || hit.asset.key, highlightList)}</span>
              {hit.asset.kind ? <span className="doc-search-result-label">{textHighlight(hit.asset.kind, highlightList)}</span> : null}
              {hit.asset.status !== 'found' ? <span className="doc-badge-outline" data-error="">{hit.asset.status}</span> : null}
              <span className="doc-search-result-description">{textHighlight(hit.pathMatched || hit.asset.key, highlightList)}</span>
            </div>
          ))}
          {result.isTruncated ? <span className="doc-search-none">more assets match: type more words</span> : null}
        </div>
      )}
    </div>
  );
});
