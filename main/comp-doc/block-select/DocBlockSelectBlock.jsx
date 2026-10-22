import { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { DocEditBlockContext, useDocEditDoc } from '../edit/DocEditDocContext.js';
import './DocBlockSelect.css';

// A root-level block of the edit body in block selection mode
// (doc_page_impl_copy_paste.md#selecting-blocks), in place of the editable
// wrapper (DocEditBlock dispatches). It keeps the wrapper's element, its
// attributes and its zero-height anchor, so switching between the modes
// moves nothing; a selected block is marked by an outline and a tint only.
//
//   click               this block only
//   Ctrl / ⌘ + click    this block in or out of the selection
//   Shift + click       the blocks from the last clicked one to this one
//   right click         the menu of the selection (DocBlockSelectMenu); on
//                       a block not selected, that block alone is selected
//
// a click selects only: links, buttons and fields inside the block do
// nothing in this mode. a block that renders nothing visible keeps its chip,
// which is selected like the block.
export const DocBlockSelectBlock = observer(function DocBlockSelectBlock({ blockIndex, children }) {
  const { blockSelectStore } = useDocStores();
  const { path, model } = useDocEditDoc();
  const index = Number(blockIndex);
  const block = model.blockList[index];
  const blockContextValue = useMemo(() => ({ path, blockIndex: index }), [path, index]);
  if (!block || !blockSelectStore) return children;
  const isSelected = blockSelectStore.blockIsSelected(path, index);
  const isInvisible = block.kind === 'html' || block.kind === 'marker';

  const clickCaptureHandle = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    blockSelectStore.blockClick(path, index, {
      isToggle: event.metaKey || event.ctrlKey,
      isRange: event.shiftKey,
    });
  };

  const contextMenuHandle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    blockSelectStore.contextMenuOpen(path, index, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  return (
    <DocEditBlockContext.Provider value={blockContextValue}>
      <div
        className="doc-edit-block doc-block-select-block"
        data-block-index={index}
        data-first={index === 0 ? '' : undefined}
        data-last={index === model.blockList.length - 1 ? '' : undefined}
        data-kind={block.kind}
        data-depth={block.depth}
        data-invisible={isInvisible ? '' : undefined}
        data-selected={isSelected ? '' : undefined}
        onClickCapture={clickCaptureHandle}
        onContextMenu={contextMenuHandle}
      >
        <div className="doc-edit-block-anchor not-prose" />
        {isInvisible ? (
          <span className="doc-edit-block-chip not-prose" title={block.text}>
            {block.kind === 'marker' ? 'markers' : 'comment'}: {block.text.split('\n')[0]}
          </span>
        ) : children}
      </div>
    </DocEditBlockContext.Provider>
  );
});
