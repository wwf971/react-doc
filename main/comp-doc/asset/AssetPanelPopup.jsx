import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { PanelRightClose, PanelRightOpen } from '../../frontend/UICommon.js';
import { AssetPanel } from './AssetPanel.jsx';
import { AssetPreview } from './AssetPreview.jsx';
import './DocAsset.css';

// Popup with the asset panel of one object, opened from the toolbar of a
// component block whose data comes from the asset store. Open state lives
// in DocAssetStore (panel). The popup frame is the host's text panel
// component (config.compConfigHost.panelComponent), as for the tag
// overview; its content is AssetPanel and, when the preview pane is open,
// AssetPreview at its right. The side-panel button in the header (left of
// the close button; lucide PanelRightOpen, PanelRightClose while open)
// toggles the pane; the popup is wider while the pane is shown.
export const AssetPanelPopup = observer(function AssetPanelPopup() {
  const { assetStore, compConfigHost } = useDocStores();
  const Panel = compConfigHost.panelComponent;
  const panel = assetStore.panel;
  const isOpen = Boolean(Panel) && panel !== undefined;

  useEffect(() => {
    if (!isOpen) return undefined;
    const keyDownHandle = (event) => {
      if (event.key === 'Escape') assetStore.panelClose();
    };
    window.addEventListener('keydown', keyDownHandle);
    return () => window.removeEventListener('keydown', keyDownHandle);
  }, [isOpen, assetStore]);

  if (!isOpen) return null;
  const object = assetStore.objectGet(panel.store, panel.objectId);
  const isPreviewOpen = panel.isPreviewOpen;
  return (
    <Panel
      data={{ title: `Asset: ${object?.name || panel.objectId}` }}
      config={{
        isPopup: true,
        isCloseVisible: true,
        className: isPreviewOpen ? 'doc-asset-popup is-preview-open' : 'doc-asset-popup',
        bodyClassName: 'doc-asset-popup-body',
      }}
      headerRightContent={(
        <button
          type="button"
          title={isPreviewOpen ? 'Hide the preview' : 'Show the preview: what the data renders as'}
          aria-label={isPreviewOpen ? 'Hide the preview' : 'Show the preview'}
          aria-pressed={isPreviewOpen}
          onClick={() => assetStore.panelPreviewToggle()}
        >
          {isPreviewOpen ? <PanelRightClose size={16} aria-hidden="true" /> : <PanelRightOpen size={16} aria-hidden="true" />}
        </button>
      )}
      content={(
        <div className="doc-asset-popup-content">
          <div className="doc-asset-popup-main">
            <AssetPanel />
          </div>
          {isPreviewOpen ? <AssetPreview /> : null}
        </div>
      )}
      onEvent={(eventType) => {
        if (eventType === 'closeRequest') assetStore.panelClose();
      }}
    />
  );
});

// the asset button of a frame is shown only when the page has an asset
// store and the host supplies a panel component for the popup
export function useAssetPanelIsAvailable() {
  const { assetStore, compConfigHost } = useDocStores();
  return assetStore.isAvailable && Boolean(compConfigHost.panelComponent);
}
