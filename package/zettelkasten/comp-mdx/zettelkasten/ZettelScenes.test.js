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

test('what a zettel holds in several groups: group by group, each framed inside the place', () => {
	const groupedModel = zettelModelBuild([
		{ key: 'root', kind: 'zettel', text: card({ level: 'root', title: 'Root', connectionList: [
			{ type: 'contain', group: 'First', form: 'array', itemList: ['a', 'b', 'c', 'd', 'e'] },
			{ type: 'contain', group: 'Second', form: 'array', itemList: ['f', 'g'] },
			{ type: 'contain', group: 'Third', form: 'list', itemList: ['h'] },
		] }) },
		...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((key) => ({ key, kind: 'zettel', text: card({ level: 'hub', parent: 'root', title: key.toUpperCase() }) })),
	]);
	// the second group follows the whole first one, whatever the indexes; what no group names comes last
	assert.deepEqual(groupedModel.containListByKey.get('root'), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
	const scene = zettelProviderBuild(groupedModel, { signature: 'x' }).sceneGet('/z/root');
	const { nodes } = scene.diagram;
	assert.deepEqual(overlapList(scene.diagram), []);
	const subFrameList = nodes.filter((node) => node.around && node.data.place === 'child-group');
	assert.deepEqual(subFrameList.map((node) => `${node.data.label} ${node.data.form} ${node.around.nodeIdList.length}`), ['First array 5', 'Second array 2', 'Third list 1', 'Other  1']);
	// the rect of a frame: its cards and its padding
	const rectOf = (frame) => {
		const memberList = frame.around.nodeIdList.map((id) => nodes.find((node) => node.id === id));
		const padding = frame.around.padding;
		const left = Math.min(...memberList.map((node) => node.position.x)) - padding.left;
		const top = Math.min(...memberList.map((node) => node.position.y)) - padding.top;
		const right = Math.max(...memberList.map((node) => node.position.x + node.size.width)) + padding.right;
		const bottom = Math.max(...memberList.map((node) => node.position.y + node.size.height)) + padding.bottom;
		return { left, top, right, bottom };
	};
	const outer = rectOf(nodes.find((node) => node.id === 'frame:h:root'));
	const rectList = subFrameList.map(rectOf);
	for (const rect of rectList) assert.ok(rect.left > outer.left && rect.top > outer.top && rect.right < outer.right && rect.bottom < outer.bottom, 'a group stands inside the frame of the place');
	for (let i = 1; i < rectList.length; i += 1) assert.ok(rectList[i].top > rectList[i - 1].bottom, 'each group below the one before');
	// the frame of the place is declared before its groups, so they are drawn over it
	assert.ok(nodes.findIndex((node) => node.id === 'frame:h:root') < nodes.findIndex((node) => node === subFrameList[0]));
});
