import { observer } from 'mobx-react-lite';
import { LoaderCircle } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ASSET_STORE_ID_LOCAL } from '../../frontend/src/lib/doc-asset-ref.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { ObjectFrontendAssetSearchPanel } from '../object-frontend/ObjectFrontendAssetSearchPanel.jsx';
import { objectFrontendAssetPathListParse } from '../../frontend/src/lib/doc-object-frontend.js';
import '../asset/DocAsset.css';
import '../object-frontend/ObjectFrontend.css';
import './DocSettings.css';

// The "Frontend objects" tab of the settings panel (design:
// doc_page_impl_obj_frontend.md#the-settings-tab): the frontend object
// service layer as the files say now, and its structural changes.
//
//   New object     doc page [page][sub]   type [Frontend object][Reading list]   name [      ]  [Create]
//   Objects (3)    one row per object of every doc page: name, type, doc page, assets, id, state
//     the chosen one (a click on its row; again to close):
//       name, description edited in place; its type, entry asset, folder
//       a search of its assets (names, paths, kinds), a hit marking its row
//       its assets (key, name, paths, kind, object, versions, state): the name and
//         the paths edited in place ("/a, /b"), each [Remove] (asks in its row)
//       the assets declaring it that it does not list [Attach]
//       its metadata, its modes
//       [Delete object]  asks in its row: with its assets, or keeping them
//   Types (2)      what the doc pages declare: id, label, extends, modes, doc page
//   Problems       of the files, by doc page
//   Orphan entries entry assets no doc page lists: [List it in {doc page}]
//
// rendered by ConfigPanel as a custom full-width item; every state it shows
// is DocObjectFrontendStore's (settings, write). a built page shows, never changes.
export const ObjectFrontendSettings = observer(function ObjectFrontendSettings() {
  const { objectFrontendStore: store } = useDocStores();
  if (!store) return null;
  if (store.stores.assetStore.backendKind === 'none' || store.config.status === 'idle') {
    return <p className="doc-settings-asset-note">{store.unavailableReason || 'The frontend objects are loading.'}</p>;
  }
  const writeReason = store.writeUnavailableReason;
  const isWriting = store.write.status === 'submitting';
  const docPageCreateList = store.docPageList.filter((docPage) => !docPage.isDisabled && docPage.assetFolder);
  const typeIdCreate = store.settings.createTypeId || 'frontend.object';
  return (
    <div className="doc-settings-tab not-prose">
      <p className="doc-note">
        Objects the page keeps itself, in assets of the asset store: each has an entry asset (its name, type, assets and metadata)
        and assets of its own, gathered in the folder {'{id}--{name}'} of its doc page&apos;s asset folder. The doc pages list them
        and declare their types in object-frontend.yaml.
      </p>

      <h3>New object</h3>
      {writeReason ? <p className="doc-note">{writeReason}</p> : (
        <div className="doc-settings-tab-form">
          <span className="doc-settings-tab-label">doc page</span>
          <span className="doc-button-group" role="group" aria-label="Doc page">
            {docPageCreateList.map((docPage) => (
              <button key={docPage.alias} type="button" aria-pressed={docPage.alias === store.settingsCreateDocPageAlias} title={docPage.file} onClick={() => store.settingsCreateSet({ createDocPageAlias: docPage.alias })}>
                {docPage.alias}
              </button>
            ))}
          </span>
          <span className="doc-settings-tab-label">type</span>
          <span className="doc-button-group" role="group" aria-label="Type">
            {store.typeOfferList.map((type) => (
              <button key={type.id} type="button" aria-pressed={type.id === typeIdCreate} title={type.id} onClick={() => store.settingsCreateSet({ createTypeId: type.id })}>
                {type.label}
              </button>
            ))}
          </span>
          <span className="doc-settings-tab-label">name</span>
          <span className="doc-settings-tab-row">
            <EditValueInline value={store.settings.createName} placeholder="(the object's name)" isLocked={isWriting} onCommit={(value) => store.settingsCreateSet({ createName: value })} />
            <button type="button" className="doc-button" data-primary="" disabled={isWriting || !store.settingsCreateDocPageAlias} onClick={() => void store.settingsCreateSubmit()}>
              {isWriting && store.write.route === 'create' ? <LoaderCircle size={12} className="doc-spin" aria-hidden="true" /> : null}
              <span>Create</span>
            </button>
          </span>
        </div>
      )}
      {store.write.status === 'error' && !store.write.id ? <p className="doc-error" role="alert">{store.write.message}</p> : null}

      <h3>Objects ({store.itemList.length})</h3>
      {store.itemList.length === 0 ? <p className="doc-note">No doc page lists a frontend object yet.</p> : (
        <div className="doc-asset-table-scroll">
          <table className="doc-asset-table">
            <thead>
              <tr><th>name</th><th>type</th><th>doc page</th><th className="doc-asset-version-size">assets</th><th>id</th><th>state</th></tr>
            </thead>
            <tbody>
              {store.itemList.map((item) => {
                const state = store.objectGet(item.id);
                const issueCount = state.problemList.length + state.strayList.length + state.assetList.filter((asset) => asset.status !== 'found').length;
                return (
                  <tr key={item.id} className="doc-asset-version" data-selected={store.settings.idSelected === item.id ? '' : undefined} onClick={() => store.settingsSelect(item.id)}>
                    <td>{state.name || <span className="doc-asset-muted">(no name)</span>}</td>
                    <td>{store.typeLabelGet(state.typeId)}</td>
                    <td className="doc-asset-muted">{item.docPageAlias}</td>
                    <td className="doc-asset-muted doc-asset-version-size">{state.assetList.length}</td>
                    <td className="doc-asset-mono doc-asset-muted">{item.id}</td>
                    <td className={state.status !== 'found' || issueCount > 0 ? 'doc-settings-tab-issue' : 'doc-asset-muted'}>
                      {state.status !== 'found' ? state.status : issueCount > 0 ? `${issueCount} to look at` : 'found'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {store.settings.idSelected && store.itemGet(store.settings.idSelected) ? <ObjectFrontendDetail id={store.settings.idSelected} /> : null}

      <h3>Types ({store.typeDeclaredList.length})</h3>
      {store.typeDeclaredList.length === 0 ? <p className="doc-note">No doc page declares a type; every object is a Frontend object, drawn in its overview.</p> : (
        <div className="doc-asset-table-scroll">
          <table className="doc-asset-table">
            <thead><tr><th>type</th><th>label</th><th>extends</th><th>modes</th><th>doc page</th></tr></thead>
            <tbody>
              {store.typeDeclaredList.map((type) => (
                <tr key={type.id}>
                  <td className="doc-asset-mono">{type.id}</td>
                  <td>{type.label}</td>
                  <td className="doc-asset-muted">{type.extendList.join(', ')}</td>
                  <td>{store.modeListGet(type.id).map((mode) => `${mode.label}${mode.typeId !== type.id ? ' ↑' : ''}`).join(', ')}</td>
                  <td className="doc-asset-muted">{type.definedBy?.alias}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {store.problemList.length > 0 ? (
        <>
          <h3>Problems</h3>
          <ul className="doc-error doc-settings-tab-list">
            {store.problemList.map((problem, index) => <li key={index}>{problem.alias} · {problem.file}: {problem.message}</li>)}
          </ul>
        </>
      ) : null}

      {store.orphanEntryList.length > 0 ? (
        <>
          <h3>Orphan entries ({store.orphanEntryList.length})</h3>
          <p className="doc-note">Entry assets of objects no doc page lists (their line was removed, or the object was deleted keeping its assets).</p>
          {store.orphanEntryList.map(({ id, object }) => (
            <div key={object.objectId} className="doc-settings-tab-row">
              <span className="doc-asset-mono">{id}</span>
              <span className="doc-asset-muted">entry {object.objectId} · {object.groupPath || object.folder}</span>
              {writeReason ? null : docPageCreateList.map((docPage) => (
                <button key={docPage.alias} type="button" className="doc-button" disabled={isWriting} onClick={() => void store.register(docPage.alias, object.objectId)}>
                  List it in {docPage.alias}
                </button>
              ))}
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
});

// the object chosen in the table: what its entry says, its assets, what does
// not agree, and its changes
const ObjectFrontendDetail = observer(function ObjectFrontendDetail({ id }) {
  const { objectFrontendStore: store, assetStore } = useDocStores();
  const state = store.objectGet(id);
  const isWritable = store.writeUnavailableReason === '';
  const isWriting = store.write.status === 'submitting';
  const confirm = store.settings.confirm;
  const modeList = state.status === 'found' ? store.modeListGet(state.typeId) : [];
  const writeMessage = store.write.status === 'error' && store.write.id === id ? store.write.message : '';
  const entryPanelOpen = () => assetStore.panelOpen(ASSET_STORE_ID_LOCAL, state.entryObjectId);
  return (
    <div className="doc-settings-tab-detail">
      <div className="doc-asset-fields">
        <span className="doc-asset-muted">name</span>
        <EditValueInline value={state.name} placeholder="(no name)" isLocked={!isWritable || isWriting || state.status !== 'found'} onCommit={(value) => void store.metaSet(id, { name: value })} />
        <span className="doc-asset-muted">description</span>
        <EditValueInline value={state.description} placeholder="(none)" isLocked={!isWritable || isWriting || state.status !== 'found'} onCommit={(value) => void store.metaSet(id, { description: value })} />
        <span className="doc-asset-muted">reference</span>
        <span className="doc-asset-mono">{state.ref}</span>
        <span className="doc-asset-muted">type</span>
        <span>{store.typeLabelGet(state.typeId)} <span className="doc-asset-muted">{state.typeId}</span></span>
        <span className="doc-asset-muted">entry asset</span>
        <span>
          <button type="button" className="doc-settings-asset-link" onClick={entryPanelOpen} title="open its asset panel">{state.entryObjectId}</button>
          {state.entryObject ? <span className="doc-asset-muted"> · {state.entryObject.folder}/{state.entryObject.groupPath}</span> : null}
        </span>
        <span className="doc-asset-muted">modes</span>
        <span>{modeList.map((mode) => `${mode.label} (${mode.category}${mode.isDefault ? ', default' : ''})`).join(' · ') || '—'}</span>
      </div>
      {state.status !== 'found' ? <p className="doc-error">{state.message}</p> : null}

      <h4>Assets ({state.assetList.length})</h4>
      {state.assetList.length > 0 ? (
        <ObjectFrontendAssetSearchPanel
          object={state.ref}
          sessionKey={`settings:${id}`}
          placeholder="Find an asset: a name, a path, kind:…"
          onChoose={(hit) => store.settingsAssetSelect(hit.asset.key)}
        />
      ) : null}
      {state.assetList.length === 0 ? <p className="doc-note">No asset yet: the modes of its type create them, or attach one of the store.</p> : (
        <div className="doc-asset-table-scroll">
          <table className="doc-asset-table">
            <thead><tr><th>key</th><th>name</th><th>paths</th><th>kind</th><th>object</th><th className="doc-asset-version-size">versions</th><th>state</th><th aria-label="actions" /></tr></thead>
            <tbody>
              {state.assetList.map((asset) => {
                const confirmKey = `assetRemove:${asset.key}`;
                const isLocked = !isWritable || isWriting;
                return (
                  <tr key={asset.key} data-selected={store.settings.assetKeySelected === asset.key ? '' : undefined} className="doc-settings-tab-asset-row">
                    <td>{asset.key}</td>
                    <td>
                      <EditValueInline value={asset.name ?? ''} placeholder="(no name)" isLocked={isLocked} onCommit={(value) => void store.assetMetaSet(id, asset.key, { name: value.trim() || null })} />
                    </td>
                    <td>
                      <EditValueInline
                        value={(asset.pathList ?? []).join(', ')}
                        placeholder="(no path)"
                        isLocked={isLocked}
                        onCommit={(value) => {
                          const { pathList, problemList } = objectFrontendAssetPathListParse(value);
                          if (problemList.length > 0) store.writeMessageSet(id, problemList.join('; '));
                          else void store.assetMetaSet(id, asset.key, { pathList });
                        }}
                      />
                    </td>
                    <td className="doc-asset-muted">{asset.kind}</td>
                    <td>
                      <button type="button" className="doc-settings-asset-link" disabled={!asset.object} onClick={() => assetStore.panelOpen(ASSET_STORE_ID_LOCAL, asset.objectId)}>{asset.object?.name || asset.objectId}</button>
                    </td>
                    <td className="doc-asset-muted doc-asset-version-size">{asset.object?.versionList?.length ?? ''}</td>
                    <td className={asset.status !== 'found' || !asset.isOwnerMatch ? 'doc-settings-tab-issue' : 'doc-asset-muted'}>
                      {asset.status}{asset.status === 'found' && !asset.isOwnerMatch ? ', declares no owner' : ''}
                    </td>
                    <td className="doc-settings-tab-actions">
                      {!isWritable ? null : confirm === confirmKey ? (
                        <>
                          <button type="button" className="doc-button" data-danger="" disabled={isWriting} title={`delete the asset ${asset.objectId} (softly: its files stay)`} onClick={() => void store.assetRemove(id, asset.key, false)}>Delete</button>
                          <button type="button" className="doc-button" disabled={isWriting} title="take it out of the object, keep it in the store (its folder moves to the top of the asset folder)" onClick={() => void store.assetRemove(id, asset.key, true)}>Keep in store</button>
                          <button type="button" className="doc-button" onClick={() => store.settingsConfirmSet('')}>Cancel</button>
                        </>
                      ) : (
                        <button type="button" className="doc-button" disabled={isWriting} onClick={() => store.settingsConfirmSet(confirmKey)}>Remove</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {state.strayList.length > 0 ? (
        <>
          <h4>Declaring it, not listed ({state.strayList.length})</h4>
          {state.strayList.map((object) => (
            <div key={object.objectId} className="doc-settings-tab-row">
              <span className="doc-asset-mono">{object.objectId}</span>
              <span className="doc-asset-muted">{object.name || '(no name)'} · {object.lang}</span>
              {isWritable ? <button type="button" className="doc-button" disabled={isWriting} onClick={() => void store.assetAttach(id, object.objectId)}>Attach</button> : null}
            </div>
          ))}
        </>
      ) : null}
      {state.problemList.length > 0 ? (
        <ul className="doc-error doc-settings-tab-list">{state.problemList.map((problem) => <li key={problem}>{problem}</li>)}</ul>
      ) : null}
      {Object.keys(state.metadata ?? {}).length > 0 ? (
        <>
          <h4>Metadata</h4>
          <pre className="doc-settings-tab-code">{JSON.stringify(state.metadata, null, 2)}</pre>
        </>
      ) : null}
      {isWritable ? (
        <div className="doc-settings-tab-row">
          {confirm === 'deleteObject' ? (
            <>
              <span title={`its line leaves ${state.docPageAlias}'s object-frontend.yaml`}>Delete {state.name || id}?</span>
              <button type="button" className="doc-button" data-danger="" disabled={isWriting} title="its assets are deleted softly: their files stay" onClick={() => void store.delete(id, false)}>With its assets</button>
              <button type="button" className="doc-button" disabled={isWriting} title="its assets stay, declaring it: an orphan entry, listed again from this tab" onClick={() => void store.delete(id, true)}>Keep the assets</button>
              <button type="button" className="doc-button" onClick={() => store.settingsConfirmSet('')}>Cancel</button>
            </>
          ) : (
            <button type="button" className="doc-button" data-danger="" disabled={isWriting} onClick={() => store.settingsConfirmSet('deleteObject')}>Delete object</button>
          )}
          {isWriting && store.write.id === id ? <LoaderCircle size={12} className="doc-spin" aria-hidden="true" /> : null}
        </div>
      ) : null}
      {writeMessage ? <p className="doc-error" role="alert">{writeMessage}</p> : null}
    </div>
  );
});
