import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SLASH_MODE_ACTION,
  SLASH_MODE_END,
  SLASH_MODE_PARAM,
  slashActionMatchList,
  slashEffect,
  slashEffectApplyGet,
  slashLineRead,
  slashTextGet,
  slashTextParse,
  slashTriggerIs,
} from './doc-slash.js';
import { slashActionByIdBuild, slashActionByNameBuild, slashActionDefine } from '../../../comp-doc/slash/slash-define.js';
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

test('a "/" starts the slash mode only at the start of a word', () => {
  assert.equal(slashTriggerIs('/'), true);
  assert.equal(slashTriggerIs('see /'), true);
  assert.equal(slashTriggerIs('and/'), false);
  assert.equal(slashTriggerIs('http:/'), false);
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
