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

export const ASSET_PANEL_SECTION_LIST = ['item', 'usage', 'version', 'data'];

// The asset panel of one item (design: doc_page_impl_asset.md): the
// item's metadata and events, the blocks that use it, its versions, the
// data of the selected version. From here the head is moved, a version or
// the item is deleted, the item is restored or renamed, the component
// it is data for is declared, its save mode is chosen, the head text is
// edited and saved (in place, or as a new version), a file is uploaded as
// the new head data, the item or one version is locked, and a block that
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
  const stateItem = assetStore.itemStateGet(panel.store, panel.itemId);
  const item = stateItem?.item;
  if (!item) {
    return (
      <div className="doc-asset-panel">
        {stateItem?.status === 'error'
          ? <p className="doc-error doc-edit-message">{stateItem.message}</p>
          : <p className="doc-asset-panel-status"><LoaderCircle size={12} className="doc-spin" aria-hidden="true" /> loading</p>}
      </div>
    );
  }
  const isWritable = assetStore.isWritable;
  const isBusy = panel.isBusy;
  const sectionByName = {
    item: <ItemSection key="object" item={item} panel={panel} isWritable={isWritable} isBusy={isBusy} />,
    usage: <UsageSection key="usage" item={item} panel={panel} onNavigate={onNavigate} />,
    version: <VersionSection key="version" item={item} panel={panel} isWritable={isWritable} isBusy={isBusy} />,
    data: <DataSection key="data" item={item} panel={panel} isWritable={isWritable} isBusy={isBusy} />,
  };
  return (
    <div className="doc-asset-panel">
      {sectionList.map((name) => sectionByName[name] ?? null)}
    </div>
  );
});

// ---------- item ----------

// where the item lies, whose folder that is, what it declares, and moving it
const ItemPlace = observer(function ItemPlace({ item, panel, isChangeable }) {
  const move = panel.move;
  const kindList = panel.moveKindList;
  const isIncoming = panel.moveOwnerRefIncoming !== '';
  return (
    <>
      <span>{item.folder} / {item.dirName}</span>
      {item.folderOwner ? <span className="doc-badge-outline doc-asset-place-badge" title="found in the folder of this object">in {item.folderOwner.ref}</span> : null}
      {item.owner ? <span className="doc-badge-outline doc-asset-place-badge" title="what the item declares of itself">declares {item.owner.ref}{item.owner.role ? ` (${item.owner.role})` : ''}</span> : null}
      {isChangeable ? <button type="button" className="doc-asset-link" onClick={() => panel.moveToggle()}>{move ? 'cancel the move' : 'move…'}</button> : null}
      {move ? (
        <div className="doc-asset-move">
          <select aria-label="The folder to move it to" value={move.folder} onChange={(event) => panel.moveSet({ folder: event.target.value, groupPath: '' })}>
            {panel.moveFolderList.map((folder) => <option key={folder.path} value={folder.path}>{folder.label}</option>)}
          </select>
          <input aria-label="The folders inside it" placeholder="(its top) or a/b" value={move.groupPath} onChange={(event) => panel.moveSet({ groupPath: event.target.value })} />
          {isIncoming && kindList ? (
            <select aria-label="Its kind in that object" value={move.kind} onChange={(event) => panel.moveSet({ kind: event.target.value })}>
              <option value="">(kind)</option>
              {kindList.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
            </select>
          ) : null}
          {isIncoming && !kindList ? <input aria-label="Its kind in that object" placeholder="its kind" value={move.kind} onChange={(event) => panel.moveSet({ kind: event.target.value })} /> : null}
          <button type="button" className="doc-button" disabled={panel.isBusy} onClick={() => void panel.moveRun()}>Move</button>
          {isIncoming ? <span className="doc-asset-muted">the object decides whether it takes it</span> : null}
        </div>
      ) : null}
    </>
  );
});

const ItemSection = observer(function ItemSection({ item, panel, isWritable, isBusy }) {
  const isChangeable = isWritable && !item.isDeleted && !item.isLocked && !isBusy;
  const eventLast = item.eventList[item.eventList.length - 1];
  return (
    <section className="doc-asset-section">
      <dl className="doc-asset-fields">
        <dt>item</dt>
        <dd className="doc-asset-mono">{panel.store} / {item.itemId}</dd>
        <dt>name</dt>
        <dd>
          {isChangeable
            ? <EditValueInline value={item.name} placeholder="(no name)" onCommit={(name) => panel.nameSet(name)} />
            : <span>{item.name || '(no name)'}</span>}
        </dd>
        <dt>component</dt>
        <dd title="the component whose data the item is (doc_page_impl_mdx_comp.md#components-and-the-asset-service-layer)">
          {isChangeable
            ? <EditValueInline value={item.component?.name ?? ''} placeholder="(none)" className="doc-asset-mono" onCommit={(name) => panel.componentSet(name)} />
            : <span className="doc-asset-mono">{item.component?.name ?? '(none)'}</span>}
        </dd>
        <dt>lang</dt>
        <dd className="doc-asset-mono">{item.lang || '(none)'} <span className="doc-asset-muted">(.{item.fileExt})</span></dd>
        <dt>type</dt>
        <dd className="doc-asset-mono">{item.contentType}</dd>
        <dt>place</dt>
        <dd>
          <ItemPlace item={item} panel={panel} isChangeable={isChangeable} />
        </dd>
        <dt>head</dt>
        <dd className="doc-asset-mono">{item.versionIdHead}</dd>
        <dt>created</dt>
        <dd className="doc-asset-mono">{item.timeCreated}</dd>
        <dt>events</dt>
        <dd>
          <span className="doc-asset-mono">{item.eventList.length}</span>
          {eventLast ? <span className="doc-asset-muted">, last <span className="doc-asset-mono">{eventLast.eventType} {eventLast.time}</span></span> : null}
          <button type="button" className="doc-asset-link" onClick={() => panel.eventListToggle()}>
            {panel.isEventListOpen ? 'hide' : 'show all'}
          </button>
          {panel.isEventListOpen ? <EventList eventList={item.eventList} /> : null}
        </dd>
        <dt>save mode</dt>
        <dd>
          <SaveModeControl item={item} panel={panel} isChangeable={isChangeable} />
        </dd>
      </dl>
      {item.isDeleted ? (
        <p className="doc-asset-panel-status">
          <span className="doc-asset-frame-flag">deleted</span>
          <span>The item is marked deleted; documents still read it until the folder is cleaned.</span>
        </p>
      ) : null}
      {item.isLocked ? (
        <p className="doc-asset-panel-status">
          <Lock size={12} aria-hidden="true" />
          <span>The item is locked: its data, versions, head and metadata cannot change until it is unlocked.</span>
        </p>
      ) : null}
      {isWritable ? (
        <div className="doc-asset-actions">
          <button
            type="button"
            className="doc-button"
            disabled={isBusy}
            title={item.isLocked ? 'allows changes of the item again' : 'no change of the item (data, versions, head, metadata, deletion) until it is unlocked'}
            onClick={() => panel.itemLockSet(!item.isLocked)}
          >
            {item.isLocked ? <LockOpen size={11} aria-hidden="true" /> : <Lock size={11} aria-hidden="true" />}
            {item.isLocked ? ' Unlock item' : ' Lock item'}
          </button>
          {item.isDeleted ? (
            <button type="button" className="doc-button" disabled={isBusy || item.isLocked} onClick={() => panel.itemRestore()}>
              Restore item
            </button>
          ) : (
            <button
              type="button"
              className="doc-button"
              disabled={isBusy || item.isLocked}
              title={item.isLocked ? 'the item is locked' : ''}
              onClick={() => panel.confirmSet('itemDelete')}
            >
              <Trash2 size={11} aria-hidden="true" /> Delete item
            </button>
          )}
          {panel.confirm?.kind === 'itemDelete' ? (
            <ConfirmInline
              label={panel.usageList.length > 0
                ? `Delete the item (mark deleted, files kept)? ${panel.usageList.length} block${panel.usageList.length === 1 ? '' : 's'} still use${panel.usageList.length === 1 ? 's' : ''} it.`
                : 'Delete the item (mark deleted, files kept)?'}
              panel={panel}
            />
          ) : null}
          {panel.status === 'submitting' ? <LoaderCircle size={12} className="doc-spin" aria-label="working" /> : null}
        </div>
      ) : null}
      {panel.message ? <p className="doc-error doc-edit-message">{panel.message}</p> : null}
    </section>
  );
});

// what happened to the item, oldest first: time, event, the version it concerns
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

// the save mode of the item: in place (the default, nothing written) or a
// new version on each save. a radio pair; "default" means the metadata says
// nothing and the item follows the in-place rule. it decides what an
// upload does and which save button is the primary one.
const SaveModeControl = observer(function SaveModeControl({ item, panel, isChangeable }) {
  const isWritten = item.saveMode !== undefined;
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
            name={`doc-asset-save-mode-${panel.store}-${item.itemId}`}
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

// ---------- usage: the blocks that reference the item ----------

// the backlinks of the item (doc_page_impl_asset.md#usage): every block
// of the documents whose reference names it, as the page last read the
// documents. the index follows the page's own edits and the documents'
// content hashes, but a change the page has not heard of yet is not in it:
// the read-again buttons (all documents, beside the title; one document,
// beside its place) confirm what the list says.
const UsageSection = observer(function UsageSection({ item, panel, onNavigate }) {
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
    note = <p className="doc-asset-panel-status"><LoaderCircle size={12} className="doc-spin" aria-hidden="true" /> reading the documents</p>;
  } else if (usageIndex.status === 'error') {
    note = <p className="doc-error doc-edit-message">{usageIndex.message}</p>;
  } else if (usageList.length === 0) {
    note = (
      <p className="doc-asset-muted doc-asset-usage-empty">
        {item.component
          ? `No block references the item: it is an orphan of ${item.component.name}.`
          : 'No block references the item.'}
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
            ? <LoaderCircle size={11} className="doc-spin" aria-hidden="true" />
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
          componentNameItem={item.component?.name ?? ''}
          usageIsCurrent={(usage) => panel.usageIsOfBlock(usage)}
          docPathRefreshing={isRefreshing ? usageRefresh.docPath : undefined}
          onDocRefresh={(docPath) => void panel.usageRefreshRun(docPath)}
          onNavigate={usageNavigate}
        />
      ) : null}
      {panel.usageNavigateMessage ? <p className="doc-error doc-edit-message">{panel.usageNavigateMessage}</p> : null}
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
const VersionSection = observer(function VersionSection({ item, panel, isWritable, isBusy }) {
  const { assetStore } = useDocStores();
  const versionList = panel.versionList;
  const usageCount = panel.usageCount;
  const isUsageKnown = assetStore.usageIndex.status === 'done';
  const versionIdRead = assetStore.refVersionIdGet({ store: panel.store, itemId: item.itemId, versionId: panel.versionIdRef || 'head' });
  const versionSelected = versionList.find((version) => version.versionId === panel.versionIdSelected);
  const isHeadSelected = versionSelected?.versionId === item.versionIdHead;
  const isItemLocked = item.isLocked;
  let deleteReason = '';
  if (isItemLocked) deleteReason = 'the item is locked';
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
              const isHead = version.versionId === item.versionIdHead;
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
                    {isHead ? <span className="doc-badge-outline" data-primary="">head</span> : null}
                    {isRead && panel.versionIdRef ? <span className="doc-badge-outline">read here</span> : null}
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
                  : `${dependency.itemId}${dependency.versionId ? `@${dependency.versionId}` : ' (head)'}`}
              </span>
            ))}
        </p>
      ) : null}
      {versionSelected ? <VersionMetadataLine item={item} panel={panel} versionId={versionSelected.versionId} /> : null}
      {versionSelected && isWritable && !item.isDeleted ? (
        <div className="doc-asset-actions">
          <span className="doc-asset-mono doc-asset-muted">{versionSelected.versionId}</span>
          <button
            type="button"
            className="doc-button"
            disabled={isBusy || isHeadSelected || isItemLocked}
            title={isItemLocked ? 'the item is locked' : ''}
            onClick={() => panel.headSet(versionSelected.versionId)}
          >
            <Check size={11} aria-hidden="true" /> Set as head
          </button>
          <button
            type="button"
            className="doc-button"
            disabled={isBusy || isItemLocked}
            title={isItemLocked ? 'the item is locked' : (versionSelected.isLocked ? 'allows rewriting and deleting this version again' : 'the version cannot be rewritten in place or deleted until it is unlocked')}
            onClick={() => panel.versionLockSet(versionSelected.versionId, !versionSelected.isLocked)}
          >
            {versionSelected.isLocked ? <LockOpen size={11} aria-hidden="true" /> : <Lock size={11} aria-hidden="true" />}
            {versionSelected.isLocked ? ' Unlock version' : ' Lock version'}
          </button>
          <button
            type="button"
            className="doc-button"
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
const VersionMetadataLine = observer(function VersionMetadataLine({ item, panel, versionId }) {
  const { assetStore } = useDocStores();
  const stateVersion = assetStore.versionGet(panel.store, item.itemId, versionId);
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

const DataSection = observer(function DataSection({ item, panel, isWritable, isBusy }) {
  const { assetStore } = useDocStores();
  const edit = panel.edit;
  const upload = panel.upload;
  const versionId = panel.versionIdSelected;
  const stateVersion = versionId ? assetStore.versionGet(panel.store, item.itemId, versionId) : undefined;
  const stateHead = assetStore.versionGet(panel.store, item.itemId, item.versionIdHead);
  const isHeadSelected = versionId === item.versionIdHead;
  const isChangeable = isWritable && !item.isDeleted;
  const isHeadText = stateHead?.status === 'done' && stateHead.isText === true;
  const isEditable = isChangeable && isHeadText && !item.isLocked;
  const isHeadLocked = panel.isHeadLocked;
  const saveMode = panel.saveMode;
  const isUploadBlocked = item.isLocked || (saveMode === 'inPlace' && isHeadLocked);
  const fileInputRef = useRef(null);
  // the text and its buttons: a pointer going down anywhere else leaves the
  // editing (saved when changed), as leaving a block of the document does
  const editAreaRef = useRef(null);
  useEditOutsidePointer(editAreaRef, edit !== undefined && edit.status !== 'submitting', () => {
    void panel.editLeave();
  });

  // why the head cannot be edited or replaced, said beside the greyed-out buttons
  let editReason = '';
  if (item.isLocked) editReason = 'the item is locked, so its data cannot change; unlock it first';
  else if (stateHead?.status === 'done' && !isHeadText) {
    editReason = `the head is not text (${item.contentType}, ${sizeTextGet(stateHead.size)}), so it cannot be edited here; upload a file to replace it`;
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
            lang={item.lang}
            isEditStartable={isEditable && isHeadSelected && !isBusy}
          />
        ) : !versionId ? (
          <p className="doc-asset-muted">Select a version to see its data.</p>
        ) : stateVersion?.status === 'done' ? (
          <BinaryInfo item={item} panel={panel} versionId={versionId} stateVersion={stateVersion} />
        ) : stateVersion?.status === 'error' ? (
          <p className="doc-error doc-edit-message">{stateVersion.message}</p>
        ) : (
          <p className="doc-asset-panel-status"><LoaderCircle size={12} className="doc-spin" aria-hidden="true" /> loading</p>
        )}
        {isChangeable ? (
          <div className="doc-asset-actions">
            {edit ? (
              <>
                <button
                  type="button"
                  className="doc-button"
                  data-primary={saveMode === 'inPlace' ? '' : undefined}
                  disabled={isBusy || isHeadLocked}
                  title={isHeadLocked ? 'the head version is locked; save as a new version' : 'the head version keeps its id; its previous bytes are kept as a backup file'}
                  onClick={() => panel.save('inPlace')}
                >
                  <Check size={11} aria-hidden="true" /> Save in place
                </button>
                <button
                  type="button"
                  className="doc-button"
                  data-primary={saveMode === 'newVersion' ? '' : undefined}
                  disabled={isBusy}
                  title="a new version made from the head becomes the head"
                  onClick={() => panel.save('newVersion')}
                >
                  <Check size={11} aria-hidden="true" /> Save as new version
                </button>
                <button type="button" className="doc-button" disabled={isBusy} onClick={() => panel.editCancel()}>
                  <X size={11} aria-hidden="true" /> Cancel
                </button>
                {edit.status === 'submitting' ? <LoaderCircle size={12} className="doc-spin" aria-label="saving" /> : null}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="doc-button"
                  disabled={isBusy || !isEditable}
                  title={isEditable ? 'edits the head text' : editReason}
                  onClick={() => panel.editStart()}
                >
                  <Pencil size={11} aria-hidden="true" /> Edit head
                </button>
                <button
                  type="button"
                  className="doc-button"
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
                  <span className="doc-asset-panel-status"><LoaderCircle size={12} className="doc-spin" aria-hidden="true" /> uploading {upload.fileName}</span>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        {edit?.status === 'error' ? <p className="doc-error doc-edit-message">{edit.message}</p> : null}
      </div>
      {upload?.status === 'error' ? (
        <p className="doc-error doc-edit-message">
          {upload.fileName}: {upload.message}
          <button type="button" className="doc-asset-link" onClick={() => panel.uploadMessageClear()}>dismiss</button>
        </p>
      ) : null}
    </section>
  );
});

// a version whose bytes are not utf-8 text: what is known of it, a preview
// when the type is an image, the bytes by link
const BinaryInfo = observer(function BinaryInfo({ item, panel, versionId, stateVersion }) {
  const { assetStore } = useDocStores();
  const url = assetStore.dataUrlGet(panel.store, item.itemId, versionId);
  const isImage = item.contentType.startsWith('image/');
  return (
    <div className="doc-asset-binary">
      <dl className="doc-asset-fields">
        <dt>data</dt>
        <dd>not text ({item.contentType})</dd>
        <dt>size</dt>
        <dd className="doc-asset-mono">{sizeTextGet(stateVersion.size)}</dd>
        <dt>sha1</dt>
        <dd className="doc-asset-mono">{stateVersion.hash}</dd>
      </dl>
      {isImage ? <img className="doc-asset-binary-preview" src={url} alt={item.name || item.itemId} /> : null}
      <div className="doc-asset-actions">
        <a className="doc-button" href={url} download={`${item.itemId}.${versionId}.${item.fileExt}`}>
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
          {isSubmitting ? <LoaderCircle size={11} className="doc-spin" aria-hidden="true" /> : <Trash2 size={11} aria-hidden="true" />}
          Delete
        </button>
        <button type="button" disabled={isSubmitting} onClick={() => panel.confirmClear()}>
          <X size={11} aria-hidden="true" /> Cancel
        </button>
      </span>
      {confirm.status === 'error' ? <span className="doc-error doc-edit-message">{confirm.message}</span> : null}
    </>
  );
});

export function sizeTextGet(size) {
  if (!Number.isFinite(size)) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
