import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SLASH_MODE_ACTION,
  SLASH_MODE_END,
  SLASH_MODE_PARAM,
  slashActionMatchList,
  slashBlockTextInsert,
  slashEffect,
  slashEffectApplyGet,
  slashLineRead,
  slashTextGet,
  slashTextParse,
  slashTriggerIs,
  slashTriggerMatch,
  slashViewItemListGet,
} from './doc-slash.js';
import { slashActionByIdBuild, slashActionByNameBuild, slashActionDefine, slashBlockActionDefine } from '../../../comp-doc/slash/slash-define.js';
import { codeBlockSourceBuild, codeSlashAction } from '../../../../built-in/comp-mdx/text/code-slash.js';
import { mdxSlashAction } from '../../../../built-in/comp-mdx/text/mdx-slash.js';
import { mathSlashAction } from '../../../../built-in/comp-mdx/math/math-slash.js';
import { DocSlashStore } from '../store/DocSlashStore.js';

const actionLink = slashActionDefine({
  name: 'link',
  aliasList: ['ln'],
  label: 'Link',
  param: {
    itemListGet: (param) => ['a.md', 'b.md', 'docs'].filter((name) => name.includes(param)).map((name) => ({ id: name, label: name, kind: name === 'docs' ? 'dir' : 'file' })),
    itemChoose: (item) => (item.kind === 'dir' ? slashEffect.paramSet(`${item.label}/`) : slashEffect.replace(`[${item.label}](./${item.label})`)),
  },
});
const actionDate = slashActionDefine({ name: 'date', label: 'Date', run: () => slashEffect.replace('2026-10-31') });
const actionByName = slashActionByNameBuild({ 'nav/link': actionLink, 'misc/date': actionDate });
const actionGet = (name) => actionByName.get(name.toLowerCase());

test('a "/" starts the slash mode where no word goes on after it, whatever stands before it', () => {
  assert.equal(slashTriggerIs('/'), true);
  assert.equal(slashTriggerIs('see /'), true);
  assert.equal(slashTriggerIs('aaa/'), true);
  assert.equal(slashTriggerIs('月/'), true);
  assert.equal(slashTriggerIs('{{birth/month}}/'), true);
  // before a space, a line break or a chip (an atom: a character of the private use area)
  assert.equal(slashTriggerIs('aaa/', ' '), true);
  assert.equal(slashTriggerIs('aaa/', '\n'), true);
  assert.equal(slashTriggerIs('aaa/', '\uE000'), true);
  // typed into a word
  assert.equal(slashTriggerIs('and/', 'o'), false);
  assert.equal(slashTriggerIs('月/', '日'), false);
  assert.equal(slashTriggerIs('see'), false);
});

test('the line of the caret', () => {
  assert.deepEqual(slashLineRead('a\nb /li'), { lineIndex: 1, lineBefore: 'b /li' });
  assert.deepEqual(slashLineRead('/'), { lineIndex: 0, lineBefore: '/' });
});

test('the slash text follows the caret and ends when the caret leaves it', () => {
  const anchor = { lineIndex: 1, column: 2 };
  assert.equal(slashTextGet(anchor, { lineIndex: 1, lineBefore: 'b /link a' }), '/link a');
  assert.equal(slashTextGet(anchor, { lineIndex: 1, lineBefore: 'b ' }), undefined);
  assert.equal(slashTextGet(anchor, { lineIndex: 2, lineBefore: 'b /link' }), undefined);
  assert.equal(slashTextGet(anchor, { lineIndex: 1, lineBefore: 'b xlink' }), undefined);
});

test('the mode follows from the slash text', () => {
  assert.deepEqual(slashTextParse('/', actionGet), { mode: SLASH_MODE_ACTION, query: '' });
  assert.deepEqual(slashTextParse('/li', actionGet), { mode: SLASH_MODE_ACTION, query: 'li' });
  const param = slashTextParse('/link a b', actionGet);
  assert.equal(param.mode, SLASH_MODE_PARAM);
  assert.equal(param.action, actionLink);
  assert.equal(param.param, 'a b');
  assert.equal(slashTextParse('/LN x', actionGet).actionName, 'LN');
  assert.equal(slashTextParse('/link ', actionGet).param, '');
  // not an action, an action without a parameter, two spaces, a path
  assert.equal(slashTextParse('/lin x', actionGet).mode, SLASH_MODE_END);
  assert.equal(slashTextParse('/date ', actionGet).mode, SLASH_MODE_END);
  assert.equal(slashTextParse('/link a  ', actionGet).mode, SLASH_MODE_END);
  assert.equal(slashTextParse('/link  ', actionGet).mode, SLASH_MODE_END);
  assert.equal(slashTextParse('/usr/bin', actionGet).mode, SLASH_MODE_END);
});

test('actions are listed by name first, then by alias and label', () => {
  const list = [actionDate, actionLink];
  assert.deepEqual(slashActionMatchList(list, '').map((action) => action.name), ['date', 'link']);
  assert.deepEqual(slashActionMatchList(list, 'l').map((action) => action.name), ['link']);
  assert.deepEqual(slashActionMatchList(list, 'at').map((action) => action.name), ['date']);
  assert.deepEqual(slashActionMatchList(list, 'zz'), []);
});

test('effects say what the surface does', () => {
  assert.deepEqual(slashEffectApplyGet(slashEffect.replace('[a](./a.md)'), 'link'), { textNew: '[a](./a.md)', isEnded: true });
  assert.deepEqual(slashEffectApplyGet(slashEffect.paramSet('docs/'), 'ln'), { textNew: '/ln docs/', isEnded: false });
  assert.deepEqual(slashEffectApplyGet(slashEffect.cancel(), 'link'), { textNew: undefined, isEnded: true });
  assert.deepEqual(slashEffectApplyGet(undefined, 'link'), { textNew: undefined, isEnded: false });
  // an atom of a kind: the slash text goes, the editor puts the atom at the caret
  assert.deepEqual(slashEffectApplyGet(slashEffect.atom('math', { isRow: true, textFallback: '$$' }), 'math'), {
    textNew: '', isEnded: true, atom: { atomKind: 'math', isRow: true, textFallback: '$$' },
  });
});

test('a definition is checked, and the registry layers override by id', () => {
  assert.throws(() => slashActionDefine({ name: 'two words', run: () => undefined }));
  assert.throws(() => slashActionDefine({ name: 'x' }));
  assert.throws(() => slashActionDefine({ name: 'x', param: { itemListGet: () => [] } }));
  const actionLinkHost = slashActionDefine({ name: 'link', run: () => slashEffect.cancel() });
  const byId = slashActionByIdBuild({ 'nav/link': actionLink, 'misc/date': actionDate }, { 'nav/link': actionLinkHost, 'misc/date': null });
  assert.deepEqual(Object.keys(byId), ['nav/link']);
  assert.equal(byId['nav/link'], actionLinkHost);
});

test('the store: from "/" through the action mode to a replaced link', () => {
  const store = new DocSlashStore({ slashActionById: { 'nav/link': actionLink, 'misc/date': actionDate } });
  store.isOnSet(true);
  const lineGet = (lineBefore) => ({ lineIndex: 0, lineBefore });
  store.slashStart('s1', { anchor: { lineIndex: 0, column: 4 }, context: {} });
  assert.equal(store.slashIsOpenFor('s1'), true);
  assert.equal(store.slashIsOpenFor('s2'), false);
  assert.equal(store.itemList.length, 2);

  store.slashUpdate('s1', lineGet('see /li'));
  assert.equal(store.parsed.mode, SLASH_MODE_ACTION);
  assert.deepEqual(store.itemList.map((item) => item.id), ['link']);
  // choosing an action with a parameter enters its param mode
  assert.deepEqual(store.itemChoose(), { textNew: '/link ', isEnded: false, lengthOld: 3 });

  store.slashUpdate('s1', lineGet('see /link '));
  assert.equal(store.parsed.mode, SLASH_MODE_PARAM);
  assert.deepEqual(store.itemList.map((item) => item.id), ['a.md', 'b.md', 'docs']);
  store.itemActiveMove(-1);
  assert.equal(store.itemActive.id, 'docs');
  // a folder rewrites the parameter, the slash mode stays
  assert.deepEqual(store.itemChoose(), { textNew: '/link docs/', isEnded: false, lengthOld: 6 });
  assert.equal(store.slashIsOpenFor('s1'), true);

  store.slashUpdate('s1', lineGet('see /link a'));
  assert.deepEqual(store.itemChoose(0), { textNew: '[a.md](./a.md)', isEnded: true, lengthOld: 7 });
  assert.equal(store.slash, undefined);
});

test('the store: the slash mode ends when the text stops being a slash text', () => {
  const store = new DocSlashStore({ slashActionById: { 'nav/link': actionLink } });
  store.isOnSet(true);
  store.slashStart('s1', { anchor: { lineIndex: 0, column: 0 }, context: {} });
  assert.equal(store.slashUpdate('s1', { lineIndex: 0, lineBefore: '/link a  ' }), false);
  assert.equal(store.slash, undefined);
  // off: "/" starts nothing
  store.isOnSet(false);
  store.slashStart('s1', { anchor: { lineIndex: 0, column: 0 }, context: {} });
  assert.equal(store.slash, undefined);
});

test('a surface brings its own actions: alone, or before the page\'s, a folder chosen going on', () => {
  const store = new DocSlashStore({ slashActionById: { 'nav/link': actionLink } });
  store.isOnSet(true);
  const valueByPath = { 'name/jp/last': '山田', 'name/jp/first': '太郎' };
  const actionQuery = slashActionDefine({
    name: 'query',
    aliasList: ['q'],
    label: 'Query path',
    param: {
      itemListGet: (param) => (param.endsWith('/') || param === ''
        ? Object.keys(valueByPath).filter((path) => path.startsWith(param)).map((path) => ({ id: path, label: path, detail: valueByPath[path] }))
        : [{ id: 'dir', kind: 'dir', label: `${param}/` }]),
      itemChoose: (item, param) => (item.kind === 'dir' ? slashEffect.paramSet(`${param}/`) : slashEffect.replace(`{{${item.id}}}`)),
    },
  });
  store.slashStart('cell', { anchor: { lineIndex: 0, column: 0 }, context: {}, actionOwnList: [actionQuery], isPageActionIncluded: false });
  assert.deepEqual(store.itemList.map((item) => item.id), ['query']);
  store.slashUpdate('cell', { lineIndex: 0, lineBefore: '/link ' });
  assert.equal(store.slash, undefined, 'the page\'s /link is not offered here');
  store.slashStart('cell', { anchor: { lineIndex: 0, column: 0 }, context: {}, actionOwnList: [actionQuery], isPageActionIncluded: false });
  store.slashUpdate('cell', { lineIndex: 0, lineBefore: '/q name' });
  // a folder chosen: the parameter goes on inside it, the slash mode stays
  assert.deepEqual(store.itemChoose(), { textNew: '/q name/', isEnded: false, lengthOld: 7 });
  store.slashUpdate('cell', { lineIndex: 0, lineBefore: '/q name/' });
  assert.deepEqual(store.itemList.map((item) => item.detail), ['山田', '太郎']);
  assert.deepEqual(store.itemChoose(1), { textNew: '{{name/jp/first}}', isEnded: true, lengthOld: 8 });
  // with the page's actions too
  store.slashStart('cell', { anchor: { lineIndex: 0, column: 0 }, context: {}, actionOwnList: [actionQuery] });
  assert.deepEqual(store.itemList.map((item) => item.id), ['link', 'query']);
});

const actionQuery = slashActionDefine({
  name: 'query',
  label: 'Query',
  param: {
    itemListGet: (param) => ['name/', 'name/jp', 'birth/'].filter((path) => path.startsWith(param)).map((path) => ({ id: path, label: path, kind: path.endsWith('/') ? 'dir' : 'value' })),
    itemChoose: (item) => (item.kind === 'dir' ? slashEffect.paramSet(item.label) : slashEffect.replace(`{{${item.label}}}`)),
    hintGet: (param) => (param ? `in ${param}` : ''),
  },
});
const actionMention = slashActionDefine({
  name: 'object',
  label: 'Object',
  param: { itemListGet: () => [{ id: 'a', label: 'a' }], itemChoose: () => slashEffect.replace('{{@a}}') },
});
const triggerList = [{ text: '{{', action: actionQuery, endList: ['}'] }, { text: '{{@', action: actionMention, endList: ['}'] }];

test('a direct trigger is the param mode of its action, the longest trigger first', () => {
  assert.equal(slashTriggerMatch('生年 {{', triggerList).action, actionQuery);
  assert.equal(slashTriggerMatch('{{@', triggerList).action, actionMention);
  assert.equal(slashTriggerMatch('{', triggerList), undefined);
  const parsed = slashTextParse('{{name/j', actionGet, triggerList);
  assert.equal(parsed.mode, SLASH_MODE_PARAM);
  assert.equal(parsed.action, actionQuery);
  assert.equal(parsed.param, 'name/j');
  assert.equal(slashTextParse('{{@fro', actionGet, triggerList).action, actionMention);
  // a character of its endList, two spaces in a row and a line break end it
  assert.equal(slashTextParse('{{name}', actionGet, triggerList).mode, SLASH_MODE_END);
  assert.equal(slashTextParse('{{name  ', actionGet, triggerList).mode, SLASH_MODE_END);
  // without triggers a text not starting with "/" is no slash text
  assert.equal(slashTextParse('{{name', actionGet).mode, SLASH_MODE_END);
  assert.equal(slashTextGet({ lineIndex: 0, column: 2 }, { lineIndex: 0, lineBefore: 'a {{name' }, triggerList), '{{name');
  assert.equal(slashTextGet({ lineIndex: 0, column: 2 }, { lineIndex: 0, lineBefore: 'a {{name' }), undefined);
  // a rewritten parameter keeps the trigger text where "/name " stands otherwise
  assert.deepEqual(slashEffectApplyGet(slashEffect.paramSet('name/'), 'query', triggerList[0]), { textNew: '{{name/', isEnded: false });
});

test('the store: a trigger typed in a cell walks a path and writes the token', () => {
  const store = new DocSlashStore({ slashActionById: {} });
  store.slashStart('cell', { anchor: { lineIndex: 0, column: 0 }, context: {}, actionOwnList: [actionQuery, actionMention], isPageActionIncluded: false, triggerList, text: '{{' });
  assert.equal(store.parsed.mode, SLASH_MODE_PARAM);
  assert.deepEqual(store.itemList.map((item) => item.label), ['name/', 'name/jp', 'birth/']);
  assert.equal(store.paramHint, '');
  // a folder chosen: the parameter is rewritten after the trigger text
  assert.deepEqual(store.itemChoose(0), { textNew: '{{name/', isEnded: false, lengthOld: 2 });
  assert.equal(store.slashUpdate('cell', { lineIndex: 0, lineBefore: '{{name/' }), true);
  assert.equal(store.paramHint, 'in name/');
  assert.deepEqual(store.itemList.map((item) => item.label), ['name/', 'name/jp']);
  assert.deepEqual(store.itemChoose(1), { textNew: '{{name/jp}}', isEnded: true, lengthOld: 7 });
  assert.equal(store.slash, undefined);
  // "@" typed after the braces: the other kind's action takes over
  store.slashStart('cell', { anchor: { lineIndex: 0, column: 0 }, context: {}, actionOwnList: [actionQuery, actionMention], isPageActionIncluded: false, triggerList, text: '{{' });
  assert.equal(store.slashUpdate('cell', { lineIndex: 0, lineBefore: '{{@' }), true);
  assert.equal(store.parsed.action, actionMention);
  // the closing brace typed by hand ends it
  assert.equal(store.slashUpdate('cell', { lineIndex: 0, lineBefore: '{{@a}' }), false);
});

test('a block put among the text of a paragraph stands between blank lines', () => {
  const source = '<!--renderComp=Mdx,view=icon-->\n```md\n```';
  assert.equal(slashBlockTextInsert('See this ', 9, source), `See this\n\n${source}`);
  assert.equal(slashBlockTextInsert('See this and that', 8, source), `See this\n\n${source}\n\nand that`);
  assert.equal(slashBlockTextInsert('text', 0, source), `${source}\n\ntext`);
  assert.equal(slashBlockTextInsert('line\n\nnext', 5, source), `line\n\n${source}\n\nnext`);
  assert.equal(slashBlockTextInsert('', 0, source), source);
});

test('the views of a block as an optional parameter: the default first, narrowed by what is typed', () => {
  const viewList = [{ id: 'card', label: 'Card' }, { id: 'plain', label: 'Plain' }, { id: 'icon', label: 'Icon' }];
  assert.deepEqual(slashViewItemListGet(viewList, 'plain', '').map((item) => [item.id, item.isDefault]), [['plain', true], ['card', false], ['icon', false]]);
  assert.deepEqual(slashViewItemListGet(viewList, 'plain', 'ic').map((item) => item.id), ['icon']);
  assert.deepEqual(slashViewItemListGet(viewList, 'plain', 'a').map((item) => item.id), ['plain', 'card']);
  assert.deepEqual(slashViewItemListGet(viewList, 'plain', 'x'), []);
});

test('an action with run and a param has an optional parameter: Enter runs it, Tab goes on to it', () => {
  const actionBox = slashBlockActionDefine({
    name: 'box',
    label: 'Box',
    viewList: [{ id: 'small', label: 'Small' }, { id: 'large', label: 'Large' }],
    viewDefaultGet: (context) => context.boxDefault,
    sourceBuild: (view) => `box ${view ?? 'default'}`,
  });
  assert.equal(actionBox.param.isOptional, true);
  assert.equal(actionBox.param.isListedOnRow, true);
  assert.equal(actionLink.param.isOptional, false);
  const store = new DocSlashStore({ slashActionById: { 'block/box': actionBox, 'nav/link': actionLink } });
  store.isOnSet(true);
  const lineGet = (lineBefore) => ({ lineIndex: 0, lineBefore });
  const open = () => {
    store.slashStart('s1', { anchor: { lineIndex: 0, column: 0 }, context: { boxDefault: 'large' } });
    store.slashUpdate('s1', lineGet('/bo'));
  };
  open();
  // Enter: the block as it is, the default view not written
  assert.deepEqual(store.itemChoose(), { textNew: '', isEnded: true, blockSource: 'box default', lengthOld: 3 });
  open();
  // Tab: the param mode, the views listed, the default first
  assert.deepEqual(store.itemChoose(undefined, { isParamOpen: true }), { textNew: '/box ', isEnded: false, lengthOld: 3 });
  store.slashUpdate('s1', lineGet('/box '));
  assert.deepEqual(store.itemList.map((item) => item.id), ['large', 'small']);
  assert.deepEqual(store.itemChoose(1), { textNew: '', isEnded: true, blockSource: 'box small', lengthOld: 5 });
  open();
  // the views on the row of the action, a click on one chooses it
  assert.equal(store.choiceDefaultLabelGet(actionBox), 'Large');
  assert.deepEqual(store.rowChoiceListGet(actionBox).map((item) => item.id), ['large', 'small']);
  assert.deepEqual(store.rowChoiceListGet(actionLink), []);
  assert.deepEqual(store.rowChoiceChoose(0, 1), { textNew: '', isEnded: true, blockSource: 'box small', lengthOld: 3 });
  // an action whose parameter is required enters its param mode on Enter too
  store.slashStart('s1', { anchor: { lineIndex: 0, column: 0 }, context: {} });
  store.slashUpdate('s1', lineGet('/li'));
  assert.deepEqual(store.itemChoose(), { textNew: '/link ', isEnded: false, lengthOld: 3 });
});

test('/code and /mdx: the default view by the place, written only when another is chosen', () => {
  const configValueGet = (key) => ({ CodeBlockView: 'card', CodeBlockViewInListItem: 'plain' })[key];
  const itemsAt = (action, place) => action.param.itemListGet('', { place, configValueGet });
  assert.deepEqual(itemsAt(codeSlashAction, undefined).map((item) => item.id), ['card', 'plain', 'icon']);
  assert.deepEqual(itemsAt(codeSlashAction, 'inListItem').map((item) => item.id), ['plain', 'card', 'icon']);
  assert.equal(codeBlockSourceBuild(undefined), '```\n```');
  assert.equal(codeBlockSourceBuild('icon'), '```text view=icon\n```');
  const itemIcon = itemsAt(codeSlashAction, undefined).find((item) => item.id === 'icon');
  assert.deepEqual(codeSlashAction.param.itemChoose(itemIcon, '', {}), slashEffect.block('```text view=icon\n```'));
  assert.deepEqual(mdxSlashAction.run({}), slashEffect.block('<!--renderComp=Mdx-->\n```md\n```'));
  const itemCard = mdxSlashAction.param.itemListGet('ca', {})[0];
  assert.deepEqual(mdxSlashAction.param.itemChoose(itemCard, 'ca', {}), slashEffect.block('<!--renderComp=Mdx,view=card-->\n```md\n```'));
});

test('/math puts a formula at the caret: in the line by default, on a row of its own as its parameter', () => {
  const byName = slashActionByNameBuild({ 'text/math': mathSlashAction });
  assert.equal(byName.get('latex'), mathSlashAction);
  assert.deepEqual(mathSlashAction.run({}), { type: 'atom', atomKind: 'math', isRow: false, textFallback: '$x$' });
  assert.equal(mathSlashAction.param.isOptional, true);
  const itemList = mathSlashAction.param.itemListGet('', {});
  assert.deepEqual(itemList.map((item) => [item.id, item.isDefault]), [['inline', true], ['row', false]]);
  assert.deepEqual(mathSlashAction.param.itemListGet('ro', {}).map((item) => item.id), ['row']);
  const effect = mathSlashAction.param.itemChoose(itemList[1], '', {});
  assert.equal(effect.isRow, true);
  assert.match(effect.textFallback, /^\n\$\$\nx\n\$\$\n$/);
});
