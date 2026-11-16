import test from 'node:test';
import assert from 'node:assert/strict';
import { zettelDocTextBuild } from './ZettelDoc.js';
import { zettelModelBuild } from './ZettelData.js';
import { zettelProviderBuild, zettelScenePathBuild, zettelScenePathRead } from './ZettelScenes.js';

const card = (meta, body = '') => zettelDocTextBuild(meta, body);
const model = zettelModelBuild([
	{ key: 'root', kind: 'zettel', text: card({ level: 'root', title: 'Root' }) },
	{ key: 'hub', kind: 'zettel', text: card({ level: 'hub', title: 'Hub', summary: 'An area.', connectionList: [{ group: 'Steps', form: 'array', itemList: ['b', 'c'] }, { to: 'e', label: 'see', isDirected: false }] }, '[A](a.md) and [B](b.md).') },
	{ key: 'd', kind: 'zettel', text: card({ title: 'D' }, 'Points at [the hub](hub.md).') },
	{ key: 'e', kind: 'zettel', text: card({ title: 'E' }) },
	{ key: 'a', kind: 'zettel', text: card({ parent: 'hub', title: 'A', summary: 'The first one, with a summary long enough to wrap onto a second line of the card.' }, 'Back to [the hub](hub.md).') },
	{ key: 'b', kind: 'zettel', text: card({ parent: 'hub', title: 'B' }, 'Needs [A](a.md).') },
	{ key: 'c', kind: 'zettel', text: card({ parent: ['hub', 'a'], title: 'C' }) },
	{ key: 'q001', kind: 'question', text: card({ number: 1, hub: 'hub', title: 'Which', answer: 'A', optionList: [{ id: 'A', text: 'a', zettelList: ['a'] }] }) },
]);

const overlapList = (diagram) => {
	const cardList = diagram.nodes.filter((node) => !node.around).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y, width: node.size.width, height: node.size.height }));
	const list = [];
	for (let i = 0; i < cardList.length; i += 1) for (let j = i + 1; j < cardList.length; j += 1) {
		const a = cardList[i];
		const b = cardList[j];
		if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) list.push(`${a.id} / ${b.id}`);
	}
	return list;
};

test('scene paths name a zettel, a view and the places shown', () => {
	assert.equal(zettelScenePathBuild('hub'), '/z/hub');
	assert.equal(zettelScenePathBuild('hub', 'link', 'fb'), '/z/hub/f-bf');
	assert.equal(zettelScenePathBuild('hub', 'flow'), '/z/hub/flow');
	assert.deepEqual([...zettelScenePathRead('/z/hub/f-bf').placeSet], ['b', 'f']);
	assert.equal(zettelScenePathRead('/z/hub').placeSet.size, 5);
	assert.equal(zettelScenePathRead('/x'), null);
});

test('the connection view: every place in a frame, nothing on top of anything', () => {
	const provider = zettelProviderBuild(model, { signature: 'x' });
	const scene = provider.sceneGet('/z/hub');
	const { nodes, connections } = scene.diagram;
	const placeList = nodes.filter((node) => node.around).map((node) => node.data.place).sort();
	assert.deepEqual(placeList, ['child', 'container', 'group', 'in', 'out'].sort());
	assert.deepEqual(overlapList(scene.diagram), []);
	const center = nodes.find((node) => node.id === 'z:hub');
	const container = nodes.find((node) => node.id === 'z:root');
	const child = nodes.find((node) => node.id === 'z:a');
	assert.ok(container.position.y + container.size.height < center.position.y, 'what holds it stands above');
	assert.ok(child.position.y > center.position.y + center.size.height, 'what it holds stands below');
	// the group is an array: its members carry their index
	const groupCardList = nodes.filter((node) => !node.around && node.data?.place === 'group');
	assert.deepEqual(groupCardList.map((node) => node.data.keyList.map((key) => key.text).join(' ')), ['0', '1']);
	// the link to the root without direction has no arrow, and its label
	const toRoot = connections.find((line) => line.label?.text === 'see');
	assert.equal(toRoot.markerEnd, 'none');
	assert.ok(scene.box.width > 0);
	// the questions it holds join what it holds, after a row break
	assert.ok(nodes.some((node) => node.id === 'z:q001' && node.data.place === 'child-question'));
});

test('a filter keeps only the places asked for', () => {
	const provider = zettelProviderBuild(model, { signature: 'x' });
	const scene = provider.sceneGet('/z/hub/f-b');
	assert.deepEqual(scene.diagram.nodes.filter((node) => node.around).map((node) => node.data.place), ['in']);
	assert.equal(provider.sceneGet('/z/hub/flow'), null);
	assert.equal(provider.linkOpen('zettel-open:a'), true);
});
