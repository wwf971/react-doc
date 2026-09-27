// Default visual renderer for recognized document links.
import { TagList } from '../../../comp-mdx/tag/TagList.jsx';
import './LinkDocRender.css';
//
// Interface:
//   data: accepted semantic/display data; never mutated by this component
//     data.tagList          tags of the single target, [] when not shown
//   config: operational state decided by the document stores
//     config.tagsPosition   before | after | '' (tags beside, outside the link)
//   onEvent: unified change-attempt callback
//
// Events emitted:
//   activateRequest         user activates the main link
//   candidateSelectRequest user chooses one ambiguous target
export function LinkDocRender({ data = {}, config = {}, onEvent }) {
  const {
    ariaHasPopup,
    displayContent,
    href,
    tagList = [],
    targetList = [],
    titleText = '',
  } = data;
  const {
    activationElement = 'anchor',
    className = '',
    Icon = LinkArrowIcon,
    instanceId = 'doc-link',
    isBroken = false,
    isCurrent = false,
    isDropdownOpen = false,
    isMultiple = false,
    isNavigationUnavailable = false,
    tagsPosition = '',
  } = config;
  const tagListContent = tagsPosition && tagList.length > 0 ? (
    <span className={`doc-link-render-tags is-${tagsPosition}`}>
      <TagList data={{ tagList }} config={{ instanceId }} />
    </span>
  ) : null;
  const classNameLink = `doc-link-render${className ? ` ${className}` : ''}${isCurrent ? ' is-current' : ''}${isDropdownOpen ? ' is-active' : ''}${isNavigationUnavailable ? ' is-unavailable' : ''}`;
  const contentLink = (
    <>
      {displayContent}
      {isMultiple ? <span className="doc-link-render-count">({targetList.length})</span> : null}
      <span className="doc-link-render-icon" aria-hidden="true">
        <Icon width={13} height={13} size={13} />
      </span>
    </>
  );

  if (isBroken) {
    return (
      <span className={`doc-link-render${className ? ` ${className}` : ''} is-broken`} title={titleText}>
        {displayContent}
      </span>
    );
  }

  return (
    <span className="doc-link-render-wrap">
      {tagsPosition === 'before' ? tagListContent : null}
      {activationElement === 'button' ? (
        <button
          type="button"
          className={classNameLink}
          title={titleText}
          aria-haspopup={ariaHasPopup}
          onClick={(event) => onEvent?.('activateRequest', { event })}
        >
          {contentLink}
        </button>
      ) : (
        <a
          className={classNameLink}
          href={href}
          title={titleText}
          onClick={(event) => onEvent?.('activateRequest', { event })}
        >
          {contentLink}
        </a>
      )}
      {tagsPosition === 'after' ? tagListContent : null}
      {isDropdownOpen ? (
        <span className="doc-link-render-menu">
          {targetList.map((target) => (
            <button
              key={target.internalPath}
              type="button"
              className="doc-link-render-option"
              onClick={(event) => onEvent?.('candidateSelectRequest', { event, target })}
            >
              {target.internalPath}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function LinkArrowIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
    >
      <path d="M5 3h8v8h-1.5V5.56l-7.97 7.97-1.06-1.06L10.44 4.5H5V3Z" fill="currentColor" />
    </svg>
  );
}
