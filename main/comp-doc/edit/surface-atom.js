import { itemAtomOf } from '../../frontend/src/lib/doc-edit-item-atom.js';

// The atoms of an editing surface (EditSourceSurface, prop atomModel): things
// of the text that are typed as one character and drawn as a chip, never as
// their source (doc_page_impl_edit_structure.md#code-blocks-in-the-text-of-an-item;
// the model is lib/doc-edit-item-atom.js). The first are the code blocks of a
// list item: a chip of an icon stands in the line (data-kind icon), a chip of
// a block of another view as wide as the surface, on a line of its own
// (data-kind block, filled by the editor around the surface, ATOM_FILL_EVENT).
//
//   <div contenteditable data-atoms>
//     "see the query"
//     <span class="doc-code-icon doc-edit-atom" contenteditable="false" data-atom="" data-label="weekly">
//     "then the script"
//     <span ... data-atom="">
//     "​"                       a spacer: the caret has a text to stand in
//   </div>
//
// - A chip has no content of its own: its icon and its label are drawn by the
//   stylesheet (::before, ::after), so the text of the surface, the ranges
//   of the browser and a text walker never meet the words of a chip.
// - The text is read node by node (surfaceAtomTextRead): a chip is its
//   character, a spacer nothing.
// - Every chip has a text node before and after it, a spacer of one
//   zero-width space when there is no text: a caret between two chips, or
//   after the last one, then stands in a text, where the browser draws it and
//   measures it. Typed text replaces nothing: the spacer is not read.
// - ← and → move by one character of the text, a chip being one; Backspace
//   or Delete next to a chip first selects it, and deletes it when pressed
//   again (the browser deletes a selection, and Undo brings it back). A
//   click selects a chip; a double click opens it (ATOM_OPEN_EVENT).

export const ATOM_SPACER = '​';

// the text of a node of the surface (or of a fragment cloned from it): text
// without spacers, a chip as its character, a line break as "\n"
export function surfaceAtomTextRead(container) {
  let text = '';
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.nodeValue.replaceAll(ATOM_SPACER, '');
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.hasAttribute('data-atom')) {
          text += child.getAttribute('data-atom');
        } else if (child.nodeName === 'BR') {
          text += '\n';
        } else {
          // a line the browser wrapped in an element of its own
          if ((child.nodeName === 'DIV' || child.nodeName === 'P') && text !== '' && !text.endsWith('\n')) text += '\n';
          walk(child);
        }
      }
    }
  };
  walk(container);
  return text;
}

// the content of the surface for a text: text nodes and chips
export function surfaceAtomContentWrite(element, text, atomModel) {
  const nodeList = [];
  let run = '';
  for (const char of text) {
    const atom = itemAtomOf(atomModel, char);
    if (!atom) {
      run += char;
      continue;
    }
    if (run) nodeList.push(document.createTextNode(run));
    run = '';
    nodeList.push(atomChipBuild(atom));
  }
  // a text that ends with a line break gets one more, as in a plain surface
  if (run) nodeList.push(document.createTextNode(run.endsWith('\n') ? `${run}\n` : run));
  element.replaceChildren(...nodeList);
  atomGapMeasure(element);
  surfaceAtomShapeKeep(element);
  // the chips of blocks are drawn by the editor around the surface, at once:
  // the caret is placed in the text after this, where the lines stand
  if (element.querySelector('[data-kind="block"]')) element.dispatchEvent(new CustomEvent(ATOM_FILL_EVENT, { bubbles: true }));
}

// the chips of blocks of a surface were written, empty: the editor around the
// surface fills them with the blocks they stand for, before anything is measured
export const ATOM_FILL_EVENT = 'doc-edit-atom-fill';

// a chip of an icon: the tile, in the line; a chip of a block of another view:
// as wide as the surface, so it stands on a line of its own, drawn as the
// rendered block by the editor around the surface (DocEditItemEditor clones
// the block into it, data-filled), a quiet frame with its label until then
function atomChipBuild(atom) {
  const chip = document.createElement('span');
  const isBlock = atom.kind === 'block';
  chip.className = isBlock ? 'doc-edit-atom doc-edit-atom-block' : 'doc-code-icon doc-edit-atom doc-edit-atom-icon';
  chip.contentEditable = 'false';
  chip.setAttribute('data-atom', atom.char);
  chip.setAttribute('data-kind', isBlock ? 'block' : 'icon');
  chip.setAttribute('data-label', atom.label);
  if (atom.place) chip.setAttribute('data-place', atom.place);
  if (!isBlock) chip.setAttribute('data-align', atom.align === 'top' ? 'top' : 'bottom');
  const countText = Number.isInteger(atom.lineCount) ? ` · ${atom.lineCount} line${atom.lineCount === 1 ? '' : 's'}` : '';
  chip.title = `${atom.title || `Code · ${atom.lang || 'text'}`}${countText}: double-click to show the lines (← → move over it, Backspace selects it, then deletes it)`;
  return chip;
}

// the space a chip keeps from what stands beside it: the width of a space in
// the type of the surface, as the rendered item has a space between its text
// and an icon (the line breaks around the block)
function atomGapMeasure(element) {
  const probe = document.createElement('span');
  probe.textContent = ' ';
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
  element.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  if (width > 0) element.style.setProperty('--doc-edit-atom-gap', `${width}px`);
}

function chipIs(node) {
  return node?.nodeType === Node.ELEMENT_NODE && node.hasAttribute('data-atom');
}

function textHasReal(node) {
  return node.nodeValue.replaceAll(ATOM_SPACER, '') !== '';
}

// after every change: a text node on both sides of every chip (a spacer where
// there is no text, or only an empty one), and the gaps of the chips as the
// rendered item has them (a space between two things of the text, none at
// its start or its end). nothing else of what the browser typed is changed,
// so its Undo can still take its steps back: a spacer left in a text, or
// between two texts, is not read and is stepped over by the keys. the
// selection is put back at the same place of the text when a node was added.
export function surfaceAtomShapeKeep(element) {
  const selectionKept = surfaceAtomSelectionGet(element);
  let isChanged = false;
  for (const chip of element.querySelectorAll(':scope > [data-atom]')) {
    for (const side of ['before', 'after']) {
      const neighbor = side === 'before' ? chip.previousSibling : chip.nextSibling;
      if (neighbor?.nodeType === Node.TEXT_NODE && neighbor.nodeValue !== '') continue;
      if (neighbor?.nodeType === Node.TEXT_NODE) neighbor.nodeValue = ATOM_SPACER;
      else chip[side](document.createTextNode(ATOM_SPACER));
      isChanged = true;
    }
  }
  // a chip that the browser put inside another element (a line it wrapped)
  // is left where it is: it is still read as its character
  let isSomethingBefore = false;
  let chipLast;
  for (const node of element.childNodes) {
    if (chipIs(node) && node.getAttribute('data-kind') === 'block') {
      // a line of its own: what follows it starts a line
      chipAttributeSet(node, 'data-gap-before', false);
      chipAttributeSet(node, 'data-gap-after', false);
      chipLast = undefined;
      isSomethingBefore = false;
    } else if (chipIs(node)) {
      chipAttributeSet(node, 'data-gap-before', isSomethingBefore);
      chipAttributeSet(node, 'data-gap-after', false);
      isSomethingBefore = true;
      chipLast = node;
    } else if (node.nodeType === Node.TEXT_NODE && node.nodeValue.replaceAll(ATOM_SPACER, '').trim() !== '') {
      if (chipLast) chipAttributeSet(chipLast, 'data-gap-after', true);
      chipLast = undefined;
      isSomethingBefore = true;
    } else if (node.nodeName === 'BR' || (node.nodeType === Node.TEXT_NODE && node.nodeValue.includes('\n'))) {
      // a line break: the next thing starts a line
      chipLast = undefined;
      isSomethingBefore = false;
    }
  }
  if (isChanged && selectionKept) surfaceAtomSelectionSet(element, selectionKept.anchor, selectionKept.focus);
}

function chipAttributeSet(chip, name, isOn) {
  if (isOn && !chip.hasAttribute(name)) chip.setAttribute(name, '');
  if (!isOn && chip.hasAttribute(name)) chip.removeAttribute(name);
}

// the place of a DOM position in the text of the surface
export function surfaceAtomOffsetOf(element, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(element);
  try {
    range.setEnd(node, offset);
  } catch {
    return undefined;
  }
  return surfaceAtomTextRead(range.cloneContents()).length;
}

// the selection of the surface as places in its text: { anchor, focus,
// start, end }, undefined when it is not in the surface
export function surfaceAtomSelectionGet(element) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return undefined;
  if (!element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return undefined;
  const anchor = surfaceAtomOffsetOf(element, selection.anchorNode, selection.anchorOffset);
  const focus = surfaceAtomOffsetOf(element, selection.focusNode, selection.focusOffset);
  if (anchor === undefined || focus === undefined) return undefined;
  return { anchor, focus, start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

// the DOM position of a place in the text: inside a text node, never inside a chip
function surfaceAtomPositionGet(element, offset) {
  let rest = Math.max(0, offset);
  const childList = [...element.childNodes];
  for (const node of childList) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue;
      let count = 0;
      for (let index = 0; index <= value.length; index += 1) {
        if (count === rest) return { node, offset: index };
        if (index < value.length && value[index] !== ATOM_SPACER) count += 1;
      }
      rest -= count;
    } else if (chipIs(node)) {
      if (rest === 0) return { node: element, offset: childList.indexOf(node) };
      rest -= 1;
    } else {
      const length = surfaceAtomTextRead(node).length + (node.nodeName === 'BR' ? 1 : 0);
      if (rest <= length) return { node: element, offset: childList.indexOf(node) + (rest === 0 ? 0 : 1) };
      rest -= length;
    }
  }
  const last = childList[childList.length - 1];
  if (last?.nodeType === Node.TEXT_NODE) return { node: last, offset: last.nodeValue.length };
  return { node: element, offset: childList.length };
}

export function surfaceAtomSelectionSet(element, anchor, focus = anchor) {
  const selection = window.getSelection?.();
  if (!selection) return;
  const positionAnchor = surfaceAtomPositionGet(element, anchor);
  const positionFocus = focus === anchor ? positionAnchor : surfaceAtomPositionGet(element, focus);
  selection.setBaseAndExtent(positionAnchor.node, positionAnchor.offset, positionFocus.node, positionFocus.offset);
}

// the keys of a surface with atoms, after the keys of the editor around it.
// true when the key was taken.
export function surfaceAtomKeyDown(event, element) {
  const isArrow = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
  const isDelete = event.key === 'Backspace' || event.key === 'Delete';
  if (!isArrow && !isDelete) return false;
  if (event.altKey || event.metaKey || event.ctrlKey) return false;
  const selection = surfaceAtomSelectionGet(element);
  if (!selection) return false;
  const text = surfaceAtomTextRead(element);
  const step = (offset, direction) => {
    // a character outside the basic plane is two units of the text
    if (direction > 0) return Math.min(text.length, offset + (/[\ud800-\udbff]/.test(text[offset] ?? '') ? 2 : 1));
    return Math.max(0, offset - (/[\udc00-\udfff]/.test(text[offset - 1] ?? '') ? 2 : 1));
  };
  if (isArrow) {
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    event.preventDefault();
    if (event.shiftKey) {
      surfaceAtomSelectionSet(element, selection.anchor, step(selection.focus, direction));
    } else if (selection.start !== selection.end) {
      surfaceAtomSelectionSet(element, direction > 0 ? selection.end : selection.start);
    } else {
      surfaceAtomSelectionSet(element, step(selection.start, direction));
    }
    return true;
  }
  if (event.shiftKey || selection.start !== selection.end) return false;
  // next to a chip: the first press selects it, the second deletes it
  const offset = selection.start;
  const indexChar = event.key === 'Backspace' ? offset - 1 : offset;
  if (indexChar < 0 || indexChar >= text.length) return false;
  const code = text[indexChar].codePointAt(0);
  if (code >= 0xe000 && code <= 0xf8ff && element.querySelector(':scope > [data-atom]')) {
    event.preventDefault();
    surfaceAtomSelectionSet(element, indexChar, indexChar + 1);
    return true;
  }
  // a character of text: the browser deletes it, from a caret that stands
  // right next to it, not behind a spacer it would delete instead
  caretSpacerSkip(event.key === 'Backspace' ? -1 : 1);
  return false;
}

// the caret moved over the spacers next to it in a direction, to the
// character the browser deletes; never over a chip
function caretSpacerSkip(direction) {
  const selection = window.getSelection();
  let node = selection.focusNode;
  let offset = selection.focusOffset;
  if (node?.nodeType !== Node.TEXT_NODE) return;
  for (;;) {
    const value = node.nodeValue;
    while (direction < 0 ? value[offset - 1] === ATOM_SPACER : value[offset] === ATOM_SPACER) offset += direction;
    const isAtEdge = direction < 0 ? offset === 0 : offset === value.length;
    const neighbor = direction < 0 ? node.previousSibling : node.nextSibling;
    if (!isAtEdge || neighbor?.nodeType !== Node.TEXT_NODE) break;
    node = neighbor;
    offset = direction < 0 ? node.nodeValue.length : 0;
  }
  if (node !== selection.focusNode || offset !== selection.focusOffset) selection.collapse(node, offset);
}

// the chips inside the selection are marked, so a selected chip shows it;
// the chip of a block the collapsed caret stands beside is marked with the
// side (data-caret: before | after): there the caret is drawn as tall as the
// block, since the caret of the browser is as high as the line of text it
// stands in, the spacer beside the chip (the stylesheet hides it then)
export function surfaceAtomSelectionMark(element) {
  const selection = window.getSelection?.();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
  const isInside = range && !range.collapsed && element.contains(range.commonAncestorContainer);
  for (const chip of element.querySelectorAll('[data-atom]')) {
    chipAttributeSet(chip, 'data-selected', Boolean(isInside && range.intersectsNode(chip)
      && range.comparePoint(chip, 0) <= 0 && range.comparePoint(chip, chip.childNodes.length) >= 0));
  }
  const caretBeside = range?.collapsed && element.contains(range.startContainer) ? surfaceAtomBlockBesideCaretGet(element, range) : undefined;
  for (const chip of element.querySelectorAll('[data-kind="block"]')) {
    const side = caretBeside?.chip === chip ? caretBeside.side : '';
    if ((chip.getAttribute('data-caret') ?? '') !== side) {
      if (side) chip.setAttribute('data-caret', side);
      else chip.removeAttribute('data-caret');
    }
  }
}

// { chip, side } of the block the caret stands right beside, on its line:
// in the spacer after it (on the right of the block, where the chip takes the
// whole line) or before it, with no text of its own between them
function surfaceAtomBlockBesideCaretGet(element, range) {
  const isBlock = (node) => chipIs(node) && node.getAttribute('data-kind') === 'block';
  const node = range.startContainer;
  let nodeBefore;
  let nodeAfter;
  if (node.nodeType === Node.TEXT_NODE && node.parentNode === element) {
    if (textHasReal(node)) return undefined;
    nodeBefore = node.previousSibling;
    nodeAfter = node.nextSibling;
  } else if (node === element) {
    nodeBefore = element.childNodes[range.startOffset - 1];
    nodeAfter = element.childNodes[range.startOffset];
  } else {
    return undefined;
  }
  if (isBlock(nodeBefore)) return { chip: nodeBefore, side: 'after' };
  if (isBlock(nodeAfter)) return { chip: nodeAfter, side: 'before' };
  return undefined;
}

// a pointer going down on a chip selects it (the caret never goes inside it)
export function surfaceAtomPointerDown(event, element) {
  const chip = event.target?.closest?.('[data-atom]');
  if (!chip || !element.contains(chip) || event.button !== 0) return false;
  event.preventDefault();
  if (document.activeElement !== element) element.focus({ preventScroll: true });
  const range = document.createRange();
  range.setStartBefore(chip);
  range.setEndAfter(chip);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

// a double click on a chip asks to open what it stands for (the dialog of
// the lines of a code block): an event of the DOM, heard by the editor around
// the surface (DocEditItemEditor), which saves the item and opens the tile
// the chip stands for. detail.index: the chip's place among the chips
export const ATOM_OPEN_EVENT = 'doc-edit-atom-open';
export function surfaceAtomDoubleClick(event, element) {
  const chip = event.target?.closest?.('[data-atom]');
  if (!chip || !element.contains(chip)) return false;
  event.preventDefault();
  const index = [...element.querySelectorAll('[data-atom]')].indexOf(chip);
  element.dispatchEvent(new CustomEvent(ATOM_OPEN_EVENT, { bubbles: true, detail: { index, kind: chip.getAttribute('data-kind') } }));
  return true;
}

// a caret the browser put inside a chip (a point on it) goes before or after it
export function surfaceAtomCaretNormalize(element, point) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return;
  const anchor = selection.anchorNode;
  let chip = anchor?.nodeType === Node.ELEMENT_NODE
    ? (chipIs(anchor) ? anchor : anchor.childNodes[selection.anchorOffset]?.closest?.('[data-atom]'))
    : anchor?.parentElement?.closest('[data-atom]');
  // a spacer beside a chip: the side of the chip the point is on
  if (!chip && anchor?.nodeType === Node.TEXT_NODE && anchor.parentNode === element && !textHasReal(anchor) && Number.isFinite(point?.clientX)) {
    chip = [anchor.previousSibling, anchor.nextSibling].find((node) => chipIs(node) && node.getAttribute('data-kind') !== 'block');
  }
  if (!chip || !element.contains(chip)) return;
  const rect = chip.getBoundingClientRect();
  const isAfter = Number.isFinite(point?.clientX) ? point.clientX > rect.left + rect.width / 2 : true;
  const range = document.createRange();
  const neighbor = isAfter ? chip.nextSibling : chip.previousSibling;
  if (neighbor?.nodeType === Node.TEXT_NODE) range.setStart(neighbor, isAfter ? 0 : neighbor.nodeValue.length);
  else if (isAfter) range.setStartAfter(chip);
  else range.setStartBefore(chip);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

// true when the collapsed caret is on the last line of the surface ('next')
// or its first one ('previous'): no text and no chip stands on a line below
// it, or above it. a chip is higher than a line of text, and the box of the
// surface says nothing about where the lines are.
export function surfaceAtomCaretIsAtEdgeLine(element, direction, rectCaret) {
  if (!rectCaret || rectCaret.height <= 0) return true;
  const rectList = [];
  for (const node of element.childNodes) {
    if (chipIs(node)) {
      rectList.push(node.getBoundingClientRect());
    } else if (node.nodeType === Node.TEXT_NODE && textHasReal(node)) {
      const range = document.createRange();
      range.selectNodeContents(node);
      rectList.push(...[...range.getClientRects()].filter((rect) => rect.height > 0));
    }
  }
  const tolerance = 2;
  if (direction === 'next') return !rectList.some((rect) => rect.top >= rectCaret.bottom - tolerance);
  return !rectList.some((rect) => rect.bottom <= rectCaret.top + tolerance);
}

// ↑ / ↓ onto the line of a block: the caret goes into its lines, not onto its
// chip. the chip of the block that is the line right above (up) or below
// (down) the caret, as { index, chip }: the nearest line in that direction
// (the boxes of the text and of the chips) holds the chip of a block.
// undefined when the line there is text or an icon, or there is none.
export const ATOM_LINES_EVENT = 'doc-edit-atom-lines';
export function surfaceAtomBlockLineGet(element, direction, rectCaret) {
  if (!rectCaret || rectCaret.height <= 0) return undefined;
  const entryList = [];
  const chipList = [...element.querySelectorAll(':scope > [data-atom]')];
  for (const node of element.childNodes) {
    if (chipIs(node)) {
      entryList.push({ rect: node.getBoundingClientRect(), chip: node });
    } else if (node.nodeType === Node.TEXT_NODE && textHasReal(node)) {
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.height > 0) entryList.push({ rect });
    }
  }
  const tolerance = 2;
  const half = rectCaret.height / 2;
  if (direction === 'next') {
    const belowList = entryList.filter(({ rect }) => rect.top >= rectCaret.bottom - tolerance);
    if (belowList.length === 0) return undefined;
    const topNearest = Math.min(...belowList.map(({ rect }) => rect.top));
    const chip = belowList.find(({ rect, chip: one }) => one?.getAttribute('data-kind') === 'block' && rect.top <= topNearest + half)?.chip;
    return chip ? { index: chipList.indexOf(chip), chip } : undefined;
  }
  const aboveList = entryList.filter(({ rect }) => rect.bottom <= rectCaret.top + tolerance);
  if (aboveList.length === 0) return undefined;
  const bottomNearest = Math.max(...aboveList.map(({ rect }) => rect.bottom));
  const chip = aboveList.find(({ rect, chip: one }) => one?.getAttribute('data-kind') === 'block' && rect.bottom >= bottomNearest - half)?.chip;
  return chip ? { index: chipList.indexOf(chip), chip } : undefined;
}
