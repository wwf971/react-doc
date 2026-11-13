import { makeAutoObservable, observable } from 'mobx';
import { cellTextParse, cellTextPlainGet, cellTokenListResolve, cellTriggerListBuild } from '../lib/doc-cell.js';
import { cellTokenSlashActionGet } from '../../../comp-doc/cell/cell-define.js';

// The cell edit layer of the page (design: doc_page_impl_edit_cell.md).
//
// A cell is one small value a component draws and lets the author type in
// place: a cell of a table, a field of a form, a line of a card, usually
// of a mode of a frontend object. Its text is plain text with tokens in it
// (lib/doc-cell.js): a link, a view of an object, a value the component
// reads from its own data. This store is the one central part between
// three things that know nothing of each other:
//
//   the token kinds      what a token is: written, drawn, typed (cell-define.js).
//                        the page's (cellTokenById: the link of the navigation
//                        layer, the object view of the object service layer) and
//                        the component's own, brought with each cell
//   the slash mode       how a token is typed (DocSlashStore): the store builds
//                        the slash of a cell from the actions of its kinds, with
//                        the context they read
//   the component        draws the cell (CellValue), opens it (CellEdit, or
//                        CellField for both), and keeps the text in its data
//
//   cellTokenById   the registry of the page (DocPageMdx builds it, cell-define.js
//                   cellTokenByIdBuild)
//   token           the one token selected on the page, or undefined: { key, start }
//                     key     the value it stands in (CellValue cellKey)
//                     start   where it starts in the text of that value
//                   a token whose kind has a card is selected by a click in a cell
//                   that can be edited, and its card stands beside it
//   field           the one field open on the page (CellField), or undefined:
//                   { key, draft, textBase, status, message, point }
//                     key        the field, unique on the page while it is drawn
//                     textBase   the text it was opened on
//                     point      where it was clicked: the caret goes there
//                     status     idle | submitting; message: why a save was refused
//
// A cell (cellBuild) is what the components and the kinds are handed:
//   { tokenList      the kinds it accepts, its own first
//     context        the component's own, read live (a value of its data)
//     sourcePath     the document it is drawn in; owner: the reference of the
//                    object it belongs to
//     source, object the service objects the kinds of the page read
//     slash          what its surface offers the slash mode (undefined
//                    without a slash store: the surface is plain text)
//     parse(text)    its parts; textGet(text): its plain text }

type Stores = { slashStore?: any; sourceStore?: any; objectStore?: any };

export type CellField = {
  key: string; draft: string; textBase: string; status: 'idle' | 'submitting'; message: string;
  // where the field was clicked (viewport coordinates): the caret goes to the text nearest to it
  point?: { clientX: number; clientY: number };
};

export type CellSpec = {
  // the cell's own kinds (the component's, over its own data)
  tokenList?: any[];
  // the kinds of the page it accepts, by id: undefined every one, [] none
  tokenIdList?: string[];
  // what the cell's own kinds and their actions read: kept current by the component
  context?: Record<string, any>;
  sourcePath?: string;
  owner?: string;
};

const PARSE_CACHE_SIZE_MAX = 400;

export type CellTokenSelected = { key: string; start: number };

export class DocCellStore {
  stores: Stores;
  cellTokenById: Record<string, any> = {};
  field: CellField | undefined = undefined;
  token: CellTokenSelected | undefined = undefined;
  // the parts of a text, by the kinds it was parsed against: cells are drawn
  // on every render of their component, and their texts seldom change
  parseCacheByTokenList = new WeakMap<object, Map<string, any[]>>();

  constructor({ cellTokenById = {}, stores = {} }: { cellTokenById?: Record<string, any>; stores?: Stores } = {}) {
    this.cellTokenById = cellTokenById;
    this.stores = stores;
    makeAutoObservable(this, {
      stores: false,
      parseCacheByTokenList: false,
      cellTokenById: observable.ref,
      field: observable.ref,
      token: observable.ref,
    });
  }

  // ---------- the registry ----------

  replaceCellTokenById(cellTokenById: Record<string, any>) {
    this.cellTokenById = cellTokenById ?? {};
  }

  // the kinds a cell accepts: its own, then the page's (lib/doc-cell.js)
  tokenListResolve({ tokenList = [], tokenIdList }: { tokenList?: any[]; tokenIdList?: string[] } = {}): any[] {
    return cellTokenListResolve({ tokenOwnList: tokenList, tokenById: this.cellTokenById, tokenIdList });
  }

  // ---------- a cell ----------

  // the cell of a spec. the component builds it once per kind of cell it
  // draws (use-cell.js) and hands it to every CellValue and CellEdit of that kind
  cellBuild(spec: CellSpec = {}) {
    const tokenList = this.tokenListResolve(spec);
    const store = this;
    const contextOwn = spec.context ?? {};
    const cell: any = {
      tokenList,
      context: contextOwn,
      sourcePath: spec.sourcePath ?? '',
      owner: spec.owner ?? '',
      get source() { return store.stores.sourceStore?.sourceService; },
      get object() { return store.stores.objectStore; },
      parse: (text: string) => store.parse(text, tokenList),
      textGet: (text: string) => cellTextPlainGet(store.parse(text, tokenList), (part: any) => part.kind.textGet?.(part, cell)),
    };
    cell.slash = this.slashBuild(cell);
    return cell;
  }

  // the parts of a text read against the kinds of a cell, kept while the kinds are
  parse(text: string, tokenList: any[]): any[] {
    const key = String(text ?? '');
    let cache = this.parseCacheByTokenList.get(tokenList);
    if (!cache) {
      cache = new Map();
      this.parseCacheByTokenList.set(tokenList, cache);
    }
    let partList = cache.get(key);
    if (!partList) {
      partList = cellTextParse(key, tokenList);
      if (cache.size >= PARSE_CACHE_SIZE_MAX) cache.clear();
      cache.set(key, partList);
    }
    return partList;
  }

  // what the surface of a cell offers the slash mode (EditSourceSurface slash):
  // the actions of its kinds and nothing else, the brace kinds entered at once
  // by their opening text, and a "/" starting it anywhere but in a path. the
  // actions read the component's context first (read live: it stays the
  // prototype of what they are given), with the page's services added
  slashBuild(cell: any) {
    const slashStore = this.stores.slashStore;
    if (!slashStore) return undefined;
    const store = this;
    const actionOf = (kind: any) => cellTokenSlashActionGet(kind, cell);
    const actionList: any[] = [];
    for (const kind of cell.tokenList) {
      const action = actionOf(kind);
      if (action && !actionList.includes(action)) actionList.push(action);
    }
    const context = Object.create(cell.context, {
      cell: { value: cell, enumerable: true },
      sourcePath: { value: cell.sourcePath, enumerable: true },
      docPageAlias: { get: () => store.stores.sourceStore?.docPageAliasOfPath?.(cell.sourcePath) ?? '', enumerable: true },
      source: { get: () => store.stores.sourceStore?.sourceService, enumerable: true },
      object: { get: () => store.stores.objectStore, enumerable: true },
    });
    return {
      store: slashStore,
      context,
      actionList,
      isPageActionIncluded: false,
      isTriggerLoose: true,
      triggerList: cellTriggerListBuild(cell.tokenList.filter((kind: any) => kind.isTriggerDirect !== false), actionOf),
    };
  }

  // ---------- the selected token ----------

  tokenIsSelected(key: string, start: number): boolean {
    return this.token !== undefined && this.token.key === key && this.token.start === start;
  }

  // a token selected: its card opens beside it. an open field closes without a save,
  // since the two would write the same text
  tokenSelect(key: string, start: number) {
    if (this.tokenIsSelected(key, start)) return;
    this.token = { key, start };
  }

  tokenSelectClear(key?: string) {
    if (!this.token || (key !== undefined && this.token.key !== key)) return;
    this.token = undefined;
  }

  // ---------- the open field ----------

  fieldIsOpen(key: string): boolean {
    return this.field !== undefined && this.field.key === key;
  }

  fieldOpen(key: string, text: string, point?: { clientX: number; clientY: number }) {
    this.token = undefined;
    this.field = { key, draft: String(text ?? ''), textBase: String(text ?? ''), status: 'idle', message: '', point };
  }

  fieldDraftSet(key: string, draft: string) {
    if (!this.fieldIsOpen(key) || this.field!.draft === draft) return;
    this.field = { ...this.field!, draft };
  }

  fieldClose(key?: string) {
    if (key !== undefined && !this.fieldIsOpen(key)) return;
    this.field = undefined;
  }

  // the draft handed to the component (commit: what its onCommit answers, a
  // result { code, message } or nothing): the field closes when it took it,
  // and stays open with the reason when it refused. an unchanged text is
  // not handed over
  async fieldCommit(key: string, commit: (text: string) => any): Promise<void> {
    const field = this.field;
    if (!field || field.key !== key || field.status === 'submitting') return;
    if (field.draft === field.textBase) {
      this.fieldClose(key);
      return;
    }
    this.field = { ...field, status: 'submitting', message: '' };
    let result: any;
    try {
      result = await commit(field.draft);
    } catch (error: any) {
      result = { code: -1, message: String(error?.message ?? error) };
    }
    this.fieldResultApply(key, result);
  }

  fieldResultApply(key: string, result: any) {
    if (!this.fieldIsOpen(key)) return;
    if (result && typeof result === 'object' && typeof result.code === 'number' && result.code !== 0) {
      this.field = { ...this.field!, status: 'idle', message: String(result.message || 'the text was not saved') };
      return;
    }
    this.fieldClose(key);
  }
}
