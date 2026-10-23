import { useEffect, useRef, useState } from 'react';
import { ChevronRight, FileIcon, FolderIcon, FolderOpenIcon, Minus, Pilcrow } from '../../frontend/UICommon.js';
import { sourceTreeSearch } from '../../frontend/src/lib/doc-source-complete.js';
import './DocSource.css';

// A tree to choose one node from (doc_page_impl_source.md#browsing-as-a-tree):
// the folders and files of the source (DocSourceStore.pathTreeGet), or any
// other tree handed in the same shape, such as the items of the side panel
// (the move picker) or a document with its blocks (the place picker of a
// paste). It only shows and selects: what a selected node means is the caller's.
//
//   nodeList              [{ id, label, detail?, badge?, badgeKind?, kind?, isDisabled?, title?, insertMark?, childList? }]
//                         kind picks the icon: dir | folder (a folder),
//                         separator, block (a block of a document),
//                         anything else a file. badge is a tag before the
//                         label (the kind of a block: [Paragraph]), badgeKind
//                         'component' colors it like a component's.
//                         insertMark 'before' | 'after' draws a line on the
//                         border above / below the row: where something
//                         will be put (the place picker of blocks); the
//                         line takes no room
//   valueId               the selected node ('' none)
//   idExpandedInitialList the nodes open at first; the others are closed
//   searchText            optional: only the nodes whose label holds every
//                         word of it, with the folders leading to them, open
//                         (lib/doc-source-complete.js sourceTreeSearch); the
//                         matched parts of a label are highlighted. folders
//                         opened or closed while searching are forgotten
//                         when the search changes
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
  searchText = '',
  className = '',
  onSelect,
  onActivate,
}) {
  const elementRef = useRef(null);
  const [idExpandedBrowseSet, idExpandedBrowseSetSet] = useState(() => new Set(idExpandedInitialList));
  const [searchExpanded, searchExpandedSet] = useState({ text: '', idSet: new Set() });
  const isSearching = searchText.trim() !== '';
  const search = sourceTreeSearch(nodeList, searchText);
  const idExpandedSet = !isSearching
    ? idExpandedBrowseSet
    : searchExpanded.text === searchText ? searchExpanded.idSet : new Set(search.idExpandedList);
  const rowList = rowListBuild(search.nodeList, idExpandedSet);

  // the selected node is in view when the tree opens
  useEffect(() => {
    const row = elementRef.current?.querySelector('[data-selected]');
    row?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expandedSet = (id, isExpanded) => {
    const setNext = new Set(idExpandedSet);
    if (isExpanded) setNext.add(id);
    else setNext.delete(id);
    if (isSearching) searchExpandedSet({ text: searchText, idSet: setNext });
    else idExpandedBrowseSetSet(setNext);
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
      {isSearching && rowList.length === 0 ? <p className="doc-source-tree-empty">Nothing matches.</p> : null}
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
            data-insert={node.insertMark || undefined}
            title={node.title || undefined}
            style={{ paddingInlineStart: `${2 + row.depth * 12}px`, '--doc-source-tree-indent': `${2 + row.depth * 12}px` }}
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
            {node.badge ? <span className="doc-badge doc-source-tree-badge" data-kind={node.badgeKind || undefined}>{node.badge}</span> : null}
            <span className="doc-source-tree-label">
              <LabelMatched label={String(node.label ?? '')} matchList={node.labelMatchList} />
            </span>
            {node.detail ? <span className="doc-source-tree-detail">{node.detail}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

// a label with the ranges a search matched highlighted
function LabelMatched({ label, matchList }) {
  if (!matchList || matchList.length === 0) return label;
  const partList = [];
  let indexEnd = 0;
  for (const [start, end] of matchList) {
    if (start > indexEnd) partList.push(label.slice(indexEnd, start));
    partList.push(<mark key={start} className="doc-source-tree-match">{label.slice(start, end)}</mark>);
    indexEnd = end;
  }
  if (indexEnd < label.length) partList.push(label.slice(indexEnd));
  return partList;
}

function NodeIcon({ kind, isExpanded }) {
  const props = { 'aria-hidden': true, size: 12, strokeWidth: 1.8, className: 'doc-source-tree-icon' };
  if (kind === 'dir' || kind === 'folder') return isExpanded ? <FolderOpenIcon {...props} /> : <FolderIcon {...props} />;
  if (kind === 'separator') return <Minus {...props} />;
  if (kind === 'block') return <Pilcrow {...props} />;
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
