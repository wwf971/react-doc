import { useEffect, useRef, useState } from 'react';
import { ChevronRight, FileIcon, FolderIcon, FolderOpenIcon, Minus } from '../../frontend/UICommon.js';
import './DocSource.css';

// A tree to choose one node from (doc_page_impl_source.md#browsing-as-a-tree):
// the folders and files of the source (DocSourceStore.pathTreeGet), or any
// other tree handed in the same shape, such as the items of the side panel
// (the move picker). It only shows and selects: what a selected node means
// is the caller's.
//
//   nodeList              [{ id, label, detail?, kind?, isDisabled?, title?, childList? }]
//                         kind picks the icon: dir | folder (a folder),
//                         separator, anything else a file
//   valueId               the selected node ('' none)
//   idExpandedInitialList the nodes open at first; the others are closed
//   onSelect(id, node)    a node that is not disabled was chosen (click,
//                         Enter, arrow keys)
//   onActivate(id, node)  optional: double click or Enter on the selected node
//
// keys, with the tree focused: ArrowUp / ArrowDown select the previous / next
// node that can be chosen, ArrowRight opens a folder (or goes to its first
// child), ArrowLeft closes it (or goes to its parent), Enter activates.
// a disabled node is shown (it can lead to others) and opens, but is never
// selected; its title says why.
export function SourceTreeSelect({
  nodeList,
  valueId = '',
  idExpandedInitialList = [],
  className = '',
  onSelect,
  onActivate,
}) {
  const elementRef = useRef(null);
  const [idExpandedSet, idExpandedSetSet] = useState(() => new Set(idExpandedInitialList));
  const rowList = rowListBuild(nodeList, idExpandedSet);

  // the selected node is in view when the tree opens
  useEffect(() => {
    const row = elementRef.current?.querySelector('[data-selected]');
    row?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expandedSet = (id, isExpanded) => {
    idExpandedSetSet((setPrevious) => {
      const setNext = new Set(setPrevious);
      if (isExpanded) setNext.add(id);
      else setNext.delete(id);
      return setNext;
    });
  };

  const rowSelect = (row) => {
    if (!row || row.node.isDisabled) return;
    onSelect?.(row.node.id, row.node);
    const element = elementRef.current?.querySelector(`[data-row-index="${rowList.indexOf(row)}"]`);
    element?.scrollIntoView({ block: 'nearest' });
  };

  const keyDownHandle = (event) => {
    const indexCurrent = rowList.findIndex((row) => row.node.id === valueId);
    const rowCurrent = rowList[indexCurrent];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      for (let index = indexCurrent + step; index >= 0 && index < rowList.length; index += step) {
        if (!rowList[index].node.isDisabled) {
          rowSelect(rowList[index]);
          return;
        }
      }
      return;
    }
    if (!rowCurrent) return;
    if (event.key === 'ArrowRight' && rowCurrent.hasChildren) {
      event.preventDefault();
      if (!idExpandedSet.has(rowCurrent.node.id)) expandedSet(rowCurrent.node.id, true);
      else rowSelect(rowList[indexCurrent + 1]);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (rowCurrent.hasChildren && idExpandedSet.has(rowCurrent.node.id)) expandedSet(rowCurrent.node.id, false);
      else rowSelect(rowList.find((row) => row.node.id === rowCurrent.parentId));
      return;
    }
    if (event.key === 'Enter' && onActivate) {
      event.preventDefault();
      onActivate(rowCurrent.node.id, rowCurrent.node);
    }
  };

  return (
    <div
      ref={elementRef}
      className={`doc-source-tree${className ? ` ${className}` : ''}`}
      role="tree"
      tabIndex={0}
      onKeyDown={keyDownHandle}
    >
      {rowList.map((row, index) => {
        const { node } = row;
        const isExpanded = row.hasChildren && idExpandedSet.has(node.id);
        const isSelected = node.id === valueId;
        return (
          <div
            key={node.id}
            className="doc-source-tree-row"
            role="treeitem"
            aria-level={row.depth + 1}
            aria-expanded={row.hasChildren ? isExpanded : undefined}
            aria-selected={isSelected}
            aria-disabled={node.isDisabled || undefined}
            data-row-index={index}
            data-selected={isSelected || undefined}
            data-disabled={node.isDisabled || undefined}
            title={node.title || undefined}
            style={{ paddingInlineStart: `${2 + row.depth * 12}px` }}
            onClick={() => rowSelect(row)}
            onDoubleClick={() => {
              if (!node.isDisabled) onActivate?.(node.id, node);
            }}
          >
            {row.hasChildren ? (
              <button
                type="button"
                className="doc-source-tree-toggle"
                tabIndex={-1}
                aria-label={isExpanded ? 'Close' : 'Open'}
                onClick={(event) => {
                  event.stopPropagation();
                  expandedSet(node.id, !isExpanded);
                }}
              >
                <ChevronRight
                  aria-hidden="true"
                  size={12}
                  strokeWidth={2}
                  className={`doc-source-tree-chevron${isExpanded ? ' is-expanded' : ''}`}
                />
              </button>
            ) : (
              <span className="doc-source-tree-toggle" aria-hidden="true" />
            )}
            <NodeIcon kind={node.kind} isExpanded={isExpanded} />
            <span className="doc-source-tree-label">{node.label}</span>
            {node.detail ? <span className="doc-source-tree-detail">{node.detail}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function NodeIcon({ kind, isExpanded }) {
  const props = { 'aria-hidden': true, size: 12, strokeWidth: 1.8, className: 'doc-source-tree-icon' };
  if (kind === 'dir' || kind === 'folder') return isExpanded ? <FolderOpenIcon {...props} /> : <FolderIcon {...props} />;
  if (kind === 'separator') return <Minus {...props} />;
  return <FileIcon {...props} />;
}

// the rows shown: every node whose ancestors are all open, in tree order
function rowListBuild(nodeList, idExpandedSet) {
  const rowList = [];
  const visit = (node, depth, parentId) => {
    const hasChildren = Array.isArray(node.childList) && node.childList.length > 0;
    rowList.push({ node, depth, parentId, hasChildren });
    if (hasChildren && idExpandedSet.has(node.id)) {
      for (const child of node.childList) visit(child, depth + 1, node.id);
    }
  };
  for (const node of nodeList) visit(node, 0, '');
  return rowList;
}
