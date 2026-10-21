import { useEffect, useRef, useState } from 'react';
import { dashboardStateSet, serviceApiCall } from './service-call.js';

// The default dashboard of note-db: the notes of the instance, searched,
// added, edited in place and removed.
//
//   data.state           { query }: the search the dashboard shows, kept
//                        in the dashboard's asset object, so a document
//                        opens on the same search
//   config.state         { isWritable, unavailableReason }: whether the
//                        state can be saved (a pinned asset version cannot)
//   onEvent              the service calls (service-call.js)
//
// the page mounts the dashboard again when it is bound to another
// instance, so the dashboard reads its instance once, at mount.
export function NoteDbDashboard({ data = {}, config = {}, onEvent }) {
  const state = data.state ?? {};
  const queryState = typeof state.query === 'string' ? state.query : '';
  const isStateWritable = config.state?.isWritable === true;

  const [queryDraft, setQueryDraft] = useState(queryState);
  const [queryApplied, setQueryApplied] = useState(queryState);
  const [noteList, setNoteList] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [noteIdEditing, setNoteIdEditing] = useState(null);

  // the state changed in the asset (another tab, another block of the same object)
  useEffect(() => {
    setQueryDraft(queryState);
    setQueryApplied(queryState);
  }, [queryState]);

  const listLoad = async (query) => {
    setStatus('loading');
    const result = await serviceApiCall(onEvent, 'noteList', { limit: 50, query });
    if (result.code !== 0) {
      setStatus('error');
      setMessage(result.message);
      return;
    }
    setNoteList(result.data.noteList);
    setTotal(result.data.total);
    setStatus('done');
    setMessage('');
  };

  useEffect(() => {
    void listLoad(queryApplied);
  }, [queryApplied]);

  const searchApply = async () => {
    setQueryApplied(queryDraft);
    if (!isStateWritable || queryDraft === queryState) return;
    const result = await dashboardStateSet(onEvent, { ...state, query: queryDraft });
    if (result.code !== 0) setMessage(`the search was not saved: ${result.message}`);
  };

  const noteCreate = async () => {
    const result = await serviceApiCall(onEvent, 'noteCreate', { title: 'untitled' });
    if (result.code !== 0) {
      setMessage(result.message);
      return;
    }
    await listLoad(queryApplied);
    setNoteIdEditing(result.data.noteId);
  };

  const noteSave = async (noteId, title, body) => {
    const result = await serviceApiCall(onEvent, 'noteUpdate', { noteId, title, body });
    if (result.code !== 0) return result;
    setNoteIdEditing(null);
    await listLoad(queryApplied);
    return result;
  };

  const noteDelete = async (noteId) => {
    const result = await serviceApiCall(onEvent, 'noteDelete', { noteId });
    if (result.code !== 0) {
      setMessage(result.message);
      return;
    }
    await listLoad(queryApplied);
  };

  return (
    <div className="note-db">
      <div className="note-db-toolbar">
        <input
          className="note-db-search"
          type="search"
          placeholder="search title and text"
          value={queryDraft}
          onChange={(event) => setQueryDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void searchApply();
          }}
        />
        <button type="button" className="note-db-button" onClick={() => void searchApply()}>Search</button>
        <button type="button" className="note-db-button" onClick={() => void noteCreate()}>+ Note</button>
        <span className="note-db-muted">
          {status === 'loading' ? 'loading…' : `${total} note${total === 1 ? '' : 's'}`}
        </span>
      </div>
      {!isStateWritable && config.state?.unavailableReason
        ? <div className="note-db-muted">the search is not saved: {config.state.unavailableReason}</div>
        : null}
      {message ? <div className="note-db-error">{message}</div> : null}
      <div className="note-db-list">
        {noteList.map((note) => (
          <NoteRow
            key={`${note.noteId}:${note.timeUpdated}`}
            note={note}
            isEditing={noteIdEditing === note.noteId}
            onEditStart={() => setNoteIdEditing(note.noteId)}
            onEditCancel={() => setNoteIdEditing(null)}
            onSave={(title, body) => noteSave(note.noteId, title, body)}
            onDelete={() => noteDelete(note.noteId)}
          />
        ))}
        {status === 'done' && noteList.length === 0
          ? <div className="note-db-muted">{queryApplied ? 'no note matches the search' : 'no notes yet'}</div>
          : null}
      </div>
    </div>
  );
}

// one note. the title and the text are edited in place (contenteditable);
// the row is keyed by the note's update time, so a saved note is drawn anew
function NoteRow({ note, isEditing, onEditStart, onEditCancel, onSave, onDelete }) {
  const titleRef = useRef(null);
  const bodyRef = useRef(null);
  const [message, setMessage] = useState('');
  const [isDeleteAsked, setIsDeleteAsked] = useState(false);

  useEffect(() => {
    if (isEditing) titleRef.current?.focus();
  }, [isEditing]);

  const save = async () => {
    const result = await onSave(titleRef.current.textContent, bodyRef.current.innerText);
    if (result.code !== 0) setMessage(result.message);
  };

  const cancel = () => {
    titleRef.current.textContent = note.title;
    bodyRef.current.textContent = note.body;
    setMessage('');
    onEditCancel();
  };

  const keyHandle = (event, isTitle) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
    if (event.key === 'Enter' && (isTitle || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  };

  return (
    <div className={isEditing ? 'note-db-note note-db-note-editing' : 'note-db-note'}>
      <div className="note-db-note-head">
        <span
          ref={titleRef}
          className="note-db-note-title"
          contentEditable={isEditing ? 'plaintext-only' : false}
          suppressContentEditableWarning
          onKeyDown={(event) => keyHandle(event, true)}
        >
          {note.title}
        </span>
        {isEditing
          ? (
              <>
                <button type="button" className="note-db-icon" title="save (Enter in the title, Ctrl/⌘+Enter in the text)" onClick={() => void save()}>✓</button>
                <button type="button" className="note-db-icon" title="cancel (Escape)" onClick={cancel}>×</button>
              </>
            )
          : <button type="button" className="note-db-icon" title="edit" onClick={onEditStart}>✎</button>}
        <span className="note-db-muted">#{note.noteId} · {note.timeUpdated}</span>
        {isDeleteAsked
          ? (
              <span className="note-db-ask">
                remove?
                <button type="button" className="note-db-button" onClick={() => void onDelete()}>Remove</button>
                <button type="button" className="note-db-button" onClick={() => setIsDeleteAsked(false)}>Keep</button>
              </span>
            )
          : <button type="button" className="note-db-icon" title="remove" onClick={() => setIsDeleteAsked(true)}>🗑</button>}
      </div>
      <div
        ref={bodyRef}
        className="note-db-note-body"
        contentEditable={isEditing ? 'plaintext-only' : false}
        suppressContentEditableWarning
        data-placeholder="(no text)"
        onKeyDown={(event) => keyHandle(event, false)}
      >
        {note.body}
      </div>
      {message ? <div className="note-db-error">{message}</div> : null}
    </div>
  );
}
