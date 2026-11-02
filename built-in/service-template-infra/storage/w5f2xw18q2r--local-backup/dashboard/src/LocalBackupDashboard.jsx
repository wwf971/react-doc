import { useEffect, useState } from 'react';
import { serviceApiCall, serviceRefresh } from './service-call.js';

// The default dashboard of local-backup ("Backups"): the backup folder of
// the instance and what it holds, read from the folder on every refresh.
//
//   folder      folderInfo: where the folder is, how many backups, how large,
//               how many consumers and orphans, the names that are no backup
//   consumers   consumerList: every consumer with backups, the found ones
//               (an instance the kernel lists) first, then the orphans
//               (deleted, or of another backend); one opens its backups
//
// everything is deleted with a confirmation in place, on a row of its own
// under what it is about, so the rows above it never move.
export function LocalBackupDashboard({ onEvent, children }) {
  const [folder, setFolder] = useState(null);
  const [consumerList, setConsumerList] = useState([]);
  const [message, setMessage] = useState('');
  const [consumerIdOpen, setConsumerIdOpen] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  // what the last operation said: { text, isError }
  const [notice, setNotice] = useState({ text: '', isError: false });
  const [isOrphanDeleteAsked, setIsOrphanDeleteAsked] = useState(false);

  const load = async () => {
    const [folderResult, consumerResult] = await Promise.all([
      serviceApiCall(onEvent, 'folderInfo'),
      serviceApiCall(onEvent, 'consumerList'),
    ]);
    if (folderResult.code !== 0 || consumerResult.code !== 0) {
      setMessage(folderResult.code !== 0 ? folderResult.message : consumerResult.message);
      return;
    }
    setFolder(folderResult.data);
    setConsumerList(consumerResult.data);
    setMessage('');
  };

  useEffect(() => {
    void load();
  }, []);

  const refresh = () => {
    void load();
    void serviceRefresh(onEvent);
  };

  const run = async (api, params, textDone) => {
    setIsBusy(true);
    const result = await serviceApiCall(onEvent, api, params);
    setIsBusy(false);
    if (result.code !== 0) {
      setNotice({ text: result.message, isError: true });
      return result;
    }
    setNotice({ text: textDone(result.data), isError: false });
    await load();
    return result;
  };

  const orphanCount = folder?.orphanCount ?? 0;

  return (
    <div className="local-backup">
      <div className="local-backup-grid">
        {children}
        <span className="local-backup-key">folder</span>
        <span>
          {folder
            ? (
                <>
                  <span className="local-backup-path" title={folder.backupDir}>{folder.backupDir}</span>
                  <span className="local-backup-muted"> · {folder.isBackupDirDefault ? 'the default folder (.doc-page/service-backup/ of the doc page)' : 'from the config (backupDir)'}</span>
                  {!folder.isExisting ? <span className="local-backup-error"> · does not exist</span> : null}
                </>
              )
            : <span className="local-backup-muted">{message ? '—' : '…'}</span>}
        </span>
        <span className="local-backup-key">holds</span>
        <span>
          {folder
            ? (
                <>
                  {countText(folder.backupCount, 'backup')} · {sizeText(folder.sizeTotal)} · {countText(folder.consumerCount, 'consumer')}
                  {orphanCount ? <span className="local-backup-warn"> · {countText(orphanCount, 'orphan')} (its instance is not found)</span> : <span className="local-backup-muted"> · no orphan</span>}
                </>
              )
            : <span className="local-backup-muted">…</span>}
        </span>
        {folder?.problemList?.length ? (
          <>
            <span className="local-backup-key">not a backup</span>
            <span>
              {folder.problemList.map((problem) => <span key={problem} className="local-backup-error" style={{ display: 'block' }}>{problem}</span>)}
            </span>
          </>
        ) : null}
      </div>
      {message ? <div className="local-backup-error">{message}</div> : null}
      <div className="local-backup-toolbar">
        <span className="local-backup-section">consumers</span>
        <button type="button" className="local-backup-icon" title="read the folder again" onClick={refresh}>↻</button>
        {orphanCount && !isOrphanDeleteAsked
          ? <button type="button" className="local-backup-button" disabled={isBusy} onClick={() => setIsOrphanDeleteAsked(true)}>Delete all orphans</button>
          : null}
        {isOrphanDeleteAsked
          ? (
              <span className="local-backup-ask">
                remove every backup whose instance is not found ({countText(orphanCount, 'consumer')})?
                <button
                  type="button"
                  className="local-backup-button"
                  onClick={() => {
                    setIsOrphanDeleteAsked(false);
                    void run('orphanDeleteAll', {}, (data) => `${countText(data.deletedCount, 'orphan backup')} removed`);
                  }}
                >
                  Remove
                </button>
                <button type="button" className="local-backup-button" onClick={() => setIsOrphanDeleteAsked(false)}>Keep</button>
              </span>
            )
          : null}
        {notice.text ? <span className={notice.isError ? 'local-backup-error' : 'local-backup-muted'}>{notice.text}</span> : null}
      </div>
      {consumerList.length === 0
        ? <div className="local-backup-muted">{folder ? 'no backup in the folder' : ''}</div>
        : (
            <table className="local-backup-table">
              <thead>
                <tr>
                  <th>consumer</th>
                  <th>template</th>
                  <th>backups</th>
                  <th>size</th>
                  <th>latest</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {consumerList.map((consumer) => (
                  <ConsumerRow
                    key={consumer.consumerServiceId}
                    consumer={consumer}
                    isOpen={consumerIdOpen === consumer.consumerServiceId}
                    isBusy={isBusy}
                    onOpen={() => setConsumerIdOpen(consumerIdOpen === consumer.consumerServiceId ? '' : consumer.consumerServiceId)}
                    onDeleteAll={() => run('consumerDelete', { consumerServiceId: consumer.consumerServiceId },
                      (data) => `${countText(data.deletedCount, 'backup')} of ${consumer.instanceName || consumer.consumerServiceId} removed`)}
                    onEvent={onEvent}
                    reloadKey={`${folder?.backupCount}:${notice.text}`}
                  />
                ))}
              </tbody>
            </table>
          )}
      <div className="local-backup-muted">a backup is one zip file, {'{consumerServiceId}--{templateName}--{time}[--{note}].zip'}; the folder is read as it is, nothing is kept beside it.</div>
    </div>
  );
}

// one consumer: its instance (or "not found"), its counts; opened, its
// backups below it, and "Delete all" confirmed in place
function ConsumerRow({ consumer, isOpen, isBusy, onOpen, onDeleteAll, onEvent, reloadKey }) {
  const [isDeleteAsked, setIsDeleteAsked] = useState(false);
  const [message, setMessage] = useState('');

  return (
    <>
      <tr className={isOpen || isDeleteAsked || message ? 'local-backup-row-open' : ''}>
        <td>
          <button type="button" className="local-backup-link" title={isOpen ? 'close the backups' : 'show the backups'} onClick={onOpen}>
            {isOpen ? '▾' : '▸'} {consumer.isInstanceFound ? consumer.instanceName : consumer.consumerServiceId}
          </button>
          {consumer.isInstanceFound
            ? <span className="local-backup-muted local-backup-cell-nowrap"> <span className="local-backup-code">{consumer.consumerServiceId}</span> <StatusDot status={consumer.instanceStatus} />{consumer.instanceStatus}</span>
            : <span className="local-backup-badge-warn">not found</span>}
        </td>
        <td>{consumer.templateName}</td>
        <td>{consumer.backupCount}</td>
        <td className="local-backup-cell-nowrap">{sizeText(consumer.sizeTotal)}</td>
        <td className="local-backup-code local-backup-cell-nowrap">{consumer.timeLatest}</td>
        <td className="local-backup-cell-action">
          <button type="button" className="local-backup-icon" title="remove every backup of this consumer" disabled={isBusy || isDeleteAsked} onClick={() => setIsDeleteAsked(true)}>🗑</button>
        </td>
      </tr>
      {isDeleteAsked || message
        ? (
            <tr className={isOpen ? 'local-backup-row-open' : ''}>
              <td colSpan={6}>
                {isDeleteAsked
                  ? (
                      <span className="local-backup-ask">
                        remove all {countText(consumer.backupCount, 'backup')} of {consumer.instanceName || consumer.consumerServiceId}?
                        <button
                          type="button"
                          className="local-backup-button"
                          onClick={async () => {
                            setIsDeleteAsked(false);
                            const result = await onDeleteAll();
                            setMessage(result.code === 0 ? '' : result.message);
                          }}
                        >
                          Remove
                        </button>
                        <button type="button" className="local-backup-button" onClick={() => setIsDeleteAsked(false)}>Keep</button>
                      </span>
                    )
                  : null}
                {message ? <span className="local-backup-error">{message}</span> : null}
              </td>
            </tr>
          )
        : null}
      {isOpen
        ? (
            <tr>
              <td colSpan={6} className="local-backup-cell-nested">
                <BackupList consumerServiceId={consumer.consumerServiceId} isBusy={isBusy} onEvent={onEvent} reloadKey={reloadKey} />
              </td>
            </tr>
          )
        : null}
    </>
  );
}

// the backups of one consumer, oldest first, each removed with a confirmation
function BackupList({ consumerServiceId, isBusy, onEvent, reloadKey }) {
  const [backupList, setBackupList] = useState(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const result = await serviceApiCall(onEvent, 'versionList', { consumerServiceId });
    if (result.code !== 0) {
      setMessage(result.message);
      return;
    }
    setBackupList(result.data);
    setMessage('');
  };

  useEffect(() => {
    void load();
  }, [consumerServiceId, reloadKey]);

  if (message) return <span className="local-backup-error">{message}</span>;
  if (backupList === null) return <span className="local-backup-muted">…</span>;
  if (backupList.length === 0) return <span className="local-backup-muted">no backup</span>;
  return (
    <table className="local-backup-table local-backup-table-nested">
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
        {backupList.map((backup) => (
          <BackupRow
            key={backup.versionId}
            backup={backup}
            isBusy={isBusy}
            onDelete={async () => {
              const result = await serviceApiCall(onEvent, 'versionDelete', { versionId: backup.versionId, consumerServiceId });
              if (result.code === 0) await load();
              return result;
            }}
          />
        ))}
      </tbody>
    </table>
  );
}

function BackupRow({ backup, isBusy, onDelete }) {
  const [isAsked, setIsAsked] = useState(false);
  const [message, setMessage] = useState('');

  return (
    <>
      <tr className={isAsked || message ? 'local-backup-row-open' : ''}>
        <td className="local-backup-code local-backup-cell-nowrap">{backup.time}</td>
        <td>{backup.note || <span className="local-backup-muted">(no note)</span>}</td>
        <td className="local-backup-cell-nowrap">{sizeText(backup.size)}</td>
        <td className="local-backup-code" title={backup.file}>{backup.fileName}</td>
        <td className="local-backup-cell-action">
          <button type="button" className="local-backup-icon" title="remove the backup" disabled={isBusy || isAsked} onClick={() => setIsAsked(true)}>🗑</button>
        </td>
      </tr>
      {isAsked || message
        ? (
            <tr>
              <td colSpan={5}>
                {isAsked
                  ? (
                      <span className="local-backup-ask">
                        remove the backup of {backup.time}{backup.note ? ` (${backup.note})` : ''}?
                        <button
                          type="button"
                          className="local-backup-button"
                          onClick={async () => {
                            setIsAsked(false);
                            const result = await onDelete();
                            setMessage(result.code === 0 ? '' : result.message);
                          }}
                        >
                          Remove
                        </button>
                        <button type="button" className="local-backup-button" onClick={() => setIsAsked(false)}>Keep</button>
                      </span>
                    )
                  : null}
                {message ? <span className="local-backup-error">{message}</span> : null}
              </td>
            </tr>
          )
        : null}
    </>
  );
}

export function countText(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function sizeText(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function StatusDot({ status }) {
  const kind = ['ready', 'available', 'healthy'].includes(status)
    ? 'ok'
    : ['starting', 'waiting', 'degraded', 'notProvided'].includes(status)
      ? 'warn'
      : ['error', 'unavailable', 'unhealthy', 'disabled'].includes(status)
        ? 'bad'
        : '';
  return <span className={kind ? `local-backup-dot local-backup-dot-${kind}` : 'local-backup-dot'} />;
}
