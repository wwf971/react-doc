import test from 'node:test';
import assert from 'node:assert/strict';
import { zettelDocLinkListRead, zettelDocMetaSet, zettelDocParse, zettelDocSectionListRead, zettelDocTextBuild } from './ZettelDoc.js';
import {
	zettelBacklinkListOf, zettelChainOf, zettelContainCycleFind, zettelContainCycleText, zettelContainerListOf, zettelGroupListOf, zettelKnowledgeChildListOf, zettelLabelRead, zettelModelBuild,
	zettelQuestionRefListOf, zettelRoleBuild, zettelSearch,
} from './ZettelData.js';
import { zettelConnectionAddMeta, zettelConnectionRemoveMeta } from './ZettelConnect.js';

const card = (meta, body) => zettelDocTextBuild(meta, body);
const itemList = [
	{ key: 'map', kind: 'zettel', text: card({ level: 'root', title: 'Map' }, 'See [RAG](rag.md).') },
	{ key: 'rag', kind: 'zettel', text: card({ level: 'hub', title: 'RAG' }, '## Topics\n\n[Chunking](rag-chunking.md#semantic)') },
	{ key: 'rag-chunking', kind: 'zettel', text: card({ level: 'topic', parent: 'rag', title: 'Chunking', questionList: [{ ref: 'q001', option: 'B', text: 'why' }] }, '<!--renderComp=Anchor,id=semantic-->\n\n## Semantic chunking\n\nSplits at meaning.') },
	{ key: 'q001', kind: 'question', text: card({ number: 1, hub: 'rag', title: 'Long documents', answer: 'B', optionList: [{ id: 'A', text: 'a', verdict: 'wrong' }, { id: 'B', text: 'b', verdict: 'correct', zettelList: ['rag-chunking'] }] }, '<!--renderComp=Anchor,id=option-a-->\n\n### Option A\n\nNot [chunking](rag-chunking.md).') },
	{ key: 'note-1', kind: 'note', text: card({ target: 'rag-chunking', place: 'semantic', timeCreate: '20261110_10000000+09' }, 'remember') },
];

test('a zettel is a frontmatter and a body', () => {
	const { meta, body } = zettelDocParse(itemList[2].text);
	assert.equal(meta.title, 'Chunking');
	assert.deepEqual(zettelDocSectionListRead(body).map((section) => [section.id, section.title]), [['semantic', 'Semantic chunking']]);
	assert.equal(zettelDocParse(zettelDocMetaSet(itemList[2].text, { title: 'X', parent: null })).meta.parent, undefined);
	assert.deepEqual(zettelDocLinkListRead('[a](rag.md) [b](https://x.y/z.md) [c](../q001.md?nav=page#option-b)').map((link) => [link.key, link.place]), [['rag', ''], ['q001', 'option-b']]);
});

test('the model: containment, links both ways, questions by option', () => {
	const model = zettelModelBuild(itemList);
	assert.equal(model.rootKey, 'map');
	assert.deepEqual(zettelChainOf(model, 'rag-chunking').map((zettel) => zettel.key), ['map', 'rag', 'rag-chunking']);
	assert.deepEqual(zettelContainerListOf(model, 'q001').map((zettel) => zettel.key), ['rag']);
	assert.deepEqual(zettelBacklinkListOf(model, 'rag-chunking').map((entry) => entry.zettel.key), ['rag']);
	const refList = zettelQuestionRefListOf(model, 'rag-chunking');
	assert.deepEqual(refList.map((entry) => [entry.question.key, entry.optionList.map((option) => option.id).join('')]), [['q001', 'AB']]);
	assert.deepEqual(zettelGroupListOf(model, 'q001').map((group) => [group.id, group.form, group.itemList.map((item) => `${item.key}:${item.to}`).join(',')]), [['option', 'map', 'B:rag-chunking']]);
	assert.equal(model.noteListByTarget.get('rag-chunking').length, 1);
	assert.deepEqual(model.problemList, []);
	assert.equal(zettelSearch(model, 'q1')[0].zettel.key, 'q001');
});

test('containment: several containers, never a cycle', () => {
	const model = zettelModelBuild([
		{ key: 'root', kind: 'zettel', text: card({ level: 'root', title: 'Root' }, '') },
		{ key: 'a', kind: 'zettel', text: card({ title: 'A', connectionList: [{ type: 'contain', to: 'c' }] }, '') },
		{ key: 'b', kind: 'zettel', text: card({ title: 'B', parent: 'c' }, '') },
		// c is held by a (written on a) and by b (its own parent): b is held by c, so b holding c is a cycle
		{ key: 'c', kind: 'zettel', text: card({ title: 'C', parent: ['b'] }, '') },
		{ key: 'd', kind: 'zettel', text: card({ title: 'D', parent: ['a', 'root'] }, '') },
	]);
	assert.deepEqual(zettelContainerListOf(model, 'c').map((zettel) => zettel.key), ['a']);
	assert.ok(model.problemList.some((problem) => problem.includes('cycle')), model.problemList.join('\n'));
	assert.deepEqual(zettelContainerListOf(model, 'd').map((zettel) => zettel.key), ['a', 'root']);
	assert.deepEqual(zettelKnowledgeChildListOf(model, 'root').map((zettel) => zettel.key), ['a', 'd']);
	// what a write asks first
	assert.deepEqual(zettelContainCycleFind(model, 'b', 'a'), ['a', 'c', 'b']);
	assert.deepEqual(zettelContainCycleFind(model, 'a', 'a'), ['a']);
	assert.deepEqual(zettelContainCycleFind(model, 'a', 'b'), []);
	assert.deepEqual(zettelContainCycleFind(model, 'd', 'root'), ['root', 'd']);
	assert.match(zettelContainCycleText(model, 'b', 'a'), /already contains/);
});

test('an ordered group of what a zettel holds orders it, even where parent writes it too', () => {
	const model = zettelModelBuild([
		{ key: 'root', kind: 'zettel', text: card({ level: 'root', title: 'Root', connectionList: [{ type: 'contain', group: 'Areas', form: 'array', itemList: ['c', 'a', 'b'] }] }, '') },
		{ key: 'a', kind: 'zettel', text: card({ title: 'A', parent: 'root' }, '') },
		{ key: 'b', kind: 'zettel', text: card({ title: 'B', parent: 'root' }, '') },
		{ key: 'c', kind: 'zettel', text: card({ title: 'C', parent: 'root' }, '') },
	]);
	assert.deepEqual(zettelKnowledgeChildListOf(model, 'root').map((zettel) => zettel.key), ['c', 'a', 'b']);
	assert.deepEqual(zettelRoleBuild(model, 'root').childList.map((entry) => entry.connection.group.key), ['0', '1', '2']);
});

test('links: labels, without direction, groups as lists, arrays and maps', () => {
	assert.deepEqual(zettelLabelRead('needs'), { kind: 'text', text: 'needs', key: '', ref: '' });
	assert.equal(zettelLabelRead({ zettel: 'x.md' }).key, 'x');
	assert.equal(zettelLabelRead({ object: 'frontend:abc' }).ref, 'frontend:abc');
	const model = zettelModelBuild([
		{ key: 'root', kind: 'zettel', text: card({ level: 'root', title: 'Root' }, '') },
		{ key: 'a', kind: 'zettel', text: card({ title: 'A', connectionList: [
			{ to: 'b', label: 'explains' },
			{ to: 'c', isDirected: false, label: { zettel: 'b' } },
			{ group: 'Steps', form: 'array', itemList: [{ to: 'b' }, { to: 'c' }] },
			{ group: 'By role', form: 'map', itemList: [{ key: 'reader', to: 'c' }] },
			{ group: 'See also', itemList: ['b'] },
		] }, '') },
		{ key: 'b', kind: 'zettel', text: card({ title: 'B' }, '') },
		{ key: 'c', kind: 'zettel', text: card({ title: 'C' }, '') },
	]);
	assert.deepEqual(model.problemList, []);
	const groupList = zettelGroupListOf(model, 'a');
	assert.deepEqual(groupList.map((group) => [group.id, group.form, group.itemList.map((item) => `${item.key}:${item.to}`).join(',')]), [['steps', 'array', '0:b,1:c'], ['by-role', 'map', 'reader:c'], ['see-also', 'list', ':b']]);
	const role = zettelRoleBuild(model, 'a');
	assert.deepEqual(role.containerList.map((entry) => entry.zettel.key), ['root']);
	// b and c are members of a group: drawn there, not again as forward links
	assert.deepEqual(role.outList.map((entry) => entry.zettel.key), []);
	assert.equal(role.groupList.length, 3);
	const roleC = zettelRoleBuild(model, 'c');
	const linkFromA = roleC.inList.find((entry) => entry.zettel.key === 'a').linkList;
	assert.ok(linkFromA.some((link) => link.isDirected === false && link.label.kind === 'zettel'));
});

test('writing a connection into the frontmatter, and taking it out', () => {
	const text = card({ title: 'A', parent: 'root' }, 'Body.');
	const added = zettelConnectionAddMeta(text, { type: 'link', to: 'b', label: 'needs', isDirected: false });
	assert.deepEqual(zettelDocParse(added).meta.connectionList, [{ to: 'b', isDirected: false, label: 'needs' }]);
	assert.match(added, /Body\./);
	const contained = zettelConnectionAddMeta(added, { type: 'containedBy', to: 'hub' });
	assert.deepEqual(zettelDocParse(contained).meta.parent, ['root', 'hub']);
	const removed = zettelConnectionRemoveMeta(contained, { type: 'containedBy', to: 'root' });
	assert.equal(zettelDocParse(removed).meta.parent, 'hub');
	const removedLink = zettelConnectionRemoveMeta(removed, { type: 'link', to: 'b' });
	assert.equal(zettelDocParse(removedLink).meta.connectionList, undefined);
});
