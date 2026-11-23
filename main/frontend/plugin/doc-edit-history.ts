import { textHashGet } from './doc-edit-lines.ts';
import { textMerge3 } from '../src/lib/doc-text-merge.ts';

// The edit history of the development server (design: doc_page_impl_edit_history.md).
// Every write of a document the edit api applies is recorded here, in the memory of
// the server: the text of the file before and after, and what the page said of the
// action (its label, the document it was made in). The page asks for the entries of
// a document, and undoes or redoes one: its text before (after) is written back,
// merged with what changed since when the file is no longer as the entry left it.
// Nothing is kept on disk: a server started again starts with no history.
//
//   entry           one action of the author: one write, or the writes of several
//                   files the page sent under one actionId (blocks moved from a
//                   document into another)
//   the entries of a document   oldest first; an undo takes the last done one, a
//                   redo the one undone last; a new entry drops the undone ones
//   an entry made in an embedded document (doc_page_impl_mdx_embed.md) is an entry
//                   of its host, with the hashes of the embedded text before and
//                   after (embed), by which the popup of that block finds its own

export type HistoryMeta = {
  // the writes of one action carry one id (several files)
  actionId?: string;
  kind?: string;
  // what an undo button says: "Move block"
  label?: string;
  // the document the action was made in: the file, or an embedded document
  docPath?: string;
  // the action was made in an embedded document: its line in the host and the
  // hashes of its text before and after (lib/doc-edit-embed.js)
  embed?: { line: number; hashBefore: string; hashAfter: string };
  // the write takes back the last entry of the file (a created block canceled):
  // that entry goes, and nothing is recorded
  isRetract?: boolean;
};

// a file deleted with the write (a block deleted with the files its component
// offered): its place and its backup, absolute paths (doc-source-file.ts)
export type HistoryFileMove = { file: string; backup: string };

export type HistoryFileChange = {
  path: string;
  hashBefore: string;
  hashAfter: string;
  textBefore: string;
  textAfter: string;
  fileMoveList?: HistoryFileMove[];
};

export type HistoryEntry = {
  entryId: string;
  seq: number;
  kind: string;
  label: string;
  time: number;
  state: 'done' | 'undone';
  // the order of the undos: a redo takes the entry undone last
  undoSeq: number;
  actionId: string;
  docPath: string;
  embed?: { line: number; hashBefore: string; hashAfter: string };
  fileChangeList: HistoryFileChange[];
  byteCount: number;
};

export type HistoryEntrySummary = {
  entryId: string;
  seq: number;
  kind: string;
  label: string;
  time: number;
  state: 'done' | 'undone';
  undoSeq: number;
  docPath: string;
  embed?: { line: number; hashBefore: string; hashAfter: string };
  pathList: string[];
};

export type HistorySummary = {
  path: string;
  entryList: HistoryEntrySummary[];
  // the entries an undo and a redo of the whole document would take ('' none)
  undoEntryId: string;
  redoEntryId: string;
};

export type HistoryStepWrite = { path: string; textCurrent: string; hashCurrent: string; textNext: string; change: HistoryFileChange };

type Result<T> = { code: number; message: string; data?: T };

const LABEL_LENGTH_MAX = 200;

export class DocEditHistory {
  entryListByPath = new Map<string, HistoryEntry[]>();
  seqLast = 0;
  undoSeqLast = 0;
  byteCount = 0;
  entryCountMaxPerPath: number;
  byteCountMax: number;
  // the writes of one action come one after another; a later write with the
  // same id joins its entry
  actionJoinMs: number;
  entryLast: HistoryEntry | undefined;

  constructor({ entryCountMaxPerPath = 100, byteCountMax = 64 * 1024 * 1024, actionJoinMs = 30_000 } = {}) {
    this.entryCountMaxPerPath = entryCountMaxPerPath;
    this.byteCountMax = byteCountMax;
    this.actionJoinMs = actionJoinMs;
  }

  // a write the edit api applied. answers the entry it is in, or undefined when
  // nothing was recorded (no change, or a retract)
  record(change: HistoryFileChange, metaRaw: unknown = {}, time = Date.now()): HistoryEntry | undefined {
    if (change.hashBefore === change.hashAfter && !(change.fileMoveList?.length)) return undefined;
    const meta = historyMetaNormalize(metaRaw);
    const list = this.entryListByPath.get(change.path) ?? [];
    if (meta.isRetract) {
      const top = this.entryDoneLastGet(change.path);
      const changeTop = top?.fileChangeList.length === 1 ? top.fileChangeList[0] : undefined;
      if (top && changeTop && changeTop.path === change.path && changeTop.hashAfter === change.hashBefore && changeTop.hashBefore === change.hashAfter) {
        this.entryRemove(top);
        return undefined;
      }
    }
    // a new action on the document: what was undone in it cannot be redone
    const entryJoin = meta.actionId && this.entryLast?.actionId === meta.actionId
      && this.entryLast.state === 'done' && time - this.entryLast.time <= this.actionJoinMs ? this.entryLast : undefined;
    for (const entry of [...list]) {
      if (entry.state === 'undone' && entry !== entryJoin) this.entryRemove(entry);
    }
    const listNow = this.entryListByPath.get(change.path) ?? [];
    // the text before is the text after of the entry before, mostly: kept once
    const changeBefore = listNow.length > 0 ? listNow[listNow.length - 1].fileChangeList.find((one) => one.path === change.path) : undefined;
    const isShared = changeBefore !== undefined && changeBefore.textAfter === change.textBefore;
    const changeKept: HistoryFileChange = isShared ? { ...change, textBefore: changeBefore!.textAfter } : { ...change };
    const byteCount = changeKept.textAfter.length + (isShared ? 0 : changeKept.textBefore.length);
    if (entryJoin) {
      const changeSame = entryJoin.fileChangeList.find((one) => one.path === change.path);
      if (changeSame && changeSame.hashAfter === change.hashBefore) {
        changeSame.textAfter = changeKept.textAfter;
        changeSame.hashAfter = changeKept.hashAfter;
        changeSame.fileMoveList = [...(changeSame.fileMoveList ?? []), ...(changeKept.fileMoveList ?? [])];
      } else {
        entryJoin.fileChangeList.push(changeKept);
        if (!listNow.includes(entryJoin)) this.pathListAppend(change.path, entryJoin);
      }
      entryJoin.byteCount += byteCount;
      this.byteCount += byteCount;
      this.bound(change.path);
      return entryJoin;
    }
    this.seqLast += 1;
    const entry: HistoryEntry = {
      entryId: `h${time.toString(36)}${this.seqLast.toString(36)}`,
      seq: this.seqLast,
      kind: meta.kind || 'write',
      label: meta.label || 'Edit',
      time,
      state: 'done',
      undoSeq: 0,
      actionId: meta.actionId || '',
      docPath: meta.docPath || change.path,
      ...(meta.embed ? { embed: meta.embed } : {}),
      fileChangeList: [changeKept],
      byteCount,
    };
    this.pathListAppend(change.path, entry);
    this.byteCount += byteCount;
    this.entryLast = entry;
    this.bound(change.path);
    return entry;
  }

  summaryGet(path: string): HistorySummary {
    const list = this.entryListByPath.get(path) ?? [];
    return {
      path,
      entryList: list.map(entrySummaryBuild),
      undoEntryId: this.entryDoneLastGet(path)?.entryId ?? '',
      redoEntryId: this.entryUndoneLastGet(path)?.entryId ?? '',
    };
  }

  // what an undo or a redo of an entry of the document writes: for every file of
  // the entry, its current text (read now) and the text it gets. the entry is the
  // one named, or the one an undo (redo) of the document takes. refused with -2
  // when a file changed since where the entry would change it
  stepPrepare(
    { path, direction, entryId }: { path: string; direction: 'undo' | 'redo'; entryId?: string },
    textRead: (path: string) => string | undefined,
  ): Result<{ entry: HistoryEntry; writeList: HistoryStepWrite[] }> {
    const list = this.entryListByPath.get(path) ?? [];
    const stateWanted = direction === 'undo' ? 'done' : 'undone';
    const entry = entryId
      ? list.find((one) => one.entryId === entryId)
      : (direction === 'undo' ? this.entryDoneLastGet(path) : this.entryUndoneLastGet(path));
    if (!entry) {
      return { code: -1, message: entryId ? `the history of ${path} has no entry ${entryId}` : `nothing to ${direction} in ${path}` };
    }
    if (entry.state !== stateWanted) return { code: -1, message: `"${entry.label}" is ${entry.state === 'done' ? 'not undone' : 'undone'} already` };
    const writeList: HistoryStepWrite[] = [];
    for (const change of entry.fileChangeList) {
      const textCurrent = textRead(change.path);
      if (textCurrent === undefined) return { code: -3, message: `${change.path} cannot be read: the change cannot be ${direction}ne` };
      const hashCurrent = textHashGet(textCurrent);
      const [textFrom, hashFrom, textTo, hashTo] = direction === 'undo'
        ? [change.textAfter, change.hashAfter, change.textBefore, change.hashBefore]
        : [change.textBefore, change.hashBefore, change.textAfter, change.hashAfter];
      let textNext: string;
      if (hashCurrent === hashFrom) textNext = textTo;
      else if (hashCurrent === hashTo) textNext = textCurrent;
      else {
        // the file changed since: the change is taken back where its lines still are as it left them
        const merged = textMerge3({ base: textFrom, ours: textCurrent, theirs: textTo });
        if (merged.code !== 0) {
          return {
            code: -2,
            message: `"${entry.label}" cannot be ${direction}ne: ${change.path} changed since where it would write (${merged.data.lineStart === merged.data.lineEnd ? `line ${merged.data.lineStart}` : `lines ${merged.data.lineStart}–${merged.data.lineEnd}`} of the text it left); nothing was written`,
          };
        }
        textNext = merged.data.text;
      }
      writeList.push({ path: change.path, textCurrent, hashCurrent, textNext, change });
    }
    return { code: 0, message: '', data: { entry, writeList } };
  }

  // the step was written: the entry is undone (redone)
  stepCommit(entry: HistoryEntry, direction: 'undo' | 'redo') {
    if (direction === 'undo') {
      this.undoSeqLast += 1;
      entry.state = 'undone';
      entry.undoSeq = this.undoSeqLast;
    } else {
      entry.state = 'done';
    }
    this.entryLast = undefined;
  }

  // the history of a document forgotten (the entries it is in, in every document)
  pathClear(path: string) {
    for (const entry of [...(this.entryListByPath.get(path) ?? [])]) this.entryRemove(entry);
    this.entryListByPath.delete(path);
  }

  // a document moved or renamed (doc-relocate.ts): its entries follow it, so an undo after the
  // move writes the document where it is now. an entry of several files is listed under each
  // of them, and names the moved one by its new path
  pathMove(pathFrom: string, pathTo: string) {
    if (pathFrom === pathTo) return;
    const list = this.entryListByPath.get(pathFrom);
    if (!list) return;
    for (const entry of list) {
      if (entry.docPath === pathFrom) entry.docPath = pathTo;
      for (const change of entry.fileChangeList) if (change.path === pathFrom) change.path = pathTo;
    }
    this.entryListByPath.delete(pathFrom);
    this.entryListByPath.set(pathTo, [...(this.entryListByPath.get(pathTo) ?? []), ...list]);
  }

  private entryDoneLastGet(path: string): HistoryEntry | undefined {
    const list = this.entryListByPath.get(path) ?? [];
    for (let index = list.length - 1; index >= 0; index -= 1) if (list[index].state === 'done') return list[index];
    return undefined;
  }

  private entryUndoneLastGet(path: string): HistoryEntry | undefined {
    let found: HistoryEntry | undefined;
    for (const entry of this.entryListByPath.get(path) ?? []) {
      if (entry.state === 'undone' && (!found || entry.undoSeq > found.undoSeq)) found = entry;
    }
    return found;
  }

  private pathListAppend(path: string, entry: HistoryEntry) {
    const list = this.entryListByPath.get(path) ?? [];
    list.push(entry);
    this.entryListByPath.set(path, list);
  }

  private entryRemove(entry: HistoryEntry) {
    for (const change of entry.fileChangeList) {
      const list = this.entryListByPath.get(change.path);
      if (!list) continue;
      const index = list.indexOf(entry);
      if (index >= 0) list.splice(index, 1);
      if (list.length === 0) this.entryListByPath.delete(change.path);
    }
    this.byteCount -= entry.byteCount;
    if (this.entryLast === entry) this.entryLast = undefined;
  }

  // the oldest entries go: past the count of a document, past the bytes of all
  private bound(path: string) {
    const list = this.entryListByPath.get(path) ?? [];
    while (list.length > this.entryCountMaxPerPath) this.entryRemove(list[0]);
    while (this.byteCount > this.byteCountMax) {
      let oldest: HistoryEntry | undefined;
      for (const listOne of this.entryListByPath.values()) {
        if (listOne[0] && (!oldest || listOne[0].seq < oldest.seq)) oldest = listOne[0];
      }
      if (!oldest) break;
      this.entryRemove(oldest);
    }
  }
}

function entrySummaryBuild(entry: HistoryEntry): HistoryEntrySummary {
  return {
    entryId: entry.entryId,
    seq: entry.seq,
    kind: entry.kind,
    label: entry.label,
    time: entry.time,
    state: entry.state,
    undoSeq: entry.undoSeq,
    docPath: entry.docPath,
    ...(entry.embed ? { embed: entry.embed } : {}),
    pathList: entry.fileChangeList.map((change) => change.path),
  };
}

// what a request says of its action, kept to the fields and the sizes the history knows
export function historyMetaNormalize(raw: unknown): HistoryMeta {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;
  const text = (one: unknown, lengthMax: number) => (typeof one === 'string' ? one.slice(0, lengthMax) : undefined);
  const meta: HistoryMeta = {};
  if (text(value.actionId, 100)) meta.actionId = text(value.actionId, 100);
  if (text(value.kind, 60)) meta.kind = text(value.kind, 60);
  if (text(value.label, LABEL_LENGTH_MAX)) meta.label = text(value.label, LABEL_LENGTH_MAX);
  if (text(value.docPath, 2000)) meta.docPath = text(value.docPath, 2000);
  const embed = value.embed as Record<string, unknown> | undefined;
  if (embed && typeof embed === 'object' && typeof embed.hashBefore === 'string' && typeof embed.hashAfter === 'string') {
    meta.embed = { line: Number(embed.line) || 0, hashBefore: embed.hashBefore.slice(0, 100), hashAfter: embed.hashAfter.slice(0, 100) };
  }
  if (value.isRetract === true) meta.isRetract = true;
  return meta;
}
