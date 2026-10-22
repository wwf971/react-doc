import { makeAutoObservable } from 'mobx';

// The place and size of the dialogs the page frames with the host's panel
// component (design: doc_page_impl.md#the-panel-contract). A panel that is
// movable is dragged by the empty parts of its header, one that is
// resizable by its edges and corners; the panel only asks
// (rectChangeRequest), the rect is kept here, so it survives the content of
// the panel being replaced. A dialog names its panel by an id of its own
// ('paste', 'blockTransfer') and opts in with options:
//
//   isMovable         dragged by its header
//   isResizable       resized by its edges and corners
//   isSizeRemembered  the size a resize leaves is kept for the next opening
//                     of this panel, also after a reload (localStorage)
//
//   rectById            the rect of an open panel that was moved or resized:
//                       { x, y, width, height } in px of the window. absent:
//                       the panel has its own size (or the remembered one),
//                       centered. dropped when the panel closes, so a panel
//                       opens centered again
//   sizeRememberedById  { width, height } by panel id, for the panels with
//                       isSizeRemembered

export type PanelRect = { x?: number; y?: number; width?: number; height?: number };

export type PanelLayoutOption = { isMovable?: boolean; isResizable?: boolean; isSizeRemembered?: boolean };

export type PanelRectChange = { rect: PanelRect; kind: 'move' | 'resize'; isEnd: boolean };

const storageKeyDefault = 'doc-page-panel-size';

export class DocPanelLayoutStore {
  storageKey: string;
  rectById: Record<string, PanelRect> = {};
  sizeRememberedById: Record<string, { width: number; height: number }> = {};

  constructor({ storageKey = storageKeyDefault }: { storageKey?: string } = {}) {
    this.storageKey = storageKey;
    this.sizeRememberedById = sizeRememberedLoad(storageKey);
    makeAutoObservable(this, { storageKey: false });
  }

  // what the panel component is given in its config for a panel
  configGet(panelId: string, option: PanelLayoutOption = {}) {
    const sizeRemembered = option.isSizeRemembered ? this.sizeRememberedById[panelId] : undefined;
    return {
      isMovable: option.isMovable === true,
      isResizable: option.isResizable === true,
      rect: this.rectById[panelId] ?? (sizeRemembered ? { ...sizeRemembered } : undefined),
    };
  }

  // a panel asked for another rect; the size a finished resize leaves is
  // remembered when the panel remembers its size
  rectChange(panelId: string, change: PanelRectChange, option: PanelLayoutOption = {}) {
    if (change.kind === 'move' && !option.isMovable) return;
    if (change.kind === 'resize' && !option.isResizable) return;
    const rect = rectNormalize(change.rect);
    this.rectById[panelId] = rect;
    if (change.kind !== 'resize' || !change.isEnd || !option.isSizeRemembered) return;
    if (rect.width === undefined || rect.height === undefined) return;
    this.sizeRememberedById[panelId] = { width: rect.width, height: rect.height };
    sizeRememberedSave(this.storageKey, this.sizeRememberedById);
  }

  // the panel closed: it opens centered next time, in its remembered size
  panelClose(panelId: string) {
    delete this.rectById[panelId];
  }

  // the events of the panel contract this store answers; true when handled
  eventHandle(panelId: string, eventType: string, eventData: any, option: PanelLayoutOption = {}): boolean {
    if (eventType !== 'rectChangeRequest') return false;
    this.rectChange(panelId, eventData as PanelRectChange, option);
    return true;
  }
}

function rectNormalize(rect: PanelRect): PanelRect {
  const rectNext: PanelRect = {};
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = Number(rect?.[key]);
    if (Number.isFinite(value)) rectNext[key] = Math.round(value);
  }
  return rectNext;
}

function sizeRememberedLoad(storageKey: string): Record<string, { width: number; height: number }> {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function sizeRememberedSave(storageKey: string, sizeById: Record<string, { width: number; height: number }>) {
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(sizeById));
  } catch {
    // a browser refusing storage only loses the memory of the size
  }
}
