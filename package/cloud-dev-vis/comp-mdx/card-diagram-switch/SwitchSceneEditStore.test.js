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
