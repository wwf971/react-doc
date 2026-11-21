import assert from 'node:assert/strict';
import test from 'node:test';
import { compDefine } from '../../../comp-doc/registry/comp-registry.js';
import { editTemplateListBuild, editTemplateSearch } from '../../../comp-doc/edit/edit-template.js';

// the order of the insert menu (doc_page_impl_edit.md#the-order-of-the-insert-menu):
// the ranked entries of a group first, by rank, the others in the group's
// own order; the search keeps every ranked match before the unranked ones.

const compCreate = (name, label, description = '') => compDefine(function Comp() { return null; }, {
  expose: { meta: { label, description }, sourceDefaultCreate: () => ({ text: `<${name} />` }) },
});

const compById = {
  'test/ListHierarchy': compCreate('ListHierarchy', 'Hierarchy list', 'Groups at any depth.'),
  'test/Alpha': compCreate('Alpha', 'Alpha', 'A list of letters.'),
  'test/Zeta': compCreate('Zeta', 'Zeta'),
  'test/Image': compCreate('Image', 'Image'),
};
const configDoc = { compRegistry: { ListHierarchy: 'test/ListHierarchy', Alpha: 'test/Alpha', Zeta: 'test/Zeta', Image: 'test/Image' } };

const listBuild = (rankByEntry) => editTemplateListBuild({
  configDoc, compById, docPath: '~a/doc.md', docFormat: 'md', compConfigGet: () => ({}), rankByEntry,
});

test('every entry is named {group}:{name}', () => {
  const idList = listBuild({}).map((template) => template.id);
  assert.ok(idList.includes('text:paragraph'));
  assert.ok(idList.includes('text:list'));
  assert.ok(idList.includes('component:Alpha'));
});

test('without ranks each group keeps its own order', () => {
  const templateList = listBuild({});
  assert.deepEqual(templateList.filter((one) => one.group === 'text').map((one) => one.id).slice(0, 3), ['text:paragraph', 'text:heading', 'text:list']);
  assert.deepEqual(templateList.filter((one) => one.group === 'component').map((one) => one.compName), ['Alpha', 'Image', 'ListHierarchy', 'Zeta']);
  assert.ok(templateList.every((one) => one.rank === ''));
});

test('ranked entries come first in their group, in rank order', () => {
  const templateList = listBuild({ 'component:Zeta': 'c', 'component:Image': 'b', 'text:list': '5', 'text:quote': 'C' });
  assert.deepEqual(templateList.filter((one) => one.group === 'component').map((one) => one.compName), ['Image', 'Zeta', 'Alpha', 'ListHierarchy']);
  const textIdList = templateList.filter((one) => one.group === 'text').map((one) => one.id);
  assert.equal(textIdList[0], 'text:list');
  assert.equal(textIdList[1], 'text:paragraph', 'the unranked in their order');
  assert.equal(templateList.find((one) => one.id === 'text:quote').rank, '', 'a value that is not a rank is no rank');
});

test('a search lists ranked matches first, the others by where they match', () => {
  const nameList = (rankByEntry, query) => editTemplateSearch(listBuild(rankByEntry), query).map((result) => result.name);
  // unranked: matches in the name before matches in the description, by name
  assert.deepEqual(nameList({}, 'list'), ['List', 'ListHierarchy', 'Alpha']);
  // ranked: Alpha, matched in its description only, before every unranked match
  assert.deepEqual(nameList({ 'component:Alpha': 'a', 'text:list': 'g' }, 'list'), ['Alpha', 'List', 'ListHierarchy']);
  assert.deepEqual(nameList({ 'text:list': 'g' }, 'list'), ['List', 'ListHierarchy', 'Alpha']);
});
