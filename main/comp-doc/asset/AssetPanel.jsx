import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { Check, LoaderCircle, Pencil, Trash2, X } from '../../frontend/UICommon.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import './DocAsset.css';

// The asset panel of one object (design: doc_page_impl_asset.md): the
// object's metadata, its versions, the text of the selected version. From
// here the head is moved, a version or the object is deleted, the object is
// restored or renamed, and the head text is saved in place or as a new
// version. Everything it shows and every pending action is DocAssetStore
// state (panel); the panel renders that state and asks the store for the
// changes. With a read-only backend (a built site) it shows and does not
// change.
export const AssetPanel = observer(function AssetPanel() {
  const { assetStore } = useDocStores();
  const panel = assetStore.panel;
  if (!panel) return null;
  const stateObject = assetStore.objectById[panel.objectId];
  const object = stateObject?.object;
  if (!object) {
    return (
      <div className="doc-asset-panel">
        {stateObject?.status === 'error'
          ? <p className="doc-edit-message">{stateObject.message}</p>
          : <p className="doc-asset-panel-status"><LoaderCircle size={12} className="doc-edit-spin" aria-hidden="true" /> loading</p>}
      </div>
    );
  }
  const isWritable = assetStore.isWritable;
  const isBusy = panel.status === 'submitting' || panel.edit?.status === 'submitting' || panel.confirm?.status === 'submitting';
  return (
    <div className="doc-asset-panel">
      <ObjectSection object={object} panel={panel} isWritable={isWritable} isBusy={isBusy} />
      <VersionSection object={object} panel={panel} isWritable={isWritable} isBusy={isBusy} />
      <TextSection object={object} panel={panel} isWritable={isWritable} isBusy={isBusy} />
    </div>
  );
});

// ---------- object ----------

const ObjectSection = observer(function ObjectSection({ object, panel, isWritable, isBusy }) {
  const { assetStore } = useDocStores();
  const isNameEditable = isWritable && !object.isDeleted && !isBusy;
  return (
    <section className="doc-asset-section">
      <dl className="doc-asset-fields">
        <dt>object</dt>
        <dd className="doc-asset-mono">{object.objectId}</dd>
        <dt>name</dt>
        <dd>
          {isNameEditable
            ? <EditValueInline value={object.name} placeholder="(no name)" onCommit={(name) => assetStore.panelNameSet(name)} />
            : <span>{object.name || '(no name)'}</span>}
        </dd>
        <dt>lang</dt>
        <dd className="doc-asset-mono">{object.lang} <span className="doc-asset-muted">(.{object.fileExt})</span></dd>
        <dt>head</dt>
        <dd className="doc-asset-mono">{object.versionIdHead}</dd>
        <dt>created</dt>
        <dd className="doc-asset-mono">{object.timeCreated}</dd>
        <dt>updated</dt>
        <dd className="doc-asset-mono">{object.timeUpdated}</dd>
      </dl>
      {object.isDeleted ? (
        <p className="doc-asset-panel-status">
          <span className="doc-asset-frame-flag">deleted</span>
          <span>The object is marked deleted; documents still read it until the folder is cleaned.</span>
        </p>
      ) : null}
      {isWritable ? (
        <div className="doc-asset-actions">
          {object.isDeleted ? (
            <button type="button" className="doc-edit-action" disabled={isBusy} onClick={() => assetStore.panelObjectRestore()}>
              Restore object
            </button>
          ) : (
            <button type="button" className="doc-edit-action" disabled={isBusy} onClick={() => assetStore.panelConfirmSet('objectDelete')}>
              <Trash2 size={11} aria-hidden="true" /> Delete object
            </button>
          )}
          {panel.status === 'submitting' ? <LoaderCircle size={12} className="doc-edit-spin" aria-label="working" /> : null}
        </div>
      ) : null}
      {panel.confirm?.kind === 'objectDelete' ? <ConfirmRow label="Delete the object (mark deleted, files kept)?" confirm={panel.confirm} /> : null}
      {panel.message ? <p className="doc-edit-message">{panel.message}</p> : null}
    </section>
  );
});

// ---------- versions ----------

const VersionSection = observer(function VersionSection({ object, panel, isWritable, isBusy }) {
  const { assetStore } = useDocStores();
  const versionList = assetStore.panelVersionList;
  const versionIdRead = assetStore.refVersionIdGet({ objectId: object.objectId, versionId: panel.versionIdRef || 'head' });
  return (
    <section className="doc-asset-section">
      <p className="doc-asset-section-title">versions <span className="doc-asset-muted">({versionList.length}, newest first)</span></p>
      <ul className="doc-asset-version-list">
        {versionList.map((version) => {
          const isHead = version.versionId === object.versionIdHead;
          const isSelected = version.versionId === panel.versionIdSelected;
          const isRead = version.versionId === versionIdRead;
          const isConfirming = panel.confirm?.kind === 'versionDelete' && panel.confirm.versionId === version.versionId;
          return (
            <li
              key={version.versionId}
              className="doc-asset-version"
              data-selected={isSelected ? '' : undefined}
              data-head={isHead ? '' : undefined}
            >
              <div className="doc-asset-version-row" onClick={() => assetStore.panelVersionSelect(version.versionId)}>
                <span className="doc-asset-mono doc-asset-version-id">{version.versionId}</span>
                {isHead ? <span className="doc-asset-badge is-head">head</span> : null}
                {isRead && panel.versionIdRef ? <span className="doc-asset-badge">read here</span> : null}
                <span className="doc-asset-mono doc-asset-muted">{version.time}</span>
                {version.note ? <span className="doc-asset-version-note">{version.note}</span> : null}
                {version.versionIdPrevList.length > 0 ? (
                  <span className="doc-asset-muted doc-asset-version-prev">
                    from {version.versionIdPrevList.join(', ')}
                  </span>
                ) : null}
              </div>
              {isSelected && isWritable && !object.isDeleted ? (
                <div className="doc-asset-actions">
                  <button type="button" className="doc-edit-action" disabled={isBusy || isHead} onClick={() => assetStore.panelHeadSet(version.versionId)}>
                    <Check size={11} aria-hidden="true" /> Set as head
                  </button>
                  <button type="button" className="doc-edit-action" disabled={isBusy || isHead} title={isHead ? 'the head cannot be deleted' : ''} onClick={() => assetStore.panelConfirmSet('versionDelete', version.versionId)}>
                    <Trash2 size={11} aria-hidden="true" /> Delete version
                  </button>
                </div>
              ) : null}
              {isConfirming ? <ConfirmRow label={`Delete version ${version.versionId}?`} confirm={panel.confirm} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
});

// ---------- text of the selected version ----------

const TextSection = observer(function TextSection({ object, panel, isWritable, isBusy }) {
  const { assetStore } = useDocStores();
  const edit = panel.edit;
  const stateText = assetStore.versionTextGet(object.objectId, panel.versionIdSelected);
  const isHeadSelected = panel.versionIdSelected === object.versionIdHead;
  const isEditable = isWritable && !object.isDeleted && assetStore.versionTextGet(object.objectId, object.versionIdHead)?.status === 'done';
  return (
    <section className="doc-asset-section">
      <p className="doc-asset-section-title">
        {edit ? 'head text, editing' : <>text of <span className="doc-asset-mono">{panel.versionIdSelected}</span>{isHeadSelected ? ' (head)' : ''}</>}
      </p>
      {edit ? (
        <TextEditor edit={edit} lang={object.lang} />
      ) : stateText?.status === 'done' ? (
        <pre className="doc-asset-text" data-lang={object.lang}>{stateText.text}</pre>
      ) : stateText?.status === 'error' ? (
        <p className="doc-edit-message">{stateText.message}</p>
      ) : (
        <p className="doc-asset-panel-status"><LoaderCircle size={12} className="doc-edit-spin" aria-hidden="true" /> loading</p>
      )}
      {isWritable && !object.isDeleted ? (
        <div className="doc-asset-actions">
          {edit ? (
            <>
              <button type="button" className="doc-edit-action is-primary" disabled={isBusy} onClick={() => assetStore.panelSave('inPlace')}>
                <Check size={11} aria-hidden="true" /> Save in place
              </button>
              <button type="button" className="doc-edit-action is-primary" disabled={isBusy} onClick={() => assetStore.panelSave('newVersion')}>
                <Check size={11} aria-hidden="true" /> Save as new version
              </button>
              <button type="button" className="doc-edit-action" disabled={isBusy} onClick={() => assetStore.panelEditCancel()}>
                <X size={11} aria-hidden="true" /> Cancel
              </button>
              {edit.status === 'submitting' ? <LoaderCircle size={12} className="doc-edit-spin" aria-label="saving" /> : null}
            </>
          ) : (
            <button type="button" className="doc-edit-action" disabled={isBusy || !isEditable} title="edits the head text" onClick={() => assetStore.panelEditStart()}>
              <Pencil size={11} aria-hidden="true" /> Edit head
            </button>
          )}
        </div>
      ) : null}
      {edit?.status === 'error' ? <p className="doc-edit-message">{edit.message}</p> : null}
    </section>
  );
});

// the head text made editable in its place: a <pre> with contenteditable,
// uncontrolled while typing, the draft taken on every input
const TextEditor = observer(function TextEditor({ edit, lang }) {
  const { assetStore } = useDocStores();
  const elementRef = useRef(null);
  const isLocked = edit.status === 'submitting';

  // the element is filled once when editing starts (and after a failed
  // save the text stays as typed); it is not rewritten on each keystroke
  useEffect(() => {
    const element = elementRef.current;
    if (element && element.textContent !== edit.textDraft) element.textContent = edit.textDraft;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <pre
      ref={elementRef}
      className="doc-asset-text doc-edit-surface"
      data-lang={lang}
      role="textbox"
      contentEditable={isLocked ? 'false' : 'plaintext-only'}
      suppressContentEditableWarning
      spellCheck={false}
      data-locked={isLocked ? '' : undefined}
      onInput={(event) => assetStore.panelDraftSet(event.currentTarget.textContent)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          assetStore.panelEditCancel();
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? '');
      }}
    />
  );
});

// an inline confirmation: the question, the pending state, Delete / Cancel
const ConfirmRow = observer(function ConfirmRow({ label, confirm }) {
  const { assetStore } = useDocStores();
  const isSubmitting = confirm.status === 'submitting';
  return (
    <div className="doc-asset-confirm">
      <span className="doc-edit-confirm">
        <span>{label}</span>
        <button type="button" className="is-danger" disabled={isSubmitting} onClick={() => assetStore.panelConfirmApply()}>
          {isSubmitting ? <LoaderCircle size={11} className="doc-edit-spin" aria-hidden="true" /> : <Trash2 size={11} aria-hidden="true" />}
          Delete
        </button>
        <button type="button" disabled={isSubmitting} onClick={() => assetStore.panelConfirmClear()}>
          <X size={11} aria-hidden="true" /> Cancel
        </button>
      </span>
      {confirm.status === 'error' ? <p className="doc-edit-message">{confirm.message}</p> : null}
    </div>
  );
});
