import { diagramArrangeApply } from '../../../cloud-dev-vis/comp-mdx/card-diagram/DiagramArrange.js';
import { zettelArrangerFlow, zettelCardHeightEstimate } from './ZettelArrange.js';
import {
	ZETTEL_QUESTION_SEGMENT, zettelBacklinkListOf, zettelCountOf, zettelGet, zettelHubOf, zettelKnowledgeChildListOf, zettelLabelOf, zettelLinkOutListOf, zettelPathOf, zettelPathRead,
	zettelProgressOf, zettelQuestionChildListOf, zettelQuestionIsDoubtful, zettelQuestionRefListOf,
} from './ZettelData.js';
import { zettelTextClip } from './ZettelDoc.js';

// The scenes of a zettelkasten (doc/README.md#the-map): every card is a scene of the
// switching viewport of the package cloud-dev-vis (card-diagram-flexible-switch.md), its
// path the keys from the root down, so the path bar is the hierarchy and a click on a card
// of a scene opens the scene of that card. Generated from the model; nothing is placed by hand.
//
//   /map                          the root          views: flow (when written), link
//   /map/{hub}/{topic}/{fact}     a knowledge card  views: flow (when written), link
//   /map/{hub}/question           the questions below a card, as pills
//   /map/{hub}/question/{qNNN}    a question: its options, and the cards each option is about
//
//   view flow   the process the card describes: its steps in ranks (ZettelArrange.js), a step
//               naming a card opens it
//   view link   the card among its neighbours: its parent above, the cards pointing at it on
//               the left, the cards it points at on the right, what lies below it and the
//               questions using it underneath, each a frame
//
// a card keeps one node id (z:{key}) in every scene showing it, so a switch between two
// scenes moves the cards they share instead of replacing them.

export const ZETTEL_TONE_LIST = ['blue', 'teal', 'violet', 'amber', 'green', 'red', 'slate'];
export const ZETTEL_LABEL_DEFAULT = {
	viewFlow: 'Flow', viewLink: 'Links', questionList: 'Questions', frameBelow: 'Inside this card', frameQuestion: 'Questions using this card', frameAlso: 'Also needed',
	linkIn: 'pointed at by', linkOut: 'points at', levelRoot: 'map', levelHub: 'area', levelTopic: 'topic', levelFact: 'fact', more: 'more', option: 'Option', correct: 'correct', wrong: 'wrong',
	countCard: 'cards', countQuestion: 'questions', disputed: 'answer disputed', doubtful: 'check the answer',
};

const WIDTH_CENTER = 330;
const WIDTH_SIDE = 236;
const WIDTH_STEP = 204;
const GAP_COLUMN = 120;
const GAP_ROW = 18;
const GRID_GAP_X = 22;
const SIDE_MAX = 6;
const FRAME_PADDING = { top: 46, right: 20, bottom: 20, left: 20 };
const PROGRESS_TONE = { right: 'green', wrong: 'red', review: 'amber' };

const nodeIdOf = (key) => `z:${key}`;
const handleListBuild = () => [{ id: 'in', direction: 'in', anchor: { side: 'left' } }, { id: 'out', direction: 'out', anchor: { side: 'right' } }, { id: 'top', direction: 'in', anchor: { side: 'top' } }, { id: 'bottom', direction: 'out', anchor: { side: 'bottom' } }];
const diagramFinish = (diagram) => ({ defaults: { connection: { renderer: { type: 'bezier' }, markerEnd: 'arrowClosed' } }, ...diagram });

// what a generator of scenes needs beside the model: the words, the tone of each hub, which
// questions show their answer
function contextBuild(model, { labels = {}, revealKeySet = null } = {}) {
	const toneByHub = new Map();
	zettelKnowledgeChildListOf(model, model.rootKey).forEach((hub, index) => toneByHub.set(hub.key, ZETTEL_TONE_LIST[index % (ZETTEL_TONE_LIST.length - 1)]));
	const toneOf = (zettel) => {
		if (!zettel) return 'slate';
		if (zettel.kind === 'question') return PROGRESS_TONE[zettelProgressOf(model, zettel.key)] ?? 'slate';
		if (zettel.key === model.rootKey) return 'slate';
		return toneByHub.get(zettelHubOf(model, zettel.key)?.key) ?? 'slate';
	};
	return { model, labels: { ...ZETTEL_LABEL_DEFAULT, ...labels }, toneOf, isRevealed: (key) => !revealKeySet || revealKeySet.has(key) };
}

const levelLabelOf = (context, zettel) => context.labels[{ root: 'levelRoot', hub: 'levelHub', topic: 'levelTopic', fact: 'levelFact' }[zettel.level]] ?? '';

// a knowledge card as a node: its title, its summary cut to a few lines, its level
function zettelNodeBuild(context, zettel, { x, y, width = WIDTH_SIDE, isCenter = false, isLinked = true }) {
	const { model } = context;
	if (zettel.kind === 'question') return questionNodeBuild(context, zettel, { x, y, width });
	const count = zettelCountOf(model, zettel.key);
	const metaList = isCenter ? [
		...(count.zettel ? [{ value: String(count.zettel), label: context.labels.countCard }] : []),
		...(count.question ? [{ value: String(count.question), label: context.labels.countQuestion }] : []),
	] : [];
	return {
		id: nodeIdOf(zettel.key),
		renderer: { type: 'card-note' },
		position: { x, y },
		size: { width, height: 'auto' },
		...(isLinked ? { link: zettelPathOf(model, zettel.key) } : {}),
		data: { title: zettel.title, tag: levelLabelOf(context, zettel), text: isCenter ? zettel.summary : zettelTextClip(zettel.summary, 96), tone: context.toneOf(zettel), ...(metaList.length ? { metaList } : {}) },
		handles: handleListBuild(),
	};
}

// a question as a pill: its number and title, toned by how the reader did on it
function questionNodeBuild(context, question, { x, y, width = WIDTH_SIDE }) {
	const { model, labels } = context;
	const statList = [];
	if (zettelQuestionIsDoubtful(question) && context.isRevealed(question.key)) statList.push(labels.doubtful);
	return {
		id: nodeIdOf(question.key),
		renderer: { type: 'card-brief' },
		position: { x, y },
		size: { width, height: 'auto' },
		link: zettelPathOf(model, question.key),
		data: { title: `Q${question.number} · ${question.title}`, icon: 'list-checks', tone: context.toneOf(question), statList },
		handles: handleListBuild(),
	};
}

const frameBuild = (id, nodeIdList, text, tone = 'slate', icon = 'layers') => ({
	id, renderer: { type: 'color-block' }, around: { nodeIdList, padding: FRAME_PADDING }, data: { tone, fill: 'none', labelSide: 'top', itemList: [{ id: 'label', icon, text }] }, handles: [],
});

const lineBuild = (id, sourceId, sourceHandle, targetId, targetHandle, labelText = '') => ({
	id, source: { nodeId: sourceId, handleId: sourceHandle }, target: { nodeId: targetId, handleId: targetHandle }, ...(labelText ? { label: { text: labelText } } : {}),
});

// cards in a grid of columnCount columns, each row as tall as its tallest card. answers the bottom
function gridPlace(nodeList, { x, y, width, columnCount, gapX = GRID_GAP_X, gapY = GAP_ROW }) {
	let top = y;
	for (let start = 0; start < nodeList.length; start += columnCount) {
		const row = nodeList.slice(start, start + columnCount);
		row.forEach((node, index) => { node.position = { x: x + index * (width + gapX), y: top }; });
		top += Math.max(...row.map(zettelCardHeightEstimate)) + gapY;
	}
	return nodeList.length > 0 ? top - gapY : y;
}

// a column of cards one under another; answers the bottom
function columnPlace(nodeList, { x, y, gapY = GAP_ROW }) {
	let top = y;
	for (const node of nodeList) {
		node.position = { x, y: top };
		top += zettelCardHeightEstimate(node) + gapY;
	}
	return nodeList.length > 0 ? top - gapY : y;
}

// the view "link" of a knowledge card
function sceneLinkBuild(context, zettel) {
	const { model, labels } = context;
	const nodes = [];
	const connections = [];
	const usedSet = new Set([zettel.key]);
	const parent = zettel.parentKey ? zettelGet(model, zettel.parentKey) : null;
	const childList = zettelKnowledgeChildListOf(model, zettel.key);
	const questionRefList = zettelQuestionRefListOf(model, zettel.key);
	const questionSet = new Map(questionRefList.map((entry) => [entry.question.key, entry.question]));
	for (const question of zettelQuestionChildListOf(model, zettel.key)) questionSet.set(question.key, question);
	if (parent) usedSet.add(parent.key);
	for (const child of childList) usedSet.add(child.key);
	const neighbourOf = (list) => list.map((entry) => entry.zettel).filter((one) => one.kind === 'zettel' && !usedSet.has(one.key));
	const linkInList = neighbourOf(zettelBacklinkListOf(model, zettel.key));
	const linkInKeySet = new Set(linkInList.map((one) => one.key));
	// a card pointing both ways is drawn once, on the side it points from
	const linkOutList = neighbourOf(zettelLinkOutListOf(model, zettel.key)).filter((one) => !linkInKeySet.has(one.key));
	const xCenter = WIDTH_SIDE + GAP_COLUMN;
	const xRight = xCenter + WIDTH_CENTER + GAP_COLUMN;
	let yCenter = 0;
	if (parent) {
		const parentNode = zettelNodeBuild(context, parent, { x: xCenter + (WIDTH_CENTER - WIDTH_SIDE) / 2, y: 0 });
		nodes.push(parentNode);
		yCenter = zettelCardHeightEstimate(parentNode) + 64;
	}
	const center = zettelNodeBuild(context, zettel, { x: xCenter, y: yCenter, width: WIDTH_CENTER, isCenter: true, isLinked: false });
	nodes.push(center);
	if (parent) connections.push(lineBuild(`up:${zettel.key}`, nodeIdOf(parent.key), 'bottom', center.id, 'top'));
	const sideBuild = (list, x, isIn) => {
		const shown = list.slice(0, SIDE_MAX);
		const nodeList = shown.map((one) => zettelNodeBuild(context, one, { x, y: 0 }));
		if (list.length > shown.length) nodeList.push({ id: `more:${isIn ? 'in' : 'out'}:${zettel.key}`, renderer: { type: 'card-three-dots' }, position: { x, y: 0 }, size: { width: WIDTH_SIDE, height: 'auto' }, data: { direction: 'vertical', text: `${list.length - shown.length} ${labels.more}` }, handles: [] });
		const bottom = columnPlace(nodeList, { x, y: yCenter });
		shown.forEach((one) => connections.push(isIn
			? lineBuild(`in:${one.key}`, nodeIdOf(one.key), 'out', center.id, 'in')
			: lineBuild(`out:${one.key}`, center.id, 'out', nodeIdOf(one.key), 'in')));
		nodes.push(...nodeList);
		return bottom;
	};
	const bottomIn = sideBuild(linkInList, 0, true);
	const bottomOut = sideBuild(linkOutList, xRight, false);
	let top = Math.max(yCenter + zettelCardHeightEstimate(center), bottomIn, bottomOut) + 40 + FRAME_PADDING.top;
	const widthAll = xRight + WIDTH_SIDE;
	const columnCount = 3;
	const xGrid = (widthAll - (columnCount * WIDTH_SIDE + (columnCount - 1) * GRID_GAP_X)) / 2;
	if (childList.length > 0) {
		// a card with cards of its own below it is drawn as its scene, small: a click zooms into it
		const childNodeList = childList.map((child) => {
			const isContainer = zettel.key === model.rootKey && zettelKnowledgeChildListOf(model, child.key).length > 0;
			if (!isContainer) return zettelNodeBuild(context, child, { x: 0, y: 0 });
			const count = zettelCountOf(model, child.key);
			return {
				id: `embed:${child.key}`, renderer: { type: 'scene-embed' }, position: { x: 0, y: 0 }, size: { width: WIDTH_SIDE, height: 190 },
				data: { scene: zettelPathOf(model, child.key), title: child.title, icon: 'layers', tone: context.toneOf(child), statList: [`${count.zettel} ${labels.countCard}`, `${count.question} ${labels.countQuestion}`], viewHover: false },
				handles: handleListBuild(),
			};
		});
		const bottom = gridPlace(childNodeList, { x: xGrid, y: top, width: WIDTH_SIDE, columnCount });
		nodes.push(...childNodeList, frameBuild(`frame:below:${zettel.key}`, childNodeList.map((node) => node.id), labels.frameBelow, context.toneOf(zettel)));
		top = bottom + FRAME_PADDING.bottom + 34 + FRAME_PADDING.top;
	}
	if (questionSet.size > 0) {
		const questionNodeList = [...questionSet.values()].sort((a, b) => a.number - b.number).map((question) => questionNodeBuild(context, question, { x: 0, y: 0 }));
		gridPlace(questionNodeList, { x: xGrid, y: top, width: WIDTH_SIDE, columnCount });
		nodes.push(...questionNodeList, frameBuild(`frame:question:${zettel.key}`, questionNodeList.map((node) => node.id), labels.frameQuestion, 'slate', 'list-checks'));
	}
	return diagramFinish({ nodes, connections });
}

// the view "flow" of a knowledge card: the steps it writes, laid out by the arranger
function sceneFlowBuild(context, zettel) {
	const { model } = context;
	const flow = zettel.flow;
	const idByStep = new Map();
	const idUsedSet = new Set();
	for (const step of flow.stepList) {
		const target = step.zettel ? zettelGet(model, step.zettel) : null;
		const idWanted = target ? nodeIdOf(target.key) : `step:${zettel.key}:${step.id}`;
		const id = idUsedSet.has(idWanted) ? `step:${zettel.key}:${step.id}` : idWanted;
		idUsedSet.add(id);
		idByStep.set(step.id, id);
	}
	const nodes = flow.stepList.map((step) => {
		const target = step.zettel ? zettelGet(model, step.zettel) : null;
		const isSelf = target?.key === zettel.key;
		return {
			id: idByStep.get(step.id),
			renderer: { type: 'card-note' },
			position: { x: 0, y: 0 },
			size: { width: WIDTH_STEP, height: 'auto' },
			...(target && !isSelf ? { link: zettelPathOf(model, target.key) } : {}),
			data: { title: step.title, text: step.text, tone: ZETTEL_TONE_LIST.includes(step.tone) ? step.tone : target ? context.toneOf(target) : 'slate' },
			handles: [],
		};
	});
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const connections = flow.edgeList.map((edge, index) => {
		const id = `flow:${zettel.key}:${index}`;
		const sourceId = idByStep.get(edge.from);
		const targetId = idByStep.get(edge.to);
		nodeById.get(sourceId).handles.push({ id: `out:${index}`, direction: 'out', anchor: { side: 'right' } });
		nodeById.get(targetId).handles.push({ id: `in:${index}`, direction: 'in', anchor: { side: 'left' } });
		return lineBuild(id, sourceId, `out:${index}`, targetId, `in:${index}`, edge.label);
	});
	const { diagram } = diagramArrangeApply({ nodes, connections }, zettelArrangerFlow, { ranksPerBand: 3, gapX: 70 });
	return diagramFinish(diagram);
}

// the questions below a card, as pills in a grid
function sceneQuestionListBuild(context, zettel) {
	const questionNodeList = zettelQuestionChildListOf(context.model, zettel.key).map((question) => questionNodeBuild(context, question, { x: 0, y: 0, width: 300 }));
	gridPlace(questionNodeList, { x: 0, y: 0, width: 300, columnCount: 3, gapY: 14 });
	return diagramFinish({ nodes: questionNodeList, connections: [] });
}

// a question: the question, its options one under another, and the knowledge cards each
// option is about, joined by lines. the options are toned by their verdict once the answer is shown
function sceneQuestionBuild(context, question) {
	const { model, labels } = context;
	const isRevealed = context.isRevealed(question.key);
	const widthQuestion = 280;
	const widthOption = 300;
	const xOption = widthQuestion + GAP_COLUMN;
	const xZettel = xOption + widthOption + GAP_COLUMN + 30;
	const optionNodeList = question.optionList.map((option) => ({
		id: `option:${question.key}:${option.id}`,
		renderer: { type: 'card-note' },
		position: { x: xOption, y: 0 },
		size: { width: widthOption, height: 'auto' },
		data: { title: `${labels.option} ${option.id}`, tag: isRevealed ? (option.isCorrect ? labels.correct : labels.wrong) : '', isTagHard: isRevealed && !option.isCorrect, text: zettelTextClip(option.text, 150), tone: isRevealed ? (option.isCorrect ? 'green' : 'red') : 'slate' },
		handles: handleListBuild(),
	}));
	const bottomOption = columnPlace(optionNodeList, { x: xOption, y: 0, gapY: 22 });
	const questionNode = {
		id: nodeIdOf(question.key), renderer: { type: 'card-note' }, position: { x: 0, y: 0 }, size: { width: widthQuestion, height: 'auto' },
		data: { title: `Q${question.number} · ${question.title}`, text: zettelTextClip(question.summary || question.stem, 260), tone: context.toneOf(question) },
		handles: handleListBuild(),
	};
	questionNode.position.y = Math.max(0, (bottomOption - zettelCardHeightEstimate(questionNode)) / 2);
	const connections = optionNodeList.map((node, index) => lineBuild(`ask:${question.key}:${index}`, questionNode.id, 'out', node.id, 'in'));
	// the cards on the right, in the order of the first option naming them
	const optionIndexByKey = new Map();
	question.optionList.forEach((option, index) => {
		for (const key of option.zettelList) {
			if (!zettelGet(model, key) || zettelGet(model, key).kind !== 'zettel') continue;
			if (!optionIndexByKey.has(key)) optionIndexByKey.set(key, []);
			optionIndexByKey.get(key).push(index);
		}
	});
	const meanOf = (key) => optionIndexByKey.get(key).reduce((sum, index) => sum + index, 0) / optionIndexByKey.get(key).length;
	const zettelKeyList = [...optionIndexByKey.keys()].sort((a, b) => meanOf(a) - meanOf(b));
	const zettelNodeList = zettelKeyList.map((key) => zettelNodeBuild(context, zettelGet(model, key), { x: xZettel, y: 0 }));
	const alsoKeyList = question.zettelList.filter((key) => !optionIndexByKey.has(key) && zettelGet(model, key)?.kind === 'zettel');
	const alsoNodeList = [...new Set(alsoKeyList)].map((key) => zettelNodeBuild(context, zettelGet(model, key), { x: xZettel, y: 0 }));
	const heightZettel = zettelNodeList.reduce((sum, node) => sum + zettelCardHeightEstimate(node) + GAP_ROW, -GAP_ROW);
	const bottomZettel = columnPlace(zettelNodeList, { x: xZettel, y: Math.max(0, (bottomOption - heightZettel) / 2) });
	if (isRevealed) {
		question.optionList.forEach((option, index) => {
			for (const key of new Set(option.zettelList)) {
				if (optionIndexByKey.has(key)) connections.push(lineBuild(`about:${question.key}:${option.id}:${key}`, optionNodeList[index].id, 'out', nodeIdOf(key), 'in'));
			}
		});
	}
	const nodes = [questionNode, ...optionNodeList, ...zettelNodeList];
	if (alsoNodeList.length > 0) {
		columnPlace(alsoNodeList, { x: xZettel, y: Math.max(bottomZettel, 0) + (zettelNodeList.length > 0 ? 40 : 0) + FRAME_PADDING.top });
		nodes.push(...alsoNodeList, frameBuild(`frame:also:${question.key}`, alsoNodeList.map((node) => node.id), labels.frameAlso, 'slate', 'link'));
	}
	return diagramFinish({ nodes, connections });
}

// the provider of the scenes of a model (card-diagram-flexible-switch.md#the-concepts).
//   signature       what the model was built from: a provider built again with the same one is the same
//   labels          the words of the scenes, over ZETTEL_LABEL_DEFAULT
//   revealKeySet    the questions showing their answer; absent: all of them
export function zettelProviderBuild(model, { signature, labels, revealKeySet } = {}) {
	const context = contextBuild(model, { labels, revealKeySet });
	const questionListPathOf = (key) => `${zettelPathOf(model, key)}/${ZETTEL_QUESTION_SEGMENT}`;
	const provider = {
		signature,
		root: zettelPathOf(model, model.rootKey) || '/',
		title: zettelGet(model, model.rootKey)?.title ?? '',
		labelGet: (path) => {
			const place = zettelPathRead(model, path);
			if (!place) return String(path).split('/').pop() ?? '';
			return place.isQuestionList ? context.labels.questionList : zettelLabelOf(zettelGet(model, place.key));
		},
		childListGet: (path) => {
			const place = zettelPathRead(model, path);
			if (!place) return [];
			if (place.isQuestionList) return zettelQuestionChildListOf(model, place.key).map((question) => ({ path: zettelPathOf(model, question.key), label: `Q${question.number}`, description: question.title }));
			const list = zettelKnowledgeChildListOf(model, place.key).map((child) => ({ path: zettelPathOf(model, child.key), label: zettelLabelOf(child), description: zettelTextClip(child.summary, 90) }));
			const questionCount = zettelQuestionChildListOf(model, place.key).length;
			if (questionCount > 0) list.push({ path: questionListPathOf(place.key), label: context.labels.questionList, description: `${questionCount}` });
			return list;
		},
		sceneGet: (path) => {
			const place = zettelPathRead(model, path);
			if (!place) return null;
			const zettel = zettelGet(model, place.key);
			const label = provider.labelGet(path);
			if (place.isQuestionList) return { path, label, title: `${context.labels.questionList} — ${zettel.title}`, diagram: sceneQuestionListBuild(context, zettel) };
			if (zettel.kind === 'question') return { path, label, title: `Q${zettel.number} — ${zettel.title}`, diagram: sceneQuestionBuild(context, zettel) };
			if (!zettel.flow) return { path, label, title: zettel.title, diagram: sceneLinkBuild(context, zettel) };
			return {
				path, label, title: zettel.title, viewDefault: 'flow',
				viewList: [
					{ id: 'flow', label: context.labels.viewFlow, title: zettel.flow.title || zettel.title, diagram: sceneFlowBuild(context, zettel) },
					{ id: 'link', label: context.labels.viewLink, title: zettel.title, diagram: sceneLinkBuild(context, zettel) },
				],
			};
		},
	};
	return provider;
}
