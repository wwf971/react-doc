import assert from 'node:assert/strict';
import test from 'node:test';
import { DocEditStore } from '../../../../main/frontend/src/store/DocEditStore.ts';
import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { dataverseEditModeList } from './DataverseEditStore.js';

function fixtureCreate() {
	const writes = [];
	const path = '/test.md';
	const raw = 'store: local\nobjectId: table';
	const markerText = '<!--renderComp=Card,title=Example-->';
	const nodeText = `\`\`\`asset\n${raw}\n\`\`\``;
	const block = { index: 0, kind: 'component', lineStart: 1, lineEnd: 5, text: `${markerText}\n${nodeText}`, component: { compName: 'Card', lang: 'asset', raw, nodeType: 'code', markerText, textBefore: '', textBetween: '\n', nodeText, props: { title: 'Example' } } };
	const store = Object.create(DocEditStore.prototype);
	store.sourceStore = { configDoc: { compRegistry: { Card: 'test/Card' } } };
	store.docStore = { compById: { 'test/Card': compDefine(() => null, { isAssetAware: true, expose: { meta: { isEditAssetAccepted: true }, editModeList: dataverseEditModeList } }) } };
	store.docEditByPath = { [path]: { model: { blockList: [block] } } };
	store.assetStore = { isWritable: true, objectUpdate: async (...args) => { writes.push({ target: 'asset', args }); return { code: 0 }; } };
	store.blockDependencyListGet = () => [];
	store.operationApply = async (path, operation, options) => { writes.push({ target: 'inline', operation }); options.onApplied(); return { code: 0 }; };
	store.session = { type: 'block', path, blockIndex: 0, editModeId: 'visual', textInitial: block.text, textDraft: block.text, status: 'editing', message: '' };
	const event = (type, data = {}) => store.eventHandle({ type, data, source: { sourcePath: path, blockIndex: 0, asset: { isFromAsset: true, store: 'local', objectId: 'table' } } });
	return { store, block, writes, event, path };
}

test('visual mode edits inline data, and a reference only at a writable head', () => {
	const { store, block, path } = fixtureCreate();
	const visual = () => store.blockEditModeListGet(path, 0).find(mode => mode.id === 'visual');
	assert.equal(visual().isDisabled, false);
	assert.equal(visual().isDefault, true);
	block.component.lang = 'yaml';
	assert.equal(visual().isDisabled, false);
	assert.equal(store.blockEditModeListGet(path, 0).find(mode => mode.id === 'source').isDisabled, false);
	block.component.lang = 'asset';
	store.assetStore.isWritable = false;
	store.assetStore.writeUnavailableReason = 'read-only snapshot';
	assert.equal(visual().isDisabled, true);
	assert.match(visual().disabledReason, /read-only/);
	store.assetStore.isWritable = true;
	block.component.raw += '\nversionId: old';
	assert.equal(visual().isDisabled, true);
});

test('a component without isEditAssetAccepted keeps only the source mode on a reference', () => {
	const { store, path } = fixtureCreate();
	store.docStore.compById['test/Card'] = compDefine(() => null, { isAssetAware: true, expose: { editModeList: dataverseEditModeList } });
	const modeList = store.blockEditModeListGet(path, 0);
	assert.equal(modeList.find(mode => mode.id === 'visual').isDisabled, true);
	assert.equal(modeList.find(mode => mode.id === 'source').isDefault, true);
});

test('typing drafts performs no writes and Cancel discards them', async () => {
	const { store, writes, event } = fixtureCreate();
	await event('editDraftChange', { raw: 'name: First', isDirty: true, saveTarget: 'asset' });
	await event('editDraftChange', { raw: 'name: Second', isDirty: true, saveTarget: 'asset' });
	assert.equal(writes.length, 0);
	await event('editCancelRequest');
	assert.equal(writes.length, 0);
	assert.equal(store.session, undefined);
});

test('normal exit saves once to the asset and failed saves retain the draft', async () => {
	const { store, writes, event } = fixtureCreate();
	await event('editDraftChange', { raw: 'name: Draft', isDirty: true, saveTarget: 'asset' });
	const update = store.assetStore.objectUpdate;
	store.assetStore.objectUpdate = async () => ({ code: -1, message: 'Conflict' });
	assert.equal(await store.sessionLeave(), false);
	assert.equal(store.session.status, 'error');
	assert.equal(store.session.assetDraft.raw, 'name: Draft');
	store.assetStore.objectUpdate = update;
	assert.equal(await store.sessionLeave(), true);
	assert.equal(writes.length, 1);
	assert.equal(writes[0].target, 'asset');
});

test('Save to inline replaces the reference with YAML and never writes the asset', async () => {
	const { store, writes, event } = fixtureCreate();
	const draft = { raw: 'version: 1\nnode: {}', isDirty: true, saveTarget: 'inline' };
	await event('editDraftChange', draft);
	assert.equal(writes.length, 0);
	assert.equal(store.session.assetDraft, undefined);
	assert.match(store.session.textDraft, /```yaml/);
	assert.match(store.session.textDraft, /title=Example/);
	await event('editSubmitRequest', draft);
	assert.equal(writes.length, 1);
	assert.equal(writes[0].target, 'inline');
});

test('reverted drafts leave without a write', async () => {
	const { store, writes, event } = fixtureCreate();
	await event('editDraftChange', { raw: 'changed', isDirty: true });
	await event('editDraftChange', { raw: 'original', isDirty: false });
	await store.sessionLeave();
	assert.equal(writes.length, 0);
});

test('switching the save target leaves one destination only', async () => {
	const { store, block, writes, event } = fixtureCreate();
	await event('editDraftChange', { raw: 'name: A', isDirty: true, saveTarget: 'inline' });
	await event('editDraftChange', { raw: 'name: A', isDirty: true, saveTarget: 'asset' });
	assert.equal(store.session.textDraft, block.text);
	assert.equal(store.session.assetDraft.raw, 'name: A');
	await event('editDraftChange', { raw: 'name: A', isDirty: true, saveTarget: 'inline' });
	assert.equal(store.session.assetDraft, undefined);
	await store.sessionLeave();
	assert.deepEqual(writes.map(write => write.target), ['inline']);
});

test('an editor reporting neither isDirty nor saveTarget saves to the asset', async () => {
	const { writes, event, store } = fixtureCreate();
	await event('editDraftChange', { raw: 'name: Older editor' });
	await store.sessionLeave();
	assert.deepEqual(writes.map(write => write.target), ['asset']);
});
