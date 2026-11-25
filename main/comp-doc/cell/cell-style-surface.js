import { action, observable } from 'mobx';
import {
  cellStyleCaretInsertStyleGet, cellStyleCaretIsBetween, cellStyleCaretSideDefaultGet, cellStyleCaretStyleGet, cellStyleClean, cellStyleInsertRangeGet,
  cellStyleIsEmpty, cellStyleMerge, cellStyleOffsetMapGet, cellStyleRangeChange, cellStyleRangeSet, cellStyleRangeStateGet, cellStyleSegAtGet,
  cellStyleSegListLengthGet, cellStyleSegListNormalize, cellStyleSegListRead, cellStyleSegListSplice, cellStyleSegListTextGet, cellStyleSpecRead,
  cellStyleSpecWrite, cellStyleTextWrite,
} from '../../frontend/src/lib/doc-cell-style.js';
import { cellStyleShortcutKindGet } from './cell-style-define.js';
import { cellSurfaceCaretSet, cellSurfaceRangeBuild, cellSurfaceSelectionGet, cellSurfaceSelectionSet } from './cell-surface.js';

// The typed text of a cell with its styles drawn (doc_page_impl_edit_cell.md#typing-styled-text):
// the surface of a cell accepting styles shows its bare text, the words of a styled segment
// standing in an element of their own, drawn in their style. Tokens are written out as before,
// and the style markup is nowhere in what is typed: the caret never stands in it.
//
//   the text as kept     {{name}} は [[強み|b]] です
//   the surface          {{name}} は <span data-cell-style="b">強み</span> です
//
// The browser types (so an input method composes as in any text), and after every change the
// surface is read back into the model (segments, lib/doc-cell-style.js), which decides what
// was typed in which style, and is written again only where the browser left another shape:
//
//   a character typed            takes the style the caret is in: its side where two segments
//                                meet, else the style chosen for what comes next (pending)
//   a token completed, a line    no style under it: the segment is cut there
//   break, in a segment
//   a style set on a selection   a change of the model, written to the surface
//
// One surface, both ways of typing: with isRaw the text is written out as it is kept, markup
// and all, and this only follows its selection (the bar of the cell has the switch).
//
// It is the codec of an EditSourceSurface ({ write, read, insert }), and tells its owner the
// text when a change was not typed (a style set, an undo): onTextChange(text as kept).

export const CELL_SEG_CLASS = 'doc-cell-seg';
export const CELL_SEG_ATTRIBUTE = 'data-cell-style';
export const CELL_SEG_CURRENT_HIGHLIGHT = 'doc-cell-seg-current';

const HISTORY_SIZE_MAX = 200;
// characters typed one after another within this time are one step of undo
const HISTORY_TYPE_GAP_MS = 1000;

export class CellStyleSurface {
  // the cell (use-cell.js): its token kinds (what is a token in the typed text) and style kinds
  cell;
  isRaw = false;
  element = null;
  onTextChange = undefined;
  // the text as last read or written, as the kit keeps it (styled mode)
  segList = [];
  // the last selection seen inside the surface: { start, end }, in the offsets of what it shows
  selection = null;
  // where two segments meet, which one the caret is with: 'before' | 'after'
  side = 'before';
  // the style of what is typed next, chosen at a caret; null: the caret's side says it
  pending = null;
  // the arrow key just pressed ('left' | 'right'): the caret arriving says its side by it
  arrow = null;
  isComposing = false;
  // the pointer is down in the surface (words being selected by a drag): the bar waits
  isPointerDown = false;
  undoList = [];
  redoList = [];
  historyKind = '';
  historyTime = 0;
  // where the caret was left by the last change typed: a change going on from there is the same burst
  historyCaret = -1;
  // what the bar of the cell draws (CellStyleBar.jsx), observed:
  //   selection     { start, end } while words are selected in the focused surface, else null
  //   style         what those words share of style; at a caret: what is typed next
  //   isStylable    the selection holds a word a style can be given to
  //   pickName      the value kind whose values are listed under the bar ('' none)
  state = observable({ selection: null, style: {}, isStylable: false, pickName: '', version: 0 }, {}, { deep: false });
  // an element of the bar: the focus being in it keeps the bar, and the selection it acts on
  barElement = null;

  constructor({ cell, isRaw = false, onTextChange } = {}) {
    this.cell = cell;
    this.isRaw = isRaw;
    this.onTextChange = onTextChange;
  }

  // ---------- the codec of the surface ----------

  // a text as kept written into the surface
  write = (element, text) => {
    this.element = element;
    if (this.isRaw) {
      // as a surface without a codec writes it: one more line break after a last one
      element.textContent = text.endsWith('\n') ? `${text}\n` : text;
      this.segList = [];
    } else {
      this.segList = this.normalize(cellStyleSegListRead(text));
      cellStyleSurfaceWrite(element, this.segList, this.cell.styleCssGet);
    }
    this.selection = null;
    this.pending = null;
    this.stateUpdate();
  };

  // the text of the surface as it is kept. after a change that is not a composition going on,
  // the model follows: what was typed takes its style, no style stays where none may be, and
  // the surface is written again when it does not show the model
  read = (element, { isComposing = false } = {}) => {
    if (this.isRaw) return surfaceTextRead(element);
    if (isComposing) return cellStyleTextWrite(this.normalize(cellStyleSurfaceRead(element)));
    const segListRead = cellStyleSurfaceRead(element);
    const textOld = cellStyleSegListTextGet(this.segList);
    const textNew = cellStyleSegListTextGet(segListRead);
    const caret = cellSurfaceSelectionGet(element);
    let segList = segListRead;
    let isInserted = false;
    if (caret?.isCollapsed) {
      const inserted = cellStyleInsertRangeGet(textOld, textNew, caret.start);
      if (inserted && inserted.end > inserted.start) {
        segList = cellStyleRangeSet(segList, inserted.start, inserted.end, this.insertStyleGet(inserted.start, inserted.start + inserted.lengthOld));
        isInserted = true;
      }
    }
    segList = this.normalize(segList);
    const textKeptOld = cellStyleTextWrite(this.segList);
    const textKept = cellStyleTextWrite(segList);
    if (!cellStyleSurfaceShapeIs(element, segList)) {
      cellStyleSurfaceWrite(element, segList, this.cell.styleCssGet);
      if (caret) cellSurfaceSelectionSet(element, Math.min(caret.start, textNew.length), Math.min(caret.end, textNew.length));
    }
    if (textKept !== textKeptOld) this.historyPush(isInserted ? 'type' : 'delete');
    this.segList = segList;
    if (caret) {
      this.selection = { start: Math.min(caret.start, textNew.length), end: Math.min(caret.end, textNew.length) };
      // what was typed is behind the caret: it goes on in it
      if (isInserted) this.side = 'before';
    }
    if (textKept !== textKeptOld) {
      this.pending = null;
      this.historyCaret = this.selection ? this.selection.start : -1;
    }
    this.stateUpdate();
    return textKept;
  };

  // a text put in the place of the selection as if typed (a paste, a line break): the model is
  // changed and the surface written, so several lines arrive as lines whatever the browser
  // makes of them. the surface is told by an input event, as after a key
  insert = (element, text) => {
    if (this.isRaw) {
      document.execCommand('insertText', false, text);
      return;
    }
    const selection = cellSurfaceSelectionGet(element) ?? this.selection;
    if (!selection || text === '') return;
    const styleTyped = this.insertStyleGet(selection.start, selection.end);
    this.historyPush('insert');
    this.segList = this.normalize(cellStyleSegListSplice(this.segList, selection.start, selection.end, [{ text, style: styleTyped }]));
    cellStyleSurfaceWrite(element, this.segList, this.cell.styleCssGet);
    const caret = selection.start + text.length;
    cellSurfaceSelectionSet(element, caret);
    this.selection = { start: caret, end: caret };
    this.side = cellStyleCaretSideDefaultGet(this.caretStyleGet(caret));
    // a line break keeps the style being typed: the next line goes on in it
    this.pending = text === '\n' && !cellStyleIsEmpty(styleTyped) ? styleTyped : null;
    this.stateUpdate();
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  };

  // ---------- its life ----------

  // the surface is on the page: what it listens to. answers what takes it away
  attach(element) {
    this.element = element;
    const selectionHandle = () => this.selectionSync();
    const beforeInputHandle = (event) => this.beforeInput(event);
    const compositionStartHandle = () => { this.isComposing = true; };
    const compositionEndHandle = () => { this.isComposing = false; };
    const focusHandle = () => this.stateUpdate();
    // the focus leaving the surface is somewhere only a turn later (in the bar, or gone)
    let focusOutTimer;
    const focusOutHandle = () => {
      clearTimeout(focusOutTimer);
      focusOutTimer = setTimeout(focusHandle, 0);
    };
    const pointerDownHandle = () => {
      this.arrow = null;
      this.isPointerDown = true;
      this.stateUpdate();
    };
    const pointerUpHandle = () => {
      if (!this.isPointerDown) return;
      this.isPointerDown = false;
      this.stateUpdate();
    };
    element.addEventListener('pointerdown', pointerDownHandle);
    document.addEventListener('pointerup', pointerUpHandle, true);
    document.addEventListener('pointercancel', pointerUpHandle, true);
    document.addEventListener('selectionchange', selectionHandle);
    document.addEventListener('focusin', focusHandle);
    element.addEventListener('beforeinput', beforeInputHandle);
    element.addEventListener('compositionstart', compositionStartHandle);
    element.addEventListener('compositionend', compositionEndHandle);
    element.addEventListener('focusout', focusOutHandle);
    return () => {
      clearTimeout(focusOutTimer);
      document.removeEventListener('selectionchange', selectionHandle);
      document.removeEventListener('focusin', focusHandle);
      element.removeEventListener('beforeinput', beforeInputHandle);
      element.removeEventListener('compositionstart', compositionStartHandle);
      element.removeEventListener('compositionend', compositionEndHandle);
      element.removeEventListener('focusout', focusOutHandle);
      element.removeEventListener('pointerdown', pointerDownHandle);
      document.removeEventListener('pointerup', pointerUpHandle, true);
      document.removeEventListener('pointercancel', pointerUpHandle, true);
      segCurrentErase(this);
    };
  }

  // the text shown raw, or with its styles drawn again: the same text as kept, the caret at
  // the same word
  rawSet(isRaw) {
    const element = this.element;
    if (this.isRaw === isRaw) return;
    if (!element) {
      this.isRaw = isRaw;
      return;
    }
    const text = this.isRaw ? surfaceTextRead(element) : cellStyleTextWrite(this.segList);
    const selection = cellSurfaceSelectionGet(element) ?? this.selection;
    const map = cellStyleOffsetMapGet(text);
    this.isRaw = isRaw;
    // the steps kept are those of the other way of typing
    this.undoList = [];
    this.redoList = [];
    this.write(element, text);
    if (selection) {
      const offsetOf = isRaw ? (offset) => map.rawOf(offset) : (offset) => map.bareOf(offset);
      cellSurfaceSelectionSet(element, offsetOf(selection.start), offsetOf(selection.end));
      this.selectionSync();
    }
  }

  // ---------- the model ----------

  tokenRangeListGet(textBare) {
    return (this.cell?.tokenParse ? this.cell.tokenParse(textBare) : []).filter((part) => part.type === 'token');
  }

  normalize(segList) {
    return cellStyleSegListNormalize(segList, { rangePlainList: this.tokenRangeListGet(cellStyleSegListTextGet(segList)) });
  }

  caretStyleGet(offset) {
    return cellStyleCaretStyleGet(this.segList, offset, { rangeSkipList: this.tokenRangeListGet(cellStyleSegListTextGet(this.segList)) });
  }

  // the style of what is typed over the part of the text from start to end (a caret: both the
  // same), as the text was before it. at the caret last seen: the style chosen for what comes
  // next, else its side's. over a selection: the style of its first word
  insertStyleGet(start, end) {
    const isAtSelection = this.selection && this.selection.start === start && this.selection.end === end;
    if (isAtSelection && this.pending) return this.pending;
    const caretStyle = this.caretStyleGet(start);
    if (end > start) return caretStyle.after ?? {};
    return cellStyleCaretInsertStyleGet(caretStyle, isAtSelection ? this.side : cellStyleCaretSideDefaultGet(caretStyle));
  }

  // ---------- the selection ----------

  // the selection moved (the document's selectionchange): where it is now, and whose side a
  // caret is on. while a text is composed the caret stays where the composition began
  selectionSync() {
    const element = this.element;
    if (!element || this.isComposing) return;
    const selection = cellSurfaceSelectionGet(element);
    // elsewhere: the last one inside stays known, for the bar acting on it
    if (!selection) {
      this.stateUpdate();
      return;
    }
    const length = this.isRaw ? Infinity : cellStyleSegListLengthGet(this.segList);
    const start = Math.min(selection.start, length);
    const end = Math.min(selection.end, length);
    const isMoved = !this.selection || this.selection.start !== start || this.selection.end !== end;
    if (isMoved) {
      this.selection = { start, end };
      this.pending = null;
      if (!this.isRaw && start === end) {
        const caretStyle = this.caretStyleGet(start);
        // come from the right, the caret stays with what it was in
        this.side = this.arrow === 'left' && caretStyle.after !== undefined ? 'after' : cellStyleCaretSideDefaultGet(caretStyle);
      }
      if (this.state.pickName !== '') this.pickSet('');
    }
    this.arrow = null;
    this.stateUpdate();
  }

  // a key the surface takes before the browser (CellEdit hands it every key): true when taken
  //   Ctrl/⌘ + Z, Shift + Z, Y   undo and redo: its own, since a style is no step of the browser's
  //   Ctrl/⌘ + B, I, U, …        the flags with a shortcut
  //   ← →                        where two segments meet, the first press changes the side of the
  //                              caret (it leaves one segment for the other), the next one moves
  keyDown(event) {
    this.arrow = null;
    if (this.isRaw || !this.element || event.nativeEvent?.isComposing || event.isComposing) return false;
    const isMod = (event.metaKey || event.ctrlKey) && !event.altKey;
    const key = String(event.key ?? '').toLowerCase();
    if (isMod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if (isMod && !event.shiftKey && key === 'y') {
      event.preventDefault();
      this.redo();
      return true;
    }
    if (isMod) {
      const kind = cellStyleShortcutKindGet(this.cell?.styleList ?? [], event);
      if (!kind) return false;
      event.preventDefault();
      this.flagToggle(kind.name);
      return true;
    }
    if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
    const selection = cellSurfaceSelectionGet(this.element);
    if (!selection?.isCollapsed) return false;
    const caretStyle = this.caretStyleGet(selection.start);
    const isKnown = this.selection && this.selection.start === selection.start && this.selection.end === selection.end;
    const side = isKnown ? this.side : cellStyleCaretSideDefaultGet(caretStyle);
    const sideNext = event.key === 'ArrowRight' ? 'after' : 'before';
    if (this.pending === null && cellStyleCaretIsBetween(caretStyle) && side !== sideNext) {
      event.preventDefault();
      this.selection = { start: selection.start, end: selection.end };
      this.side = sideNext;
      cellSurfaceCaretSet(this.element, selection.start, sideNext);
      this.stateUpdate();
      return true;
    }
    this.arrow = event.key === 'ArrowLeft' ? 'left' : 'right';
    return false;
  }

  // what the browser is about to do that the surface does itself: a line break (written as
  // one character, whatever the browser would build), and its own undo from a menu
  beforeInput(event) {
    if (this.isRaw || event.isComposing) return;
    if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
      event.preventDefault();
      this.insert(this.element, '\n');
    } else if (event.inputType === 'historyUndo') {
      event.preventDefault();
      this.undo();
    } else if (event.inputType === 'historyRedo') {
      event.preventDefault();
      this.redo();
    }
  }

  // ---------- styles set ----------

  // the range the bar acts on: the selection inside the surface, the last one seen there while
  // the focus is in the bar
  rangeGet() {
    const selection = (this.element ? cellSurfaceSelectionGet(this.element) : undefined) ?? this.selection;
    return selection ? { start: selection.start, end: selection.end } : null;
  }

  // what the words acted on have of style now: at a caret, what is typed next
  styleNowGet(range = this.rangeGet()) {
    if (!range || this.isRaw) return { style: {}, isStylable: false };
    if (range.start === range.end) return { style: this.pending ?? this.insertStyleGet(range.start, range.end), isStylable: true };
    const state = cellStyleRangeStateGet(this.segList, range.start, range.end, { rangeSkipList: this.tokenRangeListGet(cellStyleSegListTextGet(this.segList)) });
    return { style: state.styleCommon, isStylable: state.isStylable };
  }

  // a change of style, a key at a time ({ b: true }, { color: null }): over the selected words,
  // each keeping what else it has; at a caret, for what is typed next
  styleChange(change) {
    this.styleApply((segList, range) => cellStyleRangeChange(segList, range.start, range.end, change), (style) => cellStyleMerge(style, change));
  }

  // no style at all: over the selected words; at a caret, for what is typed next
  styleClear() {
    this.styleApply((segList, range) => cellStyleRangeSet(segList, range.start, range.end, {}), () => ({}));
  }

  // a flag on or off: off when every word selected has it, else on
  flagToggle(name) {
    const isOn = this.styleNowGet().style[name] === true;
    this.styleChange({ [name]: isOn ? null : true });
  }

  styleApply(segListOf, styleOf) {
    const element = this.element;
    const range = this.rangeGet();
    if (!element || !range || this.isRaw) return;
    if (range.start === range.end) {
      this.selection = range;
      this.pending = cellStyleClean(styleOf(this.pending ?? this.insertStyleGet(range.start, range.end)));
      this.surfaceFocus(range);
      this.stateUpdate();
      return;
    }
    const segList = this.normalize(segListOf(this.segList, range));
    if (cellStyleTextWrite(segList) === cellStyleTextWrite(this.segList)) {
      this.surfaceFocus(range);
      return;
    }
    this.historyPush('style');
    this.modelSet(segList, range);
  }

  // a part of the typed text replaced by a text as kept (a token written again from its card)
  rangeReplace(start, end, text) {
    if (!this.element || this.isRaw) return;
    this.historyPush('replace');
    const segList = this.normalize(cellStyleSegListSplice(this.segList, start, end, cellStyleSegListRead(text)));
    this.modelSet(segList, this.selection);
  }

  // the model set by something else than typing: written to the surface, the selection put
  // back, the owner told the text
  modelSet(segList, selection) {
    const element = this.element;
    this.segList = segList;
    cellStyleSurfaceWrite(element, segList, this.cell.styleCssGet);
    const length = cellStyleSegListLengthGet(segList);
    this.selection = selection ? { start: Math.min(selection.start, length), end: Math.min(selection.end, length) } : null;
    this.pending = null;
    this.surfaceFocus(this.selection);
    this.stateUpdate();
    this.onTextChange?.(cellStyleTextWrite(segList));
  }

  // the focus back in the typed text, its selection as it was (a control of the bar had it)
  surfaceFocus(selection) {
    const element = this.element;
    if (!element) return;
    if (document.activeElement !== element) element.focus({ preventScroll: true });
    if (selection) cellSurfaceSelectionSet(element, selection.start, selection.end);
  }

  // ---------- undo ----------
  //
  // the surface writes its own content (a style set, a segment cut at a token), which the
  // browser's undo knows nothing of: the steps are kept here, each the text as kept and the
  // selection before a change

  // kind: 'type' | 'delete' (typed by the browser: characters one after another, at the place
  // the last one left the caret, are one step) | anything else (a step of its own)
  historyPush(kind) {
    const now = Date.now();
    const isTyped = kind === 'type' || kind === 'delete';
    const isSameBurst = isTyped && this.historyKind === kind && now - this.historyTime < HISTORY_TYPE_GAP_MS
      && this.selection !== null && this.selection.start === this.selection.end && this.selection.start === this.historyCaret;
    this.historyKind = kind;
    this.historyTime = now;
    if (isSameBurst) return;
    this.undoList.push({ text: cellStyleTextWrite(this.segList), selection: this.selection });
    if (this.undoList.length > HISTORY_SIZE_MAX) this.undoList.shift();
    this.redoList = [];
  }

  undo() {
    this.historyStep(this.undoList, this.redoList);
  }

  redo() {
    this.historyStep(this.redoList, this.undoList);
  }

  historyStep(listFrom, listTo) {
    const step = listFrom.pop();
    if (!step || !this.element) return;
    listTo.push({ text: cellStyleTextWrite(this.segList), selection: this.selection });
    this.historyKind = '';
    this.modelSet(this.normalize(cellStyleSegListRead(step.text)), step.selection);
  }

  // ---------- what the bar shows ----------

  pickSet = action((name) => {
    this.state.pickName = this.state.pickName === name ? '' : name;
  });

  stateUpdate = action(() => {
    const element = this.element;
    const active = document.activeElement;
    const isFocused = Boolean(element) && (active === element || Boolean(this.barElement?.contains(active)));
    const range = isFocused ? this.selection : null;
    const isSelected = Boolean(range) && range.end > range.start && !this.isPointerDown;
    const now = isFocused && !this.isRaw ? this.styleNowGet(this.selection) : { style: {}, isStylable: false };
    const selectionNext = isSelected ? range : null;
    const selectionLast = this.state.selection;
    if ((selectionLast?.start !== selectionNext?.start) || (selectionLast?.end !== selectionNext?.end)) this.state.selection = selectionNext;
    if (cellStyleSpecWrite(this.state.style) !== cellStyleSpecWrite(now.style)) this.state.style = now.style;
    this.state.isStylable = now.isStylable;
    if (!isSelected && this.state.pickName !== '') this.state.pickName = '';
    // what moved under the bar (the surface written again) is told to it
    this.state.version += 1;
    this.segCurrentDraw(isFocused && active === element);
  });

  // the styled segment the caret is in, shown by a ground: at an edge of it, whether what is
  // typed goes into it
  segCurrentDraw(isFocused) {
    const range = this.selection;
    if (this.isRaw || !isFocused || !range || range.start !== range.end || this.pending !== null) {
      segCurrentErase(this);
      return;
    }
    const caretStyle = this.caretStyleGet(range.start);
    const index = this.side === 'after' ? range.start : range.start - 1;
    const seg = (this.side === 'after' ? caretStyle.after : caretStyle.before) !== undefined ? cellStyleSegAtGet(this.segList, index) : undefined;
    if (!seg || cellStyleIsEmpty(seg.style)) {
      segCurrentErase(this);
      return;
    }
    segCurrentShow(this, cellSurfaceRangeBuild(this.element, seg.start, seg.end));
  }
}

// ---------- the surface as DOM ----------

// the text of a surface as it reads it (innerText: one line break more is written after a text
// ending with one, so the caret can stand on the last line)
function surfaceTextRead(element) {
  return element ? element.innerText.replace(/\n$/, '') : '';
}

// the nodes a surface holds for segments: [{ text, spec }], spec '' a text node, else the
// element of a styled segment. a text ending with a line break gets one more (surfaceTextRead)
function nodeSpecListGet(segList) {
  const nodeList = segList.map((seg) => ({ text: seg.text, spec: cellStyleSpecWrite(seg.style) }));
  const last = nodeList[nodeList.length - 1];
  if (last && last.text.endsWith('\n')) {
    if (last.spec === '') last.text += '\n';
    else nodeList.push({ text: '\n', spec: '' });
  }
  return nodeList;
}

// segments written into a surface: plain words as text, the words of a styled segment in an
// element drawn in their style (cssGet(style): the css of a style, by the kinds of the cell)
export function cellStyleSurfaceWrite(element, segList, cssGet) {
  element.replaceChildren(...nodeSpecListGet(segList).map((one, index) => {
    if (one.spec === '') return document.createTextNode(one.text);
    const span = document.createElement('span');
    span.className = CELL_SEG_CLASS;
    span.setAttribute(CELL_SEG_ATTRIBUTE, one.spec);
    Object.assign(span.style, cssGet ? cssGet(segList[index].style) : {});
    span.textContent = one.text;
    return span;
  }));
}

// whether a surface holds exactly the nodes of the segments: nothing is written again then,
// and the browser keeps its caret and its composition
export function cellStyleSurfaceShapeIs(element, segList) {
  element.normalize();
  const nodeList = nodeSpecListGet(segList);
  const childList = element.childNodes;
  if (childList.length !== nodeList.length) return false;
  return nodeList.every((one, index) => {
    const child = childList[index];
    if (one.spec === '') return child.nodeType === Node.TEXT_NODE && child.nodeValue === one.text;
    return child.nodeType === Node.ELEMENT_NODE && child.getAttribute(CELL_SEG_ATTRIBUTE) === one.spec
      && child.childNodes.length === 1 && child.firstChild.nodeType === Node.TEXT_NODE && child.firstChild.nodeValue === one.text;
  });
}

// the segments a surface holds, as it is now: its text is what it reads (surfaceTextRead: a
// line break however the browser built it), and every piece of it has the style of the element
// it stands in. nothing is cut or joined here but neighbours of one style
export function cellStyleSurfaceRead(element) {
  const textAll = surfaceTextRead(element);
  const segList = [];
  const push = (text, style) => {
    if (text === '') return;
    const last = segList[segList.length - 1];
    if (last && cellStyleSpecWrite(last.style) === cellStyleSpecWrite(style)) last.text += text;
    else segList.push({ text, style });
  };
  let cursor = 0;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let value = node.nodeValue;
    if (!value) continue;
    // between two text nodes the text read holds only line breaks (a <br>, a line element)
    let at = cursor;
    while (at < textAll.length && textAll[at] === '\n' && !textAll.startsWith(value, at)) at += 1;
    // the last node may hold the line break written for the caret, which is not read
    while (!textAll.startsWith(value, at) && value.endsWith('\n')) value = value.slice(0, -1);
    if (value === '' || !textAll.startsWith(value, at)) continue;
    push(textAll.slice(cursor, at), {});
    push(value, segStyleOfNodeGet(node, element));
    cursor = at + value.length;
  }
  push(textAll.slice(cursor), {});
  return segList;
}

// the style of the element a text node of the surface stands in ({} outside one)
function segStyleOfNodeGet(node, element) {
  const span = node.parentElement?.closest(`[${CELL_SEG_ATTRIBUTE}]`);
  if (!span || !element.contains(span) || span === element) return {};
  return cellStyleSpecRead(span.getAttribute(CELL_SEG_ATTRIBUTE)) ?? {};
}

// ---------- the segment the caret is in ----------
//
// drawn by the browser's highlight registry, as the mark of a token is (cell-surface.js):
// nothing is added to the text. one on the page: the surface with the focus

let segCurrentOwner = null;

function segCurrentShow(owner, range) {
  segCurrentOwner = owner;
  const registry = globalThis.CSS?.highlights;
  if (!registry || typeof globalThis.Highlight !== 'function') return;
  registry.set(CELL_SEG_CURRENT_HIGHLIGHT, new globalThis.Highlight(range));
}

function segCurrentErase(owner) {
  if (segCurrentOwner !== owner) return;
  segCurrentOwner = null;
  globalThis.CSS?.highlights?.delete(CELL_SEG_CURRENT_HIGHLIGHT);
}
