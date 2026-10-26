import { useEffect, useRef, useState } from 'react';
import { dashboardStateSet, serviceApiCall } from './service-call.js';

const FILTER_LIST = ['all', 'open', 'done'];

// The default dashboard of todo-list: the todos of the instance, the open
// ones first; added, checked off, edited in place and removed.
//
//   data.state           { filter }: all | open | done, what the dashboard
//                        shows, kept in the dashboard's asset object, so a
//                        document opens on the same filter
//   config.state         { isWritable, unavailableReason }: whether the
//                        state can be saved (a pinned asset version cannot)
//   onEvent              the service calls (service-call.js)
//
// the todos are not the instance's own: they live in the sqlite infra
// service, so every call may answer -7 (the infra unavailable). the message
// is shown where the call was asked for, like any other failure.
export function TodoListDashboard({ data = {}, config = {}, onEvent }) {
  const state = data.state ?? {};
  const filterState = FILTER_LIST.includes(state.filter) ? state.filter : 'all';
  const isStateWritable = config.state?.isWritable === true;

  const [filter, setFilter] = useState(filterState);
  const [todoList, setTodoList] = useState([]);
  const [count, setCount] = useState({ openCount: 0, total: 0 });
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [todoIdEditing, setTodoIdEditing] = useState(null);
  const [isClearAsked, setIsClearAsked] = useState(false);

  // the state changed in the asset (another tab, another block of the same object)
  useEffect(() => {
    setFilter(filterState);
  }, [filterState]);

  const listLoad = async (filterNow) => {
    setStatus('loading');
    const params = { limit: 200 };
    if (filterNow !== 'all') params.isDone = filterNow === 'done';
    const result = await serviceApiCall(onEvent, 'todoList', params);
    if (result.code !== 0) {
      setStatus('error');
      setMessage(result.message);
      return;
    }
    setTodoList(result.data.todoList);
    setCount({ openCount: result.data.openCount, total: result.data.total });
    setStatus('done');
    setMessage('');
  };

  useEffect(() => {
    void listLoad(filter);
  }, [filter]);

  const filterChoose = async (filterNext) => {
    setFilter(filterNext);
    if (!isStateWritable || filterNext === filterState) return;
    const result = await dashboardStateSet(onEvent, { ...state, filter: filterNext });
    if (result.code !== 0) setMessage(`the filter was not saved: ${result.message}`);
  };

  const todoCreate = async () => {
    const title = titleDraft.trim();
    if (title === '') return;
    const result = await serviceApiCall(onEvent, 'todoCreate', { title });
    if (result.code !== 0) {
      setMessage(result.message);
      return;
    }
    setTitleDraft('');
    await listLoad(filter);
  };

  // the apis of one todo answer their result, so the row shows the failure
  const todoDoneSet = async (todoId, isDone) => {
    const result = await serviceApiCall(onEvent, 'todoDoneSet', { todoId, isDone });
    if (result.code === 0) await listLoad(filter);
    return result;
  };

  const todoUpdate = async (todoId, title) => {
    const result = await serviceApiCall(onEvent, 'todoUpdate', { todoId, title });
    if (result.code === 0) {
      setTodoIdEditing(null);
      await listLoad(filter);
    }
    return result;
  };

  const todoDelete = async (todoId) => {
    const result = await serviceApiCall(onEvent, 'todoDelete', { todoId });
    if (result.code === 0) await listLoad(filter);
    return result;
  };

  const todoClearDone = async () => {
    setIsClearAsked(false);
    const result = await serviceApiCall(onEvent, 'todoClearDone');
    if (result.code !== 0) {
      setMessage(result.message);
      return;
    }
    await listLoad(filter);
  };

  const doneCount = count.total - count.openCount;

  return (
    <div className="todo-list">
      <div className="todo-list-toolbar">
        <input
          className="todo-list-input"
          type="text"
          placeholder="a new todo, Enter adds it"
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void todoCreate();
          }}
        />
        <button type="button" className="todo-list-button" disabled={titleDraft.trim() === ''} onClick={() => void todoCreate()}>+ Add</button>
        <span className="todo-list-filter">
          {FILTER_LIST.map((item) => (
            <button
              key={item}
              type="button"
              className={item === filter ? 'todo-list-filter-on' : ''}
              onClick={() => void filterChoose(item)}
            >
              {item}
            </button>
          ))}
        </span>
        <span className="todo-list-muted">
          {status === 'loading' && count.total === 0 ? 'loading…' : `${count.openCount} / ${count.total} open`}
        </span>
        {doneCount > 0
          ? isClearAsked
            ? (
                <span className="todo-list-ask">
                  remove the {doneCount} done?
                  <button type="button" className="todo-list-button" onClick={() => void todoClearDone()}>Remove</button>
                  <button type="button" className="todo-list-button" onClick={() => setIsClearAsked(false)}>Keep</button>
                </span>
              )
            : <button type="button" className="todo-list-button" onClick={() => setIsClearAsked(true)}>Clear done</button>
          : null}
      </div>
      {!isStateWritable && config.state?.unavailableReason
        ? <div className="todo-list-muted">the filter is not saved: {config.state.unavailableReason}</div>
        : null}
      {message ? <div className="todo-list-error">{message}</div> : null}
      <div className="todo-list-list">
        {todoList.map((todo) => (
          <TodoRow
            key={`${todo.todoId}:${todo.timeUpdated}`}
            todo={todo}
            isEditing={todoIdEditing === todo.todoId}
            onEditStart={() => setTodoIdEditing(todo.todoId)}
            onEditCancel={() => setTodoIdEditing(null)}
            onDoneSet={(isDone) => todoDoneSet(todo.todoId, isDone)}
            onSave={(title) => todoUpdate(todo.todoId, title)}
            onDelete={() => todoDelete(todo.todoId)}
          />
        ))}
        {status === 'done' && todoList.length === 0
          ? <div className="todo-list-muted">{filter === 'all' ? 'no todos yet' : `no ${filter} todo`}</div>
          : null}
      </div>
    </div>
  );
}

// one todo: a checkbox, the title (edited in place after the pencil), the
// remove button with its confirmation in place. the row is keyed by the
// todo's update time, so a saved todo is drawn anew
function TodoRow({ todo, isEditing, onEditStart, onEditCancel, onDoneSet, onSave, onDelete }) {
  const titleRef = useRef(null);
  const [message, setMessage] = useState('');
  const [isDeleteAsked, setIsDeleteAsked] = useState(false);

  useEffect(() => {
    if (!isEditing) return;
    const element = titleRef.current;
    element?.focus();
    // the caret at the end of the title
    const selection = window.getSelection();
    if (element && selection) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [isEditing]);

  const answerShow = (result) => {
    setMessage(result.code === 0 ? '' : result.message);
  };

  const save = async () => {
    answerShow(await onSave(titleRef.current.textContent));
  };

  const cancel = () => {
    titleRef.current.textContent = todo.title;
    setMessage('');
    onEditCancel();
  };

  return (
    <div className={isEditing ? 'todo-list-todo todo-list-todo-editing' : 'todo-list-todo'}>
      <input
        className="todo-list-check"
        type="checkbox"
        checked={todo.isDone}
        title={todo.isDone ? 'back to open' : 'done'}
        onChange={async (event) => answerShow(await onDoneSet(event.target.checked))}
      />
      <span
        ref={titleRef}
        className={todo.isDone && !isEditing ? 'todo-list-title todo-list-title-done' : 'todo-list-title'}
        contentEditable={isEditing ? 'plaintext-only' : false}
        suppressContentEditableWarning
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
        {todo.title}
      </span>
      {isEditing
        ? (
            <>
              <button type="button" className="todo-list-icon" title="save (Enter)" onClick={() => void save()}>✓</button>
              <button type="button" className="todo-list-icon" title="cancel (Escape)" onClick={cancel}>×</button>
            </>
          )
        : <button type="button" className="todo-list-icon" title="edit the title" onClick={onEditStart}>✎</button>}
      <span className="todo-list-muted">#{todo.todoId}</span>
      {isDeleteAsked
        ? (
            <span className="todo-list-ask">
              remove?
              <button type="button" className="todo-list-button" onClick={async () => { setIsDeleteAsked(false); answerShow(await onDelete()); }}>Remove</button>
              <button type="button" className="todo-list-button" onClick={() => setIsDeleteAsked(false)}>Keep</button>
            </span>
          )
        : <button type="button" className="todo-list-icon" title="remove" onClick={() => setIsDeleteAsked(true)}>🗑</button>}
      {message ? <span className="todo-list-error">{message}</span> : null}
    </div>
  );
}
