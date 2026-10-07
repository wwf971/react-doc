import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { History, LoaderCircle } from '../../frontend/UICommon.js';
import { useAssetPanelIsAvailable } from './AssetPanelPopup.jsx';
import './DocAsset.css';

// The title line above a component whose data comes from the asset store:
// the component name, the object (its name, or its id), the version the
// document reads and whether that is the head, and at the right end the
// button that opens the asset panel for this object. The component itself
// renders below, unaware of the frame. Switched off with the page config
// AssetFrameIsOn; a reference that cannot be resolved shows its message in
// the frame's place whatever the config says.
//
//   label      the component name
//   reference  { objectId, versionId } as written in the document
//   result     what the reference resolves to (DocAssetStore.refQuery)
//   raw        the reference yaml, shown with an error
//   message    an error of the reference (not shown while loading)
//   children   the component, when the reference is resolved
export const AssetFrame = observer(function AssetFrame({ label, reference, result, raw, message, children }) {
  const { assetStore, configStore } = useDocStores();
  const isFrameOn = configStore.valueGlobalGet('AssetFrameIsOn') !== false;
  const isPanelAvailable = useAssetPanelIsAvailable();
  const object = result?.object;
  const isLoading = !message && result?.status === 'loading';

  if (message) {
    return (
      <div className="doc-asset-frame not-prose" data-error="">
        <div className="doc-asset-frame-title">
          <span className="doc-asset-frame-label">{label}</span>
          <span className="doc-asset-frame-object">{reference.objectId || '(no objectId)'}</span>
        </div>
        <p className="doc-asset-frame-message">{message}</p>
        {raw ? <pre className="doc-asset-frame-raw">{raw}</pre> : null}
      </div>
    );
  }

  if (!isFrameOn && !isLoading) return children;

  const versionIdRead = result?.versionId ?? '';
  const isHeadRead = reference.versionId === 'head';
  const isAtHead = Boolean(object) && versionIdRead === object.versionIdHead;
  const versionText = isLoading && !versionIdRead
    ? ''
    : `${isHeadRead ? 'head' : 'version'} ${versionIdRead}${!isHeadRead && isAtHead ? ' (head)' : ''}`;
  return (
    <div className="doc-asset-frame" data-loading={isLoading ? '' : undefined}>
      <div className="doc-asset-frame-title not-prose">
        <span className="doc-asset-frame-label">{label}</span>
        <span className="doc-asset-frame-object" title={reference.objectId}>
          {object?.name || reference.objectId}
        </span>
        {versionText ? <span className="doc-asset-frame-version">{versionText}</span> : null}
        {isLoading ? <LoaderCircle size={12} className="doc-edit-spin" aria-label="loading" /> : null}
        {object?.isDeleted ? <span className="doc-asset-frame-flag">deleted</span> : null}
        <span className="doc-asset-frame-actions">
          {isPanelAvailable && object ? (
            <button
              type="button"
              className="doc-asset-frame-button"
              title="Asset: versions and history"
              onClick={() => assetStore.panelOpen(reference.objectId, reference.versionId)}
            >
              <History size={12} aria-hidden="true" />
              <span>asset</span>
            </button>
          ) : null}
        </span>
      </div>
      {children}
    </div>
  );
});
