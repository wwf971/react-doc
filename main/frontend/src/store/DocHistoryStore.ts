import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { DocEditStore, EditHistoryEntrySummary, EditResult } from './DocEditStore.js';
import type { DocStore } from './DocStore.js';
import { embedHistoryHashGet, embedPathParse } from '../lib/doc-edit-embed.js';
import { historyChangeBlockListGet, historyChangeReveal } from '../lib/doc-history-reveal.js';

// Undo and redo of the page (design: doc_page_impl_edit_history.md). The history
// itself is kept by the development server, per document, and every write of the
// edit layer is in it (DocEditStore.historySummaryByPath holds what the server
// answered last); this store decides which history an undo goes to, routes the
// requests, and shows where a step took place.
//
// which history an undo goes to, the scope:
//   a document          the body the author is in: the page, the popup of a link
//                       (the history of the linked document, wherever it was edited),
//                       the popup of an MDX block (only the entries made in that block)
//   a component first   when the undo comes from a key, the component of the block
//                       the author is in is asked first (the delivered event
//                       historyUndo / historyRedo): a component with changes of its
//                       own takes it, else the document does
//
//   historyUndoRequest { path? } / historyRedoRequest { path? }   events of the route
//                       'history': with a path, that document's history; without
//                       (a key, the palette), the place of the author, the component
//                       there first

export const historyEventTypeList = ['historyUndoRequest', 'historyRedoRequest'];

// the steps that may wait for the one being written
const STEP_WAIT_COUNT_MAX = 20;

export type HistoryDirection = 'undo' | 'redo';

// where the author is: the document of the body, and the block of it
export type HistoryPlace = { path: string; blockIndex?: number; blockLine?: number; element?: Element };

export type HistoryScopeState = {
  path: string;
  undo?: EditHistoryEntrySummary;
  redo?: EditHistoryEntrySummary;
};

type DocEvent = { type: string; data: Record<string, any>; source: Record<string, any> };

export class DocHistoryStore {
  editStore: DocEditStore;
  docStore: DocStore;
  // the event layer, to deliver an undo to a component (set by the page)
  eventRouter: { publish: (request: any) => Promise<any> } | undefined;
  // the element of the page the author was last at (a pointer down, a focus)
  targetElement: Element | undefined = undefined;
  // the block (else the edit body) that element was in: the place of the author
  // once the element itself has left the page (a button that closed what it was
  // part of, as the Save of a card does). a pointer in a popup of the edit layer
  // portaled to the body (a menu, the card of a token: class doc-edit-popup) keeps
  // the place it was opened from
  targetPlaceElement: Element | undefined = undefined;
  // the step being written, for the spinner of its button (a failure is said by
  // whoever asked: the notice of the page, DocHistoryButtons and the keys alike)
  stepState: { path: string; direction: HistoryDirection } | undefined = undefined;
  // the steps asked while one is written wait for it and run in order, as keys
  // pressed one after another are meant (stepQueue: the last step asked)
  stepQueue: Promise<unknown> = Promise.resolve();
  stepWaitCount = 0;
  // the element the page scrolls in (DocPageMdx pageElementRef)
  pageElementGet: () => Element | null | undefined = () => undefined;
  listenerDispose: (() => void) | undefined;

  constructor({ editStore, docStore }: { editStore: DocEditStore; docStore: DocStore }) {
    this.editStore = editStore;
    this.docStore = docStore;
    makeAutoObservable(this, {
      editStore: false,
      docStore: false,
      eventRouter: false,
      targetElement: false,
      targetPlaceElement: false,
      // kept as given: a step clears the state it set, by identity
      stepState: observable.ref,
      stepQueue: false,
      stepWaitCount: false,
      pageElementGet: false,
      listenerDispose: false,
    });
  }

  // follows where the author is: the last pointer down or focus of the page
  init() {
    if (typeof document === 'undefined' || this.listenerDispose) return;
    const targetSet = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      this.targetElement = event.target;
      const placeElement = event.target.closest('.doc-edit-block[data-block-index]')
        ?? event.target.closest('.doc-edit-body[data-edit-path]')
        ?? undefined;
      if (placeElement || !event.target.closest('.doc-edit-popup')) this.targetPlaceElement = placeElement;
    };
    document.addEventListener('pointerdown', targetSet, true);
    document.addEventListener('focusin', targetSet, true);
    this.listenerDispose = () => {
      document.removeEventListener('pointerdown', targetSet, true);
      document.removeEventListener('focusin', targetSet, true);
    };
  }

  dispose() {
    this.listenerDispose?.();
    this.listenerDispose = undefined;
  }

  // ---------- scopes ----------

  // the place of an element: the edit body it is in and its block there
  placeOfElement(element: Element | undefined): HistoryPlace | undefined {
    if (!element || !element.isConnected) return undefined;
    // in a popup of the edit layer but not in its body (its header): the body of the popup
    const body = element.closest('.doc-edit-body[data-edit-path]')
      ?? element.closest('.doc-edit-popup')?.querySelector('.doc-edit-body[data-edit-path]');
    const path = body?.getAttribute('data-edit-path') ?? '';
    if (!body || !path) return undefined;
    const blockElement = element.closest('.doc-edit-block[data-block-index]');
    if (!blockElement || blockElement.closest('.doc-edit-body') !== body) return { path, element };
    const blockIndex = Number(blockElement.getAttribute('data-block-index'));
    const block = this.editStore.docEditGet(path)?.model?.blockList[blockIndex];
    return { path, blockIndex, blockLine: block?.component?.markerLine, element };
  }

  // where the author is now: the element with the focus, else the one last
  // pointed at (its block when it has left the page), else the document of the page
  placeCurrentGet(): HistoryPlace {
    const active = typeof document !== 'undefined' ? document.activeElement : undefined;
    const place = (active && active !== document.body ? this.placeOfElement(active) : undefined)
      ?? this.placeOfElement(this.targetElement)
      ?? this.placeOfElement(this.targetPlaceElement);
    return place ?? { path: this.docStore.docCurrentPath };
  }

  // what an undo and a redo of a document take now. an embedded document takes the
  // entries of its host made in it: the last whose text after is its text now
  // (undo), the one undone last whose text before is its text now (redo)
  scopeStateGet(path: string): HistoryScopeState {
    const embed = embedPathParse(path);
    const summary = this.editStore.historySummaryByPath[embed ? embed.hostPath : path];
    if (!summary) return { path };
    if (!embed) {
      return {
        path,
        undo: summary.entryList.find((entry) => entry.entryId === summary.undoEntryId),
        redo: summary.entryList.find((entry) => entry.entryId === summary.redoEntryId),
      };
    }
    const text = this.editStore.sourceByPath[path]?.text;
    if (text === undefined) return { path };
    const hash = embedHistoryHashGet(text);
    let undo: EditHistoryEntrySummary | undefined;
    let redo: EditHistoryEntrySummary | undefined;
    for (const entry of summary.entryList) {
      if (!entry.embed) continue;
      if (entry.state === 'done' && entry.embed.hashAfter === hash) undo = entry;
      if (entry.state === 'undone' && entry.embed.hashBefore === hash && (!redo || entry.undoSeq > redo.undoSeq)) redo = entry;
    }
    return { path, undo, redo };
  }

  // what a button says of an entry in a scope: an entry made in an MDX block, seen
  // from its host, says so
  entryLabelGet(path: string, entry: EditHistoryEntrySummary | undefined): string {
    if (!entry) return '';
    const isFromEmbed = Boolean(entry.embed) && !embedPathParse(path);
    return isFromEmbed ? `${entry.label} (in an MDX block)` : entry.label;
  }

  get isSubmitting(): boolean {
    return this.stepState !== undefined;
  }

  // ---------- steps ----------

  // the route of the event layer (doc_page_impl_event.md)
  async eventHandle(event: DocEvent): Promise<EditResult | undefined> {
    const direction: HistoryDirection | undefined = event.type === 'historyUndoRequest' ? 'undo' : event.type === 'historyRedoRequest' ? 'redo' : undefined;
    if (!direction) return undefined;
    if (!this.editStore.isAvailable) return { code: -1, message: 'The page cannot write documents here.' };
    const pathGiven = String(event.data?.path ?? '');
    if (pathGiven) return this.step(direction, pathGiven);
    if (event.data?.isPlaceUsed !== true) {
      return this.step(direction, String(event.source?.sourcePath || this.docStore.docCurrentPath));
    }
    const place = this.placeCurrentGet();
    const resultComponent = await this.componentStepAsk(direction, place);
    if (resultComponent) return resultComponent;
    return this.step(direction, place.path);
  }

  // the component of the block the author is in, asked to undo a step of its own
  // (the delivered events historyUndo / historyRedo); undefined when none took it
  private async componentStepAsk(direction: HistoryDirection, place: HistoryPlace): Promise<EditResult | undefined> {
    if (!this.eventRouter || place.blockLine === undefined) return undefined;
    const published = await this.eventRouter.publish({
      type: direction === 'undo' ? 'historyUndo' : 'historyRedo',
      subject: { sourcePath: place.path, blockLine: place.blockLine },
      data: { target: place.element },
      isAcceptedFirst: true,
    });
    const result = published?.data?.resultList?.find((one: any) => one?.code === 0);
    if (!result) return undefined;
    return { code: 0, message: result.message ?? '', data: { scope: 'component', ...(result.data ?? {}) } };
  }

  // an undo (redo) of the history of a document: written by the server, the page
  // then shows where it took place. a step asked while another is written runs
  // after it (Ctrl/⌘ + Z pressed three times takes three steps back)
  async step(direction: HistoryDirection, path: string): Promise<EditResult> {
    if (!path) return { code: -1, message: 'No document to undo in.' };
    if (this.stepWaitCount >= STEP_WAIT_COUNT_MAX) return { code: -1, message: 'Too many steps are waiting to be written.' };
    this.stepWaitCount += 1;
    const run = this.stepQueue.then(() => this.stepRun(direction, path));
    this.stepQueue = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      this.stepWaitCount -= 1;
    }
  }

  private async stepRun(direction: HistoryDirection, path: string): Promise<EditResult> {
    const embed = embedPathParse(path);
    const scope = this.scopeStateGet(path);
    const entry = direction === 'undo' ? scope.undo : scope.redo;
    // an embedded document has no history of its own: it needs an entry of its host
    if (embed && !entry) return { code: -1, message: `Nothing to ${direction} in this MDX block.` };
    const textBefore = this.editStore.sourceByPath[path]?.text;
    const stepState = { path, direction };
    runInAction(() => {
      this.stepState = stepState;
    });
    const result = await this.editStore.historyStepApply(embed ? embed.hostPath : path, direction, entry?.entryId ?? '');
    runInAction(() => {
      if (this.stepState === stepState) this.stepState = undefined;
    });
    if (result.code !== 0) {
      // what the page knew of the history may be old (another tab wrote): read it again
      void this.editStore.historyRead(embed ? embed.hostPath : path);
      if (result.code === -1 && !entry) return { code: -1, message: `Nothing to ${direction} in this document.` };
      return result;
    }
    void this.revealAfterStep(path, textBefore);
    const label = result.data?.entry?.label ?? '';
    return { code: 0, message: label ? `${direction === 'undo' ? 'Undone' : 'Redone'}: ${label}` : '', data: result.data };
  }

  // the blocks the step changed, in the body showing the document, brought into
  // view and marked once the body is drawn
  private async revealAfterStep(path: string, textBefore: string | undefined) {
    if (typeof document === 'undefined') return;
    const textAfter = this.editStore.sourceByPath[path]?.text;
    const blockList = historyChangeBlockListGet(this.editStore.docEditGet(path)?.model, textBefore, textAfter);
    if (blockList.length === 0) return;
    await frameWait(2);
    const body = [...document.querySelectorAll('.doc-edit-body[data-edit-path]')]
      .find((element) => element.getAttribute('data-edit-path') === path);
    if (!body) return;
    historyChangeReveal({ body, pageElement: this.pageElementGet() ?? undefined, blockList });
  }
}

function frameWait(count: number): Promise<void> {
  return new Promise((resolve) => {
    const next = (left: number) => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => next(left - 1));
    };
    next(count);
  });
}
