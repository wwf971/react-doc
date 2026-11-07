import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LoaderCircle, RotateCw } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ASSET_STORE_ID_LOCAL } from '../../frontend/src/lib/doc-asset-ref.js';
import { docPlaceTargetGet } from '../../frontend/src/lib/doc-place.js';
import { useEditOutsidePointer } from '../edit/use-edit-outside-pointer.js';
import { AssetPanel } from '../asset/AssetPanel.jsx';
import { AssetItemTable } from '../asset/AssetItemTable.jsx';
import { AssetUsageTable } from '../asset/AssetUsageTable.jsx';
import '../edit/DocEdit.css';
import './DocSettings.css';

// The "Asset service" tab of the settings panel (asset service layer) (design:
// doc_page_impl_asset.md#the-local-store-folders-fully-reflected), built as
// items of the settings panel's ConfigPanel, so it reads like the other tabs:
//
//   example_doc [this page]                          group, one per doc page
//   folders in .doc-page/asset.yaml                  (its own first, then the
//     Folders          [~example/.doc-page/asset   ] Remove    ones it includes)
//                      [~root/path       ] Add       stringList
//     Default folder   [~example/.doc-page/asset ▾]            select
//     On disk          ~example/.doc-page/asset  store default  13 items
//   Items and references ⟳                         group: AssetOrphanArea
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
          description: 'where its new items go',
          options: docPage.folderList,
          isDisabled: isLocked || docPage.folderList.length < 2,
          disabledReason: docPage.folderList.length < 2 ? 'the only folder is the default' : lockedReason,
        },
        {
          id: `${groupId}OnDisk`,
          type: 'custom',
          label: 'On disk',
          description: 'items per folder',
          comp: DocPageFolderState,
          compProps: { entryFile: docPage.entryFile, problemList: docPage.problemList },
        },
      ],
    };
  });
  itemList.push({
    id: 'assetItems',
    type: 'group',
    label: <AssetItemsGroupLabel />,
    description: 'items nothing uses, and references whose data cannot be read',
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

// how many items a folder holds: from the index once it is read, so it follows a move
const AssetFolderCount = observer(function AssetFolderCount({ folder }) {
  const { assetStore } = useDocStores();
  const count = assetStore.index.status === 'done' ? assetStore.folderItemListGet(folder.path).length : folder.itemCount;
  return <span className="doc-settings-asset-count">{count} item{count === 1 ? '' : 's'}</span>;
});

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
//   ~example/.doc-page/asset  [store default]  13 items
//   ~example/.doc-page/asset-archive           1 item
const DocPageFolderState = observer(function DocPageFolderState({ entryFile, problemList }) {
  const { assetStore } = useDocStores();
  return (
    <div className="doc-settings-asset-state">
      {assetStore.folderListOfDocPageGet(entryFile).map((folder) => (
        <span key={folder.path} className="doc-settings-asset-state-folder" title={folder.pathAbs}>
          {/* the item folder of an object is known by the folder of its object: the rest of the path is the same for all */}
          <span className="doc-settings-asset-path">{folder.owner ? folder.path.split('/').slice(-2).join('/') : folder.path}</span>
          {folder.isDefault ? <span className="doc-badge-outline" data-primary="">store default</span> : null}
          {folder.owner ? <span className="doc-badge-outline" title={`A folder owned by ${folder.owner.ref}: found through its object, no asset.yaml names it`}>of a frontend object</span> : null}
          {folder.isExists ? null : <span className="doc-badge-outline" data-error="">not on disk</span>}
          {folder.isReadOnly ? <span className="doc-badge-outline" title="The folder of a package treated as a doc page: the store refuses every write to it">read-only</span> : null}
          <AssetFolderCount folder={folder} />
        </span>
      ))}
      {problemList.map((problem) => <span key={problem} className="doc-error doc-settings-asset-problem">{problem}</span>)}
    </div>
  );
});

// the group title of the items: "Read again" reads every document again,
// for what changed while the page did not watch
const AssetItemsGroupLabel = observer(function AssetItemsGroupLabel() {
  const { assetStore } = useDocStores();
  return (
    <span className="doc-settings-asset-group-label">
      Items and references
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
// (doc_page_impl_asset.md#usage): items declared as a component's data
// that no block references (orphans), items no block references that
// declare nothing (data of another purpose, or from before the
// declaration), and references whose data cannot be read. a click on an
// item shows its asset panel below the lists (DocAssetStore.settingsPanel,
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
  const itemIdSelected = settingsPanel?.itemId ?? '';
  const itemSelect = (itemId) => assetStore.settingsPanelToggle(ASSET_STORE_ID_LOCAL, itemId);
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
            Orphans: items that declare a component no block uses them for (a block removed without its data, or changed outside the page).
          </p>
          {assetStore.orphanItemList.length > 0
            ? <AssetItemTable itemList={assetStore.orphanItemList} itemIdSelected={itemIdSelected} onSelect={itemSelect} />
            : <p className="doc-settings-asset-note">None.</p>}
          <p className="doc-settings-asset-note">
            Not referenced: items no block uses that declare no component; they may serve another purpose.
          </p>
          {assetStore.unreferencedItemList.length > 0
            ? <AssetItemTable itemList={assetStore.unreferencedItemList} itemIdSelected={itemIdSelected} onSelect={itemSelect} />
            : <p className="doc-settings-asset-note">None.</p>}
          <p className="doc-settings-asset-note">Broken references: blocks whose asset data cannot be read.</p>
          {brokenList.length > 0 ? (
            <AssetUsageTable
              usageList={brokenList}
              isItemShown
              docPathRefreshing={undefined}
              onDocRefresh={(docPath) => void assetStore.usageDocListRead([docPath])}
              onNavigate={usageNavigate}
            />
          ) : <p className="doc-settings-asset-note">None.</p>}
          {navigateMessage ? <p className="doc-error doc-edit-message">{navigateMessage}</p> : null}
          <p className="doc-settings-asset-note">
            The items of a folder: choose one to see where it lies and to move it. The items of a frontend object move through that object.
          </p>
          <select
            className="doc-settings-asset-folder-select"
            aria-label="The folder whose items are listed"
            value={assetStore.settingsFolderPath}
            onChange={(event) => assetStore.settingsFolderSet(event.target.value)}
          >
            <option value="">(choose a folder)</option>
            {assetStore.folderList.map((folder) => <option key={folder.path} value={folder.path}>{folder.path}</option>)}
          </select>
          {assetStore.settingsFolderPath ? <AssetItemTable itemList={assetStore.folderItemListGet(assetStore.settingsFolderPath)} itemIdSelected={itemIdSelected} onSelect={itemSelect} /> : null}
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
