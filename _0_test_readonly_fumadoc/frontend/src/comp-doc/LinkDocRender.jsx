// Default visual renderer for recognized document links.
import './LinkDocRender.css';
//
// Interface:
//   data: accepted semantic/display data; never mutated by this component
//   config: operational state decided by the document stores
//   onEvent: unified change-attempt callback
//
// Events emitted:
//   activateRequest         user activates the main link
//   candidateSelectRequest user chooses one ambiguous target
export function LinkDocRender({ data = {}, config = {}, onEvent }) {
  const {
    displayContent,
    href,
    targetList = [],
    titleText = '',
  } = data;
  const {
    Icon = LinkArrowIcon,
    isBroken = false,
    isCurrent = false,
    isDropdownOpen = false,
    isMultiple = false,
    isNavigationUnavailable = false,
  } = config;

  if (isBroken) {
    return (
      <span className="doc-link-render is-broken" title={titleText}>
        {displayContent}
      </span>
    );
  }

  return (
    <span className="doc-link-render-wrap">
      <a
        className={`doc-link-render${isCurrent ? ' is-current' : ''}${isDropdownOpen ? ' is-active' : ''}${isNavigationUnavailable ? ' is-unavailable' : ''}`}
        href={href}
        title={titleText}
        onClick={(event) => onEvent?.('activateRequest', { event })}
      >
        {displayContent}
        {isMultiple ? <span className="doc-link-render-count">({targetList.length})</span> : null}
        <span className="doc-link-render-icon" aria-hidden="true">
          <Icon width={13} height={13} size={13} />
        </span>
      </a>
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
