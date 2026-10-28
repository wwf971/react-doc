// The slash mode of the default editors: its text grammar and its effects,
// pure functions shared by the store (DocSlashStore) and tests.
// Design: doc_page_impl_edit_slash.md
//
// a slash text is what the author typed from the "/" to the caret, on one
// line of the editing surface. which mode it is in follows from the text
// alone, so typing, deleting and pasting all lead to the same state:
//
//   /            action mode, query ''          every action is listed
//   /li          action mode, query 'li'        actions matching 'li'
//   /link        action mode, query 'link'
//   /link␣       param mode of 'link', param '' (a space after a known name)
//   /link␣a.md   param mode of 'link', param 'a.md'
//   /lin␣x       ended: no action is named 'lin'
//   /link␣a␣b    still param mode (one space is part of a parameter)
//   /link␣a␣␣    ended: two spaces in a row end the slash mode
// (␣ stands for a space)
//
// the slash mode starts only when a "/" is typed at the start of a line or
// after a space, so a path or a url typed in the text never starts it.

export const SLASH_MODE_ACTION = 'action';
export const SLASH_MODE_PARAM = 'param';
export const SLASH_MODE_END = 'end';

// the longest name the action mode keeps listing for; a longer word after
// "/" is text, not an action
const SLASH_QUERY_LENGTH_MAX = 40;

// the standard effects an action answers with: what happens to the slash
// text and to the slash mode. the slash mode applies them; an action never
// touches the surface itself.
//   replace(text)    the slash mode ends; the slash text ('/link a.md') is
//                    replaced by text (the link written out)
//   paramSet(text)   the slash mode stays in the param mode of the action;
//                    the parameter is rewritten (a folder chosen: 'docs/')
//   cancel()         the slash mode ends; the text stays as typed
export const SLASH_EFFECT_REPLACE = 'replace';
export const SLASH_EFFECT_PARAM_SET = 'paramSet';
export const SLASH_EFFECT_CANCEL = 'cancel';

export const slashEffect = Object.freeze({
  replace: (text) => ({ type: SLASH_EFFECT_REPLACE, text: String(text ?? '') }),
  paramSet: (text) => ({ type: SLASH_EFFECT_PARAM_SET, text: String(text ?? '') }),
  cancel: () => ({ type: SLASH_EFFECT_CANCEL }),
});

// a "/" just typed starts the slash mode when it begins a word:
// lineBefore is the text of the line up to the caret, the "/" included
export function slashTriggerIs(lineBefore) {
  const text = String(lineBefore ?? '');
  if (!text.endsWith('/')) return false;
  if (text.length === 1) return true;
  return /\s/.test(text[text.length - 2]);
}

// the line of the caret, from the text before the caret:
// { lineIndex, lineBefore } (lineIndex counts the line breaks before it)
export function slashLineRead(textBefore) {
  const text = String(textBefore ?? '');
  const indexBreak = text.lastIndexOf('\n');
  let lineIndex = 0;
  for (let index = 0; index < text.length; index += 1) if (text[index] === '\n') lineIndex += 1;
  return { lineIndex, lineBefore: text.slice(indexBreak + 1) };
}

// the slash text of a started slash mode, or undefined when the caret has
// left it (another line, or before the "/", or the "/" was deleted)
//   anchor       { lineIndex, column }: where the "/" was typed
//   lineState    { lineIndex, lineBefore } now
export function slashTextGet(anchor, lineState) {
  if (!anchor || !lineState || anchor.lineIndex !== lineState.lineIndex) return undefined;
  const text = lineState.lineBefore.slice(anchor.column);
  if (lineState.lineBefore.length <= anchor.column || text[0] !== '/') return undefined;
  return text;
}

// the mode of a slash text (see the top of this file):
//   { mode: 'action', query }
//   { mode: 'param', action, actionName, param }
//   { mode: 'end' }
// actionGet(name) answers the action of a name typed after the "/", or
// undefined; an action without a parameter has no param mode
export function slashTextParse(text, actionGet) {
  const value = String(text ?? '');
  if (!value.startsWith('/')) return { mode: SLASH_MODE_END };
  const body = value.slice(1);
  const indexSpace = body.indexOf(' ');
  if (indexSpace < 0) {
    if (body.length > SLASH_QUERY_LENGTH_MAX || /[\s/]/.test(body)) return { mode: SLASH_MODE_END };
    return { mode: SLASH_MODE_ACTION, query: body };
  }
  const actionName = body.slice(0, indexSpace);
  const action = actionName ? actionGet?.(actionName) : undefined;
  if (!action?.param) return { mode: SLASH_MODE_END };
  const param = body.slice(indexSpace + 1);
  if (param.startsWith(' ') || param.endsWith('  ')) return { mode: SLASH_MODE_END };
  return { mode: SLASH_MODE_PARAM, action, actionName, param };
}

// the actions the action mode lists for a query: names starting with it
// first, then names, aliases and labels containing it, each group in
// registry order. an empty query lists every action.
export function slashActionMatchList(actionList, query) {
  const text = String(query ?? '').toLowerCase();
  if (text === '') return [...actionList];
  const scoreGet = (action) => {
    const nameList = [action.name, ...action.aliasList].map((name) => name.toLowerCase());
    if (nameList.some((name) => name.startsWith(text))) return 0;
    if (nameList.some((name) => name.includes(text))) return 1;
    if (String(action.label ?? '').toLowerCase().includes(text)) return 2;
    return -1;
  };
  return actionList
    .map((action, index) => ({ action, index, score: scoreGet(action) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((item) => item.action);
}

// what an effect does to the surface: the text the slash text is replaced
// with (undefined: unchanged) and whether the slash mode ends
//   effect      one of slashEffect
//   actionName  the name the param mode was entered with, kept when the
//               parameter is rewritten ('/ln ' stays '/ln ')
export function slashEffectApplyGet(effect, actionName) {
  if (!effect || typeof effect !== 'object') return { textNew: undefined, isEnded: false };
  if (effect.type === SLASH_EFFECT_REPLACE) return { textNew: effect.text, isEnded: true };
  if (effect.type === SLASH_EFFECT_PARAM_SET) return { textNew: `/${actionName} ${effect.text}`, isEnded: false };
  if (effect.type === SLASH_EFFECT_CANCEL) return { textNew: undefined, isEnded: true };
  return { textNew: undefined, isEnded: false };
}
