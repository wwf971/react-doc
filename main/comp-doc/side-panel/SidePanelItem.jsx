import { TagList } from '../../comp-mdx/tag/TagList.jsx';
import './SidePanelItem.css';

// Default side-panel item label: the item text, followed by the tags of the
// asset the item is bound to. Registered as common/SidePanelItem under the
// built-in name SidePanelItem; mapping that name in compRegistry replaces it.
//
//   data.text            display text
//   data.tagList         resolved tags [{ id, compName, data }], unfiltered
//   data.kind            separator | folder | folder-file | file | panel | inline
//   data.itemDeclared    the side-panel yaml node, without children
//   config.surface       sidebar | breadcrumb | footer
//   config.configGlobal  page-level config, see doc_page_impl_config.md
//                          TagsDisplayAtSidePanelItemIsOn     show tags at all
//                          TagsDisplayAtSidePanelItemsList    tag ids to show, null = all
//   config.isTagOverviewAvailable  clicking a tag may open the tag overview
//   config.tagService, config.configService   queries
//
// Events emitted:
//   tagOverviewOpenRequest { tagId }   a tag was clicked
//
// The label is always inside the .doc-side-panel-item host, with or without
// tags. On the sidebar surface the host wraps long names onto more lines
// (SidePanelItem.css) instead of clipping them. A custom renderer that only
// changes the label should pass it as data.text to this component, which
// keeps tags and wrapping.
export function SidePanelItem({ data = {}, config = {}, onEvent }) {
  const tagList = sidePanelItemTagListShownGet(data, config);
  return (
    <span className="doc-side-panel-item" data-surface={config.surface ?? 'sidebar'}>
      {data.text}
      {tagList.length > 0 ? (
        <TagList
          data={{ tagList }}
          config={{ instanceId: config.instanceId, isClickable: config.isTagOverviewAvailable === true }}
          onEvent={(eventType, eventData) => {
            if (eventType === 'tagActivateRequest') onEvent?.('tagOverviewOpenRequest', { tagId: eventData.tagId });
          }}
        />
      ) : null}
    </span>
  );
}

function sidePanelItemTagListShownGet(data, config) {
  if (config.surface !== 'sidebar' || !Array.isArray(data.tagList)) return [];
  const configGlobal = config.configGlobal ?? {};
  if (configGlobal.TagsDisplayAtSidePanelItemIsOn === false) return [];
  const tagIdListShown = configGlobal.TagsDisplayAtSidePanelItemsList;
  if (!Array.isArray(tagIdListShown)) return data.tagList;
  return data.tagList.filter((tag) => tagIdListShown.includes(tag.id));
}
