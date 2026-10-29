import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Plus } from '../../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { compDefinitionNormalize, compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import { EditActions } from '../../../../main/comp-doc/edit/EditActions.jsx';
import { EditFloatingPanel } from '../../../../main/comp-doc/edit/EditFloatingPanel.jsx';
import { DiagramEditStore } from './DiagramEditStore.js';
import { DiagramEditCard } from './DiagramEditCard.jsx';
import { ValueMenu } from './DiagramValueControls.jsx';
import { endpointIsDangling, pointNodeIdBuild } from './DiagramERData.js';
import './DiagramVisualEdit.css';

const saveTargetLabels = { asset: 'Asset object', inline: 'Inline YAML' };
const endpointOf = (nodeId, handleId) => ({ nodeId, handleId: handleId ?? null });
const isPointNode = nodeId => String(nodeId).startsWith('~');
// the handle a dragged line was dropped on: the end of the React Flow
// connection that is not the handle the drag started from
const dropOf = (connection, from) => connection.source === from.nodeId && (connection.sourceHandle ?? null) === (from.handleId ?? null)
	? endpointOf(connection.target, connection.targetHandle)
	: endpointOf(connection.source, connection.sourceHandle);

// The visual edit mode of DiagramER and DiagramDataverseEntity
// (comp_db_vis.md#card-editing): the same renderer as the read view, given an
// `editor` that the cards, the handles and the canvas report to. The draft
// lives in DiagramEditStore; this component owns what belongs to the view:
// the element the edit card is anchored to, the canvas api (positions of
// handles and nodes, the camera), and the drag interactions of the canvas
// (connect, detach, reconnect, create), which it turns into store commands.
export const DiagramVisualEdit = observer(function DiagramVisualEdit({ data, config, onEvent, kind, isInPopup = false, renderContent }) {
	const { compById, sourceStore } = useDocStores();
	const [result] = useState(() => {
		try {
			const resolve = (name, placement) => {
				const definition = compDefinitionNormalize(compById[compIdResolve(sourceStore.configDoc, name)]);
				return definition?.placementList?.includes(placement) ? definition.expose?.[placement] : undefined;
			};
			return { store: new DiagramEditStore(data.source || data.raw, kind, resolve) };
		} catch (error) { return { message: error.message }; }
	});
	const anchor = useRef(null);
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
		: asset.isLocked ? 'The asset object is locked.'
		: '';
	const isAllowed = !reasonRefused;
	const report = () => { if (store) void onEvent?.('editDraftChange', store.report); };
	const change = operation => { if (!isLocked) { operation(); report(); } };
	const submit = () => {
		if (!isLocked && store) {
			canvas.current?.viewRemember();
			void onEvent?.('editSubmitRequest', store.report);
		}
	};
	const cancel = () => { if (!isLocked) void onEvent?.('editCancelRequest'); };
	// Escape steps out one level at a time: the cell being typed (restoring
	// it), the create panel, then the selection. it never ends the session,
	// so a stray key cannot discard the draft; Save, Cancel or a click outside do
	const keyDown = event => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			event.stopPropagation();
			submit();
		} else if (event.key === 'Escape') {
			event.stopPropagation();
			if (!store || !editor) return;
			event.preventDefault();
			if (store.cell) editor.cancelCell();
			else if (store.create) editor.createClose();
			else if (store.selection) editor.clearSelection();
		}
	};
	const editor = store && isAllowed ? {
		store, isLocked, change, canvas, kind,
		anchorSet: target => { anchor.current = target; },
		select: (nodeId, options = {}, element) => { if (element) anchor.current = element; store.select(nodeId, options); },
		selectConnection: connectionId => { anchor.current = { getRect: () => canvas.current?.edgeRectGet(connectionId) }; store.selectConnection(connectionId); },
		handleClick: (nodeId, handleId, element) => { anchor.current = element; store.handleClick(nodeId, handleId); },
		cancelCell: () => { change(() => store.cellCancel()); root.current?.focus({ preventScroll: true }); },
		clearSelection: () => { anchor.current = null; store.selectionClear(); root.current?.focus({ preventScroll: true }); },
		handlePositionGet: (nodeId, handleId) => canvas.current?.handlePositionGet(nodeId, handleId),
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
				change(() => { const id = store.connectionCreate(orient.source, orient.target); if (id) editor.selectConnection(id); });
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
		createOpen: position => { if (position) { store.selectionClear(); store.createOpen(position); } },
		createClose: () => { store.createClose(); root.current?.focus({ preventScroll: true }); },
		createChoose: (entry, position) => {
			store.createClose();
			change(() => {
				if (entry.isConnection) {
					const id = store.connectionCreateDangling(position);
					if (id) editor.selectConnection(id);
				} else {
					const id = store.nodeAdd(entry.id, position);
					if (id) anchor.current = { getRect: () => canvas.current?.nodeRectGet(id) };
				}
			});
		},
	} : undefined;
	return <div ref={root} tabIndex={-1} className={`doc-vis-edit${editor ? ' is-active' : ''}${isInPopup ? ' is-popup' : ''}`} onKeyDown={keyDown} onClick={event => {
		if (event.target === event.currentTarget || event.target.classList.contains('doc-vis-card-static')) editor?.clearSelection();
	}}>
		{result.message || reasonRefused ? <div role="alert" className="doc-edit-message doc-vis-edit-message">{result.message || reasonRefused}</div> : null}
		{store ? renderContent({ data: { ...data, source: store.rawDraft, raw: store.rawDraft }, editor }) : null}
		<EditFloatingPanel label={kind === 'diagram' ? 'Diagram' : 'Table'} head={store ? <>
			<span className={`doc-vis-dirty${store.isDirty ? ' is-dirty' : ''}`} role="status">{store.isDirty ? 'Unsaved changes' : 'No changes'}</span>
			{kind === 'diagram' && editor ? <button type="button" className="doc-button-icon" title="Add a node or a connection (or double-click the canvas)" aria-label="Add" disabled={isLocked} onClick={() => editor.createOpen(canvas.current?.centerGet())}><Plus size={14} /></button> : null}
			{isFromAsset ? <span className="doc-vis-save-target">
				<span>Save to</span>
				<ValueMenu label="Save to" value={store.saveTarget} values={['asset', 'inline']} valueLabels={saveTargetLabels} isLocked={isLocked || !isAllowed} onChange={value => change(() => store.saveTargetSet(value))} />
			</span> : null}
		</> : null} actions={<EditActions status={session.status} message={session.message || store?.message} titleCancel="Cancel" isSubmitDisabled={!store || !isAllowed} onSubmit={submit} onCancel={cancel} />} />
		{editor && store.isCardShown ? <DiagramEditCard editor={editor} anchor={anchor} onKeyDown={keyDown} /> : null}
	</div>;
});
