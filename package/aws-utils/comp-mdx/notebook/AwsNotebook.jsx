import { observer } from 'mobx-react-lite';
import { useCompStateStore } from '../../../../main/comp-doc/registry/use-comp-state.js';
import { PanelPopup } from '../../../../main/comp-doc/popup/PanelPopup.jsx';
import { timeTextDisplay } from '../../../../main/frontend/src/lib/time-text.js';
import { AwsNotebookStore, EDIT_MODE_MESSAGE } from './AwsNotebookStore.js';
import '../auth/AwsAuth.css';
import './AwsNotebook.css';

// The mode "notes" of a notebook (doc/README.md#the-notebook): the notes of one partition of the
// object, read and written through the api of the mode, the same whether the partition lies in
// the folders of the doc page or at a storage point of the page. It is the smallest thing that
// shows a partition held in the cloud: sign in, and the notes are there, on any machine and on a
// built page.
//
// Notes are added, changed and removed while the document is in edit mode, as every mode writes,
// whichever partition holds them; a partition a storage point holds needs its sign-in on top.
//
//   param.partition   the partition shown first (default: the default one of the type)
//   param.height      the height of the list and the note (default 16rem)
export const AwsNotebook = observer(function AwsNotebook({ data = {}, config = {} }) {
  const service = config.objectFrontend;
  const store = useCompStateStore(config, 'awsNotebook', () => new AwsNotebookStore());
  if (!service) return <p className="doc-error">AwsNotebook is a mode of a notebook (ObjectFrontend).</p>;
  const param = data.param ?? {};
  const partitionList = service.partitionList;
  const partition = partitionList.find((one) => one.id === store.partition) ?? partitionList.find((one) => one.id === param.partition) ?? service.partitionDefault ?? partitionList[0];
  if (!partition) return <p className="doc-note">The type of this notebook declares no partition.</p>;
  if (store.partition !== partition.id) queueMicrotask(() => store.partitionSet(partition.id));
  const isOfPage = partition.storage?.driverPlace === 'page';
  const remote = partition.storage?.remote;
  const writeHint = writeHintGet({ service, partition, isOfPage, remote });
  const writeReason = writeHint ? `${writeHint.action} ${writeHint.why}`.trim() : '';
  const noteList = service.assetList('note').filter((asset) => asset.partition === partition.id && asset.status === 'found');
  const note = noteList.find((asset) => asset.key === store.keySelected) ?? noteList[0];
  const noteText = note ? service.assetTextGet(note.key) : undefined;
  const height = typeof param.height === 'string' && param.height ? param.height : '16rem';
  return (
    <div className="aws-notebook">
      <div className="aws-notebook-head">
        <span className="aws-notebook-label">Partition</span>
        <span className="aws-notebook-tab-list" role="tablist">
          {partitionList.map((one) => (
            <button key={one.id} type="button" role="tab" className="aws-notebook-tab" aria-selected={one.id === partition.id} title={`${one.description || one.label} · held by ${one.storage?.label ?? one.storage?.pointId ?? 'file-tree'}`} onClick={() => store.partitionSet(one.id)}>
              {one.label}
            </button>
          ))}
        </span>
        <span className="aws-notebook-place" title={remote?.message || partition.storage?.unavailableReason || ''}>
          held by {partition.storage?.label ?? partition.storage?.pointId ?? 'file-tree'}
          {remote ? <span className="doc-badge-outline" {...(remote.status === 'ready' && !remote.isFromCache ? { 'data-primary': true } : {})}>{REMOTE_STATUS_TEXT[remote.status] ?? remote.status}{remote.status === 'ready' && remote.isFromCache ? ', from the cache' : ''}</span> : null}
        </span>
      </div>
      <div className="aws-auth-button-row">
        <button type="button" className="doc-button" data-primary disabled={Boolean(writeReason)} title={writeReason || `a new note in item/${partition.id}/note/`} onClick={() => store.editOpen()}>New note…</button>
        {remote?.status === 'authRequired' ? <button type="button" className="doc-button" data-primary onClick={() => void service.partitionSignIn(partition.id)}>Sign in</button> : null}
        {isOfPage && remote?.status !== 'authRequired' ? <button type="button" className="doc-button" disabled={remote?.isRefreshing || remote?.status === 'loading'} title="ask the storage point whether the notes changed elsewhere" onClick={() => void service.partitionRefresh(partition.id)}>{remote?.isRefreshing || remote?.status === 'loading' ? 'Reading' : 'Refresh'}</button> : null}
        {/* why nothing can be written, said where the buttons are */}
        {writeHint ? <span className="aws-notebook-reason" title={writeReason}>{writeHint.action}</span> : null}
      </div>
      <div className="aws-notebook-body" style={{ height }}>
        <div className="aws-notebook-list" role="listbox" aria-label="The notes">
          {noteList.length === 0 ? <div className="aws-auth-note aws-notebook-empty">{remote && remote.status !== 'ready' && remote.status !== 'absent' ? remote.message || 'not read yet' : 'No note in this partition yet.'}</div> : null}
          {noteList.map((asset) => (
            <button key={asset.key} type="button" role="option" className="aws-notebook-row" aria-selected={asset.key === note?.key} onClick={() => store.keySelect(asset.key)}>
              <span className="aws-notebook-row-name">{asset.name || asset.key}</span>
              <span className="aws-notebook-row-time">{timeTextDisplay(asset.item?.versionList?.at(-1)?.time, { isYearShown: false })}</span>
            </button>
          ))}
        </div>
        <div className="aws-notebook-note">
          {note ? (
            <>
              <div className="aws-notebook-note-head">
                <span className="aws-notebook-note-title">{note.name || note.key}</span>
                <span className="aws-auth-button-row">
                  <button type="button" className="doc-button" disabled={Boolean(writeReason) || noteText?.status !== 'done'} title={writeReason} onClick={() => store.editOpen({ key: note.key, name: note.name, text: noteText?.text ?? '' })}>Edit…</button>
                  {store.confirm === `remove:${note.key}` ? (
                    <>
                      <button type="button" className="doc-button" data-danger onClick={() => void store.remove(service, note.key)}>Remove the note</button>
                      <button type="button" className="doc-button" onClick={() => store.confirmSet('')}>Cancel</button>
                    </>
                  ) : <button type="button" className="doc-button" disabled={Boolean(writeReason)} title={writeReason} onClick={() => store.confirmSet(`remove:${note.key}`)}>Remove</button>}
                </span>
              </div>
              <pre className="aws-notebook-note-text">{noteText?.status === 'done' ? noteText.text : noteText?.status === 'error' ? noteText.message : 'Reading the note'}</pre>
            </>
          ) : <div className="aws-auth-note aws-notebook-empty">Choose a note, or add one.</div>}
        </div>
      </div>
      <div className="aws-auth-message" {...(store.action.isError ? { 'data-error': true } : {})}>{store.action.isPending ? 'Working…' : store.action.message}</div>
      <AwsNotebookEditPopup store={store} service={service} partition={partition} />
    </div>
  );
});

const AwsNotebookEditPopup = observer(function AwsNotebookEditPopup({ store, service, partition }) {
  const { edit } = store;
  return (
    <PanelPopup panelId="awsNotebookEdit" title={edit.key ? `Edit: ${edit.name || edit.key}` : 'New note'} isOpen={edit.isOpen} onClose={() => store.editClose()} className="aws-notebook-popup" bodyClassName="doc-auth-popup-body">
      <form
        className="doc-auth-form aws-notebook-form"
        onSubmit={(event) => {
          event.preventDefault();
          void store.editSubmit(service);
        }}
      >
        <div className="doc-auth-note">{edit.key ? 'The note is saved as its head, by its save mode.' : `The note goes to item/${partition.id}/note/, held by ${partition.storage?.label ?? partition.storage?.pointId ?? 'file-tree'}.`}</div>
        {edit.key ? null : (
          <label className="doc-auth-field">
            <span className="doc-auth-field-label">Title</span>
            <input className="doc-auth-input" autoFocus value={edit.name} onChange={(event) => store.editFieldSet('name', event.target.value)} />
          </label>
        )}
        <textarea className="aws-notebook-textarea" aria-label="The text of the note" autoFocus={Boolean(edit.key)} value={edit.text} onChange={(event) => store.editFieldSet('text', event.target.value)} />
        <div className="doc-auth-message" data-error>{edit.message}</div>
        <div className="doc-auth-button-row">
          <button type="submit" className="doc-button" data-primary disabled={edit.isPending}>{edit.isPending ? 'Working…' : edit.key ? 'Save' : 'Add the note'}</button>
          <button type="button" className="doc-button" onClick={() => store.editClose()}>Cancel</button>
        </div>
      </form>
    </PanelPopup>
  );
});

const REMOTE_STATUS_TEXT = {
  idle: 'not read', loading: 'reading', ready: 'read', absent: 'empty', authRequired: 'signed out', forbidden: 'not allowed', unreachable: 'out of reach', error: 'failed',
};


// why a note cannot be added or changed now: { action, why }, a short line saying what is needed
// and, where it helps, why; undefined when writing works. Both together are the hint of the
// greyed-out buttons; the action alone stands beside them.
// the document must be in edit mode for every partition: a note changes what the document shows,
// wherever it is kept
function writeHintGet({ service, partition, isOfPage, remote }) {
  const name = partition.label || partition.id;
  if (service.docState?.isEditing !== true) {
    // a page that cannot be edited at all (a built page) says so
    const isEditAvailable = service.docState?.isEditAvailable !== false;
    return { action: EDIT_MODE_MESSAGE, why: isEditAvailable ? '' : `Here: ${service.docState?.editReason || 'this page cannot be edited'}.` };
  }
  const reason = service.partitionWriteUnavailableReasonGet(partition.id);
  if (!reason) return undefined;
  if (!isOfPage) return { action: `Notes in "${name}" cannot be changed.`, why: reason };
  if (remote?.status === 'authRequired') return { action: `Sign in to add or change notes in "${name}".`, why: '' };
  if (remote?.status === 'forbidden') return { action: `Your account lacks the role for "${name}".`, why: `${reason}.` };
  if (remote?.status === 'unreachable' || remote?.isFromCache) return { action: `"${name}" cannot be reached: nothing can be saved.`, why: '' };
  if (remote?.status === 'loading' || remote?.status === 'idle') return { action: `"${name}" is still being read.`, why: '' };
  return { action: `Notes in "${name}" cannot be changed now.`, why: reason };
}
