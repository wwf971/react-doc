import { LoaderCircle } from '../../frontend/UICommon.js';
import { blockPlacePositionList, BLOCK_PLACE_NODE_DOC } from '../../frontend/src/lib/doc-block-place.js';
import { SourcePathInput } from '../source/SourcePathInput.jsx';
import { SourceTreeSelect } from '../source/SourceTreeSelect.jsx';
import './BlockList.css';

// Where blocks go in a document (doc_page_impl_copy_paste.md#choosing-where-the-blocks-go),
// in the look of the move picker of the side panel: the document (a source
// path with completion, any md / mdx document), the document as a tree
// (SourceTreeSelect: the document, its blocks below it), and the positions
// next to or inside the chosen node. A position the chosen node does not
// allow is disabled and says why on hover. It shows and reports only; the
// place belongs to the caller (lib/doc-block-place.js says what a place is).
//
//   Document  ~example/edit-in-place.md
//   ▾ 🗎 edit-in-place.md
//       ¶ What edit mode shows       Heading
//       ¶ First of three short …     Paragraph   ◄ chosen
//   [Before] [After] [Into, first] [Into, last]
//   The blocks go after “First of three short …”.
//
//   docPath, docMessage   the document, and why the typed one cannot be used
//   isDocFieldShown       false: no document field; the caller has chosen the
//                         document before (copying or moving blocks: a step
//                         of its own, with a way back)
//   nodeList              the tree (blockPlaceNodeListBuild); undefined while
//                         the document is read
//   place                 { nodeId, position }
//   placeText             how the chosen place reads ("after “Third …”")
//   positionReasonGet(position)  why a position is refused, '' when allowed
//   isLocked              nothing can be changed (the blocks are being written)
//   onDocCommit(path), onNodeSelect(nodeId), onPositionSelect(position)
export function BlockPlacePicker({
  docPath,
  docMessage = '',
  isDocFieldShown = true,
  nodeList,
  place,
  placeText = '',
  positionReasonGet,
  isLocked = false,
  className = '',
  onDocCommit,
  onNodeSelect,
  onPositionSelect,
}) {
  return (
    <div className={`doc-block-place-picker${className ? ` ${className}` : ''}`}>
      {isDocFieldShown ? (
        <div className="doc-block-place-picker-doc">
          <span className="doc-block-place-picker-doc-label">Document</span>
          <SourcePathInput
            className="doc-block-place-picker-doc-path"
            value={docPath}
            spec={{ kind: 'file', extList: ['md', 'mdx'] }}
            placeholder="~root/path/to/doc.md"
            isDisabled={isLocked}
            onCommit={(path) => onDocCommit?.(path)}
          />
        </div>
      ) : null}
      {docMessage ? <p className="doc-block-place-picker-message" role="alert">{docMessage}</p> : null}
      {nodeList ? (
        <SourceTreeSelect
          key={docPath}
          className="doc-block-place-picker-tree"
          nodeList={nodeList}
          valueId={place.nodeId}
          idExpandedInitialList={[BLOCK_PLACE_NODE_DOC]}
          onSelect={(nodeId) => {
            if (!isLocked) onNodeSelect?.(nodeId);
          }}
        />
      ) : (
        <p className="doc-block-place-picker-status" role="status">
          <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-edit-spin" />
          <span>Reading the document…</span>
        </p>
      )}
      <div className="doc-block-place-picker-actions" role="group" aria-label="Where next to the chosen node">
        {blockPlacePositionList.map((item) => {
          const reason = positionReasonGet?.(item.position) ?? '';
          const isChosen = place.position === item.position && reason === '';
          return (
            <button
              key={item.position}
              type="button"
              className="doc-block-place-picker-button"
              aria-pressed={isChosen}
              disabled={isLocked || reason !== ''}
              title={reason || undefined}
              onClick={() => onPositionSelect?.(item.position)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <p className="doc-block-place-picker-hint">
        {placeText ? `The blocks go ${placeText}.` : 'Choose a block or the document, then where the blocks go next to it.'}
      </p>
    </div>
  );
}
