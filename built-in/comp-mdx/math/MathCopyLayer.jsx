import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Copy, Download, FileImage, Shapes, X } from '../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../main/frontend/src/store/context.js';
import { MATH_COPY_MODE_LIST, MATH_DOWNLOAD_MODE_LIST, mathCopy, mathDownload } from './math-copy.js';
import './MathCopyLayer.css';

// The copy control of a formula on a row (comp_math.md#copying-a-formula):
// a layer of the page (page-layer-registry.js), one control for the formula
// under the pointer, floating right after the end of the formula as drawn,
// its middle at the formula's middle. It is drawn over the page (a portal,
// position fixed), so the formula and the page around it do not change; it
// shows for every formula of its own lines KaTeX draws on the page (a block
// of math, a formula on a row of a paragraph or an item, a document in a
// popup), in reading and in edit mode, not for one being edited.
//
//   ┌─────────────────────┐
//   │   E = mc²   [⧉|▾]   │   ⧉  the LaTeX copied; ▾ the forms: copy LaTeX,
//   └─────────────────────┘      Image (PNG, as drawn), SVG (MathJax); download
//                                Image (formula.png), SVG (formula.svg)
//
// it follows the pointer: over a formula, it is that formula's; off the
// formula and the control (and their menu) a moment, it goes. a copy says
// how it went on the button a moment (✓, or ✗ with the reason as its title).

const DISPLAY_SELECTOR = '.katex-display';
// a formula being typed has its field, not this
const EDITING_SELECTOR = '.doc-edit-surface, .doc-math-block-edit, [contenteditable]:not([contenteditable="false"])';
const MENU_CLASS = 'doc-math-copy-menu';
const GAP = 6;
const HIDE_DELAY = 250;
const STATUS_DURATION = 1500;

const MODE_ICON_BY_ID = { latex: Copy, png: FileImage, svg: Shapes };
const STATUS_TEXT_BY_ACTION = {
  'copy:latex': 'LaTeX copied',
  'copy:png': 'Image copied',
  'copy:svg': 'SVG copied',
  'download:png': 'formula.png saved',
  'download:svg': 'formula.svg saved',
};

export function MathCopyLayer() {
  const { componentConfig } = useDocStores();
  const Menu = componentConfig?.Menu;
  const [target, targetSet] = useState(null);
  const [place, placeSet] = useState(null);
  const [isMenuOpen, isMenuOpenSet] = useState(false);
  const [status, statusSet] = useState(null);
  const controlRef = useRef(null);
  const hideTimerRef = useRef(0);
  const statusTimerRef = useRef(0);
  const stateRef = useRef({});
  stateRef.current = { target, isMenuOpen };

  const hideCancel = () => {
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = 0;
  };

  // the formula under the pointer; off it and off the control, the control goes
  useEffect(() => {
    const pointerMove = (event) => {
      const node = event.target;
      if (controlRef.current?.contains(node) || node?.closest?.(`.${MENU_CLASS}`)) {
        hideCancel();
        return;
      }
      const display = node?.closest?.(DISPLAY_SELECTOR);
      if (display && !display.closest(EDITING_SELECTOR)) {
        hideCancel();
        if (display !== stateRef.current.target) {
          targetSet(display);
          statusSet(null);
          isMenuOpenSet(false);
        }
        return;
      }
      if (!stateRef.current.target || stateRef.current.isMenuOpen || hideTimerRef.current) return;
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = 0;
        targetSet(null);
      }, HIDE_DELAY);
    };
    document.addEventListener('pointermove', pointerMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', pointerMove);
      hideCancel();
      window.clearTimeout(statusTimerRef.current);
    };
  }, []);

  // its place: after the end of the formula, while the page scrolls or resizes
  useLayoutEffect(() => {
    if (!target) {
      placeSet(null);
      return undefined;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!target.isConnected || target.closest(EDITING_SELECTOR)) {
        targetSet(null);
        return;
      }
      const control = controlRef.current;
      placeSet(placeGet(target, control?.offsetWidth ?? 48, control?.offsetHeight ?? 24));
    };
    const updateAsk = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', updateAsk, { capture: true, passive: true });
    window.addEventListener('resize', updateAsk);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', updateAsk, { capture: true });
      window.removeEventListener('resize', updateAsk);
    };
  }, [target]);

  // the control is measured once it is drawn: placed again with its size
  useLayoutEffect(() => {
    if (!target || !place || !controlRef.current) return;
    const placeNext = placeGet(target, controlRef.current.offsetWidth, controlRef.current.offsetHeight);
    if (placeNext.left !== place.left || placeNext.top !== place.top) placeSet(placeNext);
  }, [target, place]);

  if (!target || !place || typeof document === 'undefined') return null;

  // an action of the control, 'copy:{mode}' or 'download:{mode}'; called
  // inside the click: the clipboard is written in the gesture
  const act = (action) => {
    const [verb, mode] = String(action).split(':');
    if (verb !== 'copy' && verb !== 'download') return;
    isMenuOpenSet(false);
    window.clearTimeout(statusTimerRef.current);
    statusSet({ kind: 'busy', action, message: '' });
    const run = verb === 'download' ? mathDownload : mathCopy;
    void run(mode, target).then((result) => {
      statusSet({ kind: result.code === 0 ? 'copied' : 'failed', action, message: result.message });
      statusTimerRef.current = window.setTimeout(() => statusSet(null), STATUS_DURATION);
    });
  };

  const isCopied = status?.kind === 'copied';
  const isFailed = status?.kind === 'failed';
  const MainIcon = isCopied ? Check : isFailed ? X : Copy;
  const mainTitle = isCopied
    ? STATUS_TEXT_BY_ACTION[status.action]
    : isFailed ? `Not done: ${status.message}` : 'Copy the LaTeX';

  const items = [
    { id: 'head:copy', isContainer: true, comp: MathCopyMenuHead, compProps: { text: 'Copy' } },
    ...MATH_COPY_MODE_LIST.map((mode) => ({ id: `copy:${mode.id}`, comp: MathCopyMenuItem, compProps: { mode, Icon: MODE_ICON_BY_ID[mode.id] } })),
    { id: 'head:download', isContainer: true, comp: MathCopyMenuHead, compProps: { text: 'Download' } },
    ...MATH_DOWNLOAD_MODE_LIST.map((mode) => ({ id: `download:${mode.id}`, comp: MathCopyMenuItem, compProps: { mode, Icon: Download } })),
  ];

  return createPortal(
    <div
      ref={controlRef}
      className="doc-math-copy not-prose"
      style={{ left: `${place.left}px`, top: `${place.top}px` }}
      data-status={status?.kind ?? undefined}
    >
      <button type="button" className="doc-math-copy-button" title={mainTitle} aria-label={mainTitle} onClick={() => act('copy:latex')}>
        <MainIcon size={13} aria-hidden="true" />
      </button>
      {Menu ? (
        <button
          type="button"
          className="doc-math-copy-button doc-math-copy-more"
          title="Copy or download as…"
          aria-label="Copy or download as…"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          onClick={() => isMenuOpenSet((isOpen) => !isOpen)}
        >
          <ChevronDown size={12} aria-hidden="true" />
        </button>
      ) : null}
      {isMenuOpen && Menu ? (
        <Menu
          data={{ items }}
          config={{
            isOpen: true,
            isBackdropScrollPassThrough: true,
            isClickPropagationStopped: true,
            className: `doc-edit-mode-menu ${MENU_CLASS}`,
            minWidth: 190,
            anchor: {
              getRect: () => controlRef.current?.getBoundingClientRect(),
              getTargetEl: () => controlRef.current,
              offsetY: (controlRef.current?.offsetHeight ?? 0) + 2,
            },
          }}
          onEvent={(eventType, eventData) => {
            if (eventType === 'itemClick') act(eventData.itemId ?? eventData.item?.id);
            if (eventType === 'closeRequest') isMenuOpenSet(false);
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}

function MathCopyMenuHead({ text }) {
  return <span className="doc-edit-mode-head">{text}</span>;
}

// one form: its icon, its name, what it gives
function MathCopyMenuItem({ mode, Icon }) {
  return (
    <span className="doc-math-copy-item">
      <span className="doc-math-copy-item-icon">{Icon ? <Icon size={13} aria-hidden="true" /> : null}</span>
      <span className="doc-math-copy-item-label">{mode.label}</span>
      <span className="doc-math-copy-item-note">{mode.description}</span>
    </span>
  );
}

// the place of the control: right after the end of what KaTeX drew (the
// boxes of its .katex-html, not the row, which is as wide as the text), its
// middle at their middle; kept inside the row of the formula
function placeGet(display, width, height) {
  const row = display.getBoundingClientRect();
  const boxList = [...(display.querySelector('.katex-html')?.children ?? [])]
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  const right = boxList.length ? Math.max(...boxList.map((rect) => rect.right)) : row.right;
  const top = boxList.length ? Math.min(...boxList.map((rect) => rect.top)) : row.top;
  const bottom = boxList.length ? Math.max(...boxList.map((rect) => rect.bottom)) : row.bottom;
  return {
    left: Math.round(Math.max(row.left, Math.min(right + GAP, row.right - width))),
    top: Math.round((top + bottom) / 2 - height / 2),
  };
}
