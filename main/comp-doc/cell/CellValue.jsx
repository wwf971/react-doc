import { useContext, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { cellTextRangeReplace, cellTextStyledParse, cellTokenTextBuild } from '../../frontend/src/lib/doc-cell.js';
import { cellStyleTextIsStyled } from '../../frontend/src/lib/doc-cell-style.js';
import { StoreContext } from '../../frontend/src/store/context.js';
import { cellTokenCardIsOffered } from './cell-define.js';
import { CellTokenCard } from './CellTokenCard.jsx';
import { CELL_SEG_CLASS } from './cell-style-surface.js';
import './Cell.css';

// A cell text drawn (doc_page_impl_edit_cell.md#drawing-and-typing): its text
// as it is, and every token drawn by its kind: a link by the navigation
// layer, a view of an object by the view of its types, a value of the
// component's own data as that value. Words written in a style (a styled
// segment, #styles) are drawn in it, in an element of their own. It adds no
// other element, so the text takes the type and the box of where it stands;
// with a className it is one span.
//
//   cell        the cell of the component (useCell)
//   text        the text kept in the data
//   textEmpty   what is drawn for an empty text (a placeholder, a dash); default nothing
//
// A token whose kind offers its card where it is drawn (cardPlaceList 'value')
// can be selected there and changed from the card beside it
// (#a-token-selected-where-it-is-drawn), in a value that says it can be edited:
//
//   isEditable            whether a click on such a token selects it
//   cellKey               the value, unique on the page while it is drawn: which
//                         token is selected is the store's (DocCellStore.token)
//   onTextChange(text)    the text with the token written again or taken out:
//                         the component saves it, as it saves a typed text
export const CellValue = observer(function CellValue({ cell, text, textEmpty = null, className = '', isEditable = false, cellKey = '', onTextChange }) {
  const value = String(text ?? '');
  if (value === '') return textEmpty;
  const partList = cell.parse(value);
  const isTokenSelectable = isEditable && cellKey !== '' && typeof onTextChange === 'function';
  const content = partList.map((part) => {
    if (part.type === 'text') {
      // plain words are text; styled ones stand in an element drawn in their style
      return part.style ? <span key={`seg:${part.start}`} className={CELL_SEG_CLASS} style={cell.styleCssGet?.(part.style)}>{part.text}</span> : part.text;
    }
    // keyed by its place and kind, not by how it is written: a token changed from its card (a
    // parameter set) stays the same element, so its card stays open where it is
    return <CellToken key={`${part.start}:${part.name}`} part={part} cell={cell} text={value} cellKey={isTokenSelectable ? cellKey : ''} onTextChange={onTextChange} />;
  });
  return className ? <span className={className}>{content}</span> : content;
});

// one token, drawn by its kind; a kind that only says a text (or nothing) is
// text. with a card and a value that can be edited, a click selects it
const CellToken = observer(function CellToken({ part, cell, text, cellKey, onTextChange }) {
  const cellStore = useContext(StoreContext)?.cellStore;
  const elementRef = useRef(null);
  const Render = part.kind.Render;
  // read here, so observed: the token is drawn again when the context of its cell has changed
  // (use-cell.js). the context is one object and the token's own props stay the same, so
  // nothing else would say it; handed on to the Render, which a memo may keep as well
  const contextVersion = cell.contextVersionGet?.() ?? 0;
  const isSelectable = cellTokenCardIsOffered(part.kind, 'value') && Boolean(cellKey && cellStore);
  const isSelected = isSelectable && cellStore.tokenIsSelected(cellKey, part.start);
  if (!Render && !isSelectable) {
    const textPlain = part.kind.textGet?.(part, cell);
    return textPlain === undefined || textPlain === null ? part.raw : tokenTextDraw(cell, String(textPlain));
  }
  const textPlain = Render ? undefined : part.kind.textGet?.(part, cell);
  return (
    <span
      ref={elementRef}
      className="doc-cell-token"
      data-cell-token={part.name}
      data-selectable={isSelectable ? '' : undefined}
      data-selected={isSelected ? '' : undefined}
      // the click selects the token before anything inside it, or the value around it, takes
      // it. its card is a child of this element for React though it is drawn elsewhere (a
      // portal), so a click in the card passes here too and is left to the card
      onClickCapture={isSelectable ? (event) => {
        if (!elementRef.current?.contains(event.target)) return;
        event.stopPropagation();
        event.preventDefault();
        cellStore.tokenSelect(cellKey, part.start);
      } : undefined}
    >
      {Render ? <Render token={part} cell={cell} contextVersion={contextVersion} /> : (textPlain === undefined || textPlain === null ? part.raw : tokenTextDraw(cell, String(textPlain)))}
      {isSelected ? (
        <CellTokenCard
          anchorRectGet={() => elementRef.current?.getBoundingClientRect()}
          observeElementGet={() => elementRef.current}
          isInsideGet={(target) => Boolean(elementRef.current?.contains(target))}
          placement="right"
          where="value"
          part={part}
          cell={cell}
          close={() => cellStore.tokenSelectClear(cellKey)}
          tokenSet={(change) => {
            const rawNext = change === null ? '' : cellTokenTextBuild(part, change);
            if (change === null) cellStore.tokenSelectClear(cellKey);
            if (rawNext !== part.raw) onTextChange(cellTextRangeReplace(text, part.start, part.end, rawNext));
          }}
        />
      ) : null}
    </span>
  );
});

// the text a token reads, drawn: a value kept elsewhere (a text of a profile, typed in a cell of
// its own) may be written in styles, and is drawn in them here too. tokens are not read in it
function tokenTextDraw(cell, text) {
  if (!cell.isStyled || !cellStyleTextIsStyled(text)) return text;
  return cellTextStyledParse(text, []).map((piece) => (piece.style
    ? <span key={`seg:${piece.start}`} className={CELL_SEG_CLASS} style={cell.styleCssGet?.(piece.style)}>{piece.text}</span>
    : piece.text));
}
