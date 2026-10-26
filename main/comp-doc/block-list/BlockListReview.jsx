import { CodeIcon, Eye, Square, SquareCheck } from '../../frontend/UICommon.js';
import { BlockRender } from '../../../built-in/comp-mdx/text/BlockRender.jsx';
import './BlockList.css';

// A list of root-level blocks to look at before something is done with them
// (doc_page_impl_block_ops.md#general-components): every block starts with
// a badge naming its kind. It shows and reports only: the blocks, which of
// them are rendered and which are checked belong to the caller (a paste:
// DocPasteStore.review; a copy or a move: DocBlockSelectStore.transfer).
//
//   display 'full'      every block with its source, the lines that make it
//                       one block; the button next to the badge switches the
//                       block between its source and its rendering, as the
//                       document it is meant for would render it
//     [☑] [Paragraph] [👁]
//     A paragraph with **bold**.
//     [☐] [List] [</>]
//     • one  • two                    ◄ rendered
//
//   display 'compact'   one line per block: the beginning of its source;
//                       a click on the line toggles its checkbox
//     [☑] [Paragraph] A paragraph with **bold**.
//     [☐] [List] - one - two
//     [☑] [Image] <!--renderComp=Image--> ```yaml src: a.png …
//
//   blockList          [{ id, label, kind, text }]
//   isRenderedById     { [id]: true } for the blocks shown rendered (full)
//   format, sourcePath how a block is rendered (BlockRender): the format and
//                      the path of the document it is meant for, so its
//                      links and components resolve from there
//   onRenderToggle(id) the render button of a block was pressed
//   isCheckable        a checkbox before every badge
//   isCheckedById      { [id]: true } for the blocks checked
//   onCheckToggle(id)  the checkbox of a block was pressed
//   isLocked           nothing can be toggled
export function BlockListReview({
  blockList,
  display = 'full',
  isRenderedById = {},
  format = 'md',
  sourcePath = '',
  isCheckable = false,
  isCheckedById = {},
  isLocked = false,
  className = '',
  onRenderToggle,
  onCheckToggle,
}) {
  const checkToggle = (blockId) => {
    if (!isLocked) onCheckToggle?.(blockId);
  };

  if (display === 'compact') {
    return (
      <div className={`doc-block-list-review${className ? ` ${className}` : ''}`} data-display="compact">
        {blockList.map((block) => {
          const isChecked = isCheckedById[block.id] === true;
          return (
            <div
              key={block.id}
              className="doc-block-list-review-line"
              data-checkable={isCheckable ? '' : undefined}
              data-unchecked={isCheckable && !isChecked ? '' : undefined}
              title={block.text}
              onClick={isCheckable ? () => checkToggle(block.id) : undefined}
            >
              {isCheckable ? <BlockCheck isChecked={isChecked} isLocked={isLocked} onToggle={() => checkToggle(block.id)} /> : null}
              <span className="doc-badge" data-kind={block.kind}>{block.label}</span>
              <span className="doc-block-list-review-line-text">{blockLineTextGet(block.text)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`doc-block-list-review${className ? ` ${className}` : ''}`}>
      {blockList.map((block) => {
        const isRendered = isRenderedById[block.id] === true;
        const isChecked = isCheckedById[block.id] === true;
        return (
          <div
            key={block.id}
            className="doc-block-list-review-item"
            data-rendered={isRendered ? '' : undefined}
            data-unchecked={isCheckable && !isChecked ? '' : undefined}
          >
            <div className="doc-block-list-review-head">
              {isCheckable ? <BlockCheck isChecked={isChecked} isLocked={isLocked} onToggle={() => checkToggle(block.id)} /> : null}
              <span className="doc-badge" data-kind={block.kind}>{block.label}</span>
              <button
                type="button"
                className="doc-button-icon doc-block-list-review-toggle"
                aria-pressed={isRendered}
                title={isRendered ? 'Show the source' : 'Show it rendered'}
                aria-label={isRendered ? 'Show the source' : 'Show it rendered'}
                onClick={() => onRenderToggle?.(block.id)}
              >
                {isRendered
                  ? <CodeIcon aria-hidden="true" size={12} strokeWidth={2} />
                  : <Eye aria-hidden="true" size={12} strokeWidth={2} />}
              </button>
            </div>
            {isRendered ? (
              <div className="doc-block-list-review-render prose">
                <BlockRender data={{ text: block.text }} config={{ format, sourcePath }} />
              </div>
            ) : (
              <div className="doc-block-list-review-source">{block.text}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// a checkbox drawn as an icon: a button, so the list keeps no form element
function BlockCheck({ isChecked, isLocked, onToggle }) {
  return (
    <button
      type="button"
      role="checkbox"
      className="doc-block-list-review-check"
      aria-checked={isChecked}
      aria-label={isChecked ? 'Leave this block out' : 'Take this block'}
      disabled={isLocked}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {isChecked
        ? <SquareCheck aria-hidden="true" size={13} strokeWidth={2} />
        : <Square aria-hidden="true" size={13} strokeWidth={2} />}
    </button>
  );
}

// the source of a block on one line: its lines joined by a space; the line
// ends with an ellipsis where it is cut (CSS)
function blockLineTextGet(text) {
  return String(text ?? '').replace(/\s*\n\s*/g, ' ').slice(0, 300);
}
