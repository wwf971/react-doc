import { makeAutoObservable, observable } from 'mobx';
import { apiAvailabilityGet, apiParamsCheck, apiParamsFromText } from '../lib/doc-api.js';
import type { DocApiStore } from './DocApiStore.ts';

// The command palette (design: doc_page_impl_api_command_palette.md): a
// list of the apis that choose to be listed (apiDefine palette), narrowed
// by what the reader types, run with Enter or a click. An api with
// parameters is asked for them in a second step (the params step) before
// it runs. The palette is one more caller of the api registry: it adds
// nothing an api does not have.
//
//   isOpen, query, itemIndexActive   the one palette of the page
//   itemList        what is shown: every listed api that matches the query,
//                   the recently run ones first while the query is empty,
//                   each with whether it can run now (greyed out with its
//                   reason otherwise), the key bound to it, and whether it
//                   asks for parameters
//   step            'list', or 'params': the parameters of apiIdParams are
//                   asked, one field per param (paramItemList), as texts
//                   (paramTextByName); Enter runs when they read and check
//                   (paramMessage says what does not), so an api whose
//                   params are all optional runs on Enter at once
//   recentIdList    the ids run from the palette, latest first, kept in the
//                   browser (localStorage)

export type PaletteItem = {
  id: string;
  label: string;
  category: string;
  description: string;
  icon: any;
  hotkey: string;
  isAvailable: boolean;
  reason: string;
  isRecent: boolean;
  // the api has parameters: choosing it opens the params step
  isParamAsked: boolean;
  score: number;
};

export type PaletteParamItem = {
  name: string;
  type: string;
  isRequired: boolean;
  description: string;
  valueDefault: any;
  valueList: any[] | undefined;
  pathSpec: any;
  text: string;
};

const storageKeyDefault = 'doc-page-palette-recent';
const RECENT_MAX = 8;

export class DocPaletteStore {
  apiStore: DocApiStore;
  isOpen = false;
  query = '';
  itemIndexActive = 0;
  step: 'list' | 'params' = 'list';
  apiIdParams = '';
  paramTextByName: Record<string, string> = {};
  paramMessage = '';
  recentIdList: string[] = [];
  storageKey: string;

  constructor({ apiStore, storageKey = storageKeyDefault }: { apiStore: DocApiStore; storageKey?: string }) {
    this.apiStore = apiStore;
    this.storageKey = storageKey;
    this.recentIdList = recentLoad(storageKey);
    makeAutoObservable(this, {
      apiStore: false,
      storageKey: false,
      recentIdList: observable.shallow,
      paramTextByName: observable.ref,
    });
  }

  open() {
    this.isOpen = true;
    this.listReset();
  }

  close() {
    this.isOpen = false;
    this.listReset();
  }

  private listReset() {
    this.query = '';
    this.itemIndexActive = 0;
    this.step = 'list';
    this.apiIdParams = '';
    this.paramTextByName = {};
    this.paramMessage = '';
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  querySet(text: string) {
    this.query = String(text ?? '');
    this.itemIndexActive = 0;
  }

  // the listed apis matching the query: every word typed must appear in
  // the category, the label, the id or the keywords (case-insensitive).
  // the recently run ones first while nothing is typed; then the ones
  // whose label starts with the query; then by category and label
  get itemList(): PaletteItem[] {
    const context = this.apiStore.contextBuild({ kind: 'palette' });
    const labelByApi = this.apiStore.stores.hotkeyStore?.labelByApi;
    const wordList = this.query.trim().toLowerCase().split(/\s+/).filter((word) => word !== '');
    const itemList: PaletteItem[] = [];
    for (const definition of this.apiStore.apiList) {
      if (!definition.palette?.isListed) continue;
      const haystack = `${definition.category} ${definition.label} ${definition.id} ${definition.palette.keywordList.join(' ')} ${definition.description}`.toLowerCase();
      if (!wordList.every((word) => haystack.includes(word))) continue;
      const availability = apiAvailabilityGet(definition, context);
      const labelLower = String(definition.label).toLowerCase();
      const score = wordList.length === 0 ? 0 : (labelLower.startsWith(wordList[0]) ? 2 : labelLower.includes(wordList[0]) ? 1 : 0);
      itemList.push({
        id: definition.id,
        label: definition.label,
        category: definition.category,
        description: definition.description,
        icon: definition.icon,
        hotkey: labelByApi?.get(definition.id) ?? '',
        isAvailable: availability.isAvailable,
        reason: availability.reason,
        isRecent: this.recentIdList.includes(definition.id),
        isParamAsked: definition.paramList.length > 0,
        score,
      });
    }
    const recentIndex = (id: string) => {
      const index = this.recentIdList.indexOf(id);
      return index === -1 ? RECENT_MAX : index;
    };
    itemList.sort((a, b) => {
      if (wordList.length === 0 && a.isRecent !== b.isRecent) return a.isRecent ? -1 : 1;
      if (wordList.length === 0 && a.isRecent && b.isRecent) return recentIndex(a.id) - recentIndex(b.id);
      if (a.score !== b.score) return b.score - a.score;
      const byCategory = a.category.localeCompare(b.category);
      if (byCategory !== 0) return byCategory;
      return a.label.localeCompare(b.label);
    });
    return itemList;
  }

  get itemActive(): PaletteItem | undefined {
    return this.itemList[this.itemIndexActive];
  }

  itemActiveMove(delta: number) {
    const count = this.itemList.length;
    if (count === 0) return;
    this.itemIndexActive = (this.itemIndexActive + delta + count) % count;
  }

  itemActiveSet(index: number) {
    if (index < 0 || index >= this.itemList.length) return;
    this.itemIndexActive = index;
  }

  // Enter, or a click on an item: an api with parameters goes to the params
  // step; otherwise the palette closes and the api runs, a failure shown as
  // the notice of the api layer. an item that cannot run now stays, with
  // its reason shown
  async choose(index?: number): Promise<void> {
    const item = this.itemList[index ?? this.itemIndexActive];
    if (!item) return;
    if (!item.isAvailable) {
      this.apiStore.noticeSet(`${item.label}: ${item.reason}`, true);
      return;
    }
    if (item.isParamAsked) {
      this.paramsOpen(item.id);
      return;
    }
    await this.run(item.id, {});
  }

  // ---------- the params step ----------

  get definitionParams(): any {
    return this.step === 'params' ? this.apiStore.apiGet(this.apiIdParams) : undefined;
  }

  // the params of the api asked, each with the text typed for it
  get paramItemList(): PaletteParamItem[] {
    const definition = this.definitionParams;
    if (!definition) return [];
    return definition.paramList.map((param: any) => ({
      name: param.name,
      type: param.type,
      isRequired: param.isRequired,
      description: param.description,
      valueDefault: param.valueDefault,
      valueList: param.valueList,
      pathSpec: param.pathSpec,
      text: this.paramTextByName[param.name] ?? '',
    }));
  }

  get isParamRequiredAny(): boolean {
    return this.paramItemList.some((param) => param.isRequired);
  }

  paramsOpen(id: string) {
    this.step = 'params';
    this.apiIdParams = id;
    this.paramTextByName = {};
    this.paramMessage = '';
  }

  paramTextSet(name: string, text: string) {
    this.paramTextByName = { ...this.paramTextByName, [name]: String(text ?? '') };
    this.paramMessage = '';
  }

  // Escape in the params step: back to the list, the query kept
  paramsBack() {
    this.step = 'list';
    this.apiIdParams = '';
    this.paramTextByName = {};
    this.paramMessage = '';
  }

  // Enter in the params step: the texts read by type and checked as any
  // call's params; what does not read or check is said in paramMessage and
  // the step stays. with every param optional and nothing typed, this is
  // the api run with its defaults at once
  async paramsRun(): Promise<void> {
    const definition = this.definitionParams;
    if (!definition) return;
    const read = apiParamsFromText(definition, this.paramTextByName);
    if (read.message) {
      this.paramMessage = read.message;
      return;
    }
    const checked = apiParamsCheck(definition, read.params);
    if (checked.message) {
      this.paramMessage = checked.message;
      return;
    }
    await this.run(definition.id, read.params);
  }

  private async run(id: string, params: Record<string, any>): Promise<void> {
    this.recentAdd(id);
    this.close();
    const result = await this.apiStore.call(id, params, { principal: { kind: 'palette' } });
    this.apiStore.resultNotice(result);
  }

  private recentAdd(id: string) {
    this.recentIdList = [id, ...this.recentIdList.filter((item) => item !== id)].slice(0, RECENT_MAX);
    try {
      window.localStorage?.setItem(this.storageKey, JSON.stringify(this.recentIdList));
    } catch {
      // storage refused: the list holds for this page only
    }
  }
}

function recentLoad(storageKey: string): string[] {
  try {
    const value = JSON.parse(window.localStorage?.getItem(storageKey) ?? '[]');
    return Array.isArray(value) ? value.map(String).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
