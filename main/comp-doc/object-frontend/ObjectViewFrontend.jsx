import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ObjectIcon } from '../object/object-icon.jsx';
import { ObjectStatusBadge } from '../object/ObjectViewFallback.jsx';
import { objectFrontendBlockTextBuild } from '../../frontend/src/lib/doc-object-frontend.js';
// eslint-disable-next-line import/no-cycle
import { ObjectFrontendBody } from './ObjectFrontend.jsx';
import './ObjectFrontend.css';

// The view of frontend.object for the object registry (doc_page_impl_obj_frontend.md#in-the-object-registry):
// a frontend object found by a list, a search, a group or a card diagram is
// drawn as a card (its name, type, assets and modes), and in the block
// context in its default mode, as an ObjectFrontend block naming it would
// draw it. A type of a doc page may bring a view of its own (expose.objectView),
// nearer to its objects, as for any type.
export const ObjectViewFrontend = observer(function ObjectViewFrontend({ data = {}, config = {}, onEvent }) {
  const { objectStore, objectFrontendStore } = useDocStores();
  const descriptor = data.descriptor ?? { ref: data.ref, typeList: [], label: data.ref, status: 'loading', summary: {} };
  const context = config.objectView?.context ?? 'card';
  if (context === 'block' && descriptor.status === 'found') {
    return <ObjectFrontendBody data={{ raw: objectFrontendBlockTextBuild({ object: descriptor.ref }) }} config={config} onEvent={onEvent} />;
  }
  const state = objectFrontendStore.objectGet(descriptor.ref);
  const modeList = state.status === 'found' ? objectFrontendStore.modeListGet(state.typeId) : [];
  return (
    <div className="doc-object-card" data-status={descriptor.status}>
      <div className="doc-object-card-head">
        <ObjectIcon descriptor={descriptor} objectStore={objectStore} size={15} />
        <button type="button" className="doc-object-card-label doc-object-link" title={`open ${descriptor.label}`} onClick={() => void onEvent?.('objectOpenRequest', { ref: descriptor.ref })}>
          {descriptor.label}
        </button>
        <span className="doc-badge">{objectStore.typeLabelGet(descriptor.typeList[0] ?? '')}</span>
        {descriptor.status !== 'found' ? <ObjectStatusBadge descriptor={descriptor} /> : null}
      </div>
      {state.status === 'found' ? (
        <p className="doc-note doc-object-card-description">
          {state.assetList.length} asset(s){state.assetList.length > 0 ? `: ${[...new Set(state.assetList.map((asset) => asset.kind || 'asset'))].join(', ')}` : ''}
          {' · modes: '}{modeList.map((mode) => mode.label).join(', ')}
        </p>
      ) : <p className="doc-note">{descriptor.message || state.message}</p>}
      <p className="doc-note doc-object-card-foot" title={descriptor.ref}>{descriptor.provider?.label ? `${descriptor.provider.label} · ` : ''}{descriptor.ref}</p>
    </div>
  );
});
