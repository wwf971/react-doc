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
// doc_page_impl_asset.md#the-local-store-folders-fully-reflected): the
// folders of the local store, by doc page. Every doc page the page loads
// (its own first, then the ones it includes) names its asset folders in its
// asset store config (.doc-page/asset.yaml beside its entry), as source
// paths; a doc page without that file uses its default folder. For each
// doc page a ConfigPanel (the injected one) shows its folders as a string
// list and its default folder; a change is written into that doc page's
// file in place by the development server, which creates the file when the
// doc page has none yet. A path that is not a folder of a root, or a folder
// that does not exist yet, gets a warning while it is typed. Below the
// folders: the orphan objects, the objects nothing references and the
// broken references (AssetOrphanArea). A built page lists and changes
// nothing. Rendered by the settings panel's ConfigPanel as a custom
// full-width item; it reads the stores itself.
export const AssetStoreSettings = observer(function AssetStoreSettings() {
  const { assetStore } = useDocStores();
  if (!assetStore.isAvailable) {
    return <p className="doc-settings-asset-note">{assetStore.unavailableReason || 'The asset service layer is loading.'}</p>;
  }
  return (
    <div className="doc-settings-asset">
      <p className="doc-settings-asset-note">
        The asset folders of each doc page, named by source path (~rootId/path). A new object goes to the default folder of the doc page of its document.
        {assetStore.isWritable ? '' : ' This build cannot change them.'}
      </p>
      {assetStore.docPageList.map((docPage, index) => (
        <DocPageFolderPanel key={docPage.entryFile} docPage={docPage} isPageOwn={index === 0} />
      ))}
      {assetStore.folder.status === 'error' ? (
        <p className="doc-error doc-edit-message">
          {assetStore.folder.message}
          <button type="button" className="doc-settings-asset-link" onClick={() => assetStore.folderMessageClear()}>dismiss</button>
        </p>
      ) : null}
      <AssetOrphanArea />
    </div>
  );
});

// the folders of one doc page as config items: a string list (each path
// with a warning slot) and the default folder, then what is on disk
const DocPageFolderPanel = observer(function DocPageFolderPanel({ docPage, isPageOwn }) {
  const { assetStore, componentConfig } = useDocStores();
  const ConfigPanel = componentConfig.ConfigPanel;
  const rootIdList = [...new Set(assetStore.docPageList.flatMap((item) => item.rootIdList))];
  const isLocked = !assetStore.isWritable || assetStore.folder.status === 'submitting';
  const folderInfoList = assetStore.folderListOfDocPageGet(docPage.entryFile);
  const source = docPage.isConfigFileExists
    ? docPage.configFileRelative
    : `no ${docPage.configFileRelative}: the default folder (created with the file on the first change)`;
  const itemList = [{
    id: `assetDocPage:${docPage.entryFile}`,
    type: 'group',
    label: `${docPage.entryFile}${isPageOwn ? ' (this page)' : ' (included)'}`,
    children: [
      {
        id: 'folderList',
        type: 'stringList',
        label: 'Folders',
        description: source,
        placeholder: '~rootId/path',
        valueWarningGet: (text) => assetStore.folderPathWarningGet(text, rootIdList),
        isDisabled: isLocked,
        disabledReason: assetStore.isWritable ? 'a change is being written' : assetStore.writeUnavailableReason,
      },
      {
        id: 'folderDefault',
        type: 'select',
        label: 'Default folder',
        description: 'new objects of the documents of this doc page are created here',
        options: docPage.folderList,
        isDisabled: isLocked || docPage.folderList.length < 2,
        disabledReason: docPage.folderList.length < 2 ? 'the only folder is the default' : 'a change is being written',
      },
      {
        id: 'folderState',
        type: 'custom',
        comp: FolderStateList,
        isFullWidth: true,
        compProps: { folderInfoList, problemList: docPage.problemList },
      },
    ],
  }];
  if (!ConfigPanel) return null;
  return (
    <ConfigPanel
      data={{ folderList: docPage.folderList, folderDefault: docPage.folderDefault }}
      config={{ compPath: ['assetDocPage', docPage.entryFile], items: itemList, missingItemStrategy: 'ignore' }}
      onEvent={(eventType, eventData) => {
        if (eventType !== 'valueChangeAttempt') return undefined;
        const folderList = eventData.valueId === 'folderList' ? eventData.value : docPage.folderList;
        const folderDefault = eventData.valueId === 'folderDefault' ? eventData.value : docPage.folderDefault;
        void assetStore.docPageFolderSet(docPage.configFileRelative, folderList, folderDefault);
        return { code: 0 };
      }}
    />
  );
});

// each folder of a doc page as it is on disk: its object count, missing
// ones marked; then what was wrong with the doc page's config
function FolderStateList({ folderInfoList, problemList }) {
  return (
    <ul className="doc-settings-asset-list">
      {folderInfoList.map((folder) => (
        <li key={folder.path} className="doc-settings-asset-folder" data-missing={folder.isExists ? undefined : ''}>
          <span className="doc-settings-asset-path" title={folder.pathAbs}>{folder.path}</span>
          <span className="doc-settings-asset-flags">
            {folder.isDefault ? <span className="doc-badge-outline" data-primary="">store default</span> : null}
            {folder.isExists ? null : <span className="doc-badge-outline" data-error="">missing</span>}
          </span>
          <span className="doc-settings-asset-count">{folder.objectCount} object{folder.objectCount === 1 ? '' : 's'}</span>
          <span />
        </li>
      ))}
      {problemList.map((problem) => (
        <li key={problem} className="doc-settings-asset-folder doc-settings-asset-problem">
          <span className="doc-error">{problem}</span>
        </li>
      ))}
    </ul>
  );
}

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
            ? <LoaderCircle size={11} className="doc-spin" aria-hidden="true" />
            : <RotateCw size={11} aria-hidden="true" />}
        </button>
      </p>
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
