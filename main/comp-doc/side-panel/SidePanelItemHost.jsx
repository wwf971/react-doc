import { createContext, useContext } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { useTagOverviewIsAvailable } from '../tag/TagOverviewPopup.jsx';

// Where a side-panel item label is being displayed. fumadocs reuses the
// page-tree name in breadcrumbs and previous/next cards, so those surfaces
// provide their own value; everything else is the side panel.
export const SidePanelItemSurfaceContext = createContext('sidebar');

// Runtime boundary of every side-panel item label: selects the label
// translation for the document language, resolves the item's tags from the
// tag service, adds page-level config, and renders the chosen registry
// component with placement sidePanelDisplay.
//
//   textLocalized  string or language mapping; the renderer receives the
//                  selected string as data.text and its language as
//                  data.textLanguage ('' for a plain string)
//   textMessage    diagnostic of an invalid authored text, as data.textMessage
export const SidePanelItemHost = observer(function SidePanelItemHost({
  assetKey,
  compName,
  data,
  itemId,
  textLocalized,
  textMessage,
}) {
  const { configStore, docStore, tagStore } = useDocStores();
  const surface = useContext(SidePanelItemSurfaceContext);
  const isTagOverviewAvailable = useTagOverviewIsAvailable();
  const textSelected = docStore.textDisplayGet(textLocalized);
  const dataDisplay = {
    ...data,
    tagList: tagStore.tagDisplayListGet(assetKey),
    text: textSelected.text,
    textLanguage: textSelected.language,
    textMessage: textMessage ?? '',
  };
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
      input={{ data: dataDisplay }}
      onEventRuntime={(eventType, eventData) => {
        if (eventType !== 'tagOverviewOpenRequest' || !isTagOverviewAvailable) return undefined;
        return tagStore.overviewOpen(eventData.tagId) ? { code: 0 } : { code: -1, message: 'tag overview not available' };
      }}
      placement="sidePanelDisplay"
    />
  );
});
