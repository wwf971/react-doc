import { makeAutoObservable, runInAction } from 'mobx';
import type { DocSourceStore, SourceResult } from './DocSourceStore.js';
import { sourcePathDirGet, sourcePathFullGet, sourcePathNameGet, sourcePathNormalize, sourcePathParse } from '../lib/doc-source-path.js';

// Relocation as the page offers it (design: doc_page_impl_nav_backlink.md#relocation): a
// file moved or renamed with every reference to it kept, the development server
// planning and writing it (plugin/doc-relocate.ts). The dialog (RelocateDialog)
// shows the plan for the target chosen: the documents whose references are spelled
// anew, the side panels and entries rebound, what is left as it is and why. The same
// move is offered wherever a file is: a side-panel item (Move document…, Rename
// document…), the Managed documents tab (into or out of a virtual root), and the apis
// doc/move.
//
//   dialog       { from, mode: move | rename, dirPath, name, point?, plan, apply, isDetailOpen }
//     plan         the plan of the target shown: { status, data, message, pathTo }
//                  read again a moment after the target changes
//     apply        { status: idle | submitting | error, message }
//   dialogOpen({ from, mode, dirPath?, name?, point? })   the target starts as the file's place
//   targetSet({ dirPath?, name? })                         then the plan is read again
//   applySubmit()                                          written with the key of the plan shown;
//                                                          a source changed since answers the new plan
//
// what moved is reported by the server as source data: the page follows by itself,
// and goes to the new place of the document shown when that was the one moved.

export type RelocateMode = 'move' | 'rename';

export type RelocatePlanState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  data: any;
  message: string;
  // the target the plan is for
  pathTo: string;
};

export type RelocateDialog = {
  from: string;
  mode: RelocateMode;
  dirPath: string;
  name: string;
  point?: { clientX: number; clientY: number };
  plan: RelocatePlanState;
  apply: { status: 'idle' | 'submitting' | 'error'; message: string };
  isDetailOpen: boolean;
};

const PLAN_DELAY_MS = 180;

export class DocRelocateStore {
  sourceStore: DocSourceStore;
  docStore: any;
  dialog: RelocateDialog | undefined = undefined;
  private planTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  private planSeq = 0;

  constructor({ sourceStore, docStore }: { sourceStore: DocSourceStore; docStore: any }) {
    this.sourceStore = sourceStore;
    this.docStore = docStore;
    makeAutoObservable(this, { sourceStore: false, docStore: false }, { autoBind: true });
  }

  // why nothing can be moved here ('' when it can)
  get unavailableReason(): string {
    if (!this.sourceStore.isWritable) return 'Files are moved through the development server only.';
    return '';
  }

  // the target as a full source path
  get pathTo(): string {
    if (!this.dialog) return '';
    const dirPath = sourcePathNormalize(this.dialog.dirPath);
    const name = this.dialog.name.trim();
    if (!dirPath || !name) return '';
    return `${dirPath}/${name}`;
  }

  // why the target cannot be planned ('' when it can)
  get targetProblem(): string {
    const dialog = this.dialog;
    if (!dialog) return '';
    const name = dialog.name.trim();
    if (!name) return 'The file needs a name.';
    if (/[/\\]/.test(name)) return 'A name holds no folder; choose the folder above.';
    if (!sourcePathParse(sourcePathNormalize(dialog.dirPath))) return 'Choose a folder of the source.';
    if (this.pathTo === dialog.from) return 'That is where the file is.';
    return '';
  }

  dialogOpen({ from, mode = 'move', dirPath, name, point }: { from: string; mode?: RelocateMode; dirPath?: string; name?: string; point?: { clientX: number; clientY: number } }) {
    const fromFull = this.sourceStore.pathFullGet(from);
    this.dialog = {
      from: fromFull,
      mode,
      dirPath: dirPath ? this.sourceStore.pathFullGet(dirPath) : sourcePathDirGet(fromFull),
      name: name ?? sourcePathNameGet(fromFull),
      point,
      plan: { status: 'idle', data: undefined, message: '', pathTo: '' },
      apply: { status: 'idle', message: '' },
      isDetailOpen: false,
    };
    this.planSchedule();
  }

  dialogClose() {
    if (this.dialog?.apply.status === 'submitting') return;
    if (this.planTimer) clearTimeout(this.planTimer);
    this.dialog = undefined;
  }

  targetSet({ dirPath, name }: { dirPath?: string; name?: string }) {
    if (!this.dialog) return;
    if (dirPath !== undefined) this.dialog.dirPath = sourcePathFullGet(sourcePathNormalize(dirPath), sourcePathParse(this.dialog.from)?.docPageAlias ?? '');
    if (name !== undefined) this.dialog.name = name;
    this.dialog.apply = { status: 'idle', message: '' };
    this.planSchedule();
  }

  detailToggle() {
    if (this.dialog) this.dialog.isDetailOpen = !this.dialog.isDetailOpen;
  }

  private planSchedule() {
    if (this.planTimer) clearTimeout(this.planTimer);
    const dialog = this.dialog;
    if (!dialog) return;
    const problem = this.targetProblem;
    if (problem) {
      dialog.plan = { status: 'idle', data: undefined, message: problem, pathTo: '' };
      return;
    }
    dialog.plan = { ...dialog.plan, status: 'loading', message: '' };
    this.planTimer = setTimeout(() => { void this.planLoad(); }, PLAN_DELAY_MS);
  }

  async planLoad(): Promise<void> {
    const dialog = this.dialog;
    if (!dialog || this.targetProblem) return;
    const pathTo = this.pathTo;
    const seq = ++this.planSeq;
    const result = await this.planRequest(dialog.from, pathTo);
    runInAction(() => {
      if (seq !== this.planSeq || this.dialog !== dialog) return;
      dialog.plan = result.code === 0
        ? { status: 'done', data: result.data, message: '', pathTo }
        : { status: 'error', data: undefined, message: result.message, pathTo };
    });
  }

  async applySubmit(): Promise<SourceResult> {
    const dialog = this.dialog;
    if (!dialog || dialog.plan.status !== 'done' || dialog.plan.pathTo !== this.pathTo) {
      return { code: -1, message: 'Wait for the plan of this target.' };
    }
    dialog.apply = { status: 'submitting', message: '' };
    const from = dialog.from;
    const to = dialog.plan.pathTo;
    const result = await this.sourceStore.sourceApiCall('/file/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moveList: [{ from, to }], planKey: dialog.plan.data?.planKey }),
    });
    runInAction(() => {
      if (this.dialog !== dialog) return;
      if (result.code === 0) {
        this.dialog = undefined;
        return;
      }
      dialog.apply = { status: 'error', message: result.message };
      // the source changed since: the plan as it is now
      if (result.code === -2 && result.data?.planKey) dialog.plan = { status: 'done', data: result.data, message: '', pathTo: to };
    });
    if (result.code === 0) this.docShownFollow(from, to);
    return result;
  }

  // the document shown was the one moved: go to where it is now
  private docShownFollow(from: string, to: string) {
    if (this.docStore?.docCurrentPath !== from) return;
    const go = () => this.docStore.navigate(to, undefined, { historyMode: 'replace' });
    // the source data of the move arrives as an event; go once the new path is in the manifest
    if (this.sourceStore.entryByInternalPath.has(to)) {
      go();
      return;
    }
    let tryCount = 0;
    const timer = setInterval(() => {
      tryCount += 1;
      if (this.sourceStore.entryByInternalPath.has(to) || tryCount > 40) {
        clearInterval(timer);
        go();
      }
    }, 50);
  }

  // ---------- without the dialog (the apis) ----------

  planRequest(from: string, to: string): Promise<SourceResult> {
    return this.sourceStore.sourceApiCall('/file/move/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moveList: [{ from, to }] }),
    });
  }

  // a move planned and written at once (an agent asked for it); isPlanOnly: the plan alone
  async move(fromGiven: string, toGiven: string, { isPlanOnly = false } = {}): Promise<SourceResult> {
    if (this.unavailableReason) return { code: -1, message: this.unavailableReason };
    const from = this.sourceStore.pathFullGet(fromGiven);
    const to = this.sourceStore.pathFullGet(toGiven, from);
    const plan = await this.planRequest(from, to);
    if (plan.code !== 0 || isPlanOnly) return plan;
    const result = await this.sourceStore.sourceApiCall('/file/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moveList: [{ from, to }], planKey: plan.data?.planKey }),
    });
    if (result.code === 0) this.docShownFollow(from, to);
    return result;
  }
}
