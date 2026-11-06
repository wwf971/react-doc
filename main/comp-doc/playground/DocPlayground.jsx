import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import './DocPlayground.css';

// The two places a playground document shows itself on its page (doc_page_impl_test.md):
// the error page while it does not exist (a fresh clone, or after Delete), which offers to
// create it from its template, and a bar above the document while it does, which says
// what kind of document this is and offers to reset or delete it. The bar is there in
// reading and in edit mode alike, and asking for a confirmation only changes its text,
// so nothing below it moves.

export const DocPlaygroundMissing = observer(function DocPlaygroundMissing({ playground }) {
  const { sourceStore } = useDocStores();
  return (
    <div className="doc-source-missing-error doc-playground-missing" role="alert">
      <strong>{playground.title} does not exist in this checkout.</strong>
      <span>This is a playground: a document for trying things out. Git ignores it, so a fresh clone has none, and what is done in it stays on this machine.</span>
      <span>Its place: {playground.doc}</span>
      {playground.description ? <span>{playground.description}</span> : null}
      {sourceStore.isWritable ? (
        <span className="doc-playground-actions">
          <button type="button" className="doc-button" data-primary="" onClick={() => void sourceStore.playgroundChange(playground.id, 'reset')}>Create from its template</button>
        </span>
      ) : <span>It can be created on the development server only.</span>}
      {sourceStore.playgroundMessage ? <span>{sourceStore.playgroundMessage}</span> : null}
    </div>
  );
});

const confirmTextByAction = {
  reset: 'Reset to the template? What is here now is replaced (a hidden backup stays beside the file).',
  delete: 'Delete this document? The side panel item stays, as after a fresh clone (a hidden backup stays beside the file).',
};

export const DocPlaygroundBar = observer(function DocPlaygroundBar({ path }) {
  const { sourceStore } = useDocStores();
  const playground = sourceStore.playgroundOfReference(path);
  if (!playground) return null;
  const confirm = sourceStore.playgroundConfirm?.id === playground.id ? sourceStore.playgroundConfirm : null;
  return (
    <div className="doc-playground-bar not-prose" role={confirm ? 'alert' : 'note'}>
      <span className="doc-badge">playground</span>
      <span className="doc-playground-text">{sourceStore.playgroundMessage || (confirm ? confirmTextByAction[confirm.action] : 'Not tracked by git: what you do here stays on this machine.')}</span>
      {sourceStore.isWritable ? (
        <span className="doc-playground-actions">
          {confirm ? (
            <>
              <button type="button" className={`doc-button${confirm.action === 'delete' ? ' is-danger' : ''}`} onClick={() => void sourceStore.playgroundChange(playground.id, confirm.action)}>{confirm.action === 'delete' ? 'Delete' : 'Reset'}</button>
              <button type="button" className="doc-button" onClick={() => sourceStore.playgroundConfirmSet(null)}>Keep</button>
            </>
          ) : (
            <>
              <button type="button" className="doc-button" onClick={() => sourceStore.playgroundConfirmSet({ id: playground.id, action: 'reset' })}>Reset</button>
              <button type="button" className="doc-button" onClick={() => sourceStore.playgroundConfirmSet({ id: playground.id, action: 'delete' })}>Delete</button>
            </>
          )}
        </span>
      ) : null}
    </div>
  );
});
