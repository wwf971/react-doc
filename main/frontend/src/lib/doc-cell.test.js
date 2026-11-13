import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cellBraceTextBuild, cellLinkMatchList, cellTextParse, cellTextPlainGet, cellTokenListGet, cellTokenListResolve, cellTokenSoleGet, cellTriggerListBuild,
} from './doc-cell.js';
import { cellTokenByIdBuild, cellTokenDefine } from '../../../comp-doc/cell/cell-define.js';
import { slashActionDefine, } from '../../../comp-doc/slash/slash-define.js';
import { slashEffect } from './doc-slash.js';

const actionOf = (name) => slashActionDefine({ name, param: { itemListGet: () => [], itemChoose: () => slashEffect.cancel() } });
const kindLink = cellTokenDefine({ name: 'link', match: cellLinkMatchList, textGet: (token) => token.data.label, slashAction: actionOf('link') });
const kindObject = cellTokenDefine({ name: 'object', brace: { sigil: '@' }, read: (body) => (/^[a-z]+:.+/.test(body) ? { ref: body } : undefined), slashAction: actionOf('object') });
const kindQuery = cellTokenDefine({ name: 'query', brace: { sigil: '' }, read: (body) => ({ query: body }), textGet: (token) => `<${token.data.query}>`, slashAction: actionOf('query') });
const kindList = [kindQuery, kindLink, kindObject];

const shapeOf = (partList) => partList.map((part) => (part.type === 'text' ? part.text : [part.name, part.body, part.data]));

test('a cell text is text and tokens, each token of the kind that takes it', () => {
  const partList = cellTextParse('山田 {{name/jp/first}} · [Guide](~example:root/guide.md) {{@frontend:w5j7#/book/sci-fi/dune}}', kindList);
  assert.deepEqual(shapeOf(partList), [
    '山田 ',
    ['query', 'name/jp/first', { query: 'name/jp/first' }],
    ' · ',
    ['link', '[Guide](~example:root/guide.md)', { label: 'Guide', target: '~example:root/guide.md' }],
    ' ',
    ['object', 'frontend:w5j7#/book/sci-fi/dune', { ref: 'frontend:w5j7#/book/sci-fi/dune' }],
  ]);
  // the parts cover the text whole
  assert.equal(partList.map((part) => (part.type === 'text' ? part.text : part.raw)).join(''), '山田 {{name/jp/first}} · [Guide](~example:root/guide.md) {{@frontend:w5j7#/book/sci-fi/dune}}');
  assert.equal(partList[1].raw, '{{name/jp/first}}');
  assert.equal(partList[1].start, 3);
});

test('what no kind of the cell takes stays text', () => {
  // no kind takes brace tokens without a sigil: the query is text here
  assert.deepEqual(shapeOf(cellTextParse('{{name}} [a](b.md)', [kindLink])), ['{{name}} ', ['link', '[a](b.md)', { label: 'a', target: 'b.md' }]]);
  // a kind that reads nothing of a body leaves it as written
  assert.deepEqual(shapeOf(cellTextParse('{{@not a ref}}', [kindObject])), ['{{@not a ref}}']);
  // with the kind taking the rest, a body the sigil kind refuses is still that kind's to refuse
  assert.deepEqual(shapeOf(cellTextParse('{{@nothing}}', kindList)), ['{{@nothing}}']);
  assert.deepEqual(cellTextParse('', kindList), []);
  assert.deepEqual(shapeOf(cellTextParse('plain', [])), ['plain']);
});

test('a link is read as the navigation layer writes one', () => {
  assert.deepEqual(cellLinkMatchList('see [A \\[b\\]](<~p:r/a b.md#x>) and ![img](a.png)').map((match) => match.data), [{ label: 'A [b]', target: '~p:r/a b.md#x' }]);
  assert.deepEqual(cellLinkMatchList('[x](https://example.com/a?b=1)').map((match) => match.data.target), ['https://example.com/a?b=1']);
  assert.deepEqual(cellLinkMatchList('[x]()'), []);
});

test('the plain text of a cell, and a cell that is one token', () => {
  const partList = cellTextParse('{{birth/month}}月 [Guide](a.md) {{@doc:x}}', kindList);
  assert.equal(cellTextPlainGet(partList, (part) => part.kind.textGet?.(part)), '<birth/month>月 Guide {{@doc:x}}');
  assert.equal(cellTokenSoleGet(cellTextParse('  {{name/jp}} ', kindList)).name, 'query');
  assert.equal(cellTokenSoleGet(partList), undefined);
  assert.deepEqual(cellTokenListGet(partList, 'query').map((part) => part.body), ['birth/month']);
  assert.equal(cellBraceTextBuild(' frontend:a#/b ', '@'), '{{@frontend:a#/b}}');
});

test('the kinds of a cell: its own first, one taking the rest, the page\'s by id', () => {
  const tokenById = cellTokenByIdBuild({ 'nav/link': kindLink, 'object/view': kindObject }, { 'host/none': null });
  assert.deepEqual(cellTokenListResolve({ tokenOwnList: [kindQuery], tokenById }).map((kind) => kind.name), ['query', 'link', 'object']);
  assert.deepEqual(cellTokenListResolve({ tokenOwnList: [kindQuery], tokenById, tokenIdList: ['nav/link'] }).map((kind) => kind.name), ['query', 'link']);
  assert.deepEqual(cellTokenListResolve({ tokenOwnList: [kindQuery], tokenById, tokenIdList: [] }).map((kind) => kind.name), ['query']);
  // a second kind taking the rest is left out; an own kind hides a page kind of its name
  const kindOther = cellTokenDefine({ name: 'other', brace: { sigil: '' } });
  const kindLinkOwn = cellTokenDefine({ name: 'link', match: () => [] });
  assert.deepEqual(cellTokenListResolve({ tokenOwnList: [kindQuery, kindOther, kindLinkOwn], tokenById }), [kindQuery, kindLinkOwn, kindObject]);
});

test('a brace kind typed with an action is entered by its opening text', () => {
  const triggerList = cellTriggerListBuild(kindList, (kind) => kind.slashAction);
  assert.deepEqual(triggerList.map((trigger) => [trigger.text, trigger.action.name]), [['{{', 'query'], ['{{@', 'object']]);
});

test('a definition is checked', () => {
  assert.throws(() => cellTokenDefine({ name: 'two words', brace: { sigil: '' } }));
  assert.throws(() => cellTokenDefine({ name: 'both', brace: { sigil: '' }, match: () => [] }));
  assert.throws(() => cellTokenDefine({ name: 'none' }));
  assert.throws(() => cellTokenDefine({ name: 'sigil', brace: { sigil: '{' } }));
});

// ---------- the store ----------

test('the store: a cell of a component, its kinds, its slash, its context read live', async () => {
  const { DocCellStore } = await import('../store/DocCellStore.js');
  const { DocSlashStore } = await import('../store/DocSlashStore.js');
  const slashStore = new DocSlashStore({ slashActionById: {} });
  const sourceStore = { sourceService: { pathComplete: () => [] }, docPageAliasOfPath: () => 'example' };
  const objectStore = { resolveStateGet: (ref) => ({ descriptor: { label: `label of ${ref}` } }) };
  const store = new DocCellStore({ cellTokenById: { 'nav/link': kindLink, 'object/view': kindObject }, stores: { slashStore, sourceStore, objectStore } });

  // the component's own kind reads its own data through the context, which it keeps current
  const contextOwn = { valueByQuery: { 'name/jp': '太郎' } };
  const kindOwn = cellTokenDefine({
    name: 'query', brace: { sigil: '' }, read: (body) => ({ query: body }),
    textGet: (token, cell) => cell.context.valueByQuery[token.data.query] ?? '',
    slashAction: actionOf('query'),
  });
  const cell = store.cellBuild({ tokenList: [kindOwn], context: contextOwn, sourcePath: '~example:root/a.md', owner: 'frontend:w5j7' });
  assert.deepEqual(cell.tokenList.map((kind) => kind.name), ['query', 'link', 'object']);
  assert.equal(cell.textGet('{{name/jp}} [Guide](a.md)'), '太郎 Guide');
  contextOwn.valueByQuery = { 'name/jp': '次郎' };
  assert.equal(cell.textGet('{{name/jp}}'), '次郎');
  // the same text is parsed once for the same kinds
  assert.equal(cell.parse('{{name/jp}}'), cell.parse('{{name/jp}}'));

  // its slash: the actions of its kinds and no other, "/" anywhere, the brace kinds entered at once
  assert.equal(cell.slash.store, slashStore);
  assert.deepEqual(cell.slash.actionList.map((action) => action.name), ['query', 'link', 'object']);
  assert.equal(cell.slash.isPageActionIncluded, false);
  assert.equal(cell.slash.isTriggerLoose, true);
  assert.deepEqual(cell.slash.triggerList.map((trigger) => trigger.text), ['{{', '{{@']);
  // what its actions are given: the component's context, read live, with the page's services
  assert.equal(cell.slash.context.valueByQuery['name/jp'], '次郎');
  assert.equal(cell.slash.context.source, sourceStore.sourceService);
  assert.equal(cell.slash.context.object, objectStore);
  assert.equal(cell.slash.context.sourcePath, '~example:root/a.md');
  assert.equal(cell.slash.context.cell, cell);

  // a cell accepting none of the page's kinds; a page without a slash store has cells without one
  assert.deepEqual(store.cellBuild({ tokenList: [kindOwn], tokenIdList: [] }).tokenList.map((kind) => kind.name), ['query']);
  assert.equal(new DocCellStore({ cellTokenById: {} }).cellBuild({}).slash, undefined);
});

test('the store: one field open at a time, saved by what the component answers', async () => {
  const { DocCellStore } = await import('../store/DocCellStore.js');
  const store = new DocCellStore({});
  store.fieldOpen('a', 'old');
  assert.equal(store.fieldIsOpen('a'), true);
  store.fieldOpen('b', 'other');
  assert.equal(store.fieldIsOpen('a'), false);
  // an unchanged text is not handed over
  let countCommit = 0;
  await store.fieldCommit('b', () => { countCommit += 1; });
  assert.equal(countCommit, 0);
  assert.equal(store.field, undefined);
  // a refused save keeps the field open with the reason; an accepted one closes it
  store.fieldOpen('a', 'old');
  store.fieldDraftSet('a', 'new');
  await store.fieldCommit('a', (text) => ({ code: -1, message: `cannot write ${text}` }));
  assert.equal(store.field.message, 'cannot write new');
  assert.equal(store.field.status, 'idle');
  await store.fieldCommit('a', async () => ({ code: 0 }));
  assert.equal(store.field, undefined);
  // a component answering nothing accepted it; one throwing refused it
  store.fieldOpen('c', '');
  store.fieldDraftSet('c', 'x');
  await store.fieldCommit('c', () => { throw new Error('offline'); });
  assert.equal(store.field.message, 'offline');
  await store.fieldCommit('c', () => undefined);
  assert.equal(store.field, undefined);
});

// ---------- the parameters of a token, a range of a text, a selected token ----------

test('a brace token carries parameters after "|", and is written again with a change', async () => {
  const { cellRangeRead, cellTextRangeReplace, cellTokenTextBuild } = await import('./doc-cell.js');
  const kindBadge = cellTokenDefine({ name: 'badge', brace: { sigil: '/badge/' }, read: (body, param) => ({ path: body, isLarge: param.size === 'l' }) });
  const text = 'SAA {{/badge/aws/saa|size=l,name}} and {{name/jp}}';
  const partList = cellTextParse(text, [kindQuery, kindBadge]);
  const badge = partList[1];
  assert.deepEqual([badge.name, badge.body, badge.param, badge.data], ['badge', 'aws/saa', { size: 'l', name: true }, { path: 'aws/saa', isLarge: true }]);
  // the kind taking the rest has parameters too, and a token without any has none
  assert.deepEqual([partList[3].name, partList[3].body, partList[3].param], ['query', 'name/jp', {}]);
  // a change: parameters a key at a time, null removing one; the body kept unless given
  assert.equal(cellTokenTextBuild(badge, { param: { size: 's' } }), '{{/badge/aws/saa|size=s,name}}');
  assert.equal(cellTokenTextBuild(badge, { param: { size: null, name: null } }), '{{/badge/aws/saa}}');
  assert.equal(cellTokenTextBuild(badge, { body: 'aws/clf' }), '{{/badge/aws/clf|size=l,name}}');
  assert.equal(cellBraceTextBuild('aws/saa', '/badge/', { size: 'm', name: false, note: 'a,b|c' }), '{{/badge/aws/saa|size=m,note=abc}}');
  // the token written again in its text, or taken out
  assert.equal(cellTextRangeReplace(text, badge.start, badge.end, cellTokenTextBuild(badge, { param: { size: null } })), 'SAA {{/badge/aws/saa|name}} and {{name/jp}}');
  assert.equal(cellTextRangeReplace(text, badge.start, badge.end, ''), 'SAA  and {{name/jp}}');
  // a range of the text: words only, or holding a token in part or whole
  assert.deepEqual(cellRangeRead(partList, 0, 3, text), { text: 'SAA', isPlain: true });
  assert.equal(cellRangeRead(partList, 2, 8, text).isPlain, false);
  assert.equal(cellRangeRead(partList, badge.start, badge.end, text).isPlain, false);
  assert.equal(cellRangeRead(partList, 3, 3, text).isPlain, false);
});

test('the store: one token selected at a time, cleared when a field opens', async () => {
  const { DocCellStore } = await import('../store/DocCellStore.js');
  const store = new DocCellStore({});
  store.tokenSelect('row:1:text', 12);
  assert.equal(store.tokenIsSelected('row:1:text', 12), true);
  assert.equal(store.tokenIsSelected('row:1:text', 0), false);
  store.tokenSelect('cell:address', 0);
  assert.equal(store.tokenIsSelected('row:1:text', 12), false);
  // cleared for the value it stands in only
  store.tokenSelectClear('row:1:text');
  assert.equal(store.tokenIsSelected('cell:address', 0), true);
  // a field opened writes the same text: the selection goes
  store.fieldOpen('cell:address', 'x');
  assert.equal(store.token, undefined);
});
