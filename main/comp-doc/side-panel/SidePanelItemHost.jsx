import { createContext, useContext } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { useTagOverviewIsAvailable } from '../tag/TagOverviewPopup.jsx';

// Where a side-panel item label is being displayed. fumadocs reuses the
// page-tree name in breadcrumbs and previous/next cards, so those surfaces
// provide their own value; everything else is the side panel.
export const SidePanelItemSurfaceContext = createContext('sidebar');

// Runtime boundary of every side-panel item label: resolves the item's tags
// from the tag service, adds page-level config, and renders the chosen
// registry component with placement sidePanelDisplay.
export const SidePanelItemHost = observer(function SidePanelItemHost({
  assetKey,
  compName,
  data,
  itemId,
}) {
  const { configStore, tagStore } = useDocStores();
  const surface = useContext(SidePanelItemSurfaceContext);
  const isTagOverviewAvailable = useTagOverviewIsAvailable();
  return (
    <RegisteredComp
      compName={compName}
      configRuntime={{
        assetKey,
        configGlobal: configStore.configGlobal,
        configService: configStore.configService,
        instanceId: `side-panel-display:${itemId}`,
        isTagOverviewAvailable,
        itemId,
        surface,
        tagService: tagStore.tagService,
      }}
      input={{ data: { ...data, tagList: tagStore.tagDisplayListGet(assetKey) } }}
      onEventRuntime={(eventType, eventData) => {
        if (eventType !== 'tagOverviewOpenRequest' || !isTagOverviewAvailable) return undefined;
        return { isHandled: tagStore.overviewOpen(eventData.tagId) };
      }}
      placement="sidePanelDisplay"
    />
  );
});
