import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { AssetPanel } from './AssetPanel.jsx';
import './DocAsset.css';

// Popup with the asset panel of one object, opened from the frame above a
// component whose data comes from the asset store. Open state lives in
// DocAssetStore (panel). The popup frame is the host's text panel
// component (config.compConfigHost.panelComponent), as for the tag
// overview; its content is AssetPanel.
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
  const object = assetStore.objectGet(panel.objectId);
  return (
    <Panel
      data={{ title: `Asset: ${object?.name || panel.objectId}` }}
      config={{
        isPopup: true,
        isCloseVisible: true,
        className: 'doc-asset-popup',
        bodyClassName: 'doc-asset-popup-body',
      }}
      content={<AssetPanel />}
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
