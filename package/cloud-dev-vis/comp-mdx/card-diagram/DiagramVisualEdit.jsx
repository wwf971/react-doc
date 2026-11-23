import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Plus, Shapes, Undo2, Waypoints } from '../../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { compDefinitionNormalize, compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import { EditActions } from '../../../../main/comp-doc/edit/EditActions.jsx';
import { EditFloatingPanel } from '../../../../main/comp-doc/edit/EditFloatingPanel.jsx';
import { DiagramEditStore } from './DiagramEditStore.js';
import { DiagramEditCard } from './DiagramEditCard.jsx';
import { ActionMenu, ValueMenu } from './DiagramValueControls.jsx';
import { diagramCanvasListGet } from './DiagramCanvasRegistry.js';
import { endpointIsDangling, pointNodeIdBuild } from './DiagramERData.js';
import './DiagramVisualEdit.css';

const saveTargetLabels = { asset: 'Asset item', inline: 'Inline YAML' };
const endpointOf = (nodeId, handleId) => ({ nodeId, handleId: handleId ?? null });
// a key pressed in a text being typed (a cell, a field of the edit card, the
// search of the create panel) belongs to the field
const isInTextField = target => Boolean(target?.isContentEditable) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName);
const isPointNode = nodeId => String(nodeId).startsWith('~');
// the handle a dragged line was dropped on: the end of the React Flow
// connection that is not the handle the drag started from
const dropOf = (connection, from) => connection.source === from.nodeId && (connection.sourceHandle ?? null) === (from.handleId ?? null)
	? endpointOf(connection.target, connection.targetHandle)
	: endpointOf(connection.source, connection.sourceHandle);

// The visual edit mode of a card diagram and of a standalone card
// (card-diagram-impl.md#card-editing): the same renderer as the read view, given an
// `editor` that the cards, the handles and the canvas report to. The draft,
// its history and the path of the edit card live in DiagramEditStore; this
// component owns what belongs to the view: where the edit card stands
// (beside the principal of the path, anchorRectGet), the canvas api
// (positions of handles and nodes, the camera), the drag interactions of
// the canvas (connect, detach, reconnect, create), which it turns into
// store commands, and the keys of the editor (Escape, Ctrl/⌘ + Enter, undo
// and redo), handled here first so no keyboard map takes them from an open
// editor.
//
// What a host may say in config beside the edit session (a scene edited in place gives all of
// them: card-diagram-flexible-switch.md#a-scene-edited-in-place):
//   editScope     what of the draft may change (DiagramEditStore.js: scope); absent, everything
//   editLabel     the word of the bar, in the place of Diagram
//   editSelect    { nodeId, rowId?, fieldId?, propId?, connectionId?, isCell? }: what is focused
//                 when the editor opens (the thing clicked to start it); isCell: its value typed
//   onEditRest(report)   the author stepped out of everything: nothing is focused any more
//   createSourceList, createActionList, createRequest   of the panel of a double-click
//   featureList   ids of features of the registry offered here, beside those the viewport of the
//                 draft names (viewport.featureList)
//
// The features of the registry (node-registry.js: feature) join the editor of a diagram through a
// **session** each (feature.editCreate), which the editor asks before it does what it does by
// default. Everything is optional, and the editor knows no feature by name:
//   id, isOn                      the feature's id; whether this viewport offers it (read each render)
//   nodeDrop(node, position, editor)        a node dropped: true when the session took it
//   paneClick(position, editor)             a click on the empty canvas: true when taken
//   keyDown(event, editor)                  a key of the editor: true when taken
//   focusClear(), isFocused                 a focus of its own (what is not a node or a line)
//   nodeIsPlaced(nodeId)                    it places that node: the node's own position is not offered
//   nodeResize(nodeId, rect, editor)        a node resized by its resize handles (DiagramResizeHandles.jsx:
//                                           rect { x, y, width, height, isMoved, axisList }): true
//                                           when the session wrote it (a size and a place of its own)
//   createActionListGet(target, editor)     actions of the create panel, for the empty canvas or for
//                                           a thing right-clicked: { kind: canvas | node | line,
//                                           position, nodeId?, connectionId? }
//   createTextGet(target, editor)           { label, take(text, position) }: what words typed in the
//                                           create panel of the empty canvas make (a text), offered
//                                           first (DiagramCreatePanel.jsx: textTake); the first session's
//   cardSectionListGet(target, editor)      sections added to the edit card of a node
//   cardGet(editor)                         { model, anchorRectGet, close }: the edit card of its focus
//   isCardDocked                            it shows the edit card of what is selected in a place of
//                                           its own (its panel): no card floats beside the principal
//   cardHeadActionListGet(editor)           buttons of the head of the card floating beside the
//                                           principal: [{ id, label, Icon, act }] (dock it)
//   dispose()                               the editor is gone
//   CanvasLayer, Panel                      components, { session, editor }: over the canvas (inside
//                                           React Flow), and beside the viewport (ParametricPanel.jsx)
//   flowClassName                           a class of the canvas (a pointer of its own)
export const DiagramVisualEdit = observer(function DiagramVisualEdit({ data, config, onEvent, kind, registry, isInPopup = false, renderContent }) {
	const stores = useDocStores();
	const { compById, sourceStore } = stores;
	const [result] = useState(() => {
		try {
			const resolve = (name, placement) => {
				const definition = compDefinitionNormalize(compById[compIdResolve(sourceStore.configDoc, name)]);
				return definition?.placementList?.includes(placement) ? definition.expose?.[placement] : undefined;
			};
			return { store: new DiagramEditStore(data.source || data.raw, kind, resolve, registry, config.editScope) };
		} catch (error) { return { message: error.message }; }
	});
	const canvas = useRef(null);
	const root = useRef(null);
	const session = config.edit?.session ?? {};
	const isLocked = session.status === 'submitting';
	const { store } = result;
	// the sessions of the features of the registry, kept with the editor; the ones this viewport offers
	const [featureSessionList] = useState(() => (result.store && kind === 'diagram' ? (registry?.featureList ?? []).map(feature => feature.editCreate?.({
		store: result.store, registry, config, canvas, stores,
		isOnGet: () => Boolean(config.featureList?.includes(feature.id) || result.store.value.viewport?.featureList?.includes(feature.id)),
	})).filter(Boolean) : []));
	const featureList = featureSessionList.filter(item => item.isOn);
	useEffect(() => () => featureSessionList.forEach(item => item.dispose?.()), [featureSessionList]);
	// inline data is edited like any block; the data of an asset reference
	// only at its head and while the object is not locked, since a save
	// writes the head (the mode list already refuses other references)
	const asset = config.assetInfo;
	const isFromAsset = Boolean(asset?.isFromAsset);
	const reasonRefused = !isFromAsset ? ''
		: asset.isHead === false ? 'This block reads an older version of its asset; visual editing writes the head version.'
		: asset.isLocked ? 'The asset item is locked.'
		: '';
	const isAllowed = !reasonRefused;
	const report = () => { if (store) void onEvent?.('editDraftChange', store.report); };
	const focusRoot = () => root.current?.focus({ preventScroll: true });
	// every command, then the draft reported to the page. a control that acts
	// may be gone once the draft rendered (the toolbar of a row that lost the
	// focus to the row it inserted), leaving the keyboard focus on the body:
	// the editor takes it back, so the next key (Escape, undo) reaches it
	const change = operation => {
		if (isLocked) return;
		operation();
		report();
		requestAnimationFrame(() => { if (document.activeElement === document.body && root.current) focusRoot(); });
	};
	const submit = () => {
		if (!isLocked && store) {
			canvas.current?.viewRemember();
			void onEvent?.('editSubmitRequest', store.report);
		}
	};
	const cancel = () => { if (!isLocked) void onEvent?.('editCancelRequest'); };
	const isFixed = Boolean(store?.isStructureFixed);
	// nothing is focused any more: said to a host that wants to know (a session with no change ends there)
	const restReport = () => { if (store && !store.display && !store.cell && !store.create && !featureList.some(item => item.isFocused)) config.onEditRest?.(store.report); };
	// a line whose end was let go off every handle: free where it was dropped, or, where the
	// structure is given and a line joins two things or is not there, taken away
	// the end of a line that a handle takes when a carried end is dropped on it: the end carried,
	// or, on a handle that takes only the other end, that other end (a line picked up where it
	// leaves and dropped on a handle taking arrivals is given a new target); null: neither
	const dropRoleGet = (connectionId, role, drop) => {
		if (!store.endpointAttachReasonGet(connectionId, role, drop)) return role;
		const other = role === 'source' ? 'target' : 'source';
		return store.endpointAttachReasonGet(connectionId, other, drop) ? null : other;
	};
	const endFreeSet = (connectionId, role, position) => change(() => (isFixed ? store.connectionRemove(connectionId) : store.connectionEndpointSet(connectionId, role, { position })));
	// Escape steps out one level at a time: the cell being typed (restoring
	// it), the create panel, then one segment of the path (a cell to its row,
	// a row to the list of rows, the list to the card, the card to nothing).
	// it never ends the session, so a stray key cannot discard the draft;
	// Save, Cancel or a click outside do.
	// Ctrl/⌘ + Z undoes and Ctrl/⌘ + Shift + Z (or Ctrl/⌘ + Y) redoes the last
	// step of the draft (card-diagram-impl.md#history), except in a text
	// being typed, where the keys stay the browser's: the typing it takes
	// back reaches the draft through the field's input event, as the typing did
	const keyDown = event => {
		// a key a control inside took is the control's (the field of a cell of the cell edit layer
		// takes Escape and Ctrl/⌘ + Enter for itself and lets them bubble): the editor does not act
		// on it again (step out, save the session)
		if (event.nativeEvent.isComposing || event.defaultPrevented) return;
		const isMod = (event.ctrlKey || event.metaKey) && !event.altKey;
		const key = event.key.toLowerCase();
		// a feature first: a key of its own (a tool let go, its focus stepped out of)
		if (editor && !store.cell && !store.create && featureList.some(item => item.keyDown?.(event, editor))) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (event.key === 'Enter' && isMod) {
			event.preventDefault();
			event.stopPropagation();
			submit();
		} else if (isMod && (key === 'z' || key === 'y')) {
			if (isInTextField(event.target) || !store || !editor) return;
			event.preventDefault();
			event.stopPropagation();
			if (key === 'y' || event.shiftKey) editor.redo(); else editor.undo();
		} else if (event.key === 'Escape') {
			event.stopPropagation();
			if (!store || !editor) return;
			event.preventDefault();
			if (store.cell) editor.cancelCell();
			else if (store.create) editor.createClose();
			// a card of values alone shows no path to step along: Escape lets go of what is focused
			else if (store.display) { if (isFixed) editor.clearSelection(); else editor.stepOut(); }
			else restReport();
		} else if ((event.key === 'Delete' || event.key === 'Backspace') && !isInTextField(event.target) && store?.selection?.anchorId && editor) {
			// the anchor in focus (the only thing of a line a key removes)
			event.preventDefault();
			event.stopPropagation();
			change(() => store.connectionAnchorRemove(store.selection.connectionId, store.selection.anchorId));
			focusRoot();
		}
	};
	const editor = store && isAllowed ? {
		store, isLocked, change, canvas, kind,
		// ---- the features this viewport offers (their sessions) ----
		featureList,
		paneClick: position => featureList.some(item => item.paneClick?.(position, editor)),
		createActionListGet: target => [...(config.createActionList ?? []), ...featureList.flatMap(item => item.createActionListGet?.(target ?? { kind: 'canvas' }, editor) ?? [])],
		createTextGet: target => featureList.map(item => item.createTextGet?.(target ?? { kind: 'canvas' }, editor)).find(Boolean),
		// a node resized by its corners: its new box, as one step; a feature placing it writes it its way
		nodeResize: (nodeId, rect) => change(() => featureList.some(item => item.nodeResize?.(nodeId, rect, editor)) || store.nodeResize(nodeId, rect)),
		// a right-click: the panel of a double-click with what can be done there, when a feature or
		// the host has something to offer for it; false leaves the browser's own menu
		contextOpen: (target) => {
			if (isLocked || !featureList.length || !editor.createActionListGet(target).length) return false;
			if (target.kind === 'node') store.select(target.nodeId);
			else if (target.kind === 'line') store.selectConnection(target.connectionId);
			else store.selectionClear();
			store.createOpen(target.position, { target });
			return true;
		},
		// ---- the path of the edit card ----
		navigate: path => { store.pathSet(path); },
		select: (nodeId, options = {}) => { featureList.forEach(item => item.focusClear?.()); store.select(nodeId, options); },
		selectConnection: connectionId => { featureList.forEach(item => item.focusClear?.()); store.selectConnection(connectionId); },
		handleClick: (nodeId, handleId) => { store.handleClick(nodeId, handleId); },
		stepOut: () => { store.pathUp(); if (!store.display) { focusRoot(); restReport(); } },
		clearSelection: () => { featureList.forEach(item => item.focusClear?.()); store.selectionClear(); focusRoot(); restReport(); },
		cancelCell: () => { change(() => store.cellCancel()); focusRoot(); },
		// ---- the history of the draft ----
		// the draft put back a step; the focus returns to the editor root when
		// it came from a control outside it (the bar's buttons are portaled),
		// so the next key reaches the editor
		undo: ({ isFromControl = false } = {}) => { change(() => { if (store.undo() && isFromControl) focusRoot(); }); },
		redo: ({ isFromControl = false } = {}) => { change(() => { if (store.redo() && isFromControl) focusRoot(); }); },
		// where the edit card stands: beside the principal of the path as a
		// whole (the node on the canvas, the standalone card, the middle of a
		// line), never beside the row or the cell within it
		anchorRectGet: () => {
			const display = store.display;
			if (!display) return null;
			if (display.nodeId) {
				const fromCanvas = canvas.current?.nodeRectGet(display.nodeId);
				if (fromCanvas) return fromCanvas;
				return root.current?.querySelector(`[data-node-id="${CSS.escape(display.nodeId)}"]`)?.getBoundingClientRect() ?? null;
			}
			return canvas.current?.edgeRectGet(display.connectionId) ?? null;
		},
		handlePositionGet: (nodeId, handleId) => canvas.current?.handlePositionGet(nodeId, handleId),
		// ---- the route of a line ----
		// where the ends of a line are as the canvas drew them, in the terms of DiagramRoute.js
		connectionEndsGet: connectionId => canvas.current?.edgeEndsGet(connectionId, store.connectionGet(connectionId)),
		// an anchor where the line passes nearest to a point (a double-click on it), or at
		// the middle of the line
		anchorAdd: (connectionId, point) => {
			const ends = canvas.current?.edgeEndsGet(connectionId, store.connectionGet(connectionId));
			if (!ends) return null;
			return store.connectionAnchorAdd(connectionId, { point: point ?? { x: (ends.sourceX + ends.targetX) / 2, y: (ends.sourceY + ends.targetY) / 2 }, ends });
		},
		anchorSelect: (connectionId, anchorId) => { store.anchorSelect(connectionId, anchorId); focusRoot(); },
		focusRoot,
		nodePositionGet: nodeId => canvas.current?.positionGet(nodeId),
		// a drag from a handle: a new line, or, when a connection at the handle
		// is selected (or the handle takes one line and has it), that line
		// detached from the handle and carried by the pointer
		connectStart: (nodeId, handleId) => {
			if (store.interaction?.type === 'reconnect') return;
			const attached = store.handleConnectionListGet(nodeId, handleId);
			const handle = store.handleGet(nodeId, handleId);
			const selected = store.selection?.nodeId === nodeId ? attached.find(item => item.connection.id === store.selection.connectionId) : undefined;
			const detach = selected ?? (handle?.attachPolicy === 'single' && attached.length ? attached[0] : undefined);
			store.interactionSet(detach
				? { type: 'detach', connectionId: detach.connection.id, role: detach.role, fromNodeId: nodeId, fromHandleId: handleId, isDone: false }
				: { type: 'connect', fromNodeId: nodeId, fromHandleId: handleId });
		},
		connectionIsValid: connection => {
			const interaction = store.interaction;
			if (!interaction) return false;
			if (interaction.type === 'connect') {
				const a = endpointOf(connection.source, connection.sourceHandle);
				const b = endpointOf(connection.target, connection.targetHandle);
				if (isPointNode(a.nodeId) || isPointNode(b.nodeId)) return false;
				return Boolean(store.connectionOrient(a, b));
			}
			const drop = dropOf(connection, { nodeId: interaction.fromNodeId, handleId: interaction.fromHandleId });
			if (isPointNode(drop.nodeId)) return false;
			return dropRoleGet(interaction.connectionId, interaction.role, drop) !== null;
		},
		connect: connection => {
			const interaction = store.interaction;
			if (!interaction) return;
			if (interaction.type === 'connect') {
				const orient = store.connectionOrient(endpointOf(connection.source, connection.sourceHandle), endpointOf(connection.target, connection.targetHandle));
				if (!orient) return;
				change(() => { const id = store.connectionCreate(orient.source, orient.target); if (id) store.selectConnection(id); });
			} else if (interaction.type === 'detach') {
				const drop = dropOf(connection, { nodeId: interaction.fromNodeId, handleId: interaction.fromHandleId });
				const role = dropRoleGet(interaction.connectionId, interaction.role, drop);
				if (role) change(() => store.connectionEndpointSet(interaction.connectionId, role, drop));
				store.interactionSet({ ...interaction, isDone: true });
			}
		},
		connectEnd: state => {
			const interaction = store.interaction;
			if (!interaction || interaction.type === 'reconnect') return;
			if (interaction.type === 'detach' && !interaction.isDone && state?.to) endFreeSet(interaction.connectionId, interaction.role, state.to);
			store.interactionSet(null);
		},
		// an end of a line dragged by its anchor: React Flow names the handle
		// that stays (handleType), the end moved is the other one
		reconnectStart: (edge, handleType) => {
			const role = handleType === 'target' ? 'source' : 'target';
			const connection = store.connectionGet(edge.id);
			if (!connection) return;
			const other = role === 'source' ? 'target' : 'source';
			const from = endpointIsDangling(connection[other]) ? { nodeId: pointNodeIdBuild(edge.id, other), handleId: 'end' } : connection[other];
			store.interactionSet({ type: 'reconnect', connectionId: edge.id, role, fromNodeId: from.nodeId, fromHandleId: from.handleId, isDone: false });
		},
		reconnect: (edge, connection) => {
			const interaction = store.interaction;
			if (interaction?.type !== 'reconnect') return;
			const drop = dropOf(connection, { nodeId: interaction.fromNodeId, handleId: interaction.fromHandleId });
			const role = dropRoleGet(interaction.connectionId, interaction.role, drop);
			if (role) change(() => store.connectionEndpointSet(interaction.connectionId, role, drop));
			store.interactionSet({ ...interaction, isDone: true });
		},
		reconnectEnd: (edge, handleType, state) => {
			const interaction = store.interaction;
			if (interaction?.type !== 'reconnect') return;
			if (!interaction.isDone && state?.to) endFreeSet(interaction.connectionId, interaction.role, state.to);
			store.interactionSet(null);
		},
		nodeDragStart: node => { store.interactionSet({ type: 'nodeDrag', nodeId: node.id }); },
		// the last position change of a drag reaches the canvas store a frame
		// after the drop, so the final position is read then; the pointer is
		// where the author let go
		nodeDragStop: (node, pointer) => {
			if (store.interaction?.type === 'nodeDrag') store.interactionSet(null);
			requestAnimationFrame(() => {
				const position = canvas.current?.positionGet(node.id) ?? node.position;
				if (node.type === 'visualizationPoint') {
					// a free end dropped on a handle attaches there when the handle
					// takes it; anywhere else it stays where it was dropped
					const { connectionId, role } = node.data;
					const nearest = canvas.current?.handleNearestGet(pointer ?? position);
					const endpoint = nearest && !store.endpointAttachReasonGet(connectionId, role, nearest) ? { nodeId: nearest.nodeId, handleId: nearest.handleId } : { position: pointer ?? position };
					change(() => store.connectionEndpointSet(connectionId, role, endpoint));
					return;
				}
				// a feature may take the drop: a node it places is moved by a parameter of its rule
				if (featureList.some(item => item.nodeDrop?.(node, position, editor))) return;
				const authored = store.nodeGet(node.id);
				if (authored?.position && authored.position !== 'auto' && !authored.isPositionLocked) change(() => store.nodeMove(node.id, position));
			});
		},
		// a draft whose structure is given has a panel only for what its host offers there
		createOpen: (position, option) => { if (position && (!isFixed || config.createActionList?.length || config.createSourceList?.length)) { store.selectionClear(); store.createOpen(position, option); } },
		createClose: () => { store.createClose(); focusRoot(); },
		createChoose: (entry, position) => {
			store.createClose();
			// an entry of a source of the host (DiagramCreatePanel.jsx): the source adds it, with the
			// commands of the store, when it has what it needs
			if (entry.source) {
				void Promise.resolve(entry.source.choose(entry, position, editor)).catch(error => { store.message = String(error?.message ?? error); });
				return;
			}
			change(() => {
				if (entry.isConnection) store.connectionCreateDangling(position);
				else if (entry.nodeComponent) store.nodeComponentAdd(entry.nodeComponent.compName, entry.nodeComponent.data, position, entry.nodeComponent.idPrefix);
				else store.nodeAdd(entry.id, position);
			});
		},
	} : undefined;
	// a host asks for the create panel to be opened, in the state of one of its actions
	// (config.createRequest { actionId, key }): at the middle of the canvas, once it is there
	const createRequest = config.createRequest;
	const editorRef = useRef(editor);
	editorRef.current = editor;
	// what the host wants focused as the editor opens: the thing that was clicked to start it
	useEffect(() => {
		const wanted = config.editSelect;
		if (!wanted || !store) return;
		if (wanted.connectionId && !wanted.nodeId) store.selectConnection(wanted.connectionId);
		else if (wanted.nodeId && store.nodeGet(wanted.nodeId)) {
			store.select(wanted.nodeId, { rowId: wanted.rowId ?? null, fieldId: wanted.fieldId ?? null, propId: wanted.propId ?? null, connectionId: wanted.connectionId ?? null });
			const field = wanted.rowId ? wanted.fieldId : wanted.propId;
			// a text is typed at once; a choice opens its menu (the cell does, once it is drawn: cellOpenWanted)
			if (wanted.isCell && field && store.fieldIsEditable(wanted.nodeId, wanted.rowId ?? null, field)) {
				if (store.fieldDefinitionGet(store.nodeGet(wanted.nodeId), wanted.rowId ?? null, field)?.kind === 'enum') store.cellOpenWantedSet({ nodeId: wanted.nodeId, rowId: wanted.rowId ?? null, field });
				else store.cellStart(wanted.nodeId, wanted.rowId ?? null, field);
			}
		}
		if (!store.cell) focusRoot();
	}, []); // eslint-disable-line react-hooks/exhaustive-deps
	useEffect(() => {
		if (!createRequest?.key) return undefined;
		let frame;
		let tryCount = 0;
		const open = () => {
			const center = canvas.current?.centerGet?.();
			if (center && editorRef.current) editorRef.current.createOpen(center, { actionId: createRequest.actionId });
			else if ((tryCount += 1) < 40) frame = requestAnimationFrame(open);
		};
		frame = requestAnimationFrame(open);
		return () => cancelAnimationFrame(frame);
	}, [createRequest?.key]); // eslint-disable-line react-hooks/exhaustive-deps
	// the edit card of a focus of a feature (a thing that is not a node or a line), hidden like the
	// card of the path while something else is going on
	const isCardDocked = featureList.some(item => item.isCardDocked);
	const cardHeadActionList = editor && !isCardDocked ? featureList.flatMap(item => item.cardHeadActionListGet?.(editor) ?? []) : [];
	const featureCard = editor && !isCardDocked && !store.display && !store.cell && !store.interaction && !store.create ? featureList.map(item => item.cardGet?.(editor)).find(Boolean) ?? null : null;
	return <div ref={root} tabIndex={-1} className={`doc-vis-edit${editor ? ' is-active' : ''}${isInPopup ? ' is-popup' : ''}${editor && featureList.some(item => item.Panel) ? ' has-feature-panel' : ''}`} onKeyDown={keyDown} onClick={event => {
		if (event.target === event.currentTarget || event.target.classList.contains('doc-vis-card-static')) editor?.clearSelection();
	}}>
		{result.message || reasonRefused ? <div role="alert" className="doc-edit-message doc-vis-edit-message">{result.message || reasonRefused}</div> : null}
		{store ? renderContent({ data: { ...data, source: store.rawDraft, raw: store.rawDraft }, editor }) : null}
		{editor ? featureList.map(item => (item.Panel ? <item.Panel key={item.id} session={item} editor={editor} isInPopup={isInPopup} /> : null)) : null}
		<EditFloatingPanel label={config.editLabel ?? (kind === 'diagram' ? 'Diagram' : 'Table')} head={store ? <>
			<span className={`doc-vis-dirty${store.isDirty ? ' is-dirty' : ''}`} role="status">{store.isDirty ? 'Unsaved changes' : 'No changes'}</span>
			{editor ? <span className="doc-vis-history" role="group" aria-label="History">
				<button type="button" className="doc-button-icon" title="Undo (Ctrl/⌘ + Z)" aria-label="Undo" disabled={isLocked || !store.history.isUndoAvailable} onClick={() => editor.undo({ isFromControl: true })}><Undo2 size={14} /></button>
				<button type="button" className="doc-button-icon is-mirrored" title="Redo (Ctrl/⌘ + Shift + Z)" aria-label="Redo" disabled={isLocked || !store.history.isRedoAvailable} onClick={() => editor.redo({ isFromControl: true })}><Undo2 size={14} /></button>
			</span> : null}
			{kind === 'diagram' && editor && (!isFixed || config.createActionList?.length || config.createSourceList?.length) ? <button type="button" className="doc-button-icon" title={isFixed ? 'What can be added here (or double-click the canvas)' : 'Add a node or a connection (or double-click the canvas)'} aria-label="Add" disabled={isLocked} onClick={() => editor.createOpen(canvas.current?.centerGet())}><Plus size={14} /></button> : null}
			{kind === 'diagram' && editor && !isFixed && registry?.arrangerList?.length ? <ActionMenu label="Arrange: replaces the anchors of the lines" isLocked={isLocked} actionList={registry.arrangerList.map(arranger => ({ id: arranger.id, label: arranger.label, title: arranger.description, isDisabled: arranger.isApplicable ? !arranger.isApplicable(store.value) : false }))} onAction={arrangerId => change(() => {
				const arranger = registry.arrangerList.find(item => item.id === arrangerId);
				const geometry = diagramCanvasListGet().find(item => item.editorGet()?.store === store)?.geometryGet?.();
				const reportList = store.arrangeApply(arranger, { geometry });
				if (reportList?.length) store.message = reportList.map(item => item.message).join(' · ');
			})}><Waypoints size={14} /></ActionMenu> : null}
			{kind === 'diagram' && editor && !isFixed && registry?.kindList?.some(item => item.contract.simple) ? <ActionMenu label="Display: every node as its card, or as a simple mark" isLocked={isLocked} actionList={[
				{ id: 'detailed', label: 'Every node as its card', title: 'The detailed display: each node is the card of its kind' },
				{ id: 'simple', label: 'Every node as a simple mark', title: 'The simple display, for an overview: a mark with its name, the lines ending on it. Kinds without one keep their card' },
			]} onAction={display => change(() => store.diagramDisplaySet(display))}><Shapes size={14} /></ActionMenu> : null}
			{isFromAsset ? <span className="doc-vis-save-target">
				<span>Save to</span>
				<ValueMenu label="Save to" value={store.saveTarget} values={['asset', 'inline']} valueLabels={saveTargetLabels} isLocked={isLocked || !isAllowed} onChange={value => change(() => store.saveTargetSet(value))} />
			</span> : null}
		</> : null} actions={<EditActions status={session.status} message={session.message || store?.message} titleCancel="Cancel" isSubmitDisabled={!store || !isAllowed} onSubmit={submit} onCancel={cancel} />} />
		{featureCard ? <DiagramEditCard key="feature" editor={editor} onKeyDown={keyDown} card={featureCard} headActionList={cardHeadActionList} /> : editor && store.isCardShown && !isCardDocked ? <DiagramEditCard editor={editor} onKeyDown={keyDown} headActionList={cardHeadActionList} /> : null}
	</div>;
});
