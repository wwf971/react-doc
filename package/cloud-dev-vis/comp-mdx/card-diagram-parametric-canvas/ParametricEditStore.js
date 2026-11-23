import { makeAutoObservable, observable, reaction } from 'mobx';
import { MEMBER_ROOT_ID, PARAMETRIC_DATA_KEY, PARAMETRIC_FEATURE_ID, pointRead, groupKeyOf, parametricLineListGet, parametricRead } from './ParametricData.js';
import { parametricSolve } from './ParametricSolve.js';
import { toolListBuild, toolMapMerge } from './ParametricTool.js';
import { createModeParamOf } from './ParametricCreateMode.js';
import { actionListBuild, focusCardModelBuild, focusRectGet, nodeSectionListBuild } from './ParametricEditModel.js';

const KEY = PARAMETRIC_DATA_KEY;
const ID_CHAR_LIST = '0123456789abcdefghijklmnopqrstuvwxyz';
// where the edit card stands (panel.cardPlace), remembered in this browser for every diagram
export const CARD_PLACE_DOCK = 'dock';
export const CARD_PLACE_FLOAT = 'float';
const CARD_PLACE_STORAGE_KEY = 'doc-param-card-place';
function cardPlaceRead() {
	try {
		return globalThis.localStorage?.getItem(CARD_PLACE_STORAGE_KEY) === CARD_PLACE_FLOAT ? CARD_PLACE_FLOAT : CARD_PLACE_DOCK;
	} catch {
		return CARD_PLACE_DOCK;
	}
}
function cardPlaceWrite(place) {
	try {
		globalThis.localStorage?.setItem(CARD_PLACE_STORAGE_KEY, place);
	} catch {
		// a browser keeping no storage: the choice lasts while the page is open
	}
}
// the camera of the graph of relations at rest, and how far it zooms
const GRAPH_CAMERA_REST = { x: 0, y: 0, zoom: 1 };
const GRAPH_ZOOM_MIN = 0.3;
const GRAPH_ZOOM_MAX = 3;
const roundPoint = point => ({ x: Math.round(point.x), y: Math.round(point.y) });

// an id nobody types: a few random characters, not one of those taken
export function idRandomGet(idTakenList = [], length = 6) {
	for (;;) {
		let id = '';
		for (let index = 0; index < length; index += 1) id += ID_CHAR_LIST[Math.floor(Math.random() * ID_CHAR_LIST.length)];
		if (!idTakenList.includes(id) && id !== MEMBER_ROOT_ID) return id;
	}
}

// The session of the parametric canvas in the visual editor of a diagram
// (card-diagram-parametric-canvas.md#the-editor): what the feature adds to DiagramVisualEdit, through
// the hooks a session answers (DiagramVisualEdit.jsx).
//
// It holds no draft: the draft is DiagramEditStore's, and every command here changes it through
// store.changeApply, so each is validated (the section is read again, with the diagram), refused
// with its reason, and undone and redone like any step. The rule of every command that changes
// the structure: **nothing moves**. A member put under another parent, given another constraint
// type, taken out of its group: the parameters written are those that keep it where it stands.
//
// Beside the draft it holds what the editor shows and never saves:
//   focus         a group or a layout member: what has no node, so no path of the editor. Exclusive
//                 with the path: focusing one clears the other, and `selected` is the one of both
//   toolArmedId   the tool the next gesture on the canvas places; toolModeId: the create mode
//                 chosen for it this time (null: the default of the tool)
//   gesture       the gesture on the canvas while a tool is armed (ParametricCreateMode.js): where
//                 the pointer is and went down, the keys held. The placement it stands for and the
//                 ghost of what will be made are read off it
//   panel         the state of the panel (ParametricPanel.jsx): folded, the search, the items folded
//   toolBar       the state of the tool bar (ParametricToolBar.jsx): the dropdown open
export class ParametricEditStore {
	id = PARAMETRIC_FEATURE_ID;
	focus = null;
	toolArmedId = null;
	toolModeId = null;
	gesture = null;
	// cardPlace: where the edit card of what is selected stands, the author's choice: 'dock' (in the
	// third part of the panel) or 'float' (beside the thing, as everywhere else). Kept in this browser
	panel = { isCollapsed: false, search: '', collapsedByKey: {}, graphCamera: null, cardPlace: cardPlaceRead() };
	toolBar = { openId: null, detailId: null, modeId: null };
	// the menu of a thing of the panel (a right-click on an item of its tree): { x, y, target, label }
	menu = null;
	// the tools changed here when no config keeps them (toolMapPatch absent): over toolMapGet
	toolMapOwn = {};

	// store: the DiagramEditStore of the editor. canvas: the ref of the canvas api of the editor
	// (sizes as drawn, a dragged place given up). catalog: the constraint and layout types.
	// toolMapGet: the tools of the tool bar as the config has them. idGet(idTakenList): a new id
	// toolIconGet(tool): the icon of a tool, from whoever draws the tool bar. toolMapPatch(patch):
	// writes tools changed into what keeps the tool bar (a layer of the config); absent, they are
	// kept here, for the session
	// iconGet(name): an icon by its word (remove ...), from whoever draws
	constructor({ store, registry, config = {}, canvas, isOnGet, catalog, toolMapGet, toolMapPatch, toolIconGet, iconGet, idGet = idRandomGet }) {
		Object.assign(this, { store, registry, config, canvas, isOnGet, catalog, toolMapGet, toolMapPatch, toolIconGet, iconGet, idGet });
		makeAutoObservable(this, { store: false, registry: false, config: false, canvas: false, isOnGet: false, catalog: false, toolMapGet: false, toolMapPatch: false, toolIconGet: false, iconGet: false, idGet: false, disposeList: false, gesture: observable.ref }, { autoBind: true });
		// a node or a line focused is the selection: the focus of a group lets go
		this.disposeList = [reaction(() => Boolean(this.store.display), (isShown) => { if (isShown) this.focus = null; })];
	}

	dispose() { this.disposeList.forEach(dispose => dispose()); }

	get isOn() { return this.isOnGet ? this.isOnGet() : true; }

	// ---------- the draft, read ----------

	get section() { return this.store.value[KEY] ?? {}; }
	// the groups as written
	get groupList() { return this.section.groupList ?? []; }
	// the model of the draft (ParametricData.js); the draft is valid, so it reads
	get model() { return parametricRead(this.section, { nodes: this.store.nodes, catalog: this.catalog }); }

	groupGet(groupId) { return this.groupList.find(group => group.id === groupId); }
	memberGet(groupId, memberId) { return (this.groupGet(groupId)?.memberList ?? []).find(member => member.id === memberId); }
	groupModelGet(groupId) { return this.model.groupList.find(group => group.id === groupId); }
	memberOfNode(nodeId) { return this.model.memberByNodeId.get(nodeId) ?? null; }
	nodeIsPlaced(nodeId) { return Boolean(this.memberOfNode(nodeId)); }

	groupIndexOf(groupId) {
		const index = this.groupList.findIndex(group => group.id === groupId);
		if (index < 0) throw new Error('Unknown group.');
		return index;
	}

	memberPathOf(groupId, memberId) {
		const groupIndex = this.groupIndexOf(groupId);
		const memberIndex = (this.groupList[groupIndex].memberList ?? []).findIndex(member => member.id === memberId);
		if (memberIndex < 0) throw new Error('Unknown member.');
		return [KEY, 'groupList', groupIndex, 'memberList', memberIndex];
	}

	// the size of a node: as drawn when the canvas knows it, else as written, else that of its kind
	nodeSizeGet(nodeId) {
		const measured = this.canvas?.current?.nodeSizeGet?.(nodeId);
		return measured ?? this.nodeSizeWrittenOf(this.store.nodeGet(nodeId));
	}

	nodeSizeWrittenOf(node) {
		const sizeDefault = { width: 220, height: 100, ...this.registry?.kindByType[node?.renderer?.type]?.contract.sizeDefault };
		return { width: typeof node?.size?.width === 'number' ? node.size.width : sizeDefault.width, height: typeof node?.size?.height === 'number' ? node.size.height : sizeDefault.height };
	}

	// where a node is: on the canvas when it is drawn, else as written
	nodePositionGet(nodeId) {
		const drawn = this.canvas?.current?.positionGet?.(nodeId);
		const written = this.store.nodeGet(nodeId)?.position;
		return drawn ?? (written && written !== 'auto' ? written : { x: 0, y: 0 });
	}

	// where every member of the draft stands, with the sizes as drawn (ParametricSolve.js)
	solve() { return parametricSolve(this.model, this.catalog, { sizeOf: this.nodeSizeGet }); }

	// ---------- the selection ----------

	// the focus while it is the selection: nothing of the path focused, and what it names still there
	get focusShown() {
		if (!this.focus || this.store.display) return null;
		const group = this.groupGet(this.focus.groupId);
		if (!group) return null;
		return this.focus.kind === 'group' || this.memberGet(this.focus.groupId, this.focus.memberId) ? this.focus : null;
	}

	get isFocused() { return Boolean(this.focusShown); }

	// what is selected, whoever holds it: a node ({ kind: node, nodeId, groupId?, memberId? }), a
	// line by itself, a group or a layout member
	get selected() {
		const display = this.store.display;
		if (display?.nodeId) return { kind: 'node', nodeId: display.nodeId, ...(this.memberOfNode(display.nodeId) ?? {}) };
		if (display?.connectionId) return { kind: 'line', connectionId: display.connectionId };
		return this.focusShown;
	}

	focusSet(focus) {
		this.store.selectionClear();
		this.focus = focus;
	}

	focusClear() { this.focus = null; }

	// ---------- hooks of the editor (DiagramVisualEdit.jsx: a session) ----------

	get flowClassName() { return this.toolArmedId ? 'is-parametric-tool-armed' : ''; }
	// the edit card stands in the panel when the author docked it there and the panel is open; else
	// it floats beside what is selected (a folded panel has no room for it)
	get isCardDocked() { return this.panel.cardPlace === CARD_PLACE_DOCK && !this.panel.isCollapsed; }

	// docked: the panel is opened if it was folded, so the card has its place
	cardPlaceSet(place) {
		this.panel.cardPlace = place === CARD_PLACE_DOCK ? CARD_PLACE_DOCK : CARD_PLACE_FLOAT;
		if (this.panel.cardPlace === CARD_PLACE_DOCK) this.panel.isCollapsed = false;
		cardPlaceWrite(this.panel.cardPlace);
	}

	// the button of the head of the card floating beside the thing (DiagramVisualEdit.jsx): into the panel
	cardHeadActionListGet() {
		return this.isCardDocked ? [] : [{ id: 'card-dock', label: 'Dock in the panel under the canvas', Icon: this.iconGet?.('dock'), act: () => this.cardPlaceSet(CARD_PLACE_DOCK) }].filter(action => action.Icon);
	}

	keyDown(event) {
		if (event.key !== 'Escape') return false;
		if (this.menu) { this.menu = null; return true; }
		if (this.toolBar.openId) { this.toolBarClose(); return true; }
		if (this.toolArmedId) { this.toolDisarm(); return true; }
		if (this.focusShown) { this.focus = null; return true; }
		return false;
	}

	// a member dropped on the canvas: the drop is a parameter of its constraint, or its index in an
	// array. A drop that changes nothing puts the node back where its rule has it
	nodeDrop(node, position, editor) {
		if (node.type !== 'visualizationNode' || !this.nodeIsPlaced(node.id)) return false;
		const valueBefore = this.store.valueCurrent;
		editor.change(() => this.memberDrop(node.id, position));
		if (this.store.valueCurrent === valueBefore) this.canvas?.current?.placeOverrideClear?.();
		return true;
	}

	// what the feature adds to the edit card of a node, and the edit card of its own focus
	cardSectionListGet(target, editor) { return target.kind === 'node' ? nodeSectionListBuild(this, target.nodeId, editor) : []; }

	cardGet(editor) {
		const focus = this.focusShown;
		return focus ? { model: focusCardModelBuild(this, focus, editor), anchorRectGet: () => focusRectGet(this, focus, editor), close: this.focusClear } : null;
	}

	// what can be done on the empty canvas or with a thing (the panel of a double-click and of a right-click)
	createActionListGet(target, editor) { return actionListBuild(this, target, editor, this.toolIconGet); }

	// words typed in the panel of the empty canvas: a text there, into the group of what is selected
	// as a tool places (the kind text, ParametricShape.jsx; nothing where the registry has none)
	createTextGet(target, editor) {
		if (target.kind !== 'canvas' || !this.registry?.kindByType.text) return null;
		return { label: 'Text', take: (text, position) => editor.change(() => this.toolPlace({ id: 'text', label: 'Text', create: { what: 'node', kind: 'text', data: { text } } }, position)) };
	}

	// ---------- tools ----------

	get toolMap() { return toolMapMerge(this.toolMapGet?.() ?? {}, this.toolMapOwn); }
	get toolList() { return toolListBuild(this.toolMap); }
	get toolArmed() { return this.toolArmedId ? this.toolList.find(tool => tool.id === this.toolArmedId) ?? null : null; }
	// a tool armed, in a create mode of its own or (modeId null) its default; armed the same way again, let go
	toolArm(toolId, modeId = null) {
		const isSame = this.toolArmedId === toolId && this.toolModeId === modeId;
		this.toolArmedId = isSame ? null : toolId;
		this.toolModeId = isSame ? null : modeId;
		this.gesture = null;
		this.toolBarClose();
	}
	toolDisarm() { this.toolArmedId = null; this.toolModeId = null; this.gesture = null; }
	// the dropdown of a tool or of a group of tools open on the bar; the tool whose parameters are
	// shown in it; the create mode whose parameters are shown under it
	toolBarOpenSet(id) { this.toolBar.openId = this.toolBar.openId === id ? null : id; this.toolBar.detailId = null; this.toolBar.modeId = null; }
	toolBarDetailSet(id) { this.toolBar.detailId = this.toolBar.detailId === id ? null : id; this.toolBar.modeId = null; }
	toolBarModeSet(id) { this.toolBar.modeId = this.toolBar.modeId === id ? null : id; }
	toolBarClose() { this.toolBar.openId = null; this.toolBar.detailId = null; this.toolBar.modeId = null; }

	// a tool as it is from now on (its parameters, its words, how it places): the whole entry of the tool bar
	toolSet(toolId, tool) {
		const { id: _id, ...written } = tool;
		if (this.toolMapPatch) this.toolMapPatch({ [toolId]: written });
		else this.toolMapOwn = { ...this.toolMapOwn, [toolId]: written };
	}

	menuOpen(menu) { this.menu = menu; }
	menuClose() { this.menu = null; }

	// where a new thing goes when nothing says: into the group of what is selected (under a layout
	// member focused, else under the origin), or nowhere: a free element
	get placeTarget() {
		const selected = this.selected;
		if (!selected?.groupId) return null;
		const member = selected.kind === 'member' ? this.memberGet(selected.groupId, selected.memberId) : null;
		return { groupId: selected.groupId, parentId: member?.layout ? member.id : MEMBER_ROOT_ID };
	}

	// ---------- creating (ParametricCreateMode.js, ParametricCreator.js) ----------

	// what makes the thing of a tool, and what it is handed
	creatorOf(tool) { return this.catalog.creatorByWhat[tool?.create?.what] ?? null; }
	createContextOf(target = this.placeTarget) { return { session: this, target }; }

	// the create modes a tool offers: those whose own placement its creator takes, in the order the
	// creator prefers them (a tool may name fewer: modeList). The first is its default, unless it names one
	toolModeListOf(tool) {
		const creator = this.creatorOf(tool);
		if (!creator) return [];
		const kindList = creator.placementKindListGet(tool.create, this.createContextOf());
		const list = this.catalog.createModeList.filter(mode => kindList.includes(mode.placementKindList[0]) && (!Array.isArray(tool.modeList) || tool.modeList.includes(mode.id)));
		return list.sort((a, b) => kindList.indexOf(a.placementKindList[0]) - kindList.indexOf(b.placementKindList[0]));
	}

	toolModeDefaultOf(tool) {
		const list = this.toolModeListOf(tool);
		return list.find(mode => mode.id === tool.mode) ?? list[0] ?? null;
	}

	// the parameters of a mode as a tool keeps them, over the defaults of the mode
	toolModeParamOf(tool, mode) { return createModeParamOf(mode, tool.modeParam?.[mode.id]); }

	get toolModeArmed() {
		const tool = this.toolArmed;
		if (!tool) return null;
		return this.toolModeListOf(tool).find(mode => mode.id === this.toolModeId) ?? this.toolModeDefaultOf(tool);
	}

	// what stands on the canvas, for a mode that places beside something: the nodes of the members
	// and the free nodes, each with its box. (A layout member is no target: what stands under a
	// layout is arranged by it)
	get nodeFreeBoxList() {
		return this.store.nodes.filter(node => !this.model.memberByNodeId.has(node.id) && !node.pin && !node.around).map(node => ({ nodeId: node.id, box: { ...this.nodePositionGet(node.id), ...this.nodeSizeGet(node.id) } }));
	}

	get createTargetList() {
		const solved = this.solve();
		const memberList = this.model.groupList.flatMap(group => group.memberList.filter(member => member.nodeId).map(member => ({ nodeId: member.nodeId, groupId: group.id, memberId: member.id, box: solved.boxByKey.get(groupKeyOf(group.id, member.id)) })));
		return [...memberList, ...this.nodeFreeBoxList];
	}

	// the placement a gesture stands for in a mode of a tool: what the mode answers, when the
	// creator of the tool takes that kind of placement; else null
	placementOf(tool, mode, gesture) {
		const creator = this.creatorOf(tool);
		if (!creator || !mode || !gesture) return null;
		const placement = mode.placementOf(gesture, this.toolModeParamOf(tool, mode), { targetList: mode.placementKindList.includes('beside') ? this.createTargetList : [] });
		return placement && creator.placementKindListGet(tool.create, this.createContextOf()).includes(placement.kind) ? placement : null;
	}

	// while a tool is armed: the placement of the gesture so far, and what the thing will take up
	get placementNow() { return this.placementOf(this.toolArmed, this.toolModeArmed, this.gesture); }
	get ghostNow() {
		const placement = this.placementNow;
		return placement ? this.creatorOf(this.toolArmed).ghostOf(this.toolArmed.create, placement, this.createContextOf()) : null;
	}

	// the gesture as the pointer moves over the canvas (null: it left)
	gestureSet(gesture) { this.gesture = gesture; }

	// the pointer went up: what the gesture stands for is made, and the tool let go (unless it is
	// kept armed). A gesture standing for nothing makes nothing, and the tool stays armed
	gestureEnd(editor) {
		const tool = this.toolArmed;
		if (this.gesture) this.gesture = { ...this.gesture, isEnd: true };
		const placement = this.placementNow;
		this.gesture = this.gesture ? { ...this.gesture, pointDown: null, isDragged: false, isEnd: false } : null;
		if (!tool || !placement) return;
		editor.change(() => this.toolPlace(tool, placement));
		if (!tool.isKeptArmed) this.toolDisarm();
	}

	// what a tool makes, where a placement says, as one step. placement: of a create mode, or a
	// point of the canvas ({ x, y }: its top left corner there)
	toolPlace(tool, placement, target = this.placeTarget) {
		const creator = this.creatorOf(tool);
		if (!creator) { this.store.message = `The tool ${tool.label} makes nothing.`; return null; }
		const placed = placement.kind ? placement : { kind: 'point', point: roundPoint(placement) };
		if (!creator.placementKindListGet(tool.create, this.createContextOf(target)).includes(placed.kind)) { this.store.message = `${tool.label} cannot be placed so.`; return null; }
		return creator.place(tool.create, placed, this.createContextOf(target));
	}

	// a node of a kind of the registry, with the data of a tool over that of the kind, at a place
	// ({ position, size?: the dimensions a gesture decided }); into a group (target: { groupId,
	// parentId }) or free. constraint: how it follows its parent, else it is kept where it stands
	nodeCreate(create, place, target = null, { constraint } = {}) {
		const entry = this.registry?.createEntryList.find(item => item.id === create.kind);
		if (!entry?.create) { this.store.message = `This diagram has no ${create.kind} to add.`; return null; }
		const base = entry.create(prefix => idNextOf(prefix, this.store.nodes));
		const size = { ...(base.size ?? {}), ...(create.size ?? {}), ...(place.size ?? {}) };
		const node = { ...base, data: { ...base.data, ...(create.data ?? {}) }, ...(Object.keys(size).length ? { size } : {}), ...(create.style ? { style: { ...(base.style ?? {}), ...create.style } } : {}) };
		const solved = target ? this.solve() : null;
		const memberId = target ? this.memberIdNext(target.groupId) : null;
		const isChanged = this.store.changeApply((documentNext) => {
			if (!documentNext.has('nodes')) documentNext.set('nodes', documentNext.createNode([]));
			documentNext.addIn(['nodes'], documentNext.createNode(target ? node : { ...node, position: roundPoint(place.position) }));
			if (target) this.memberWrite(documentNext, target.groupId, { id: memberId, node: node.id }, target.parentId, place.position, this.nodeSizeWrittenOf(node), solved, constraint);
		});
		if (isChanged) this.store.select(node.id);
		return isChanged ? node.id : null;
	}

	// a layout member, into a group; with no group to go to, a group of its own at that place. A
	// pattern (a layout type with slots) is made whole: a node of the kind each slot names fills it,
	// all in the same step
	layoutCreate(layout, position, target = null, { constraint } = {}) {
		const layoutType = this.catalog.layoutTypeByType[layout?.type];
		if (!layoutType) { this.store.message = `Unknown layout type ${layout?.type}.`; return null; }
		const groupId = target?.groupId ?? this.idGet(this.groupList.map(group => group.id));
		const memberId = target ? this.memberIdNext(groupId) : this.idGet([]);
		const member = { id: memberId, layout: { ...layoutType.paramDefault, ...layout } };
		const solved = target ? this.solve() : null;
		const slotFill = this.slotFillBuild(layoutType, groupId, memberId);
		if (slotFill === null) return null;
		const isChanged = this.store.changeApply((documentNext) => {
			if (target) this.memberWrite(documentNext, groupId, member, target.parentId, position, { width: 0, height: 0 }, solved, constraint);
			else this.groupWrite(documentNext, { id: groupId, root: roundPoint(position), memberList: [member] });
			if (slotFill.nodeList.length && !documentNext.has('nodes')) documentNext.set('nodes', documentNext.createNode([]));
			for (const node of slotFill.nodeList) documentNext.addIn(['nodes'], documentNext.createNode(node));
			const memberListPath = [KEY, 'groupList', target ? this.groupIndexOf(groupId) : this.groupList.length, 'memberList'];
			for (const child of slotFill.memberList) documentNext.addIn(memberListPath, documentNext.createNode(child));
		});
		if (isChanged) this.focusSet({ kind: 'member', groupId, memberId });
		return isChanged ? memberId : null;
	}

	// the nodes that fill the slots of a pattern made whole, and their members under it ({ nodeList,
	// memberList }; empty for a layout without slots); null, with the message, when a kind is missing
	slotFillBuild(layoutType, groupId, memberId) {
		const nodeList = [];
		const memberList = [];
		const memberIdTakenList = [...(this.groupModelGet(groupId)?.memberList.map(member => member.id) ?? []), memberId];
		for (const slot of layoutType.slotList ?? []) {
			if (!slot.create) continue;
			const entry = this.registry?.createEntryList.find(item => item.id === slot.create.kind);
			if (!entry?.create) { this.store.message = `${layoutType.label} needs a ${slot.create.kind}, which this diagram has not.`; return null; }
			const base = entry.create(prefix => idNextOf(prefix, [...this.store.nodes, ...nodeList]));
			const size = { ...(base.size ?? {}), ...(slot.create.size ?? {}) };
			const { position: _position, ...rest } = base;
			nodeList.push({ ...rest, data: { ...base.data, ...(slot.create.data ?? {}) }, ...(Object.keys(size).length ? { size } : {}), ...(slot.create.style ? { style: slot.create.style } : {}) });
			const childId = this.idGet(memberIdTakenList);
			memberIdTakenList.push(childId);
			memberList.push({ id: childId, node: nodeList[nodeList.length - 1].id, parent: memberId, slot: slot.id });
		}
		return { nodeList, memberList };
	}

	// a line from one point to another: each end on the handle that is there when the handle takes
	// it (the other way round when only that fits), else free at its point
	connectionCreateBetween(from, to) {
		const handleAt = point => this.canvas?.current?.handleNearestGet?.(point, 20) ?? null;
		const endOf = (handle, point) => (handle ? { nodeId: handle.nodeId, handleId: handle.handleId } : { position: roundPoint(point) });
		const canTake = (handle, role) => Boolean(handle) && !this.store.endpointAttachReasonGet(null, role, { nodeId: handle.nodeId, handleId: handle.handleId });
		let handleFrom = handleAt(from);
		let handleTo = handleAt(to);
		if (handleFrom && handleTo && handleFrom.nodeId === handleTo.nodeId && handleFrom.handleId === handleTo.handleId) handleTo = null;
		let source = endOf(canTake(handleFrom, 'source') ? handleFrom : null, from);
		let target = endOf(canTake(handleTo, 'target') ? handleTo : null, to);
		// drawn against the way its handles take lines: turned round
		if (handleFrom && handleTo && !canTake(handleFrom, 'source') && !canTake(handleTo, 'target') && canTake(handleTo, 'source') && canTake(handleFrom, 'target')) {
			source = endOf(handleTo, to);
			target = endOf(handleFrom, from);
		}
		const id = this.store.connectionCreate(source, target);
		if (id) this.store.selectConnection(id);
		return id;
	}

	// ---------- groups ----------

	groupWrite(documentNext, group) {
		if (!documentNext.hasIn([KEY])) documentNext.setIn([KEY], documentNext.createNode({ groupList: [] }));
		else if (!documentNext.hasIn([KEY, 'groupList'])) documentNext.setIn([KEY, 'groupList'], documentNext.createNode([]));
		documentNext.addIn([KEY, 'groupList'], documentNext.createNode(group));
	}

	// a group with its origin at a place; nodeIdList: nodes that go into it at once, where they stand
	groupAdd(position, { nodeIdList = [] } = {}) {
		const groupId = this.idGet(this.groupList.map(group => group.id));
		const root = roundPoint(position);
		const memberList = [];
		for (const nodeId of nodeIdList) {
			if (this.memberOfNode(nodeId)) { this.store.message = `${nodeId} is in a group already.`; return null; }
			const at = this.nodePositionGet(nodeId);
			memberList.push({ id: this.idGet(memberList.map(member => member.id)), node: nodeId, constraint: { type: 'offset', x: Math.round(at.x - root.x), y: Math.round(at.y - root.y) } });
		}
		const isChanged = this.store.changeApply((documentNext) => {
			this.groupWrite(documentNext, { id: groupId, root, memberList });
			for (const nodeId of nodeIdList) this.nodePositionDrop(documentNext, nodeId);
		});
		if (isChanged && !nodeIdList.length) this.focusSet({ kind: 'group', groupId });
		return isChanged ? groupId : null;
	}

	// a group goes alone: its nodes stay, free, where they stand
	groupRemove(groupId) {
		const solved = this.solve();
		const group = this.groupGet(groupId);
		if (!group) return false;
		const isChanged = this.store.changeApply((documentNext) => {
			for (const member of group.memberList ?? []) if (member.node) this.nodePositionWrite(documentNext, member.node, solved.positionById.get(member.node));
			documentNext.deleteIn([KEY, 'groupList', this.groupIndexOf(groupId)]);
		});
		if (isChanged && this.focus?.groupId === groupId) this.focus = null;
		return isChanged;
	}

	groupNameSet(groupId, name) {
		return this.store.changeApply((documentNext) => {
			const path = [KEY, 'groupList', this.groupIndexOf(groupId), 'name'];
			if (name) documentNext.setIn(path, name); else if (documentNext.hasIn(path)) documentNext.deleteIn(path);
		}, { groupKey: `parametric:group/${groupId}/name` });
	}

	// the origin at another place: the whole group moves. groupKey: a number being typed
	groupRootSet(groupId, position, { groupKey = null } = {}) {
		return this.store.changeApply(documentNext => documentNext.setIn([KEY, 'groupList', this.groupIndexOf(groupId), 'root'], documentNext.createNode(roundPoint(position))), { groupKey });
	}

	// ---------- members ----------

	memberIdNext(groupId) { return this.idGet((this.groupGet(groupId)?.memberList ?? []).map(member => member.id)); }

	nodePositionWrite(documentNext, nodeId, position) {
		if (position) documentNext.setIn([...this.store.nodePathGet(nodeId), 'position'], documentNext.createNode(roundPoint(position)));
	}

	// the position of a node that a group places from now on is not read: taken away
	nodePositionDrop(documentNext, nodeId) {
		if (!this.store.nodeGet(nodeId)) return;
		const path = [...this.store.nodePathGet(nodeId), 'position'];
		if (documentNext.hasIn(path)) documentNext.deleteIn(path);
	}


	// the constraint of a type, as written, that puts a box of `size` at `position` under parents:
	// inputBase over the defaults of the type, then the parameters a place decides (fromPlace)
	constraintAtPlace(type, inputBase, groupId, memberId, parentIdList, position, size, solved) {
		const constraintType = this.catalog.constraintTypeByType[type];
		if (!constraintType) throw new Error(`Unknown constraint type ${type}.`);
		if (constraintType.parentCount !== parentIdList.length) throw new Error(`A ${constraintType.label.toLowerCase()} constraint has ${constraintType.parentCount === 1 ? 'one parent' : `${constraintType.parentCount} parents`}.`);
		const input = { ...constraintType.paramDefault, ...inputBase, type };
		const read = constraintType.read(input, { field: 'constraint', pointRead });
		return constraintType.fromPlace(input, read, { size, parentBoxList: parentIdList.map(parentId => solved.boxByKey.get(groupKeyOf(groupId, parentId))) }, position);
	}

	// a member written into a group under a parent so that its box stands at `position`: by an
	// offset from a parent that is no layout; a layout parent places it, as its last child
	// (constraint: written as given instead, for a thing made to follow its parent in a way of its own)
	memberWrite(documentNext, groupId, member, parentId, position, size, solved, constraint) {
		const parent = parentId === MEMBER_ROOT_ID ? null : this.memberGet(groupId, parentId);
		if (parentId !== MEMBER_ROOT_ID && !parent) throw new Error('Unknown parent.');
		const written = { ...member, ...(parentId === MEMBER_ROOT_ID ? {} : { parent: parentId }) };
		if (!parent?.layout) written.constraint = constraint ?? this.constraintAtPlace('offset', {}, groupId, member.id, [parentId], position, size, solved);
		const groupPath = [KEY, 'groupList', this.groupIndexOf(groupId)];
		if (!documentNext.hasIn([...groupPath, 'memberList'])) documentNext.setIn([...groupPath, 'memberList'], documentNext.createNode([]));
		documentNext.addIn([...groupPath, 'memberList'], documentNext.createNode(written));
		if (member.node) this.nodePositionDrop(documentNext, member.node);
	}

	// a free node into a group, under its origin (or a parent), where it stands
	memberAdd(groupId, nodeId, { parentId = MEMBER_ROOT_ID } = {}) {
		if (this.memberOfNode(nodeId)) { this.store.message = `${nodeId} is in a group already.`; return null; }
		if (!this.store.nodeGet(nodeId)) return null;
		const solved = this.solve();
		const memberId = this.memberIdNext(groupId);
		const isChanged = this.store.changeApply(documentNext => this.memberWrite(documentNext, groupId, { id: memberId, node: nodeId }, parentId, this.nodePositionGet(nodeId), this.nodeSizeGet(nodeId), solved));
		return isChanged ? memberId : null;
	}

	// a member under another parent, where it stands. Under a layout member the layout places it
	// (isLast: as the last of its children, the member moved to the end of the group: nothing else
	// may be written by index after it). type: the constraint it gets under a parent that is no layout
	memberParentWrite(documentNext, groupId, memberId, parentIdNew, solved, { type = 'offset', isLast = false } = {}) {
		const path = this.memberPathOf(groupId, memberId);
		const parentNew = parentIdNew === MEMBER_ROOT_ID ? null : this.memberGet(groupId, parentIdNew);
		if (parentIdNew !== MEMBER_ROOT_ID && !parentNew) throw new Error('Unknown parent.');
		if (parentIdNew === memberId) throw new Error('A member cannot follow itself.');
		for (const key of ['parentList', 'slot']) if (documentNext.hasIn([...path, key])) documentNext.deleteIn([...path, key]);
		if (parentIdNew === MEMBER_ROOT_ID) { if (documentNext.hasIn([...path, 'parent'])) documentNext.deleteIn([...path, 'parent']); } else documentNext.setIn([...path, 'parent'], parentIdNew);
		if (parentNew?.layout) {
			if (documentNext.hasIn([...path, 'constraint'])) documentNext.deleteIn([...path, 'constraint']);
			// a pattern takes it into the first slot no other member fills; a pattern full refuses it
			const slotList = this.catalog.layoutTypeByType[parentNew.layout.type]?.slotList;
			if (slotList) {
				const slotTakenSet = new Set(this.groupModelGet(groupId).memberList.filter(other => other.id !== memberId && other.parentIdList[0] === parentIdNew).map(other => other.slot));
				const slot = slotList.find(item => !slotTakenSet.has(item.id));
				if (!slot) throw new Error(`${parentNew.name || parentIdNew} has no free slot: ${slotList.map(item => item.label).join(' and ')} are filled.`);
				documentNext.setIn([...path, 'slot'], slot.id);
			}
			if (isLast) {
				const written = documentNext.getIn(path, true);
				documentNext.deleteIn(path);
				documentNext.addIn(path.slice(0, -1), written);
			}
			return;
		}
		const box = solved.boxByKey.get(groupKeyOf(groupId, memberId));
		documentNext.setIn([...path, 'constraint'], documentNext.createNode(this.constraintAtPlace(type, {}, groupId, memberId, [parentIdNew], { x: box.x, y: box.y }, { width: box.width, height: box.height }, solved)));
	}

	memberParentSet(groupId, memberId, parentIdNew, option) {
		const solved = this.solve();
		return this.store.changeApply(documentNext => this.memberParentWrite(documentNext, groupId, memberId, parentIdNew, solved, { ...option, isLast: true }));
	}

	// a member between two parents, where it stands
	memberBetweenSet(groupId, memberId, parentIdA, parentIdB) {
		const solved = this.solve();
		return this.store.changeApply((documentNext) => {
			const path = this.memberPathOf(groupId, memberId);
			const box = solved.boxByKey.get(groupKeyOf(groupId, memberId));
			const constraint = this.constraintAtPlace('between', {}, groupId, memberId, [parentIdA, parentIdB], { x: box.x, y: box.y }, { width: box.width, height: box.height }, solved);
			for (const key of ['parent', 'slot']) if (documentNext.hasIn([...path, key])) documentNext.deleteIn([...path, key]);
			documentNext.setIn([...path, 'parentList'], documentNext.createNode([parentIdA, parentIdB]));
			documentNext.setIn([...path, 'constraint'], documentNext.createNode(constraint));
		});
	}

	// a member goes: its node stays, free, where it stands (isNodeRemoved: goes with it, its lines
	// left with a free end); what followed it follows its parent, where it stands
	memberRemove(groupId, memberId, { isNodeRemoved = false, positionGet } = {}) {
		const solved = this.solve();
		const member = this.memberGet(groupId, memberId);
		const group = this.groupModelGet(groupId);
		if (!member || !group) return false;
		const parentIdNew = group.memberById.get(memberId).parentIdList[0];
		const isChanged = this.store.changeApply((documentNext) => {
			for (const other of group.memberList) if (other.id !== memberId && other.parentIdList.includes(memberId)) this.memberParentWrite(documentNext, groupId, other.id, parentIdNew, solved);
			for (const other of group.memberList) {
				if (!other.sizeBinding) continue;
				for (const axis of ['width', 'height']) if (other.sizeBinding[axis]?.memberId === memberId) documentNext.deleteIn([...this.memberPathOf(groupId, other.id), 'size', axis]);
			}
			if (member.node && !isNodeRemoved) this.nodePositionWrite(documentNext, member.node, solved.positionById.get(member.node));
			documentNext.deleteIn(this.memberPathOf(groupId, memberId));
			if (member.node && isNodeRemoved) {
				this.store.endpointsDetach(documentNext, endpoint => endpoint.nodeId === member.node, positionGet);
				documentNext.deleteIn(this.store.nodePathGet(member.node));
			}
		});
		if (isChanged && this.focus?.memberId === memberId) this.focus = null;
		return isChanged;
	}

	// a child of a layout at an index among its siblings: their order is their order in the group
	memberOrderSet(groupId, memberId, index) {
		const list = this.groupGet(groupId)?.memberList ?? [];
		const member = list.find(item => item.id === memberId);
		if (!member) return false;
		const parentOf = item => (item.parentList ? item.parentList[0] : item.parent ?? MEMBER_ROOT_ID);
		const listWithout = list.filter(item => item.id !== memberId);
		const siblingList = listWithout.filter(item => parentOf(item) === parentOf(member));
		const indexSibling = Math.max(0, Math.min(siblingList.length, index));
		const at = indexSibling < siblingList.length ? listWithout.indexOf(siblingList[indexSibling]) : siblingList.length ? listWithout.indexOf(siblingList[siblingList.length - 1]) + 1 : listWithout.length;
		const listNext = [...listWithout.slice(0, at), member, ...listWithout.slice(at)];
		if (listNext.every((item, indexItem) => item === list[indexItem])) return false;
		return this.store.changeApply(documentNext => documentNext.setIn([KEY, 'groupList', this.groupIndexOf(groupId), 'memberList'], documentNext.createNode(listNext)));
	}

	// the node of a member dropped at a place of the canvas
	memberDrop(nodeId, position) {
		const at = this.memberOfNode(nodeId);
		const group = at ? this.groupModelGet(at.groupId) : null;
		const member = group?.memberById.get(at.memberId);
		if (!member) return false;
		const solved = this.solve();
		const boxOf = memberId => solved.boxByKey.get(groupKeyOf(group.id, memberId));
		const size = { width: boxOf(member.id).width, height: boxOf(member.id).height };
		const parentDirect = group.memberById.get(member.parentIdList[0]);
		if (parentDirect?.layout) {
			const layoutType = this.catalog.layoutTypeByType[parentDirect.layout.type];
			if (!layoutType.indexFromPlace) return false;
			const siblingList = group.childListOf(parentDirect.id).filter(item => item.id !== member.id);
			return this.memberOrderSet(group.id, member.id, layoutType.indexFromPlace(parentDirect.layout, siblingList.map(item => boxOf(item.id)), { ...position, ...size }));
		}
		const constraintType = this.catalog.constraintTypeByType[member.constraint.type];
		const input = this.memberGet(group.id, member.id).constraint ?? { type: member.constraint.type };
		const written = constraintType.fromPlace(input, member.constraint, { size, parentBoxList: member.parentIdList.map(boxOf) }, position);
		return this.store.changeApply(documentNext => documentNext.setIn([...this.memberPathOf(group.id, member.id), 'constraint'], documentNext.createNode(written)));
	}

	// a member resized by its resize handles (DiagramResizeHandles.jsx): its size written, and its constraint
	// made again so that its box stands where the corners put it, as one step (a child of a layout
	// takes the size alone: the layout places it). A node of no group is the engine's to resize
	// axisList: what of the size is written (a member as high as its content keeps its height auto)
	nodeResize(nodeId, { x, y, width, height, axisList = ['width', 'height'] }) {
		const at = this.memberOfNode(nodeId);
		const group = at ? this.groupModelGet(at.groupId) : null;
		const member = group?.memberById.get(at.memberId);
		if (!member) return false;
		const solved = this.solve();
		const size = { width: Math.round(width), height: Math.round(height) };
		const parentDirect = group.memberById.get(member.parentIdList[0]);
		this.store.changeApply((documentNext) => {
			for (const axis of axisList) documentNext.setIn([...this.store.nodePathGet(nodeId), 'size', axis], size[axis]);
			if (parentDirect?.layout) return;
			const input = this.memberGet(group.id, member.id).constraint ?? { type: member.constraint.type };
			const constraint = this.constraintAtPlace(member.constraint.type, input, group.id, member.id, member.parentIdList, { x: Math.round(x), y: Math.round(y) }, size, solved);
			documentNext.setIn([...this.memberPathOf(group.id, member.id), 'constraint'], documentNext.createNode(constraint));
		});
		return true;
	}

	// a parameter of the constraint of a member. groupKey: a value being typed, one step
	memberConstraintParamSet(groupId, memberId, key, value, { groupKey = null } = {}) {
		return this.store.changeApply((documentNext) => {
			const path = [...this.memberPathOf(groupId, memberId), 'constraint'];
			if (!documentNext.hasIn(path)) documentNext.setIn(path, documentNext.createNode({ type: 'offset' }));
			documentNext.setIn([...path, key], value !== null && typeof value === 'object' ? documentNext.createNode(value) : value);
		}, { groupKey });
	}

	// another constraint type for a member, with the parameters that keep it where it stands. A
	// type of two parents takes a second one (the origin, or the first other member that can
	// be one); a type of one keeps the first
	memberConstraintTypeSet(groupId, memberId, type) {
		const solved = this.solve();
		const group = this.groupModelGet(groupId);
		const member = group?.memberById.get(memberId);
		const constraintType = this.catalog.constraintTypeByType[type];
		if (!member || !constraintType) return false;
		return this.store.changeApply((documentNext) => {
			if (group.memberById.get(member.parentIdList[0])?.layout) throw new Error('Its layout places it: it has no constraint of its own.');
			const parentIdList = member.parentIdList.slice(0, constraintType.parentCount);
			if (parentIdList.length < constraintType.parentCount) {
				const descendantIdSet = new Set(group.descendantListOf(memberId).map(item => item.id));
				const second = [MEMBER_ROOT_ID, ...group.memberList.map(item => item.id)].find(id => id !== memberId && !parentIdList.includes(id) && !descendantIdSet.has(id));
				if (!second) throw new Error(`A ${constraintType.label.toLowerCase()} constraint needs another member to stand between.`);
				parentIdList.push(second);
			}
			const path = this.memberPathOf(groupId, memberId);
			const box = solved.boxByKey.get(groupKeyOf(groupId, memberId));
			const constraint = this.constraintAtPlace(type, {}, groupId, memberId, parentIdList, { x: box.x, y: box.y }, { width: box.width, height: box.height }, solved);
			for (const key of ['parent', 'parentList']) if (documentNext.hasIn([...path, key])) documentNext.deleteIn([...path, key]);
			if (parentIdList.length > 1) documentNext.setIn([...path, 'parentList'], documentNext.createNode(parentIdList));
			else if (parentIdList[0] !== MEMBER_ROOT_ID) documentNext.setIn([...path, 'parent'], parentIdList[0]);
			documentNext.setIn([...path, 'constraint'], documentNext.createNode(constraint));
		});
	}

	memberLayoutParamSet(groupId, memberId, key, value, { groupKey = null } = {}) {
		return this.store.changeApply(documentNext => documentNext.setIn([...this.memberPathOf(groupId, memberId), 'layout', key], value), { groupKey });
	}

	memberNameSet(groupId, memberId, name) {
		return this.store.changeApply((documentNext) => {
			const path = [...this.memberPathOf(groupId, memberId), 'name'];
			if (name) documentNext.setIn(path, name); else if (documentNext.hasIn(path)) documentNext.deleteIn(path);
		}, { groupKey: `parametric:member/${groupId}/${memberId}/name` });
	}

	// the width or the height of a member taken from another member; memberIdFrom null: its own again
	memberSizeBindingSet(groupId, memberId, axis, memberIdFrom) {
		return this.store.changeApply((documentNext) => {
			const path = [...this.memberPathOf(groupId, memberId), 'size'];
			if (memberIdFrom) documentNext.setIn([...path, axis], documentNext.createNode({ member: memberIdFrom }));
			else if (documentNext.hasIn([...path, axis])) {
				documentNext.deleteIn([...path, axis]);
				if (documentNext.getIn(path)?.items?.length === 0) documentNext.deleteIn(path);
			}
		});
	}

	// ---------- what the panel lists ----------

	// the words of a node in a list: what it says, then its kind
	nodeLabelOf(nodeId) {
		const node = this.store.nodeGet(nodeId);
		const data = node?.data ?? {};
		const words = [data.name, data.title, data.label, data.text].find(value => typeof value === 'string' && value.trim());
		return { label: words ?? nodeId, kindLabel: this.registry?.kindByType[node?.renderer?.type]?.label ?? node?.renderer?.component ?? 'Node' };
	}

	memberLabelOf(groupId, memberId) {
		if (memberId === MEMBER_ROOT_ID) return { label: 'Origin', kindLabel: '' };
		const member = this.memberGet(groupId, memberId);
		if (!member) return { label: memberId, kindLabel: '' };
		if (member.node) return this.nodeLabelOf(member.node);
		return { label: member.name || this.catalog.layoutTypeByType[member.layout?.type]?.label || 'Layout', kindLabel: 'Layout', isNameDefault: !member.name };
	}

	// how a member is placed, in a few words
	memberSummaryOf(groupId, memberId) {
		const group = this.groupModelGet(groupId);
		const member = group?.memberById.get(memberId);
		if (!member) return '';
		const parentDirect = group.memberById.get(member.parentIdList[0]);
		// a child of a pattern is its slot: the subject, the caption
		const layoutParent = parentDirect?.layout ? this.catalog.layoutTypeByType[parentDirect.layout.type] : null;
		const slot = layoutParent?.slotList?.find(item => item.id === member.slot);
		const placed = slot ? `its ${slot.label.toLowerCase()}` : layoutParent ? `in its ${layoutParent.label.toLowerCase()}` : this.catalog.constraintTypeByType[member.constraint.type].summaryOf(member.constraint);
		return member.layout ? `${this.catalog.layoutTypeByType[member.layout.type].summaryOf(member.layout)} · ${placed}` : placed;
	}

	// the lines of the groups, each under the member of its end more to the left
	get lineList() {
		const solved = this.solve();
		return parametricLineListGet(this.model, this.store.connections, (groupId, memberId) => solved.boxByKey.get(groupKeyOf(groupId, memberId))?.x);
	}

	// the scene as a tree: the groups with their members under their direct parents, then the free
	// elements. Flat, in the order drawn: { key, depth, kind, label, kindLabel, summary, hasChildren,
	// isCollapsed, isSelected, select: what a click focuses, target: what its menu is of }
	get treeItemList() {
		const result = [];
		const selected = this.selected;
		const lineList = this.lineList;
		const push = (item, childrenBuild) => {
			const isCollapsed = Boolean(this.panel.collapsedByKey[item.key]);
			result.push({ ...item, isCollapsed });
			const count = result.length;
			if (!isCollapsed) childrenBuild?.();
			result[count - 1].hasChildren = isCollapsed ? Boolean(item.hasChildrenFolded) : result.length > count;
		};
		for (const group of this.model.groupList) {
			const groupWritten = this.groupGet(group.id);
			const memberPush = (member, depth) => {
				const names = this.memberLabelOf(group.id, member.id);
				const lineOwnList = lineList.filter(line => line.groupId === group.id && line.memberIdDirect === member.id);
				const childList = group.childListOf(member.id);
				push({
					key: `member:${group.id}/${member.id}`, depth, kind: member.layout ? 'layout' : 'node', ...names, summary: this.memberSummaryOf(group.id, member.id),
					groupId: group.id, memberId: member.id, nodeId: member.nodeId, layoutType: member.layout?.type,
					isSelected: member.nodeId ? selected?.kind === 'node' && selected.nodeId === member.nodeId : selected?.kind === 'member' && selected.groupId === group.id && selected.memberId === member.id,
					hasChildrenFolded: childList.length + lineOwnList.length > 0,
				}, () => {
					for (const child of childList) memberPush(child, depth + 1);
					for (const line of lineOwnList) {
						const other = line.memberIdList.find(memberId => memberId !== member.id) ?? member.id;
						result.push({ key: `line:${line.connectionId}`, depth: depth + 1, kind: 'line', label: this.store.connectionGet(line.connectionId)?.label?.text || `to ${this.memberLabelOf(group.id, other).label}`, kindLabel: 'Line', summary: '', connectionId: line.connectionId, groupId: group.id, isSelected: selected?.kind === 'line' && selected.connectionId === line.connectionId, hasChildren: false });
					}
				});
			};
			push({ key: `group:${group.id}`, depth: 0, kind: 'group', label: groupWritten?.name || 'Group', isNameDefault: !groupWritten?.name, kindLabel: 'Group', summary: `root ${group.root.x}, ${group.root.y}`, groupId: group.id, isSelected: selected?.kind === 'group' && selected.groupId === group.id, hasChildrenFolded: group.memberList.length > 0 }, () => {
				for (const member of group.childListOf(MEMBER_ROOT_ID)) memberPush(member, 1);
			});
		}
		const lineIdSet = new Set(lineList.map(line => line.connectionId));
		const nodeFreeList = this.store.nodes.filter(node => !this.model.memberByNodeId.has(node.id));
		const connectionFreeList = this.store.connections.filter(connection => !lineIdSet.has(connection.id));
		if (nodeFreeList.length + connectionFreeList.length > 0) {
			push({ key: 'free', depth: 0, kind: 'free', label: 'Free elements', kindLabel: '', summary: `${nodeFreeList.length + connectionFreeList.length}`, isSelected: false, hasChildrenFolded: true }, () => {
				for (const node of nodeFreeList) result.push({ key: `node:${node.id}`, depth: 1, kind: 'node', ...this.nodeLabelOf(node.id), summary: '', nodeId: node.id, isSelected: selected?.kind === 'node' && selected.nodeId === node.id, hasChildren: false });
				for (const connection of connectionFreeList) result.push({ key: `line:${connection.id}`, depth: 1, kind: 'line', label: connection.label?.text || connection.id, kindLabel: 'Line', summary: '', connectionId: connection.id, isSelected: selected?.kind === 'line' && selected.connectionId === connection.id, hasChildren: false });
			});
		}
		return result;
	}

	// the tree narrowed by the words typed: the items holding every word, and what they stand under
	get treeItemListShown() {
		const wordList = this.panel.search.toLowerCase().split(/\s+/).filter(Boolean);
		const list = this.treeItemList;
		if (!wordList.length) return list;
		const isKept = list.map(item => wordList.every(word => `${item.label} ${item.kindLabel} ${item.summary}`.toLowerCase().includes(word)));
		const isShown = isKept.slice();
		list.forEach((item, index) => {
			if (!isKept[index]) return;
			let depth = item.depth;
			for (let before = index - 1; before >= 0 && depth > 0; before -= 1) if (list[before].depth < depth) { isShown[before] = true; depth = list[before].depth; }
		});
		return list.filter((item, index) => isShown[index]);
	}

	// the camera of the graph of relations in the panel ({ x, y, zoom }: where the graph is drawn in
	// its part, and how large), for the thing it is of (key): another thing selected starts from the
	// rest. Zoomed by the wheel around the pointer, panned by a drag (ParametricPanel.jsx)
	get graphCamera() { return this.panel.graphCamera?.key === this.graphKey ? this.panel.graphCamera : { key: this.graphKey, ...GRAPH_CAMERA_REST }; }
	get graphKey() { const selected = this.selected; return selected ? JSON.stringify(selected) : ''; }
	graphCameraSet(camera) { this.panel.graphCamera = { ...camera, key: this.graphKey, zoom: Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, camera.zoom)) }; }
	graphCameraReset() { this.panel.graphCamera = null; }

	panelSearchSet(text) { this.panel.search = text; }
	panelCollapsedSet(isCollapsed) { this.panel.isCollapsed = isCollapsed; }
	treeItemToggle(key) { this.panel.collapsedByKey = { ...this.panel.collapsedByKey, [key]: !this.panel.collapsedByKey[key] }; }

	// a click on an item of the tree focuses what it stands for
	treeItemSelect(item, editor) {
		if (item.nodeId) editor.select(item.nodeId);
		else if (item.connectionId) editor.selectConnection(item.connectionId);
		else if (item.kind === 'group') this.focusSet({ kind: 'group', groupId: item.groupId });
		else if (item.kind === 'layout') this.focusSet({ kind: 'member', groupId: item.groupId, memberId: item.memberId });
	}
}

function idNextOf(prefix, itemList) {
	let index = 1;
	while (itemList.some(item => item.id === `${prefix}-${index}`)) index += 1;
	return `${prefix}-${index}`;
}
