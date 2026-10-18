import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Check, LoaderCircle, Plus, RotateCw, Trash2 } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ASSET_STORE_ID_LOCAL } from '../../frontend/src/lib/doc-asset-ref.js';
import { docPlaceTargetGet } from '../../frontend/src/lib/doc-place.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { useEditOutsidePointer } from '../edit/use-edit-outside-pointer.js';
import { AssetPanel } from '../asset/AssetPanel.jsx';
import { AssetObjectTable } from '../asset/AssetObjectTable.jsx';
import { AssetUsageTable } from '../asset/AssetUsageTable.jsx';
import '../edit/DocEdit.css';
import './DocSettings.css';

// The "Asset store" tab of the settings panel (design:
// doc_page_impl_asset.md#the-local-store): the folders of the local store,
// which one is the default (new objects are created there), and whether
// each exists and how many objects it holds. Set default, Remove, and Add
// change DocAssetStore.folderList; the store sends the whole list to the
// development server, which rewrites the store's config file, so the
// folders are kept across page loads. Below the folders: the orphan
// objects, the objects nothing references and the broken references
// (AssetOrphanArea). A built page lists and changes nothing. Rendered by
// ConfigPanel as a custom full-width item; it takes nothing from the panel
// and reads the stores itself.
export const AssetStoreSettings = observer(function AssetStoreSettings() {
  const { assetStore } = useDocStores();
  if (!assetStore.isAvailable) {
    return <p className="doc-settings-asset-note">{assetStore.unavailableReason || 'The asset store is loading.'}</p>;
  }
  const isWritable = assetStore.isWritable;
  const isBusy = assetStore.folder.status === 'submitting';
  const folderList = assetStore.folderList;
  return (
    <div className="doc-settings-asset">
      <p className="doc-settings-asset-note">
        Folders of the local store, relative to the store&apos;s config file. The default folder receives the objects created from this page.
        {isWritable ? '' : ' This build cannot change them.'}
      </p>
      <ul className="doc-settings-asset-list">
        {folderList.map((folder) => (
          <li key={folder.path} className="doc-settings-asset-folder" data-missing={folder.isExists ? undefined : ''}>
            <span className="doc-settings-asset-path" title={folder.pathAbs}>{folder.path}</span>
            <span className="doc-settings-asset-flags">
              {folder.isDefault ? <span className="doc-settings-asset-badge is-default">default</span> : null}
              {folder.isExists ? null : <span className="doc-settings-asset-badge is-missing">missing</span>}
            </span>
            <span className="doc-settings-asset-count">{folder.objectCount} object{folder.objectCount === 1 ? '' : 's'}</span>
            {isWritable ? (
              <span className="doc-settings-asset-actions">
                <button
                  type="button"
                  className="doc-settings-head-button"
                  disabled={isBusy || folder.isDefault}
                  title={folder.isDefault ? 'this is the default folder' : 'new objects are created in this folder'}
                  onClick={() => void assetStore.folderDefaultSet(folder.path)}
                >
                  <Check aria-hidden="true" size={11} strokeWidth={2} />
                  <span>Set default</span>
                </button>
                <button
                  type="button"
                  className="doc-settings-head-button"
                  disabled={isBusy || folderList.length <= 1}
                  title={folderList.length <= 1 ? 'the last folder cannot be removed' : 'the folder is no longer scanned; its files are kept'}
                  onClick={() => void assetStore.folderRemove(folder.path)}
                >
                  <Trash2 aria-hidden="true" size={11} strokeWidth={2} />
                  <span>Remove</span>
                </button>
              </span>
            ) : null}
          </li>
        ))}
        {isWritable ? <FolderAddRow isBusy={isBusy} /> : null}
      </ul>
      {assetStore.folder.status === 'error' ? (
        <p className="doc-edit-message">
          {assetStore.folder.message}
          <button type="button" className="doc-settings-asset-link" onClick={() => assetStore.folderMessageClear()}>dismiss</button>
        </p>
      ) : null}
      <AssetOrphanArea />
    </div>
  );
});

// what the usage index finds wrong between the documents and the store
// (doc_page_impl_asset.md#usage): objects declared as a component's data
// that no block references (orphans), objects no block references that
// declare nothing (data of another purpose, or from before the
// declaration), and references whose data cannot be read. a click on an
// object shows its asset panel below the lists (DocAssetStore.settingsPanel,
// the same AssetPanel as the popup's); a click on it again, or a pointer
// going down outside the area, closes it. "Read again" reads every document
// again, for what changed while the page did not watch.
const AssetOrphanArea = observer(function AssetOrphanArea() {
  const { assetStore, configStore, docStore } = useDocStores();
  const areaRef = useRef(null);
  const settingsPanel = assetStore.settingsPanel;
  const usageIndex = assetStore.usageIndex;
  const [navigateMessage, navigateMessageSet] = useState('');
  useEditOutsidePointer(areaRef, settingsPanel !== undefined, () => {
    if (!settingsPanel.edit) assetStore.settingsPanelClose();
  });
  const objectIdSelected = settingsPanel?.objectId ?? '';
  const objectSelect = (objectId) => assetStore.settingsPanelToggle(ASSET_STORE_ID_LOCAL, objectId);
  const brokenList = assetStore.usageBrokenList;

  const usageNavigate = (place) => {
    const isNavigated = docStore.navigate(docPlaceTargetGet(place));
    navigateMessageSet(isNavigated ? '' : docStore.navigationError);
    if (isNavigated) configStore.settingsOpenSet(false);
  };

  return (
    <div ref={areaRef} className="doc-settings-asset-orphan">
      <p className="doc-settings-asset-title">
        Objects and references
        <button
          type="button"
          className="doc-asset-icon-button"
          disabled={assetStore.isUsageReading}
          title="reads every document again for its asset references"
          aria-label="read every document again"
          onClick={() => void assetStore.usageLoad()}
        >
          {assetStore.isUsageReading
            ? <LoaderCircle size={11} className="doc-edit-spin" aria-hidden="true" />
            : <RotateCw size={11} aria-hidden="true" />}
        </button>
      </p>
      {usageIndex.status === 'error' ? <p className="doc-edit-message">{usageIndex.message}</p> : null}
      {usageIndex.status === 'done' ? (
        <>
          <p className="doc-settings-asset-note">
            Orphans: objects that declare a component no block uses them for (a block removed without its data, or changed outside the page).
          </p>
          {assetStore.orphanObjectList.length > 0
            ? <AssetObjectTable objectList={assetStore.orphanObjectList} objectIdSelected={objectIdSelected} onSelect={objectSelect} />
            : <p className="doc-settings-asset-note">None.</p>}
          <p className="doc-settings-asset-note">
            Not referenced: objects no block uses that declare no component; they may serve another purpose.
          </p>
          {assetStore.unreferencedObjectList.length > 0
            ? <AssetObjectTable objectList={assetStore.unreferencedObjectList} objectIdSelected={objectIdSelected} onSelect={objectSelect} />
            : <p className="doc-settings-asset-note">None.</p>}
          <p className="doc-settings-asset-note">Broken references: blocks whose asset data cannot be read.</p>
          {brokenList.length > 0 ? (
            <AssetUsageTable
              usageList={brokenList}
              isObjectShown
              docPathRefreshing={undefined}
              onDocRefresh={(docPath) => void assetStore.usageDocListRead([docPath])}
              onNavigate={usageNavigate}
            />
          ) : <p className="doc-settings-asset-note">None.</p>}
          {navigateMessage ? <p className="doc-edit-message">{navigateMessage}</p> : null}
        </>
      ) : null}
      {usageIndex.status === 'loading' || usageIndex.status === 'idle' ? (
        <p className="doc-settings-asset-note"><LoaderCircle size={11} className="doc-edit-spin" aria-hidden="true" /> reading the documents</p>
      ) : null}
      {settingsPanel ? (
        <div className="doc-settings-asset-detail">
          <AssetPanel panel={settingsPanel} onNavigate={() => configStore.settingsOpenSet(false)} />
        </div>
      ) : null}
    </div>
  );
});

// a new folder path, the same editable text as a source path
// (EditValueInline): Enter, the Add button, or a click outside adds it,
// and leaving it empty shows the placeholder. the folder is created on
// disk by the development server when it does not exist.
const FolderAddRow = observer(function FolderAddRow({ isBusy }) {
  const { assetStore } = useDocStores();
  const elementRef = useRef(null);
  const addingRef = useRef(false);

  const add = async (pathText) => {
    const element = elementRef.current;
    const text = String(pathText ?? element?.textContent ?? '').trim();
    if (!text || isBusy || addingRef.current) return;
    addingRef.current = true;
    try {
      const isAdded = await assetStore.folderAdd(text);
      if (isAdded && element) element.textContent = '';
    } finally {
      addingRef.current = false;
    }
  };

  return (
    <li className="doc-settings-asset-folder doc-settings-asset-add">
      <EditValueInline
        ref={elementRef}
        value=""
        placeholder="./asset-more"
        isLocked={isBusy}
        className="doc-settings-asset-add-path"
        aria-label="Path of the folder to add"
        onCommit={(text) => void add(text)}
      />
      <button type="button" className="doc-settings-head-button" disabled={isBusy} title="adds the folder and scans it" onClick={() => void add()}>
        {isBusy
          ? <LoaderCircle aria-hidden="true" size={11} strokeWidth={2} className="doc-edit-spin" />
          : <Plus aria-hidden="true" size={11} strokeWidth={2} />}
        <span>Add folder</span>
      </button>
    </li>
  );
});
