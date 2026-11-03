import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ObjectIcon } from './object-icon.jsx';
import { ObjectViewHost } from './ObjectViewHost.jsx';
import { ObjectCompleteness } from './ObjectCompleteness.jsx';
import { ObjectStatusBadge } from './ObjectViewFallback.jsx';

// The view of a collection (core.collection, doc_page_impl_obj.md#groups-and-collections):
// its members, the core.member relations from it in their order, each drawn
// by its own view, an icon in a card, a card in a block. It knows nothing of
// the collection's provider: a todo list of a service, a group written in a
// document, the sections of a document, a folder, all are drawn alike. A
// member entry is drawn once per entry, so an object listed twice is shown twice.

const MEMBER_SHOWN_MAX = 60;

export const ObjectViewCollection = observer(function ObjectViewCollection({ data = {}, config = {}, onEvent }) {
  const { objectStore } = useDocStores();
  const descriptor = data.descriptor;
  const view = config.objectView ?? {};
  const context = view.context === 'block' ? 'block' : 'card';
  const state = objectStore.memberStateGet(descriptor.ref);
  const relationList = state.result?.relationList ?? [];
  const typeLabel = objectStore.typeLabelGet(descriptor.typeList[0] ?? 'core.collection');
  const open = () => void onEvent?.('objectOpenRequest', { ref: descriptor.ref });
  return (
    // a card holding chips; in the block context a section holding cards,
    // not a card of cards
    <div className={context === 'block' ? 'doc-object-section doc-object-collection' : 'doc-object-card doc-object-collection'} data-status={descriptor.status}>
      <div className="doc-object-card-head">
        <ObjectIcon descriptor={descriptor} objectStore={objectStore} size={15} />
        {descriptor.open
          ? <button type="button" className="doc-object-card-label doc-object-link" onClick={open}>{descriptor.label}</button>
          : <span className="doc-object-card-label">{descriptor.label}</span>}
        <span className="doc-badge">{typeLabel}</span>
        {descriptor.status !== 'found' ? <ObjectStatusBadge descriptor={descriptor} /> : null}
      </div>
      {context === 'block' && descriptor.description ? <p className="doc-note">{descriptor.description}</p> : null}
      <div className={context === 'block' ? 'doc-object-grid' : 'doc-object-member-list'}>
        {relationList.slice(0, MEMBER_SHOWN_MAX).map((relation) => (
          <ObjectViewHost
            key={relation.key}
            objectRef={relation.toRef}
            context={context === 'block' ? 'card' : 'icon'}
            note={relation.label}
          />
        ))}
      </div>
      {state.status === 'done' && relationList.length === 0 && state.result?.completeness?.isComplete ? <p className="doc-note">no members</p> : null}
      <ObjectCompleteness
        completeness={state.result?.completeness}
        count={relationList.length}
        isTruncated={relationList.length > MEMBER_SHOWN_MAX}
        isLoading={state.status === 'loading' || Boolean(state.promise)}
      />
    </div>
  );
});
