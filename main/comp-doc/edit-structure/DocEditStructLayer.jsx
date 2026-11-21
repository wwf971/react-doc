import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { GripVertical } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { DocEditBlockContext, DocEditBlockFloatContext, useDocEditDoc } from '../edit/DocEditDocContext.js';
import { DocEditBlockEditor } from '../edit/DocEditBlockEditor.jsx';
import { useEditOutsidePointer } from '../edit/use-edit-outside-pointer.js';
import { DocEditItemToolbar } from './DocEditItemToolbar.jsx';
import {
  blockElementGet, blockRectGet, itemBlockElementGet, itemCodeElementListGet, itemElementGet, itemPartBlockElementGet, itemRectsGet, itemRoomOpen, textEndGet,
} from './struct-geometry.js';
import { ATOM_FILL_EVENT, ATOM_LINES_EVENT, ATOM_OPEN_EVENT } from '../edit/surface-atom.js';
import { codeLinesOpen } from '../code-editor/code-lines-open.js';
import { useStructPointer } from './use-struct-pointer.js';
import './DocEditStruct.css';

// The layer of structural edit over an edit body (design:
// doc_page_impl_edit_structure.md#the-layer). Everything a structural edit
// shows of a list item floats here, over the body, placed from the rectangle
// of the item's element:
//
//   the frame of the selected item (alone, or with what is under it)
//   the toolbar of an item: of the item under the pointer, or pinned to the
//     selected one (DocEditItemToolbar)
//   the editor of the item being edited: the source of its own text exactly
//     over the rendered text, and its floating bar (DocEditItemEditor)
//
// the controls of an item stand where they are nearest and cover nothing: an
// item of one short line has them right after its text, on its line; an item
// whose text leaves no room for them there has them at the right end
// (CONTROL_TEXT_GAP: the space between the text and the controls).
//   a drag: the dragged thing dimmed, the line of the place it would go to,
//     and the chip at the pointer
//
// nothing is added inside the list: an item of the body is the <li> it is in
// reading mode, with no wrapper, no anchor, and no attribute that changes on
// hover or selection. so the layer cannot move the page, whatever the margins
// of the list are and however they collapse (the no-jitter rule,
// doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule), and a list
// of any length costs nothing until an item is pointed at.
//
// the selection of a whole block is marked on the block wrapper itself
// (DocEditBlock), whose toolbar it pins.
//
//   bodyRef   the edit body the layer covers
export const DocEditStructLayer = observer(function DocEditStructLayer({ bodyRef }) {
  const stores = useDocStores();
  const { editStore, structStore } = stores;
  const { path, model } = useDocEditDoc();
  useStructPointer(bodyRef, { path, stores, model });
  const layoutVersion = useLayoutVersion(bodyRef);
  if (!structStore || !structStore.isActive(path)) return null;

  const hash = editStore.docEditGet(path)?.hash ?? '';
  // the rectangles are measured again when the text or the size of the body changes
  const layoutKey = `${hash}:${layoutVersion}`;
  const isStale = editStore.docEditIsStale(path);
  const selection = structStore.selectionGet(path);
  const toolbarRef = structStore.itemToolbarRefGet(path);
  const session = editStore.session;
  const isItemSession = session?.type === 'item' && session.path === path;
  const drag = structStore.drag?.path === path ? structStore.drag : undefined;

  return (
    <div className="doc-edit-struct-layer not-prose">
      {selection && selection.scope !== 'block' && !isStale ? (
        <StructItemFrame bodyRef={bodyRef} selection={selection} layoutKey={layoutKey} />
      ) : null}
      {toolbarRef && !isStale ? (
        <StructItemToolbarPlace
          key={`${toolbarRef.blockIndex}:${toolbarRef.itemPath}`}
          bodyRef={bodyRef}
          itemRef={toolbarRef}
          layoutKey={layoutKey}
        />
      ) : null}
      {isItemSession ? (
        <DocEditItemEditor
          key={`${session.blockIndex}:${session.itemPath}`}
          bodyRef={bodyRef}
          layoutKey={layoutKey}
        />
      ) : null}
      {drag ? <StructDragOverlay bodyRef={bodyRef} drag={drag} layoutKey={layoutKey} /> : null}
    </div>
  );
});

// a number that changes when the body changes its size (the window, an
// image that loaded, a block that grew)
function useLayoutVersion(bodyRef) {
  const [version, versionSet] = useState(0);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => versionSet((value) => value + 1));
    observer.observe(body);
    return () => observer.disconnect();
  }, [bodyRef]);
  return version;
}

// the rectangles of an item of the body (struct-geometry.js itemRectsGet,
// with the width of the body), or null while its element is not rendered
function useItemRects(bodyRef, blockIndex, itemPath, layoutKey) {
  const [rects, rectsSet] = useState(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const element = body ? itemElementGet(body, blockIndex, itemPath) : null;
    const rectsNext = element ? { ...itemRectsGet(body, element), bodyWidth: body.clientWidth } : null;
    rectsSet((current) => (JSON.stringify(current) === JSON.stringify(rectsNext) ? current : rectsNext));
  }, [bodyRef, blockIndex, itemPath, layoutKey]);
  return rects;
}

// the frame around the selected item: its own text, or the item with what
// is under it
function StructItemFrame({ bodyRef, selection, layoutKey }) {
  const rects = useItemRects(bodyRef, selection.blockIndex, selection.itemPath, layoutKey);
  if (!rects) return null;
  const rect = selection.scope === 'item' ? rects.rectHead : rects.rectSubtree;
  return (
    <div
      className="doc-edit-struct-frame"
      data-scope={selection.scope}
      style={frameStyleGet(rect)}
    />
  );
}

// the box of a frame around the rows of an item: a little room around the
// text, and its marker inside
const FRAME_PAD = { top: 2, left: 9, right: 4, bottom: 2 };
function frameStyleGet(rect) {
  return {
    top: rect.top - FRAME_PAD.top,
    left: rect.left - FRAME_PAD.left,
    width: rect.right - rect.left + FRAME_PAD.left + FRAME_PAD.right,
    height: rect.bottom - rect.top + FRAME_PAD.top + FRAME_PAD.bottom,
  };
}

// the space between the end of the text of an item and controls that start there
const CONTROL_TEXT_GAP = 14;

// the toolbar of an item. an item of one line that leaves room after its
// text has the toolbar there, starting at the end of the text: next to what
// it is about, covering nothing. else, under the pointer: at the right end of
// the first line of the item, as high as the line, so it covers no other
// item; pinned to the selection: above the frame, at its right end, so it
// covers nothing of what is selected.
const StructItemToolbarPlace = observer(function StructItemToolbarPlace({ bodyRef, itemRef, layoutKey }) {
  const rects = useItemRects(bodyRef, itemRef.blockIndex, itemRef.itemPath, layoutKey);
  const placeRef = useRef(null);
  const [isAfterText, isAfterTextSet] = useState(false);
  // the width of the toolbar as it first shows decides; what opens in it
  // later (a confirmation) does not move it
  useLayoutEffect(() => {
    const element = placeRef.current;
    if (!element || !rects) return;
    const left = rects.textRight + CONTROL_TEXT_GAP;
    isAfterTextSet(rects.isSingleLine && left + element.offsetWidth <= rects.rectHead.right);
  }, [rects, itemRef.isPinned]);
  if (!rects) return null;
  let style;
  if (isAfterText) style = { top: rects.rectHead.top, left: rects.textRight + CONTROL_TEXT_GAP };
  else if (itemRef.isPinned) style = { top: rects.rectHead.top - FRAME_PAD.top, right: rects.bodyWidth - rects.rectHead.right - FRAME_PAD.right };
  else style = { top: rects.rectHead.top, right: rects.bodyWidth - rects.rectHead.right };
  return (
    <div
      ref={placeRef}
      className="doc-edit-struct-own doc-edit-item-toolbar-place"
      data-pinned={itemRef.isPinned ? '' : undefined}
      data-anchor={isAfterText ? 'start' : 'end'}
      style={style}
    >
      <DocEditItemToolbar blockIndex={itemRef.blockIndex} itemPath={itemRef.itemPath} isPinned={itemRef.isPinned} />
    </div>
  );
});

// The editor of the item being edited (the session of type 'item'). The
// rendered item stays as it is; the source of its own text is laid exactly
// over the rendered text, in the type of the item, on the page background,
// and the rendered item takes the room the source needs as it is typed
// (the room effect below), so nothing lies over what follows. like a block,
// the session is left (saved) by a pointer going down outside.
//
// its bar follows the same rule as the toolbar: while the text is one line
// that leaves room after it, the bar stands on the line, right after the
// text, and moves on with the text as it is typed; else it floats above the
// first line, at the right end.
//
// an item that is a text block (session.itemFormat 'block') is edited as the
// lines inside its fences, laid over the lines of the rendered code block in
// its type and on its background, so the frame of the block stays around the
// text being typed.
const DocEditItemEditor = observer(function DocEditItemEditor({ bodyRef, layoutKey }) {
  const { editStore, structStore } = useDocStores();
  const { path, model } = useDocEditDoc();
  const session = editStore.session;
  const ownRef = useRef(null);
  const surfaceHolderRef = useRef(null);
  const [floatElement, floatElementSet] = useState(null);
  const [place, placeSet] = useState(null);
  const [barPlace, barPlaceSet] = useState(null);
  const blockIndex = session.blockIndex;
  const itemPath = session.itemPath;
  const isBlockFormat = session.itemFormat === 'block';
  // the lines of a part: one code block among the text of the item
  const partIndex = session.itemPart?.index;
  useEditOutsidePointer(ownRef, true, () => void editStore.sessionLeave());
  const blockContextValue = useMemo(() => ({ path, blockIndex }), [path, blockIndex]);

  // a chip of the text double-clicked (surface-atom.js): the item is saved,
  // and the dialog of the lines of the code block the chip stands for opens
  // (its n-th code block, in the rendered item once it is drawn again: the
  // key it carries, codeLinesOpen)
  useEffect(() => {
    const own = ownRef.current;
    if (!own) return undefined;
    const atomOpen = async (event) => {
      const index = Number(event.detail?.index);
      // a block of another view: its lines edited where they are drawn (a part)
      if (event.detail?.kind === 'block' && Number.isInteger(index)) {
        const result = await structStore.eventHandle({ type: 'editItemPartEnterRequest', data: { partIndex: index }, source: { sourcePath: path, blockIndex } });
        if (result?.code === 0 && editStore.session?.itemPart) return;
      }
      const isLeft = await editStore.sessionLeave();
      if (!isLeft || !Number.isInteger(index)) return;
      const timeEnd = Date.now() + 3000;
      const linesOpen = () => {
        const body = bodyRef.current;
        const element = body ? itemElementGet(body, blockIndex, itemPath) : null;
        const codeElement = element ? itemCodeElementListGet(element)[index] : undefined;
        if (codeElement && !editStore.blockTextPending && codeLinesOpen(codeElement.getAttribute('data-code-key'))) return;
        if (Date.now() < timeEnd) requestAnimationFrame(linesOpen);
      };
      linesOpen();
    };
    // ↑ / ↓ onto the line of a block among the text: its lines, at the x of the caret
    const atomLinesEnter = (event) => {
      const { index, line, clientX } = event.detail ?? {};
      if (!Number.isInteger(index)) return;
      void structStore.eventHandle({
        type: 'editItemPartEnterRequest',
        data: { partIndex: index, selectionInitial: { type: 'line', line, clientX } },
        source: { sourcePath: path, blockIndex },
      });
    };
    own.addEventListener(ATOM_OPEN_EVENT, atomOpen);
    own.addEventListener(ATOM_LINES_EVENT, atomLinesEnter);
    return () => {
      own.removeEventListener(ATOM_OPEN_EVENT, atomOpen);
      own.removeEventListener(ATOM_LINES_EVENT, atomLinesEnter);
    };
    // the editor is drawn once its place is measured: listened to from then on
  }, [bodyRef, blockIndex, itemPath, editStore, place === null]);

  // the chips of code blocks of another view (a line of their own) show the
  // block as it is rendered in the item: a copy of its element, inert, with
  // the margins it has there, so the item keeps its height when it is
  // entered. the surface asks when it writes its chips (ATOM_FILL_EVENT),
  // before it places the caret: listened to on the holder, which is there a
  // render before the surface
  useLayoutEffect(() => {
    const holder = surfaceHolderRef.current;
    const body = bodyRef.current;
    if (!holder || !body) return undefined;
    const chipListFill = () => {
      const chipList = [...holder.querySelectorAll('.doc-edit-atom-block:not([data-filled])')];
      if (chipList.length === 0) return;
      const element = itemElementGet(body, blockIndex, itemPath);
      const surface = holder.querySelector('.doc-edit-surface');
      if (!element || !surface) return;
      const atomList = [...surface.querySelectorAll('[data-atom]')];
      const codeList = itemCodeElementListGet(element);
      // the chips stand for the code blocks of the item in order; anything else is not trusted
      if (codeList.length !== atomList.length) return;
      for (const chip of chipList) {
        const codeElement = codeList[atomList.indexOf(chip)];
        if (!codeElement || codeElement.classList.contains('doc-code-icon')) continue;
        const style = getComputedStyle(codeElement);
        const copy = codeElement.cloneNode(true);
        copy.removeAttribute('id');
        for (const descendant of copy.querySelectorAll('[id]')) descendant.removeAttribute('id');
        copy.style.marginTop = style.marginTop;
        copy.style.marginBottom = style.marginBottom;
        // the caret drawn beside the chip stands as high as the frame of the block
        chip.style.setProperty('--doc-edit-atom-inset-top', style.marginTop);
        chip.style.setProperty('--doc-edit-atom-inset-bottom', style.marginBottom);
        chip.replaceChildren(copy);
        chip.setAttribute('data-filled', '');
      }
    };
    chipListFill();
    holder.addEventListener(ATOM_FILL_EVENT, chipListFill);
    return () => holder.removeEventListener(ATOM_FILL_EVENT, chipListFill);
  }, [bodyRef, blockIndex, itemPath, place === null]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const element = body ? itemElementGet(body, blockIndex, itemPath) : null;
    if (!element) return;
    const rects = itemRectsGet(body, element);
    const rectBody = body.getBoundingClientRect();
    const blockElement = isBlockFormat ? (partIndex === undefined ? itemBlockElementGet(element) : itemPartBlockElementGet(element, partIndex)) : null;
    if (blockElement) {
      // over the lines of the code block, in their type and on the background
      // of the block: the box of its lines (the lines of a highlighted block
      // are elements with the padding of the block on them), or of the block
      const lineList = blockElement.querySelectorAll('.line');
      const elementFirst = lineList[0] ?? blockElement.querySelector('code') ?? blockElement;
      const elementLast = lineList[lineList.length - 1] ?? elementFirst;
      const rect = elementFirst.getBoundingClientRect();
      const style = getComputedStyle(elementFirst);
      const styleText = style;
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const paddingRight = parseFloat(style.paddingRight) || 0;
      const left = rect.left - rectBody.left + paddingLeft;
      const width = Math.min(rect.width, blockElement.parentElement?.clientWidth ?? rect.width) - paddingLeft - paddingRight;
      placeSet({
        top: rect.top - rectBody.top,
        left,
        width,
        height: elementLast.getBoundingClientRect().bottom - rect.top,
        right: body.clientWidth - left - width,
        rowTop: rects.rectHead.top,
        rowRight: rects.rectHead.right,
        background: backgroundGet(blockElement, element),
        typography: typographyGet(styleText),
        // a block of text wraps its long lines, code does not: the source does as the block does
        whiteSpace: styleText.whiteSpace === 'pre-wrap' ? 'pre-wrap' : 'pre',
      });
      return;
    }
    placeSet({
      top: rects.rectHead.top,
      left: rects.textLeft,
      width: rects.rectHead.right - rects.textLeft,
      height: rects.rectHead.bottom - rects.rectHead.top,
      right: body.clientWidth - rects.rectHead.right,
      rowTop: rects.rectHead.top,
      rowRight: rects.rectHead.right,
      background: '',
      // the type of the item: the surface is not inside the list
      typography: typographyGet(getComputedStyle(element)),
    });
    // the place is the one the item had when its session started: the
    // rendered item under the surface does not change while it is edited
  }, [bodyRef, blockIndex, itemPath, isBlockFormat, partIndex, layoutKey]);

  // the height the own text of the item had when the session started: what
  // the room of the item is counted from
  const heightBaseRef = useRef(undefined);
  if (place && heightBaseRef.current === undefined) heightBaseRef.current = place.height;
  const isPlaced = Boolean(place);

  // the room of the item follows the source being typed (struct-geometry.js
  // itemRoomOpen): a text block as high as its lines, a text that needs more
  // lines than it had with that room below it. what follows the item moves,
  // as it will stand once the text is saved; nothing is laid over it.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const holder = surfaceHolderRef.current;
    const element = body ? itemElementGet(body, blockIndex, itemPath) : null;
    if (!isPlaced || !holder || !element) return undefined;
    const room = itemRoomOpen(element, {
      isBlockFormat,
      heightBase: heightBaseRef.current ?? 0,
      blockElement: partIndex === undefined ? undefined : itemPartBlockElementGet(element, partIndex) ?? undefined,
    });
    // the source is in the holder one render after the holder: until then there is no height to follow
    const roomApply = () => {
      if (holder.querySelector('.doc-edit-surface')) room.heightSet(holder.offsetHeight);
    };
    roomApply();
    const observer = new ResizeObserver(roomApply);
    observer.observe(holder);
    return () => {
      observer.disconnect();
      room.close();
    };
  }, [bodyRef, blockIndex, itemPath, isBlockFormat, partIndex, isPlaced]);

  // where the bar stands: after the text while it is one line with room
  // after it, measured again as the text is typed
  const textDraft = session.textDraft;
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const surface = surfaceHolderRef.current?.querySelector('.doc-edit-surface');
    if (!body || !surface || !floatElement || !place || isBlockFormat) {
      barPlaceSet(null);
      return;
    }
    const textEnd = textEndGet(surface);
    const left = textEnd.right - body.getBoundingClientRect().left + CONTROL_TEXT_GAP;
    const isRoom = textEnd.isSingleLine && left + floatElement.offsetWidth <= place.rowRight;
    const lineHeight = parseFloat(place.typography.lineHeight) || place.height;
    const barPlaceNext = isRoom ? { left, top: place.rowTop + (lineHeight - floatElement.offsetHeight) / 2 } : null;
    barPlaceSet((current) => (JSON.stringify(current) === JSON.stringify(barPlaceNext) ? current : barPlaceNext));
  }, [bodyRef, floatElement, place, textDraft, isBlockFormat, session.status, session.message]);

  // the keys typed while the edit that opened this editor was written
  // (DocEditStructStore, typing on through an edit) are typed here as soon
  // as the surface has the focus: the text goes in at the caret, and a kept
  // Enter or Tab is pressed as a key of the surface. a key that changes the
  // list closes this editor, and what was typed after it waits for the next
  // one; a key that leaves the editor open is followed by the rest.
  const typeAheadRef = useRef({ isRunning: false, timer: undefined });
  useEffect(() => {
    const state = typeAheadRef.current;
    if (state.isRunning || !structStore?.isTypeAheadOpen) return;
    const surface = surfaceHolderRef.current?.querySelector('.doc-edit-surface');
    if (!surface || document.activeElement !== surface) return;
    const stepRun = () => {
      state.timer = undefined;
      if (!surface.isConnected || document.activeElement !== surface) {
        state.isRunning = false;
        return;
      }
      const { text, key } = structStore.typeAheadTake();
      if (text) document.execCommand('insertText', false, text);
      if (!key) {
        state.isRunning = false;
        return;
      }
      const isShift = key.startsWith('Shift+');
      const keyName = isShift ? key.slice('Shift+'.length) : key;
      const isLeftToBrowser = surface.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, shiftKey: isShift, bubbles: true, cancelable: true }));
      // a key the editor leaves to the browser is a line break of its text
      if (isLeftToBrowser && keyName === 'Enter') document.execCommand('insertText', false, '\n');
      // after the key has been handled: gone with its editor, or on with the rest
      state.timer = setTimeout(stepRun, 0);
    };
    state.isRunning = true;
    stepRun();
  });
  useEffect(() => () => {
    if (typeAheadRef.current.timer !== undefined) clearTimeout(typeAheadRef.current.timer);
  }, []);

  const block = model.blockList[blockIndex];
  if (!place || !block) return null;
  return (
    <div ref={ownRef} className="doc-edit-struct-own doc-edit-item-edit">
      <div
        ref={floatElementSet}
        className="doc-edit-item-edit-float"
        data-anchor={barPlace ? 'start' : 'end'}
        style={barPlace ? { top: barPlace.top, left: barPlace.left } : { top: place.rowTop, right: (bodyRef.current?.clientWidth ?? 0) - place.rowRight }}
      />
      <div
        ref={surfaceHolderRef}
        className="doc-edit-item-edit-surface"
        data-format={isBlockFormat ? 'block' : undefined}
        style={{
          top: place.top,
          left: place.left,
          width: place.width,
          // a text keeps the height it had (its rendered text cannot be made
          // lower); a text block is as high as its lines, one at least
          minHeight: isBlockFormat ? place.typography.lineHeight : heightBaseRef.current ?? place.height,
          // the background of the block, over the page background: a tint
          // that lets the page through must still cover the rendered lines
          ...(place.background ? { background: `linear-gradient(${place.background}, ${place.background}), var(--color-fd-background)` } : {}),
          ...(place.whiteSpace ? { '--doc-item-edit-white-space': place.whiteSpace } : {}),
          ...place.typography,
        }}
      >
        <DocEditBlockFloatContext.Provider value={floatElement}>
          <DocEditBlockContext.Provider value={blockContextValue}>
            {floatElement ? <DocEditBlockEditor block={block} /> : null}
          </DocEditBlockContext.Provider>
        </DocEditBlockFloatContext.Provider>
      </div>
    </div>
  );
});

// the type of an element, for a surface that is not inside it
function typographyGet(style) {
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    color: style.color,
  };
}

// the background an element is painted on: its own, or the nearest one of
// the elements holding it, up to (not including) a limit element
function backgroundGet(element, elementLimit) {
  for (let current = element; current && current !== elementLimit; current = current.parentElement) {
    const color = getComputedStyle(current).backgroundColor;
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
  }
  return '';
}

// What a drag shows: the dragged thing dimmed where it still stands, the
// line of the place it would go to, and a chip at the pointer saying what is
// dragged. the line starts at the marker column of the level the item would
// get, so its left end shows the level.
const StructDragOverlay = observer(function StructDragOverlay({ bodyRef, drag, layoutKey }) {
  const { subject } = drag;
  const [rectSubject, rectSubjectSet] = useState(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (subject.kind === 'block') {
      const element = blockElementGet(body, subject.blockIndex);
      rectSubjectSet(element ? blockRectGet(body, element) : null);
      return;
    }
    const element = itemElementGet(body, subject.blockIndex, subject.itemPath);
    if (!element) {
      rectSubjectSet(null);
      return;
    }
    const rects = itemRectsGet(body, element);
    rectSubjectSet(subject.scope === 'item' ? rects.rectHead : rects.rectSubtree);
  }, [bodyRef, subject.kind, subject.blockIndex, subject.itemPath, subject.scope, layoutKey]);

  const indicator = drag.indicator;
  return (
    <>
      {rectSubject ? (
        <div className="doc-edit-struct-veil" style={frameStyleGet(rectSubject)} />
      ) : null}
      {indicator ? (
        <div
          className="doc-edit-struct-drop-line"
          style={{ top: indicator.top, left: indicator.left, width: Math.max(24, indicator.right - indicator.left) }}
        />
      ) : null}
      {createPortal(
        <div className="doc-edit-struct-drag-shield">
          <div
            className="doc-edit-struct-ghost"
            data-target={drag.target ? '' : undefined}
            style={{ transform: `translate(${drag.pointer.clientX + 14}px, ${drag.pointer.clientY + 10}px)` }}
          >
            <GripVertical aria-hidden="true" size={12} strokeWidth={2} />
            <span className="doc-edit-struct-ghost-text">{subject.label || (subject.kind === 'block' ? 'Block' : 'Item')}</span>
            {subject.countExtra > 0 ? <span className="doc-edit-struct-ghost-count">+{subject.countExtra}</span> : null}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
});
