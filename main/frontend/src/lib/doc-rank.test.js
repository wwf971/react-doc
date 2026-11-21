import assert from 'node:assert/strict';
import test from 'node:test';
import { rankBetween, rankCompare, rankIsValid, rankOrderCompare } from './doc-rank.js';

// ranks (doc_page_impl_config.md#ranks): strings over 0-9 a-z, never ending
// with 0, compared by code unit; there is always a rank between two.

test('a rank is 0-9 and a-z, never ending with 0', () => {
  for (const rank of ['c', 'ci', '1', 'z', '0i', 'a5b']) assert.equal(rankIsValid(rank), true, rank);
  for (const rank of ['', '0', 'c0', 'C', 'c-d', ' c', 1, null, undefined]) assert.equal(rankIsValid(rank), false, String(rank));
});

test('ranks compare character by character, not by length or locale', () => {
  assert.equal(rankCompare('c', 'ci'), -1);
  assert.equal(rankCompare('ci', 'd'), -1);
  assert.equal(rankCompare('z', 'a'), 1);
  assert.equal(rankCompare('9', 'a'), -1);
  assert.equal(rankCompare('k', 'k'), 0);
  // a ranked thing first, the unranked left to the caller's order
  assert.equal(rankOrderCompare('z', ''), -1);
  assert.equal(rankOrderCompare('', 'a'), 1);
  assert.equal(rankOrderCompare('', undefined), 0);
  assert.equal(rankOrderCompare('C0', 'a'), 1, 'a rank that is not valid is no rank');
});

test('a rank between two, or before / after one', () => {
  assert.deepEqual(rankBetween('c', 'e'), { code: 0, data: 'd' });
  assert.deepEqual(rankBetween('c', 'd'), { code: 0, data: 'ci' });
  assert.deepEqual(rankBetween('c5', 'd3'), { code: 0, data: 'd' });
  assert.deepEqual(rankBetween('', '1'), { code: 0, data: '0i' });
  assert.deepEqual(rankBetween(), { code: 0, data: 'i' });
  assert.deepEqual(rankBetween('z'), { code: 0, data: 'zi' });
  assert.equal(rankBetween('e', 'c').code, -1);
  assert.equal(rankBetween('c', 'c').code, -1);
  assert.equal(rankBetween('c0', 'd').code, -1);
});

test('inserting again and again between neighbours keeps a valid strict order', () => {
  const rankList = ['c', 'e'];
  let seed = 7;
  for (let index = 0; index < 400; index += 1) {
    seed = (seed * 48271) % 2147483647;
    const at = seed % (rankList.length + 1);
    const result = rankBetween(rankList[at - 1] ?? '', rankList[at] ?? '');
    assert.equal(result.code, 0);
    assert.equal(rankIsValid(result.data), true, result.data);
    rankList.splice(at, 0, result.data);
  }
  for (let index = 1; index < rankList.length; index += 1) {
    assert.equal(rankCompare(rankList[index - 1], rankList[index]), -1, `${rankList[index - 1]} < ${rankList[index]}`);
  }
});
