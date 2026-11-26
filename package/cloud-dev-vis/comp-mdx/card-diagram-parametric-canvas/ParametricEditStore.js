import { computed, makeAutoObservable, observable, reaction } from 'mobx';
import { MEMBER_ROOT_ID, PARAMETRIC_DATA_KEY, PARAMETRIC_FEATURE_ID, groupKeyOf, memberIsFramedWhenRead, parametricLineListGet, parametricRead } from './ParametricData.js';
import { constraintContextBuild, memberParentListOf, nodeOutlineOf, parametricSolve } from './ParametricSolve.js';
import { OUTLINE_RECT, REFERENCE_SUBJECT_ORIGIN, outlineRead, referencePointLabelOf, referencePointOfOffset, referencePointRead, referencePointResolve, referencePointWrite } from './ParametricReferencePoint.js';
import { locatorLineAtNext, locatorLineListWrite } from './ParametricLocator.js';
import { toolListBuild, toolMapMerge } from './ParametricTool.js';
import { createModeParamOf } from './ParametricCreateMode.js';
import { actionListBuild, focusCardModelBuild, focusRectGet, modeCardModelBuild, nodeSectionListBuild } from './ParametricEditModel.js';
import { DiagramPanelTreeStore } from '../card-diagram/DiagramPanelTreeStore.js';
import { GRAPH_CAMERA_REST, panelGraphZoomClamp } from '../card-diagram/DiagramPanelGraph.jsx';

const KEY = PARAMETRIC_DATA_KEY;
const ID_CHAR_LIST = '0123456789abcdefghijklmnopqrstuvwxyz';
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
//   tree          the state of the tree of the tab Structure (DiagramPanelTreeStore: what is open, the
//                 pages, the search); graph: the camera of its graph of relations. The panel itself
//                 (folded, its tab, where the edit card stands) is the editor's (DiagramPanelStore)
//   toolBar       the state of the tool bar (ParametricToolBar.jsx): the dropdown open
//   mode          a mode of its own of the thing selected (card-diagram-parametric-canvas.md#modes-of-a-thing):
//                 what its edit card and the canvas show instead of its settings, until it is left.
//                 { kind: referencePoint, groupId, memberId, pointId? }: the reference points of a
//                 member (one of them open); { kind: locatorLine, groupId, memberId, axis, lineId? }:
//                 the lines of an axis of a locator (one of them open). It lasts while that member
//                 is what is selected
//   lineDrag      a line of a locator being dragged (ParametricLocatorLayer.jsx): nothing is written
//                 or placed anew until it is dropped
export class ParametricEditStore {
	id = PARAMETRIC_FEATURE_ID;
	focus = null;
	toolArmedId = null;
	toolModeId = null;
	gesture = null;
	tree = new DiagramPanelTreeStore();
	graph = { camera: null };
	toolBar = { openId: null, detailId: null, modeId: null };
	// the menu of a thing of the panel (a right-click on an item of its tree): { x, y, target, label }
	menu = null;
	mode = null;
	lineDrag = null;
	// the tools changed here when no config keeps them (toolMapPatch absent): over toolMapGet
	toolMapOwn = {};

	// store: the DiagramEditStore of the editor. canvas: the ref of the canvas api of the editor
	// (sizes as drawn, a dragged place given up). catalog: the constraint and layout types.
	// toolMapGet: the tools of the tool bar as the config has them. idGet(idTakenList): a new id
	// toolIconGet(tool): the icon of a tool, from whoever draws the tool bar. toolMapPatch(patch):
	// writes tools changed into what keeps the tool bar (a layer of the config); absent, they are
	// kept here, for the session
	// iconGet(name): an icon by its word (remove ...), from whoever draws
	// layoutUiByType: what a layout type shows of itself in the editor, by its type, from whoever
	// draws the feature ({ cardSectionListGet?, modeCardGet?, actionListGet?, CanvasLayer?: … }: a locator)
	constructor({ store, registry, config = {}, canvas, isOnGet, catalog, toolMapGet, toolMapPatch, toolIconGet, iconGet, layoutUiByType = {}, idGet = idRandomGet }) {
		Object.assign(this, { store, registry, config, canvas, isOnGet, catalog, toolMapGet, toolMapPatch, toolIconGet, iconGet, layoutUiByType, idGet });
		makeAutoObservable(this, { store: false, registry: false, config: false, canvas: false, isOnGet: false, catalog: false, toolMapGet: false, toolMapPatch: false, toolIconGet: false, iconGet: false, layoutUiByType: false, idGet: false, disposeList: false, tree: false, gesture: observable.ref, lineDrag: observable.ref, section: computed.struct, nodeBriefList: computed.struct, connectionEndList: computed.struct, lineList: computed.struct, treeIndex: computed.struct }, { autoBind: true });
		// a node or a line focused is the selection: the focus of a group lets go
		this.disposeList = [reaction(() => Boolean(this.store.display), (isShown) => { if (isShown) this.focus = null; })];
	}

	dispose() { this.disposeList.forEach(dispose => dispose()); }

	get isOn() { return this.isOnGet ? this.isOnGet() : true; }

	// ---------- the draft, read ----------

	// read by content (computed.struct), as what follows from them: a word typed in a node changes
	// neither, so the model, the lines and the tree of the panel are not read again for it
	get section() { return this.store.value[KEY] ?? {}; }
	// what the section is read against of each node: that it is there, what is drawn around others,
	// and its outline (the shape of its boundary, as its kind says it: its reference points)
	get nodeBriefList() { return this.store.nodes.map(node => ({ id: node.id, around: node.around, outline: nodeOutlineOf(node, this.registry) })); }
	get connectionEndList() { return this.store.connections.map(connection => ({ id: connection.id, source: { nodeId: connection.source?.nodeId }, target: { nodeId: connection.target?.nodeId } })); }
	// the groups as written
	get groupList() { return this.section.groupList ?? []; }
	// the model of the draft (ParametricData.js); the draft is valid, so it reads
	get model() { return parametricRead(this.section, { nodes: this.nodeBriefList, catalog: this.catalog }); }

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

	// ---------- a mode of the thing selected ----------

	// the mode while the member it is of is what is selected, and still there
	get modeShown() {
		const mode = this.mode;
		const selected = this.selected;
		if (!mode || !selected || selected.groupId !== mode.groupId || selected.memberId !== mode.memberId) return null;
		return this.groupModelGet(mode.groupId)?.memberById.has(mode.memberId) ? mode : null;
	}

	// the reference points of a member, in the place of its settings; pointId: one of them open
	referencePointModeEnter(groupId, memberId, pointId = null) { this.memberSelect(groupId, memberId); this.mode = { kind: 'referencePoint', groupId, memberId, pointId }; }
	// the lines of an axis of a locator; lineId: one of them open
	locatorLineModeEnter(groupId, memberId, axis, lineId = null) { this.memberSelect(groupId, memberId); this.mode = { kind: 'locatorLine', groupId, memberId, axis, lineId }; }
	// one level out: the thing open to its list, the list to the settings of the member
	modeUp() {
		const mode = this.modeShown;
		if (!mode) { this.mode = null; return; }
		if (mode.kind === 'referencePoint' && mode.pointId) this.mode = { ...mode, pointId: null };
		else if (mode.kind === 'locatorLine' && mode.lineId) this.mode = { ...mode, lineId: null };
		else this.mode = null;
	}
	modeLeave() { this.mode = null; }

	// a member made what is selected: its node by the path of the editor, a layout by the focus
	memberSelect(groupId, memberId) {
		const selected = this.selected;
		if (selected?.groupId === groupId && selected.memberId === memberId) return;
		const member = this.memberGet(groupId, memberId);
		if (member?.node) { this.focus = null; this.store.select(member.node); } else if (member) this.focusSet({ kind: 'member', groupId, memberId });
	}

	// ---------- hooks of the editor (DiagramVisualEdit.jsx: a session) ----------

	get flowClassName() { return this.toolArmedId ? 'is-parametric-tool-armed' : ''; }

	keyDown(event) {
		if (event.key !== 'Escape') return false;
		if (this.menu) { this.menu = null; return true; }
		if (this.toolBar.openId) { this.toolBarClose(); return true; }
		if (this.toolArmedId) { this.toolDisarm(); return true; }
		if (this.lineDrag) { this.lineDrag = null; return true; }
		if (this.modeShown) { this.modeUp(); return true; }
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
		return focus ? { model: modeCardModelBuild(this, editor) ?? focusCardModelBuild(this, focus, editor), anchorRectGet: () => focusRectGet(this, focus, editor), close: this.focusClear } : null;
	}

	// the edit card of a node while it is in a mode of its own (its reference points): in the place
	// of the card of its settings (DiagramEditCardModel.js: a session may answer the card)
	cardModelGet(target, editor) { return target?.nodeId ? modeCardModelBuild(this, editor) : null; }

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
	layoutCreate(layout, position, target = null, { constraint, childList } = {}) {
		const layoutType = this.catalog.layoutTypeByType[layout?.type];
		if (!layoutType) { this.store.message = `Unknown layout type ${layout?.type}.`; return null; }
		const groupId = target?.groupId ?? this.idGet(this.groupList.map(group => group.id));
		const memberId = target ? this.memberIdNext(groupId) : this.idGet([]);
		const member = { id: memberId, layout: { ...layoutType.paramDefault, ...layout } };
		const solved = target ? this.solve() : null;
		const slotFill = this.slotFillBuild(layoutType, groupId, memberId, childList);
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

	// the nodes a layout is made with, and their members under it ({ nodeList, memberList }): those
	// filling the slots of a pattern made whole, or the children a tool gives (childList: [{ kind,
	// data?, style?, size?, constraint? }], each with the constraint it stands by: the blocks of a
	// locator); empty otherwise. null, with the message, when a kind is missing
	slotFillBuild(layoutType, groupId, memberId, childList) {
		const nodeList = [];
		const memberList = [];
		const memberIdTakenList = [...(this.groupModelGet(groupId)?.memberList.map(member => member.id) ?? []), memberId];
		const entryList = childList?.length ? childList.map(child => ({ create: child, constraint: child.constraint })) : (layoutType.slotList ?? []).filter(slot => slot.create).map(slot => ({ create: slot.create, slot: slot.id }));
		for (const { create, slot, constraint } of entryList) {
			const entry = this.registry?.createEntryList.find(item => item.id === create.kind);
			if (!entry?.create) { this.store.message = `${layoutType.label} needs a ${create.kind}, which this diagram has not.`; return null; }
			const base = entry.create(prefix => idNextOf(prefix, [...this.store.nodes, ...nodeList]));
			const size = { ...(base.size ?? {}), ...(create.size ?? {}) };
			const { position: _position, ...rest } = base;
			nodeList.push({ ...rest, data: { ...base.data, ...(create.data ?? {}) }, ...(Object.keys(size).length ? { size } : {}), ...(create.style ? { style: create.style } : {}) });
			const childId = this.idGet(memberIdTakenList);
			memberIdTakenList.push(childId);
			memberList.push({ id: childId, node: nodeList[nodeList.length - 1].id, parent: memberId, ...(slot ? { slot } : {}), ...(constraint ? { constraint } : {}) });
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


	// ---------- reference points, read ----------

	get formatList() { return this.catalog.referenceFormatList; }
	// a reference point as written (what an edit card writes), read as the definition of a declared one
	referencePointReadOf(written) { return referencePointRead(written, 'point', this.formatList, { isOwnAllowed: false }); }

	// the subject of the reference points of a member (ParametricReferencePoint.js): its outline,
	// the points it declares, its default; the origin of the group for `root`
	memberSubjectOf(groupId, memberId) {
		return memberId === MEMBER_ROOT_ID ? REFERENCE_SUBJECT_ORIGIN : this.groupModelGet(groupId)?.memberById.get(memberId) ?? REFERENCE_SUBJECT_ORIGIN;
	}

	// the subject of a member not written yet: a node of the diagram, or a layout
	memberSubjectNewOf(member) {
		if (member.node) return { outline: outlineRead(nodeOutlineOf(this.store.nodeGet(member.node), this.registry)), referencePointList: [], referencePointDefault: null };
		const layoutType = this.catalog.layoutTypeByType[member.layout?.type];
		return { outline: layoutType?.outlineOf ? outlineRead(layoutType.outlineOf(layoutType.read(member.layout, 'layout'))) : OUTLINE_RECT, referencePointList: [], referencePointDefault: null };
	}

	// what the constraint of a member is solved with (ParametricSolve.js: constraintContextBuild),
	// from a solve. subjectById: subjects as they will be, for a change being written (a default
	// reference point changed, a line removed, a member not written yet)
	constraintContextOf(groupId, memberId, constraintType, constraint, parentIdList, size, solved, subjectById = {}) {
		const subjectOf = id => subjectById[id] ?? this.memberSubjectOf(groupId, id);
		return constraintContextBuild(this.catalog, constraintType, constraint, {
			member: subjectOf(memberId), size,
			parentList: parentIdList.map(subjectOf),
			parentBoxList: parentIdList.map(parentId => solved.boxByKey.get(groupKeyOf(groupId, parentId))),
		});
	}

	// the constraint of a type, as written, that puts a box of `size` exactly at `position` under
	// parents: inputBase over the defaults of the type, then the parameters a place decides
	// (fromPlace). isNew: a constraint being made for a member placed otherwise until now (on the
	// lines of a locator: the nearest ones)
	constraintAtPlace(type, inputBase, groupId, memberId, parentIdList, position, size, solved, { subjectById, isNew = false } = {}) {
		const constraintType = this.catalog.constraintTypeByType[type];
		if (!constraintType) throw new Error(`Unknown constraint type ${type}.`);
		if (constraintType.parentCount !== parentIdList.length) throw new Error(`A ${constraintType.label.toLowerCase()} constraint has ${constraintType.parentCount === 1 ? 'one parent' : `${constraintType.parentCount} parents`}.`);
		const input = { ...constraintType.paramDefault, ...inputBase, type };
		const context = this.constraintContextOf(groupId, memberId, constraintType, null, parentIdList, size, solved, subjectById);
		const reason = constraintType.parentReasonGet?.(context.parentList);
		if (reason) throw new Error(reason);
		const read = constraintType.read(input, { field: 'constraint', referencePointRead: (value, key) => referencePointRead(value, key, this.formatList), parentList: context.parentList });
		const contextRead = this.constraintContextOf(groupId, memberId, constraintType, read, parentIdList, size, solved, subjectById);
		return constraintType.fromPlace(input, read, { ...contextRead, isExact: true, isNew }, position);
	}

	// the constraints of members written again so that each stays where a solve has it, under
	// subjects as they will be: what keeps "nothing moves" when a reference point they measure by
	// goes or another becomes the default. inputOf(member): its constraint as written, changed where
	// the change asks (a key naming what is gone taken away)
	placesKeepWrite(documentNext, groupId, memberIdList, solved, { subjectById = {}, inputOf } = {}) {
		const group = this.groupModelGet(groupId);
		for (const memberId of memberIdList) {
			const member = group.memberById.get(memberId);
			if (!member || member.isArranged || !member.constraint) continue;
			const box = solved.boxByKey.get(groupKeyOf(groupId, memberId));
			const input = inputOf?.(member) ?? this.memberGet(groupId, memberId).constraint ?? { type: member.constraint.type };
			const constraint = this.constraintAtPlace(member.constraint.type, { ...input, type: member.constraint.type }, groupId, memberId, member.parentIdList, { x: box.x, y: box.y }, { width: box.width, height: box.height }, solved, { subjectById });
			documentNext.setIn([...this.memberPathOf(groupId, memberId), 'constraint'], documentNext.createNode(constraint));
		}
	}

	// a member written into a group under a parent so that its box stands at `position`: by an
	// offset from a parent that is no layout; a layout parent places it, as its last child
	// (constraint: written as given instead, for a thing made to follow its parent in a way of its own)
	memberWrite(documentNext, groupId, member, parentId, position, size, solved, constraint) {
		const parent = parentId === MEMBER_ROOT_ID ? null : this.memberGet(groupId, parentId);
		if (parentId !== MEMBER_ROOT_ID && !parent) throw new Error('Unknown parent.');
		const written = { ...member, ...(parentId === MEMBER_ROOT_ID ? {} : { parent: parentId }) };
		// the default constraint: its default reference point at an offset from that of its parent
		if (!this.layoutArrangesOf(parent)) written.constraint = constraint ?? this.constraintAtPlace('offset', {}, groupId, member.id, [parentId], position, size, solved, { subjectById: { [member.id]: this.memberSubjectNewOf(member) } });
		const groupPath = [KEY, 'groupList', this.groupIndexOf(groupId)];
		if (!documentNext.hasIn([...groupPath, 'memberList'])) documentNext.setIn([...groupPath, 'memberList'], documentNext.createNode([]));
		documentNext.addIn([...groupPath, 'memberList'], documentNext.createNode(written));
		if (member.node) this.nodePositionDrop(documentNext, member.node);
	}

	// the layout type of a member written, when it is a layout that arranges its children (it then
	// places them: they write no constraint); null for a locator, which leaves each its own
	layoutArrangesOf(memberWritten) {
		const layoutType = memberWritten?.layout ? this.catalog.layoutTypeByType[memberWritten.layout.type] : null;
		return layoutType && !layoutType.isChildConstrained ? layoutType : null;
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
		if (this.layoutArrangesOf(parentNew)) {
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
		// a size its constraint dictated until now (between two lines) becomes its own
		this.sizeDictatedKeepWrite(documentNext, groupId, memberId, solved);
		// a type that cannot place it under that parent (on lines, under what is no locator): an offset
		const typeUsed = this.catalog.constraintTypeByType[type]?.parentReasonGet?.([this.memberSubjectOf(groupId, parentIdNew)]) ? 'offset' : type;
		documentNext.setIn([...path, 'constraint'], documentNext.createNode(this.constraintAtPlace(typeUsed, {}, groupId, memberId, [parentIdNew], { x: box.x, y: box.y }, { width: box.width, height: box.height }, solved, { isNew: true })));
	}

	// the size the constraint of a member dictates (between two lines of a locator), written as the
	// size of its node: for a change after which the constraint no longer decides it, so nothing
	// changes size
	sizeDictatedKeepWrite(documentNext, groupId, memberId, solved) {
		const group = this.groupModelGet(groupId);
		const member = group?.memberById.get(memberId);
		if (!member?.nodeId || !member.constraint) return;
		const dictated = this.catalog.constraintTypeByType[member.constraint.type].sizeOf?.(member.constraint, { parentList: memberParentListOf(group, member) });
		const box = solved.boxByKey.get(groupKeyOf(groupId, memberId));
		for (const axis of ['width', 'height']) if (dictated?.[axis] !== undefined && box) documentNext.setIn([...this.store.nodePathGet(member.nodeId), 'size', axis], Math.max(1, Math.round(box[axis])));
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

	// a member goes: its node stays, free, where it stands (isNodeRemoved: goes with it, as a node goes:
	// its lines left with a free end, the backgrounds around it told; DiagramEditStore.nodeRemoveWrite);
	// what followed it follows its parent, where it stands
	memberRemove(groupId, memberId, { isNodeRemoved = false, positionGet, boxGet } = {}) {
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
			if (member.node && !isNodeRemoved) {
				this.nodePositionWrite(documentNext, member.node, solved.positionById.get(member.node));
				this.sizeDictatedKeepWrite(documentNext, groupId, memberId, solved);
			}
			documentNext.deleteIn(this.memberPathOf(groupId, memberId));
			if (member.node && isNodeRemoved) this.store.nodeRemoveWrite(documentNext, member.node, { positionGet, boxGet });
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
		if (member.isArranged) {
			const layoutType = this.catalog.layoutTypeByType[parentDirect.layout.type];
			if (!layoutType.indexFromPlace) return false;
			const siblingList = group.childListOf(parentDirect.id).filter(item => item.id !== member.id);
			return this.memberOrderSet(group.id, member.id, layoutType.indexFromPlace(parentDirect.layout, siblingList.map(item => boxOf(item.id)), { ...position, ...size }));
		}
		const constraintType = this.catalog.constraintTypeByType[member.constraint.type];
		const input = this.memberGet(group.id, member.id).constraint ?? { type: member.constraint.type };
		const written = constraintType.fromPlace(input, member.constraint, this.constraintContextOf(group.id, member.id, constraintType, member.constraint, member.parentIdList, size, solved), position);
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
		// an axis its constraint or a binding decides is not the node's to write
		const axisGivenList = this.memberSizeGivenAxisListOf(group.id, member.id);
		this.store.changeApply((documentNext) => {
			for (const axis of axisList) if (!axisGivenList.includes(axis)) documentNext.setIn([...this.store.nodePathGet(nodeId), 'size', axis], size[axis]);
			if (member.isArranged) return;
			const input = this.memberGet(group.id, member.id).constraint ?? { type: member.constraint.type };
			const constraint = this.constraintAtPlace(member.constraint.type, input, group.id, member.id, member.parentIdList, { x: Math.round(x), y: Math.round(y) }, size, solved);
			documentNext.setIn([...this.memberPathOf(group.id, member.id), 'constraint'], documentNext.createNode(constraint));
		});
		return true;
	}

	// the axes of the size of a member that its node does not decide: bound to another member, or
	// dictated by its constraint (between two lines of a locator). Its resize handles leave them alone
	memberSizeGivenAxisListOf(groupId, memberId) {
		const group = this.groupModelGet(groupId);
		const member = group?.memberById.get(memberId);
		if (!member) return [];
		const dictated = member.constraint ? this.catalog.constraintTypeByType[member.constraint.type].sizeOf?.(member.constraint, { parentList: memberParentListOf(group, member) }) ?? {} : {};
		return ['width', 'height'].filter(axis => member.sizeBinding?.[axis] || dictated[axis] !== undefined);
	}

	// a hook of the editor (DiagramRender.jsx): what the resize handles of a node change, less
	// what a group decides for it
	nodeResizeAxisListGet(nodeId, axisList) {
		const at = this.memberOfNode(nodeId);
		if (!at) return axisList;
		const axisGivenList = this.memberSizeGivenAxisListOf(at.groupId, at.memberId);
		return axisList.filter(axis => !axisGivenList.includes(axis));
	}

	// a parameter of the constraint of a member. groupKey: a value being typed, one step
	memberConstraintParamSet(groupId, memberId, key, value, { groupKey = null } = {}) {
		return this.memberConstraintPatch(groupId, memberId, { [key]: value }, { groupKey });
	}

	// keys of the constraint of a member written together (undefined: the key taken away, the
	// constraint then reads its default for it)
	memberConstraintPatch(groupId, memberId, patch, { groupKey = null } = {}) {
		return this.store.changeApply((documentNext) => {
			const path = [...this.memberPathOf(groupId, memberId), 'constraint'];
			if (!documentNext.hasIn(path)) documentNext.setIn(path, documentNext.createNode({ type: 'offset' }));
			for (const [key, value] of Object.entries(patch)) {
				if (value === undefined) { if (documentNext.hasIn([...path, key])) documentNext.deleteIn([...path, key]); } else documentNext.setIn([...path, key], value !== null && typeof value === 'object' ? documentNext.createNode(value) : value);
			}
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
			if (member.isArranged) throw new Error('Its layout places it: it has no constraint of its own.');
			const parentIdList = member.parentIdList.slice(0, constraintType.parentCount);
			if (parentIdList.length < constraintType.parentCount) {
				const descendantIdSet = new Set(group.descendantListOf(memberId).map(item => item.id));
				const second = [MEMBER_ROOT_ID, ...group.memberList.map(item => item.id)].find(id => id !== memberId && !parentIdList.includes(id) && !descendantIdSet.has(id));
				if (!second) throw new Error(`A ${constraintType.label.toLowerCase()} constraint needs another member to stand between.`);
				parentIdList.push(second);
			}
			const path = this.memberPathOf(groupId, memberId);
			const box = solved.boxByKey.get(groupKeyOf(groupId, memberId));
			this.sizeDictatedKeepWrite(documentNext, groupId, memberId, solved);
			const constraint = this.constraintAtPlace(type, {}, groupId, memberId, parentIdList, { x: box.x, y: box.y }, { width: box.width, height: box.height }, solved, { isNew: true });
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

	// a layout member framed when the diagram is read, or not; what its layout type says is not written
	memberFramedWhenReadSet(groupId, memberId, isFramed) {
		const member = this.groupModelGet(groupId)?.memberById.get(memberId);
		if (!member?.layout) return false;
		const isDefault = isFramed === memberIsFramedWhenRead({ ...member, isFramedWhenRead: null }, this.catalog);
		return this.store.changeApply((documentNext) => {
			const path = [...this.memberPathOf(groupId, memberId), 'isFramedWhenRead'];
			if (!isDefault) documentNext.setIn(path, isFramed); else if (documentNext.hasIn(path)) documentNext.deleteIn(path);
		});
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

	// ---------- removing what is selected (DiagramVisualEdit.jsx: a session's removalGet) ----------

	// what Delete takes away of what the layer has selected (DiagramRemove.js: a removal), and what
	// depends on it: in a mode of a member, the thing open in it (a reference point, a line of a
	// locator; nothing while only the list is shown); a group or a layout member focused; a node a
	// group places, as a member goes with its node. undefined: not the layer's (base, the engine's
	// removal of what the path selects, stands)
	removalGet(base, editor, { positionGet, boxGet } = {}) {
		const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
		// what becomes of one, or of several
		const verb = (count, one, many) => (count === 1 ? one : many);
		const removalOf = (fields, rectGet) => ({ dependentList: [], ...fields, ...(rectGet ? { rectGet } : {}) });
		const mode = this.modeShown;
		if (mode) {
			const names = this.memberLabelOf(mode.groupId, mode.memberId);
			if (mode.kind === 'referencePoint' && mode.pointId) {
				const member = this.groupModelGet(mode.groupId).memberById.get(mode.memberId);
				const declared = member.referencePointList.find(item => item.id === mode.pointId);
				if (!declared) return null;
				const isDefault = member.referencePointDefault?.format === 'own' && member.referencePointDefault.id === declared.id;
				const useCount = new Set(this.referencePointUseListOf(mode.groupId, mode.memberId).filter(use => (use.definition?.format === 'own' && use.definition.id === declared.id) || (isDefault && (!use.definition || use.definition.format === 'default'))).map(use => use.memberId)).size;
				return removalOf({
					key: `reference-point:${mode.groupId}/${mode.memberId}/${declared.id}`, kind: 'referencePoint',
					what: `the reference point "${declared.name || referencePointLabelOf(declared.point, member, this.formatList)}" of "${names.label}"`,
					dependentList: [
						...(useCount ? [{ id: 'measured', count: useCount, label: plural(useCount, 'thing measured from it', 'things measured from it'), effect: verb(useCount, 'is measured from the same place of the box: nothing moves', 'are measured from the same place of the box: nothing moves') }] : []),
						...(isDefault ? [{ id: 'default', count: 1, label: 'Its default reference point', effect: 'becomes the same place of the box, written out' }] : []),
					],
					run: () => this.memberReferencePointRemove(mode.groupId, mode.memberId, declared.id),
				});
			}
			if (mode.kind === 'locatorLine' && mode.lineId) {
				const lineList = this.locatorLineListOf(mode.groupId, mode.memberId, mode.axis);
				const line = lineList.find(item => item.id === mode.lineId);
				if (!line) return null;
				const layout = this.groupModelGet(mode.groupId).memberById.get(mode.memberId).layout;
				const useCount = this.locatorLineUseCountOf(mode.groupId, mode.memberId, mode.axis, line.id);
				return removalOf({
					key: `locator-line:${mode.groupId}/${mode.memberId}/${mode.axis}/${line.id}`, kind: 'locatorLine',
					what: `the ${mode.axis === 'x' ? 'vertical' : 'horizontal'} line "${line.name || line.id}" of "${names.label}"`,
					...(layout.xList.length + layout.yList.length <= 1 ? { reason: 'A locator keeps at least one line.' } : {}),
					dependentList: useCount ? [{ id: 'on-it', count: useCount, label: plural(useCount, 'thing stands', 'things stand') + ' on it', effect: verb(useCount, 'and stays where it stands, measured from the lines left', 'and stay where they stand, measured from the lines left') }] : [],
					run: () => this.locatorLineRemove(mode.groupId, mode.memberId, mode.axis, line.id),
				}, () => focusRectGet(this, { kind: 'member', groupId: mode.groupId, memberId: mode.memberId }, editor));
			}
			// a mode showing its list: what is in it is chosen first, the thing itself is not taken
			return null;
		}
		const focus = this.focusShown;
		if (focus?.kind === 'group') {
			const group = this.groupModelGet(focus.groupId);
			const nodeCount = group.memberList.filter(member => member.nodeId).length;
			const layoutCount = group.memberList.length - nodeCount;
			return removalOf({
				key: `group:${focus.groupId}`, kind: 'group', what: `the group "${this.groupGet(focus.groupId)?.name || 'Group'}"`,
				dependentList: [
					...(nodeCount ? [{ id: 'members', count: nodeCount, label: plural(nodeCount, 'member'), effect: verb(nodeCount, 'stays where it stands, as a free element', 'stay where they stand, as free elements') }] : []),
					...(layoutCount ? [{ id: 'layouts', count: layoutCount, label: plural(layoutCount, 'layout or locator', 'layouts and locators'), effect: verb(layoutCount, 'goes with it', 'go with it') }] : []),
				],
				run: () => this.groupRemove(focus.groupId),
			}, () => focusRectGet(this, focus, editor));
		}
		if (focus?.kind === 'member') {
			const group = this.groupModelGet(focus.groupId);
			const member = group.memberById.get(focus.memberId);
			const layoutType = this.catalog.layoutTypeByType[member.layout.type];
			const childCount = group.childListOf(member.id).length;
			const followerCount = group.memberList.filter(other => other.parentIdList[0] !== member.id && other.parentIdList.includes(member.id)).length;
			return removalOf({
				key: `member:${focus.groupId}/${focus.memberId}`, kind: 'layout', what: `the ${layoutType.label.toLowerCase()} "${this.memberLabelOf(focus.groupId, focus.memberId).label}"`,
				dependentList: [
					...(childCount ? [{ id: 'children', count: childCount, label: layoutType.isChildConstrained ? `${plural(childCount, 'thing stands', 'things stand')} on its lines` : plural(childCount, 'thing it arranges', 'things it arranges'), effect: verb(childCount, (layoutType.isChildConstrained ? 'and stays' : 'stays') + ' where it stands, following what it followed', (layoutType.isChildConstrained ? 'and stay' : 'stay') + ' where they stand, following what it followed') }] : []),
					...(followerCount ? [{ id: 'followers', count: followerCount, label: plural(followerCount, 'thing placed from it', 'things placed from it'), effect: verb(followerCount, 'stays where it stands', 'stay where they stand') }] : []),
				],
				run: () => this.memberRemove(focus.groupId, focus.memberId),
			}, () => focusRectGet(this, focus, editor));
		}
		// a node a group places: it goes with its member, what followed it following its parent
		if (base?.kind === 'node') {
			const at = this.memberOfNode(base.nodeId);
			if (!at) return undefined;
			const group = this.groupModelGet(at.groupId);
			const followerCount = group.memberList.filter(member => member.id !== at.memberId && member.parentIdList.includes(at.memberId)).length;
			const boundCount = group.memberList.filter(member => ['width', 'height'].some(axis => member.sizeBinding?.[axis]?.memberId === at.memberId)).length;
			return {
				...base,
				dependentList: [
					...base.dependentList,
					...(followerCount ? [{ id: 'followers', count: followerCount, label: plural(followerCount, 'thing placed from it', 'things placed from it'), effect: verb(followerCount, 'follows what it followed, where it stands', 'follow what it followed, where they stand') }] : []),
					...(boundCount ? [{ id: 'bound', count: boundCount, label: plural(boundCount, 'thing sized by it', 'things sized by it'), effect: verb(boundCount, 'keeps the size it has', 'keep the size they have') }] : []),
				],
				run: () => this.memberRemove(at.groupId, at.memberId, { isNodeRemoved: true, positionGet, boxGet }),
			};
		}
		return undefined;
	}

	// ---------- reference points (ParametricReferencePoint.js) ----------

	// the reference point a new one of a member starts as: the first thing its outline offers that
	// is not its default (a box: the middle of its left edge; a round thing: north; a polygon: its
	// first corner; a locator: its first lines)
	referencePointStartOf(outline) {
		if (outline.kind === 'ellipse') return { format: 'angle', angle: 0 };
		if (outline.kind === 'polygon') return { format: 'vertex', vertex: 1 };
		if (outline.kind === 'lines') return { format: 'line', lineX: outline.xList[0]?.id ?? null, lineY: outline.yList[0]?.id ?? null };
		return { format: 'edge', side: 'left', index: 1, count: 2 };
	}

	// the reference points a member declares, as written
	memberReferencePointListWrittenOf(groupId, memberId) { return this.memberGet(groupId, memberId)?.referencePointList ?? []; }

	// a reference point declared by a member: answers its id
	memberReferencePointAdd(groupId, memberId, { point, name = '' } = {}) {
		const member = this.groupModelGet(groupId)?.memberById.get(memberId);
		if (!member) return null;
		const idTakenList = member.referencePointList.map(item => item.id);
		let index = idTakenList.length + 1;
		while (idTakenList.includes(`p${index}`)) index += 1;
		const id = `p${index}`;
		const written = { id, ...(name ? { name } : {}), point: referencePointWrite(point ?? this.referencePointStartOf(member.outline), this.formatList) };
		const isChanged = this.store.changeApply((documentNext) => {
			const path = [...this.memberPathOf(groupId, memberId), 'referencePointList'];
			if (!documentNext.hasIn(path)) documentNext.setIn(path, documentNext.createNode([]));
			documentNext.addIn(path, documentNext.createNode(written));
		});
		return isChanged ? id : null;
	}

	// its name, or where it is (a definition, as read). Moving a reference point moves what is
	// measured by it: that is what it is for. groupKey: a value being typed
	memberReferencePointSet(groupId, memberId, pointId, { name, point } = {}, { groupKey = null } = {}) {
		const index = this.memberReferencePointListWrittenOf(groupId, memberId).findIndex(item => item.id === pointId);
		if (index < 0) return false;
		return this.store.changeApply((documentNext) => {
			const path = [...this.memberPathOf(groupId, memberId), 'referencePointList', index];
			if (name !== undefined) { if (name) documentNext.setIn([...path, 'name'], name); else if (documentNext.hasIn([...path, 'name'])) documentNext.deleteIn([...path, 'name']); }
			if (point !== undefined) {
				const written = referencePointWrite(point, this.formatList);
				if (written === undefined || point.format === 'own') throw new Error('A declared reference point says where it is itself.');
				documentNext.setIn([...path, 'point'], typeof written === 'object' ? documentNext.createNode(written) : written);
			}
		}, { groupKey });
	}

	// every reference point parameter of the constraints of a group that is read on a member (its
	// own, of: self; of those following it, of: its place among their parents): what a change of
	// the points of that member touches. [{ memberId, key, definition }]
	referencePointUseListOf(groupId, memberId) {
		const group = this.groupModelGet(groupId);
		const result = [];
		for (const member of group?.memberList ?? []) {
			if (!member.constraint) continue;
			for (const definition of this.catalog.constraintTypeByType[member.constraint.type].propertyList ?? []) {
				if (definition.kind !== 'referencePoint') continue;
				const subjectId = definition.of === 'self' ? member.id : member.parentIdList[definition.of];
				if (subjectId === memberId) result.push({ memberId: member.id, key: definition.id, definition: member.constraint[definition.id] });
			}
		}
		return result;
	}

	// a declared reference point goes: what was measured by it is measured by the same place of
	// the box, written out, so nothing moves
	memberReferencePointRemove(groupId, memberId, pointId) {
		const group = this.groupModelGet(groupId);
		const member = group?.memberById.get(memberId);
		const index = this.memberReferencePointListWrittenOf(groupId, memberId).findIndex(item => item.id === pointId);
		if (!member || index < 0) return false;
		const box = this.solve().boxByKey.get(groupKeyOf(groupId, memberId));
		const inPlace = referencePointWrite(referencePointOfOffset(referencePointResolve({ format: 'own', id: pointId }, member, box, this.formatList), box), this.formatList);
		const isChanged = this.store.changeApply((documentNext) => {
			const path = this.memberPathOf(groupId, memberId);
			for (const use of this.referencePointUseListOf(groupId, memberId)) {
				if (use.definition?.format === 'own' && use.definition.id === pointId) documentNext.setIn([...this.memberPathOf(groupId, use.memberId), 'constraint', use.key], typeof inPlace === 'object' ? documentNext.createNode(inPlace) : inPlace);
			}
			if (member.referencePointDefault?.format === 'own' && member.referencePointDefault.id === pointId) documentNext.setIn([...path, 'referencePointDefault'], typeof inPlace === 'object' ? documentNext.createNode(inPlace) : inPlace);
			documentNext.deleteIn([...path, 'referencePointList', index]);
			if (documentNext.getIn([...path, 'referencePointList'])?.items?.length === 0) documentNext.deleteIn([...path, 'referencePointList']);
		});
		if (isChanged && this.mode?.kind === 'referencePoint' && this.mode.pointId === pointId) this.mode = { ...this.mode, pointId: null };
		return isChanged;
	}

	// the default reference point of a member: one it declares (its id), a definition, or null (that
	// of its outline again). What is measured by its default (its own offset, the offsets of what
	// follows it) is written again so that nothing moves
	memberReferencePointDefaultSet(groupId, memberId, value) {
		const group = this.groupModelGet(groupId);
		const member = group?.memberById.get(memberId);
		if (!member) return false;
		const definition = value === null || value === undefined ? null : typeof value === 'string' ? { format: 'own', id: value } : value;
		if (definition?.format === 'own' && !member.referencePointList.some(item => item.id === definition.id)) { this.store.message = `It declares no reference point "${definition.id}".`; return false; }
		const solved = this.solve();
		const affectedIdList = [...new Set(this.referencePointUseListOf(groupId, memberId).filter(use => !use.definition || use.definition.format === 'default').map(use => use.memberId))];
		return this.store.changeApply((documentNext) => {
			const path = [...this.memberPathOf(groupId, memberId), 'referencePointDefault'];
			const written = referencePointWrite(definition, this.formatList);
			if (written === undefined) { if (documentNext.hasIn(path)) documentNext.deleteIn(path); } else documentNext.setIn(path, typeof written === 'object' ? documentNext.createNode(written) : written);
			this.placesKeepWrite(documentNext, groupId, affectedIdList, solved, { subjectById: { [memberId]: { ...member, referencePointDefault: definition } } });
		});
	}

	// ---------- the lines of a locator (ParametricLocator.js) ----------

	// the lines of an axis ('x': its vertical lines, 'y': its horizontal ones) of a locator, as read
	locatorLineListOf(groupId, memberId, axis) {
		const layout = this.groupModelGet(groupId)?.memberById.get(memberId)?.layout;
		return layout?.type === 'locator' ? layout[axis === 'x' ? 'xList' : 'yList'] : [];
	}

	locatorLineListWriteIn(documentNext, groupId, memberId, axis, lineList) {
		const path = [...this.memberPathOf(groupId, memberId), 'layout', axis === 'x' ? 'xList' : 'yList'];
		if (lineList.length) documentNext.setIn(path, documentNext.createNode(locatorLineListWrite(lineList)));
		else if (documentNext.hasIn(path)) documentNext.deleteIn(path);
	}

	// a line added to an axis: after its last one unless a place is given; answers its id
	locatorLineAdd(groupId, memberId, axis, { at, name = '' } = {}) {
		const lineList = this.locatorLineListOf(groupId, memberId, axis);
		if (this.groupModelGet(groupId)?.memberById.get(memberId)?.layout?.type !== 'locator') return null;
		const id = this.idGet(lineList.map(line => line.id), 4);
		const isChanged = this.store.changeApply(documentNext => this.locatorLineListWriteIn(documentNext, groupId, memberId, axis, [...lineList, { id, at: Math.round(at ?? locatorLineAtNext(lineList)), name }]));
		return isChanged ? id : null;
	}

	// the place or the name of a line. isFollowerShifted: the lines after it on its axis move as
	// far (the gap before it changes, the others keep theirs). What stands on the lines follows
	locatorLineSet(groupId, memberId, axis, lineId, { at, name } = {}, { groupKey = null, isFollowerShifted = false } = {}) {
		const lineList = this.locatorLineListOf(groupId, memberId, axis);
		const line = lineList.find(item => item.id === lineId);
		if (!line) return false;
		const delta = at === undefined ? 0 : Math.round(at) - line.at;
		const listNext = lineList.map((item) => {
			if (item.id === lineId) return { ...item, ...(at !== undefined ? { at: Math.round(at) } : {}), ...(name !== undefined ? { name } : {}) };
			return isFollowerShifted && delta && item.at > line.at ? { ...item, at: item.at + delta } : item;
		});
		return this.store.changeApply(documentNext => this.locatorLineListWriteIn(documentNext, groupId, memberId, axis, listNext), { groupKey });
	}

	// a line goes: what stood on it stays where it stands, measured from what is left (a box that
	// ran to it keeps its size as its own)
	locatorLineRemove(groupId, memberId, axis, lineId) {
		const group = this.groupModelGet(groupId);
		const locator = group?.memberById.get(memberId);
		const lineList = this.locatorLineListOf(groupId, memberId, axis);
		if (!locator || !lineList.some(line => line.id === lineId)) return false;
		if (locator.layout.xList.length + locator.layout.yList.length <= 1) { this.store.message = 'A locator keeps at least one line.'; return false; }
		const key = axis === 'x' ? 'lineX' : 'lineY';
		const listNext = lineList.filter(line => line.id !== lineId);
		const layoutNext = { ...locator.layout, [axis === 'x' ? 'xList' : 'yList']: listNext };
		const solved = this.solve();
		// a definition as written with the line taken out of it: the origin of the locator on that axis
		const pointWithout = written => (!written || typeof written !== 'object' || Array.isArray(written) || String(written[key] ?? '') !== lineId ? written : { ...written, [key]: null });
		const followerList = group.memberList.filter(member => member.parentIdList.includes(memberId) && member.constraint);
		const isChanged = this.store.changeApply((documentNext) => {
			const path = this.memberPathOf(groupId, memberId);
			// the points the locator declares, and its default, no longer name the line
			const pointListWritten = this.memberReferencePointListWrittenOf(groupId, memberId);
			pointListWritten.forEach((item, index) => {
				const next = pointWithout(item.point);
				if (next !== item.point) documentNext.setIn([...path, 'referencePointList', index, 'point'], documentNext.createNode(next));
			});
			const defaultWritten = this.memberGet(groupId, memberId).referencePointDefault;
			const defaultNext = pointWithout(defaultWritten);
			if (defaultNext !== defaultWritten) documentNext.setIn([...path, 'referencePointDefault'], documentNext.createNode(defaultNext));
			this.locatorLineListWriteIn(documentNext, groupId, memberId, axis, listNext);
			const outline = outlineRead(this.catalog.layoutTypeByType.locator.outlineOf(layoutNext));
			const subjectById = { [memberId]: { ...locator, layout: layoutNext, outline, referencePointList: locator.referencePointList.map(item => (item.point.format === 'line' && item.point[key] === lineId ? { ...item, point: { ...item.point, [key]: null } } : item)), referencePointDefault: locator.referencePointDefault?.format === 'line' && locator.referencePointDefault[key] === lineId ? { ...locator.referencePointDefault, [key]: null } : locator.referencePointDefault } };
			// what follows it: a box that ran to the line keeps its size, and every constraint is
			// written again without the line, so that its member stays where it stands
			for (const follower of followerList) {
				const written = this.memberGet(groupId, follower.id).constraint ?? {};
				const isSpanGone = Array.isArray(written[key]) && written[key].map(String).includes(lineId);
				if (isSpanGone) this.sizeDictatedAxisKeepWrite(documentNext, groupId, follower.id, solved, axis === 'x' ? 'width' : 'height');
			}
			this.placesKeepWrite(documentNext, groupId, followerList.map(member => member.id), solved, {
				subjectById,
				inputOf: (member) => {
					const written = { ...(this.memberGet(groupId, member.id).constraint ?? { type: member.constraint.type }) };
					for (const [name, value] of Object.entries(written)) {
						if (name === key && (Array.isArray(value) ? value.map(String).includes(lineId) : String(value) === lineId)) delete written[name];
						else written[name] = pointWithout(value);
					}
					return written;
				},
			});
		});
		if (isChanged && this.mode?.kind === 'locatorLine' && this.mode.lineId === lineId) this.mode = { ...this.mode, lineId: null };
		return isChanged;
	}

	// how many members stand on a line of a locator: name it in their constraint (a line, a span from
	// or to it), or measure from a reference point of the locator on it
	locatorLineUseCountOf(groupId, memberId, axis, lineId) {
		const key = axis === 'x' ? 'lineX' : 'lineY';
		const isOn = (name, value) => Boolean(value) && typeof value === 'object' && (name === key ? value.line === lineId || value.from === lineId || value.to === lineId : value.format === 'line' && value[key] === lineId);
		return (this.groupModelGet(groupId)?.memberList ?? []).filter(member => member.parentIdList.includes(memberId) && member.constraint && Object.entries(member.constraint).some(([name, value]) => isOn(name, value))).length;
	}

	// one axis of a size a constraint dictates, written as the size of the node
	sizeDictatedAxisKeepWrite(documentNext, groupId, memberId, solved, axis) {
		const member = this.groupModelGet(groupId)?.memberById.get(memberId);
		const box = solved.boxByKey.get(groupKeyOf(groupId, memberId));
		if (member?.nodeId && box) documentNext.setIn([...this.store.nodePathGet(member.nodeId), 'size', axis], Math.max(1, Math.round(box[axis])));
	}

	// where the chevrons of a locator stand (chevronX, chevronY): a number from its origin, or null
	// (beside its lines again). Nothing else moves
	locatorChevronSet(groupId, memberId, key, value, { groupKey = null } = {}) {
		return this.store.changeApply((documentNext) => {
			const path = [...this.memberPathOf(groupId, memberId), 'layout', key];
			if (value === null || value === undefined) { if (documentNext.hasIn(path)) documentNext.deleteIn(path); } else documentNext.setIn(path, Math.round(value));
		}, { groupKey });
	}

	// a line of a locator dragged on the canvas: held here while the drag lasts ({ groupId, memberId,
	// axis, lineId, at, isFollowerShifted, isOverCancel }), so nothing is solved or drawn anew until
	// it is dropped; dropped, it is written as one step, unless it was let go over the cancel area
	lineDragSet(lineDrag) { this.lineDrag = lineDrag; }
	lineDragEnd({ isCancelled = false } = {}) {
		const drag = this.lineDrag;
		this.lineDrag = null;
		if (!drag || isCancelled || drag.isOverCancel) return false;
		if (drag.axis === 'chevronX' || drag.axis === 'chevronY') return this.locatorChevronSet(drag.groupId, drag.memberId, drag.axis, drag.at);
		return this.locatorLineSet(drag.groupId, drag.memberId, drag.axis, drag.lineId, { at: drag.at }, { isFollowerShifted: drag.isFollowerShifted });
	}

	// ---------- what the panel lists ----------

	// the words of a node in a list: what it says, then its kind. Read off the draft the canvas
	// draws (rawShown): a word typed reaches the lists of the panel when it reaches the copies
	nodeLabelOf(nodeId) {
		const node = this.store.nodeShownGet?.(nodeId) ?? this.store.nodeGet(nodeId);
		const data = node?.data ?? {};
		const words = [data.name, data.title, data.label, data.text].find(value => typeof value === 'string' && value.trim());
		return { label: words ?? nodeId, kindLabel: this.registry?.kindByType[node?.renderer?.type]?.label ?? node?.renderer?.component ?? 'Node' };
	}

	memberLabelOf(groupId, memberId) {
		if (memberId === MEMBER_ROOT_ID) return { label: 'Origin', kindLabel: '' };
		const member = this.memberGet(groupId, memberId);
		if (!member) return { label: memberId, kindLabel: '' };
		if (member.node) return this.nodeLabelOf(member.node);
		// a layout that arranges nothing is called by what it is (a locator)
		const layoutType = this.catalog.layoutTypeByType[member.layout?.type];
		return { label: member.name || layoutType?.label || 'Layout', kindLabel: layoutType?.isChildConstrained ? layoutType.label : 'Layout', isNameDefault: !member.name };
	}

	// how a member is placed, in a few words
	memberSummaryOf(groupId, memberId) {
		const group = this.groupModelGet(groupId);
		const member = group?.memberById.get(memberId);
		if (!member) return '';
		const parentDirect = group.memberById.get(member.parentIdList[0]);
		// a child of a pattern is its slot: the subject, the caption
		const layoutParent = member.isArranged ? this.catalog.layoutTypeByType[parentDirect.layout.type] : null;
		const slot = layoutParent?.slotList?.find(item => item.id === member.slot);
		const constraintType = member.constraint ? this.catalog.constraintTypeByType[member.constraint.type] : null;
		const parentList = memberParentListOf(group, member);
		// the words of a reference point a constraint names: of the member, or of the parent it is of
		const pointLabelOf = (key) => {
			const of = constraintType?.propertyList?.find(definition => definition.id === key)?.of;
			return referencePointLabelOf(member.constraint[key], of === undefined || of === 'self' ? member : parentList[of], this.formatList).toLowerCase();
		};
		const placed = slot ? `its ${slot.label.toLowerCase()}` : layoutParent ? `in its ${layoutParent.label.toLowerCase()}` : constraintType.summaryOf(member.constraint, { pointLabelOf, parentList });
		return member.layout ? `${this.catalog.layoutTypeByType[member.layout.type].summaryOf(member.layout)} · ${placed}` : placed;
	}

	// the lines of the groups, each under the member of its end more to the left
	get lineList() {
		const solved = this.solve();
		return parametricLineListGet(this.model, this.connectionEndList, (groupId, memberId) => solved.boxByKey.get(groupKeyOf(groupId, memberId))?.x);
	}

	// the scene as a tree (the tab Structure, a paged tree of the panel: DiagramPanelTreeData.js): the
	// groups with their members under their direct parents, the lines of a group under the member of
	// their end more to the left, then the free elements. Read by content: a word typed reaches it when
	// it reaches the canvas, and nothing is laid out again for a change that leaves it as it was.
	//   item   { key, kind: group | node | layout | line | free, label, kindLabel, summary, isNameDefault?,
	//            groupId?, memberId?, nodeId?, connectionId?, layoutType? }
	get treeIndex() {
		const itemByKey = {};
		const childKeyListByKey = {};
		const parentKeyByKey = {};
		const rootKeyList = [];
		const add = (item, parentKey) => {
			itemByKey[item.key] = item;
			parentKeyByKey[item.key] = parentKey;
			if (parentKey) (childKeyListByKey[parentKey] ??= []).push(item.key);
			else rootKeyList.push(item.key);
		};
		const lineList = this.lineList;
		const lineListByMember = new Map();
		for (const line of lineList) {
			const at = `${line.groupId}/${line.memberIdDirect}`;
			if (!lineListByMember.has(at)) lineListByMember.set(at, []);
			lineListByMember.get(at).push(line);
		}
		const lineLabelOf = connectionId => (this.store.connectionShownGet?.(connectionId) ?? this.store.connectionGet(connectionId))?.label?.text;
		for (const group of this.model.groupList) {
			const groupWritten = this.groupGet(group.id);
			const groupKey = `group:${group.id}`;
			add({ key: groupKey, kind: 'group', label: groupWritten?.name || 'Group', isNameDefault: !groupWritten?.name, kindLabel: '', summary: `root ${group.root.x}, ${group.root.y}`, groupId: group.id }, '');
			const memberAdd = (member, parentKey) => {
				const key = `member:${group.id}/${member.id}`;
				add({ key, kind: member.layout ? 'layout' : 'node', ...this.memberLabelOf(group.id, member.id), summary: this.memberSummaryOf(group.id, member.id), groupId: group.id, memberId: member.id, nodeId: member.nodeId, layoutType: member.layout?.type }, parentKey);
				for (const child of group.childListOf(member.id)) memberAdd(child, key);
				for (const line of lineListByMember.get(`${group.id}/${member.id}`) ?? []) {
					const other = line.memberIdList.find(memberId => memberId !== member.id) ?? member.id;
					add({ key: `line:${line.connectionId}`, kind: 'line', label: lineLabelOf(line.connectionId) || `to ${this.memberLabelOf(group.id, other).label}`, kindLabel: 'Line', summary: '', connectionId: line.connectionId, groupId: group.id }, key);
				}
			};
			for (const member of group.childListOf(MEMBER_ROOT_ID)) memberAdd(member, groupKey);
		}
		const lineIdSet = new Set(lineList.map(line => line.connectionId));
		const nodeFreeList = this.store.nodes.filter(node => !this.model.memberByNodeId.has(node.id));
		const connectionFreeList = this.store.connections.filter(connection => !lineIdSet.has(connection.id));
		if (nodeFreeList.length + connectionFreeList.length > 0) {
			add({ key: 'free', kind: 'free', label: 'Free elements', kindLabel: '', summary: '' }, '');
			for (const node of nodeFreeList) add({ key: `node:${node.id}`, kind: 'node', ...this.nodeLabelOf(node.id), summary: '', nodeId: node.id }, 'free');
			for (const connection of connectionFreeList) add({ key: `line:${connection.id}`, kind: 'line', label: lineLabelOf(connection.id) || connection.id, kindLabel: 'Line', summary: '', connectionId: connection.id }, 'free');
		}
		return { itemByKey, childKeyListByKey, parentKeyByKey, rootKeyList };
	}

	// the model the paged tree reads (DiagramPanelTreeData.js): one object while the index is the same
	get treeModel() {
		const { itemByKey, childKeyListByKey, parentKeyByKey, rootKeyList } = this.treeIndex;
		return {
			rootKeyList,
			itemGet: key => itemByKey[key],
			childKeyListGet: key => childKeyListByKey[key] ?? [],
			parentKeyGet: key => parentKeyByKey[key] ?? '',
			searchTextGet: (key) => { const item = itemByKey[key]; return item ? `${item.label} ${item.kindLabel ?? ''} ${item.summary ?? ''}` : ''; },
			// everything open at first: a long level is paged
			isExpandedDefault: () => true,
		};
	}

	// the key of what is selected in the tree
	get selectedKey() {
		const selected = this.selected;
		if (!selected) return null;
		if (selected.kind === 'line') return `line:${selected.connectionId}`;
		if (selected.kind === 'group') return `group:${selected.groupId}`;
		if (selected.kind === 'member') return `member:${selected.groupId}/${selected.memberId}`;
		return selected.memberId ? `member:${selected.groupId}/${selected.memberId}` : `node:${selected.nodeId}`;
	}

	// the camera of the graph of relations in the panel ({ x, y, zoom }: where the graph is drawn in
	// its part, and how large), for the thing it is of (key): another thing selected starts from the
	// rest. Zoomed by the wheel around the pointer, panned by a drag (DiagramPanelGraph.jsx)
	get graphCamera() { return this.graph.camera?.key === this.graphKey ? this.graph.camera : { key: this.graphKey, ...GRAPH_CAMERA_REST }; }
	get graphKey() { const selected = this.selected; return selected ? JSON.stringify(selected) : ''; }
	graphCameraSet(camera) { this.graph.camera = { ...camera, key: this.graphKey, zoom: panelGraphZoomClamp(camera.zoom) }; }
	graphCameraReset() { this.graph.camera = null; }

	// a click on an item of the tree focuses what it stands for
	treeItemSelect(itemOrKey, editor) {
		const item = typeof itemOrKey === 'string' ? this.treeIndex.itemByKey[itemOrKey] : itemOrKey;
		if (!item) return;
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
