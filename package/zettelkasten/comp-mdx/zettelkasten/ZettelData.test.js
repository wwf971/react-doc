import test from 'node:test';
import assert from 'node:assert/strict';
import { zettelDocLinkListRead, zettelDocMetaSet, zettelDocParse, zettelDocSectionListRead, zettelDocTextBuild } from './ZettelDoc.js';
import { zettelBacklinkListOf, zettelModelBuild, zettelPathOf, zettelPathRead, zettelQuestionRefListOf, zettelSearch } from './ZettelData.js';

const card = (meta, body) => zettelDocTextBuild(meta, body);
const itemList = [
	{ key: 'map', kind: 'zettel', text: card({ level: 'root', title: 'Map' }, 'See [RAG](rag.md).') },
	{ key: 'rag', kind: 'zettel', text: card({ level: 'hub', title: 'RAG' }, '## Topics\n\n[Chunking](rag-chunking.md#semantic)') },
	{ key: 'rag-chunking', kind: 'zettel', text: card({ level: 'topic', parent: 'rag', title: 'Chunking', questionList: [{ ref: 'q001', option: 'B', text: 'why' }] }, '<!--renderComp=Anchor,id=semantic-->\n\n## Semantic chunking\n\nSplits at meaning.') },
	{ key: 'q001', kind: 'question', text: card({ number: 1, hub: 'rag', title: 'Long documents', answer: 'B', optionList: [{ id: 'A', text: 'a', verdict: 'wrong' }, { id: 'B', text: 'b', verdict: 'correct', zettelList: ['rag-chunking'] }] }, '<!--renderComp=Anchor,id=option-a-->\n\n### Option A\n\nNot [chunking](rag-chunking.md).') },
	{ key: 'note-1', kind: 'note', text: card({ target: 'rag-chunking', place: 'semantic', timeCreate: '20261110_10000000+09' }, 'remember') },
];

test('a card is a frontmatter and a body', () => {
	const { meta, body } = zettelDocParse(itemList[2].text);
	assert.equal(meta.title, 'Chunking');
	assert.deepEqual(zettelDocSectionListRead(body).map((section) => [section.id, section.title]), [['semantic', 'Semantic chunking']]);
	assert.equal(zettelDocParse(zettelDocMetaSet(itemList[2].text, { title: 'X', parent: null })).meta.parent, undefined);
	assert.deepEqual(zettelDocLinkListRead('[a](rag.md) [b](https://x.y/z.md) [c](../q001.md?nav=page#option-b)').map((link) => [link.key, link.place]), [['rag', ''], ['q001', 'option-b']]);
});

test('the model: hierarchy, paths, links both ways, questions by option', () => {
	const model = zettelModelBuild(itemList);
	assert.equal(model.rootKey, 'map');
	assert.equal(zettelPathOf(model, 'rag-chunking'), '/map/rag/rag-chunking');
	assert.equal(zettelPathOf(model, 'q001'), '/map/rag/question/q001');
	assert.deepEqual(zettelPathRead(model, '/map/rag/question'), { key: 'rag', isQuestionList: true });
	assert.deepEqual(zettelBacklinkListOf(model, 'rag-chunking').map((entry) => entry.zettel.key), ['rag']);
	const refList = zettelQuestionRefListOf(model, 'rag-chunking');
	assert.deepEqual(refList.map((entry) => [entry.question.key, entry.optionList.map((option) => option.id).join('')]), [['q001', 'AB']]);
	assert.equal(model.noteListByTarget.get('rag-chunking').length, 1);
	assert.deepEqual(model.problemList, []);
	assert.equal(zettelSearch(model, 'q1')[0].zettel.key, 'q001');
});
