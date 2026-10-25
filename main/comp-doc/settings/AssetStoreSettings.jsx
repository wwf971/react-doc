import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LoaderCircle, RotateCw } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ASSET_STORE_ID_LOCAL } from '../../frontend/src/lib/doc-asset-ref.js';
import { docPlaceTargetGet } from '../../frontend/src/lib/doc-place.js';
import { useEditOutsidePointer } from '../edit/use-edit-outside-pointer.js';
import { AssetPanel } from '../asset/AssetPanel.jsx';
import { AssetObjectTable } from '../asset/AssetObjectTable.jsx';
import { AssetUsageTable } from '../asset/AssetUsageTable.jsx';
import '../edit/DocEdit.css';
import './DocSettings.css';

// The "Asset service" tab of the settings panel (asset service layer) (design:
// doc_page_impl_asset.md#the-local-store-folders-fully-reflected), built as
// items of the settings panel's ConfigPanel, so it reads like the other tabs:
//
//   example_doc [this page]                          group, one per doc page
//   folders in .doc-page/asset.yaml                  (its own first, then the
//     Folders          [~example/asset   ] Remove    ones it includes)
//                      [~root/path       ] Add       stringList
//     Default folder   [~example/asset ▾]            select
//     On disk          ~example/asset  store default  13 objects
//   Objects and references ⟳                         group: AssetOrphanArea
//
// Every doc page names its asset folders in its asset store config
// (.doc-page/asset.yaml beside its entry), as source paths; a doc page
// without that file uses its default folder. A change is written into that
// doc page's file in place by the development server (writeByItemId of the
// panel, as for the config keys), which creates the file when the doc page
// has none yet; while it is written the item shows the panel's request
// state. A path that is not a folder of a root, or a folder that does not
// exist yet, gets a warning while it is typed. A built page lists and
// changes nothing.
export function assetStoreItemListBuild({ stores, data, writeByItemId, assetRequestItemPathText }) {
  const { assetStore } = stores;
  if (!assetStore.isAvailable) {
    return {
      itemList: [{ id: 'assetUnavailable', type: 'custom', comp: AssetUnavailableNote, isFullWidth: true }],
      requestStateByPath: {},
    };
  }
  const isLocked = !assetStore.isWritable || assetStore.folder.status === 'submitting';
  const lockedReason = assetStore.isWritable ? 'a change is being written' : assetStore.writeUnavailableReason;

  const itemList = assetStore.docPageList.map((docPage, index) => {
    const groupId = `docPage${index}`;
    const folderListId = `${groupId}FolderList`;
    const folderDefaultId = `${groupId}FolderDefault`;
    data[folderListId] = docPage.folderList;
    data[folderDefaultId] = docPage.folderDefault;
    const valueSetOf = (valueId) => (value) => assetStore.docPageFolderSet(
      docPage.configFileRelative,
      valueId === folderListId ? value : docPage.folderList,
      valueId === folderDefaultId ? value : docPage.folderDefault,
    );
    writeByItemId.set(folderListId, { define: { type: 'assetFolder' }, valueSet: valueSetOf(folderListId), isAsset: true });
    writeByItemId.set(folderDefaultId, { define: { type: 'assetFolder' }, valueSet: valueSetOf(folderDefaultId), isAsset: true });
    return {
      id: groupId,
      type: 'group',
      label: <DocPageGroupLabel docPage={docPage} isPageOwn={index === 0} />,
      description: docPageGroupDescriptionGet(docPage),
      children: [
        {
          id: folderListId,
          type: 'stringList',
          label: 'Folders',
          description: 'source paths in the full form, ~page:root/path',
          placeholder: '~page:root/path',
          valueWarningGet: (text) => assetStore.folderPathWarningGet(text, docPage.alias),
          isDisabled: isLocked,
          disabledReason: lockedReason,
        },
        {
          id: folderDefaultId,
          type: 'select',
          label: 'Default folder',
          description: 'where its new objects go',
          options: docPage.folderList,
          isDisabled: isLocked || docPage.folderList.length < 2,
          disabledReason: docPage.folderList.length < 2 ? 'the only folder is the default' : lockedReason,
        },
        {
          id: `${groupId}OnDisk`,
          type: 'custom',
          label: 'On disk',
          description: 'objects per folder',
          comp: DocPageFolderState,
          compProps: { entryFile: docPage.entryFile, problemList: docPage.problemList },
        },
      ],
    };
  });
  itemList.push({
    id: 'assetObjects',
    type: 'group',
    label: <AssetObjectsGroupLabel />,
    description: 'objects nothing uses, and references whose data cannot be read',
    children: [{ id: 'assetOrphan', type: 'custom', comp: AssetOrphanArea, isFullWidth: true }],
  });

  // the change being written, or the one that failed, shows on the item
  // that sent it
  const requestStateByPath = {};
  if (assetRequestItemPathText && assetStore.folder.status === 'submitting') {
    requestStateByPath[assetRequestItemPathText] = { status: 'pending' };
  } else if (assetRequestItemPathText && assetStore.folder.status === 'error') {
    requestStateByPath[assetRequestItemPathText] = { status: 'error', message: assetStore.folder.message };
  }
  return { itemList, requestStateByPath };
}

const AssetUnavailableNote = observer(function AssetUnavailableNote() {
  const { assetStore } = useDocStores();
  return <p className="doc-settings-asset-note">{assetStore.unavailableReason || 'The asset service layer is loading.'}</p>;
});

// the alias of a doc page and whether it is the page's own or an included one
function DocPageGroupLabel({ docPage, isPageOwn }) {
  return (
    <span className="doc-settings-asset-group-label" title={docPage.entryFile}>
      {docPage.alias}
      <span className="doc-badge-outline" data-primary={isPageOwn ? '' : undefined}>{isPageOwn ? 'this page' : 'included'}</span>
    </span>
  );
}

// where the folders of a doc page are written
function docPageGroupDescriptionGet(docPage) {
  const docPageDir = docPageDirTextGet(docPage.entryFile);
  const configFileName = docPage.configFileRelative.startsWith(`${docPageDir}/`)
    ? docPage.configFileRelative.slice(docPageDir.length + 1)
    : docPage.configFileRelative;
  return docPage.isConfigFileExists
    ? `folders written in ${configFileName}`
    : `no ${configFileName} yet: its default folder is used, and the file is created on the first change`;
}

// what each folder of a doc page holds on disk, then what is wrong with its
// config
//
//   ~example/asset  [store default]  13 objects
//   ~example/asset-archive           1 object
const DocPageFolderState = observer(function DocPageFolderState({ entryFile, problemList }) {
  const { assetStore } = useDocStores();
  return (
    <div className="doc-settings-asset-state">
      {assetStore.folderListOfDocPageGet(entryFile).map((folder) => (
        <span key={folder.path} className="doc-settings-asset-state-folder" title={folder.pathAbs}>
          <span className="doc-settings-asset-path">{folder.path}</span>
          {folder.isDefault ? <span className="doc-badge-outline" data-primary="">store default</span> : null}
          {folder.isExists ? null : <span className="doc-badge-outline" data-error="">not on disk</span>}
          <span className="doc-settings-asset-count">{folder.objectCount} object{folder.objectCount === 1 ? '' : 's'}</span>
        </span>
      ))}
      {problemList.map((problem) => <span key={problem} className="doc-error doc-settings-asset-problem">{problem}</span>)}
    </div>
  );
});

// the group title of the objects: "Read again" reads every document again,
// for what changed while the page did not watch
const AssetObjectsGroupLabel = observer(function AssetObjectsGroupLabel() {
  const { assetStore } = useDocStores();
  return (
    <span className="doc-settings-asset-group-label">
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
          ? <LoaderCircle size={11} className="doc-spin" aria-hidden="true" />
          : <RotateCw size={11} aria-hidden="true" />}
      </button>
    </span>
  );
});

// the folder of a doc page from its entry, as the settings tab names it:
// the parent of .doc-page/, relative to the config directory
function docPageDirTextGet(entryFile) {
  const segList = String(entryFile).split('/').slice(0, -1);
  if (segList[segList.length - 1] === '.doc-page') segList.pop();
  return segList.join('/');
}

// what the usage index finds wrong between the documents and the store
// (doc_page_impl_asset.md#usage): objects declared as a component's data
// that no block references (orphans), objects no block references that
// declare nothing (data of another purpose, or from before the
// declaration), and references whose data cannot be read. a click on an
// object shows its asset panel below the lists (DocAssetStore.settingsPanel,
// the same AssetPanel as the popup's); a click on it again, or a pointer
// going down outside the area, closes it.
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
      {usageIndex.status === 'error' ? <p className="doc-error doc-edit-message">{usageIndex.message}</p> : null}
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
          {navigateMessage ? <p className="doc-error doc-edit-message">{navigateMessage}</p> : null}
        </>
      ) : null}
      {usageIndex.status === 'loading' || usageIndex.status === 'idle' ? (
        <p className="doc-settings-asset-note"><LoaderCircle size={11} className="doc-spin" aria-hidden="true" /> reading the documents</p>
      ) : null}
      {settingsPanel ? (
        <div className="doc-settings-asset-detail">
          <AssetPanel panel={settingsPanel} onNavigate={() => configStore.settingsOpenSet(false)} />
        </div>
      ) : null}
    </div>
  );
});
