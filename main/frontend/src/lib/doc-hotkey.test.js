import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hotkeyFormat,
  hotkeyLabelByApiBuild,
  hotkeyParse,
  hotkeyResolve,
  hotkeyStrokeFromEvent,
  hotkeyStrokeHasModifier,
  hotkeyTableBuild,
  hotkeyTableEffectiveGet,
  whenEval,
  whenParse,
} from './doc-hotkey.js';

test('hotkeyParse: modifiers in any order and spelling, one canonical text', () => {
  assert.equal(hotkeyParse('Shift+Ctrl+P').text, 'ctrl+shift+p');
  assert.equal(hotkeyParse('cmd+,').text, 'meta+,');
  assert.equal(hotkeyParse('option+left').text, 'alt+left');
  assert.equal(hotkeyParse('mod+k', { isMac: true }).text, 'meta+k');
  assert.equal(hotkeyParse('mod+k', { isMac: false }).text, 'ctrl+k');
  assert.equal(hotkeyParse('F1').text, 'f1');
  assert.equal(hotkeyParse('Esc').text, 'escape');
  assert.equal(hotkeyParse('ctrl+k ctrl+s').text, 'ctrl+k ctrl+s');
  assert.equal(hotkeyParse('ctrl++').text, 'ctrl++');
});

test('hotkeyParse refuses what it cannot read, with the key named', () => {
  assert.match(hotkeyParse('ctrl+').message, /a key is missing|empty part/);
  assert.match(hotkeyParse('super+duper+x').message, /"duper" is not a modifier/);
  assert.match(hotkeyParse('ctrl+hyper').message, /unknown key "hyper"/);
  assert.match(hotkeyParse('a b c').message, /two strokes at most/);
  assert.match(hotkeyParse('').message, /empty/);
  assert.match(hotkeyParse('ctrl+ctrl+a').message, /ctrl twice/);
});

test('hotkeyFormat shows the key as the platform writes it', () => {
  assert.equal(hotkeyFormat('ctrl+shift+p'), 'Ctrl+Shift+P');
  assert.equal(hotkeyFormat('ctrl+shift+p', { isMac: true }), '⌃⇧P');
  assert.equal(hotkeyFormat('meta+shift+p', { isMac: true }), '⇧⌘P');
  assert.equal(hotkeyFormat('alt+left'), 'Alt+←');
  assert.equal(hotkeyFormat('ctrl+k ctrl+s'), 'Ctrl+K Ctrl+S');
  assert.equal(hotkeyFormat('escape'), 'Esc');
});

test('hotkeyStrokeFromEvent reads letters from the physical key and names the rest', () => {
  const stroke = hotkeyStrokeFromEvent({ key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
  assert.deepEqual(stroke, { ctrl: true, shift: true, alt: false, meta: false, key: 'p' });
  assert.equal(hotkeyStrokeFromEvent({ key: 'Control', code: 'ControlLeft', ctrlKey: true }), undefined);
  assert.equal(hotkeyStrokeFromEvent({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }).key, 'left');
  assert.equal(hotkeyStrokeFromEvent({ key: ' ', code: 'Space' }).key, 'space');
  assert.equal(hotkeyStrokeFromEvent({ key: '2', code: 'Digit2' }).key, '2');
  assert.equal(hotkeyStrokeFromEvent({ key: 'F1', code: 'F1' }).key, 'f1');
  assert.equal(hotkeyStrokeHasModifier({ shift: true }), false);
  assert.equal(hotkeyStrokeHasModifier({ shift: true, alt: true }), true);
});

test('when: names joined by && and negated by !', () => {
  const when = whenParse('editMode && !sessionOpen');
  assert.equal(when.message, '');
  assert.equal(whenEval(when, { editMode: true, sessionOpen: false }), true);
  assert.equal(whenEval(when, { editMode: true, sessionOpen: true }), false);
  assert.equal(whenEval(when, {}), false);
  assert.equal(whenEval(whenParse(''), {}), true);
  assert.match(whenParse('edit mode').message, /not a context name/);
});

function tableBuild() {
  return hotkeyTableBuild([
    {
      id: 'package',
      source: 'package',
      bindingList: [
        { key: 'ctrl+shift+p', api: 'palette/open' },
        { key: 'alt+left', api: 'nav/back' },
        { key: 'ctrl+e', api: 'edit/modeToggle' },
        { key: 'ctrl+shift+x', api: 'nav/up' },
      ],
    },
    {
      id: 'doc',
      source: 'example/.doc-page/hotkey/main.yaml',
      bindingList: [
        { key: 'ctrl+e', api: 'service/todo-list/todoAdd' },
        { key: 'alt+left', api: null },
        { key: 'ctrl+shift+x', api: 'edit/sessionLeave', when: 'sessionOpen' },
        { key: 'ctrl+k ctrl+s', api: 'settings/open' },
        { key: 'ctrl+bogus', api: 'x/y' },
        { key: 'ctrl+1', api: '' },
      ],
    },
  ]);
}

test('hotkeyTableBuild stacks the maps and reports the bindings it leaves out', () => {
  const table = tableBuild();
  assert.deepEqual(table.problemList.map((problem) => problem.message), [
    '"ctrl+bogus": unknown key "bogus"',
    '"ctrl+1": a binding names an api, or api: null to unbind the key',
  ]);
  assert.deepEqual(table.bindingListByKey.get('ctrl+e').map((binding) => binding.api), ['service/todo-list/todoAdd', 'edit/modeToggle']);
  assert.equal(table.isChordPrefix('ctrl+k'), true);
  assert.equal(table.isChordPrefix('ctrl+e'), false);
});

test('hotkeyResolve: the top binding wins, a missing api is passed over, null unbinds, when is read', () => {
  const table = tableBuild();
  const apiExistsAll = () => true;
  assert.equal(hotkeyResolve(table, 'ctrl+e', { apiExists: apiExistsAll }).binding.api, 'service/todo-list/todoAdd');
  // the service instance is gone: its binding is hidden, the package's shows through
  const resolved = hotkeyResolve(table, 'ctrl+e', { apiExists: (id) => !id.startsWith('service/') });
  assert.equal(resolved.binding.api, 'edit/modeToggle');
  assert.equal(resolved.passedList.length, 1);
  assert.match(resolved.passedList[0].reason, /not registered/);
  assert.equal(hotkeyResolve(table, 'alt+left', { apiExists: apiExistsAll }), undefined);
  assert.equal(hotkeyResolve(table, 'ctrl+shift+x', { apiExists: apiExistsAll, contextKeyByName: { sessionOpen: true } }).binding.api, 'edit/sessionLeave');
  assert.equal(hotkeyResolve(table, 'ctrl+shift+x', { apiExists: apiExistsAll, contextKeyByName: {} }).binding.api, 'nav/up');
  assert.equal(hotkeyResolve(table, 'ctrl+k ctrl+s', { apiExists: apiExistsAll }).binding.api, 'settings/open');
  assert.equal(hotkeyResolve(table, 'ctrl+9', { apiExists: apiExistsAll }), undefined);
});

test('the effective table and the key shown beside an api', () => {
  const table = tableBuild();
  const options = { apiExists: (id) => id !== 'service/todo-list/todoAdd', contextKeyByName: {} };
  const rowList = hotkeyTableEffectiveGet(table, options);
  const rowByKey = Object.fromEntries(rowList.map((row) => [row.keyText, row]));
  assert.equal(rowByKey['alt+left'].binding, undefined);
  assert.equal(rowByKey['alt+left'].passedList[0].reason, 'unbinds the key');
  assert.equal(rowByKey['ctrl+e'].binding.api, 'edit/modeToggle');
  assert.equal(rowByKey['ctrl+shift+x'].binding.api, 'nav/up');
  assert.equal(rowByKey['ctrl+shift+x'].passedList[0].reason, 'when "sessionOpen" does not hold');
  const labelByApi = hotkeyLabelByApiBuild(table, options);
  assert.equal(labelByApi.get('palette/open'), 'Ctrl+Shift+P');
  assert.equal(labelByApi.get('edit/modeToggle'), 'Ctrl+E');
  assert.equal(labelByApi.get('nav/back'), undefined);
});
