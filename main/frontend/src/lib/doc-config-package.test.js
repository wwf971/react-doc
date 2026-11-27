import assert from 'node:assert/strict';
import test from 'node:test';
import { compConfigDefineByCompIdBuild, configOwnerMapOf, configOwnerPathOf, configPackageIdOf, configPackageNameOf, configPackageGroupByNameBuild } from './doc-config-define.js';
import { configDeclaredCheck, configModelBuild } from './doc-config-model.js';

// doc_page_impl_config.md#package-level-config: a package's preferences, declared once by the package
// and carried by the components that read them, resolved per document as a component's keys are
const oaGroup = Object.freeze({
	name: 'oa',
	label: 'oa',
	configDefineList: [
		{ key: 'TimeClock', type: 'enum', valueList: ['24h', '12h'], valueDefault: '24h' },
		{ key: 'TimeWeekStart', type: 'enum', valueList: ['monday', 'sunday'], valueDefault: 'monday' },
	],
});
const compById = {
	'oa/MeetingZoomReservation': { expose: { meta: { configPackage: oaGroup } } },
	'oa/TimetableWeek': { expose: { meta: { configPackage: oaGroup, configDefineList: [{ key: 'HourHeight', type: 'number', valueDefault: 3 }] } } },
};

test('the group of a package is kept once under its owner id, beside the keys of the components', () => {
	const defineByOwner = compConfigDefineByCompIdBuild(compById);
	assert.deepEqual([...defineByOwner.keys()].sort(), ['oa/TimetableWeek', 'package:oa']);
	assert.equal(defineByOwner.get('package:oa').get('TimeClock').scope, 'doc');
	assert.equal(configPackageIdOf('oa'), 'package:oa');
	assert.equal(configPackageNameOf('package:oa'), 'oa');
	assert.equal(configPackageNameOf('oa/TimetableWeek'), '');
	assert.equal(configPackageGroupByNameBuild(compById).get('oa'), oaGroup);
});

test('a second group of the same package name that is another object is passed over', () => {
	const other = { name: 'oa', configDefineList: [{ key: 'Other', type: 'string', valueDefault: '' }] };
	const warnList = [];
	const warn = console.warn;
	console.warn = (text) => warnList.push(text);
	try {
		const defineByOwner = compConfigDefineByCompIdBuild({ ...compById, 'x/Comp': { expose: { meta: { configPackage: other } } } });
		assert.equal(defineByOwner.get('package:oa').has('Other'), false);
		assert.equal(warnList.length, 1);
	} finally {
		console.warn = warn;
	}
});

test('packageConfig is read at every level: a layer, then a document over it', () => {
	const compConfigDefineByCompId = compConfigDefineByCompIdBuild(compById);
	const configDeclaredLayer = { packageConfig: { oa: { TimeClock: '12h' } } };
	const model = configModelBuild({
		configDefineByKey: new Map(),
		configDoc: {},
		layerList: [{ id: 'docPage:example', config: {}, compConfig: configOwnerMapOf(configDeclaredLayer), isCompKeyedById: false, isAboveDocLevels: false }],
		fileManifest: [
			{ internalPath: '~a/plan.md', configFrontmatter: { packageConfig: { oa: { TimeWeekStart: 'sunday' } } } },
			{ internalPath: '~a/other.md' },
		],
		compConfigDefineByCompId,
		compIdResolve: (name) => `oa/${name}`,
	});
	assert.deepEqual(model.compConfigGlobalByCompId.get('package:oa').valueByKey, { TimeClock: '12h', TimeWeekStart: 'monday' });
	assert.deepEqual(model.compConfigByDocPath.get('~a/plan.md').get('package:oa').valueByKey, { TimeClock: '12h', TimeWeekStart: 'sunday' });
	assert.equal(model.compConfigByDocPath.get('~a/plan.md').get('package:oa').levelByKey.TimeWeekStart, 'doc');
	assert.deepEqual(model.compConfigByDocPath.get('~a/other.md').get('package:oa').valueByKey, { TimeClock: '12h', TimeWeekStart: 'monday' });
});

test('a package value is written at its own path, and is no page key of a declaration', () => {
	assert.deepEqual(configOwnerPathOf('package:oa'), ['packageConfig', 'oa']);
	assert.deepEqual(configOwnerPathOf('Image'), ['compConfig', 'Image']);
	assert.deepEqual(configOwnerMapOf({ compConfig: { Image: { A: 1 } }, packageConfig: { oa: { TimeClock: '12h' } } }), { Image: { A: 1 }, 'package:oa': { TimeClock: '12h' } });
	assert.deepEqual(configDeclaredCheck({ packageConfig: { oa: {} }, compConfig: {} }, { defineByKey: new Map() }), []);
});
