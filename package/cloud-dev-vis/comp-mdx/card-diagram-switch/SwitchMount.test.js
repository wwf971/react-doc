import assert from 'node:assert/strict';
import test from 'node:test';
import { switchDocNormalize, switchProviderFromDoc } from './SwitchData.js';
import { switchMountPathFromSource, switchMountPathToSource, switchMountProviderBuild, switchProviderCompose, SWITCH_MOUNT_OUTSIDE } from './SwitchMount.js';
import { switchPathPrefixMove, switchRefListGet, switchRefMap } from './SwitchRef.js';

const host = `version: 1
sceneList:
  - path: /overview
    label: Overview
    diagram:
      nodes:
        - { id: shop, renderer: { type: scene-embed }, data: { scene: /shop/overview@cards } }
        - { id: go, renderer: { type: scene-link }, link: /shop/overview/db, data: { title: Go } }
mountList:
  - path: /shop
    label: Shop
    from: { asset: { store: local, name: shop scenes } }
`;

const held = `version: 1
defaults:
  connection: { renderer: { type: smoothstep } }
sceneList:
  - path: /overview
    label: Shop overview
    diagram:
      nodes:
        - { id: db, renderer: { type: scene-link }, link: /overview/db#keys, data: { title: Storage } }
        - { id: away, renderer: { type: scene-link }, link: /elsewhere, data: { title: Away } }
      connections:
        - { id: l, source: { nodeId: db }, target: { nodeId: away }, link: /overview/db }
  - path: /overview/db
    label: Storage
    diagram: { nodes: [] }
  - path: /elsewhere
    diagram: { nodes: [] }
`;

test('the references of a diagram: links, embedded scenes, stack items, a link deep in the data', () => {
	const diagram = {
		nodes: [
			{ id: 'a', renderer: { type: 'scene-embed' }, link: '/x', data: { scene: '/y@v' } },
			{ id: 's', renderer: { type: 'scene-stack' }, data: { focusPath: '/f', itemList: [{ id: 'i', scene: '/z', link: '/w#i' }] } },
			{ id: 'm', renderer: { type: 'card-matrix' }, data: { cellList: [{ row: 'r', column: 'c', link: '/cell' }, { link: 'command:make' }] } },
		],
		connections: [{ id: 'c', link: '/line' }],
	};
	const list = switchRefListGet(diagram);
	assert.deepEqual(list.map(ref => `${ref.kind}:${ref.path}${ref.suffix}`).sort(), ['alias:/f', 'embed:/y@v', 'link:/cell', 'link:/line', 'link:/w#i', 'link:/x', 'stack:/z'].sort());
	const moved = switchRefMap(diagram, (ref, { path, suffix }) => `${switchPathPrefixMove(path, '/y', '/yy') ?? path}${suffix}`);
	assert.equal(moved.nodes[0].data.scene, '/yy@v');
	assert.equal(moved.nodes[1], diagram.nodes[1], 'what does not change keeps its identity');
	assert.equal(switchRefMap(diagram, ref => ref), diagram);
	assert.equal(switchPathPrefixMove('/a/b/c', '/a/b', '/q'), '/q/c');
	assert.equal(switchPathPrefixMove('/a/bc', '/a/b', '/q'), null);
});

test('a document mounts the scenes of another source under a path; what overlaps is refused', () => {
	const spec = switchDocNormalize(host);
	assert.deepEqual(spec.mountList.map(mount => [mount.path, mount.sourcePath, mount.from.asset.name]), [['/shop', '/', 'shop scenes']]);
	assert.throws(() => switchDocNormalize(host.replace('  - path: /overview\n    label: Overview', '  - path: /shop/x\n    label: X')), /stands in the mount \/shop/);
	assert.throws(() => switchDocNormalize(`${host}  - path: /shop/inner\n    from: { asset: { store: local, name: other } }\n`), /overlap/);
	assert.throws(() => switchDocNormalize(host.replace('name: shop scenes', 'name: a, itemId: b')), /one of them/);
	assert.equal(switchDocNormalize(host.replace('mountList:', 'root: /shop/overview\nmountList:')).root, '/shop/overview', 'the first scene may be a mounted one');
	assert.equal(switchDocNormalize(host.replace(/mountList:[\s\S]*$/, '')).mountList.length, 0, 'a document without mounts is read as before');
});

test('the paths of a mount are translated both ways, a part of the source mounted alone too', () => {
	const mount = { path: '/shop', sourcePath: '/' };
	assert.equal(switchMountPathToSource(mount, '/shop/overview/db'), '/overview/db');
	assert.equal(switchMountPathFromSource(mount, '/overview'), '/shop/overview');
	const part = { path: '/shop', sourcePath: '/overview' };
	assert.equal(switchMountPathToSource(part, '/shop'), '/overview');
	assert.equal(switchMountPathFromSource(part, '/overview/db'), '/shop/db');
	assert.equal(switchMountPathFromSource(part, '/elsewhere'), null);
});

test('the viewport asks one provider: own scenes, and mounted scenes with their references translated', () => {
	const spec = switchDocNormalize(host);
	const own = switchProviderFromDoc(spec);
	const mounted = switchMountProviderBuild(spec.mountList[0], held);
	assert.equal(mounted.message, '');
	const provider = switchProviderCompose({ own, mountList: [{ mount: spec.mountList[0], provider: mounted.provider }], signature: 'x' });
	assert.equal(provider.sceneGet('/overview').label, 'Overview');
	const shop = provider.sceneGet('/shop/overview');
	assert.equal(shop.path, '/shop/overview');
	assert.equal(shop.label, 'Shop overview');
	assert.equal(shop.mount.sourcePath, '/overview');
	assert.equal(shop.diagram.defaults.connection.renderer.type, 'smoothstep', 'the source keeps its defaults');
	assert.equal(shop.diagram.nodes[0].link, '/shop/overview/db#keys');
	assert.equal(shop.diagram.nodes[1].link, '/shop/elsewhere');
	assert.equal(shop.diagram.connections[0].link, '/shop/overview/db');
	assert.equal(provider.sceneGet('/shop'), null, 'the mount path is a folder: the source has no scene at /');
	assert.equal(provider.labelGet('/shop'), 'Shop');
	assert.deepEqual(provider.childListGet('/shop').map(child => child.path), ['/shop/overview', '/shop/elsewhere']);
	assert.deepEqual(provider.childListGet('/shop/overview').map(child => child.path), ['/shop/overview/db']);
	assert.deepEqual(provider.childListGet('').map(child => child.path), ['/overview', '/shop'], 'the mount is a child of the top level');
	assert.equal(provider.mountOf('/shop/overview/db').sourcePath, '/overview/db');
	// a part of the source: what lies outside names nothing, and says where it pointed
	const part = { ...spec.mountList[0], sourcePath: '/overview' };
	const partProvider = switchProviderCompose({ own, mountList: [{ mount: part, provider: mounted.provider }] });
	assert.equal(partProvider.sceneGet('/shop').label, 'Shop overview');
	assert.equal(partProvider.sceneGet('/shop').diagram.nodes[1].link, `/shop/${SWITCH_MOUNT_OUTSIDE}/elsewhere`);
});

test('a mount that cannot be read is a scene at its path saying why; a box in a mounted scene is not written', async () => {
	const spec = switchDocNormalize(host);
	const own = switchProviderFromDoc(spec, { onBoxSave: async () => ({ code: 0 }) });
	const failed = switchMountProviderBuild(spec.mountList[0], 'version: 2');
	assert.match(failed.message, /cannot be read: A switch document needs version: 1/);
	const provider = switchProviderCompose({ own, mountList: [{ mount: spec.mountList[0], message: failed.message }] });
	const note = provider.sceneGet('/shop');
	assert.match(note.diagram.nodes[0].data.text, /cannot be read/);
	assert.equal(provider.sceneGet('/shop/overview'), null);
	const mounted = switchMountProviderBuild(spec.mountList[0], held);
	const read = switchProviderCompose({ own, mountList: [{ mount: spec.mountList[0], provider: mounted.provider }] });
	assert.equal((await read.boxSave('/shop/overview', { x: 0, y: 0, width: 1, height: 1 })).code, -1);
	assert.equal((await read.boxSave('/overview', { x: 0, y: 0, width: 1, height: 1 })).code, 0);
});

test('a mount may read one diagram: a document of that one scene at the root of its source, labelled by the mount', () => {
	const viewport = switchDocNormalize(`version: 1
sceneList:
  - path: /overview
    diagram: { nodes: [{ id: go, renderer: { type: scene-link }, link: /flow, data: { title: Flow } }] }
mountList:
  - path: /flow
    label: Order flow
    from: { asset: { store: local, itemId: w5j7pmxa7fw, versionId: w5j7pmy0gul } }
`);
	const mount = viewport.mountList[0];
	assert.equal(mount.from.asset.versionId, 'w5j7pmy0gul');
	const diagram = `version: 1
defaults:
  connection: { renderer: { type: smoothstep } }
nodes:
  - { id: a, renderer: { type: card-note }, data: { title: A }, link: / }
connections: []
`;
	const mounted = switchMountProviderBuild(mount, diagram);
	assert.equal(mounted.message, '');
	const provider = switchProviderCompose({ own: switchProviderFromDoc(viewport), mountList: [{ mount, provider: mounted.provider }] });
	const scene = provider.sceneGet('/flow');
	assert.equal(scene.label, 'Order flow');
	assert.equal(scene.diagram.nodes[0].data.title, 'A');
	assert.equal(scene.diagram.version, undefined);
	// a reference inside it names its root, which the mount shows at its own path
	assert.equal(scene.diagram.nodes[0].link, '/flow');
	assert.deepEqual(provider.childListGet('/overview').map(one => one.path), []);
	// what is neither a document of scenes nor a diagram is refused as before
	assert.match(switchMountProviderBuild(mount, 'nodes: 3').message, /cannot be read/);
});
