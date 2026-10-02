import { isValidElement } from 'react';
import { TagList } from '../../comp-mdx/tag/TagList.jsx';
import './SidePanelItem.css';

// Default side-panel item label: the item text, followed by the tags of the
// asset the item is bound to. Registered as common/SidePanelItem under the
// built-in name SidePanelItem; mapping that name in compRegistry replaces it.
//
//   data.text            display text, already a string in the selected language
//   data.textLanguage    language of data.text, '' for a plain-string label
//   data.textMessage     '' or the diagnostic of an invalid authored text
//   data.tagList         resolved tags [{ id, compName, data }], unfiltered
//   data.kind            separator | folder | folder-file | file | panel | inline
//   data.itemDeclared    the side-panel yaml node, without children; its
//                        "text" is authored data and can be a language mapping
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
// keeps tags, wrapping, and the lang attribute.
export function SidePanelItem({ data = {}, config = {}, onEvent }) {
  const tagList = sidePanelItemTagListShownGet(data, config);
  const isTextInvalid = Boolean(data.textMessage);
  return (
    <span className="doc-side-panel-item" data-surface={config.surface ?? 'sidebar'}>
      <span
        className={`doc-side-panel-item-text${isTextInvalid ? ' is-invalid' : ''}`}
        lang={data.textLanguage || undefined}
        title={isTextInvalid ? data.textMessage : undefined}
      >
        {textRenderableGet(data.text)}
      </span>
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

// a custom renderer may pass an element as data.text; a plain object, such as
// an authored language mapping passed by mistake, is not renderable
function textRenderableGet(text) {
  if (text && typeof text === 'object' && !Array.isArray(text) && !isValidElement(text)) return '';
  return text;
}

function sidePanelItemTagListShownGet(data, config) {
  if (config.surface !== 'sidebar' || !Array.isArray(data.tagList)) return [];
  const configGlobal = config.configGlobal ?? {};
  if (configGlobal.TagsDisplayAtSidePanelItemIsOn === false) return [];
  const tagIdListShown = configGlobal.TagsDisplayAtSidePanelItemsList;
  if (!Array.isArray(tagIdListShown)) return data.tagList;
  return data.tagList.filter((tag) => tagIdListShown.includes(tag.id));
}
