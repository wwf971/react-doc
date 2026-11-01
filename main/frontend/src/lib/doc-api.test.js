import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  API_CODE_FAILED,
  API_CODE_OK,
  apiAvailabilityGet,
  apiByIdBuild,
  apiDeclaredDefine,
  apiDefine,
  apiIdIsValid,
  apiInfoBuild,
  apiParamsCheck,
  apiParamsFromText,
  apiResultNormalize,
} from './doc-api.js';

test('apiParamsFromText reads the texts of the palette by the type of each param; an empty text is no value', () => {
  const api = apiDefine({
    run: () => {},
    paramList: [
      { name: 'target', type: 'sourcePath', isRequired: true },
      { name: 'count', type: 'number' },
      { name: 'isOn', type: 'boolean' },
      { name: 'data', type: 'object' },
      { name: 'block', type: 'any' },
    ],
  });
  assert.deepEqual(apiParamsFromText(api, { target: 'a.md', count: '', isOn: 'true', data: '{"a":1}', block: '2' }), {
    params: { target: 'a.md', isOn: true, data: { a: 1 }, block: 2 },
  });
  assert.deepEqual(apiParamsFromText(api, { block: 'login-asset' }).params, { block: 'login-asset' });
  assert.equal(apiParamsFromText(api, { count: 'x' }).message, 'param "count" must be a number');
  assert.equal(apiParamsFromText(api, { isOn: 'yes' }).message, 'param "isOn" must be true or false');
  assert.match(apiParamsFromText(api, { data: '{' }).message, /written as JSON/);
  // what the texts give is then checked as any call's params: the required one
  assert.match(apiParamsCheck(api, apiParamsFromText(api, {}).params).message, /"target" is required/);
});

test('apiDefine normalizes the definition and refuses a wrong one', () => {
  const api = apiDefine({ label: 'Back', run: () => {} });
  assert.equal(api.name, '');
  assert.equal(api.label, 'Back');
  assert.deepEqual(api.paramList, []);
  assert.equal(api.palette.isListed, true);
  assert.throws(() => apiDefine({ label: 'x' }), /run\(context, params\)/);
  assert.throws(() => apiDefine({ name: 'a/b', run: () => {} }), /one segment/);
  assert.throws(() => apiDefine({ run: () => {}, paramList: [{ name: 'a', type: 'date' }] }), /type must be one of/);
  assert.throws(() => apiDefine({ run: () => {}, paramList: [{ name: 'a' }, { name: 'a' }] }), /declared twice/);
});

test('an api is listed in the palette unless it says not, params or not; a sourcePath param carries its spec', () => {
  const api = apiDefine({ run: () => {}, paramList: [{ name: 'target', type: 'sourcePath', pathSpec: { kind: 'file' }, isRequired: true }] });
  assert.equal(api.palette.isListed, true);
  assert.deepEqual(api.paramList[0].pathSpec, { kind: 'file' });
  assert.equal(apiDefine({ run: () => {}, paramList: [{ name: 'x', type: 'sourcePath' }] }).paramList[0].pathSpec.kind, 'any');
  assert.equal(apiDefine({ run: () => {}, paramList: [{ name: 'x', type: 'string' }] }).paramList[0].pathSpec, undefined);
  const apiHidden = apiDefine({ run: () => {}, palette: false });
  assert.equal(apiHidden.palette.isListed, false);
  const apiKeyword = apiDefine({ run: () => {}, palette: { keywordList: ['history'] } });
  assert.deepEqual(apiKeyword.palette, { isListed: true, keywordList: ['history'] });
  assert.equal(apiInfoBuild(api).paramList[0].pathSpec.kind, 'file');
  assert.equal(apiParamsCheck(api, { target: 3 }).message, 'param "target" must be a string');
});

test('apiIdIsValid: {layer}/{name}, two segments or more', () => {
  assert.equal(apiIdIsValid('nav/back'), true);
  assert.equal(apiIdIsValid('common/TestCaseTable/resultRecord'), true);
  assert.equal(apiIdIsValid('back'), false);
  assert.equal(apiIdIsValid('nav/'), false);
  assert.equal(apiIdIsValid('nav/ba ck'), false);
});

test('apiByIdBuild stacks the layers, fills id, name and category, removes with null', () => {
  const warnList = [];
  const warnOriginal = console.warn;
  console.warn = (message) => warnList.push(String(message));
  try {
    const layerPackage = {
      'nav/back': apiDefine({ label: 'Back', run: () => {} }),
      'nav/forward': apiDefine({ label: 'Forward', run: () => {} }),
      'bad': apiDefine({ run: () => {} }),
      'nav/wrong': { label: 'not a definition' },
    };
    const layerHost = {
      'nav/forward': null,
      'nav/back': apiDefine({ label: 'Back (host)', category: 'Mine', run: () => {} }),
    };
    const apiById = apiByIdBuild(layerPackage, layerHost);
    assert.deepEqual(Object.keys(apiById).sort(), ['nav/back']);
    assert.equal(apiById['nav/back'].label, 'Back (host)');
    assert.equal(apiById['nav/back'].id, 'nav/back');
    assert.equal(apiById['nav/back'].name, 'back');
    assert.equal(apiById['nav/back'].category, 'Mine');
    assert.equal(warnList.length, 2);
    assert.equal(apiByIdBuild(layerPackage)['nav/forward'].category, 'Navigation');
    assert.match(warnList[0], /bad: an api id/);
    assert.match(warnList[1], /nav\/wrong: not an apiDefine/);
  } finally {
    console.warn = warnOriginal;
  }
});

test('apiParamsCheck fills defaults and refuses missing, wrong and unknown params', () => {
  const api = apiDefine({
    run: () => {},
    paramList: [
      { name: 'target', type: 'string', isRequired: true },
      { name: 'count', type: 'number', valueDefault: 1 },
      { name: 'mode', type: 'string', valueList: ['view', 'edit'] },
    ],
  });
  assert.deepEqual(apiParamsCheck(api, { target: 'a.md' }), { params: { target: 'a.md', count: 1 } });
  assert.match(apiParamsCheck(api, {}).message, /"target" is required/);
  assert.match(apiParamsCheck(api, { target: 1 }).message, /must be a string/);
  assert.match(apiParamsCheck(api, { target: 'a', count: 'x' }).message, /must be a number/);
  assert.match(apiParamsCheck(api, { target: 'a', mode: 'x' }).message, /must be one of/);
  assert.match(apiParamsCheck(api, { target: 'a', other: 1 }).message, /unknown param "other"/);
  assert.match(apiParamsCheck(api, [1]).message, /must be a mapping/);
  assert.deepEqual(apiParamsCheck(api, { target: 'a', mode: 'edit' }), { params: { target: 'a', count: 1, mode: 'edit' } });
});

test('apiResultNormalize: a coded result as it is, nothing is 0, anything else is data', () => {
  assert.deepEqual(apiResultNormalize(undefined), { code: 0, data: undefined, message: '' });
  assert.deepEqual(apiResultNormalize({ code: -1, message: 'no' }), { code: -1, data: undefined, message: 'no' });
  assert.deepEqual(apiResultNormalize({ path: 'a.md' }), { code: 0, data: { path: 'a.md' }, message: '' });
  assert.deepEqual(apiResultNormalize([1, 2]), { code: 0, data: [1, 2], message: '' });
});

test('apiAvailabilityGet reads true, false and a reason', () => {
  assert.deepEqual(apiAvailabilityGet(apiDefine({ run: () => {} }), {}), { isAvailable: true, reason: '' });
  assert.deepEqual(apiAvailabilityGet(apiDefine({ run: () => {}, isAvailable: () => false }), {}), { isAvailable: false, reason: 'not available now' });
  assert.deepEqual(apiAvailabilityGet(apiDefine({ run: () => {}, isAvailable: () => 'no history' }), {}), { isAvailable: false, reason: 'no history' });
  assert.match(apiAvailabilityGet(apiDefine({ run: () => {}, isAvailable: () => { throw new Error('boom'); } }), {}).reason, /boom/);
});

test('apiInfoBuild keeps what a remote caller needs and no function', () => {
  const api = apiByIdBuild({ 'nav/goTo': apiDefine({ label: 'Go to', run: () => {}, paramList: [{ name: 'target', type: 'string', isRequired: true, description: 'a document' }] }) })['nav/goTo'];
  const info = apiInfoBuild(api, { isAvailable: true, reason: '' });
  assert.deepEqual(info, {
    id: 'nav/goTo',
    name: 'goTo',
    label: 'Go to',
    description: '',
    category: 'Navigation',
    paramList: [{ name: 'target', type: 'string', isRequired: true, description: 'a document' }],
    isPaletteListed: true,
    isAvailable: true,
    reason: '',
  });
  assert.equal(JSON.stringify(info).includes('function'), false);
});

test('a declared api calls its steps in order and stops at a failure', async () => {
  const callList = [];
  const context = {
    apiExists: (id) => id !== 'missing/one',
    call: async (id, params) => {
      callList.push([id, params]);
      return id === 'edit/fail' ? { code: API_CODE_FAILED, message: 'refused' } : { code: API_CODE_OK, data: id, message: '' };
    },
  };
  const api = apiDeclaredDefine({ id: 'example/open', label: 'Open', runList: [{ api: 'nav/goTo', params: { target: 'a.md' } }, { api: 'edit/modeSet', params: { isOn: true } }] });
  const result = await api.run(context, {});
  assert.deepEqual(callList, [['nav/goTo', { target: 'a.md' }], ['edit/modeSet', { isOn: true }]]);
  assert.equal(result.data, 'edit/modeSet');
  assert.equal(apiAvailabilityGet(api, context).isAvailable, true);

  const apiFailing = apiDeclaredDefine({ id: 'example/fail', runList: [{ api: 'edit/fail' }, { api: 'nav/goTo' }] });
  callList.length = 0;
  assert.equal((await apiFailing.run(context, {})).code, API_CODE_FAILED);
  assert.equal(callList.length, 1);

  const apiMissing = apiDeclaredDefine({ id: 'example/missing', runList: [{ api: 'missing/one' }] });
  assert.deepEqual(apiAvailabilityGet(apiMissing, context), { isAvailable: false, reason: 'missing/one is not registered' });
});
