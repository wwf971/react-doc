import assert from 'node:assert/strict';
import test from 'node:test';
import { yamlParse, yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';
import { SwitchSceneEditStore } from './SwitchSceneEditStore.js';

const source = `version: 1
# the defaults of every scene
defaults:
  connection: { renderer: { type: smoothstep } }
sceneList:
  - path: /a
    label: A
    diagram:
      nodes:
        - { id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, data: { title: N } }
  - path: /b
    label: B
    viewList:
      - id: one
        diagram: { nodes: [] }
      - id: two   # the second view
        diagram: { nodes: [] }
`;

test('a block of scenes is edited one diagram at a time, written back in place', () => {
	const store = new SwitchSceneEditStore(source);
	assert.deepEqual(store.targetList.map((target) => target.key), ['/a', '/b@one', '/b@two']);
	// the editor reads a diagram with the defaults of the document
	const text = store.textOf(store.target);
	assert.equal(yamlParse(text).version, 1);
	assert.equal(yamlParse(text).defaults.connection.renderer.type, 'smoothstep');
	assert.equal(store.isDirty, false);
	// a draft of /a and one of /b@two: both written, the rest as it was, comments included
	const draftA = yamlParse(text);
	draftA.nodes[0].position = { x: 40, y: 20 };
	store.draftSet('/a', yamlStringify(draftA));
	store.targetSet('/b@two');
	store.draftSet('/b@two', yamlStringify({ version: 1, defaults: yamlParse(source).defaults, nodes: [{ id: 'm', renderer: { type: 'card-note' }, data: { title: 'M' } }] }));
	const written = yamlParse(store.sourceDraft);
	assert.deepEqual(written.sceneList[0].diagram.nodes[0].position, { x: 40, y: 20 });
	assert.equal(written.sceneList[0].diagram.version, undefined);
	assert.equal(written.sceneList[0].diagram.defaults, undefined, 'the defaults of the document are not copied into a scene');
	assert.equal(written.sceneList[1].viewList[1].diagram.nodes[0].id, 'm');
	assert.deepEqual(written.sceneList[1].viewList[0].diagram, { nodes: [] });
	assert.match(store.sourceDraft, /# the defaults of every scene/);
	assert.match(store.sourceDraft, /# the second view/);
	assert.equal(store.isDirty, true);
	assert.equal(store.reportOf({ saveTarget: 'inline' }).raw, store.sourceDraft);
});

test('a block it cannot edit says why', () => {
	assert.match(new SwitchSceneEditStore('version: 2').message, /version: 1/);
});

test('a block of scenes offers the feature layers it names to every scene edited, and places their groups', async () => {
	const { diagramNormalize, diagramPlacesGet } = await import('../card-diagram/DiagramERData.js');
	const { cardDiagramNodeRegistry } = await import('../card-diagram/card-diagram-node-registry.js');
	const { switchRegistryBuild } = await import('./SwitchNodeKinds.jsx');
	const { switchDocNormalize } = await import('./SwitchData.js');
	const withFeature = `version: 1
featureList: [parametric-canvas]
sceneList:
  - path: /a
    diagram:
      nodes:
        - { id: n, renderer: { type: card-note }, size: { width: 100, height: 40 }, data: { title: N } }
        - { id: m, renderer: { type: shape }, size: { width: 60, height: 40 }, data: { shape: ellipse } }
      parametric:
        groupList:
          - id: g
            root: { x: 10, y: 20 }
            memberList:
              - { id: a, node: n }
              - { id: b, node: m, parent: a, constraint: { type: beside, side: right, gap: 30 } }
`;
	const store = new SwitchSceneEditStore(withFeature);
	assert.deepEqual(store.featureList, ['parametric-canvas']);
	assert.deepEqual(new SwitchSceneEditStore(source).featureList, []);
	assert.throws(() => switchDocNormalize(withFeature.replace('[parametric-canvas]', 'parametric-canvas')), /featureList is a list/);
	// the scene is read with the registry of the switch layer, which keeps the features of its own
	const registry = switchRegistryBuild(cardDiagramNodeRegistry);
	const graph = diagramNormalize(yamlParse(store.textOf(store.target)), registry);
	const places = diagramPlacesGet(graph.nodes, graph.layout, {});
	assert.deepEqual(places.positions.get('m'), { x: 140, y: 20 });
});

const blockSource = `version: 1
title: The shop
sceneList:
  - path: /overview
    label: Overview
    diagram:
      nodes:
        - { id: d, renderer: { type: scene-embed }, data: { scene: /overview/detail, view: cards } }
        - { id: go, renderer: { type: scene-link }, link: /overview/detail@matrix, data: { title: Go } }
  - path: /overview/detail
    label: Detail
    viewDefault: cards
    viewList:
      - id: cards
        diagram: { nodes: [] }
      - id: matrix   # the matrix view
        diagram: { nodes: [] }
  - path: /archive/old
    label: Old
    diagram:
      nodes:
        - { id: back, renderer: { type: scene-link }, link: /overview, data: { title: Back } }
`;

test('a block as a tree: the block, its scenes by path, views under their scene, folders for paths without a scene', async () => {
	const { switchSceneTreeIndexBuild, switchSceneTreeModelBuild, switchSceneRefIndexBuild } = await import('./SwitchSceneEditTree.js');
	const value = yamlParse(blockSource);
	const model = switchSceneTreeModelBuild(switchSceneTreeIndexBuild(value));
	const walk = (key, depth = 0) => [`${'  '.repeat(depth)}${key}`, ...model.childKeyListGet(key).flatMap(child => walk(child, depth + 1))];
	assert.deepEqual(walk('block'), ['block', '  scene:/overview', '    scene:/overview/detail', '      view:/overview/detail@cards', '      view:/overview/detail@matrix', '  folder:/archive', '    scene:/archive/old']);
	assert.equal(model.itemGet('view:/overview/detail@cards').summary, 'default');
	assert.equal(model.parentKeyGet('scene:/archive/old'), 'folder:/archive');
	assert.equal(model.itemGet('block').summary, '3 scenes');
	const { inByPath } = switchSceneRefIndexBuild(value);
	assert.deepEqual(inByPath.get('/overview/detail').map(ref => `${ref.kind}:${ref.fromPath}${ref.suffix}`), ['embed:/overview', 'link:/overview@matrix']);
});

test('the commands of the block: a scene made, moved with every reference, views made and renamed; each one step', () => {
	const store = new SwitchSceneEditStore(blockSource);
	const reportList = [];
	store.onReport = () => reportList.push(store.sourceDraft);
	// a new scene below another: made at once, focused, on the canvas
	assert.equal(store.sceneCreate('/overview'), '/overview/scene-1');
	assert.equal(store.focusKey, 'scene:/overview/scene-1');
	assert.equal(store.targetKey, '/overview/scene-1');
	assert.equal(yamlParse(store.sourceBase).sceneList[2].path, '/overview/scene-1', 'after what stands below its parent');
	// moved: what is below follows, every reference too, the comments stay
	const tokenBefore = store.editToken;
	assert.equal(store.scenePathSet('/overview', '/home'), '/home');
	const moved = yamlParse(store.sourceBase);
	assert.deepEqual(moved.sceneList.map(scene => scene.path), ['/home', '/home/detail', '/home/scene-1', '/archive/old']);
	assert.equal(moved.sceneList[0].diagram.nodes[0].data.scene, '/home/detail');
	assert.equal(moved.sceneList[0].diagram.nodes[1].link, '/home/detail@matrix');
	assert.equal(moved.sceneList[3].diagram.nodes[0].link, '/home');
	assert.match(store.sourceBase, /# the matrix view/);
	assert.equal(store.targetKey, '/home/scene-1', 'the scene on the canvas moved with it');
	assert.equal(store.editToken, tokenBefore, 'its diagram is the same: the editor stays open');
	assert.equal(store.scenePathSet('/home/detail', '/archive/old'), null);
	assert.match(store.message, /is a scene already/);
	// a view renamed: the default, the references and the embedded scene asking for it follow
	store.viewIdSet('/home/detail', 'cards', 'grid');
	const renamed = yamlParse(store.sourceBase);
	assert.equal(renamed.sceneList[1].viewDefault, 'grid');
	assert.equal(renamed.sceneList[0].diagram.nodes[0].data.view, 'grid');
	// a scene of one diagram becomes a scene of views with its first new view
	assert.equal(store.viewAdd('/archive/old'), 'view-1');
	const views = yamlParse(store.sourceBase).sceneList[3];
	assert.deepEqual(views.viewList.map(view => view.id), ['main', 'view-1']);
	assert.equal(views.diagram, undefined);
	assert.equal(store.targetKey, '/archive/old@view-1');
	assert.equal(store.viewRemove('/archive/old', 'view-1') !== null, true);
	assert.equal(store.viewRemove('/archive/old', 'main'), null, 'the last view stays');
	assert.equal(store.viewListCollapse('/archive/old') !== null, true);
	assert.ok(yamlParse(store.sourceBase).sceneList[3].diagram);
	assert.equal(store.history.length, 6, 'the two refused are no steps');
	assert.ok(reportList.length >= 6, 'the page is told the document after every command');
	// undone step by step back to the start
	while (store.undo());
	assert.equal(store.sourceBase, blockSource);
});

test('what the canvas changed becomes one step of the block, before a command or another scene; an undo puts the document back', () => {
	const store = new SwitchSceneEditStore(blockSource);
	const draft = yamlParse(store.textOf(store.target));
	draft.nodes.push({ id: 'new', renderer: { type: 'card-note' }, data: { title: 'New' } });
	store.draftSet('/overview', yamlStringify(draft));
	assert.equal(store.value.sceneList[0].diagram.nodes.length, 3, 'the tree and the relations read the draft');
	assert.equal(store.isUndoAvailable, true);
	store.sceneSet('/archive/old', 'label', 'Very old');
	assert.deepEqual(store.history.past.map(entry => entry.stateBefore.label), ['Drawing in /overview', '/archive/old: label']);
	assert.equal(store.draftByKey.size, 0);
	const tokenBefore = store.editToken;
	store.undo();
	assert.equal(store.editToken, tokenBefore, 'the diagram on the canvas did not change: the editor stays');
	store.undo();
	assert.equal(store.editToken, tokenBefore + 1, 'the drawing undone: the editor opens again on the diagram as it was');
	assert.equal(store.sourceBase, blockSource);
	store.redo();
	assert.equal(yamlParse(store.sourceBase).sceneList[0].diagram.nodes.length, 3);
	// a removed scene: its focus goes to what is above it; what names it stays
	store.focusSet('scene:/overview/detail');
	store.sceneRemove('/overview/detail');
	assert.equal(store.focusKey, 'scene:/overview');
	assert.equal(yamlParse(store.sourceBase).sceneList[0].diagram.nodes[0].data.scene, '/overview/detail');
});
