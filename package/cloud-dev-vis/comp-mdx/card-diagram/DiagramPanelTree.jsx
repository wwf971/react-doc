import { useEffect, useLayoutEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { ChevronDown, ChevronLeft, ChevronRight, Search, Square, X } from '../../../../main/frontend/UICommon.js';
import { textHighlight } from '../../../../main/comp-doc/object/ObjectSearchPanel.jsx';
import { ValueMenu } from './DiagramValueControls.jsx';
import { TREE_PAGE_SIZE_LIST, treeWordListOf } from './DiagramPanelTreeData.js';

// A tree of the panel (card-diagram-impl.md#the-paged-tree): the rows a model and the state of the
// tree make (DiagramPanelTreeData.js, DiagramPanelTreeStore.js), drawn tight as a file explorer
// lists files. The rows are one height, so only those in view are drawn (and a few around them).
//
//   tree             the DiagramPanelTreeStore
//   model            the tab's model; itemGet(key) answers what a row draws:
//                    { kind, label, segment?, kindLabel?, summary?, Icon?, isNameDefault?,
//                      markList?: [{ id, label, title?, tone? }], isDimmed? }
//   selectedKey      the item selected (marked, kept in sight by the search)
//   markedKey        an item marked another way (the scene edited)
//   onItemClick(key, event), onItemContext(key, event)   a click; a right-click (a menu of the tab)
//   onCursor(key)    the keys moved to an item (the tab says what that does: select, focus)
//   onItemDelete(key, event)   Delete or Backspace on the item of the cursor: the tab takes it away
//                    (the removal of the editor, with its question: card-diagram-impl.md#removing-what-is-selected)
//   dragTypeGet(key) the type of data a row dragged out carries, null when it is not dragged; the
//                    data is the key
export const TREE_ROW_HEIGHT = 22;
// a pager row is two lines: the pages, the range and the page size; the filter of the level
export const TREE_PAGER_HEIGHT = 46;
const ROW_OVERSCAN = 8;
const rowHeightOf = row => (row.type === 'pager' ? TREE_PAGER_HEIGHT : TREE_ROW_HEIGHT);
const INDENT = 14;

export const DiagramPanelTree = observer(function DiagramPanelTree({ tree, model, selectedKey = null, markedKey = null, onItemClick, onItemContext, onCursor, onItemDelete, dragTypeGet, emptyText, ariaLabel }) {
	const hostRef = useRef(null);
	const rowList = tree.rowListGet(model, selectedKey);
	const wordList = tree.wordList;
	// where each row stands: rows are one height, a pager row two lines
	const topList = [];
	let height = 0;
	for (const row of rowList) { topList.push(height); height += rowHeightOf(row); }
	// the box of the list: its height and where it is scrolled decide the rows drawn
	useLayoutEffect(() => {
		const host = hostRef.current;
		if (!host) return undefined;
		tree.viewSet({ viewHeight: host.clientHeight });
		if (Math.abs(host.scrollTop - tree.scrollTop) > 1) host.scrollTop = tree.scrollTop;
		const observer = new ResizeObserver(() => tree.viewSet({ viewHeight: host.clientHeight }));
		observer.observe(host);
		return () => observer.disconnect();
	}, [tree]);
	// a row asked for (a reveal): brought into view only when it is out of view, centered then
	const request = tree.scrollRequest;
	useEffect(() => {
		const host = hostRef.current;
		if (!request || !host) return;
		tree.scrollRequestTake();
		const index = rowList.findIndex(row => row.key === request.key);
		if (index < 0) return;
		const top = topList[index];
		if (top >= host.scrollTop && top + TREE_ROW_HEIGHT <= host.scrollTop + host.clientHeight) return;
		host.scrollTop = Math.max(0, top - (host.clientHeight - TREE_ROW_HEIGHT) / 2);
		tree.viewSet({ scrollTop: host.scrollTop });
	}, [request?.token]); // eslint-disable-line react-hooks/exhaustive-deps
	let first = 0;
	while (first < rowList.length - 1 && topList[first + 1] <= tree.scrollTop) first += 1;
	let last = first;
	while (last < rowList.length && topList[last] < tree.scrollTop + tree.viewHeight) last += 1;
	first = Math.max(0, first - ROW_OVERSCAN);
	last = Math.min(rowList.length, last + ROW_OVERSCAN);
	const itemRowList = rowList.filter(row => row.type === 'item');
	// the keys: up and down move over items (pager rows are skipped), right opens or goes in, left
	// closes or goes up, Home and End, Page Up and Page Down turn the page of the level; Enter clicks
	const keyDown = (event) => {
		if (event.target.tagName === 'INPUT') return;
		const cursorKey = selectedKey && itemRowList.some(row => row.key === selectedKey) ? (tree.cursorKey && itemRowList.some(row => row.key === tree.cursorKey) ? tree.cursorKey : selectedKey) : tree.cursorKey;
		const index = itemRowList.findIndex(row => row.key === cursorKey);
		const row = itemRowList[index];
		const move = (target) => {
			if (!target) return;
			event.preventDefault();
			tree.cursorSet(target.key);
			tree.reveal(target.key, model);
			onCursor?.(target.key);
		};
		if (event.key === 'ArrowDown') move(itemRowList[index < 0 ? 0 : Math.min(itemRowList.length - 1, index + 1)]);
		else if (event.key === 'ArrowUp') move(itemRowList[index < 0 ? 0 : Math.max(0, index - 1)]);
		else if (event.key === 'Home') move(itemRowList[0]);
		else if (event.key === 'End') move(itemRowList[itemRowList.length - 1]);
		else if (event.key === 'ArrowRight' && row) {
			event.preventDefault();
			if (row.hasChildren && !row.isExpanded) tree.toggle(row.key, true, model);
			else if (row.isExpanded) move(itemRowList[index + 1]);
		} else if (event.key === 'ArrowLeft' && row) {
			event.preventDefault();
			if (row.isExpanded) tree.toggle(row.key, false, model);
			else move(itemRowList.find(item => item.key === model.parentKeyGet(row.key)));
		} else if ((event.key === 'PageDown' || event.key === 'PageUp') && row) {
			const parentKey = model.parentKeyGet(row.key) ?? '';
			const pager = rowList.find(item => item.type === 'pager' && item.parentKey === parentKey);
			if (!pager) return;
			event.preventDefault();
			tree.pageSet(parentKey, pager.page + (event.key === 'PageDown' ? 1 : -1));
		} else if (event.key === 'Enter' && row) {
			event.preventDefault();
			onItemClick?.(row.key, event);
		} else if ((event.key === 'Delete' || event.key === 'Backspace') && row && onItemDelete && !event.ctrlKey && !event.metaKey && !event.altKey) {
			event.preventDefault();
			event.stopPropagation();
			if (!event.repeat) onItemDelete(row.key, event);
		} else if (event.key === 'Escape' && tree.search) {
			event.preventDefault();
			event.stopPropagation();
			tree.searchSet('');
		}
	};
	return (
		<div ref={hostRef} className="doc-vis-tree" role="tree" aria-label={ariaLabel} tabIndex={0} onKeyDown={keyDown} onScroll={event => tree.viewSet({ scrollTop: event.currentTarget.scrollTop })}>
			{rowList.length === 0 ? <p className="doc-note doc-vis-panel-empty">{wordList.length ? `Nothing matches “${tree.search.trim()}”.` : emptyText}</p> : null}
			<div className="doc-vis-tree-rows" style={{ height }}>
				{rowList.slice(first, last).map((row, offset) => {
					const top = topList[first + offset];
					return row.type === 'pager'
						? <TreePagerRow key={row.key} tree={tree} row={row} top={top} />
						: <TreeItemRow key={row.key} tree={tree} model={model} row={row} top={top} wordList={wordList} isSelected={row.key === selectedKey} isMarked={row.key === markedKey} isCursor={row.key === tree.cursorKey && row.key !== selectedKey} onItemClick={onItemClick} onItemContext={onItemContext} dragType={dragTypeGet?.(row.key) ?? null} />;
				})}
			</div>
		</div>
	);
});

const TreeItemRow = observer(function TreeItemRow({ tree, model, row, top, wordList, isSelected, isMarked, isCursor, onItemClick, onItemContext, dragType }) {
	const item = model.itemGet(row.key) ?? { label: row.key };
	const Icon = item.Icon ?? Square;
	const summary = item.summary ?? (row.hasChildren && !row.isExpanded ? String(row.childCount) : '');
	return (
		<div role="treeitem" data-key={row.key} aria-selected={isSelected} aria-expanded={row.hasChildren ? row.isExpanded : undefined}
			className={`doc-vis-tree-item is-${item.kind ?? 'item'}${isSelected ? ' is-selected' : ''}${isMarked ? ' is-marked' : ''}${isCursor ? ' is-cursor' : ''}${item.isDimmed ? ' is-dimmed' : ''}`}
			style={{ top, paddingLeft: 6 + row.depth * INDENT }}
			draggable={Boolean(dragType)}
			onDragStart={dragType ? (event) => { event.dataTransfer.setData(dragType, row.key); event.dataTransfer.setData('text/plain', item.label ?? row.key); event.dataTransfer.effectAllowed = 'copyLink'; } : undefined}
			onClick={(event) => { tree.cursorSet(row.key); onItemClick?.(row.key, event); }}
			onContextMenu={onItemContext ? (event) => { tree.cursorSet(row.key); onItemContext(row.key, event); } : undefined}>
			<button type="button" className="doc-vis-tree-fold" tabIndex={-1} aria-label={row.isExpanded ? 'Fold' : 'Unfold'} style={{ visibility: row.hasChildren ? 'visible' : 'hidden' }} onClick={(event) => { event.stopPropagation(); tree.toggle(row.key, undefined, model); }}>
				{row.isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
			</button>
			<Icon size={12} aria-hidden="true" className="doc-vis-tree-icon" />
			<span className={`doc-vis-tree-label${item.isNameDefault ? ' is-default' : ''}`} title={item.title ?? item.label}>{textHighlight(item.label, wordList)}</span>
			{item.segment ? <span className="doc-vis-tree-segment">{textHighlight(item.segment, wordList)}</span> : null}
			{item.kindLabel ? <span className="doc-vis-tree-kind">{textHighlight(item.kindLabel, wordList)}</span> : null}
			{(item.markList ?? []).map(mark => <span key={mark.id} className={`doc-vis-tree-mark${mark.tone ? ` is-${mark.tone}` : ''}`} title={mark.title ?? mark.label}>{mark.Icon ? <mark.Icon size={10} aria-hidden="true" /> : null}{mark.label}</span>)}
			{summary ? <span className="doc-vis-tree-summary">{textHighlight(summary, wordList)}</span> : null}
		</div>
	);
});

// the first row of a paged level: the pages (previous, the page typed, next), what is shown of how
// many, the items per page, and the filter of the level
const TreePagerRow = observer(function TreePagerRow({ tree, row, top }) {
	const pageGo = page => tree.pageSet(row.parentKey, Math.min(row.pageCount - 1, Math.max(0, page)));
	const pageTyped = (event) => {
		const page = Number(event.currentTarget.value);
		if (Number.isFinite(page) && page >= 1) pageGo(page - 1);
		else event.currentTarget.value = String(row.page + 1);
	};
	const isFiltered = Boolean(treeWordListOf(row.filter).length);
	return (
		<div className="doc-vis-tree-pager" style={{ top, paddingLeft: 6 + row.depth * INDENT + 16 }} role="group" aria-label="Pages" onClick={event => event.stopPropagation()}>
			<span className="doc-vis-tree-pager-line">
			<span className="doc-button-group doc-vis-tree-pages">
				<button type="button" title="Previous page" aria-label="Previous page" disabled={row.page === 0} onClick={() => pageGo(row.page - 1)}><ChevronLeft size={11} /></button>
				<input key={`${row.page}:${row.pageCount}`} type="text" inputMode="numeric" className="doc-vis-tree-page-field" defaultValue={String(row.page + 1)} aria-label={`Page, of ${row.pageCount}`} title="The page: type a number, then Enter"
					onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); pageTyped(event); } else if (event.key === 'Escape') { event.currentTarget.value = String(row.page + 1); event.currentTarget.blur(); } }} onBlur={pageTyped} onFocus={event => event.currentTarget.select()} />
				<span className="doc-vis-tree-page-count">/ {row.pageCount}</span>
				<button type="button" title="Next page" aria-label="Next page" disabled={row.page >= row.pageCount - 1} onClick={() => pageGo(row.page + 1)}><ChevronRight size={11} /></button>
			</span>
			<span className="doc-vis-tree-range" title={`Items ${row.from} to ${row.to} of ${row.total}${isFiltered ? ` that match, of ${row.countLevel}` : ''}`}>{row.total ? `${row.from}–${row.to}` : 'none'}</span>
			<span className="doc-vis-tree-page-size" title="Items per page">
				<ValueMenu label="Items per page" value={String(tree.pageSize)} values={TREE_PAGE_SIZE_LIST.map(String)} onChange={value => tree.pageSizeSet(Number(value))} />
			</span>
			</span>
			<span className="doc-vis-tree-pager-line">
			<span className="doc-vis-tree-filter">
				<Search size={11} aria-hidden="true" />
				<input type="text" value={row.filter} placeholder="Find among them" aria-label="Find among the items of this level" spellCheck={false} onChange={event => tree.filterSet(row.parentKey, event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && row.filter) { event.stopPropagation(); tree.filterSet(row.parentKey, ''); } }} />
				{row.filter ? <button type="button" className="doc-button-icon" title="Clear" aria-label="Clear the filter" onClick={() => tree.filterSet(row.parentKey, '')}><X size={10} /></button> : null}
			</span>
			<span className="doc-vis-tree-filter-count">{isFiltered ? `${row.total} of ${row.countLevel}` : `${row.countLevel} in all`}</span>
			</span>
		</div>
	);
});

// the search of the whole tree, for the head of the panel
export const DiagramPanelTreeSearch = observer(function DiagramPanelTreeSearch({ tree, placeholder, foundCount = null }) {
	return (
		<span className="doc-vis-panel-search">
			<Search size={12} aria-hidden="true" />
			<input type="text" value={tree.search} placeholder={placeholder} aria-label={placeholder} spellCheck={false} onChange={event => tree.searchSet(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && tree.search) { event.stopPropagation(); tree.searchSet(''); } }} />
			{tree.search && foundCount !== null ? <span className="doc-vis-panel-search-count">{foundCount} found</span> : null}
			{tree.search ? <button type="button" className="doc-button-icon" title="Clear" aria-label="Clear the search" onClick={() => tree.searchSet('')}><X size={11} /></button> : null}
		</span>
	);
});
