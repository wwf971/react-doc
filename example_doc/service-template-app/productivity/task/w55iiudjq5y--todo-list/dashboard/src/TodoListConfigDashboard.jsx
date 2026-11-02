import { useEffect, useState } from 'react';
import { serviceApiCall, serviceRefresh } from './service-call.js';

// The config dashboard of todo-list ("Storage"): the instance keeps nothing
// of its own, so the dashboard shows where its todos are: the infra services
// it depends on, its health, and the database the sqlite infra service
// holds for it, with its versions (created, checked out, removed from here),
// and the backups the local-backup infra service keeps of it (made, brought
// back and removed from here; absent when no local-backup instance answers).
//
//   config.service.instance   the instance as the backend lists it: its
//                             dependencies with their status (which infra
//                             instance provides each), its lifecycle status,
//                             its health
export function TodoListConfigDashboard({ config = {}, onEvent }) {
  const instance = config.service?.instance;
  const [info, setInfo] = useState(null);
  const [message, setMessage] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [backupNoteDraft, setBackupNoteDraft] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  // what the last version operation said: { text, isError }
  const [notice, setNotice] = useState({ text: '', isError: false });
  // the same for the backups
  const [backupNotice, setBackupNotice] = useState({ text: '', isError: false });

  const infoLoad = async () => {
    const result = await serviceApiCall(onEvent, 'storageInfo');
    if (result.code !== 0) {
      setMessage(result.message);
      return;
    }
    setInfo(result.data);
    setMessage('');
  };

  useEffect(() => {
    void infoLoad();
  }, []);

  const refresh = () => {
    void infoLoad();
    void serviceRefresh(onEvent);
  };

  const versionCreate = async () => {
    setIsBusy(true);
    const result = await serviceApiCall(onEvent, 'versionCreate', { note: noteDraft.trim() });
    setIsBusy(false);
    if (result.code !== 0) {
      setNotice({ text: result.message, isError: true });
      return;
    }
    setNoteDraft('');
    setNotice({ text: `version ${result.data.versionId} created`, isError: false });
    await infoLoad();
  };

  // answers the result, so the row shows the failure; refreshes on success
  const versionCheckout = async (versionId) => {
    setIsBusy(true);
    const result = await serviceApiCall(onEvent, 'versionCheckout', { versionId });
    setIsBusy(false);
    if (result.code === 0) {
      setNotice({ text: `version ${versionId} checked out; the database as it was is version ${result.data.versionBefore?.versionId}`, isError: false });
      await infoLoad();
    }
    return result;
  };

  const versionDelete = async (versionId) => {
    setIsBusy(true);
    const result = await serviceApiCall(onEvent, 'versionDelete', { versionId });
    setIsBusy(false);
    if (result.code === 0) {
      setNotice({ text: `version ${versionId} removed`, isError: false });
      await infoLoad();
    }
    return result;
  };

  const backupCreate = async () => {
    setIsBusy(true);
    const result = await serviceApiCall(onEvent, 'backupCreate', { note: backupNoteDraft.trim() });
    setIsBusy(false);
    if (result.code !== 0) {
      setBackupNotice({ text: result.message, isError: true });
      return;
    }
    setBackupNoteDraft('');
    setBackupNotice({ text: `backup ${result.data.fileName} made`, isError: false });
    await infoLoad();
  };

  const backupCheckout = async (versionId) => {
    setIsBusy(true);
    const result = await serviceApiCall(onEvent, 'backupCheckout', { versionId });
    setIsBusy(false);
    if (result.code === 0) {
      setBackupNotice({ text: `backup brought back; the database as it was is sqlite version ${result.data.versionBefore?.versionId}`, isError: false });
      await infoLoad();
    }
    return result;
  };

  const backupDelete = async (versionId) => {
    setIsBusy(true);
    const result = await serviceApiCall(onEvent, 'backupDelete', { versionId });
    setIsBusy(false);
    if (result.code === 0) {
      setBackupNotice({ text: 'backup removed', isError: false });
      await infoLoad();
    }
    return result;
  };

  const database = info?.database;
  const versionList = database?.versionList ?? [];
  const backup = info?.backup ?? null;
  const backupList = backup?.backupList ?? [];

  return (
    <div className="todo-list">
      <div className="todo-list-grid">
        <span className="todo-list-key">instance</span>
        <span>
          {instance?.name} <span className="todo-list-muted">({instance?.serviceId})</span>
          {' '}<StatusDot status={instance?.status} />{instance?.status}
          {instance?.message ? <span className="todo-list-muted"> {instance.message}</span> : null}
        </span>
        <span className="todo-list-key">depends on</span>
        <span>
          {(instance?.dependencyStatusList ?? []).length === 0
            ? <span className="todo-list-muted">nothing</span>
            : (instance?.dependencyStatusList ?? []).map((dependency) => (
                <span key={dependency.name} style={{ display: 'block' }}>
                  <StatusDot status={dependency.status} />
                  <b>{dependency.name}</b> {dependency.status}
                  {dependency.serviceId ? <span className="todo-list-muted"> by {dependency.serviceId}</span> : null}
                  <span className="todo-list-muted"> ({dependency.isRequired ? 'required' : 'optional'}, {dependency.onUnavailable} when unavailable)</span>
                  {dependency.message ? <span className="todo-list-muted"> {dependency.message}</span> : null}
                </span>
              ))}
        </span>
        <span className="todo-list-key">health</span>
        <span>
          <StatusDot status={instance?.health} />{instance?.health}
          {instance?.healthMessage ? <span className="todo-list-muted"> {instance.healthMessage}</span> : null}
        </span>
        <span className="todo-list-key">database</span>
        <span>
          {info
            ? (
                <>
                  <span title={database.file}>{pathTailGet(database.file)}</span>
                  <span className="todo-list-muted"> · {database.size} bytes · table{database.tableList.length === 1 ? '' : 's'}: {database.tableList.join(', ') || 'none'}</span>
                  <span className="todo-list-muted"> · held by {info.infra.name} <StatusDot status={info.infra.status} />{info.infra.serviceId}</span>
                </>
              )
            : <span className="todo-list-muted">{message ? '—' : '…'}</span>}
        </span>
      </div>
      {message ? <div className="todo-list-error">{message}</div> : null}
      <div className="todo-list-toolbar">
        <span className="todo-list-section">versions</span>
        <input
          className="todo-list-input todo-list-input-note"
          type="text"
          placeholder="a note for the version"
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void versionCreate();
          }}
        />
        <button type="button" className="todo-list-button" disabled={isBusy || !info} onClick={() => void versionCreate()}>Create version</button>
        <button type="button" className="todo-list-icon" title="refresh" onClick={refresh}>↻</button>
        {notice.text ? <span className={notice.isError ? 'todo-list-error' : 'todo-list-muted'}>{notice.text}</span> : null}
      </div>
      {versionList.length === 0
        ? <div className="todo-list-muted">{info ? 'no version yet' : ''}</div>
        : (
            <table className="todo-list-table">
              <thead>
                <tr>
                  <th>version</th>
                  <th>time</th>
                  <th>note</th>
                  <th>size</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {versionList.map((version) => (
                  <VersionRow
                    key={version.versionId}
                    version={version}
                    isBusy={isBusy}
                    onCheckout={() => versionCheckout(version.versionId)}
                    onDelete={() => versionDelete(version.versionId)}
                  />
                ))}
              </tbody>
            </table>
          )}
      <div className="todo-list-muted">a checkout keeps the database as it is as a version first; the versions are the infra service's, in its own folder.</div>
      <div className="todo-list-toolbar">
        <span className="todo-list-section">backups</span>
        {backup
          ? (
              <>
                <input
                  className="todo-list-input todo-list-input-note"
                  type="text"
                  placeholder="a note for the backup"
                  value={backupNoteDraft}
                  onChange={(event) => setBackupNoteDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void backupCreate();
                  }}
                />
                <button type="button" className="todo-list-button" disabled={isBusy || !info} onClick={() => void backupCreate()}>Create backup</button>
                <span className="todo-list-muted">kept by {backup.infra.name} <StatusDot status={backup.infra.status} />{backup.infra.serviceId}</span>
              </>
            )
          : <span className="todo-list-muted">{info ? 'no local-backup infra instance answers: the backups need one (the kernel provisions it from the built-in template)' : ''}</span>}
        {backupNotice.text ? <span className={backupNotice.isError ? 'todo-list-error' : 'todo-list-muted'}>{backupNotice.text}</span> : null}
      </div>
      {backup
        ? backupList.length === 0
          ? <div className="todo-list-muted">no backup yet</div>
          : (
              <table className="todo-list-table">
                <thead>
                  <tr>
                    <th>time</th>
                    <th>note</th>
                    <th>size</th>
                    <th>file</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {backupList.map((item) => (
                    <BackupRow
                      key={item.versionId}
                      backup={item}
                      isBusy={isBusy}
                      onCheckout={() => backupCheckout(item.versionId)}
                      onDelete={() => backupDelete(item.versionId)}
                    />
                  ))}
                </tbody>
              </table>
            )
        : null}
      {backup ? <div className="todo-list-muted">a backup is one zip file in the local-backup instance's folder, outside the sqlite instance; bringing one back keeps the database as it is as a sqlite version first.</div> : null}
    </div>
  );
}

// one backup: bring back and remove, each confirmed in place, like a version
function BackupRow({ backup, isBusy, onCheckout, onDelete }) {
  // '' | 'checkout' | 'delete'
  const [asked, setAsked] = useState('');
  const [message, setMessage] = useState('');

  const run = async (action) => {
    setAsked('');
    const result = await action();
    setMessage(result.code === 0 ? '' : result.message);
  };

  return (
    <>
      <tr className={asked || message ? 'todo-list-row-open' : ''}>
        <td className="todo-list-code todo-list-cell-nowrap">{backup.time}</td>
        <td>{backup.note || <span className="todo-list-muted">(no note)</span>}</td>
        <td className="todo-list-cell-nowrap">{backup.size}</td>
        <td className="todo-list-code todo-list-cell-wrap" title={backup.file}>{backup.fileName}</td>
        <td className="todo-list-cell-action">
          <button type="button" className="todo-list-button" disabled={isBusy || asked !== ''} onClick={() => setAsked('checkout')}>Bring back</button>
          {' '}
          <button type="button" className="todo-list-icon" title="remove the backup" disabled={isBusy || asked !== ''} onClick={() => setAsked('delete')}>🗑</button>
        </td>
      </tr>
      {asked || message
        ? (
            <tr>
              <td colSpan={5}>
                {asked === 'checkout'
                  ? (
                      <span className="todo-list-ask">
                        the todos become those of the backup of {backup.time}; the database as it is now is kept as a sqlite version first.
                        <button type="button" className="todo-list-button" onClick={() => void run(onCheckout)}>Bring back</button>
                        <button type="button" className="todo-list-button" onClick={() => setAsked('')}>Keep</button>
                      </span>
                    )
                  : asked === 'delete'
                    ? (
                        <span className="todo-list-ask">
                          remove the backup of {backup.time}?
                          <button type="button" className="todo-list-button" onClick={() => void run(onDelete)}>Remove</button>
                          <button type="button" className="todo-list-button" onClick={() => setAsked('')}>Keep</button>
                        </span>
                      )
                    : null}
                {message ? <span className="todo-list-error">{message}</span> : null}
              </td>
            </tr>
          )
        : null}
    </>
  );
}

// one version: check out and remove, each confirmed in place, on a row of
// its own under the version so the columns of the table stay where they are
function VersionRow({ version, isBusy, onCheckout, onDelete }) {
  // '' | 'checkout' | 'delete'
  const [asked, setAsked] = useState('');
  const [message, setMessage] = useState('');

  const run = async (action) => {
    setAsked('');
    const result = await action();
    setMessage(result.code === 0 ? '' : result.message);
  };

  return (
    <>
      <tr className={asked || message ? 'todo-list-row-open' : ''}>
        <td className="todo-list-code todo-list-cell-nowrap">{version.versionId}</td>
        <td className="todo-list-code todo-list-cell-nowrap">{version.time}</td>
        <td>{version.note || <span className="todo-list-muted">(no note)</span>}</td>
        <td>{version.size}</td>
        <td className="todo-list-cell-action">
          <button type="button" className="todo-list-button" disabled={isBusy || asked !== ''} onClick={() => setAsked('checkout')}>Check out</button>
          {' '}
          <button type="button" className="todo-list-icon" title="remove the version" disabled={isBusy || asked !== ''} onClick={() => setAsked('delete')}>🗑</button>
        </td>
      </tr>
      {asked || message
        ? (
            <tr>
              <td colSpan={5}>
                {asked === 'checkout'
                  ? (
                      <span className="todo-list-ask">
                        the todos become those of version {version.versionId}; the database as it is now is kept as a version first.
                        <button type="button" className="todo-list-button" onClick={() => void run(onCheckout)}>Check out</button>
                        <button type="button" className="todo-list-button" onClick={() => setAsked('')}>Keep</button>
                      </span>
                    )
                  : asked === 'delete'
                    ? (
                        <span className="todo-list-ask">
                          remove version {version.versionId}?
                          <button type="button" className="todo-list-button" onClick={() => void run(onDelete)}>Remove</button>
                          <button type="button" className="todo-list-button" onClick={() => setAsked('')}>Keep</button>
                        </span>
                      )
                    : null}
                {message ? <span className="todo-list-error">{message}</span> : null}
              </td>
            </tr>
          )
        : null}
    </>
  );
}

// the end of a path: enough to tell the file, the whole path in the title
function pathTailGet(path) {
  const segmentList = String(path ?? '').split('/');
  return segmentList.slice(-3).join('/');
}

function StatusDot({ status }) {
  const kind = ['ready', 'available', 'healthy'].includes(status)
    ? 'ok'
    : ['starting', 'waiting', 'degraded', 'notProvided'].includes(status)
      ? 'warn'
      : ['error', 'unavailable', 'unhealthy', 'disabled'].includes(status)
        ? 'bad'
        : '';
  return <span className={kind ? `todo-list-dot todo-list-dot-${kind}` : 'todo-list-dot'} />;
}
