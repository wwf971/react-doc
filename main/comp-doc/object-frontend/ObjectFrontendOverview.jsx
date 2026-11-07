import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ObjectIcon } from '../object/object-icon.jsx';
import './ObjectFrontend.css';

// The mode "overview" every frontend object has (declared on frontend.object,
// doc_page_impl_obj_frontend.md#modes): what the object is, read from its
// entry: name, type, description, its assets by key and kind, its metadata,
// and the modes of its type, each a button switching the block to it.
// Rendered in the placement objectFrontend, given config.objectFrontend.
export const ObjectFrontendOverview = observer(function ObjectFrontendOverview({ config = {} }) {
  const { objectStore, objectFrontendStore } = useDocStores();
  const service = config.objectFrontend;
  if (!service) return <p className="doc-error">ObjectFrontendOverview is a mode of a frontend object (ObjectFrontend).</p>;
  const state = service.object;
  const descriptor = { ref: state.ref, typeList: [state.typeId] };
  const metadataKeyList = Object.keys(state.metadata ?? {});
  return (
    <div className="doc-object-card doc-object-card-block doc-object-frontend-overview">
      <div className="doc-object-card-head">
        <ObjectIcon descriptor={descriptor} objectStore={objectStore} size={15} />
        <button type="button" className="doc-object-card-label doc-object-link" title="open it in the settings panel" onClick={() => service.open()}>
          {state.name || state.id}
        </button>
        <span className="doc-badge">{objectFrontendStore.typeLabelGet(state.typeId)}</span>
        <span className="doc-note">{state.ref} · {state.docPageAlias}</span>
      </div>
      {state.description ? <p className="doc-note doc-object-card-description">{state.description}</p> : null}
      <table className="doc-object-frontend-table">
        <thead>
          <tr><th>asset</th><th>kind</th><th>object</th><th>status</th></tr>
        </thead>
        <tbody>
          {state.assetList.length === 0 ? (
            <tr><td colSpan={4} className="doc-note">no asset yet</td></tr>
          ) : state.assetList.map((asset) => (
            <tr key={asset.key}>
              <td>{asset.key}</td>
              <td>{asset.kind}</td>
              <td className="doc-object-frontend-muted">{asset.item?.name ? `${asset.item.name} · ` : ''}{asset.itemId}</td>
              <td data-error={asset.status !== 'found' || !asset.isOwnerMatch ? '' : undefined}>
                {asset.status}{asset.status === 'found' && !asset.isOwnerMatch ? ', declares another owner' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {metadataKeyList.length > 0 ? (
        <dl className="doc-object-summary">
          {metadataKeyList.map((key) => (
            <div key={key} className="doc-object-summary-item">
              <dt>{key}</dt>
              <dd>{typeof state.metadata[key] === 'object' ? JSON.stringify(state.metadata[key]) : String(state.metadata[key])}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="doc-button-group doc-object-frontend-mode-bar" role="group" aria-label="Modes">
        {service.modeList.map((mode) => (
          <button
            key={mode.id}
            type="button"
            aria-pressed={mode.id === service.mode?.id}
            title={[mode.description, `${mode.category} · from ${objectFrontendStore.typeLabelGet(mode.typeId)}`].filter(Boolean).join(' · ')}
            onClick={() => void service.modeSet(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      {state.problemList.length + state.strayList.length + state.unknownList.length + state.outsideList.length > 0 ? (
        <ul className="doc-error doc-object-frontend-problem">
          {state.problemList.map((problem) => <li key={problem}>{problem}</li>)}
          {state.unknownList.map((item) => <li key={item.itemId}>the item {item.itemId} lies in the folder of the object, of unknown source: the Frontend objects tab adopts it or sends it away</li>)}
          {state.outsideList.map((asset) => <li key={asset.key}>the asset {asset.key} lies outside the folder of the object</li>)}
          {state.strayList.map((item) => <li key={item.itemId}>the asset {item.itemId} declares the object but its entry does not list it</li>)}
        </ul>
      ) : null}
    </div>
  );
});
