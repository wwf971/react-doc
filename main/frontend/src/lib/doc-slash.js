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
// the slash mode starts when a "/" is typed where no word goes on after it:
// at the end of its line, or before a space, whatever stands before it
// ("aaa/" starts it as "see /" does). a "/" typed into a word ("and|or")
// never starts it (slashTriggerIs). a path or a url typed at the end of a
// line starts it for a moment: "//", or a name no action has, lists nothing
// and shows no menu.
//
// a surface may also name direct triggers: a text that, typed, enters the
// param mode of one action at once, without "/" and a name. the trigger
// text then stands where "/name " stands:
//
//   {{           param mode of the trigger's action, param ''
//   {{name/jp    param 'name/jp'
//   {{name}      ended: a trigger says which characters end it (endList)

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
export const SLASH_EFFECT_BLOCK = 'block';
export const SLASH_EFFECT_ATOM = 'atom';

export const slashEffect = Object.freeze({
  replace: (text) => ({ type: SLASH_EFFECT_REPLACE, text: String(text ?? '') }),
  paramSet: (text) => ({ type: SLASH_EFFECT_PARAM_SET, text: String(text ?? '') }),
  cancel: () => ({ type: SLASH_EFFECT_CANCEL }),
  // a block at the caret (its source: lines of a block of the document, an
  // MDX block): the slash text goes, and the editor puts the block where the
  // caret is. an editor that cannot take a block gets its source as lines
  block: (source) => ({ type: SLASH_EFFECT_BLOCK, source: String(source ?? '') }),
  // an atom of a kind at the caret (lib/doc-edit-atom-kind.js: a formula of the
  // component math), empty, its field open for its value: in the line, or on
  // lines of its own (isRow). an editor that types no atoms types textFallback
  atom: (atomKind, { isRow = false, textFallback = '' } = {}) => ({
    type: SLASH_EFFECT_ATOM, atomKind: String(atomKind ?? ''), isRow: isRow === true, textFallback: String(textFallback ?? ''),
  }),
});

// a "/" just typed starts the slash mode when no word goes on after it:
//   lineBefore   the text of the line up to the caret, the "/" included
//   charAfter    the character after the caret: '' at the end of the line
//                (or of the text), a space, or a chip of the surface (a
//                character of the private use area: an atom, not a letter)
// what stands before the "/" does not matter
export function slashTriggerIs(lineBefore, charAfter = '') {
  const text = String(lineBefore ?? '');
  if (!text.endsWith('/')) return false;
  const after = String(charAfter ?? '');
  return after === '' || /^[\s\uE000-\uF8FF]/.test(after);
}

// the direct trigger just typed, when the line up to the caret ends with
// the text of one (the longest wins: "{{@" before "{{"), or undefined
//   triggerList   [{ text, action, endList? }]
export function slashTriggerMatch(lineBefore, triggerList) {
  const text = String(lineBefore ?? '');
  return slashTriggerListSort(triggerList).find((trigger) => text.endsWith(trigger.text));
}

// the triggers that can be matched, the longest text first
function slashTriggerListSort(triggerList) {
  return (Array.isArray(triggerList) ? triggerList : [])
    .filter((trigger) => trigger && typeof trigger.text === 'string' && trigger.text !== '' && trigger.action?.param)
    .sort((a, b) => b.text.length - a.text.length);
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
//   anchor       { lineIndex, column }: where the "/" (or the first
//                character of a direct trigger) was typed
//   lineState    { lineIndex, lineBefore } now
//   triggerList  the direct triggers of the surface: the text may start
//                with one of them instead of "/"
export function slashTextGet(anchor, lineState, triggerList) {
  if (!anchor || !lineState || anchor.lineIndex !== lineState.lineIndex) return undefined;
  const text = lineState.lineBefore.slice(anchor.column);
  if (lineState.lineBefore.length <= anchor.column) return undefined;
  if (text[0] === '/') return text;
  return slashTriggerListSort(triggerList).some((trigger) => text.startsWith(trigger.text)) ? text : undefined;
}

// the mode of a slash text (see the top of this file):
//   { mode: 'action', query }
//   { mode: 'param', action, actionName, param, trigger? }
//   { mode: 'end' }
// actionGet(name) answers the action of a name typed after the "/", or
// undefined; an action without a parameter has no param mode. a text
// starting with a direct trigger (triggerList) is the param mode of the
// trigger's action: what follows the trigger text is the parameter, ended
// by two spaces in a row, a line break, or a character of its endList
export function slashTextParse(text, actionGet, triggerList) {
  const value = String(text ?? '');
  if (!value.startsWith('/')) {
    const trigger = slashTriggerListSort(triggerList).find((one) => value.startsWith(one.text));
    if (!trigger) return { mode: SLASH_MODE_END };
    const param = value.slice(trigger.text.length);
    const endList = Array.isArray(trigger.endList) ? trigger.endList : [];
    if (param.includes('  ') || param.includes('\n') || endList.some((end) => param.includes(end))) return { mode: SLASH_MODE_END };
    return { mode: SLASH_MODE_PARAM, action: trigger.action, actionName: trigger.action.name, param, trigger };
  }
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

// the views of a block as the items of an optional parameter
// (slashBlockActionDefine): the default first, marked isDefault, then the
// others in their order; a parameter typed narrows them to the views whose id
// or label starts with it, then those holding it
//   viewList   [{ id, label?, description? }]
export function slashViewItemListGet(viewList, viewDefault, param) {
  const query = String(param ?? '').trim().toLowerCase();
  const itemList = (Array.isArray(viewList) ? viewList : []).map((view) => ({
    id: view.id,
    label: view.label ?? view.id,
    detail: view.description ?? '',
    isDefault: view.id === viewDefault,
  }));
  const ordered = [...itemList.filter((item) => item.isDefault), ...itemList.filter((item) => !item.isDefault)];
  if (query === '') return ordered;
  const scoreGet = (item) => {
    const nameList = [item.id, item.label].map((name) => String(name).toLowerCase());
    if (nameList.some((name) => name.startsWith(query))) return 0;
    if (nameList.some((name) => name.includes(query))) return 1;
    return -1;
  };
  return ordered
    .map((item, index) => ({ item, index, score: scoreGet(item) }))
    .filter((one) => one.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((one) => one.item);
}

// a block put at the caret of a paragraph (slashEffect.block): the paragraph
// becomes the text before the caret, the block and the text after it, with
// blank lines between them, so the block is one of its own and the two texts
// stay two paragraphs (or one, or none, where the caret was at an edge).
// spaces at the break are dropped. answers the new text of the paragraph
export function slashBlockTextInsert(text, offset, source) {
  const before = text.slice(0, offset).replace(/[ \t]+$/, '');
  const after = text.slice(offset).replace(/^[ \t]+/, '');
  const prefix = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return `${before}${prefix}${source}${suffix}${after}`;
}

// what an effect does to the surface: the text the slash text is replaced
// with (undefined: unchanged) and whether the slash mode ends
//   effect      one of slashEffect
//   actionName  the name the param mode was entered with, kept when the
//               parameter is rewritten ('/ln ' stays '/ln ')
//   trigger     the direct trigger the param mode was entered with, when it
//               was: its text is kept instead ('{{' stays '{{')
export function slashEffectApplyGet(effect, actionName, trigger) {
  if (!effect || typeof effect !== 'object') return { textNew: undefined, isEnded: false };
  if (effect.type === SLASH_EFFECT_REPLACE) return { textNew: effect.text, isEnded: true };
  if (effect.type === SLASH_EFFECT_PARAM_SET) {
    return { textNew: trigger ? `${trigger.text}${effect.text}` : `/${actionName} ${effect.text}`, isEnded: false };
  }
  if (effect.type === SLASH_EFFECT_CANCEL) return { textNew: undefined, isEnded: true };
  if (effect.type === SLASH_EFFECT_BLOCK) return { textNew: '', isEnded: true, blockSource: effect.source };
  if (effect.type === SLASH_EFFECT_ATOM) return { textNew: '', isEnded: true, atom: { atomKind: effect.atomKind, isRow: effect.isRow, textFallback: effect.textFallback } };
  return { textNew: undefined, isEnded: false };
}
