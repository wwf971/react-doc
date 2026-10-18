import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { docPlaceTargetGet } from '../../frontend/src/lib/doc-place.js';
import { Check, Download, LoaderCircle, Lock, LockOpen, Pencil, RotateCw, Trash2, Upload, X } from '../../frontend/UICommon.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { caretPlaceInitial } from '../edit/caret-place.js';
import { useEditOutsidePointer } from '../edit/use-edit-outside-pointer.js';
import { AssetUsageTable } from './AssetUsageTable.jsx';
import './DocAsset.css';

export const ASSET_PANEL_SECTION_LIST = ['object', 'usage', 'version', 'data'];

// The asset panel of one object (design: doc_page_impl_asset.md): the
// object's metadata and events, the blocks that use it, its versions, the
// data of the selected version. From here the head is moved, a version or
// the object is deleted, the object is restored or renamed, the component
// it is data for is declared, its save mode is chosen, the head text is
// edited and saved (in place, or as a new version), a file is uploaded as
// the new head data, the object or one version is locked, and a block that
// uses it is visited. A confirmation opens beside the button that asked
// for it, so nothing below moves. Everything it shows and every pending
// action is the state of the panel model (AssetPanelModel); the panel
// renders that state and asks the model for the changes. With a read-only
// backend (a built site) it shows and does not change.
//
//   panel        the AssetPanelModel shown: the popup's (DocAssetStore.panel)
//                or the settings tab's (DocAssetStore.settingsPanel)
//   sectionList  the sections shown, in order (ASSET_PANEL_SECTION_LIST)
//   onNavigate   called after going to a block of the usage list (the host
//                closes what covers the document)
export const AssetPanel = observer(function AssetPanel({ panel, sectionList = ASSET_PANEL_SECTION_LIST, onNavigate }) {
  const { assetStore } = useDocStores();
  if (!panel) return null;
  const stateObject = assetStore.objectStateGet(panel.store, panel.objectId);
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
  const isBusy = panel.isBusy;
  const sectionByName = {
    object: <ObjectSection key="object" object={object} panel={panel} isWritable={isWritable} isBusy={isBusy} />,
    usage: <UsageSection key="usage" object={object} panel={panel} onNavigate={onNavigate} />,
    version: <VersionSection key="version" object={object} panel={panel} isWritable={isWritable} isBusy={isBusy} />,
    data: <DataSection key="data" object={object} panel={panel} isWritable={isWritable} isBusy={isBusy} />,
  };
  return (
    <div className="doc-asset-panel">
      {sectionList.map((name) => sectionByName[name] ?? null)}
    </div>
  );
});

// ---------- object ----------

const ObjectSection = observer(function ObjectSection({ object, panel, isWritable, isBusy }) {
  const isChangeable = isWritable && !object.isDeleted && !object.isLocked && !isBusy;
  const eventLast = object.eventList[object.eventList.length - 1];
  return (
    <section className="doc-asset-section">
      <dl className="doc-asset-fields">
        <dt>object</dt>
        <dd className="doc-asset-mono">{panel.store} / {object.objectId}</dd>
        <dt>name</dt>
        <dd>
          {isChangeable
            ? <EditValueInline value={object.name} placeholder="(no name)" onCommit={(name) => panel.nameSet(name)} />
            : <span>{object.name || '(no name)'}</span>}
        </dd>
        <dt>component</dt>
        <dd title="the component whose data the object is (doc_page_impl_mdx_comp.md#components-and-the-asset-store)">
          {isChangeable
            ? <EditValueInline value={object.component?.name ?? ''} placeholder="(none)" className="doc-asset-mono" onCommit={(name) => panel.componentSet(name)} />
            : <span className="doc-asset-mono">{object.component?.name ?? '(none)'}</span>}
        </dd>
        <dt>lang</dt>
        <dd className="doc-asset-mono">{object.lang || '(none)'} <span className="doc-asset-muted">(.{object.fileExt})</span></dd>
        <dt>type</dt>
        <dd className="doc-asset-mono">{object.contentType}</dd>
        <dt>folder</dt>
        <dd className="doc-asset-mono">{object.folder} / {object.dirName}</dd>
        <dt>head</dt>
        <dd className="doc-asset-mono">{object.versionIdHead}</dd>
        <dt>created</dt>
        <dd className="doc-asset-mono">{object.timeCreated}</dd>
        <dt>events</dt>
        <dd>
          <span className="doc-asset-mono">{object.eventList.length}</span>
          {eventLast ? <span className="doc-asset-muted">, last <span className="doc-asset-mono">{eventLast.eventType} {eventLast.time}</span></span> : null}
          <button type="button" className="doc-asset-link" onClick={() => panel.eventListToggle()}>
            {panel.isEventListOpen ? 'hide' : 'show all'}
          </button>
          {panel.isEventListOpen ? <EventList eventList={object.eventList} /> : null}
        </dd>
        <dt>save mode</dt>
        <dd>
          <SaveModeControl object={object} panel={panel} isChangeable={isChangeable} />
        </dd>
      </dl>
      {object.isDeleted ? (
        <p className="doc-asset-panel-status">
          <span className="doc-asset-frame-flag">deleted</span>
          <span>The object is marked deleted; documents still read it until the folder is cleaned.</span>
        </p>
      ) : null}
      {object.isLocked ? (
        <p className="doc-asset-panel-status">
          <Lock size={12} aria-hidden="true" />
          <span>The object is locked: its data, versions, head and metadata cannot change until it is unlocked.</span>
        </p>
      ) : null}
      {isWritable ? (
        <div className="doc-asset-actions">
          <button
            type="button"
            className="doc-edit-action"
            disabled={isBusy}
            title={object.isLocked ? 'allows changes of the object again' : 'no change of the object (data, versions, head, metadata, deletion) until it is unlocked'}
            onClick={() => panel.objectLockSet(!object.isLocked)}
          >
            {object.isLocked ? <LockOpen size={11} aria-hidden="true" /> : <Lock size={11} aria-hidden="true" />}
            {object.isLocked ? ' Unlock object' : ' Lock object'}
          </button>
          {object.isDeleted ? (
            <button type="button" className="doc-edit-action" disabled={isBusy || object.isLocked} onClick={() => panel.objectRestore()}>
              Restore object
            </button>
          ) : (
            <button
              type="button"
              className="doc-edit-action"
              disabled={isBusy || object.isLocked}
              title={object.isLocked ? 'the object is locked' : ''}
              onClick={() => panel.confirmSet('objectDelete')}
            >
              <Trash2 size={11} aria-hidden="true" /> Delete object
            </button>
          )}
          {panel.confirm?.kind === 'objectDelete' ? (
            <ConfirmInline
              label={panel.usageList.length > 0
                ? `Delete the object (mark deleted, files kept)? ${panel.usageList.length} block${panel.usageList.length === 1 ? '' : 's'} still use${panel.usageList.length === 1 ? 's' : ''} it.`
                : 'Delete the object (mark deleted, files kept)?'}
              panel={panel}
            />
          ) : null}
          {panel.status === 'submitting' ? <LoaderCircle size={12} className="doc-edit-spin" aria-label="working" /> : null}
        </div>
      ) : null}
      {panel.message ? <p className="doc-edit-message">{panel.message}</p> : null}
    </section>
  );
});

// what happened to the object, oldest first: time, event, the version it concerns
function EventList({ eventList }) {
  return (
    <table className="doc-asset-table doc-asset-event-list">
      <tbody>
        {eventList.map((event, index) => (
          <tr key={`${event.time}-${index}`}>
            <td className="doc-asset-mono doc-asset-muted">{event.time}</td>
            <td className="doc-asset-mono">{event.eventType}</td>
            <td className="doc-asset-mono doc-asset-muted">{event.versionId ?? ''}</td>
            <td className="doc-asset-mono doc-asset-muted">{event.userId ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// the save mode of the object: in place (the default, nothing written) or a
// new version on each save. a radio pair; "default" means the metadata says
// nothing and the object follows the in-place rule. it decides what an
// upload does and which save button is the primary one.
const SaveModeControl = observer(function SaveModeControl({ object, panel, isChangeable }) {
  const isWritten = object.saveMode !== undefined;
  const optionList = [
    { value: 'inPlace', label: 'update in place' },
    { value: 'newVersion', label: 'new version' },
  ];
  return (
    <span className="doc-asset-save-mode">
      {optionList.map((option) => (
        <label key={option.value} className="doc-asset-save-mode-option" data-disabled={isChangeable ? undefined : ''}>
          <input
            type="radio"
            name={`doc-asset-save-mode-${panel.store}-${object.objectId}`}
            value={option.value}
            checked={panel.saveMode === option.value}
            disabled={!isChangeable}
            onChange={() => panel.saveModeSet(option.value)}
          />
          {option.label}
        </label>
      ))}
      <span className="doc-asset-muted">
        {isWritten ? (
          <>
            written
            {isChangeable ? (
              <button type="button" className="doc-asset-link" onClick={() => panel.saveModeSet(null)}>clear</button>
            ) : null}
          </>
        ) : 'not written, in place by default'}
      </span>
    </span>
  );
});

// ---------- usage: the blocks that reference the object ----------

// the backlinks of the object (doc_page_impl_asset.md#usage): every block
// of the documents whose reference names it, as the page last read the
// documents. the index follows the page's own edits and the documents'
// content hashes, but a change the page has not heard of yet is not in it:
// the read-again buttons (all documents, beside the title; one document,
// beside its place) confirm what the list says.
const UsageSection = observer(function UsageSection({ object, panel, onNavigate }) {
  const { assetStore, docStore } = useDocStores();
  const usageIndex = assetStore.usageIndex;
  const usageList = panel.usageList;
  const usageRefresh = panel.usageRefresh;
  const isRefreshing = usageRefresh?.status === 'submitting';

  const usageNavigate = (place) => {
    const isNavigated = docStore.navigate(docPlaceTargetGet(place));
    panel.usageNavigateMessageSet(isNavigated ? '' : docStore.navigationError);
    if (isNavigated) onNavigate?.();
  };

  let note = null;
  if (usageIndex.status === 'loading' || usageIndex.status === 'idle') {
    note = <p className="doc-asset-panel-status"><LoaderCircle size={12} className="doc-edit-spin" aria-hidden="true" /> reading the documents</p>;
  } else if (usageIndex.status === 'error') {
    note = <p className="doc-edit-message">{usageIndex.message}</p>;
  } else if (usageList.length === 0) {
    note = (
      <p className="doc-asset-muted doc-asset-usage-empty">
        {object.component
          ? `No block references the object: it is an orphan of ${object.component.name}.`
          : 'No block references the object.'}
      </p>
    );
  }

  return (
    <section className="doc-asset-section">
      <p className="doc-asset-section-title">
        used by <span className="doc-asset-muted">({usageList.length} block{usageList.length === 1 ? '' : 's'})</span>
        <button
          type="button"
          className="doc-asset-icon-button"
          disabled={isRefreshing || usageIndex.status !== 'done' || usageList.length === 0}
          title="reads the documents of the list again"
          aria-label="read the documents again"
          onClick={() => void panel.usageRefreshRun('')}
        >
          {isRefreshing && usageRefresh.docPath === ''
            ? <LoaderCircle size={11} className="doc-edit-spin" aria-hidden="true" />
            : <RotateCw size={11} aria-hidden="true" />}
        </button>
        {usageRefresh && usageRefresh.status !== 'submitting' ? (
          <span className={usageRefresh.status === 'error' ? 'doc-asset-usage-problem' : 'doc-asset-muted'}>
            {usageRefresh.message}
            <button type="button" className="doc-asset-link" onClick={() => panel.usageRefreshMessageClear()}>dismiss</button>
          </span>
        ) : null}
      </p>
      {note}
      {usageList.length > 0 ? (
        <AssetUsageTable
          usageList={usageList}
          componentNameObject={object.component?.name ?? ''}
          usageIsCurrent={(usage) => panel.usageIsOfBlock(usage)}
          docPathRefreshing={isRefreshing ? usageRefresh.docPath : undefined}
          onDocRefresh={(docPath) => void panel.usageRefreshRun(docPath)}
          onNavigate={usageNavigate}
        />
      ) : null}
      {panel.usageNavigateMessage ? <p className="doc-edit-message">{panel.usageNavigateMessage}</p> : null}
    </section>
  );
});

// ---------- versions ----------

// one table, so the values of a column line up across the rows; every row
// has the same height whether selected or not: the actions of the selected
// version sit below the table, not inside its row. a click on the selected
// row unselects it. the uses column counts the blocks reading a version:
// on the head row "following the head | pinned to this id", on another row
// the blocks pinned to it.
const VersionSection = observer(function VersionSection({ object, panel, isWritable, isBusy }) {
  const { assetStore } = useDocStores();
  const versionList = panel.versionList;
  const usageCount = panel.usageCount;
  const isUsageKnown = assetStore.usageIndex.status === 'done';
  const versionIdRead = assetStore.refVersionIdGet({ store: panel.store, objectId: object.objectId, versionId: panel.versionIdRef || 'head' });
  const versionSelected = versionList.find((version) => version.versionId === panel.versionIdSelected);
  const isHeadSelected = versionSelected?.versionId === object.versionIdHead;
  const isObjectLocked = object.isLocked;
  let deleteReason = '';
  if (isObjectLocked) deleteReason = 'the object is locked';
  else if (versionSelected?.isLocked) deleteReason = 'the version is locked';
  else if (isHeadSelected) deleteReason = 'the head cannot be deleted';
  const pinnedCountSelected = versionSelected ? usageCount.byVersionId[versionSelected.versionId] ?? 0 : 0;
  return (
    <section className="doc-asset-section">
      <p className="doc-asset-section-title">versions <span className="doc-asset-muted">({versionList.length}, newest first)</span></p>
      <div className="doc-asset-table-scroll">
        <table className="doc-asset-table doc-asset-version-table">
          <thead>
            <tr>
              <th>version</th>
              <th />
              <th className="doc-asset-version-lock" aria-label="locked" />
              <th className="doc-asset-version-uses" title="blocks reading the version; on the head: following the head | pinned to it">uses</th>
              <th>time</th>
              <th className="doc-asset-version-size">size</th>
              <th>note</th>
              <th>from</th>
            </tr>
          </thead>
          <tbody>
            {versionList.map((version) => {
              const isHead = version.versionId === object.versionIdHead;
              const isSelected = version.versionId === panel.versionIdSelected;
              const isRead = version.versionId === versionIdRead;
              const pinnedCount = usageCount.byVersionId[version.versionId] ?? 0;
              let usesText = '';
              if (isUsageKnown) usesText = isHead ? `${usageCount.head}|${pinnedCount}` : (pinnedCount > 0 ? String(pinnedCount) : '');
              return (
                <tr
                  key={version.versionId}
                  className="doc-asset-version"
                  data-selected={isSelected ? '' : undefined}
                  data-head={isHead ? '' : undefined}
                  onClick={() => panel.versionSelect(version.versionId)}
                >
                  <td className="doc-asset-mono doc-asset-version-id">{version.versionId}</td>
                  <td className="doc-asset-version-badges">
                    {isHead ? <span className="doc-asset-badge is-head">head</span> : null}
                    {isRead && panel.versionIdRef ? <span className="doc-asset-badge">read here</span> : null}
                  </td>
                  <td className="doc-asset-version-lock" title={version.isLocked ? 'locked: not rewritten in place, not deleted' : undefined}>
                    {version.isLocked ? <Lock size={11} aria-label="locked" /> : null}
                  </td>
                  <td
                    className="doc-asset-mono doc-asset-muted doc-asset-version-uses"
                    title={isHead && isUsageKnown ? `${usageCount.head} following the head, ${pinnedCount} pinned to ${version.versionId}` : undefined}
                  >
                    {usesText}
                  </td>
                  <td className="doc-asset-mono doc-asset-muted">{version.time}</td>
                  <td className="doc-asset-mono doc-asset-muted doc-asset-version-size">{sizeTextGet(version.size)}</td>
                  <td className="doc-asset-version-note" title={version.note}>{version.note}</td>
                  <td className="doc-asset-mono doc-asset-muted doc-asset-version-prev" title={version.versionIdPrevList.join(', ')}>
                    {version.versionIdPrevList.join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {versionSelected ? (
        <p className="doc-asset-dependency-list">
          <span className="doc-asset-mono doc-asset-muted">{versionSelected.versionId}</span>
          <span className="doc-asset-muted"> depends on: </span>
          {(versionSelected.dependencyList ?? []).length === 0
            ? <span className="doc-asset-muted">nothing declared</span>
            : (versionSelected.dependencyList ?? []).map((dependency, index) => (
              <span key={index} className="doc-asset-mono doc-asset-dependency" title={dependency.type}>
                {dependency.type === 'source'
                  ? dependency.path
                  : `${dependency.objectId}${dependency.versionId ? `@${dependency.versionId}` : ' (head)'}`}
              </span>
            ))}
        </p>
      ) : null}
      {versionSelected ? <VersionMetadataLine object={object} panel={panel} versionId={versionSelected.versionId} /> : null}
      {versionSelected && isWritable && !object.isDeleted ? (
        <div className="doc-asset-actions">
          <span className="doc-asset-mono doc-asset-muted">{versionSelected.versionId}</span>
          <button
            type="button"
            className="doc-edit-action"
            disabled={isBusy || isHeadSelected || isObjectLocked}
            title={isObjectLocked ? 'the object is locked' : ''}
            onClick={() => panel.headSet(versionSelected.versionId)}
          >
            <Check size={11} aria-hidden="true" /> Set as head
          </button>
          <button
            type="button"
            className="doc-edit-action"
            disabled={isBusy || isObjectLocked}
            title={isObjectLocked ? 'the object is locked' : (versionSelected.isLocked ? 'allows rewriting and deleting this version again' : 'the version cannot be rewritten in place or deleted until it is unlocked')}
            onClick={() => panel.versionLockSet(versionSelected.versionId, !versionSelected.isLocked)}
          >
            {versionSelected.isLocked ? <LockOpen size={11} aria-hidden="true" /> : <Lock size={11} aria-hidden="true" />}
            {versionSelected.isLocked ? ' Unlock version' : ' Lock version'}
          </button>
          <button
            type="button"
            className="doc-edit-action"
            disabled={isBusy || Boolean(deleteReason)}
            title={deleteReason}
            onClick={() => panel.confirmSet('versionDelete', versionSelected.versionId)}
          >
            <Trash2 size={11} aria-hidden="true" /> Delete version
          </button>
          {panel.confirm?.kind === 'versionDelete' ? (
            <ConfirmInline
              label={pinnedCountSelected > 0
                ? `Delete version ${panel.confirm.versionId}? ${pinnedCountSelected} block${pinnedCountSelected === 1 ? ' is' : 's are'} pinned to it.`
                : `Delete version ${panel.confirm.versionId}?`}
              panel={panel}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
});

// what the writer of the version's data said about it
// ({versionId}.metadata.yaml, doc_page_impl_asset.md#version-metadata), read
// with the version's data: shown once that is loaded
const VersionMetadataLine = observer(function VersionMetadataLine({ object, panel, versionId }) {
  const { assetStore } = useDocStores();
  const stateVersion = assetStore.versionGet(panel.store, object.objectId, versionId);
  if (stateVersion?.status !== 'done') return null;
  const metadata = stateVersion.metadata ?? {};
  const isEmpty = Object.keys(metadata).length === 0;
  return (
    <p className="doc-asset-dependency-list">
      <span className="doc-asset-mono doc-asset-muted">{versionId}</span>
      <span className="doc-asset-muted"> metadata: </span>
      {isEmpty
        ? <span className="doc-asset-muted">none</span>
        : <span className="doc-asset-mono doc-asset-version-metadata">{JSON.stringify(metadata)}</span>}
    </p>
  );
});

// ---------- data of the selected version ----------

const DataSection = observer(function DataSection({ object, panel, isWritable, isBusy }) {
  const { assetStore } = useDocStores();
  const edit = panel.edit;
  const upload = panel.upload;
  const versionId = panel.versionIdSelected;
  const stateVersion = versionId ? assetStore.versionGet(panel.store, object.objectId, versionId) : undefined;
  const stateHead = assetStore.versionGet(panel.store, object.objectId, object.versionIdHead);
  const isHeadSelected = versionId === object.versionIdHead;
  const isChangeable = isWritable && !object.isDeleted;
  const isHeadText = stateHead?.status === 'done' && stateHead.isText === true;
  const isEditable = isChangeable && isHeadText && !object.isLocked;
  const isHeadLocked = panel.isHeadLocked;
  const saveMode = panel.saveMode;
  const isUploadBlocked = object.isLocked || (saveMode === 'inPlace' && isHeadLocked);
  const fileInputRef = useRef(null);
  // the text and its buttons: a pointer going down anywhere else leaves the
  // editing (saved when changed), as leaving a block of the document does
  const editAreaRef = useRef(null);
  useEditOutsidePointer(editAreaRef, edit !== undefined && edit.status !== 'submitting', () => {
    void panel.editLeave();
  });

  // why the head cannot be edited or replaced, said beside the greyed-out buttons
  let editReason = '';
  if (object.isLocked) editReason = 'the object is locked, so its data cannot change; unlock it first';
  else if (stateHead?.status === 'done' && !isHeadText) {
    editReason = `the head is not text (${object.contentType}, ${sizeTextGet(stateHead.size)}), so it cannot be edited here; upload a file to replace it`;
  } else if (isUploadBlocked) {
    editReason = 'the head version is locked and the save mode is in place, so an upload would rewrite it; unlock the version, or choose the new version save mode';
  }

  // the title keeps its form while editing starts, so the row does not change
  let title;
  if (!versionId) title = 'no version selected';
  else {
    title = (
      <>
        data of <span className="doc-asset-mono">{versionId}</span>
        {isHeadSelected ? ' (head)' : ''}
        {edit ? <span className="doc-asset-muted">, editing</span> : null}
      </>
    );
  }

  return (
    <section className="doc-asset-section is-data">
      <p className="doc-asset-section-title">{title}</p>
      <div ref={editAreaRef} className="doc-asset-data">
        {edit || (stateVersion?.status === 'done' && stateVersion.isText) ? (
          <DataText
            text={stateVersion?.text ?? ''}
            panel={panel}
            lang={object.lang}
            isEditStartable={isEditable && isHeadSelected && !isBusy}
          />
        ) : !versionId ? (
          <p className="doc-asset-muted">Select a version to see its data.</p>
        ) : stateVersion?.status === 'done' ? (
          <BinaryInfo object={object} panel={panel} versionId={versionId} stateVersion={stateVersion} />
        ) : stateVersion?.status === 'error' ? (
          <p className="doc-edit-message">{stateVersion.message}</p>
        ) : (
          <p className="doc-asset-panel-status"><LoaderCircle size={12} className="doc-edit-spin" aria-hidden="true" /> loading</p>
        )}
        {isChangeable ? (
          <div className="doc-asset-actions">
            {edit ? (
              <>
                <button
                  type="button"
                  className={saveMode === 'inPlace' ? 'doc-edit-action is-primary' : 'doc-edit-action'}
                  disabled={isBusy || isHeadLocked}
                  title={isHeadLocked ? 'the head version is locked; save as a new version' : 'the head version keeps its id; its previous bytes are kept as a backup file'}
                  onClick={() => panel.save('inPlace')}
                >
                  <Check size={11} aria-hidden="true" /> Save in place
                </button>
                <button
                  type="button"
                  className={saveMode === 'newVersion' ? 'doc-edit-action is-primary' : 'doc-edit-action'}
                  disabled={isBusy}
                  title="a new version made from the head becomes the head"
                  onClick={() => panel.save('newVersion')}
                >
                  <Check size={11} aria-hidden="true" /> Save as new version
                </button>
                <button type="button" className="doc-edit-action" disabled={isBusy} onClick={() => panel.editCancel()}>
                  <X size={11} aria-hidden="true" /> Cancel
                </button>
                {edit.status === 'submitting' ? <LoaderCircle size={12} className="doc-edit-spin" aria-label="saving" /> : null}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="doc-edit-action"
                  disabled={isBusy || !isEditable}
                  title={isEditable ? 'edits the head text' : editReason}
                  onClick={() => panel.editStart()}
                >
                  <Pencil size={11} aria-hidden="true" /> Edit head
                </button>
                <button
                  type="button"
                  className="doc-edit-action"
                  disabled={isBusy || isUploadBlocked}
                  title={isUploadBlocked ? editReason : `a file becomes the head data (${saveMode === 'newVersion' ? 'as a new version' : 'in place'}, by the save mode)`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={11} aria-hidden="true" /> Upload file as head
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="doc-asset-file-input"
                  tabIndex={-1}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void panel.uploadRun(file);
                  }}
                />
                {editReason ? <span className="doc-asset-muted doc-asset-actions-note">{editReason}</span> : null}
                {upload?.status === 'submitting' ? (
                  <span className="doc-asset-panel-status"><LoaderCircle size={12} className="doc-edit-spin" aria-hidden="true" /> uploading {upload.fileName}</span>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        {edit?.status === 'error' ? <p className="doc-edit-message">{edit.message}</p> : null}
      </div>
      {upload?.status === 'error' ? (
        <p className="doc-edit-message">
          {upload.fileName}: {upload.message}
          <button type="button" className="doc-asset-link" onClick={() => panel.uploadMessageClear()}>dismiss</button>
        </p>
      ) : null}
    </section>
  );
});

// a version whose bytes are not utf-8 text: what is known of it, a preview
// when the type is an image, the bytes by link
const BinaryInfo = observer(function BinaryInfo({ object, panel, versionId, stateVersion }) {
  const { assetStore } = useDocStores();
  const url = assetStore.dataUrlGet(panel.store, object.objectId, versionId);
  const isImage = object.contentType.startsWith('image/');
  return (
    <div className="doc-asset-binary">
      <dl className="doc-asset-fields">
        <dt>data</dt>
        <dd>not text ({object.contentType})</dd>
        <dt>size</dt>
        <dd className="doc-asset-mono">{sizeTextGet(stateVersion.size)}</dd>
        <dt>sha1</dt>
        <dd className="doc-asset-mono">{stateVersion.hash}</dd>
      </dl>
      {isImage ? <img className="doc-asset-binary-preview" src={url} alt={object.name || object.objectId} /> : null}
      <div className="doc-asset-actions">
        <a className="doc-edit-action" href={url} download={`${object.objectId}.${versionId}.${object.fileExt}`}>
          <Download size={11} aria-hidden="true" /> Download
        </a>
      </div>
    </div>
  );
});

// the text of the selected version, in one <pre> that becomes editable in
// its place: contentEditable is switched on while the head text is edited,
// the element is not replaced and keeps its box (same padding, type and
// height rules in both states: nothing moves when editing starts). the text
// is written into the element by hand (uncontrolled): the version text when
// showing, the draft once when editing starts (after a failed save the text
// stays as typed), never on a keystroke. the caret is placed where the text
// was clicked (edit.pointStart), else at the end.
//
//   text             the text of the shown version
//   panel            the panel model; panel.edit while the head text is being edited
//   isEditStartable  a click on the text starts editing the head
const DataText = observer(function DataText({ text, panel, lang, isEditStartable }) {
  const elementRef = useRef(null);
  const edit = panel.edit;
  const isEditing = edit !== undefined;
  const isLocked = edit?.status === 'submitting';

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (!isEditing) {
      if (element.textContent !== text) element.textContent = text;
      return;
    }
    if (element.textContent !== edit.textDraft) element.textContent = edit.textDraft;
    element.focus({ preventScroll: true });
    caretPlaceInitial(element, edit.pointStart ? { type: 'point', ...edit.pointStart } : 'end');
    // the draft is the element's own content while editing; only the start
    // of editing and a change of the shown text rewrite the element
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, text]);

  return (
    <pre
      ref={elementRef}
      className="doc-asset-text"
      data-lang={lang}
      role={isEditing ? 'textbox' : undefined}
      contentEditable={isEditing && !isLocked ? 'plaintext-only' : 'false'}
      suppressContentEditableWarning
      spellCheck={false}
      data-editing={isEditing ? '' : undefined}
      data-locked={isLocked ? '' : undefined}
      data-editable={isEditStartable && !isEditing ? '' : undefined}
      title={isEditStartable && !isEditing ? 'click to edit the head text' : undefined}
      onClick={(event) => {
        if (isEditing || !isEditStartable) return;
        panel.editStart({ clientX: event.clientX, clientY: event.clientY });
      }}
      onInput={(event) => {
        if (isEditing) panel.draftSet(event.currentTarget.textContent);
      }}
      onKeyDown={(event) => {
        if (isEditing && event.key === 'Escape') {
          event.preventDefault();
          panel.editCancel();
        }
      }}
      onPaste={(event) => {
        if (!isEditing) return;
        event.preventDefault();
        document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? '');
      }}
    />
  );
});

// a confirmation in the row of the button that asked for it, right after
// that button: the question, Delete / Cancel, and the failure beside them,
// so opening it moves nothing below
const ConfirmInline = observer(function ConfirmInline({ label, panel }) {
  const confirm = panel.confirm;
  const isSubmitting = confirm.status === 'submitting';
  return (
    <>
      <span className="doc-edit-confirm" role="alertdialog" aria-label={label}>
        <span>{label}</span>
        <button type="button" className="is-danger" disabled={isSubmitting} onClick={() => panel.confirmApply()}>
          {isSubmitting ? <LoaderCircle size={11} className="doc-edit-spin" aria-hidden="true" /> : <Trash2 size={11} aria-hidden="true" />}
          Delete
        </button>
        <button type="button" disabled={isSubmitting} onClick={() => panel.confirmClear()}>
          <X size={11} aria-hidden="true" /> Cancel
        </button>
      </span>
      {confirm.status === 'error' ? <span className="doc-edit-message">{confirm.message}</span> : null}
    </>
  );
});

export function sizeTextGet(size) {
  if (!Number.isFinite(size)) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
