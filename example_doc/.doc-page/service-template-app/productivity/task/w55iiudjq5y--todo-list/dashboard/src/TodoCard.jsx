import { useState } from 'react';

// The object view of a task (doc_page_impl_obj.md#object-views): declared in
// expose.compList of service.py for the type core.task, so the page draws
// with it every task it is asked to show, a todo of this template or of
// any other provider, in a list, a group or a node of a card diagram.
//
//   data.ref                the reference of the object
//   data.descriptor         what the registry knows of it: label, summary
//                           ({ isDone }), status (found, registered, missing,
//                           unavailable), provider
//   config.objectView       { context: icon | inline | card | block,
//                           isEditAllowed, editUnavailableReason, note }:
//                           where it is drawn, whether the consumer, the
//                           provider and the page all allow a change, and the
//                           consumer's own line (the note of a group's entry)
//   onEvent                 objectUpdateRequest { ref, patch }: the change
//                           goes to the provider through the registry, which
//                           checks it; the page asks the registry again, and
//                           the card is drawn with the new descriptor
//
// the card knows nothing of the provider: a task is checked off by the
// update { isDone } that the type core.task promises.
export function TodoCard({ data = {}, config = {}, onEvent }) {
  const descriptor = data.descriptor ?? {};
  const view = config.objectView ?? {};
  const context = view.context ?? 'card';
  const isDone = descriptor.summary?.isDone === true;
  const isEditAllowed = view.isEditAllowed === true;
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState('');

  const doneToggle = async (event) => {
    event.stopPropagation();
    if (!isEditAllowed || isPending) return;
    setIsPending(true);
    const result = await onEvent('objectUpdateRequest', { ref: data.ref, patch: { isDone: !isDone } });
    setIsPending(false);
    setMessage(result?.code === 0 ? '' : (result?.message ?? 'the change failed'));
  };

  const box = (
    <button
      type="button"
      className={`todo-list-card-box${isDone ? ' todo-list-card-box-done' : ''}`}
      disabled={!isEditAllowed || isPending}
      title={isEditAllowed ? (isDone ? 'mark as open' : 'mark as done') : (view.editUnavailableReason || 'this task cannot be changed here')}
      aria-pressed={isDone}
      onClick={doneToggle}
    >
      {isDone ? (
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="M2.5 6.2 5 8.6 9.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </button>
  );
  const title = <span className={`todo-list-card-title${isDone ? ' todo-list-card-title-done' : ''}`}>{descriptor.label ?? data.ref}</span>;

  if (context === 'icon' || context === 'inline') {
    return (
      <span className={`todo-list-card todo-list-card-${context}`} title={message || descriptor.description || data.ref}>
        {box}
        {title}
      </span>
    );
  }
  return (
    <div className="todo-list-card todo-list-card-card">
      <div className="todo-list-card-head">
        {box}
        {title}
      </div>
      <div className="todo-list-card-note">
        {message || view.note || descriptor.description || descriptor.provider?.label || ''}
      </div>
    </div>
  );
}
