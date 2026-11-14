import assert from 'node:assert/strict';
import test from 'node:test';
import { timeTextDisplay } from './time-text.js';

test('a displayed time always carries its zone', () => {
  // a text of the project's format: the zone it was written in
  assert.equal(timeTextDisplay('20261115_04441234+09'), '2026-11-15 04:44 +09');
  assert.equal(timeTextDisplay('20261115_04441234+09', { isYearShown: false }), '11-15 04:44 +09');
  assert.equal(timeTextDisplay('20261115_04441234-05', { part: 'second' }), '2026-11-15 04:44:12 -05');
  assert.equal(timeTextDisplay('20261114_07443316+00', { part: 'date' }), '2026-11-14 +00');
  // a moment: the zone of whoever looks
  const moment = new Date(2026, 10, 15, 4, 44, 12);
  assert.match(timeTextDisplay(moment), /^2026-11-15 04:44 [+-]\d{2}$/);
  assert.match(timeTextDisplay(moment.getTime(), { part: 'second' }), /^2026-11-15 04:44:12 [+-]\d{2}$/);
  // no time
  for (const none of [undefined, null, '', 0, 'not a time']) assert.equal(timeTextDisplay(none), '');
});
