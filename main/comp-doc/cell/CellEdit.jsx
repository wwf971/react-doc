import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  cellRangeRead, cellTokenAtGet, cellTokenEdgeArrivalGet, cellTokenSoleGet, cellTokenTextBuild,
} from '../../frontend/src/lib/doc-cell.js';
import { cellStyleOffsetMapGet, cellStyleTextBareGet } from '../../frontend/src/lib/doc-cell-style.js';
import { StoreContext } from '../../frontend/src/store/context.js';
import { EditSourceSurface } from '../edit/EditSourceSurface.jsx';
import { cellTokenCardIsOffered } from './cell-define.js';
import { CellStyleBar } from './CellStyleBar.jsx';
import { CellStyleSurface } from './cell-style-surface.js';
import { CellTokenCard } from './CellTokenCard.jsx';
import {
  cellSurfacePointIsOn, cellSurfaceRangeRectGet, cellSurfaceRangeReplace, cellSurfaceSelectionGet, cellSurfaceSelectionSet,
  cellSurfaceTextRead, cellTokenMarkDraw, cellTokenMarkErase,
} from './cell-surface.js';
import './Cell.css';

// A cell text typed (doc_page_impl_edit_cell.md#drawing-and-typing): its
// tokens written out, in the editing surface of the edit layer
// (EditSourceSurface kind "plain": the type and box of where it stands, never
// an <input>), with the slash mode of the cell: the actions of its token
// kinds, "/" anywhere but in a path, and "{{" opening a token at once.
//
// In a cell accepting styles (cell.isStyled) its words are drawn in their
// styles while typed (#typing-styled-text, cell-style-surface.js): the surface
// shows the bare text, no style markup, and words selected have their bar
// under them (CellStyleBar.jsx). The page's switch (DocCellStore.isStyleRaw)
// shows the text as it is kept instead, markup written out. Either way the
// text handed to the component is the text as kept, and the offsets it is told
// (a selection) count in the bare text.
//
// A token is one thing in the text as well (#a-token-marked-in-the-typed-text):
// a click on its words, or the caret coming to its edge from outside, marks it
// (a highlight of its words, the caret at its edge) and opens its card under it
// when its kind offers one there; Backspace or Delete then take it out whole,
// and a click on it again unmarks it, the caret inside its words, typed as any
// text. The card writes the token into the draft (tokenSet), or what the token
// names through the kind's own write.
//
// The component owns the draft and decides what the keys it receives mean
// (Enter saves in a one-line cell): the keys of the slash menu come first, then
// those of a marked token, and a key taken is defaultPrevented when it reaches
// the component. CellField is this with the opening, the saving and the leaving
// done.
//
//   cell                the cell of the component (useCell)
//   text, textVersion   the draft; rewritten when textVersion changes
//   selectionInitial    where the caret is when it opens: 'end' (default), 'start', 'all',
//                       { type: 'point', clientX, clientY } (the click that opened it)
//   isTokenMarkedOnOpen the token the opening click is on is marked at once, else the token
//                       that is the whole text: a cell of one value opens with its card
//   onSelectionChange({ start, end, text, isPlain })
//                       optional: what is selected in the text, as offsets into its
//                       bare text (what cellTextRangeReplace takes);
//                       isPlain: words only, no token in it in part or whole, so
//                       the component may make it a token of its own (a value kept
//                       in its data and named here: cellTextRangeReplace). the last
//                       selection inside the surface stays known after the focus left
//   the other props are EditSourceSurface's
export const CellEdit = observer(function CellEdit({
  cell,
  text,
  textVersion = 0,
  tag = 'div',
  className = '',
  selectionInitial = 'end',
  isTokenMarkedOnOpen = false,
  isLocked = false,
  isFocusedInitial = true,
  isTabInserted = false,
  ariaLabel = 'The text of the cell',
  onTextChange,
  onSelectionChange,
  onSubmitRequest,
  onCancelRequest,
}) {
  const surfaceRef = useRef(null);
  const cellStore = useContext(StoreContext)?.cellStore;
  // the text as kept, as last typed; a text set by code (textVersion) is the typed text from then on
  const textTypedRef = useRef(text);
  const textVersionRef = useRef(textVersion);
  // the token marked: { start, end } of its words in the typed text
  const [mark, markSet] = useState(null);
  const markRef = useRef(mark);
  markRef.current = mark;
  // what clears this surface's mark, the same function for its life: another surface marking a
  // token takes the mark of this one away (cellTokenMarkDraw)
  const markClearRef = useRef(() => markSet(null));
  if (textVersionRef.current !== textVersion) {
    textVersionRef.current = textVersion;
    textTypedRef.current = text;
    if (mark) markSet(null);
  }
  const textReport = (textNext) => {
    textTypedRef.current = textNext;
    onTextChange?.(textNext);
  };
  const textReportRef = useRef(textReport);
  textReportRef.current = textReport;
  // the surface of a cell accepting styles: its words drawn in their styles, or (isRaw, the
  // switch of the page) the text as kept. one for the life of the surface
  const isStyled = cell?.isStyled === true;
  const isRaw = cellStore?.isStyleRaw === true;
  const styleSurfaceRef = useRef(null);
  if (isStyled && !styleSurfaceRef.current) styleSurfaceRef.current = new CellStyleSurface({ cell, isRaw, onTextChange: (textNext) => textReportRef.current(textNext) });
  const styleSurface = isStyled ? styleSurfaceRef.current : null;
  if (styleSurface) styleSurface.cell = cell;
  // the tokens of what the surface shows (its offsets: a mark, a caret): a bare text, or the text
  // as kept while it is typed raw, where a segment's markup is words like any other
  const partListGet = () => {
    const tokenParse = cell?.tokenParse ?? cell?.parse;
    return tokenParse ? tokenParse(cellSurfaceTextRead(surfaceRef.current)) : [];
  };

  // a token marked: the caret at an edge of its words ('start' | 'end')
  const tokenMark = (token, edge) => {
    const element = surfaceRef.current;
    if (!element) return;
    cellSurfaceSelectionSet(element, edge === 'start' ? token.start : token.end);
    markSet({ start: token.start, end: token.end });
  };
  // the token whose words a point (a click) lies on
  const tokenAtPointGet = (point) => {
    const element = surfaceRef.current;
    return partListGet().find((part) => part.type === 'token' && cellSurfacePointIsOn(element, part.start, part.end, point));
  };
  // the edge of a token nearer to the caret a click left inside or beside it
  const edgeNearerGet = (token) => {
    const selection = cellSurfaceSelectionGet(surfaceRef.current);
    if (!selection) return 'end';
    return selection.start - token.start < token.end - selection.start ? 'start' : 'end';
  };

  // the mark drawn, and taken away with the surface
  useLayoutEffect(() => {
    const element = surfaceRef.current;
    if (mark && element) cellTokenMarkDraw(element, mark.start, mark.end, markClearRef.current);
    else cellTokenMarkErase(markClearRef.current);
  }, [mark]);
  useEffect(() => () => cellTokenMarkErase(markClearRef.current), []);

  // the styled surface listens while it is on the page, and follows the switch of the page
  useEffect(() => (styleSurface && surfaceRef.current ? styleSurface.attach(surfaceRef.current) : undefined), [styleSurface]);
  useEffect(() => {
    if (!styleSurface || styleSurface.isRaw === isRaw) return;
    // the offsets of a mark are those of the other way of showing the text
    markSet(null);
    styleSurface.rawSet(isRaw);
  }, [styleSurface, isRaw]);

  // a click on the words of a token marks it; on the token marked, its words are typed
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return undefined;
    // where the pointer went down, and what was marked then: the click is read after the browser
    // placed the caret
    let pointDown = null;
    const pointerDownHandle = (event) => {
      pointDown = event.button === 0 ? { clientX: event.clientX, clientY: event.clientY, markBefore: markRef.current } : null;
    };
    const clickHandle = () => {
      const point = pointDown;
      pointDown = null;
      if (!point) return;
      const selection = cellSurfaceSelectionGet(element);
      // words selected by a drag: no token is one thing then
      if (!selection || !selection.isCollapsed) {
        markSet(null);
        return;
      }
      const token = tokenAtPointGet(point);
      if (!token) {
        markSet(null);
        return;
      }
      const { markBefore } = point;
      if (markBefore && markBefore.start === token.start && markBefore.end === token.end) {
        markSet(null);
        return;
      }
      tokenMark(token, edgeNearerGet(token));
    };
    // the focus going elsewhere than the card unmarks it (the card's own pointer handling closes it
    // for a click outside)
    const focusOutHandle = (event) => {
      const next = event.relatedTarget;
      if (next && !next.closest?.('.doc-cell-token-card')) markSet(null);
    };
    // words selected however it is done (keys, a script): no token is one thing then, and its
    // card would stand where the bar of the selection does
    const selectionHandle = () => {
      if (!markRef.current) return;
      const selection = cellSurfaceSelectionGet(element);
      if (selection && !selection.isCollapsed) markSet(null);
    };
    element.addEventListener('pointerdown', pointerDownHandle);
    element.addEventListener('click', clickHandle);
    element.addEventListener('focusout', focusOutHandle);
    document.addEventListener('selectionchange', selectionHandle);
    return () => {
      element.removeEventListener('pointerdown', pointerDownHandle);
      element.removeEventListener('click', clickHandle);
      element.removeEventListener('focusout', focusOutHandle);
      document.removeEventListener('selectionchange', selectionHandle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the cell opened by a click on a token, or a cell of one token: that token marked at once. the
  // surface has placed its caret by now (its effects run before these)
  useEffect(() => {
    if (!isTokenMarkedOnOpen || !surfaceRef.current) return;
    const point = selectionInitial?.type === 'point' ? selectionInitial : undefined;
    const tokenOfPoint = point ? tokenAtPointGet(point) : undefined;
    const token = tokenOfPoint ?? cellTokenSoleGet(partListGet());
    if (token) tokenMark(token, tokenOfPoint ? edgeNearerGet(token) : 'end');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the keys of a token come first, then those of the styles (a shortcut, the side of the
  // caret between two segments, undo)
  const keyDownFirst = (event) => tokenKeyDown(event) || (styleSurface?.keyDown(event) ?? false);

  // the keys of a token marked, and the caret coming to the edge of one
  const tokenKeyDown = (event) => {
    const element = surfaceRef.current;
    const markNow = markRef.current;
    if (!element) return false;
    if (markNow) {
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) return false;
      if (event.key === 'Backspace' || event.key === 'Delete') {
        // the whole token taken out, as a typed delete: Undo brings it back
        event.preventDefault();
        markSet(null);
        cellSurfaceSelectionSet(element, markNow.start, markNow.end);
        document.execCommand('delete');
        return true;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        markSet(null);
        return true;
      }
      // anything else does what it does (the caret moves, a character is typed at the edge), unmarked
      markSet(null);
      return false;
    }
    const isStep = (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
    if (!isStep) return false;
    const selection = cellSurfaceSelectionGet(element);
    if (!selection?.isCollapsed) return false;
    const direction = event.key === 'ArrowLeft' ? 'left' : 'right';
    const token = cellTokenEdgeArrivalGet(partListGet(), selection.start, direction);
    if (!token) return false;
    event.preventDefault();
    tokenMark(token, direction === 'left' ? 'end' : 'start');
    return true;
  };

  // the token written again from its card, in the draft (or taken out): the surface changed where it
  // is, the card kept open on the token as it is now written
  const tokenSetInSurface = (token, change) => {
    const element = surfaceRef.current;
    if (!element) return;
    const rawNext = change === null ? '' : cellTokenTextBuild(token, change);
    if (rawNext === token.raw) return;
    if (styleSurface && !styleSurface.isRaw) styleSurface.rangeReplace(token.start, token.end, rawNext);
    else {
      cellSurfaceRangeReplace(element, token.start, token.end, rawNext);
      textReport(cellSurfaceTextRead(element));
    }
    markSet(change === null ? null : { start: token.start, end: token.start + rawNext.length });
  };

  // what is selected, told in the offsets of the bare text. typed raw, the surface counts in
  // the text as kept: the offsets are brought over, and a selection reaching into the markup
  // of a segment is no words only
  const selectionHandle = onSelectionChange ? (range) => {
    const textShown = cellSurfaceTextRead(surfaceRef.current);
    let { start, end } = range;
    let textBare = textShown;
    let isWhole = true;
    if (styleSurface?.isRaw) {
      const map = cellStyleOffsetMapGet(textShown);
      textBare = cellStyleTextBareGet(textShown);
      start = map.bareOf(range.start);
      end = map.bareOf(range.end);
      isWhole = textBare.slice(start, end) === textShown.slice(range.start, range.end);
    }
    const tokenParse = cell?.tokenParse ?? cell?.parse;
    const read = cellRangeRead(tokenParse ? tokenParse(textBare) : [], start, end, textBare);
    onSelectionChange({ start, end, text: read.text, isPlain: read.isPlain && isWhole });
  } : undefined;

  const markToken = mark ? cellTokenAtGet(partListGet(), mark.start, mark.end) : undefined;
  const isCardShown = Boolean(markToken) && cellTokenCardIsOffered(markToken.kind, 'surface');
  return (
    <>
      <EditSourceSurface
        tag={tag}
        kind="plain"
        className={`doc-cell-edit${className ? ` ${className}` : ''}`}
        text={text}
        textVersion={textVersion}
        selectionInitial={selectionInitial}
        slash={cell?.slash}
        isLocked={isLocked}
        isFocusedInitial={isFocusedInitial}
        isTabInserted={isTabInserted}
        ariaLabel={ariaLabel}
        surfaceRef={surfaceRef}
        codec={styleSurface ?? undefined}
        onKeyDownFirst={keyDownFirst}
        onTextChange={(textNext) => {
          // typed: a token marked is one no more (its card writes through tokenSetInSurface)
          if (markRef.current) markSet(null);
          textReport(textNext);
        }}
        onSelectionChange={selectionHandle}
        onSubmitRequest={onSubmitRequest}
        onCancelRequest={onCancelRequest}
      />
      {isCardShown ? (
        <CellTokenCard
          key={`${markToken.start}:${markToken.name}`}
          placement="below"
          where="surface"
          part={markToken}
          cell={cell}
          anchorRectGet={() => cellSurfaceRangeRectGet(surfaceRef.current, markToken.start, markToken.end)}
          observeElementGet={() => surfaceRef.current}
          placeRectGet={() => surfaceRef.current?.getBoundingClientRect()}
          isInsideGet={(target) => Boolean(surfaceRef.current?.contains(target))}
          tokenSet={(change) => tokenSetInSurface(markToken, change)}
          close={(how) => {
            markSet(null);
            // Escape, or the close button: the author goes on typing, the caret at the token's end
            if (how !== 'outside' && surfaceRef.current) {
              surfaceRef.current.focus({ preventScroll: true });
              cellSurfaceSelectionSet(surfaceRef.current, markToken.end);
            }
          }}
        />
      ) : null}
      {styleSurface ? <CellStyleBar surface={styleSurface} cell={cell} isRaw={isRaw} isLocked={isLocked} /> : null}
    </>
  );
});
