import { useEffect, useRef, useState } from 'react';
import { serviceApiCall, serviceJobRun } from './service-call.js';

// The config dashboard of note-db: what the instance is, its database, a
// setting kept in the database, and reindex, an async api that shows the
// queue of the instance (the apis called while it runs wait for it).
//
//   config.service.instance   the instance as the backend lists it: its
//                             config is what service.yaml says
export function NoteDbConfigDashboard({ config = {}, onEvent }) {
  const instance = config.service?.instance;
  const [stat, setStat] = useState(null);
  const [message, setMessage] = useState('');
  const [job, setJob] = useState(null);

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

  const reindex = async () => {
    setMessage('');
    const result = await serviceJobRun(onEvent, 'reindex', { secondSlow: 3 }, setJob);
    if (result.code !== 0) setMessage(result.message);
    void statLoad();
  };

  const isJobRunning = job !== null && job.status !== 'done';

  return (
    <div className="note-db">
      <div className="note-db-grid">
        <span className="note-db-key">instance</span>
        <span>{instance?.name} <span className="note-db-muted">({instance?.serviceId})</span></span>
        {Object.entries(instance?.config ?? {}).map(([key, value]) => (
          <ConfigRow key={key} name={key} value={value} />
        ))}
        <span className="note-db-key">notes</span>
        <span>{stat ? `${stat.noteCount} notes, ${stat.bodyLengthTotal} characters of text` : '…'}</span>
        <span className="note-db-key">database</span>
        <span>{stat ? `${stat.databaseFile}, ${stat.databaseSize} bytes` : '…'}</span>
        <span className="note-db-key">owner</span>
        <SettingValue name="owner" onEvent={onEvent} />
      </div>
      <div className="note-db-toolbar">
        <button type="button" className="note-db-button" disabled={isJobRunning} onClick={() => void reindex()}>Reindex</button>
        <span className="note-db-muted">
          {isJobRunning
            ? `${job.status}, ${Math.round(job.progress * 100)}% ${job.progressMessage}: other calls to this instance wait`
            : job?.result?.code === 0
              ? `done: ${job.result.data.sizeBefore} → ${job.result.data.sizeAfter} bytes`
              : 'rebuilds the database file; slowed down to 3 s'}
        </span>
      </div>
      <div className="note-db-muted">the config is written in service.yaml of the instance folder; the backend restarts the instance when it changes.</div>
      {message ? <div className="note-db-error">{message}</div> : null}
    </div>
  );
}

function ConfigRow({ name, value }) {
  return (
    <>
      <span className="note-db-key">{name}</span>
      <span className="note-db-code">{JSON.stringify(value)}</span>
    </>
  );
}

// a setting kept in the instance's database, edited in place
function SettingValue({ name, onEvent }) {
  const valueRef = useRef(null);
  const [value, setValue] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void (async () => {
      const result = await serviceApiCall(onEvent, 'settingGet', { key: name });
      if (result.code === 0) setValue(result.data ?? '');
      else setMessage(result.message);
    })();
  }, [name]);

  useEffect(() => {
    if (!isEditing || !valueRef.current) return;
    valueRef.current.focus();
    document.getSelection()?.selectAllChildren(valueRef.current);
  }, [isEditing]);

  const save = async () => {
    const valueNext = valueRef.current.textContent.trim();
    const result = await serviceApiCall(onEvent, 'settingSet', { key: name, value: valueNext });
    if (result.code !== 0) {
      setMessage(result.message);
      return;
    }
    setValue(valueNext);
    setMessage('');
    setIsEditing(false);
  };

  const cancel = () => {
    valueRef.current.textContent = value ?? '';
    setIsEditing(false);
  };

  return (
    <span>
      <span
        ref={valueRef}
        className="note-db-setting"
        contentEditable={isEditing ? 'plaintext-only' : false}
        suppressContentEditableWarning
        onBlur={() => { if (isEditing) void save(); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void save();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        }}
      >
        {value === null ? '…' : value}
      </span>
      {!isEditing && value !== null && value === '' ? <span className="note-db-muted">(not set)</span> : null}
      {!isEditing ? <button type="button" className="note-db-icon" title="edit" onClick={() => setIsEditing(true)}>✎</button> : null}
      {message ? <span className="note-db-error"> {message}</span> : null}
    </span>
  );
}
