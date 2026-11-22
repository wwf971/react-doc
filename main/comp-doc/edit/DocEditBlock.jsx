import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { BlockRender } from '../../../built-in/comp-mdx/text/BlockRender.jsx';
import { DocEditBlockContext, DocEditBlockFloatContext, DocEditLineShiftContext, useDocEditDoc } from './DocEditDocContext.js';
import { DocEditBlockToolbar } from './DocEditBlockToolbar.jsx';
import { DocEditBlockEditor, blockLabelInfoGet } from './DocEditBlockEditor.jsx';
import { DocBlockSelectBlock } from '../block-select/DocBlockSelectBlock.jsx';
import { itemCodeElementListGet, itemPathAtPoint } from '../edit-structure/struct-geometry.js';
import { keyedComputedCreate } from '../../frontend/src/lib/keyed-computed.js';
import {
  EDIT_CLICK_OWN_SELECTOR,
  targetClosestWithin,
  clickAfterPointerDownSuppress,
  editFocusRelease,
  useEditOutsidePointer,
} from './use-edit-outside-pointer.js';
import './DocEdit.css';

// The wrapper remarkEditBlock puts around every root-level block of the
// compiled edit body (<DocEditBlock blockIndex>...</DocEditBlock>). It owns
// the floating controls of its block and, while the block's session is
// open, hands the block to its editor. The editor edits the block in its
// place and floats its controls, so nothing else on the page moves.
//
// floating controls: the first child of the wrapper is a zero-height sticky
// anchor; the toolbar (DocEditBlockToolbar) and the bar of the editor
// (EditFloatingPanel, placement above) are laid out from its bottom edge
// upward, over the gap above the block. the anchor sticks below the top of
// the scroll container by the height of what floats in it, so when the top
// of the block is scrolled out of view, the controls stay at the top of the
// block's visible range (doc_page_impl_edit.md#floating-controls).
//
// a block that is not being edited renders exactly as in reading mode: no
// outline, no background; only its toolbar appears on hover. the session is
// entered with the toolbar's Edit button, or, when EditBlockEnterMode is
// 'click', with a click anywhere on the block. entering is reported as an
// event (editBlockEnterRequest, source: this document and this block) with
// the pointer position as the event point, and travels through the event
// layer to DocEditStore (doc_page_impl_event.md); with a point the caret
// opens at the text nearest to where the block was clicked. only one block
// of a document is in edit mode at a time (the store holds one session).
// the session is left, saving the draft, when a pointer goes down outside
// the block or Ctrl/⌘ + Enter is pressed in it; Escape cancels it. while
// the block popup is open (doc_page_impl_popup.md) the page behind it is
// not reachable and a pointer going down anywhere leaves nothing: the popup
// switches between View and Edit, and closing it keeps the session open.
//
// geometry lock: while the block is edited, the wrapper keeps the height and
// the gaps to its neighbors that the block had in view mode (measured by
// useGeometryLock the moment the session starts, before the editor is
// rendered, and set as inline styles). the editor's in-flow root has no outer
// margins and paints the page background (DocEdit.css), so when the source
// needs more room than the rendered block it extends over the next block
// instead of pushing it down, and when it needs less the block keeps its
// height (doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule).
//
// a list block is entered item by item: a click on it opens the item under
// the pointer (editItemEnterRequest), whose own text is edited over the
// rendered item by the layer of structural edit; the whole list as source
// stays one click away, on the Edit button of the block's toolbar
// (doc_page_impl_edit_structure.md#editing-an-item). a block selected for a
// structural edit (Shift + click, or the grip of its toolbar) is marked with
// data-struct-selected, which pins its toolbar.
//
// blocks that render nothing visible (a comment, trailing component markers)
// get a small floating chip, so they can be found and edited.
//
// in block selection mode (doc_page_impl_edit_structure.md#block-selection-mode)
// the same body shows, and every block is selectable instead of editable
// (DocBlockSelectBlock).
//
// a write draws only what changed (doc_page_impl_edit.md#a-write-draws-only-what-changed).
// every write compiles the whole document again, and the body gives every
// block new elements; three things keep a block that did not change from
// being drawn again:
//
//   its key       remarkEditBlock gives every block a key of what its drawing
//                 comes from (its text, its line where it draws lines, what of
//                 the document it reads); with the same index and key the
//                 block is not drawn again (blockPropsAreEqual)
//   its answers   what it draws from the store (is it edited, is its menu
//                 open, its text just saved, its label) is one value per
//                 block (blockDrawStateGet), which changes only when one of
//                 its answers does, not whenever the session or the model of
//                 the page changes; the block it shows is the same as long
//                 as its text is: what writes reads the block of the store
//                 at the time (the events carry the index only)
//   its toolbar   drawn only while it can be seen: the block hovered or
//                 focused, its menu or confirmation open, the block selected
//                 (useToolbarMount); some twenty components a block
//
// the content of the block comes as a function (renderChildren,
// recmaEditBlockChildrenLazy): made here, when the block is drawn, so the
// body made on every write makes no element of a block that is not drawn
//
// a block moved by lines added above it keeps its elements: the lines they
// say (blockLine is the line the block started on when they were made) are
// read with the shift it moved by (DocEditLineShiftContext, DocEditBlockMode)
export const DocEditBlock = memo(function DocEditBlock({ blockIndex, blockLine, children, renderChildren }) {
  // the components the body is drawn with are in the context: when they
  // change, the block is drawn again although its key did not
  useDocEditDoc();
  const content = typeof renderChildren === 'function' ? renderChildren() : children;
  return <DocEditBlockMode blockIndex={blockIndex} lineCompiled={Number(blockLine)}>{content}</DocEditBlockMode>;
}, blockPropsAreEqual);

// the same index and key: the same drawing. a block without a key (a body
// the edit layer did not compile) is drawn again when its content is new
function blockPropsAreEqual(propsBefore, propsNext) {
  if (propsBefore.blockIndex !== propsNext.blockIndex) return false;
  if (!propsNext.blockKey) return propsBefore.children === propsNext.children && propsBefore.renderChildren === propsNext.renderChildren;
  return propsBefore.blockKey === propsNext.blockKey;
}

// the block in edit mode or in block selection mode, and how far it moved
// since its elements were made: the line it starts on now (in the content,
// the frontmatter left out, as the compile counts) less lineCompiled. a value
// of its own, so a block that moved draws only the readers of lines again
const DocEditBlockMode = observer(function DocEditBlockMode({ blockIndex, lineCompiled, children }) {
  const stores = useDocStores();
  const { editStore } = stores;
  const { path } = useDocEditDoc();
  const lineNow = blockLineContentGet(stores, path, Number(blockIndex));
  const shift = Number.isFinite(lineNow) && Number.isFinite(lineCompiled) ? lineNow - lineCompiled : 0;
  const shiftValue = useMemo(() => ({ path, shift }), [path, shift]);
  const block = editStore.isBlockSelectMode
    ? <DocBlockSelectBlock blockIndex={blockIndex}>{children}</DocBlockSelectBlock>
    : <DocEditBlockEditable blockIndex={blockIndex}>{children}</DocEditBlockEditable>;
  return <DocEditLineShiftContext.Provider value={shiftValue}>{block}</DocEditLineShiftContext.Provider>;
});

// the line a block starts on now, counted in the content (the frontmatter
// left out), as remarkEditBlock and the lines of the elements count it
function blockLineContentGet(stores, path, index) {
  const { editStore } = stores;
  return keyedGetFor(editStore)(`line\u0000${path}\u0000${index}`, () => {
    const model = editStore.docEditByPath[path]?.model;
    const block = model?.blockList[index];
    return block ? block.lineStart - (model.frontmatter?.lineEnd ?? 0) : undefined;
  });
}

// the answers a block draws from, one value per block of a document (a
// keyed computed value of the edit store): an observer reading it is drawn
// again only when one of them changed
const keyedGetByStore = new WeakMap();

function keyedGetFor(editStore) {
  let keyedGet = keyedGetByStore.get(editStore);
  if (!keyedGet) {
    keyedGet = keyedComputedCreate();
    keyedGetByStore.set(editStore, keyedGet);
  }
  return keyedGet;
}

function blockDrawStateGet(stores, path, index) {
  return keyedGetFor(stores.editStore)(`${path}\u0000${index}`, () => blockDrawStateBuild(stores, path, index), blockDrawStateEqual);
}

function blockDrawStateBuild(stores, path, index) {
  const { editStore, structStore } = stores;
  const blockList = editStore.docEditByPath[path]?.model?.blockList;
  const block = blockList?.[index];
  if (!block) return undefined;
  const isDeletePending = editStore.deleteConfirmIs(path, index);
  const label = blockLabelInfoGet(block, stores);
  return {
    block,
    isLast: index === blockList.length - 1,
    isEditing: editStore.sessionIs(path, 'block', index),
    isDeletePending,
    isOpen: isDeletePending
      || editStore.insertMenuIs(path, index)
      || editStore.blockMoveIs(path, index)
      || editStore.blockAssetMoveIs(path, index)
      || editStore.blockModeMenuIs(path, index),
    // a read-only component cannot be entered, by a click or otherwise; a
    // component declared isEditEnterButtonOnly is entered by its Edit button only
    isEnterByClick: editStore.blockEnterMode === 'click'
      && !editStore.blockIsReadOnly(path, index)
      && !editStore.blockIsEditEnterButtonOnly(path, index),
    textPending: editStore.blockTextPendingGet(path, index),
    isStructSelected: structStore?.selectionIsBlock(path, index) === true,
    labelText: label.text,
    labelTitle: label.title ?? '',
  };
}

// the same answers, and the block the same as far as it is drawn: its kind,
// its text. not its lines: they move with every line added above it, which
// draws nothing; the block kept is then the one of an older model, read for
// what it shows only
function blockDrawStateEqual(stateBefore, stateNext) {
  if (!stateBefore || !stateNext) return stateBefore === stateNext;
  const blockBefore = stateBefore.block;
  const blockNext = stateNext.block;
  return stateBefore.isLast === stateNext.isLast
    && stateBefore.isEditing === stateNext.isEditing
    && stateBefore.isDeletePending === stateNext.isDeletePending
    && stateBefore.isOpen === stateNext.isOpen
    && stateBefore.isEnterByClick === stateNext.isEnterByClick
    && stateBefore.textPending === stateNext.textPending
    && stateBefore.isStructSelected === stateNext.isStructSelected
    && stateBefore.labelText === stateNext.labelText
    && stateBefore.labelTitle === stateNext.labelTitle
    && blockBefore.kind === blockNext.kind
    && blockBefore.depth === blockNext.depth
    && blockBefore.text === blockNext.text
    && Boolean(blockBefore.list) === Boolean(blockNext.list);
}

const DocEditBlockEditable = observer(function DocEditBlockEditable({ blockIndex, children }) {
  const stores = useDocStores();
  const { blockPopupStore, blockSelectStore, componentConfig, editStore, eventRouter, onEvent: onEventPage, structStore } = stores;
  const { path, format } = useDocEditDoc();
  const elementRef = useRef(null);
  const anchorRef = useRef(null);
  const [floatElement, floatElementSet] = useState(null);
  const index = Number(blockIndex);
  const draw = blockDrawStateGet(stores, path, index);
  const isEditing = Boolean(draw?.isEditing);
  const geometryLock = useGeometryLock(elementRef, editStore, path, index);
  useEditOutsidePointer(elementRef, isEditing && !blockPopupStore.isOpen, () => void editStore.sessionLeave());
  useFloatHeightFollow(anchorRef, floatElement);
  const blockContextValue = useMemo(() => ({ path, blockIndex: index }), [path, index]);
  const toolbarMount = useToolbarMount(Boolean(draw?.isOpen) || Boolean(draw?.isStructSelected));
  if (!draw) return children;
  const { block, isDeletePending, isOpen, isEnterByClick, textPending, isStructSelected } = draw;
  const isInvisible = block.kind === 'html' || block.kind === 'marker';

  // entering the block's session is reported as an event; point is where
  // the pointer was (a pointer event can be passed), undefined for a report
  // without one
  const enterRequest = (point) => {
    const event = eventRouter.eventBuild({
      type: 'editBlockEnterRequest',
      source: { placement: 'editBlock', sourcePath: path, blockIndex: index },
      point,
    });
    void eventRouter.dispatch(event, { onEventHost: onEventPage });
  };

  // EditBlockEnterMode 'click': a click anywhere on the block starts its
  // session, with the caret where the block was clicked; the block's own
  // controls (buttons, editable values, form fields) and everything in its
  // floating area (the toolbar, the insert menu with its search results)
  // keep working and never enter the block. a popup of the edit layer
  // portaled to the body (the mode menu) still bubbles its clicks through
  // the React tree to here.
  const clickCaptureHandle = (event) => {
    if (!isEnterByClick || isEditing) return;
    if (clickIsNotOwn(event) || clickIsLinkFollow(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (block.list) {
      // while the list shows a text just saved, its items are not the model's yet
      if (textPending !== undefined || editStore.docEditIsStale(path)) return;
      const itemElement = event.target.closest?.('li[data-edit-item]');
      const itemPath = itemElement && itemElement.closest('.doc-edit-block') === event.currentTarget
        ? String(itemElement.dataset.editItem)
        : itemPathAtPoint(event.currentTarget, event.clientY);
      if (itemPath) {
        // a click on the lines of a code block among the text of the item
        // (not on a tile, which opens its dialog): that part of the item
        const codeElement = event.target.closest?.('[data-code-key]');
        const partIndex = itemElement && codeElement && codeElement.closest('li') === itemElement && !codeElement.classList.contains('doc-code-icon')
          ? itemCodeElementListGet(itemElement).indexOf(codeElement)
          : -1;
        itemEnterRequest(itemPath, event, partIndex);
        return;
      }
    }
    enterRequest(event);
  };

  // a list block is entered item by item: the item under the pointer
  const itemEnterRequest = (itemPath, point, partIndex = -1) => {
    const event = eventRouter.eventBuild({
      type: 'editItemEnterRequest',
      data: partIndex >= 0 ? { partIndex } : {},
      source: { placement: 'editBlock', sourcePath: path, blockIndex: index, itemPath },
      point,
    });
    void eventRouter.dispatch(event, { onEventHost: onEventPage });
  };

  // a right click on the block, while it is not being edited: the menu of the
  // selection with this block alone selected (DocBlockSelectMenu, the menu of
  // block selection mode: duplicate, move, copy / move to, delete). in a
  // control or an editor the browser keeps its own menu (spelling, paste)
  const contextMenuHandle = (event) => {
    if (isEditing || !blockSelectStore?.isContextMenuAvailable || !componentConfig.Menu) return;
    if (clickIsNotOwn(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    blockSelectStore.contextMenuOpen(path, index, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  // the geometry lock keeps the wrapper at the height the block had in view
  // mode; an editor shorter than that leaves uncovered wrapper space below
  // it. a primary click on that bare space is a click outside the editor:
  // it leaves the session like a pointer going down outside the block. only
  // the wrapper itself counts, so the editor, its fields, buttons, and the
  // rendered content keep working; a right click does nothing.
  //
  // the click of that same gesture is hit-tested after the leave, once the
  // block is back in view mode and fills the space that was empty. with
  // EditBlockEnterMode 'click' that click would enter the block again, so
  // it is swallowed.
  const pointerDownHandle = (event) => {
    if (!isEditing || event.button !== 0 || event.target !== event.currentTarget) return;
    editFocusRelease(elementRef.current);
    clickAfterPointerDownSuppress();
    void editStore.sessionLeave();
  };

  // keys not handled by a control of the editor: Escape cancels, Ctrl/⌘ +
  // Enter leaves (saves). focus is released first so an inline value commits,
  // in the block or, while the editor is in the block popup, in the popup.
  // an open mode menu of the block takes Escape first: it closes, the
  // session stays.
  const keyDownHandle = (event) => {
    if (!isEditing || event.defaultPrevented || event.nativeEvent?.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (editStore.blockModeMenuIs(path, index)) {
        editStore.blockModeMenuClose();
        return;
      }
      void editStore.sessionCancel();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      editFocusRelease(elementRef.current);
      editFocusRelease(blockPopupStore.slotElement);
      void editStore.sessionLeave();
    }
  };

  let content;
  if (isEditing) {
    // the editor writes by the lines of the block: the block of the model now
    const blockCurrent = editStore.docEditByPath[path]?.model?.blockList[index] ?? block;
    content = <DocEditBlockEditor block={blockCurrent} viewRendered={children} />;
  } else if (textPending !== undefined) {
    content = (
      <BlockRender data={{ text: textPending }} config={{ format, sourcePath: path }}>
        {children}
      </BlockRender>
    );
  } else if (isInvisible) {
    content = (
      <button
        type="button"
        className="doc-edit-block-chip not-prose"
        title={block.text}
        onClick={() => enterRequest(undefined)}
      >
        {block.kind === 'marker' ? 'markers' : 'comment'}: {block.text.split('\n')[0]}
      </button>
    );
  } else {
    content = children;
  }

  return (
    <DocEditBlockFloatContext.Provider value={floatElement}>
    <DocEditBlockContext.Provider value={blockContextValue}>
      <div
        ref={elementRef}
        className="doc-edit-block"
        data-block-index={index}
        data-first={index === 0 ? '' : undefined}
        data-last={draw.isLast ? '' : undefined}
        data-kind={block.kind}
        data-depth={block.depth}
        data-editing={isEditing ? '' : undefined}
        data-open={isOpen ? '' : undefined}
        data-enter-click={isEnterByClick && !isEditing ? '' : undefined}
        data-delete-pending={isDeletePending ? '' : undefined}
        data-invisible={isInvisible && !isEditing ? '' : undefined}
        data-geometry-locked={isEditing && geometryLock ? '' : undefined}
        data-struct-selected={isStructSelected && !isEditing ? '' : undefined}
        style={isEditing && geometryLock ? geometryLock : undefined}
        onClickCapture={clickCaptureHandle}
        onKeyDown={keyDownHandle}
        onPointerDown={pointerDownHandle}
        onContextMenu={contextMenuHandle}
        onPointerEnter={toolbarMount.pointerEnter}
        onPointerLeave={toolbarMount.pointerLeave}
      >
        <div ref={anchorRef} className="doc-edit-block-anchor not-prose" onFocus={toolbarMount.focusIn} onBlur={toolbarMount.focusOut}>
          <div ref={floatElementSet} className="doc-edit-block-float">
            {isEditing || !toolbarMount.isMounted ? null : <DocEditBlockToolbar blockIndex={index} label={draw.labelText} labelTitle={draw.labelTitle} />}
          </div>
        </div>
        {content}
      </div>
    </DocEditBlockContext.Provider>
    </DocEditBlockFloatContext.Provider>
  );
});

// the toolbar of a block is drawn while it can be seen: the block hovered (a
// nested block's toolbar shows instead of its holder's, DocEdit.css; both are
// drawn), focus in the toolbar, or isWanted (its menu or a confirmation open,
// the block selected). it stays drawn for its fade-out after that (DocEdit.css:
// 180 ms, then 120 ms). a touch leaves no hover: the toolbar of a block touched
// stays drawn, and the css decides whether it shows, as it did before
const TOOLBAR_KEEP_MS = 400;

function useToolbarMount(isWanted) {
  const [isHovered, hoveredSet] = useState(false);
  const [isFocused, focusedSet] = useState(false);
  const [isKept, keptSet] = useState(false);
  const isShown = isWanted || isHovered || isFocused;
  useEffect(() => {
    if (isShown) {
      keptSet(true);
      return undefined;
    }
    const timer = setTimeout(() => keptSet(false), TOOLBAR_KEEP_MS);
    return () => clearTimeout(timer);
  }, [isShown]);
  return {
    isMounted: isShown || isKept,
    pointerEnter: () => hoveredSet(true),
    pointerLeave: (event) => {
      if (event.pointerType !== 'touch') hoveredSet(false);
    },
    focusIn: () => focusedSet(true),
    focusOut: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) focusedSet(false);
    },
  };
}

// the inline styles that keep the wrapper at the geometry its block had in
// view mode while the block is edited, or null while it is not. the mobx
// reaction runs synchronously when the session changes, before React renders
// the editor, so the wrapper still holds the rendered block when it is
// measured. a block that mounts already in a session (one just created) has
// no view geometry and gets none.
//
// the lock must hold through the whole swap of the rendered block for its
// editor, not only after it. while the wrapper is empty and unlocked the
// document is shorter by the height of the block; a layout at that moment,
// with the block near the end of the document, leaves the scroll position
// beyond the end, the browser pulls it back, and nothing undoes that: the page
// jumps. so the lock is written to the wrapper the moment it is measured, and
// is kept in a ref, read by the same render that draws the editor.
function useGeometryLock(elementRef, editStore, path, index) {
  const geometryLockRef = useRef(null);
  const [, versionSet] = useState(0);
  useEffect(() => reaction(
    () => editStore.sessionIs(path, 'block', index),
    (isEditing) => {
      const wrapper = elementRef.current;
      geometryLockRef.current = isEditing ? blockGeometryMeasure(wrapper) : null;
      // the wrapper takes the lock now, before React touches it. React swaps the children
      // first and sets the style of the wrapper last, and in between the browser may lay
      // the page out by itself: it does when the element holding the focus (the Edit button
      // of the toolbar, just clicked) is taken out. the wrapper must not be empty and
      // unlocked at that moment
      if (wrapper && geometryLockRef.current) Object.assign(wrapper.style, geometryLockRef.current);
      // a render also when nothing else asks for one
      versionSet((version) => version + 1);
    },
  ), [elementRef, editStore, path, index]);
  return geometryLockRef.current;
}

// the height of the wrapper and its distances to the previous and the next
// block (or to the edge of the body for the first and the last block). the
// distances are the collapsed margins between the blocks; given to the
// wrapper as its own margins they collapse with the neighbors' margins to
// the same distances, whatever the editor renders in the wrapper.
function blockGeometryMeasure(wrapper) {
  if (!wrapper) return null;
  const rect = wrapper.getBoundingClientRect();
  const parent = wrapper.parentElement;
  const parentStyle = getComputedStyle(parent);
  const parentContentTop = parent.getBoundingClientRect().top + parent.clientTop + parseFloat(parentStyle.paddingTop);
  const parentContentBottom = parent.getBoundingClientRect().top + parent.clientTop + parent.clientHeight - parseFloat(parentStyle.paddingBottom);
  const previous = wrapper.previousElementSibling;
  const next = wrapper.nextElementSibling;
  const edgeTop = previous ? previous.getBoundingClientRect().bottom : parentContentTop;
  const edgeBottom = next ? next.getBoundingClientRect().top : parentContentBottom;
  return {
    height: `${rect.height}px`,
    marginTop: `${Math.max(0, rect.top - edgeTop)}px`,
    marginBottom: `${Math.max(0, edgeBottom - rect.bottom)}px`,
  };
}

// keeps --doc-edit-float-height of the anchor equal to the height of what
// floats in it (the toolbar, or the editor bar with its fields), which is
// the distance the anchor sticks below the sticky rows of the layout.
// followed by a ResizeObserver only, which reports the height when it is
// observed and whenever it changes (the toolbar and the editor bar replacing
// each other, a message, a field, a wrapped row), measured with the layout of
// the frame: no measure after every commit of the block, which would make the
// browser lay the page out again for every block drawn on a write
function useFloatHeightFollow(anchorRef, floatElement) {
  useLayoutEffect(() => {
    if (!floatElement) return undefined;
    const observer = new ResizeObserver((entryList) => {
      const anchor = anchorRef.current;
      const entry = entryList[entryList.length - 1];
      if (!anchor || !entry) return;
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      anchor.style.setProperty('--doc-edit-float-height', `${height}px`);
    });
    observer.observe(floatElement);
    return () => observer.disconnect();
  }, [anchorRef, floatElement]);
}

// a click the block leaves alone: on one of its own controls (buttons, values,
// fields, its floating area), or on something that is not inside it on the
// page though React hands its events to the block (a popup portaled to the
// body: the mode menu, the dialog of an icon, the popup of an MDX block, whose
// own blocks take their clicks). the controls are asked within the block
// only: a document edited in a popup is inside the popup, which is no
// control of its blocks
function clickIsNotOwn(event) {
  if (!event.currentTarget.contains(event.target)) return true;
  return targetClosestWithin(event.target, EDIT_CLICK_OWN_SELECTOR, event.currentTarget) !== null;
}

// a click with Ctrl/⌘ on a link follows the link instead of entering the
// block, as in a code editor: a popup link opens its popup (whose document is
// edited there in edit mode), another link does what that click does in
// reading mode (a new tab)
const LINK_FOLLOW_SELECTOR = 'a[href], .doc-link-render';

function clickIsLinkFollow(event) {
  if (!(event.metaKey || event.ctrlKey)) return false;
  return targetClosestWithin(event.target, LINK_FOLLOW_SELECTOR, event.currentTarget) !== null;
}
