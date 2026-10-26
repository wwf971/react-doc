import { useEffect, useState } from 'react';
import { serviceApiCall, serviceResolve } from './service-call.js';

// A dashboard of purpose "other": the numbers of the notes, on one line, and
// on a second line another instance of the same template: the dashboard
// resolves it by template, reads its numbers by its id, and asks its own
// instance to import its notes, which calls the other instance itself
// (doc_page_impl_service.md#calls-between-services).
export function NoteDbStatDashboard({ config, onEvent }) {
  const [stat, setStat] = useState(null);
  const [message, setMessage] = useState('');
  // { serviceId, name, stat } of another instance; null while unknown
  const [peer, setPeer] = useState(null);
  // what the last look or import of the other instance said: { text, isError }
  const [peerNotice, setPeerNotice] = useState({ text: '', isError: false });
  const [isImporting, setIsImporting] = useState(false);
  const templateId = config.service.instance?.template?.templateId ?? '';

  const statLoad = async () => {
    const result = await serviceApiCall(onEvent, 'statGet');
    if (result.code !== 0) {
      setMessage(result.message);
      return;
    }
    setStat(result.data);
    setMessage('');
  };

  const peerLoad = async () => {
    const resolved = await serviceResolve(onEvent, { templateId });
    if (resolved.code !== 0) {
      setPeer(null);
      setPeerNotice({ text: resolved.message, isError: true });
      return;
    }
    const peerStat = await serviceApiCall(onEvent, 'statGet', {}, { serviceId: resolved.data.serviceId });
    setPeer({ serviceId: resolved.data.serviceId, name: resolved.data.name, stat: peerStat.code === 0 ? peerStat.data : null });
    setPeerNotice({ text: peerStat.code === 0 ? '' : peerStat.message, isError: true });
  };

  const noteImport = async () => {
    setIsImporting(true);
    const result = await serviceApiCall(onEvent, 'noteImport', { sourceServiceId: peer.serviceId });
    setIsImporting(false);
    if (result.code !== 0) {
      setPeerNotice({ text: result.message, isError: true });
      return;
    }
    setPeerNotice({ text: `imported ${result.data.importedCount}, ${result.data.skippedCount} already here`, isError: false });
    await statLoad();
  };

  const reload = () => {
    void statLoad();
    void peerLoad();
  };

  useEffect(reload, []);

  return (
    <div className="note-db">
      <div className="note-db-toolbar">
        {stat
          ? (
              <>
                <span><b>{stat.noteCount}</b> notes</span>
                <span><b>{stat.bodyLengthTotal}</b> characters</span>
                <span>longest <b>{stat.bodyLengthMax}</b></span>
                <span>database <b>{stat.databaseSize}</b> bytes</span>
              </>
            )
          : <span className="note-db-muted">…</span>}
        <button type="button" className="note-db-icon" title="refresh" onClick={reload}>↻</button>
        {message ? <span className="note-db-error">{message}</span> : null}
      </div>
      <div className="note-db-toolbar">
        <span className="note-db-muted">another instance of the template:</span>
        {peer
          ? (
              <>
                <span><b>{peer.name}</b>{peer.stat ? <>, <b>{peer.stat.noteCount}</b> notes</> : null}</span>
                <button type="button" className="note-db-button" disabled={isImporting} onClick={() => void noteImport()}>
                  {isImporting ? 'Importing…' : 'Import its notes'}
                </button>
              </>
            )
          : <span className="note-db-muted">{peerNotice.text ? 'none' : '…'}</span>}
        {peerNotice.text ? <span className={peerNotice.isError ? 'note-db-error' : 'note-db-muted'}>{peerNotice.text}</span> : null}
      </div>
    </div>
  );
}
