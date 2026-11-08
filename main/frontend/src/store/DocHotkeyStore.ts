import { makeAutoObservable, observable } from 'mobx';
import {
  hotkeyLabelByApiBuild,
  hotkeyPlatformIsMac,
  hotkeyResolve,
  hotkeyStrokeFromEvent,
  hotkeyStrokeHasModifier,
  hotkeyStrokeText,
  hotkeyTableBuild,
  hotkeyTableEffectiveGet,
} from '../lib/doc-hotkey.js';
import type { DocApiStore } from './DocApiStore.ts';

// The keyboard maps of the page and the keys they bind to apis (design:
// doc_page_impl_api_hotkey.md). A map is a list of bindings; the maps are
// stacked, lowest first (every map but the host's read by the plugin,
// includes expanded, configDoc.hotkey):
//
//   the package's default map (config.yaml hotkey.file: the default keys of
//     the built-in apis, the package config layer of the keys)
//   the active map of every loaded doc page, the included doc pages below
//     the one that includes them (.doc-page/hotkey/ of each doc page)
//   the workspace's map (the workspace's hotkey.file): the deployment
//     decides over the doc pages it deploys
//   the host's maps (DocPageMdx config.hotkeyMapList)
//
// a doc page may keep several maps in its folder; the one it activates is
// main.yaml by convention (or the one its entry names), and the reader may
// choose another of them for this browser (mapIdActiveSet, kept in
// localStorage). the table is rebuilt from the stack when anything
// changes, and a key is resolved when it is pressed: the topmost binding
// whose "when" holds and whose api is registered now runs (lib/doc-hotkey.js).

export type HotkeyMap = { id: string; source?: string; description?: string; bindingList: any[] };
export type HotkeyDocPageMaps = { alias: string; mapList: (HotkeyMap & { file: string; includeList?: string[] })[]; mapIdActive: string };

const storageKeyDefault = 'doc-page-hotkey-map';
const CHORD_WAIT_MS = 2000;

// the names a binding's "when" may use
export const hotkeyContextKeyList = [
  'editMode', 'viewMode', 'editAvailable', 'sessionOpen', 'blockSelectMode',
  'paletteOpen', 'settingsOpen', 'blockPopupOpen', 'devServer',
  'findScopeActive', 'findOpen',
];

export class DocHotkeyStore {
  apiStore: DocApiStore;
  mapListHost: HotkeyMap[] = [];
  // the reader's choice of a doc page's map, by doc page alias
  mapIdActiveByAlias: Record<string, string> = {};
  chordPending: { strokeText: string; time: number } | undefined = undefined;
  chordTimer: ReturnType<typeof setTimeout> | undefined;
  isMac: boolean;
  storageKey: string;

  constructor({ apiStore, mapListHost = [], storageKey = storageKeyDefault, isMac }: {
    apiStore: DocApiStore; mapListHost?: HotkeyMap[]; storageKey?: string; isMac?: boolean;
  }) {
    this.apiStore = apiStore;
    this.mapListHost = mapListHost;
    this.storageKey = storageKey;
    this.isMac = isMac ?? hotkeyPlatformIsMac();
    this.mapIdActiveByAlias = choiceLoad(storageKey);
    makeAutoObservable(this, {
      apiStore: false,
      mapListHost: observable.ref,
      chordPending: observable.ref,
      chordTimer: false,
      isMac: false,
      storageKey: false,
    });
  }

  dispose() {
    if (this.chordTimer) clearTimeout(this.chordTimer);
  }

  replaceMapListHost(mapList: HotkeyMap[]) {
    this.mapListHost = mapList ?? [];
  }

  // ---------- the maps ----------

  private get hotkeyLoaded(): any {
    return this.apiStore.stores.sourceStore?.configDoc?.hotkey;
  }

  // the package's default map (config.yaml hotkey.file), when the package names one
  get mapPackage(): (HotkeyMap & { file: string }) | undefined {
    const map = this.hotkeyLoaded?.mapPackage;
    return map && typeof map === 'object' ? map : undefined;
  }

  // the workspace's map (workspace hotkey.file), when the workspace names one
  get mapWorkspace(): (HotkeyMap & { file: string }) | undefined {
    const map = this.hotkeyLoaded?.mapWorkspace;
    return map && typeof map === 'object' ? map : undefined;
  }

  // the maps of every doc page as the plugin read them, with the map each
  // activates by default (configDoc.hotkey.docPageList)
  get docPageMapsList(): HotkeyDocPageMaps[] {
    const hotkey = this.hotkeyLoaded;
    return Array.isArray(hotkey?.docPageList) ? hotkey.docPageList : [];
  }

  get problemListLoaded(): { alias: string; file: string; message: string }[] {
    const hotkey = this.hotkeyLoaded;
    return Array.isArray(hotkey?.problemList) ? hotkey.problemList : [];
  }

  // the map a doc page activates now: the reader's choice when it names
  // one of the doc page's maps, else the default of the entry
  mapActiveGet(docPageMaps: HotkeyDocPageMaps): (HotkeyMap & { file: string }) | undefined {
    const mapIdChosen = this.mapIdActiveByAlias[docPageMaps.alias];
    const mapChosen = mapIdChosen ? docPageMaps.mapList.find((map) => map.id === mapIdChosen) : undefined;
    return mapChosen ?? docPageMaps.mapList.find((map) => map.id === docPageMaps.mapIdActive);
  }

  mapIdActiveSet(alias: string, mapId: string) {
    const next = { ...this.mapIdActiveByAlias };
    if (mapId === '') delete next[alias];
    else next[alias] = mapId;
    this.mapIdActiveByAlias = next;
    try {
      window.localStorage?.setItem(this.storageKey, JSON.stringify(next));
    } catch {
      // storage refused: the choice holds for this page only
    }
  }

  // the stack, lowest first: package, doc pages, workspace, host
  get mapListStack(): HotkeyMap[] {
    const mapList: HotkeyMap[] = [];
    const mapPackage = this.mapPackage;
    if (mapPackage) mapList.push({ ...mapPackage, id: 'package', source: mapPackage.file });
    for (const docPageMaps of this.docPageMapsList) {
      const map = this.mapActiveGet(docPageMaps);
      if (map) mapList.push({ ...map, id: `${docPageMaps.alias}:${map.id}`, source: map.file });
    }
    const mapWorkspace = this.mapWorkspace;
    if (mapWorkspace) mapList.push({ ...mapWorkspace, id: 'workspace', source: mapWorkspace.file });
    for (const map of this.mapListHost) mapList.push({ ...map, source: map.source ?? 'host' });
    return mapList;
  }

  get table() {
    return hotkeyTableBuild(this.mapListStack, { isMac: this.isMac });
  }

  // the state of the page a binding's "when" reads
  get contextKeyByName(): Record<string, boolean> {
    const { editStore, paletteStore, configStore, blockPopupStore, envStore, findStore } = this.apiStore.stores;
    const isEditMode = editStore?.isEditMode === true;
    return {
      editMode: isEditMode,
      viewMode: !isEditMode,
      editAvailable: editStore?.isAvailable === true,
      sessionOpen: editStore?.isSessionOpen === true,
      blockSelectMode: editStore?.isBlockSelectMode === true,
      paletteOpen: paletteStore?.isOpen === true,
      settingsOpen: configStore?.isSettingsOpen === true,
      blockPopupOpen: blockPopupStore?.isOpen === true,
      devServer: envStore?.isDevServer === true,
      // a part of the page that finds in what it draws is under the pointer or has the focus
      findScopeActive: findStore?.isScopeActive === true,
      findOpen: findStore?.isOpen === true,
    };
  }

  private get resolveOptions() {
    return { apiExists: (id: string) => this.apiStore.apiExists(id), contextKeyByName: this.contextKeyByName, isMac: this.isMac };
  }

  // every key with the binding that answers it now and the ones passed over
  get rowListEffective() {
    return hotkeyTableEffectiveGet(this.table, this.resolveOptions);
  }

  // the key shown beside an api
  get labelByApi(): Map<string, string> {
    return hotkeyLabelByApiBuild(this.table, this.resolveOptions);
  }

  labelGet(apiId: string): string {
    return this.labelByApi.get(apiId) ?? '';
  }

  // ---------- keys ----------

  // a keydown of the window. answers whether the key was taken. a key
  // without ctrl, alt or meta is left to the text while something editable
  // has the focus or a block is being edited; a key another handler took
  // (defaultPrevented) is left alone
  keyDownHandle(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || (event as any).isComposing) return false;
    const stroke = hotkeyStrokeFromEvent(event);
    if (!stroke) return false;
    const strokeText = hotkeyStrokeText(stroke);
    const chordPending = this.chordPending;
    const isEditing = targetIsEditable(event.target) || this.apiStore.stores.editStore?.isSessionOpen === true;
    if (!chordPending && !hotkeyStrokeHasModifier(stroke) && isEditing) return false;
    const keyText = chordPending ? `${chordPending.strokeText} ${strokeText}` : strokeText;
    const resolved = hotkeyResolve(this.table, keyText, this.resolveOptions);
    if (!resolved) {
      if (!chordPending && this.table.isChordPrefix(strokeText)) {
        this.chordStart(strokeText);
        event.preventDefault();
        return true;
      }
      if (chordPending) {
        this.chordClear();
        event.preventDefault();
        this.apiStore.noticeSet(`${keyText} is not bound`, false);
        return true;
      }
      return false;
    }
    this.chordClear();
    event.preventDefault();
    event.stopPropagation();
    void this.apiStore.call(resolved.binding.api, resolved.binding.params, { principal: { kind: 'hotkey', id: keyText } })
      .then((result) => this.apiStore.resultNotice(result));
    return true;
  }

  private chordStart(strokeText: string) {
    this.chordPending = { strokeText, time: Date.now() };
    if (this.chordTimer) clearTimeout(this.chordTimer);
    this.chordTimer = setTimeout(() => this.chordClear(), CHORD_WAIT_MS);
  }

  chordClear() {
    this.chordPending = undefined;
    if (this.chordTimer) clearTimeout(this.chordTimer);
    this.chordTimer = undefined;
  }
}

function targetIsEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select')) return true;
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

function choiceLoad(storageKey: string): Record<string, string> {
  try {
    const value = JSON.parse(window.localStorage?.getItem(storageKey) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
