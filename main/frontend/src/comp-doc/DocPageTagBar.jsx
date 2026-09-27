import { observer } from 'mobx-react-lite';
import { useDocStores } from '../store/context.js';
import { TagList } from '../../../comp-mdx/tag/TagList.jsx';
import { useTagOverviewIsAvailable } from './TagOverviewPopup.jsx';
import './DocPageTagBar.css';

// Tags of the current page, shown next to the path bar of the main panel.
// Switched by TagsDisplayAtMainPanelIsOn, resolved for the current document
// (doc_page_impl_config.md). Pages without a document use the page value.
export const DocPageTagBar = observer(function DocPageTagBar() {
  const { configStore, docStore, tagStore } = useDocStores();
  const isTagOverviewAvailable = useTagOverviewIsAvailable();
  const item = docStore.itemCurrent;
  if (!item?.assetKey) return null;
  const isOn = item.docPath
    ? configStore.valueDocGet(item.docPath, 'TagsDisplayAtMainPanelIsOn')
    : configStore.valueGlobalGet('TagsDisplayAtMainPanelIsOn');
  if (isOn !== true) return null;
  const tagList = tagStore.tagDisplayListGet(item.assetKey);
  if (tagList.length === 0) return null;
  return (
    <span className="doc-page-tag-bar">
      <TagList
        data={{ tagList }}
        config={{ instanceId: `main-panel:${item.id}`, isClickable: isTagOverviewAvailable }}
        onEvent={(eventType, eventData) => {
          if (eventType === 'tagActivateRequest') tagStore.overviewOpen(eventData.tagId);
        }}
      />
    </span>
  );
});
