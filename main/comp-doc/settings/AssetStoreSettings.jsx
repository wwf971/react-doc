import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LoaderCircle, RotateCw } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ASSET_STORE_ID_LOCAL } from '../../frontend/src/lib/doc-asset-ref.js';
import { docPlaceTargetGet } from '../../frontend/src/lib/doc-place.js';
import { useEditOutsidePointer } from '../edit/use-edit-outside-pointer.js';
import { AssetPanel } from '../asset/AssetPanel.jsx';
import { AssetItemTable } from '../asset/AssetItemTable.jsx';
import { AssetUsageTable } from '../asset/AssetUsageTable.jsx';
import { AuthSessionLine } from '../auth/AuthSessionLine.jsx';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import '../edit/DocEdit.css';
import { timeTextDisplay } from '../../frontend/src/lib/time-text.js';
import { clientInstanceIdShortText } from '../../frontend/src/lib/doc-client-instance.js';
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
//   Storage points                                 group: AssetStoragePointArea, the points the store
//                                                  keeps its items at, their types, and the partitions
//                                                  bound to one (doc_page_impl_asset_storage.md)
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
    id: 'assetStorage',
    type: 'group',
    label: 'Storage points',
    description: 'where the store keeps the bytes of its items: the built-in points, and those asset-storage.yaml of the workspace or of a doc page declares',
    children: [{ id: 'assetStoragePoint', type: 'custom', comp: AssetStoragePointArea, isFullWidth: true }],
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

const STORAGE_POINT_STATUS_TEXT = { ready: 'ready', disabled: 'disabled', typeUnknown: 'unknown type', typeNotImplemented: 'contract only', configInvalid: 'config incomplete' };

// what the page read of a partition a storage point of the page holds
const REMOTE_STATUS_TEXT = {
  idle: 'not read', loading: 'reading', ready: 'read', absent: 'not at the point yet', authRequired: 'signed out',
  forbidden: 'not allowed', unreachable: 'out of reach', error: 'failed',
};

// the channel of a point telling the page of changes (the api set notify), and what the page did
// with each notification
const NOTIFY_STATUS_TEXT = {
  off: 'off', connecting: 'opening', open: 'open', waiting: 'opening again', unsupported: 'not offered',
  refused: 'refused', closed: 'closed', error: 'failed',
};
const NOTIFY_HANDLING_TEXT = { self: 'its own: nothing read', known: 'held already', read: 'read again', notHeld: 'not read by this page' };
const NOTIFY_LOG_SHOWN_MAX = 8;

// the placement a storage type's own panel is rendered in (panelComp of its declaration)
export const ASSET_STORAGE_POINT_PLACEMENT = 'assetStoragePoint';

function timeAgoTextGet(time) {
  if (!time) return 'never';
  const second = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (second < 60) return `${second} s ago`;
  if (second < 3600) return `${Math.round(second / 60)} min ago`;
  if (second < 86400) return `${Math.round(second / 3600)} h ago`;
  return timeTextDisplay(time, { part: 'date' });
}

function sizeTextGet(size) {
  if (!Number.isFinite(size) || size <= 0) return '0';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

// the storage points of the page (asset storage service layer, doc_page_impl_asset_storage.md):
//
//   point       type        declared by            state     holds
//   file-tree   File tree   built in               ready     every asset folder, 3 partitions
//   file-pack   File pack   built in               ready     1 partition
//   team        Remote      example · asset-…yaml  contract only
//
//   partitions bound to a point: object, partition, point, items, size, dead, [Compact]
//   storage types: what each promises (its api sets), where its bytes are, whether a search finds them
const AssetStoragePointArea = observer(function AssetStoragePointArea() {
  const { assetStore, objectFrontendStore, assetRemoteStore } = useDocStores();
  const { typeList, apiSetList, pointList, fileList } = assetStore.storage;
  const partitionList = assetStore.folderList.flatMap((folder) => (folder.partitionList ?? []).map((partition) => ({ ...partition, ownerRef: folder.owner?.ref ?? '', folderPath: folder.path })));
  const folderOwnedCount = assetStore.folderList.filter((folder) => folder.owner).length;
  const folderPlainCount = assetStore.folderList.length - folderOwnedCount;
  const holdTextGet = (point) => {
    const count = partitionList.filter((one) => one.pointId === point.id).length;
    if (point.id !== 'file-tree') return point.status === 'ready' ? `${count} partition${count === 1 ? '' : 's'}` : '—';
    return `${folderPlainCount} folder${folderPlainCount === 1 ? '' : 's'}, ${folderOwnedCount} object${folderOwnedCount === 1 ? '' : 's'}`;
  };
  const apiSetLabelGet = (id) => apiSetList.find((one) => one.id === id)?.label ?? id;
  const isWriting = objectFrontendStore?.write.status === 'submitting';
  const problemFileList = fileList.filter((file) => file.problemList.length > 0);
  return (
    <div className="doc-settings-asset-storage">
      <div className="doc-asset-table-scroll">
        <table className="doc-asset-table">
          <thead><tr><th>point</th><th>type</th><th>declared by</th><th>state</th><th>holds</th></tr></thead>
          <tbody>
            {pointList.map((point) => (
              <tr key={`${point.scope}:${point.docPageAlias}:${point.id}`}>
                <td title={point.description}>{point.id}{point.label && point.label !== point.id ? <span className="doc-asset-muted"> {point.label}</span> : null}</td>
                <td>{assetStore.storageTypeGet(point.typeId)?.label ?? point.typeId}</td>
                <td className="doc-asset-muted" title={point.file}>{point.scope === 'builtIn' ? 'built in' : point.scope === 'workspace' ? 'workspace' : `doc page ${point.docPageAlias}`}</td>
                <td title={point.statusMessage}>
                  <span className="doc-badge-outline" data-primary={point.status === 'ready' ? '' : undefined}>{STORAGE_POINT_STATUS_TEXT[point.status] ?? point.status}</span>
                </td>
                <td className="doc-asset-muted" title={point.id === 'file-tree' ? 'every asset folder, and every partition of an object not bound to another point' : 'the partitions bound to it'}>{holdTextGet(point)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {problemFileList.map((file) => (
        <p key={file.file} className="doc-settings-tab-issue">{file.file}: {file.problemList.join('; ')}</p>
      ))}

      <AssetStorageRemoteArea />

      <h4>Partitions bound to a point ({partitionList.length})</h4>
      {partitionList.length === 0 ? (
        <p className="doc-note">
          No partition names a storage point, so file-tree holds every one. A partition is bound in the Frontend objects tab (its row, Storage…),
          or by its type (storagePoint of partitionList).
        </p>
      ) : (
        <div className="doc-asset-table-scroll">
          <table className="doc-asset-table">
            <thead>
              <tr>
                <th>object</th><th>partition</th><th>point</th><th className="doc-asset-version-size">items</th>
                <th className="doc-asset-version-size">size</th><th className="doc-asset-version-size">dead</th><th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {partitionList.map((partition) => {
                const id = partition.ownerRef.replace(/^frontend:/, '');
                const isMixed = partition.typeIdFoundList.length > 1;
                return (
                  <tr key={`${partition.folderPath}/${partition.partition}`}>
                    <td title={partition.folderPath}>{objectFrontendStore?.objectGet(id)?.name || partition.ownerRef}</td>
                    <td>item/{partition.partition}/</td>
                    <td>
                      {partition.pointId}
                      {partition.pointIdClaimed ? <span className="doc-settings-tab-issue"> gone, read through {partition.pointIdClaimed}</span> : null}
                      {partition.unavailableReason ? <span className="doc-settings-tab-issue" title={partition.unavailableReason}> cannot be used</span> : null}
                      {isMixed ? <span className="doc-settings-tab-issue" title="a change of storage was interrupted: remove the data of the type the partition is not bound to"> also holds {partition.typeIdFoundList.filter((one) => one !== partition.typeId).join(', ')} data</span> : null}
                    </td>
                    <td className="doc-asset-muted doc-asset-version-size" title={partition.driverPlace === 'page' ? 'as the page read them from the storage point' : undefined}>
                      {partition.driverPlace === 'page' ? assetRemoteStore?.partitionGet(partition.ownerRef, partition.partition)?.itemList.length ?? '—' : partition.itemCount}
                    </td>
                    <td className="doc-asset-muted doc-asset-version-size" title={partition.fileList.map((file) => `${file.name} ${sizeTextGet(file.size)}`).join('\n')}>{partition.size ? sizeTextGet(partition.size) : '—'}</td>
                    <td className="doc-asset-muted doc-asset-version-size">{partition.size ? sizeTextGet(partition.sizeDead) : '—'}</td>
                    <td className="doc-settings-tab-actions">
                      {assetStore.isWritable && partition.sizeDead > 0 && id ? (
                        <button
                          type="button"
                          className="doc-button"
                          disabled={isWriting}
                          title="write its pack files again without what no item reads any more"
                          onClick={() => void objectFrontendStore.partitionCompact(id, partition.partition)}
                        >
                          Compact
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h4>Storage types</h4>
      <div className="doc-asset-table-scroll">
        <table className="doc-asset-table">
          <thead><tr><th>type</th><th>promises</th><th>content</th><th>state</th></tr></thead>
          <tbody>
            {typeList.filter((type) => !type.isAbstract).map((type) => (
              <tr key={type.id}>
                <td title={type.description}>{type.id}{type.extends && type.extends !== 'storage' ? <span className="doc-asset-muted"> extends {type.extends}</span> : null}</td>
                <td className="doc-settings-asset-storage-wrap">{assetStore.storageTypeApiSetListGet(type.id).map(apiSetLabelGet).join(' · ')}</td>
                <td className="doc-asset-muted" title={type.isContentSearchable ? 'a search of the disk finds the content of its items' : 'a search of the disk does not find the content of its items'}>
                  {type.place === 'remote' ? 'remote' : type.isContentSearchable ? 'local, plain files' : 'local, opaque'}
                </td>
                <td><span className="doc-badge-outline" data-primary={type.isImplemented ? '' : undefined}>{type.isImplemented ? 'implemented' : 'contract only'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

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

// the storage points whose driver runs in the page (doc_page_impl_asset_storage.md#points-of-the-page):
// a backend the page reaches itself. per point: who is signed in to it, whether it answers, what
// the browser keeps of it, the partitions it holds for the objects of the page, and what is its
// type's own (the panel its type brings)
const AssetStorageRemoteArea = observer(function AssetStorageRemoteArea() {
  const { assetRemoteStore } = useDocStores();
  const pointList = assetRemoteStore?.pointList ?? [];
  if (pointList.length === 0) return null;
  return (
    <>
      <h4>Points the page reaches itself ({pointList.length})</h4>
      <p className="doc-note">
        A point of a remote type is asked by the page, not by the development server, so it works on a built page too. What was read is kept in this
        browser: shown at once the next time, and checked against the point.
      </p>
      {pointList.map((point) => <AssetStorageRemotePoint key={`${point.scope}:${point.docPageAlias}:${point.id}`} point={point} />)}
    </>
  );
});

const AssetStorageRemotePoint = observer(function AssetStorageRemotePoint({ point }) {
  const { assetStore, assetRemoteStore, objectFrontendStore } = useDocStores();
  const pointState = assetRemoteStore.pointStateGet(point.id);
  const providerRef = assetRemoteStore.providerRefOfPointGet(point);
  const reason = assetRemoteStore.pointUnavailableReasonGet(point);
  const type = assetStore.storageTypeGet(point.typeId);
  const cacheInfo = assetRemoteStore.cacheInfoByPointId.get(point.id);
  const partitionList = [...assetRemoteStore.partitionByKey.values()].filter((one) => one.pointId === point.id);
  const isRefreshing = partitionList.some((one) => one.isRefreshing || one.status === 'loading');
  // the point is asked what it is when the tab shows it, and again when another person signs in
  const authState = reason.code === 0 ? 'signedIn' : String(reason.code);
  useEffect(() => {
    if (point.status !== 'ready') return;
    void assetRemoteStore.pointCheck(point.id, point.docPageAlias);
    void assetRemoteStore.cacheInfoLoad(point.id, point.docPageAlias);
  }, [assetRemoteStore, point.id, point.docPageAlias, point.status, authState]);
  const serviceText = pointState.status === 'checking' ? 'asking'
    : pointState.status === 'ready' ? `answers${pointState.service?.contractVersion ? ` · contract ${pointState.service.contractVersion}` : ''}${pointState.message ? ` · ${pointState.message}` : ''}`
      : pointState.status === 'idle' ? 'not asked yet' : pointState.message;
  return (
    <div className="doc-settings-remote-point">
      <div className="doc-settings-remote-point-title">
        <span>{point.label || point.id}</span>
        <span className="doc-asset-muted">{point.id} · {type?.label ?? point.typeId}</span>
      </div>
      <div className="doc-asset-fields">
        <span className="doc-asset-muted">reached at</span>
        <span className="doc-settings-remote-point-url">{String(point.config?.url ?? '—')}</span>
        <span className="doc-asset-muted">signed by</span>
        <span className="doc-settings-remote-point-row">
          {providerRef ? <AuthSessionLine providerRef={providerRef} reason={`The storage point ${point.label || point.id} is read and written as the person signed in.`} /> : <span className="doc-settings-tab-issue">no auth provider named (auth: {'{ provider: frontend:{id} }'})</span>}
        </span>
        <span className="doc-asset-muted">service</span>
        <span className="doc-settings-remote-point-row">
          <span {...(pointState.status === 'unreachable' || pointState.status === 'error' ? { className: 'doc-settings-tab-issue' } : {})}>{point.status === 'ready' ? serviceText : point.statusMessage}</span>
          <button type="button" className="doc-button" disabled={point.status !== 'ready' || pointState.status === 'checking'} title="ask the point what it is and who the session is to it" onClick={() => void assetRemoteStore.pointCheck(point.id, point.docPageAlias)}>Check</button>
        </span>
        <span className="doc-asset-muted">cache</span>
        <span className="doc-settings-remote-point-row">
          <span title={`cacheMode ${cacheInfo?.mode ?? '—'}: readThrough shows the cache and checks it against the point, pinned trusts it until a refresh, none keeps nothing`}>
            {cacheInfo
              ? `${cacheInfo.mode} · ${cacheInfo.partitionCount} partition(s), ${cacheInfo.versionCount} version(s), ${sizeTextGet(cacheInfo.size)} in this browser · fetched ${timeAgoTextGet(cacheInfo.timeFetchedLast)}`
              : 'not counted yet'}
          </span>
          <button type="button" className="doc-button" disabled={reason.code !== 0 || isRefreshing} title="ask the point whether its partitions changed, and read what did" onClick={() => void assetRemoteStore.pointRefresh(point.id).then(() => assetRemoteStore.cacheInfoLoad(point.id, point.docPageAlias))}>
            {isRefreshing ? 'Reading' : 'Refresh'}
          </button>
          <button type="button" className="doc-button" title="drop what this browser keeps of the point, and read it again" onClick={() => void assetRemoteStore.cacheClear(point.id)}>Clear</button>
        </span>
        <span className="doc-asset-muted">changes</span>
        <AssetStorageNotifyLine point={point} />
      </div>
      {partitionList.length > 0 ? (
        <div className="doc-asset-table-scroll">
          <table className="doc-asset-table">
            <thead><tr><th>object</th><th>partition</th><th>state</th><th className="doc-asset-version-size">items</th><th className="doc-asset-version-size">revision</th><th>fetched</th></tr></thead>
            <tbody>
              {partitionList.map((partition) => (
                <tr key={partition.key}>
                  <td title={partition.ownerRef}>{objectFrontendStore?.objectGet(partition.ownerRef)?.name || partition.ownerRef}</td>
                  <td>item/{partition.partition}/</td>
                  <td title={partition.message}>
                    <span className="doc-badge-outline" {...(partition.status === 'ready' && !partition.isFromCache ? { 'data-primary': true } : {})} {...(partition.status === 'forbidden' || partition.status === 'error' ? { 'data-error': true } : {})}>
                      {REMOTE_STATUS_TEXT[partition.status] ?? partition.status}{partition.status === 'ready' && partition.isFromCache ? ', from the cache' : ''}
                    </span>
                  </td>
                  <td className="doc-asset-muted doc-asset-version-size">{partition.status === 'ready' ? partition.itemList.length : '—'}</td>
                  <td className="doc-asset-muted doc-asset-version-size">{partition.status === 'ready' ? partition.revision : '—'}</td>
                  <td className="doc-asset-muted">{partition.status === 'ready' ? timeAgoTextGet(partition.timeFetched) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="doc-note">No partition of an object of this page is bound to it. A partition is bound in the Frontend objects tab (its row, Storage…), or by its type (storagePoint of partitionList).</p>
      )}
      <AssetStorageNotifyLog point={point} />
      {type?.panelComp && point.status === 'ready' ? (
        <RegisteredComp compName={type.panelComp} placement={ASSET_STORAGE_POINT_PLACEMENT} input={{ data: { pointId: point.id, docPageAlias: point.docPageAlias } }} />
      ) : null}
    </div>
  );
});

// how the page learns of changes made elsewhere: asked (a page start, a refresh), or told over the
// channel of the point (isNotifyEnabled), with the id this tab names itself with
const AssetStorageNotifyLine = observer(function AssetStorageNotifyLine({ point }) {
  const { assetRemoteStore } = useDocStores();
  if (point.config?.isNotifyEnabled !== true) {
    return <span className="doc-asset-muted" title="config.isNotifyEnabled of the point turns notifications on, where its backend offers them">asked at a page start and by Refresh; not told (notifications off)</span>;
  }
  const notify = assetRemoteStore.notifyStateGet(point.id);
  const isFailed = notify.status === 'unsupported' || notify.status === 'refused' || notify.status === 'error';
  return (
    <span className="doc-settings-remote-point-row">
      <span className="doc-badge-outline" {...(notify.status === 'open' ? { 'data-primary': true } : {})} {...(isFailed ? { 'data-error': true } : {})}>
        told · {NOTIFY_STATUS_TEXT[notify.status] ?? notify.status}
      </span>
      {notify.message ? <span className={isFailed ? 'doc-settings-tab-issue' : 'doc-asset-muted'}>{notify.message}</span> : null}
      {notify.status === 'open' ? <span className="doc-asset-muted">since {timeTextDisplay(notify.timeOpened, { part: 'second', isYearShown: false })} · {notify.countReceived} told</span> : null}
      <span className="doc-asset-muted" title={`the client instance id of this tab: ${assetRemoteStore.clientInstanceId}. a change it made is told back with this id, and not read again`}>
        this tab: {clientInstanceIdShortText(assetRemoteStore.clientInstanceId)}
      </span>
    </span>
  );
});

// the last notifications of a point: what changed, who changed it (this tab, or another tab,
// device or program), and what the page did
const AssetStorageNotifyLog = observer(function AssetStorageNotifyLog({ point }) {
  const { assetRemoteStore, objectFrontendStore } = useDocStores();
  if (point.config?.isNotifyEnabled !== true) return null;
  const logList = assetRemoteStore.notifyStateGet(point.id).logList.slice(0, NOTIFY_LOG_SHOWN_MAX);
  if (logList.length === 0) return null;
  return (
    <div className="doc-asset-table-scroll">
      <table className="doc-asset-table">
        <thead><tr><th>told</th><th>change</th><th>partition</th><th className="doc-asset-version-size">revision</th><th>by</th><th>the page</th></tr></thead>
        <tbody>
          {logList.map((entry, index) => {
            const partition = entry.partitionKey ? assetRemoteStore.partitionByKey.get(entry.partitionKey) : undefined;
            const objectName = partition ? objectFrontendStore?.objectGet(partition.ownerRef)?.name : '';
            return (
              <tr key={`${entry.timeReceived}:${index}`}>
                <td className="doc-asset-muted">{timeTextDisplay(entry.time || entry.timeReceived, { part: 'second', isYearShown: false })}</td>
                <td>{entry.event}</td>
                <td title={entry.partitionId}>{entry.partition ? `${objectName ? `${objectName} · ` : ''}${entry.partition}` : '—'}</td>
                <td className="doc-asset-muted doc-asset-version-size">{entry.revision || '—'}</td>
                <td title={`user ${entry.actor.userId || '—'} · client instance ${entry.actor.clientInstanceId || 'none named'}`}>
                  {entry.isSelf ? 'this tab' : entry.actor.clientInstanceId ? `elsewhere (${clientInstanceIdShortText(entry.actor.clientInstanceId)})` : 'a program'}
                </td>
                <td className="doc-asset-muted">{NOTIFY_HANDLING_TEXT[entry.handling] ?? entry.handling}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
