import { observer } from 'mobx-react-lite';
import { useDocStores } from '#react-doc/frontend/src/store/context.js';
import { useTagOverviewIsAvailable } from '#react-doc/comp-doc/tag/TagOverviewPopup.jsx';
import { TagList } from './TagList.jsx';

// Mentions one tag inside document text. Registered as common/Tag under the
// built-in name Tag. The tag is displayed exactly as everywhere else: through
// its tag definition (display component and data), and clicking it opens the
// tag overview when the overview popup is available.
//
//   data.tagId    id of the mentioned tag. in the comment form, the inline
//                 code after the comment supplies it when tagId is absent.
//   other data    per-mention tag data, the same as "data" of a tag
//                 declaration, e.g. text. overrides the definition's data.
//
// Events emitted:
//   tagOverviewOpenRequest { tagId }   the tag was clicked
//
// In MDX:       <Tag tagId="guide" />   <Tag tagId="guide" text="Guides" />
// In Markdown:  <!--renderComp=Tag-->`guide`
//               <!--renderComp=Tag,text=Guides-->`guide`
export const Tag = observer(function Tag({ data = {}, config = {}, onEvent }) {
  const { tagStore } = useDocStores();
  const isTagOverviewAvailable = useTagOverviewIsAvailable();
  const {
    tagId: tagIdAuthored,
    raw,
    lang: _lang,
    content: _content,
    id: _id,
    ...tagData
  } = data;
  const tagId = String(tagIdAuthored ?? raw ?? '').trim();
  if (tagId === '') {
    return <span className="doc-tag-mention-error">Tag: tagId is missing</span>;
  }

  const tagDisplay = tagStore.tagDisplayGet({ id: tagId, data: tagData });
  const isKnown = tagStore.tagIdList.includes(tagId);
  return (
    <span
      className={isKnown ? 'doc-tag-mention' : 'doc-tag-mention is-unknown'}
      title={isKnown ? undefined : `Tag "${tagId}" is neither defined nor attached to any asset`}
    >
      <TagList
        data={{ tagList: [tagDisplay] }}
        config={{ instanceId: config.instanceId, isClickable: isTagOverviewAvailable }}
        onEvent={(eventType, eventData) => {
          if (eventType === 'tagActivateRequest') onEvent?.('tagOverviewOpenRequest', { tagId: eventData.tagId });
        }}
      />
    </span>
  );
});
