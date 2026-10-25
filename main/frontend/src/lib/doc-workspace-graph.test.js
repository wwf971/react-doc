import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceGraphBuild } from './doc-workspace-graph.js';

// the workspace tab's graph: one node per doc page, one edge per mention,
// conflicts marked
const workspace = {
  isVirtual: false,
  title: 'Site',
  docPageList: [
    { alias: 'guide', entryFile: 'guide/.doc-page/entry.yaml', dirPage: 'guide', title: 'Guide', isRoot: true, rootList: [], mentionList: [{ alias: 'guide', isAliasGiven: true, fromAlias: '', file: '', place: 'docPageList[0]' }] },
    { alias: 'extra', entryFile: 'sub/.doc-page/entry.yaml', dirPage: 'sub', title: '', isRoot: true, rootList: [], mentionList: [
      { alias: 'extra', isAliasGiven: true, fromAlias: '', file: '', place: 'docPageList[1]' },
      { alias: 'sub', isAliasGiven: false, fromAlias: 'guide', file: 'guide/.doc-page/entry.yaml', place: '"include" at sidePanelById.main.tree[1]' },
    ] },
    { alias: 'deep', entryFile: 'deep/.doc-page/entry.yaml', dirPage: 'deep', title: 'Deep', isRoot: false, rootList: [], mentionList: [{ alias: 'deep', isAliasGiven: true, fromAlias: 'extra', file: 'sub/.doc-page/entry.yaml', place: 'x' }] },
  ],
  includeList: [
    { fromAlias: '', toAlias: 'guide', alias: 'guide', isAliasGiven: true, file: '', place: 'docPageList[0]' },
    { fromAlias: '', toAlias: 'extra', alias: 'extra', isAliasGiven: true, file: '', place: 'docPageList[1]' },
    { fromAlias: 'guide', toAlias: 'extra', alias: 'sub', isAliasGiven: false, file: 'guide/.doc-page/entry.yaml', place: '"include" at sidePanelById.main.tree[1]' },
    { fromAlias: 'extra', toAlias: 'deep', alias: 'deep', isAliasGiven: true, file: 'sub/.doc-page/entry.yaml', place: 'x' },
  ],
  warningList: ['the doc page sub/.doc-page/entry.yaml is mentioned as "sub" ..., but is "extra" already'],
};

test('one node per doc page by depth, one edge per mention, the alias conflict marked', () => {
  const graph = workspaceGraphBuild(workspace);
  assert.deepEqual(graph.nodeList.map((node) => [node.id, node.type, node.position.y]), [
    ['workspace', 'workspace', 0], ['doc-page:guide', 'docPage', 204], ['doc-page:extra', 'docPage', 204], ['doc-page:deep', 'docPage', 354],
  ]);
  assert.equal(graph.nodeList[2].data.aliasConflictCount, 1);
  assert.equal(graph.nodeList[2].data.mentionCount, 2);
  assert.deepEqual(graph.edgeList.map((edge) => [edge.source, edge.target, edge.label, edge.data.isConflict]), [
    ['workspace', 'doc-page:guide', 'guide', false],
    ['workspace', 'doc-page:extra', 'extra', false],
    ['doc-page:guide', 'doc-page:extra', 'as sub', true],
    ['doc-page:extra', 'doc-page:deep', 'as deep', false],
  ]);
  assert.equal(graph.warningList.length, 1);
  assert.equal(graph.docPageCount, 3);
});

test('an empty or missing workspace gives the workspace node alone', () => {
  const graph = workspaceGraphBuild(undefined);
  assert.equal(graph.nodeList.length, 1);
  assert.equal(graph.edgeList.length, 0);
});
