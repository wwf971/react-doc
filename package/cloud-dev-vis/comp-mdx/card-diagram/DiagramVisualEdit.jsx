import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Plus, Undo2, Waypoints } from '../../../../main/frontend/UICommon.js';
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
export const DiagramVisualEdit = observer(function DiagramVisualEdit({ data, config, onEvent, kind, registry, isInPopup = false, renderContent }) {
	const { compById, sourceStore } = useDocStores();
	const [result] = useState(() => {
		try {
			const resolve = (name, placement) => {
				const definition = compDefinitionNormalize(compById[compIdResolve(sourceStore.configDoc, name)]);
				return definition?.placementList?.includes(placement) ? definition.expose?.[placement] : undefined;
			};
			return { store: new DiagramEditStore(data.source || data.raw, kind, resolve, registry) };
		} catch (error) { return { message: error.message }; }
	});
	const canvas = useRef(null);
	const root = useRef(null);
	const session = config.edit?.session ?? {};
	const isLocked = session.status === 'submitting';
	const { store } = result;
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
		if (event.nativeEvent.isComposing) return;
		const isMod = (event.ctrlKey || event.metaKey) && !event.altKey;
		const key = event.key.toLowerCase();
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
			else if (store.display) editor.stepOut();
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
		// ---- the path of the edit card ----
		navigate: path => { store.pathSet(path); },
		select: (nodeId, options = {}) => { store.select(nodeId, options); },
		selectConnection: connectionId => { store.selectConnection(connectionId); },
		handleClick: (nodeId, handleId) => { store.handleClick(nodeId, handleId); },
		stepOut: () => { store.pathUp(); if (!store.display) focusRoot(); },
		clearSelection: () => { store.selectionClear(); focusRoot(); },
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
			return !store.endpointAttachReasonGet(interaction.connectionId, interaction.role, drop);
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
				change(() => store.connectionEndpointSet(interaction.connectionId, interaction.role, drop));
				store.interactionSet({ ...interaction, isDone: true });
			}
		},
		connectEnd: state => {
			const interaction = store.interaction;
			if (!interaction || interaction.type === 'reconnect') return;
			if (interaction.type === 'detach' && !interaction.isDone && state?.to) change(() => store.connectionEndpointSet(interaction.connectionId, interaction.role, { position: state.to }));
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
			change(() => store.connectionEndpointSet(interaction.connectionId, interaction.role, drop));
			store.interactionSet({ ...interaction, isDone: true });
		},
		reconnectEnd: (edge, handleType, state) => {
			const interaction = store.interaction;
			if (interaction?.type !== 'reconnect') return;
			if (!interaction.isDone && state?.to) change(() => store.connectionEndpointSet(interaction.connectionId, interaction.role, { position: state.to }));
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
				const authored = store.nodeGet(node.id);
				if (authored?.position && authored.position !== 'auto' && !authored.isPositionLocked) change(() => store.nodeMove(node.id, position));
			});
		},
		createOpen: (position, option) => { if (position) { store.selectionClear(); store.createOpen(position, option); } },
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
	return <div ref={root} tabIndex={-1} className={`doc-vis-edit${editor ? ' is-active' : ''}${isInPopup ? ' is-popup' : ''}`} onKeyDown={keyDown} onClick={event => {
		if (event.target === event.currentTarget || event.target.classList.contains('doc-vis-card-static')) editor?.clearSelection();
	}}>
		{result.message || reasonRefused ? <div role="alert" className="doc-edit-message doc-vis-edit-message">{result.message || reasonRefused}</div> : null}
		{store ? renderContent({ data: { ...data, source: store.rawDraft, raw: store.rawDraft }, editor }) : null}
		<EditFloatingPanel label={kind === 'diagram' ? 'Diagram' : 'Table'} head={store ? <>
			<span className={`doc-vis-dirty${store.isDirty ? ' is-dirty' : ''}`} role="status">{store.isDirty ? 'Unsaved changes' : 'No changes'}</span>
			{editor ? <span className="doc-vis-history" role="group" aria-label="History">
				<button type="button" className="doc-button-icon" title="Undo (Ctrl/⌘ + Z)" aria-label="Undo" disabled={isLocked || !store.history.isUndoAvailable} onClick={() => editor.undo({ isFromControl: true })}><Undo2 size={14} /></button>
				<button type="button" className="doc-button-icon is-mirrored" title="Redo (Ctrl/⌘ + Shift + Z)" aria-label="Redo" disabled={isLocked || !store.history.isRedoAvailable} onClick={() => editor.redo({ isFromControl: true })}><Undo2 size={14} /></button>
			</span> : null}
			{kind === 'diagram' && editor ? <button type="button" className="doc-button-icon" title="Add a node or a connection (or double-click the canvas)" aria-label="Add" disabled={isLocked} onClick={() => editor.createOpen(canvas.current?.centerGet())}><Plus size={14} /></button> : null}
			{kind === 'diagram' && editor && registry?.arrangerList?.length ? <ActionMenu label="Arrange: replaces the anchors of the lines" isLocked={isLocked} actionList={registry.arrangerList.map(arranger => ({ id: arranger.id, label: arranger.label, title: arranger.description, isDisabled: arranger.isApplicable ? !arranger.isApplicable(store.value) : false }))} onAction={arrangerId => change(() => {
				const arranger = registry.arrangerList.find(item => item.id === arrangerId);
				const geometry = diagramCanvasListGet().find(item => item.editorGet()?.store === store)?.geometryGet?.();
				const reportList = store.arrangeApply(arranger, { geometry });
				if (reportList?.length) store.message = reportList.map(item => item.message).join(' · ');
			})}><Waypoints size={14} /></ActionMenu> : null}
			{isFromAsset ? <span className="doc-vis-save-target">
				<span>Save to</span>
				<ValueMenu label="Save to" value={store.saveTarget} values={['asset', 'inline']} valueLabels={saveTargetLabels} isLocked={isLocked || !isAllowed} onChange={value => change(() => store.saveTargetSet(value))} />
			</span> : null}
		</> : null} actions={<EditActions status={session.status} message={session.message || store?.message} titleCancel="Cancel" isSubmitDisabled={!store || !isAllowed} onSubmit={submit} onCancel={cancel} />} />
		{editor && store.isCardShown ? <DiagramEditCard editor={editor} onKeyDown={keyDown} /> : null}
	</div>;
});
