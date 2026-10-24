import { makeAutoObservable, observable, reaction, runInAction, untracked } from 'mobx';
import {
  compStateKeyParse,
  lineShiftApply,
} from '../lib/doc-comp-state.js';

// The component state service layer (design: doc_page_impl_mdx_comp_state.md).
// A component on the page may hold more than it renders: a draft not yet
// saved, which sheet is active and which cells are selected, which folders
// are open, a count. That is its state: not its data (the document or the
// asset object holds that), not persisted, and lost with the page. This
// store keeps it in state objects outside the mounted component, so that
//
//   - it survives the component's unmount: a reader navigates away and
//     back, and the block is as it was left
//   - every mount of the same block shares it: the block shown twice (two
//     blocks reading one asset object today, the same document in two tabs
//     later) renders one state, so what one changes the other shows at once
//
// a state object is found by a key, chosen by the registry boundary from
// the most stable identity the block has (doc-comp-state.js,
// compStateKeyBuild): the asset object, the block's id prop, its place
// (document and marker line), else the instance id of the mount.
//
//   stateByKey    key -> CompStateObject
//                   value       the state, an observable mapping (or whatever
//                               the component keeps; a class instance is kept as is)
//                   holdCount   how many mounted components hold it now
//                   timeTouched the last hold or release
//
// lifecycle: a mount holds its state (stateHold) and releases it when it
// unmounts (stateRelease); a state nobody holds is idle and kept, since the
// block may come back. idle states are collected, oldest first, beyond
// idleMax, and when their document leaves the source (init: the manifest).
// a state keyed by a place follows the lines the edit layer moves itself
// (docLineShift, docLineRemap); a block removed by the page takes its state
// with it. nothing here is a promise that a state is kept: a component
// writes what it cannot afford to lose into its data.
export type CompStateKind = 'asset' | 'id' | 'place' | 'instance';

export class CompStateObject {
  key: string;
  kind: CompStateKind;
  docPath: string;
  compId: string;
  value: any;
  holdCount = 0;
  timeCreated: number;
  timeTouched: number;

  constructor({ key, compId, initial }: { key: string; compId: string; initial: any }) {
    const parsed = compStateKeyParse(key);
    this.key = key;
    this.kind = parsed.kind as CompStateKind;
    this.docPath = parsed.docPath ?? '';
    this.compId = compId;
    this.value = initial;
    this.timeCreated = Date.now();
    this.timeTouched = this.timeCreated;
    makeAutoObservable(this, { kind: false, docPath: false, compId: false });
  }

  // the keys of patch merged into the value (a mapping); a value that is not
  // a mapping is replaced by the patch
  patch(patch: Record<string, any>) {
    if (this.value && typeof this.value === 'object' && !Array.isArray(this.value)) {
      Object.assign(this.value, patch);
    } else {
      this.value = { ...patch };
    }
  }

  set(value: any) {
    this.value = value;
  }
}

export const COMP_STATE_IDLE_MAX_DEFAULT = 300;

type DocCompStateStoreOptions = {
  // the manifest tells which documents exist; the states of a document that
  // left it are collected
  sourceStore?: { fileManifest: Record<string, any> | undefined };
  idleMax?: number;
};

export class DocCompStateStore {
  stateByKey = observable.map<string, CompStateObject>({}, { deep: false });
  idleMax: number;
  sourceStore: DocCompStateStoreOptions['sourceStore'];
  reactionDispose: (() => void) | undefined;

  constructor(options: DocCompStateStoreOptions = {}) {
    this.idleMax = options.idleMax ?? COMP_STATE_IDLE_MAX_DEFAULT;
    this.sourceStore = options.sourceStore;
    makeAutoObservable(this, {
      stateByKey: false,
      idleMax: false,
      sourceStore: false,
      reactionDispose: false,
    });
  }

  init() {
    if (!this.sourceStore) return;
    this.reactionDispose = reaction(
      () => Object.keys(this.sourceStore?.fileManifest ?? {}),
      (pathList) => {
        const pathSet = new Set(pathList);
        for (const state of this.stateByKey.values()) {
          if (state.docPath && !pathSet.has(state.docPath)) this.docDrop(state.docPath);
        }
      },
    );
  }

  dispose() {
    this.reactionDispose?.();
    this.reactionDispose = undefined;
  }

  // ---------- reading ----------

  stateGet(key: string): CompStateObject | undefined {
    return this.stateByKey.get(key);
  }

  get stateList(): CompStateObject[] {
    return [...this.stateByKey.values()].sort((a, b) => b.timeTouched - a.timeTouched);
  }

  get idleCount(): number {
    let count = 0;
    for (const state of this.stateByKey.values()) if (state.holdCount === 0) count += 1;
    return count;
  }

  // ---------- holding ----------

  // the state of the key, created with the initial value when there is
  // none. read without tracking the map, so a component may call it while
  // rendering (useCompState) without rendering again for the creation.
  stateEnsure(key: string, { initial = {}, compId = '' }: { initial?: any; compId?: string } = {}): CompStateObject {
    const existing = untracked(() => this.stateByKey.get(key));
    if (existing) return existing;
    const state = new CompStateObject({ key, compId, initial: typeof initial === 'function' ? initial() : initial });
    runInAction(() => {
      this.stateByKey.set(key, state);
    });
    return state;
  }

  // a mounted component holds the state from its mount to its unmount
  stateHold(key: string, options: { initial?: any; compId?: string } = {}): CompStateObject {
    const state = this.stateEnsure(key, options);
    runInAction(() => {
      state.holdCount += 1;
      state.timeTouched = Date.now();
    });
    return state;
  }

  // released by the object the hold returned (its key may have moved
  // meanwhile, docLineRemap), or by key
  stateRelease(stateOrKey: CompStateObject | string) {
    const state = typeof stateOrKey === 'string' ? this.stateByKey.get(stateOrKey) : stateOrKey;
    if (!state) return;
    state.holdCount = Math.max(0, state.holdCount - 1);
    state.timeTouched = Date.now();
    this.idleCollect();
  }

  statePatch(key: string, patch: Record<string, any>) {
    this.stateByKey.get(key)?.patch(patch);
  }

  stateSet(key: string, value: any) {
    this.stateByKey.get(key)?.set(value);
  }

  stateDrop(key: string) {
    this.stateByKey.delete(key);
  }

  // ---------- collection ----------

  // idle states beyond idleMax are dropped, the ones touched longest ago first
  idleCollect() {
    const idleList = [...this.stateByKey.values()]
      .filter((state) => state.holdCount === 0)
      .sort((a, b) => a.timeTouched - b.timeTouched);
    const countOver = idleList.length - this.idleMax;
    for (let index = 0; index < countOver; index += 1) this.stateByKey.delete(idleList[index].key);
  }

  // the idle states of a document (a document that left the source, or
  // whose text changed in a way nothing can follow); held ones stay until
  // their mounts release them
  docDrop(docPath: string) {
    for (const state of [...this.stateByKey.values()]) {
      if (state.docPath === docPath && state.holdCount === 0) this.stateByKey.delete(state.key);
    }
  }

  // ---------- following the lines of a document ----------

  // the edit layer wrote a document: the place-keyed states of its blocks
  // move with their marker lines (doc-comp-state.js, lineShiftListGet)
  docLineShift(docPath: string, shiftList: { lineStart: number; lineEnd: number; delta: number; action: string }[]) {
    if (shiftList.length === 0) return;
    const remapList: { lineFrom: number; lineTo: number | undefined }[] = [];
    for (const state of this.stateByKey.values()) {
      if (state.kind !== 'place' || state.docPath !== docPath) continue;
      const lineFrom = compStateKeyParse(state.key).sourceLine as number;
      const lineTo = lineShiftApply(lineFrom, shiftList);
      if (lineTo !== lineFrom) remapList.push({ lineFrom, lineTo });
    }
    this.docLineRemap(docPath, remapList);
  }

  // the marker lines of blocks of a document changed places: every state
  // keyed by lineFrom is keyed by lineTo afterwards, all at once (so two
  // blocks exchanging lines exchange keys); lineTo undefined drops the state
  // (its block is gone). a state already at a target line that no entry
  // moves away is replaced. the state objects stay the same objects, so a
  // mount holding one keeps holding it under the new key.
  docLineRemap(docPath: string, remapList: { lineFrom: number; lineTo: number | undefined }[]) {
    if (remapList.length === 0) return;
    const moveList: { state: CompStateObject; keyTo: string | undefined }[] = [];
    for (const remap of remapList) {
      const state = this.stateByKey.get(`place:${docPath}:${remap.lineFrom}`);
      if (!state) continue;
      moveList.push({ state, keyTo: remap.lineTo === undefined ? undefined : `place:${docPath}:${remap.lineTo}` });
    }
    for (const move of moveList) this.stateByKey.delete(move.state.key);
    for (const move of moveList) {
      if (move.keyTo === undefined) continue;
      move.state.key = move.keyTo;
      this.stateByKey.set(move.keyTo, move.state);
    }
  }
}
