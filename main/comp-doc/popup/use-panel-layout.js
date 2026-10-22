import { useEffect } from 'react';
import { useDocStores } from '../../frontend/src/store/context.js';

// The place and size of a dialog framed by the host's panel component, kept
// by DocPanelLayoutStore (doc_page_impl.md#the-panel-contract). A dialog
// that lets its panel be moved or resized calls this in its (observer)
// component with an id of its own, spreads `config` into the panel's config
// and lets `eventHandle` answer the panel's events first:
//
//   const panelLayout = usePanelLayout('paste', isOpen, { isMovable: true, isResizable: true, isSizeRemembered: true });
//   <Panel config={{ isPopup: true, ...panelLayout.config }}
//     onEvent={(type, data) => { if (panelLayout.eventHandle(type, data)) return; ... }} />
//
// when the dialog closes, the panel's place is forgotten (it opens centered
// again); a remembered size stays.
export function usePanelLayout(panelId, isOpen, option = {}) {
  const { panelLayoutStore } = useDocStores();

  useEffect(() => {
    if (!isOpen || !panelLayoutStore) return undefined;
    return () => panelLayoutStore.panelClose(panelId);
  }, [isOpen, panelLayoutStore, panelId]);

  return {
    config: panelLayoutStore ? panelLayoutStore.configGet(panelId, option) : {},
    eventHandle: (eventType, eventData) => (
      panelLayoutStore ? panelLayoutStore.eventHandle(panelId, eventType, eventData, option) : false
    ),
  };
}
