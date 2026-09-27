import { RegisteredComp } from '#react-doc/frontend/src/comp-doc/RegisteredComp.jsx';
import './Tag.css';

// Renders resolved tags, each through the registry component of its tag
// definition (placement "tag"). Custom side-panel item components can reuse it
// with the data.tagList they receive.
//
//   data.tagList        [{ id, compName, data }], e.g. from tagService.tagDisplayListGet()
//   config.instanceId   prefix of the tag instance ids
//   config.isClickable  tags emit "tagActivateRequest" { tagId } when clicked.
//                       the click does not reach an enclosing link or item.
export function TagList({ data = {}, config = {}, onEvent }) {
  const tagList = Array.isArray(data.tagList) ? data.tagList : [];
  if (tagList.length === 0) return null;
  const isClickable = config.isClickable === true;
  return (
    <span className="doc-tag-list">
      {tagList.map((tag) => {
        const tagComp = (
          <RegisteredComp
            compName={tag.compName}
            configRuntime={{ instanceId: `${config.instanceId ?? 'tag-list'}:tag:${tag.id}`, tagId: tag.id }}
            input={{ data: tag.data }}
            placement="tag"
          />
        );
        if (!isClickable) return <span key={tag.id} className="doc-tag-list-entry">{tagComp}</span>;
        const tagActivate = (event) => {
          event.preventDefault();
          event.stopPropagation();
          onEvent?.('tagActivateRequest', { tagId: tag.id });
        };
        return (
          <span
            key={tag.id}
            className="doc-tag-list-entry is-clickable"
            role="button"
            tabIndex={0}
            title={`Show everything tagged "${tag.data?.text ?? tag.id}"`}
            onClick={tagActivate}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') tagActivate(event);
            }}
          >
            {tagComp}
          </span>
        );
      })}
    </span>
  );
}
