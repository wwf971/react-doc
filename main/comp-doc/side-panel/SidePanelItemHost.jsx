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
// tag service, adds page-level config and the state of the edit layer, and
// renders the chosen registry component with placement sidePanelDisplay.
//
//   textLocalized  string or language mapping; the renderer receives the
//                  selected string as data.text and its language as
//                  data.textLanguage ('' for a plain string)
//   textMessage    diagnostic of an invalid authored text, as data.textMessage
//
// in edit mode, on the sidebar surface, an item whose label is authored in a
// side-panel file can have that label edited in place
// (doc_page_impl_side_panel.md): the renderer receives
//   config.isTextEditable   the label may be edited
//   config.textEditStatus   '' | editing | submitting | error, for this item
//   config.textEditMessage  the failure of the last save
// and reports sidePanelTextEditStartRequest / sidePanelTextSubmitRequest
// { text } / sidePanelTextCancelRequest. a label just saved is shown as
// data.text until the new configuration has rebuilt the side panel.
export const SidePanelItemHost = observer(function SidePanelItemHost({
  assetKey,
  compName,
  data,
  itemId,
  textLocalized,
  textMessage,
}) {
  const { configStore, docStore, editStore, tagStore } = useDocStores();
  const surface = useContext(SidePanelItemSurfaceContext);
  // tags on side-panel items open the overview only when the page asks for
  // it (TagsOverviewPopupAtSidePanelItemIsOn): a click in the side panel is
  // a navigation gesture by default
  const isTagOverviewAvailable = useTagOverviewIsAvailable()
    && configStore.valueGlobalGet('TagsOverviewPopupAtSidePanelItemIsOn') === true;
  // fumadocs keeps the page tree it received first while the root $id stays
  // the same (its TreeContextProvider memoizes on it), so the props of this
  // element can be from an older build. the label is read from the current
  // tree model, which follows a configuration received as data (a label
  // saved from edit mode); the props are the fallback.
  const outline = docStore.treeModel.itemOutlineById.get(itemId);
  const textLocalizedCurrent = outline ? outline.textLocalized : textLocalized;
  const textMessageCurrent = outline ? outline.textMessage : textMessage;
  const textSelected = docStore.textDisplayGet(textLocalizedCurrent);
  const textPending = editStore.sidePanelTextPendingGet(itemId);
  const textEdit = editStore.sidePanelTextIs(itemId) ? editStore.sidePanelText : undefined;
  const dataDisplay = {
    ...data,
    tagList: tagStore.tagDisplayListGet(assetKey),
    text: textPending ?? textSelected.text,
    textLanguage: textSelected.language,
    textMessage: textMessageCurrent ?? '',
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
        isTextEditable: surface === 'sidebar' && editStore.sidePanelTextIsEditable(itemId),
        itemId,
        surface,
        tagService: tagStore.tagService,
        textEditMessage: textEdit?.message ?? '',
        textEditStatus: textEdit?.status ?? '',
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
