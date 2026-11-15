// node --test package/app-config/comp-mdx/app-config/AppConfigData.test.js
// The cases of app-config-case.json are the contract (doc/README.md#the-cases): another
// implementation runs the same file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
	appConfigStack, appConfigValueSet, appConfigLayerWriteTarget, appConfigLayerParse, appConfigDeclareParse,
	appConfigValueCheck, appConfigValueFromText, appConfigLayerNameBuild, appConfigPartitionOrderBuild,
} from './AppConfigData.js';

const { caseList } = JSON.parse(fs.readFileSync(new URL('./app-config-case.json', import.meta.url), 'utf8'));

test('the case file has the cases the contract names', () => {
	assert.ok(caseList.length >= 10);
});

for (const one of caseList) {
	test(`case: ${one.name}`, () => {
		const answer = appConfigStack(one.input);
		assert.deepStrictEqual(answer.value, one.expect.value);
		assert.deepStrictEqual(answer.sourceByKey, one.expect.sourceByKey);
		assert.deepStrictEqual(answer.layerOrder, one.expect.layerOrder);
		assert.deepStrictEqual(answer.problemList.map(({ layer, key, kind }) => ({ layer, key, kind })), one.expect.problemList);
		for (const problem of answer.problemList) assert.ok(problem.message && problem.partition, 'every problem says why, and of which partition');
	});
}

test('the order of partitions', () => {
	assert.deepStrictEqual(appConfigPartitionOrderBuild({ partitionDeclaredList: ['shared', 'local'], partitionPresentList: ['x', 'local', 'b'] }), ['shared', 'local', 'b', 'x']);
	assert.deepStrictEqual(appConfigPartitionOrderBuild({ partitionOrder: ['local', 'local'], partitionDeclaredList: ['shared', 'local'], partitionPresentList: [] }), ['local', 'shared']);
});

test('a value set and removed: a new mapping, empty parents gone', () => {
	const before = { example: { isHidden: true }, view: { title: 'T' } };
	const set = appConfigValueSet(before, 'migPlan.rangeCount', 8);
	assert.deepStrictEqual(set, { example: { isHidden: true }, view: { title: 'T' }, migPlan: { rangeCount: 8 } });
	assert.deepStrictEqual(before, { example: { isHidden: true }, view: { title: 'T' } }, 'the old mapping is untouched');
	assert.deepStrictEqual(appConfigValueSet(set, 'example.isHidden', null), { view: { title: 'T' }, migPlan: { rangeCount: 8 } });
	assert.deepStrictEqual(appConfigValueSet({ a: 1 }, 'a.b', true), { a: { b: true } }, 'a leaf on the way becomes a mapping');
	assert.deepStrictEqual(appConfigValueSet(undefined, 'x', 'y'), { x: 'y' });
});

test('where a write goes: the top layer of the default partition', () => {
	const layerList = [
		{ key: 'shared.team', partition: 'shared' },
		{ key: 'local.main', partition: 'local' },
		{ key: 'local.more', partition: 'local', isDisabled: true },
	];
	assert.equal(appConfigLayerWriteTarget({ layerOrder: ['shared.team', 'local.main', 'local.more'], layerList, partitionDefault: 'local' }).key, 'local.main');
	assert.equal(appConfigLayerWriteTarget({ layerList: [layerList[0]], partitionDefault: 'local' }), null);
	assert.equal(appConfigLayerWriteTarget({ layerList, partitionDefault: 'shared' }).key, 'shared.team');
});

test('a layer parsed: every key as far as it can be', () => {
	assert.deepStrictEqual(appConfigLayerParse('label: Local\norder: 3\nvalue: { a: { b: 1 } }\n'), { label: 'Local', order: 3, isDisabled: false, value: { a: { b: 1 } }, message: '' });
	assert.deepStrictEqual(appConfigLayerParse({ order: 'x', isDisabled: 'yes', value: [1] }), { label: '', order: 0, isDisabled: false, value: {}, message: 'the value of a layer is a mapping' });
	assert.match(appConfigLayerParse('- 1\n- 2\n').message, /mapping/);
	assert.match(appConfigLayerParse('a: [').message, /not yaml/);
	assert.equal(appConfigLayerParse('').message, '', 'an empty text is an empty layer');
});

test('a declaration parsed: entries without a key or a known type are left out, and said', () => {
	const parsed = appConfigDeclareParse({ app: 'dmt', keyList: [{ key: 'a', type: 'boolean' }, { key: 'b', type: 'date' }, { type: 'string' }] });
	assert.equal(parsed.app, 'dmt');
	assert.deepStrictEqual(parsed.keyList.map((one) => one.key), ['a']);
	assert.match(parsed.message, /b, \?/);
});

test('values checked by type', () => {
	assert.equal(appConfigValueCheck({ type: 'boolean' }, 'true'), 'type');
	assert.equal(appConfigValueCheck({ type: 'number', min: 1 }, 0), 'range');
	assert.equal(appConfigValueCheck({ type: 'number' }, Number.NaN), 'type');
	assert.equal(appConfigValueCheck({ type: 'enum', valueList: ['a'] }, { a: 1 }), 'type');
	assert.equal(appConfigValueCheck({ type: 'string-list' }, []), '');
	assert.equal(appConfigValueCheck({ type: 'date' }, '2026'), 'type');
});

test('a text typed into a cell, read as a value', () => {
	assert.deepStrictEqual(appConfigValueFromText({ type: 'number', max: 10 }, ' 4 '), { value: 4 });
	assert.ok(appConfigValueFromText({ type: 'number', max: 10 }, '40').message);
	assert.ok(appConfigValueFromText({ type: 'number' }, '').message);
	assert.deepStrictEqual(appConfigValueFromText({ type: 'string-list' }, 'a, b\nc'), { value: ['a', 'b', 'c'] });
	assert.deepStrictEqual(appConfigValueFromText({ type: 'enum', valueList: ['auto', 'dark'] }, 'dark'), { value: 'dark' });
	assert.deepStrictEqual(appConfigValueFromText({ type: 'string' }, ' kept as typed '), { value: ' kept as typed ' });
	assert.equal(appConfigLayerNameBuild('Team defaults!'), 'team-defaults');
	assert.equal(appConfigLayerNameBuild('  '), 'layer');
});
