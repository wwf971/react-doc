import { useEffect, useState } from 'react';
import { serviceApiCall } from './service-call.js';

// A dashboard of purpose "other": the numbers of the notes, on one line.
export function NoteDbStatDashboard({ onEvent }) {
  const [stat, setStat] = useState(null);
  const [message, setMessage] = useState('');

  const statLoad = async () => {
    const result = await serviceApiCall(onEvent, 'statGet');
    if (result.code !== 0) {
      setMessage(result.message);
      return;
    }
    setStat(result.data);
    setMessage('');
  };

  useEffect(() => {
    void statLoad();
  }, []);

  return (
    <div className="note-db note-db-toolbar">
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
      <button type="button" className="note-db-icon" title="refresh" onClick={() => void statLoad()}>↻</button>
      {message ? <span className="note-db-error">{message}</span> : null}
    </div>
  );
}
