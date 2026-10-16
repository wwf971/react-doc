import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Check, LoaderCircle, Plus, Trash2 } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import '../edit/DocEdit.css';
import './DocSettings.css';

// The "Asset store" tab of the settings panel (design:
// doc_page_impl_asset.md#the-local-store): the folders of the local store,
// which one is the default (new objects are created there), and whether
// each exists and how many objects it holds. Set default, Remove, and Add
// change DocAssetStore.folderList; the store sends the whole list to the
// development server, which rewrites the store's config file, so the
// folders are kept across page loads. A built page lists the folders and
// changes nothing. Rendered by ConfigPanel as a custom full-width item; it
// takes nothing from the panel and reads the stores itself.
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
