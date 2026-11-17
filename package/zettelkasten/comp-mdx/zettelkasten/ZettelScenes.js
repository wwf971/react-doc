import { diagramArrangeApply } from '../../../cloud-dev-vis/comp-mdx/card-diagram/DiagramArrange.js';
import { zettelArrangerConnection, zettelArrangerFlow, zettelMiniHeightEstimate } from './ZettelArrange.js';
import { zettelCountOf, zettelGet, zettelHubOf, zettelKnowledgeChildListOf, zettelLabelOf, zettelProgressOf, zettelRoleBuild, zettelTitleOf } from './ZettelData.js';
import { zettelTextClip } from './ZettelDoc.js';

// The scenes of a zettelkasten (doc/README.md#the-connection-view): what the switching viewport of
// the package cloud-dev-vis (card-diagram-flexible-switch.md) draws inside a zettel when it shows
// its connections or its flow. Generated from the model and laid out by the arrangers of
// ZettelArrange.js; nothing is placed by hand.
//
//   /z/{key}              the connections of a zettel, every place shown
//   /z/{key}/f-{places}   the same with only some places: letters of c (contained by), h (holds),
//                         b (back links), f (forward links and groups), q (questions)
//   /z/{key}/flow         the process a zettel describes (its flow): steps in ranks
//
// a zettel keeps one node id (z:{key}) in every scene showing it, so going from one zettel to
// another, from one filter to another, or between the connections and the flow, moves the zettels
// two scenes share (a morph) instead of replacing them.

export const ZETTEL_TONE_LIST = ['blue', 'teal', 'violet', 'amber', 'green', 'red', 'slate'];
export const ZETTEL_PLACE_LIST = [
	{ id: 'c', label: 'Contained by', title: 'The zettels holding this one' },
	{ id: 'h', label: 'Contains', title: 'The zettels this one holds' },
	{ id: 'b', label: 'Back links', title: 'The zettels pointing at this one' },
	{ id: 'f', label: 'Forward links', title: 'The zettels this one points at, and its lists, arrays and maps' },
	{ id: 'q', label: 'Questions', title: 'The questions this zettel holds, and those using it' },
];
export const ZETTEL_PLACE_ALL = ZETTEL_PLACE_LIST.map((place) => place.id).sort().join('');
export const ZETTEL_LABEL_DEFAULT = {
	containedBy: 'Contained by', contains: 'Contains', backLink: 'Back links', forwardLink: 'Forward links', questionRelated: 'Questions',
	more: 'more', levelRoot: 'map', levelHub: 'area', levelTopic: 'topic', levelFact: 'fact', countZettel: 'zettels inside', countQuestion: 'questions',
	formList: 'list', formArray: 'array', formMap: 'map', containsOther: 'Other',
};

const WIDTH_CENTER = 320;
const WIDTH_SIDE = 230;
const WIDTH_GRID = 210;
const WIDTH_STEP = 210;
const SIDE_MAX = 6;
const GAP_SIDE = 120;
const LABEL_CHAR_WIDTH = 6.8;
// up to how many cards a place shows their summaries: a column is tall already, a grid has room
const NORMAL_MAX = 4;
const GRID_NORMAL_MAX = 12;
const FRAME_PADDING = { top: 30, right: 12, bottom: 12, left: 12 };
// a group of what a zettel holds, framed inside the frame of the place (doc/README.md#the-connection-view)
const SUB_FRAME_PADDING = { top: 24, right: 8, bottom: 8, left: 8 };
const FRAME_PADDING_AROUND_SUB = { top: FRAME_PADDING.top + SUB_FRAME_PADDING.top, right: FRAME_PADDING.right + SUB_FRAME_PADDING.right, bottom: FRAME_PADDING.bottom + SUB_FRAME_PADDING.bottom, left: FRAME_PADDING.left + SUB_FRAME_PADDING.left };
const PROGRESS_TONE = { right: 'green', wrong: 'red', review: 'amber' };

const nodeIdOf = (key) => `z:${key}`;
// a handle whose end draws no marker of its own: a line simply touches the card
const handleBuild = (id, direction, side) => ({ id, direction, anchor: { side }, isMarkerHidden: true });

// ---------- paths ----------

const placeCodeOf = (placeSet) => [...placeSet].sort().join('');

export function zettelScenePathBuild(key, view = 'link', placeCode = ZETTEL_PLACE_ALL) {
	if (view === 'flow') return `/z/${key}/flow`;
	const code = placeCodeOf(new Set(String(placeCode)));
	return code === ZETTEL_PLACE_ALL ? `/z/${key}` : `/z/${key}/f-${code || 'none'}`;
}

// { key, view: link | flow, placeSet } of a scene path, or null
export function zettelScenePathRead(path) {
	const match = /^\/z\/([^/]+)(?:\/(flow|f-([a-z]*)))?$/.exec(String(path ?? '').split('@')[0]);
	if (!match) return null;
	if (match[2] === 'flow') return { key: match[1], view: 'flow', placeSet: new Set(ZETTEL_PLACE_ALL) };
	const code = match[3] === undefined ? ZETTEL_PLACE_ALL : match[3] === 'none' ? '' : match[3];
	return { key: match[1], view: 'link', placeSet: new Set(code) };
}

// ---------- what the scenes are drawn with ----------

// the tone of a zettel, the same on its cards and on its own title bar: the tone of its area (a
// zettel held by the root), slate for the root; a question's says how the reader did on it
export function zettelToneOfBuild(model) {
	const toneByHub = new Map();
	zettelKnowledgeChildListOf(model, model.rootKey).forEach((hub, index) => toneByHub.set(hub.key, ZETTEL_TONE_LIST[index % (ZETTEL_TONE_LIST.length - 1)]));
	return (zettel) => {
		if (!zettel) return 'slate';
		if (zettel.kind === 'question') return PROGRESS_TONE[zettelProgressOf(model, zettel.key)] ?? 'slate';
		if (zettel.key === model.rootKey) return 'slate';
		return toneByHub.get(zettelHubOf(model, zettel.key)?.key) ?? 'slate';
	};
}

// the words, the tones, which questions show their verdicts
function contextBuild(model, { labels = {}, revealKeySet = null, objectLabelGet } = {}) {
	return { model, labels: { ...ZETTEL_LABEL_DEFAULT, ...labels }, toneOf: zettelToneOfBuild(model), isRevealed: (key) => !revealKeySet || revealKeySet.has(key), objectLabelGet: objectLabelGet ?? ((ref) => ref) };
}

const levelLabelOf = (context, zettel) => (zettel.kind === 'question' ? '' : context.labels[{ root: 'levelRoot', hub: 'levelHub', topic: 'levelTopic', fact: 'levelFact' }[zettel.level]] ?? '');

// a zettel as a card of a scene. its height is written: the card clamps its summary to the lines
// counted, so cards of one frame can share the height of the tallest
function cardBuild(context, zettel, { place, size, width, keyList = [], link = '', idSuffix = '' }) {
	const node = {
		id: `${nodeIdOf(zettel.key)}${idSuffix}`,
		renderer: { type: 'zettel-card' },
		position: { x: 0, y: 0 },
		size: { width, height: 'auto' },
		...(link ? { link } : {}),
		data: {
			place, size, title: zettelTitleOf(zettel), kind: zettel.kind, tone: context.toneOf(zettel),
			tag: size === 'compact' ? '' : levelLabelOf(context, zettel),
			text: size === 'compact' ? '' : zettel.summary,
			hover: zettel.summary ? zettelTextClip(zettel.summary, 240) : '',
			...(keyList.length > 0 ? { keyList } : {}),
		},
		handles: [handleBuild('in', 'in', 'left'), handleBuild('out', 'out', 'right')],
	};
	node.size.height = zettelMiniHeightEstimate(node);
	return node;
}

// the cards of one frame as tall as the tallest of them, so a column or a row reads as one
function heightEven(nodeList) {
	const height = Math.max(0, ...nodeList.filter((node) => node.renderer.type === 'zettel-card' && node.data.size !== 'compact').map((node) => node.size.height));
	for (const node of nodeList) if (node.renderer.type === 'zettel-card' && node.data.size !== 'compact') node.size.height = height;
}

function frameBuild(id, place, { label, count = 0, form = '', tone = 'slate', memberIdList, handle = '', handleList = [], padding = FRAME_PADDING }) {
	return {
		id, renderer: { type: 'zettel-frame' }, around: { nodeIdList: memberIdList, padding },
		data: { place, label, count: count > 1 ? String(count) : '', form, tone, ...(handle ? { handle } : {}) },
		handles: handleList,
	};
}

// a line of the view. a label: { kind: text | zettel | object }; a zettel as a label opens it, an
// object opens where its provider says
function lineBuild(context, id, from, to, { label = null, isDirected = true, type = 'bezier', placeCode } = {}) {
	const line = { id, source: from, target: to, renderer: { type }, markerEnd: isDirected ? 'arrowClosed' : 'none' };
	if (!label) return line;
	if (label.kind === 'zettel') {
		const zettel = zettelGet(context.model, label.key);
		if (!zettel) return { ...line, label: { text: label.text || label.key } };
		return { ...line, label: { text: label.text || zettelLabelOf(zettel) }, link: zettelScenePathBuild(zettel.key, 'link', placeCode), linkTitle: `${zettelTitleOf(zettel)}: the zettel this connection is labelled by` };
	}
	if (label.kind === 'object') return { ...line, label: { text: label.text || context.objectLabelGet(label.ref) }, link: `object:${label.ref}`, linkTitle: `${label.ref}: open the object this connection is labelled by` };
	return label.text ? { ...line, label: { text: label.text } } : line;
}

const labelOfLinkList = (linkList) => linkList.find((link) => link.label)?.label ?? null;
const isDirectedOfLinkList = (linkList) => linkList.some((link) => link.isDirected);

// a place with more cards than fit: the first ones, and a card opening the place alone
function capWithMore(context, entryList, { isCapped, place, placeLetter, zettelKey, width }) {
	if (!isCapped || entryList.length <= SIDE_MAX) return { shown: entryList, more: null };
	const count = entryList.length - (SIDE_MAX - 1);
	return {
		shown: entryList.slice(0, SIDE_MAX - 1),
		more: {
			id: `more:${place}:${zettelKey}`, renderer: { type: 'card-three-dots' }, position: { x: 0, y: 0 }, size: { width, height: 40 },
			link: zettelScenePathBuild(zettelKey, 'link', placeLetter),
			data: { place, direction: 'vertical', text: `${count} ${context.labels.more}` }, handles: [],
		},
	};
}

// the connection view of a zettel (ZettelArrange.js zettelArrangerConnection): every zettel
// connected to it, each place in a frame, the lines of each place to the zettel in the middle
function sceneConnectionBuild(context, zettel, placeSet) {
	const { model, labels } = context;
	const role = zettelRoleBuild(model, zettel.key);
	const placeCode = placeCodeOf(placeSet);
	const linkOf = (key) => zettelScenePathBuild(key, 'link', placeCode);
	const isOn = (letter) => placeSet.has(letter);
	const nodes = [];
	const connections = [];
	const tone = context.toneOf(zettel);
	const count = zettelCountOf(model, zettel.key);
	const statList = [
		...(count.zettel ? [{ value: String(count.zettel), label: labels.countZettel }] : []),
		...(count.question ? [{ value: String(count.question), label: labels.countQuestion }] : []),
	];
	const center = {
		id: nodeIdOf(zettel.key), renderer: { type: 'zettel-card' }, position: { x: 0, y: 0 }, size: { width: WIDTH_CENTER, height: 'auto' },
		link: `zettel-open:${zettel.key}`,
		data: { place: 'center', size: 'center', title: zettelTitleOf(zettel), kind: zettel.kind, tone, tag: levelLabelOf(context, zettel), text: zettel.summary, statList, hover: 'Open this zettel' },
		handles: [handleBuild('top', 'in', 'top'), handleBuild('bottom', 'out', 'bottom'), handleBuild('in', 'in', 'left'), handleBuild('qin', 'in', 'left'), handleBuild('out', 'out', 'right')],
	};
	center.size.height = zettelMiniHeightEstimate(center);
	nodes.push(center);
	// one side shown alone shows all it has; beside others, a long place is cut
	const sideCount = ['b', 'f'].filter(isOn).length + (isOn('q') ? 1 : 0);
	const isCapped = sideCount > 1;
	const sizeOfCount = (n) => (n > NORMAL_MAX ? 'compact' : 'normal');
	const sizeOfGrid = (n) => (n > GRID_NORMAL_MAX ? 'compact' : 'normal');

	// above: what holds it
	if (isOn('c') && role.containerList.length > 0) {
		const size = sizeOfGrid(role.containerList.length);
		const cardList = role.containerList.map((entry) => cardBuild(context, entry.zettel, { place: 'container', size, width: WIDTH_GRID, link: linkOf(entry.zettel.key) }));
		heightEven(cardList);
		nodes.push(...cardList, frameBuild(`frame:c:${zettel.key}`, 'container', { label: labels.containedBy, count: cardList.length, tone: 'slate', memberIdList: cardList.map((node) => node.id), handleList: [handleBuild('out', 'out', 'bottom')] }));
		connections.push(lineBuild(context, `contain:up:${zettel.key}`, { nodeId: `frame:c:${zettel.key}`, handleId: 'out' }, { nodeId: center.id, handleId: 'top' }, { type: 'smoothstep' }));
	}
	// below: what it holds, then the questions it holds
	const childList = isOn('h') ? role.childList : [];
	const questionHeldList = isOn('q') ? role.questionList.filter((entry) => entry.isHeld) : [];
	if (childList.length + questionHeldList.length > 0) {
		const size = sizeOfGrid(childList.length);
		const cardList = childList.map((entry) => {
			const group = entry.connection?.group;
			return cardBuild(context, entry.zettel, { place: 'child', size, width: WIDTH_GRID, link: linkOf(entry.zettel.key), keyList: group && group.form !== 'list' ? [{ text: group.key }] : [] });
		});
		heightEven(cardList);
		// what it holds in more than one group (or a group and the rest): each group starts its own
		// rows, in a frame of its own named by the group, inside the frame of the place. the model
		// orders the children group by group
		const blockList = [];
		childList.forEach((entry, index) => {
			const group = entry.connection?.group ?? null;
			const id = group?.id ?? '';
			if (blockList.length === 0 || blockList[blockList.length - 1].id !== id) blockList.push({ id, group, cardList: [] });
			blockList[blockList.length - 1].cardList.push(cardList[index]);
		});
		const isSubFramed = blockList.length > 1 && blockList.some((block) => block.group);
		const subFrameList = [];
		if (isSubFramed) {
			blockList.forEach((block, index) => {
				for (const card of block.cardList) card.data.block = `${index}`;
				const group = block.group;
				subFrameList.push(frameBuild(`frame:hg:${group ? group.id : '-'}:${zettel.key}`, 'child-group', { label: group ? group.label || group.id : labels.containsOther, count: block.cardList.length, form: group ? labels[{ list: 'formList', array: 'formArray', map: 'formMap' }[group.form]] ?? group.form : '', tone, memberIdList: block.cardList.map((node) => node.id), padding: SUB_FRAME_PADDING }));
			});
		}
		const questionCardList = questionHeldList.map((entry) => cardBuild(context, entry.zettel, { place: 'child-question', size: 'compact', width: WIDTH_GRID, link: linkOf(entry.zettel.key) }));
		const memberList = [...cardList, ...questionCardList];
		const countText = [childList.length ? `${childList.length}` : '', questionHeldList.length ? `${questionHeldList.length} Q` : ''].filter(Boolean).join(' + ');
		// the frame of the place before the frames of its groups: a background declared later is drawn over it
		nodes.push(...memberList, frameBuild(`frame:h:${zettel.key}`, 'child', { label: labels.contains, tone, memberIdList: memberList.map((node) => node.id), handleList: [handleBuild('in', 'in', 'top')], padding: isSubFramed ? FRAME_PADDING_AROUND_SUB : FRAME_PADDING }));
		nodes[nodes.length - 1].data.count = memberList.length > 1 ? countText : '';
		nodes.push(...subFrameList);
		connections.push(lineBuild(context, `contain:down:${zettel.key}`, { nodeId: center.id, handleId: 'bottom' }, { nodeId: `frame:h:${zettel.key}`, handleId: 'in' }, { type: 'smoothstep' }));
	}
	// the left: back links, then the questions using it
	if (isOn('b') && role.inList.length > 0) {
		const { shown, more } = capWithMore(context, role.inList, { isCapped, place: 'in', placeLetter: 'b', zettelKey: zettel.key, width: WIDTH_SIDE });
		const size = sizeOfCount(shown.length);
		const cardList = shown.map((entry) => cardBuild(context, entry.zettel, { place: 'in', size, width: WIDTH_SIDE, link: linkOf(entry.zettel.key) }));
		heightEven(cardList);
		shown.forEach((entry, index) => connections.push(lineBuild(context, `in:${entry.zettel.key}`, { nodeId: cardList[index].id, handleId: 'out' }, { nodeId: center.id, handleId: 'in' }, { label: labelOfLinkList(entry.linkList), isDirected: isDirectedOfLinkList(entry.linkList), placeCode })));
		const memberList = more ? [...cardList, more] : cardList;
		nodes.push(...memberList, frameBuild(`frame:b:${zettel.key}`, 'in', { label: labels.backLink, count: role.inList.length, memberIdList: memberList.map((node) => node.id), handle: 'in' }));
	}
	// the questions about it: a question naming it in an option, or named by it. drawn without an
	// arrow, since the two usually name each other
	const questionUsingList = isOn('q') ? role.questionList.filter((entry) => !entry.isHeld) : [];
	if (questionUsingList.length > 0) {
		const { shown, more } = capWithMore(context, questionUsingList, { isCapped, place: 'in-question', placeLetter: 'q', zettelKey: zettel.key, width: WIDTH_SIDE });
		const cardList = shown.map((entry) => cardBuild(context, entry.zettel, { place: 'in-question', size: 'compact', width: WIDTH_SIDE, link: linkOf(entry.zettel.key), keyList: optionKeyListOf(context, entry.zettel, entry.optionIdList) }));
		cardList.forEach((node) => connections.push(lineBuild(context, `q:${node.id}`, { nodeId: node.id, handleId: 'out' }, { nodeId: center.id, handleId: 'qin' }, { isDirected: false })));
		const memberList = more ? [...cardList, more] : cardList;
		nodes.push(...memberList, frameBuild(`frame:q:${zettel.key}`, 'in-question', { label: labels.questionRelated, count: questionUsingList.length, memberIdList: memberList.map((node) => node.id), handle: 'qin' }));
	}
	// the right: forward links, then each group
	if (isOn('f') && role.outList.length > 0) {
		const { shown, more } = capWithMore(context, role.outList, { isCapped, place: 'out', placeLetter: 'f', zettelKey: zettel.key, width: WIDTH_SIDE });
		const size = sizeOfCount(shown.length);
		const cardList = shown.map((entry) => cardBuild(context, entry.zettel, { place: 'out', size, width: WIDTH_SIDE, link: linkOf(entry.zettel.key) }));
		heightEven(cardList);
		shown.forEach((entry, index) => connections.push(lineBuild(context, `out:${entry.zettel.key}`, { nodeId: center.id, handleId: 'out' }, { nodeId: cardList[index].id, handleId: 'in' }, { label: labelOfLinkList(entry.linkList), isDirected: isDirectedOfLinkList(entry.linkList), placeCode })));
		const memberList = more ? [...cardList, more] : cardList;
		nodes.push(...memberList, frameBuild(`frame:f:${zettel.key}`, 'out', { label: labels.forwardLink, count: role.outList.length, memberIdList: memberList.map((node) => node.id), handle: 'out' }));
	}
	if (isOn('f')) {
		const usedIdSet = new Set(nodes.map((node) => node.id));
		for (const group of role.groupList) {
			const handleId = `g:${group.id}`;
			center.handles.push(handleBuild(handleId, 'out', 'right'));
			// one card per zettel, with every key it stands at (a question's zettel under several options)
			const memberList = [];
			for (const item of group.itemList) {
				const member = memberList.find((one) => one.zettel.key === item.zettel.key);
				if (member) { if (group.form !== 'list') member.keyTextList.push(item.key); continue; }
				memberList.push({ zettel: item.zettel, keyTextList: group.form === 'list' ? [] : [item.key], connection: item.connection });
			}
			const size = sizeOfCount(memberList.length);
			const isOption = group.id === 'option' && zettel.kind === 'question';
			const cardList = memberList.map((member, index) => {
				// a zettel may stand in two places: here it is another card of the same zettel
				const idSuffix = usedIdSet.has(nodeIdOf(member.zettel.key)) ? `~${group.id}~${index}` : '';
				const keyList = isOption ? optionKeyListOf(context, zettel, member.keyTextList, true) : member.keyTextList.map((text) => ({ text }));
				const node = cardBuild(context, member.zettel, { place: 'group', size, width: WIDTH_SIDE, link: linkOf(member.zettel.key), keyList, idSuffix });
				usedIdSet.add(node.id);
				return node;
			});
			heightEven(cardList);
			cardList.forEach((node, index) => connections.push(lineBuild(context, `group:${group.id}:${index}`, { nodeId: center.id, handleId }, { nodeId: node.id, handleId: 'in' }, { label: memberList[index].connection?.label ?? null, isDirected: group.isDirected !== false, placeCode })));
			nodes.push(...cardList, frameBuild(`frame:g:${group.id}:${zettel.key}`, 'group', { label: group.label || group.id, count: group.itemList.length, form: labels[{ list: 'formList', array: 'formArray', map: 'formMap' }[group.form]] ?? group.form, memberIdList: cardList.map((node) => node.id), handle: handleId }));
		}
	}
	// a side whose lines carry labels is as wide as its longest label needs
	const gapOf = (isLeft) => {
		const centerHandleSet = new Set(isLeft ? ['in', 'qin'] : center.handles.map((handle) => handle.id).filter((id) => id === 'out' || id.startsWith('g:')));
		const lengthMax = Math.max(0, ...connections.filter((line) => line.label?.text && (isLeft ? line.target.nodeId === center.id && centerHandleSet.has(line.target.handleId) : line.source.nodeId === center.id && centerHandleSet.has(line.source.handleId))).map((line) => line.label.text.length));
		return Math.max(GAP_SIDE, Math.round(lengthMax * LABEL_CHAR_WIDTH + 80));
	};
	const { diagram } = diagramArrangeApply({ nodes, connections }, zettelArrangerConnection, { gapLeft: gapOf(true), gapRight: gapOf(false) });
	return { diagram: diagramFinish(diagram), box: boxOf(diagram) };
}

// the letters of options as keys, each toned by its verdict once the answer is shown (green: a
// right answer, red: a wrong one). isQuestionOwn: the letters are the question's own (its option
// group); otherwise the question is another zettel's
function optionKeyListOf(context, question, letterList, isQuestionOwn = false) {
	const isRevealed = context.isRevealed(question.key);
	return [...new Set(letterList)].sort().map((text) => {
		const option = question.optionList?.find((one) => one.id === text);
		return { text, tone: isRevealed && option ? (option.isCorrect ? 'green' : 'red') : '' };
	});
}

// the part of the view a camera fits: everything but the long end of what it holds below, which
// the reader scrolls to (or sees whole once the zettel is expanded)
const BOX_BELOW_MAX = 260;
const boxOf = (diagram) => extentOf(diagram, { belowMax: BOX_BELOW_MAX });

// everything a scene draws, frames included: what an expanded zettel shows whole
export const zettelSceneExtentGet = (desc) => (desc?.diagram ? extentOf(desc.diagram, { belowMax: Infinity }) : null);

function extentOf(diagram, { belowMax }) {
	const rectById = new Map();
	for (const node of diagram.nodes) if (!node.around) rectById.set(node.id, { x: node.position?.x ?? 0, y: node.position?.y ?? 0, width: typeof node.size?.width === 'number' ? node.size.width : 220, height: typeof node.size?.height === 'number' ? node.size.height : zettelMiniHeightEstimate(node) });
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	let bottomCut = Infinity;
	const add = (rect) => {
		left = Math.min(left, rect.x);
		top = Math.min(top, rect.y);
		right = Math.max(right, rect.x + rect.width);
		bottom = Math.max(bottom, rect.y + rect.height);
	};
	for (const node of diagram.nodes) {
		if (!node.around) { add(rectById.get(node.id)); continue; }
		const memberList = node.around.nodeIdList.map((id) => rectById.get(id)).filter(Boolean);
		if (memberList.length === 0) continue;
		const pad = node.around.padding;
		const rect = { x: Math.min(...memberList.map((one) => one.x)) - pad.left, y: Math.min(...memberList.map((one) => one.y)) - pad.top };
		rect.width = Math.max(...memberList.map((one) => one.x + one.width)) + pad.right - rect.x;
		rect.height = Math.max(...memberList.map((one) => one.y + one.height)) + pad.bottom - rect.y;
		add(rect);
		if (node.data.place === 'child' && rect.height > belowMax) bottomCut = rect.y + belowMax;
	}
	if (!Number.isFinite(left)) return null;
	const margin = 16;
	return { x: left - margin, y: top - margin, width: right - left + margin * 2, height: Math.min(bottom, bottomCut) - top + margin * 2 };
}

const diagramFinish = (diagram) => ({ version: 1, defaults: { connection: { renderer: { type: 'bezier' }, markerEnd: 'arrowClosed' } }, ...diagram });

// the flow of a zettel: the steps it writes, laid out by the arranger; a step naming a zettel is
// that zettel's card (its id shared with the connection view), the others notes
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
		if (target && target.key !== zettel.key) {
			const node = cardBuild(context, target, { place: 'step', size: 'normal', width: WIDTH_STEP, link: zettelScenePathBuild(target.key) });
			return { ...node, id: idByStep.get(step.id), data: { ...node.data, title: step.title || node.data.title, text: step.text || node.data.text }, handles: [] };
		}
		return { id: idByStep.get(step.id), renderer: { type: 'card-note' }, position: { x: 0, y: 0 }, size: { width: WIDTH_STEP, height: 'auto' }, data: { title: step.title, text: step.text, tone: ZETTEL_TONE_LIST.includes(step.tone) ? step.tone : 'slate' }, handles: [] };
	});
	for (const node of nodes) if (node.renderer.type === 'zettel-card') node.size.height = zettelMiniHeightEstimate(node);
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const connections = flow.edgeList.map((edge, index) => {
		const sourceId = idByStep.get(edge.from);
		const targetId = idByStep.get(edge.to);
		nodeById.get(sourceId).handles.push(handleBuild(`out:${index}`, 'out', 'right'));
		nodeById.get(targetId).handles.push(handleBuild(`in:${index}`, 'in', 'left'));
		return { id: `flow:${zettel.key}:${index}`, source: { nodeId: sourceId, handleId: `out:${index}` }, target: { nodeId: targetId, handleId: `in:${index}` }, ...(edge.label ? { label: { text: edge.label } } : {}) };
	});
	const { diagram } = diagramArrangeApply({ nodes, connections }, zettelArrangerFlow, { ranksPerBand: 3, gapX: 70 });
	return diagramFinish(diagram);
}

// the provider of the scenes of a model (card-diagram-flexible-switch.md#the-concepts).
//   signature        what the model was built from: a provider built again with the same one is the same
//   labels           the words of the scenes, over ZETTEL_LABEL_DEFAULT
//   revealKeySet     the questions showing their answer; absent: all of them
//   onZettelOpen     a click on the zettel in the middle: show it (its text)
//   onObjectOpen     a click on a line labelled by an object
//   objectLabelGet   the words of an object a line is labelled by
export function zettelProviderBuild(model, { signature, labels, revealKeySet, onZettelOpen, onObjectOpen, objectLabelGet } = {}) {
	const context = contextBuild(model, { labels, revealKeySet, objectLabelGet });
	const builtByPath = new Map();
	return {
		signature,
		root: zettelScenePathBuild(model.rootKey || model.zettelList[0]?.key || 'none'),
		title: zettelGet(model, model.rootKey)?.title ?? '',
		labelGet: (path) => zettelLabelOf(zettelGet(model, zettelScenePathRead(path)?.key)) || String(path).split('/').pop() || '',
		childListGet: () => [],
		sceneGet: (path) => {
			const place = zettelScenePathRead(path);
			const zettel = place ? zettelGet(model, place.key) : null;
			if (!zettel || (place.view === 'flow' && !zettel.flow)) return null;
			if (!builtByPath.has(path)) {
				const label = zettelLabelOf(zettel);
				if (place.view === 'flow') builtByPath.set(path, { path, label, title: zettel.flow.title || zettel.title, isTitleHidden: true, diagram: sceneFlowBuild(context, zettel) });
				else {
					const { diagram, box } = sceneConnectionBuild(context, zettel, place.placeSet);
					builtByPath.set(path, { path, label, title: zettelTitleOf(zettel), isTitleHidden: true, diagram, ...(box ? { box } : {}) });
				}
			}
			return builtByPath.get(path);
		},
		// a link that is not a scene: the zettel in the middle opened, an object of a label
		linkOpen: (link) => {
			const text = String(link ?? '');
			if (text.startsWith('zettel-open:')) { onZettelOpen?.(text.slice('zettel-open:'.length)); return true; }
			if (text.startsWith('object:')) { onObjectOpen?.(text.slice('object:'.length)); return true; }
			return false;
		},
	};
}

// the zettel a view counts as about: what an outside list shows as the current one
export const zettelSceneKeyOf = (path) => zettelScenePathRead(path)?.key ?? '';
