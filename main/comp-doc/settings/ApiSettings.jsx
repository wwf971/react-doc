import { Fragment } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import '../api/DocApi.css';

// The "API" tab of the settings panel (design: doc_page_impl_api.md#the-api-tab):
// what the unified api registry offers now and how it is reached.
//
//   Remote      the address a caller outside the page uses through the
//               development server, the id of this page, an example call
//   Apis        every api registered now: id, label, whether it can run
//               (and why not), the key bound to it
//   Hotkeys     the maps of the stack, lowest first: the package's default
//               map, the map each doc page activates (the reader picks
//               another of its maps here, kept in this browser), the
//               workspace's map; then every key with the binding that
//               answers it and the bindings it passes over, and the
//               problems of the map files
//   Calls       the last calls, newest first
//
// rendered by ConfigPanel as a custom full-width item; it reads the stores itself.
export const ApiSettings = observer(function ApiSettings() {
  const { apiStore, hotkeyStore, envStore } = useDocStores();
  const apiInfoList = apiStore.apiInfoListGet({ kind: 'palette' });
  const rowList = hotkeyStore.rowListEffective;
  const endpoint = apiStore.remoteEndpoint;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <div className="doc-api-settings not-prose">
      <h3>Remote</h3>
      {apiStore.isRemoteAvailable ? (
        <>
          <div className="doc-api-settings-row">
            <span>The development server forwards calls to this page at</span>
            <code className="doc-api-settings-code">{origin}{endpoint}</code>
            <span>page id</span>
            <code className="doc-api-settings-code">{apiStore.pageId}</code>
            <span className="doc-note">{apiStore.remoteRequestCount} request(s) answered</span>
          </div>
          <pre className="doc-api-settings-code">{`curl ${origin}${endpoint}/list\ncurl ${origin}${endpoint}/context\ncurl -X POST ${origin}${endpoint}/call -H 'content-type: application/json' \\\n  -d '{"api":"nav/goTo","params":{"target":"${apiStore.stores.docStore?.docCurrentPath ?? ''}"}}'`}</pre>
        </>
      ) : (
        <p className="doc-note">{envStore.isDevServer ? 'The remote api is not configured (the host passes no api endpoint).' : 'A built page has no development server: the apis are reached from the page only.'}</p>
      )}

      <h3>Apis ({apiInfoList.length})</h3>
      <table className="doc-api-table">
        <thead>
          <tr><th>id</th><th>label</th><th>params</th><th>now</th><th>key</th></tr>
        </thead>
        <tbody>
          {apiInfoList.map((api) => (
            <tr key={api.id}>
              <td>{api.id}</td>
              <td>{api.label}</td>
              <td data-muted="">{api.paramList.map((param) => `${param.name}${param.isRequired ? '*' : ''}`).join(', ')}</td>
              <td data-muted={api.isAvailable ? undefined : ''} title={api.reason || undefined}>{api.isAvailable ? 'available' : api.reason}</td>
              <td>{api.hotkey ? <kbd className="doc-api-key">{api.hotkey}</kbd> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Hotkeys</h3>
      <p className="doc-note">The maps of the stack, lowest first; a key is answered by the topmost binding whose api is registered now.</p>
      <div className="doc-api-settings-map">
        <span className="doc-badge-outline">package</span>
        {hotkeyStore.mapPackage ? (
          <span className="doc-api-settings-map-file" title={hotkeyStore.mapPackage.description || undefined}>
            {hotkeyStore.mapPackage.file}{hotkeyStore.mapPackage.description ? ` · ${hotkeyStore.mapPackage.description}` : ''}
          </span>
        ) : <span className="doc-api-settings-map-file">config.yaml names no default map (hotkey.file): the package binds no key</span>}
      </div>
      {hotkeyStore.docPageMapsList.length === 0 ? (
        <div className="doc-api-settings-map">
          <span className="doc-badge-outline">doc pages</span>
          <span className="doc-api-settings-map-file">no doc page keeps keyboard maps (.doc-page/hotkey/)</span>
        </div>
      ) : hotkeyStore.docPageMapsList.map((docPageMaps) => {
        const mapActive = hotkeyStore.mapActiveGet(docPageMaps);
        return (
          <div key={docPageMaps.alias} className="doc-api-settings-map">
            <span className="doc-badge-outline" title={`the doc page ${docPageMaps.alias}: ${docPageMaps.folder}`}>{docPageMaps.alias}</span>
            <span className="doc-api-settings-map-file">uses the map</span>
            {docPageMaps.mapList.map((map) => (
              <button
                key={map.id}
                type="button"
                className="doc-button-dialog"
                aria-pressed={map.id === mapActive?.id}
                title={`${map.file}${map.description ? ` · ${map.description}` : ''}`}
                onClick={() => hotkeyStore.mapIdActiveSet(docPageMaps.alias, map.id === docPageMaps.mapIdActive ? '' : map.id)}
              >
                {map.id}{map.id === docPageMaps.mapIdActive ? ' (default)' : ''}
              </button>
            ))}
          </div>
        );
      })}
      <div className="doc-api-settings-map">
        <span className="doc-badge-outline">workspace</span>
        {hotkeyStore.mapWorkspace ? (
          <span className="doc-api-settings-map-file" title={hotkeyStore.mapWorkspace.description || undefined}>
            {hotkeyStore.mapWorkspace.file}{hotkeyStore.mapWorkspace.description ? ` · ${hotkeyStore.mapWorkspace.description}` : ''}
          </span>
        ) : <span className="doc-api-settings-map-file">the workspace names no map (hotkey.file)</span>}
      </div>
      {hotkeyStore.problemListLoaded.length > 0 || hotkeyStore.table.problemList.length > 0 ? (
        <ul className="doc-error">
          {hotkeyStore.problemListLoaded.map((problem, index) => <li key={`load-${index}`}>{problem.file}: {problem.message}</li>)}
          {hotkeyStore.table.problemList.map((problem, index) => <li key={`table-${index}`}>{problem.mapId} {problem.place}: {problem.message}</li>)}
        </ul>
      ) : null}
      <table className="doc-api-table">
        <thead>
          <tr><th>key</th><th>api</th><th>when</th><th>map</th></tr>
        </thead>
        <tbody>
          {rowList.map((row) => (
            <Fragment key={row.keyText}>
              <tr>
                <td><kbd className="doc-api-key">{row.keyLabel}</kbd></td>
                <td data-muted={row.binding ? undefined : ''}>{row.binding ? row.binding.api : 'unbound'}</td>
                <td data-muted="">{row.binding?.whenText ?? ''}</td>
                <td data-muted="">{row.binding ? row.binding.mapId : ''}</td>
              </tr>
              {row.passedList.map((passed, index) => (
                <tr key={`${row.keyText}-passed-${index}`} data-passed="" title={passed.reason}>
                  <td />
                  <td>{passed.binding.api ?? 'null'}</td>
                  <td>{passed.binding.whenText}</td>
                  <td>{passed.binding.mapId} · {passed.reason}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      <h3>Calls ({apiStore.callRecordList.length})</h3>
      {apiStore.callRecordList.length === 0 ? <p className="doc-note">No api was called yet.</p> : (
        <table className="doc-api-table">
          <thead>
            <tr><th>time</th><th>api</th><th>by</th><th>code</th><th>message</th><th>ms</th></tr>
          </thead>
          <tbody>
            {apiStore.callRecordList.map((record, index) => (
              <tr key={`${record.time}-${index}`}>
                <td data-muted="">{new Date(record.time).toLocaleTimeString()}</td>
                <td>{record.id}</td>
                <td data-muted="">{record.principal.kind}{record.principal.id ? ` ${record.principal.id}` : ''}</td>
                <td data-muted={record.code === 0 ? '' : undefined}>{record.code}</td>
                <td data-muted="">{record.message}</td>
                <td data-muted="">{record.durationMs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
});
