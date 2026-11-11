import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramArrangeApply } from './DiagramArrange.js';
import { routeOverlapListGet, routePathPolylineGet, routeResolve } from './DiagramRoute.js';
import { diagramNormalize } from './DiagramERData.js';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';
import { diagramArrangerOutline, diagramGeometryEstimateBuild } from './DiagramArrangeOutline.js';

const registry = cardDiagramNodeRegistry;
const iconOf = (id, handleList, data = {}) => ({ id, renderer: { type: 'card-icon' }, position: { x: 0, y: 0 }, size: { width: 200, height: data.isFocus ? 36 : 30 }, data: { title: id, ...data }, handles: handleList.map(([handleId, direction, side]) => ({ id: handleId, direction, anchor: { target: 'icon', side } })) });
const lineOf = (id, source, target) => ({ id, source: { nodeId: source[0], handleId: source[1] }, target: { nodeId: target[0], handleId: target[1] } });

// two above (a chain), the one, three below and two related on its trunk: what a side panel
// draws of a resource
function graphBuild() {
	const nodes = [
		iconOf('a1', [['down', 'out', 'bottom']]),
		iconOf('a2', [['up', 'in', 'top'], ['down', 'out', 'bottom']]),
		iconOf('focus', [['in', 'in', 'left'], ['down', 'out', 'bottom']], { isFocus: true }),
		iconOf('b1', [['in', 'in', 'left']]),
		iconOf('b2', [['in', 'in', 'left']]),
		iconOf('b3', [['in', 'in', 'left']]),
		iconOf('r1', [['in', 'in', 'left']]),
		iconOf('r2', [['in', 'in', 'left']]),
	];
	const connections = [
		lineOf('a1-a2', ['a1', 'down'], ['a2', 'up']), lineOf('a2-focus', ['a2', 'down'], ['focus', 'in']),
		lineOf('focus-b1', ['focus', 'down'], ['b1', 'in']), lineOf('focus-b2', ['focus', 'down'], ['b2', 'in']), lineOf('focus-b3', ['focus', 'down'], ['b3', 'in']),
		lineOf('focus-r1', ['focus', 'down'], ['r1', 'in']), lineOf('focus-r2', ['focus', 'down'], ['r2', 'in']),
	];
	const levelById = { focus: 1, b1: 2, b2: 2, b3: 2, r1: 2, r2: 2 };
	return diagramArrangeApply({ version: 1, nodes, connections }, diagramArrangerOutline, { registry, origin: { x: 40, y: 0 }, levelById, gapBeforeById: { r1: 20 } });
}

function lineListOf(diagram) {
	const geometry = diagramGeometryEstimateBuild(diagram, { registry });
	return diagram.connections.map((connection) => {
		const a = geometry.endOf(connection, 'source');
		const b = geometry.endOf(connection, 'target');
		const ends = { sourceX: a.x, sourceY: a.y, sourcePosition: a.side, targetX: b.x, targetY: b.y, targetPosition: b.side };
		return { id: connection.id, d: routeResolve('step', connection.route ?? null, ends).d, sourceKey: `${connection.source.nodeId}/${connection.source.handleId}`, targetKey: `${connection.target.nodeId}/${connection.target.handleId}` };
	});
}

test('the outline stands the nodes one under another, indented by level, groups set apart', () => {
	const { diagram, reportList } = graphBuild();
	assert.deepEqual(reportList, []);
	const positionOf = (id) => diagram.nodes.find((node) => node.id === id).position;
	assert.deepEqual(positionOf('a1'), { x: 40, y: 0 });
	assert.deepEqual(positionOf('a2'), { x: 40, y: 38 });
	assert.deepEqual(positionOf('focus'), { x: 62, y: 76 });
	assert.deepEqual(positionOf('b1'), { x: 84, y: 120 });
	assert.equal(positionOf('r1').x, 84);
	assert.equal(positionOf('r1').y - positionOf('b3').y, 30 + 8 + 20);
	// the result is a diagram of the format
	assert.equal(diagramNormalize(diagram, registry).nodes.length, 8);
});

test('the lines of the outline are straight stretches, and share only the trunk of their handle', () => {
	const { diagram } = graphBuild();
	const lineList = lineListOf(diagram);
	for (const line of lineList) {
		const pointList = routePathPolylineGet(line.d);
		for (let index = 1; index < pointList.length; index += 1) {
			const isStraight = Math.abs(pointList[index].x - pointList[index - 1].x) < 0.01 || Math.abs(pointList[index].y - pointList[index - 1].y) < 0.01;
			assert.ok(isStraight, `${line.id} has a slanted stretch`);
		}
	}
	// a line into the mark of a row below turns once, under the mark of the one
	const down = routePathPolylineGet(lineList.find((line) => line.id === 'focus-b2').d);
	assert.equal(down[0].x, 62 + 16);
	assert.equal(down[down.length - 1].x, 84);
	// the chain above is straight down, then turns into the one
	assert.equal(routePathPolylineGet(lineList.find((line) => line.id === 'a1-a2').d).every((point) => point.x === 53), true);
	assert.deepEqual(routeOverlapListGet(lineList), []);
});

test('lines between handles on one side take a lane each, the shorter nearer the rows', () => {
	const nodes = [iconOf('a', [['out', 'out', 'left']]), iconOf('b', [['out', 'out', 'left']]), iconOf('c', [['in', 'in', 'left']]), iconOf('d', [['in', 'in', 'left']])];
	const connections = [lineOf('a-d', ['a', 'out'], ['d', 'in']), lineOf('b-c', ['b', 'out'], ['c', 'in'])];
	const { diagram } = diagramArrangeApply({ version: 1, nodes, connections }, diagramArrangerOutline, { registry });
	const lineList = lineListOf(diagram);
	const xOf = (id) => Math.min(...routePathPolylineGet(lineList.find((line) => line.id === id).d).map((point) => point.x));
	assert.equal(xOf('b-c'), -10);
	assert.equal(xOf('a-d'), -20);
	assert.deepEqual(routeOverlapListGet(lineList), []);
	// lines of one handle nest, each in its lane
	const shared = diagramArrangeApply({ version: 1, nodes, connections: [lineOf('a-c', ['a', 'out'], ['c', 'in']), lineOf('a-d', ['a', 'out'], ['d', 'in'])] }, diagramArrangerOutline, { registry });
	assert.deepEqual(routeOverlapListGet(lineListOf(shared.diagram)), []);
});

test('the outline says what it does not route', () => {
	const nodes = [iconOf('a', [['out', 'out', 'right']]), iconOf('b', [['in', 'in', 'left']])];
	const { reportList } = diagramArrangeApply({ version: 1, nodes, connections: [lineOf('a-b', ['a', 'out'], ['b', 'in'])] }, diagramArrangerOutline, { registry });
	assert.equal(reportList.length, 1);
	assert.equal(reportList[0].kind, 'skipped');
});
