import { makeAutoObservable, observable } from 'mobx';
import {
  SLASH_MODE_ACTION,
  SLASH_MODE_END,
  SLASH_MODE_PARAM,
  slashActionMatchList,
  slashEffectApplyGet,
  slashTextGet,
  slashTextParse,
} from '../lib/doc-slash.js';
import { slashActionByNameBuild } from '../../../comp-doc/slash/slash-define.js';

// The slash mode of the default editors (design: doc_page_impl_edit_slash.md).
// The author types "/" in the surface of a paragraph or a list and a menu
// of actions opens under it; typing narrows the menu, a chosen action
// takes a parameter the same way (/link guide), and choosing an item does
// what the action answers. This store is the one central part: it holds
// the registry of actions, the one slash mode open on the page, and turns
// what the surface reports into a state; the surface binding
// (comp-doc/slash/use-edit-slash.js) reads the caret and writes the text,
// the menu (EditSlashMenu) renders the state, and the actions decide what
// their parameter lists and what choosing an item does.
//
//   idle ──"/" typed at a word start──► action mode ──Enter / Tab / click on
//    ▲                                    │  an action with a param, or
//    │                                    │  "/name" + space
//    │                                    ▼
//    │                                  param mode (delegated to the action)
//    │                                    │  item chosen -> effect:
//    │                                    │    paramSet  stays, parameter rewritten
//    └── replace / cancel / Esc / two spaces / caret leaves / blur
//
// slashActionById  the registry of the page (DocPageMdx builds it,
//                  slash-define.js slashActionByIdBuild)
// isOn             the author's switch, in the bar of the editors that offer
//                  the slash mode; off, the surfaces are plain text. kept in
//                  the browser (localStorage)
// slash            the open slash mode, or undefined:
//                  { surfaceId    the surface it belongs to
//                    anchor       { lineIndex, column } of the "/"
//                    text         the slash text: from the "/" to the caret
//                    context      what the actions are given (slash-define.js)
//                    rectAnchor   { left, top, bottom }: where the menu goes
//                                 (viewport coordinates)
//                    itemIndexActive  the highlighted item of the menu }

export type SlashAnchor = { lineIndex: number; column: number };
export type SlashLineState = { lineIndex: number; lineBefore: string };
export type SlashRect = { left: number; top: number; bottom: number };
export type SlashState = {
  surfaceId: string;
  anchor: SlashAnchor;
  text: string;
  context: any;
  rectAnchor: SlashRect | undefined;
  itemIndexActive: number;
};
// what the surface does after a choice: replace the slash text (its
// lengthOld characters before the caret) by textNew when given; the slash
// mode has ended when isEnded
export type SlashApply = { textNew: string | undefined; isEnded: boolean; lengthOld: number };

const storageKeyDefault = 'doc-page-edit-slash';

export class DocSlashStore {
  slashActionById: Record<string, any> = {};
  isOn = true;
  slash: SlashState | undefined = undefined;
  storageKey: string;

  constructor({ slashActionById = {}, storageKey = storageKeyDefault }: { slashActionById?: Record<string, any>; storageKey?: string } = {}) {
    this.slashActionById = slashActionById;
    this.storageKey = storageKey;
    this.isOn = isOnLoad(storageKey);
    makeAutoObservable(this, {
      slashActionById: observable.ref,
      slash: observable.ref,
      storageKey: false,
    });
  }

  // ---------- the registry ----------

  // an open slash mode stays: its text is parsed with the new actions on
  // the next keystroke, and ends then when its action is gone
  replaceSlashActionById(slashActionById: Record<string, any>) {
    this.slashActionById = slashActionById ?? {};
  }

  get actionByName(): Map<string, any> {
    return slashActionByNameBuild(this.slashActionById);
  }

  get actionList(): any[] {
    return [...new Set(this.actionByName.values())];
  }

  actionGet(name: string) {
    return this.actionByName.get(String(name ?? '').toLowerCase());
  }

  // ---------- the switch ----------

  isOnSet(isOn: boolean) {
    this.isOn = isOn === true;
    if (!this.isOn) this.slashEnd();
    try {
      window.localStorage?.setItem(this.storageKey, this.isOn ? 'on' : 'off');
    } catch {
      // storage refused (private mode): the switch holds for this page only
    }
  }

  // ---------- the state ----------

  slashIsOpenFor(surfaceId: string): boolean {
    return this.slash !== undefined && this.slash.surfaceId === surfaceId;
  }

  // { mode: 'action', query } | { mode: 'param', action, actionName, param }
  get parsed(): any {
    if (!this.slash) return { mode: SLASH_MODE_END };
    return slashTextParse(this.slash.text, (name: string) => this.actionGet(name));
  }

  // what the menu lists: actions in the action mode ({ id, action }), the
  // items of the action in its param mode. an action whose itemListGet
  // throws lists nothing rather than breaking the editor
  get itemList(): any[] {
    const parsed = this.parsed;
    if (parsed.mode === SLASH_MODE_ACTION) {
      return slashActionMatchList(this.actionList, parsed.query).map((action) => ({ id: action.name, action }));
    }
    if (parsed.mode === SLASH_MODE_PARAM && this.slash) {
      try {
        const itemList = parsed.action.param.itemListGet(parsed.param, this.slash.context);
        return Array.isArray(itemList) ? itemList : [];
      } catch (error) {
        console.warn(`[doc-slash] /${parsed.action.name}: itemListGet failed`, error);
        return [];
      }
    }
    return [];
  }

  get itemActive(): any {
    if (!this.slash) return undefined;
    return this.itemList[this.slash.itemIndexActive];
  }

  // a "/" was typed at the start of a word of a surface
  slashStart(surfaceId: string, { anchor, context, rect }: { anchor: SlashAnchor; context: any; rect?: SlashRect }) {
    if (!this.isOn) return;
    this.slash = { surfaceId, anchor, text: '/', context, rectAnchor: rect, itemIndexActive: 0 };
  }

  // the surface changed (typing) or its caret moved: the slash text is read
  // again; the slash mode ends when the caret has left it or the text is no
  // slash text any more. answers whether it is still open
  slashUpdate(surfaceId: string, lineState: SlashLineState, rect?: SlashRect): boolean {
    const slash = this.slash;
    if (!slash || slash.surfaceId !== surfaceId) return false;
    const text = slashTextGet(slash.anchor, lineState);
    if (text === undefined || slashTextParse(text, (name: string) => this.actionGet(name)).mode === SLASH_MODE_END) {
      this.slashEnd();
      return false;
    }
    const rectAnchor = rect && slash.rectAnchor
      ? { left: slash.rectAnchor.left, top: rect.top, bottom: rect.bottom }
      : rect ?? slash.rectAnchor;
    if (text === slash.text && rectAnchorIsSame(rectAnchor, slash.rectAnchor)) return true;
    this.slash = { ...slash, text, rectAnchor, itemIndexActive: text === slash.text ? slash.itemIndexActive : 0 };
    return true;
  }

  slashEnd() {
    this.slash = undefined;
  }

  itemActiveMove(delta: number) {
    const slash = this.slash;
    const count = this.itemList.length;
    if (!slash || count === 0) return;
    this.slash = { ...slash, itemIndexActive: (slash.itemIndexActive + delta + count) % count };
  }

  itemActiveSet(index: number) {
    const slash = this.slash;
    if (!slash || index === slash.itemIndexActive || index < 0 || index >= this.itemList.length) return;
    this.slash = { ...slash, itemIndexActive: index };
  }

  // an item chosen (Enter, Tab, a click): in the action mode, an action with
  // a parameter becomes "/name " (its param mode) and one without runs; in
  // the param mode the action answers. the answer is what the surface does
  itemChoose(index?: number): SlashApply | undefined {
    const slash = this.slash;
    if (!slash) return undefined;
    const item = this.itemList[index ?? slash.itemIndexActive];
    if (!item) return undefined;
    const parsed = this.parsed;
    if (parsed.mode === SLASH_MODE_ACTION) {
      const action = item.action;
      if (action.param) return { textNew: `/${action.name} `, isEnded: false, lengthOld: slash.text.length };
      return this.effectApply(this.effectRun(action, () => action.run(slash.context)), action.name);
    }
    if (parsed.mode !== SLASH_MODE_PARAM) return undefined;
    return this.effectApply(
      this.effectRun(parsed.action, () => parsed.action.param.itemChoose(item, parsed.param, slash.context)),
      parsed.actionName,
    );
  }

  // a key, offered to the action of the param mode before the slash mode's
  // own keys; undefined when the action does not take it
  keyOffer(event: any): SlashApply | undefined {
    const slash = this.slash;
    const parsed = this.parsed;
    if (!slash || parsed.mode !== SLASH_MODE_PARAM || !parsed.action.param.keyHandle) return undefined;
    const effect = this.effectRun(parsed.action, () => parsed.action.param.keyHandle(event, {
      param: parsed.param,
      item: this.itemActive,
      context: slash.context,
    }));
    return effect ? this.effectApply(effect, parsed.actionName) : undefined;
  }

  effectRun(action: any, run: () => any) {
    try {
      return run();
    } catch (error) {
      console.warn(`[doc-slash] /${action.name} failed`, error);
      return undefined;
    }
  }

  effectApply(effect: any, actionName: string): SlashApply | undefined {
    const slash = this.slash;
    if (!slash || !effect) return undefined;
    const apply = slashEffectApplyGet(effect, actionName);
    if (apply.isEnded) this.slashEnd();
    return { ...apply, lengthOld: slash.text.length };
  }
}

function rectAnchorIsSame(a?: SlashRect, b?: SlashRect) {
  if (!a || !b) return a === b;
  return a.left === b.left && a.top === b.top && a.bottom === b.bottom;
}

function isOnLoad(storageKey: string): boolean {
  try {
    return window.localStorage?.getItem(storageKey) !== 'off';
  } catch {
    return true;
  }
}

export { SLASH_MODE_ACTION, SLASH_MODE_PARAM };
