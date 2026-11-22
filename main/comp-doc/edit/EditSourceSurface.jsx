import { createElement, Fragment, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { caretPlaceAtEdge, caretPlaceInitial, caretRectGet } from './caret-place.js';
import { useEditSlash } from '../slash/use-edit-slash.js';
import { atomRemoveSpanGet, itemAtomCharStrip, itemAtomOf, itemAtomTextSourceGet } from '../../frontend/src/lib/doc-edit-item-atom.js';
import { StoreContext } from '../../frontend/src/store/context.js';
import {
  surfaceAtomCaretIsAtEdgeLine, surfaceAtomCaretNormalize, surfaceAtomContentWrite, surfaceAtomDoubleClick, surfaceAtomKeyDown, surfaceAtomPointerDown,
  surfaceAtomKindRender, surfaceAtomSelectionGet, surfaceAtomSelectionMark, surfaceAtomSelectionSet, surfaceAtomShapeKeep, surfaceAtomTextRead,
  ATOM_LINES_EVENT, ATOM_MENU_EVENT, ATOM_SPACER, surfaceAtomBlockLineGet, surfaceAtomKindChipAt, surfaceAtomThingLabel,
  surfaceAtomRowLock, surfaceAtomRowLockFollow, surfaceAtomRowUnlock,
} from './surface-atom.js';
import './DocEdit.css';

// The editing surface of a block's source: the block's own element made
// editable, in the place of the block, never an <input> or a <textarea>. A
// paragraph edits as a <p>, a heading as its <h2>, so the text keeps the
// typography of the page and the block keeps its place while it is edited
// (doc_page_impl_edit.md#in-place-editing). The element is uncontrolled while
// typing: the browser owns the DOM, the typed text is reported through
// onTextChange, and the DOM is rewritten only when textVersion changes (text
// set by code).
//
//   tag                 element to render: 'p', 'h1'..'h6', 'div' (default)
//   kind                block kind, for the typography of the surface; 'plain'
//                       for a component's own field: no look of its own, the
//                       type and box of where it is (a cell of a CV)
//   text, textVersion   content to show; rewritten when textVersion changes
//   selectionInitial    where the caret is when the surface opens
//                       (doc_page_impl_edit.md#where-the-caret-goes):
//                       'end' (default), 'start', 'all' (a block created
//                       from a template: typing replaces it),
//                       { type: 'point', clientX, clientY } (the block was
//                       clicked there: the caret goes to the text nearest
//                       that point), { type: 'line', line: 'first' | 'last',
//                       clientX } (entered from the neighbor block by a
//                       focus shift: the caret keeps its x on the near line)
//   lineSpaceListGet    optional: (lineList) => the space above every line
//                       ('' none, or a name the stylesheet gives a gap,
//                       e.g. ListData.js listLineSpaceListGet). with it the
//                       surface is in line mode: every source line is an
//                       element of its own, spaced like the line it stands
//                       for in the rendered block, so entering the block does
//                       not change its line rhythm (a list: the gaps between
//                       its items)
//   slash               optional: config.edit.slash of the editor. with it
//                       the surface offers the slash mode: "/" typed at the
//                       start of a word opens the menu of actions
//                       (doc_page_impl_edit_slash.md); the keys of the menu
//                       come before the keys below while it is open
//   isLocked            no editing while a change request is pending
//   isFocusedInitial    take the focus when the surface opens (default true);
//                       false for the surfaces of one form opened together
//                       (the fields of a row of a table), all but the one
//                       clicked
//   isTabInserted       Tab types two spaces (default true); false lets Tab
//                       go on to the component, which moves to the next field
//   onTextChange(text)  typed text
//   onSelectionChange({ start, end, text })
//                       optional: the selection inside the surface, as offsets
//                       into its text, whenever it changes (a caret is start
//                       equal to end). not reported once the selection has left
//                       the surface, so what was selected last stays known to a
//                       control beside it (the cell edit layer: a selected text
//                       made a token, doc_page_impl_edit_cell.md)
//   onKeyDownFirst(event, { caretOffset, selectionStart, selectionEnd, textLength })
//                       optional: a key the editor around the surface takes
//                       before the keys below (an item of a list: Enter splits
//                       it, Backspace at its start joins it to the row above,
//                       Tab changes its level); true when it took the key. the
//                       offsets say where the caret or the selection is in the
//                       text, textLength how long the text is
//   atomModel           optional: the atoms of the text (lib/doc-edit-item-atom.js,
//                       the code blocks of a list item drawn as icons). each is
//                       one character of the text, drawn as a chip
//                       (surface-atom.js): the caret moves over it, Backspace
//                       selects it and then deletes it, a copy carries its
//                       source, a double click on it is ATOM_OPEN_EVENT of the
//                       DOM. the offsets above count a chip as one character
//   onBlockInsert(source, offset, text)
//                       optional: a block a slash action puts at the caret
//                       (an MDX block): the editor around the surface writes it
//                       there; without it its source is typed as lines
//   onAtomValueChange(char, value, source)
//                       optional: the value of an atom of a kind
//                       (lib/doc-edit-atom-kind.js: a formula of the component
//                       math) typed in its field below its chip, and how its
//                       kind writes it: the editor around the surface keeps it
//                       in its atoms (the text typed here does not change). a
//                       click on the chip, or Enter with the chip selected,
//                       opens the field (the Editor of the kind)
//   atomOpenRequest     optional: { char, version }: the field of the atom of
//                       char opens (one just added by a slash action)
//   onAtomInsert(atomKind, isRow, offset, text)
//                       optional: an atom of a kind a slash action puts at the
//                       caret (slashEffect.atom): the editor around the surface
//                       adds it; without it the action's text is typed
//   onSubmitRequest()   Ctrl/Cmd + Enter
//   onCancelRequest()   Escape
//   onFocusShiftRequest(direction, { point, rectSurface })
//                       ArrowDown on the last line ('next') / ArrowUp on the
//                       first line ('previous'): the author wants to go on
//                       to the neighbor block. point is where the caret is
//                       (viewport coordinates), so the neighbor can keep its x;
//                       rectSurface the box of the surface. with atoms, ↑ / ↓
//                       onto the line of a block among the text is
//                       ATOM_LINES_EVENT of the DOM instead (its lines entered)
export function EditSourceSurface({
  tag = 'div',
  kind,
  text,
  textVersion = 0,
  selectionInitial = 'end',
  lineSpaceListGet,
  atomModel,
  slash,
  isLocked = false,
  isFocusedInitial = true,
  isTabInserted = true,
  className = '',
  onTextChange,
  onSelectionChange,
  onKeyDownFirst,
  onSubmitRequest,
  onCancelRequest,
  onFocusShiftRequest,
  onBlockInsert,
  onAtomValueChange,
  atomOpenRequest,
  onAtomInsert,
  ariaLabel = 'Block source',
}) {
  const elementRef = useRef(null);
  // the kinds of atoms of the page (DocPageMdx: the registry of atom kinds)
  const atomKindByName = useContext(StoreContext)?.editStore?.atomKindByName ?? {};
  const atomKindByNameRef = useRef(atomKindByName);
  atomKindByNameRef.current = atomKindByName;
  // the atom of a kind whose value is being typed below it: { char, value, isRow, message }
  const [atomFieldState, atomFieldStateSet] = useState(undefined);
  // the text of the surface goes along: the slash text is gone from it already
  const blockInsert = onBlockInsert ? (source, offset) => onBlockInsert(source, offset, surfaceTextGet(elementRef.current)) : undefined;
  const atomInsert = onAtomInsert ? (atomKind, isRow, offset) => onAtomInsert(atomKind, isRow, offset, surfaceTextGet(elementRef.current)) : undefined;
  const slashBinding = useEditSlash(elementRef, slash, { textBeforeCaretGet, charAfterCaretGet, blockInsert, atomInsert });
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const isSelectionReported = Boolean(onSelectionChange);
  const isAtom = Boolean(atomModel);
  const atomModelRef = useRef(atomModel);
  atomModelRef.current = atomModel;

  // the selection inside the surface, told to whoever asked for it
  useEffect(() => {
    if (!isSelectionReported) return undefined;
    const selectionHandle = () => {
      const element = elementRef.current;
      const range = element ? selectionRangeGet(element) : undefined;
      if (range) onSelectionChangeRef.current?.(range);
    };
    document.addEventListener('selectionchange', selectionHandle);
    return () => document.removeEventListener('selectionchange', selectionHandle);
  }, [isSelectionReported]);

  // the chips inside the selection show it
  useEffect(() => {
    if (!isAtom) return undefined;
    const markHandle = () => {
      if (elementRef.current) surfaceAtomSelectionMark(elementRef.current);
    };
    document.addEventListener('selectionchange', markHandle);
    return () => document.removeEventListener('selectionchange', markHandle);
  }, [isAtom]);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    surfaceContentWrite(element, text, lineSpaceListGet, atomModelRef.current, atomKindByNameRef.current);
    // text set by code happens when the author is already working here
    if (textVersion > 0 && document.activeElement !== element) element.focus();
    caretPlaceAtEdge(element, 'end');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textVersion, tag]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || isLocked || !isFocusedInitial) return;
    element.focus({ preventScroll: true });
    if (isAtom && selectionInitial?.type === 'offset') {
      surfaceAtomSelectionSet(element, selectionInitial.offset);
    } else {
      caretPlaceInitial(element, selectionInitial);
      // a place on a chip goes to its side nearer to the point (or the x the caret keeps on a line)
      if (isAtom) surfaceAtomCaretNormalize(element, ['point', 'line'].includes(selectionInitial?.type) ? selectionInitial : undefined);
      // the block was entered by a click on a formula (the chip of an atom of a
      // kind): its field opens at once, as a click on the chip opens it
      const chip = isAtom && selectionInitial?.type === 'point' ? surfaceAtomKindChipAt(element, selectionInitial) : null;
      if (chip) atomFieldOpen(chip.getAttribute('data-atom'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the field of an atom of a kind opens under its chip
  const atomFieldOpen = (char) => {
    const element = elementRef.current;
    const atom = itemAtomOf(atomModelRef.current, char);
    const atomKind = atom?.atomKind ? atomKindByNameRef.current[atom.atomKind] : undefined;
    if (!element || !atomKind?.Editor) return false;
    const chip = atomKindChipGet(element, char);
    if (!chip) return false;
    chip.setAttribute('data-editing', '');
    // a row keeps its room while its value is typed: nothing after it moves
    surfaceAtomRowLock(chip);
    // the chip selected (a click on it, Enter on it) would stay painted as an
    // inactive selection while the field has the focus: the caret after it
    const offset = surfaceTextGet(element).indexOf(char);
    if (offset >= 0) surfaceAtomSelectionSet(element, offset + 1);
    atomFieldStateSet({ char, value: atom.value, isRow: atom.kind === 'row', message: chip.hasAttribute('data-error') ? surfaceAtomKindRender(element, char, atom.value, atomKind) : '' });
    return true;
  };

  // the field closes: the caret goes on before or after the atom; an empty
  // one is taken out of the text, as a typed delete (Undo brings it back)
  const atomFieldClose = (how) => {
    const element = elementRef.current;
    const open = atomFieldState;
    atomFieldStateSet(undefined);
    if (!element || !open) return;
    const chip = atomKindChipGet(element, open.char);
    chip?.removeAttribute('data-editing');
    surfaceAtomRowUnlock(chip);
    const atom = itemAtomOf(atomModelRef.current, open.char);
    const isEmpty = String(atom?.value ?? '').trim() === '';
    if (how === 'blur' && !isEmpty) return;
    element.focus({ preventScroll: true });
    const offset = surfaceTextGet(element).indexOf(open.char);
    if (offset < 0) return;
    if (how === 'remove' || isEmpty) {
      surfaceAtomSelectionSet(element, offset, offset + 1);
      document.execCommand('delete');
      return;
    }
    surfaceAtomSelectionSet(element, how === 'before' ? offset : offset + 1);
  };

  // an atom taken out by its menu: a typed delete of its chip, as Backspace
  // twice is (Undo brings it back), with the space an atom of the line takes
  // along (atomRemoveSpanGet: as the menu of a block not being edited writes
  // it); a field open below a chip closes
  const atomRemove = (char) => {
    const element = elementRef.current;
    if (!element) return;
    atomFieldStateSet(undefined);
    for (const chip of element.querySelectorAll('[data-editing]')) {
      chip.removeAttribute('data-editing');
      surfaceAtomRowUnlock(chip);
    }
    element.focus({ preventScroll: true });
    const text = surfaceTextGet(element);
    const offset = text.indexOf(char);
    if (offset < 0) return;
    const atom = itemAtomOf(atomModelRef.current, char);
    const span = atom?.kind === 'inline' ? atomRemoveSpanGet(text, offset, offset + 1, false) : { start: offset, end: offset + 1 };
    surfaceAtomSelectionSet(element, span.start, span.end);
    document.execCommand('delete');
  };

  // an atom just added: its field opens once the surface shows its chip
  useEffect(() => {
    if (atomOpenRequest?.char) atomFieldOpen(atomOpenRequest.char);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atomOpenRequest?.version]);

  const keyDownHandle = (event) => {
    if (event.nativeEvent?.isComposing) return;
    // Enter on the chip of an atom of a kind, selected: its field opens below it
    if (isAtom && event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const range = surfaceAtomSelectionGet(event.currentTarget);
      const char = range && range.end - range.start === 1 ? surfaceAtomTextRead(event.currentTarget)[range.start] : '';
      if (char && itemAtomOf(atomModelRef.current, char)?.atomKind) {
        event.preventDefault();
        atomFieldOpen(char);
        return;
      }
    }
    if (slashBinding.keyDown(event)) return;
    if (onKeyDownFirst) {
      const range = selectionRangeGet(event.currentTarget);
      const caretOffset = caretOffsetGet(event.currentTarget);
      const isTaken = onKeyDownFirst(event, {
        caretOffset,
        selectionStart: range?.start ?? caretOffset ?? 0,
        selectionEnd: range?.end ?? caretOffset ?? 0,
        textLength: surfaceTextGet(event.currentTarget).length,
      });
      if (isTaken) return;
    }
    if (isAtom && surfaceAtomKeyDown(event, event.currentTarget)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancelRequest?.();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmitRequest?.();
      return;
    }
    if (event.key === 'Tab' && isTabInserted) {
      event.preventDefault();
      document.execCommand('insertText', false, '  ');
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && onFocusShiftRequest) {
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
      const direction = event.key === 'ArrowDown' ? 'next' : 'previous';
      const rectCaret = caretRectGet(event.currentTarget);
      // the line there is a block among the text: the caret goes into its lines
      const blockLine = isAtom ? surfaceAtomBlockLineGet(event.currentTarget, direction, rectCaret) : undefined;
      if (blockLine && rectCaret) {
        event.preventDefault();
        event.currentTarget.dispatchEvent(new CustomEvent(ATOM_LINES_EVENT, {
          bubbles: true,
          detail: { index: blockLine.index, line: direction === 'next' ? 'first' : 'last', clientX: rectCaret.left },
        }));
        return;
      }
      const isAtEdge = isAtom
        ? surfaceAtomCaretIsAtEdgeLine(event.currentTarget, direction, rectCaret)
        : caretIsAtEdgeLine(event.currentTarget, direction, rectCaret);
      if (!isAtEdge) return;
      event.preventDefault();
      const point = rectCaret ? { clientX: rectCaret.left, clientY: rectCaret.top + rectCaret.height / 2 } : undefined;
      onFocusShiftRequest(direction, { point, rectSurface: event.currentTarget.getBoundingClientRect() });
    }
  };

  const pasteHandle = (event) => {
    // keep the surface plain text in browsers without plaintext-only
    event.preventDefault();
    const textPasted = event.clipboardData?.getData('text/plain') ?? '';
    // the characters of atoms are typed by the chips alone
    document.execCommand('insertText', false, isAtom ? itemAtomCharStrip(textPasted) : textPasted);
  };

  // a copy of text with chips carries the blocks they stand for
  const copyHandle = (event, isCut) => {
    if (!isAtom) return;
    const range = surfaceAtomSelectionGet(event.currentTarget);
    if (!range || range.start === range.end) return;
    event.preventDefault();
    const textSelected = surfaceTextGet(event.currentTarget).slice(range.start, range.end);
    event.clipboardData?.setData('text/plain', itemAtomTextSourceGet(textSelected, atomModelRef.current));
    if (isCut && !isLocked) document.execCommand('delete');
  };

  // in line mode the lines are checked after every change: their spaces
  // follow the new text, and a shape typing broke is built again. never
  // during an IME composition, which owns the DOM until it ends
  const textReport = (element, isComposing) => {
    if (lineSpaceListGet && !isComposing) surfaceLineShapeKeep(element, lineSpaceListGet);
    if (isAtom && !isComposing) surfaceAtomShapeKeep(element);
    onTextChange?.(surfaceTextGet(element));
  };

  const surface = createElement(tag, {
    ref: elementRef,
    className: `doc-edit-surface${className ? ` ${className}` : ''}`,
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': ariaLabel,
    'aria-readonly': isLocked ? 'true' : undefined,
    contentEditable: isLocked ? 'false' : contentEditableValueGet(),
    suppressContentEditableWarning: true,
    spellCheck: false,
    'data-kind': kind,
    'data-lines': lineSpaceListGet ? '' : undefined,
    'data-atoms': isAtom ? '' : undefined,
    'data-locked': isLocked ? '' : undefined,
    onInput: (event) => {
      textReport(event.currentTarget, event.nativeEvent?.isComposing === true);
      slashBinding.inputAfter(event);
    },
    onCompositionEnd: (event) => textReport(event.currentTarget, false),
    onKeyDown: keyDownHandle,
    onPaste: pasteHandle,
    onCopy: isAtom ? (event) => copyHandle(event, false) : undefined,
    onCut: isAtom ? (event) => copyHandle(event, true) : undefined,
    onPointerDown: isAtom ? (event) => {
      if (!surfaceAtomPointerDown(event, event.currentTarget)) return;
      // a click on an atom of a kind opens its field below it
      const char = event.target?.closest?.('[data-atom]')?.getAttribute('data-atom');
      if (char && itemAtomOf(atomModelRef.current, char)?.atomKind) atomFieldOpen(char);
    } : undefined,
    // a right click on a chip: the menu of its thing (ATOM_MENU_EVENT), when
    // the page has one; else the browser's
    onContextMenu: isAtom ? (event) => {
      const chip = event.target?.closest?.('[data-atom]');
      if (!chip || !event.currentTarget.contains(chip)) return;
      const char = chip.getAttribute('data-atom');
      const atom = itemAtomOf(atomModelRef.current, char);
      if (!atom) return;
      const request = new CustomEvent(ATOM_MENU_EVENT, {
        bubbles: true,
        cancelable: true,
        detail: { label: surfaceAtomThingLabel(atom), clientX: event.clientX, clientY: event.clientY, remove: () => atomRemove(char) },
      });
      if (!event.currentTarget.dispatchEvent(request)) {
        event.preventDefault();
        event.stopPropagation();
      }
    } : undefined,
    onDoubleClick: isAtom ? (event) => {
      const char = event.target?.closest?.('[data-atom]')?.getAttribute('data-atom');
      if (char && itemAtomOf(atomModelRef.current, char)?.atomKind) {
        event.preventDefault();
        return;
      }
      surfaceAtomDoubleClick(event, event.currentTarget);
    } : undefined,
  });
  const atomOpen = atomFieldState ? itemAtomOf(atomModelRef.current, atomFieldState.char) : undefined;
  const atomKindOpen = atomOpen?.atomKind ? atomKindByName[atomOpen.atomKind] : undefined;
  const atomField = atomFieldState && atomKindOpen?.Editor ? createElement(atomKindOpen.Editor, {
    key: atomFieldState.char,
    anchorGet: () => (elementRef.current ? atomKindChipGet(elementRef.current, atomFieldState.char) : null),
    value: atomFieldState.value,
    isRow: atomFieldState.isRow,
    message: atomFieldState.message,
    onChange: (value) => {
      onAtomValueChange?.(atomFieldState.char, value, atomKindOpen.sourceBuild(value, atomFieldState.isRow));
      const message = elementRef.current ? surfaceAtomKindRender(elementRef.current, atomFieldState.char, value, atomKindOpen) : '';
      if (elementRef.current) surfaceAtomRowLockFollow(atomKindChipGet(elementRef.current, atomFieldState.char));
      atomFieldStateSet((open) => (open && open.char === atomFieldState.char ? { ...open, message } : open));
    },
    onLeave: atomFieldClose,
  }) : null;
  // the menu of the slash mode and the field of an atom are portals: nothing is added to the flow
  if (!slashBinding.menu && !atomField) return surface;
  return createElement(Fragment, null, surface, slashBinding.menu, atomField);
}

// the chip of an atom in the surface, by its character
function atomKindChipGet(element, char) {
  return [...element.querySelectorAll('[data-atom]')].find((chip) => chip.getAttribute('data-atom') === char) ?? null;
}

// innerText turns line breaks of the editable element into "\n" (the surface
// is white-space: pre-wrap). an element whose content ends with a line break
// reports one more "\n" than lines exist. a surface in line mode is read
// line by line instead (innerText would count an empty line twice).
function surfaceTextGet(element) {
  if (element.hasAttribute('data-lines')) return surfaceLineListRead(element).join('\n');
  if (element.hasAttribute('data-atoms')) return surfaceAtomTextRead(element).replace(/\n$/, '');
  return element.innerText.replace(/\n$/, '');
}

// ---------- line mode ----------
//
// one <div class="doc-edit-surface-line" data-space> per source line; an
// empty line holds a <br> so that it has a height. the browser keeps this
// shape while the author types: Enter (or a pasted line break) splits the
// line element, copying its attributes, and Backspace at its start joins it
// to the line before. only when the shape is lost (a line break inside a
// line element, text right in the surface after everything was deleted)
// are the lines built again, with the caret put back at the same place of
// the text.

function surfaceContentWrite(element, text, lineSpaceListGet, atomModel, atomKindByName) {
  if (atomModel) {
    surfaceAtomContentWrite(element, text, atomModel, atomKindByName);
    return;
  }
  if (!lineSpaceListGet) {
    // a text that ends with a line break gets one more: the browser draws no
    // line after a last line break, and the caret could not stand there.
    // surfaceTextGet takes the extra one off again
    element.textContent = text.endsWith('\n') ? `${text}\n` : text;
    return;
  }
  const lineList = text.split('\n');
  const spaceList = lineSpaceListGet(lineList);
  element.replaceChildren(...lineList.map((line, index) => surfaceLineBuild(line, spaceList[index])));
}

function surfaceLineBuild(line, space) {
  const lineElement = document.createElement('div');
  lineElement.className = 'doc-edit-surface-line';
  if (space) lineElement.dataset.space = space;
  if (line === '') lineElement.appendChild(document.createElement('br'));
  else lineElement.textContent = line;
  return lineElement;
}

// the lines of a surface in line mode, or of a part of it (a fragment cloned
// from a range). text that is not inside a line element is read as lines too.
function surfaceLineListRead(container) {
  const lineList = [];
  let textLoose;
  for (const node of container.childNodes) {
    if (node.nodeName === 'DIV') {
      if (textLoose !== undefined) lineList.push(...textLoose.split('\n'));
      textLoose = undefined;
      lineList.push(...node.textContent.split('\n'));
    } else if (node.nodeName === 'BR') {
      lineList.push(textLoose ?? '');
      textLoose = undefined;
    } else {
      textLoose = (textLoose ?? '') + node.textContent;
    }
  }
  if (textLoose !== undefined) lineList.push(...textLoose.split('\n'));
  return lineList.length > 0 ? lineList : [''];
}

function surfaceLineShapeKeep(element, lineSpaceListGet) {
  const lineList = surfaceLineListRead(element);
  const spaceList = lineSpaceListGet(lineList);
  const childList = [...element.childNodes];
  const isShapeKept = childList.length === lineList.length
    && childList.every((node) => node.nodeName === 'DIV' && !node.textContent.includes('\n'));
  if (isShapeKept) {
    childList.forEach((lineElement, index) => {
      const space = spaceList[index] ?? '';
      if ((lineElement.dataset.space ?? '') !== space) {
        if (space) lineElement.dataset.space = space;
        else delete lineElement.dataset.space;
      }
      if (lineElement.className !== 'doc-edit-surface-line') lineElement.className = 'doc-edit-surface-line';
      if (lineElement.textContent === '' && !lineElement.querySelector('br')) {
        lineElement.appendChild(document.createElement('br'));
      }
    });
    return;
  }
  const offset = caretOffsetGet(element);
  element.replaceChildren(...lineList.map((line, index) => surfaceLineBuild(line, spaceList[index])));
  if (offset !== undefined) caretPlaceAtLineOffset(element, offset);
}

// the selection inside the surface as offsets into its text: { start, end, text };
// undefined when it is not inside the surface
function selectionRangeGet(element) {
  if (element.hasAttribute('data-atoms')) {
    const range = surfaceAtomSelectionGet(element);
    return range ? { start: range.start, end: range.end, text: surfaceTextGet(element).slice(range.start, range.end) } : undefined;
  }
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return undefined;
  const offsetOf = (container, offset) => {
    const rangeBefore = document.createRange();
    rangeBefore.selectNodeContents(element);
    rangeBefore.setEnd(container, offset);
    return element.hasAttribute('data-lines') ? surfaceLineListRead(rangeBefore.cloneContents()).join('\n').length : rangeBefore.toString().length;
  };
  const start = offsetOf(range.startContainer, range.startOffset);
  const end = offsetOf(range.endContainer, range.endOffset);
  return { start, end, text: surfaceTextGet(element).slice(start, end) };
}

// where the caret is, as an offset into the text of the surface
function caretOffsetGet(element) {
  const textBefore = textBeforeCaretGet(element);
  return textBefore === undefined ? undefined : textBefore.length;
}

// the text from the start of the surface to the caret
function textBeforeCaretGet(element) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.endContainer)) return undefined;
  const rangeBefore = document.createRange();
  rangeBefore.selectNodeContents(element);
  rangeBefore.setEnd(range.endContainer, range.endOffset);
  if (element.hasAttribute('data-atoms')) return surfaceAtomTextRead(rangeBefore.cloneContents());
  if (!element.hasAttribute('data-lines')) return rangeBefore.toString();
  return surfaceLineListRead(rangeBefore.cloneContents()).join('\n');
}

// the character after the caret on its line, as the surface reads it: a
// chip its character, '' at the end of a line (a line break, a line of its
// own, the end of the surface); spacers are not read
function charAfterCaretGet(element) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  const node = range.endContainer;
  if (!element.contains(node)) return undefined;
  if (node.nodeType === Node.TEXT_NODE) {
    const rest = node.nodeValue.slice(range.endOffset).replaceAll(ATOM_SPACER, '');
    if (rest) return rest[0];
  }
  // the first node after the caret, in the order of the text
  let next = node.nodeType !== Node.TEXT_NODE ? node.childNodes[range.endOffset] : undefined;
  if (!next) {
    let current = node;
    while (current !== element && !current.nextSibling) current = current.parentNode;
    next = current === element ? undefined : current.nextSibling;
  }
  if (!next) return '';
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  walker.currentNode = next;
  for (let current = next; current; current = walker.nextNode()) {
    if (current.nodeType === Node.TEXT_NODE) {
      const value = current.nodeValue.replaceAll(ATOM_SPACER, '');
      if (value) return value[0];
    } else if (current.hasAttribute('data-atom')) {
      return current.getAttribute('data-atom');
    } else if (current.nodeName === 'BR' || current.nodeName === 'DIV' || current.nodeName === 'P') {
      // a line goes on from here
      return '';
    }
  }
  return '';
}

function caretPlaceAtLineOffset(element, offset) {
  let offsetRest = offset;
  for (const lineElement of element.children) {
    const length = lineElement.textContent.length;
    if (offsetRest <= length) {
      const range = document.createRange();
      const textNode = lineElement.firstChild;
      if (textNode?.nodeType === Node.TEXT_NODE) range.setStart(textNode, offsetRest);
      else range.setStart(lineElement, 0);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    offsetRest -= length + 1;
  }
  caretPlaceAtEdge(element, 'end');
}

// 'plaintext-only' where the browser knows it; 'true' otherwise (the paste
// handler keeps the content plain text either way)
let contentEditableValue;
function contentEditableValueGet() {
  if (contentEditableValue) return contentEditableValue;
  const element = document.createElement('div');
  element.contentEditable = 'plaintext-only';
  contentEditableValue = element.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true';
  return contentEditableValue;
}

// true when the collapsed caret is on the last visual line of the surface
// (direction 'next') or on its first one ('previous'): an arrow key in that
// direction has nowhere to go inside the surface. the caret rectangle
// (rectCaret, from caretRectGet) is compared with the content box; when the
// browser gives none, the text lines decide.
function caretIsAtEdgeLine(element, direction, rectCaret) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  if (!element.contains(selection.anchorNode)) return false;
  const range = selection.getRangeAt(0);
  if (rectCaret && rectCaret.height > 0) {
    const rectElement = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const halfLine = rectCaret.height / 2;
    if (direction === 'previous') {
      return rectCaret.top < rectElement.top + parseFloat(style.paddingTop) + halfLine;
    }
    return rectCaret.bottom > rectElement.bottom - parseFloat(style.paddingBottom) - halfLine;
  }
  const textBefore = textBeforeCaretGet(element) ?? '';
  if (direction === 'previous') return !textBefore.includes('\n');
  const textAfter = surfaceTextGet(element).slice(textBefore.length);
  return !textAfter.includes('\n');
}
