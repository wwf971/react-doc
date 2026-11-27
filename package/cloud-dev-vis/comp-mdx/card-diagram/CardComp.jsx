import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { Expand, Pencil, Puzzle, TriangleAlert } from '../../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { RegisteredComp } from '../../../../main/comp-doc/registry/RegisteredComp.jsx';
import { DocEditBlockContext, DocEditBlockFloatContext } from '../../../../main/comp-doc/edit/DocEditDocContext.js';
import { EditButtonGroup } from '../../../../main/comp-doc/edit/EditButtonGroup.jsx';
import { compDefinitionNormalize, compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import { compDefinitionGet } from '../../../../main/comp-doc/registry/comp-definition.js';
import { compEditModeListGet, compIconGet, compMetaGet } from '../../../../main/comp-doc/registry/comp-expose.js';
import { PanelPopup } from '../../../../main/comp-doc/popup/PanelPopup.jsx';
import { ValueMenu } from './DiagramValueControls.jsx';
import { cardCompEntryListBuild } from './CardCompEntry.js';
import { cardCompIsAssetRef, cardCompPropsWithView, cardCompViewIsTile, cardCompViewListOf } from './CardCompData.js';
import { cardCompAssetEntryCreate, cardCompAssetWrite } from './CardCompAsset.js';
import { cardCompIsReleasing, cardCompLetGo, cardCompNodeOfBlock } from './CardCompHold.js';
import { DiagramRenderContext } from './DiagramRender.jsx';
import { nodeSizeModeOf } from './DiagramNodeResize.js';
import { nodeOverflowWatch } from './DiagramNodeOverflow.js';
import { useScrollWheelTake, useScrollbarPointerKeep } from './CanvasWheelGuard.js';
import './CardComp.css';

// The card holding a component (card-diagram-impl.md#a-component-in-a-card): one component of the
// page, drawn as a block of a document draws it (the page's boundary RegisteredComp, placement
// commentBlock, the lang, raw and props the node writes), or none yet.
//
// In the editor of the diagram:
//   in place              a component with a mode offered in place (a mode declaring isInPlace: the
//                         Zoom cards' Fields) is drawn in it all the while, config.edit.isInPlace: a
//                         value typed where it stands at a click, each one written into the draft at
//                         once as a step of its own; no bar, no session. Its values are typed in the
//                         edit card too, when it offers them (expose.dataFields: CardCompData.js).
//                         config.edit.isSelected says whether the card is the one selected: what the
//                         component floats for itself as a whole (its +) stands on that one, so a
//                         canvas does not show the controls of every card at once
//   the card selected     a floating group over it (EditButtonGroup): a button per edit mode of its
//                         component, and the component chosen (a searchable menu: the components
//                         of the page a card may hold, CardCompEntry.js); an empty card offers the
//                         menu in its body
//   an edit mode chosen   the component is drawn with config.isEdit and config.edit, its bar in a
//                         floating area over the card (DocEditBlockFloatContext), the card taking
//                         the pointer and the keys (nodrag nopan nowheel). What it reports is written
//                         into the draft at once, one step per session (nodeCompDataSet): Save ends the
//                         session, Cancel puts back what the card held, leaving the card ends it
//   its data as text      the edit card of the node (contract.cardSectionListGet)
//   its view              a component drawing its blocks in views (expose.blockViewList: Code, Mdx) has
//                         them in a menu of the group over the card and in its edit card: view= of
//                         its props, as on the marker of a block
//
// A component drawing a canvas of React Flow itself (meta.isFlowCanvas: a card diagram, its animation,
// its switch) is drawn in the card as a **tile** (its icon, its name), and its canvas in a dialog of the
// page (PanelPopup, out of the node): React Flow reads the handles of a node from everything inside it,
// so a canvas drawn in a card would give the card the handles of its own cards. A click on the tile
// opens the dialog; an edit mode chosen in the group of the card opens it too, the bar of its editor in
// the head of the dialog; closing the dialog ends the session (what it reported is in the draft).
//
// Its box, by its size mode (CARD_COMP_SIZE_MODE_LIST, read from its size): its component's own size
// (fit), or a width, a height or both given (wrap, tall, box). The component is drawn in the card's
// body; with an axis given, what it draws beyond the box scrolls by the rule of the box of a node
// (nodeOverflowWatch: more than a few pixels scroll, less is cut), the wheel taken while the body can
// still scroll (useScrollWheelTake), its scrollbar neither moving the card nor panning the canvas.
// What floats over the card (its group, the bar of an edit mode) stands outside the body, never cut.
//
// The document the component is in is the card (config.docState): while the diagram is edited, the
// card is being edited and written into the draft; while it is read, the card is what the page's
// document is, written into the block of the diagram when the page can write it (readChangeWrite of
// the canvas: a component writing its own data, as a block of a document does in reading mode; the
// document of an MDX block edited in its popup, which takes the page's one session).
//
// Data in an asset item (lang asset: an asset-only component, a spreadsheet): the card holds the
// reference, and what the component writes goes to the item (CardCompAsset.js), its draft kept here
// while its edit mode is open, never written over the reference.
//
// A component holding others (expose.hold: a weekly timetable) is a holder of the diagram
// (card-diagram-impl.md#a-node-holding-others): a card dropped on it is taken (the kind's contract,
// CardCompHold.js); and while the diagram is edited the card hands it config.hold, so what it holds can
// be dragged out of it: dragMove(key, point) marks what is under the pointer and answers what letting
// go there does ({ text, isRefused }), release(key, point) lets it go there (a card of its own, or taken
// by the holder there), dragEnd() clears the mark. point: { clientX, clientY } of the screen.
//
// The component knows nothing of the diagram: it is edited as in a document. Its reports never reach
// the edit layer of the document around the diagram: the block context is cut, and the reports of
// the edit domain are answered here.
export const CardComp = observer(function CardComp({ node, editor, nodeId }) {
	const stores = useDocStores();
	const data = node.data ?? {};
	const store = editor?.store;
	const session = store?.compEdit?.nodeId === nodeId ? store.compEdit : null;
	const isSelected = Boolean(store) && store.selection?.nodeId === nodeId && !store.selection?.connectionId;
	const isFixed = Boolean(store?.isStructureFixed);
	// read by the card selected alone (its group is the only one there): a drag redraws no other card
	const isDragging = isSelected && ['nodeDrag', 'holdDrag'].includes(store?.interaction?.type);
	const [floatElement, floatElementSet] = useState(null);
	const configDoc = stores?.sourceStore?.configDoc;
	const definition = data.comp ? compDefinitionNormalize(compDefinitionGet(stores?.compById ?? {}, compIdResolve(configDoc, data.comp))) : undefined;
	const meta = definition ? compMetaGet(definition) : null;
	// its own edit modes: the built-in source of a block is the text of its data, typed in the edit card
	const editModeList = definition && !meta?.isReadOnly ? compEditModeListGet(definition).filter((mode) => mode.id !== 'source') : [];
	// the mode drawn in place while the diagram is edited, when the component offers one; not where the
	// structure is given, and not while another of its modes is open
	const modeInPlace = editModeList.find((mode) => mode.isInPlace === true) ?? null;
	const isInPlace = Boolean(editor) && !isFixed && Boolean(modeInPlace) && !session;
	const entryList = useMemo(() => (editor ? cardCompEntryListBuild({ compById: stores?.compById, configDoc }) : []), [editor, stores?.compById, configDoc]);
	// its box: its own size, or an axis given, the body then scrolling what is beyond it
	const sizeMode = nodeSizeModeOf(node);
	const bodyRef = useRef(null);
	const isBodyScrolled = sizeMode !== 'fit' && Boolean(data.comp && definition);
	useLayoutEffect(() => (isBodyScrolled ? nodeOverflowWatch(bodyRef.current) : undefined), [isBodyScrolled]);
	useScrollWheelTake(bodyRef, isBodyScrolled);
	useScrollbarPointerKeep(bodyRef, isBodyScrolled);
	const viewList = cardCompViewListOf(definition);
	const isAssetRef = cardCompIsAssetRef(data);
	// the draft of a component whose data is an asset item, while its edit mode is open: written into
	// the item by its Save, never into the card
	const assetDraftRef = useRef(null);
	const assetWrite = (payload) => cardCompAssetWrite({ assetStore: stores?.assetStore, reference: data.raw, compName: data.comp, raw: payload.raw, lang: payload.lang, versionMetadata: payload.versionMetadata });
	// the card is the document its component is in: edited while the diagram is (a diagram whose
	// structure is given changes no card); read, it is the page's document, written through the block
	// of the diagram where the page can write it
	const readChangeWrite = useContext(DiagramRenderContext)?.readChangeWrite;
	const isCardWritable = Boolean(store) && !isFixed;
	const sourcePath = stores?.docStore?.docCurrentPath ?? '';
	const docStatePage = !store && readChangeWrite ? stores?.editStore?.docStateServiceGet?.(sourcePath) : undefined;
	const docStateOwn = useMemo(() => ({
		path: sourcePath,
		mode: isCardWritable ? 'edit' : 'read',
		isEditing: isCardWritable,
		isEditAvailable: isCardWritable,
		editReason: isCardWritable ? '' : (store ? 'the structure of this diagram is given here: its cards are not changed' : 'a card of a diagram is changed in the editor of its diagram'),
	}), [sourcePath, isCardWritable, store]);
	const docState = docStatePage ?? docStateOwn;
	// a change of its data asked by the component: into the draft while the diagram is edited, else
	// into the block of the diagram (the page writes it), else refused
	const dataChange = async (change) => {
		if (isCardWritable) { editor.change(() => store.nodeCompDataSet(nodeId, change, { groupKey: null })); return { code: 0 }; }
		if (!store && readChangeWrite && docStatePage?.isEditAvailable) return readChangeWrite((draft) => draft.nodeCompDataSet(nodeId, change, { groupKey: null }));
		return { code: -1, message: docState.editReason || 'The component of a card is changed in the editor of its diagram.' };
	};

	// a canvas of its own (meta.isFlowCanvas): a tile in the card, the canvas in a dialog, opened by a
	// click on the tile or by an edit mode chosen; the bar of its editor in the head of the dialog
	const isCanvas = meta?.isFlowCanvas === true;
	const [isCanvasOpen, isCanvasOpenSet] = useState(false);
	const [canvasFloatElement, canvasFloatElementSet] = useState(null);
	useEffect(() => { if (isCanvas && session) isCanvasOpenSet(true); }, [isCanvas, session]);

	// the card left while its component is edited: what it reported is in the draft, the session ends
	// (not while its canvas is open in its dialog: the dialog is the place it is edited in)
	useEffect(() => { if (session && !isSelected && !(isCanvas && isCanvasOpen)) store.compEditEnd(); }, [session, isSelected, store, isCanvas, isCanvasOpen]);
	const canvasClose = () => {
		if (session) store.compEditEnd();
		isCanvasOpenSet(false);
	};

	// a component whose data must be an asset item gets its item first (the card then holds the
	// reference); what kept it from being made is said in the group
	const [chooseMessage, chooseMessageSet] = useState('');
	const choose = async (compName) => {
		let entry = entryList.find((one) => one.compName === compName) ?? null;
		chooseMessageSet('');
		if (entry?.isAssetOnly) {
			const result = await cardCompAssetEntryCreate({ assetStore: stores?.assetStore, entry, compById: stores?.compById, configDoc, docPath: sourcePath });
			if (result.code !== 0) { chooseMessageSet(result.message); return; }
			entry = result.data.entry;
		}
		editor.change(() => store.nodeCompChoose(nodeId, entry));
	};
	const viewChange = (view) => {
		const props = cardCompPropsWithView(data.props, view);
		editor.change(() => store.nodeCompViewSet(nodeId, props, { isTile: cardCompViewIsTile(definition, props) }));
	};
	const viewMenu = viewList.length ? (
		<ValueMenu label="The view of the block" value={viewList.some((view) => view.id === data.props?.view) ? data.props.view : ''} values={['', ...viewList.map((view) => view.id)]}
			valueLabels={{ '': 'Default view', ...Object.fromEntries(viewList.map((view) => [view.id, view.label ?? view.id])) }}
			isLocked={editor?.isLocked} className="doc-card-comp-chooser is-compact" onChange={viewChange} />
	) : null;
	const chooser = (isCompact) => (
		<ValueMenu label="The component the card holds" value={data.comp ?? ''} values={['', ...entryList.map((entry) => entry.compName)]}
			valueLabels={{ '': 'None', ...Object.fromEntries(entryList.map((entry) => [entry.compName, entry.label ?? entry.compName])) }}
			isSearchable isLocked={editor?.isLocked} className={isCompact ? 'doc-card-comp-chooser is-compact' : 'doc-card-comp-chooser'} onChange={choose} />
	);

	// what the component reports: while its edit mode is open, its draft and the end of the session;
	// in the editor, a write of its data (dataReplaceRequest). Every other report of the edit domain
	// is answered here, so it never reaches the document around the diagram
	const onEventRuntime = async (type, payload = {}) => {
		// data in an asset item: the draft kept here, Save writes it into the item
		if (isAssetRef && session && type === 'editDraftChange') {
			assetDraftRef.current = { ...(assetDraftRef.current ?? {}), ...payload };
			return { code: 0 };
		}
		if (isAssetRef && session && type === 'editSubmitRequest') {
			const draft = payload.raw !== undefined ? { ...(assetDraftRef.current ?? {}), ...payload } : assetDraftRef.current;
			if (draft?.raw !== undefined) {
				const result = await assetWrite(draft);
				if (result.code !== 0) return result;
			}
			assetDraftRef.current = null;
			editor.change(() => store.compEditEnd());
			return { code: 0 };
		}
		if (isAssetRef && session && type === 'editCancelRequest') {
			assetDraftRef.current = null;
			editor.change(() => store.compEditCancel());
			return { code: 0 };
		}
		if (isAssetRef && type === 'dataReplaceRequest') {
			if (!docState.isEditAvailable || payload.raw === undefined) return { code: -1, message: docState.editReason || 'The component of a card is changed in the editor of its diagram.' };
			return assetWrite(payload);
		}
		if (type === 'editDraftChange' && session) {
			editor.change(() => store.nodeCompDataSet(nodeId, payload));
			return { code: 0 };
		}
		// in place: every value reported is a step of its own; there is no session to end
		if (type === 'editDraftChange' && isInPlace) {
			if (payload.raw !== undefined || payload.props !== undefined) editor.change(() => store.nodeCompDataSet(nodeId, payload, { groupKey: null }));
			return { code: 0 };
		}
		if ((type === 'editSubmitRequest' || type === 'editCancelRequest') && isInPlace) return { code: 0 };
		if (type === 'editSubmitRequest' && session) {
			editor.change(() => {
				if (payload.raw !== undefined || payload.props !== undefined) store.nodeCompDataSet(nodeId, payload);
				store.compEditEnd();
			});
			return { code: 0 };
		}
		if (type === 'editCancelRequest' && session) {
			editor.change(() => store.compEditCancel());
			return { code: 0 };
		}
		if (type === 'dataReplaceRequest') {
			if (payload.raw === undefined) return { code: -1, message: 'dataReplaceRequest needs its raw.' };
			return dataChange(payload.lang === undefined ? { raw: payload.raw } : { raw: payload.raw, lang: payload.lang });
		}
		// the props of its block, as on its marker in a document (blockPropSetRequest { props }: those
		// named replace those of the same name, null or '' removes one): the title an MDX block sets
		if (type === 'blockPropSetRequest') {
			if (!payload.props || typeof payload.props !== 'object') return { code: -1, message: 'blockPropSetRequest needs its props.' };
			const props = { ...(data.props ?? {}) };
			for (const [name, value] of Object.entries(payload.props)) {
				if (value === null || value === '') delete props[name];
				else props[name] = String(value);
			}
			return dataChange({ props });
		}
		if (/^edit[A-Z]/.test(type)) return { code: -1, message: 'Not taken by a card of a card diagram.' };
		return undefined;
	};

	// what it holds dragged out of it (a component holding others, while the diagram is edited): the
	// block it lets go of, the node that block becomes, and what is under the pointer
	const isReleasing = Boolean(editor) && !isFixed && (isInPlace || Boolean(session)) && cardCompIsReleasing(store?.nodeGet(nodeId) ?? node, editor);
	const releaseOf = (key, point) => {
		const nodeNow = store.nodeGet(nodeId);
		const letGo = nodeNow ? cardCompLetGo({ node: nodeNow, editor, key }) : null;
		if (!letGo) return null;
		const released = cardCompNodeOfBlock(letGo.block, editor.compDefinitionGet(letGo.block.comp));
		const flowPoint = point ? editor.canvas.current?.screenToFlow({ x: point.clientX, y: point.clientY }) ?? null : null;
		return { ...letGo, released, flowPoint };
	};
	const hold = isReleasing ? {
		dragMove: (key, point) => {
			const release = point ? releaseOf(key, point) : null;
			const take = release?.flowPoint ? editor.nodeTakeTargetGet({ dropped: { id: '', ...release.released }, point: release.flowPoint, exceptIdList: [nodeId] }) : null;
			const before = store.interaction?.type === 'holdDrag' ? store.interaction.take ?? null : undefined;
			if (before === undefined || (before?.nodeId ?? '') !== (take?.nodeId ?? '') || (before?.reason ?? '') !== (take?.reason ?? '')) store.interactionSet({ type: 'holdDrag', nodeId, take });
			if (!take) return { text: 'Let go: a card of its own here', isRefused: false };
			const label = editor.compDefinitionGet(store.nodeGet(take.nodeId)?.data?.comp)?.expose?.meta?.label ?? take.nodeId;
			return take.reason ? { text: `${label} does not take it: ${take.reason}`, isRefused: true } : { text: `Let go: taken by ${label}`, isRefused: false };
		},
		dragEnd: () => { if (store.interaction?.type === 'holdDrag') store.interactionSet(null); },
		release: (key, point) => {
			if (store.interaction?.type === 'holdDrag') store.interactionSet(null);
			const release = releaseOf(key, point);
			if (!release?.flowPoint) return { code: -1, message: 'Nothing of it is let go there.' };
			// a card of its own: its top left corner a little before the pointer, as if held by its title
			const position = { x: release.flowPoint.x - 16, y: release.flowPoint.y - 12 };
			return editor.nodeRelease({ nodeId, holderData: release.holderData, released: release.released, point: release.flowPoint, position });
		},
	} : undefined;

	// the document it belongs to is the page's, if any: an app drawing diagrams has no document store
	// (docStore null), and the boundary reads one only when no sourcePath is given
	const configRuntime = {
		instanceId: `card-comp:${nodeId}`,
		sourcePath,
		docState,
		...(hold ? { hold } : {}),
		...(session || isInPlace ? {
			isEdit: true,
			edit: {
				modeId: session ? session.modeId : modeInPlace.id, label: meta?.label ?? data.comp, format: 'md', block: undefined, isSurfaceFloating: false,
				// in place: whether this card is the one selected (what floats for the component as a
				// whole, its +, is shown on the card selected, not on every card of the canvas at once)
				...(session ? {} : { isInPlace: true, isSelected }),
				session: { status: editor.isLocked ? 'submitting' : 'editing', message: '', textDraft: data.raw ?? '' },
				submitPrepareSet: () => () => {},
				receiverSet: () => () => {},
			},
		} : {}),
	};

	// the mode open in place needs no button
	const actionList = editModeList.filter((mode) => !(isInPlace && mode === modeInPlace)).map((mode) => ({
		id: `edit-${mode.id}`,
		Icon: mode.icon ?? Pencil,
		title: `Edit it: ${mode.label}${mode.description ? ` (${mode.description})` : ''}`,
		act: () => store.compEditStart(nodeId, mode.id),
	}));

	return (
		<div className={`doc-card-comp${session ? ' is-editing nodrag nopan nowheel' : ''}${data.comp ? '' : ' is-empty'}`} data-comp={data.comp || undefined} data-size-mode={sizeMode}>
			{/* over its top edge, at the size of the screen, one row: the group of the card, then where the
			    component floats what is its own (the bar of its editor in a session; in place, what it has
			    for itself as a whole, its +), so the two never stand over each other */}
			{editor ? (
				<div className="doc-card-comp-over nodrag nopan">
					{/* its group steps aside while something is dragged (a card over a holder: the mark of the
					    holder stands where the group was, DiagramNodeTake.js) */}
					{isSelected && !session && !isFixed && definition && !isDragging ? (
						<div className="doc-card-comp-bar">
							{actionList.length ? <EditButtonGroup actionList={actionList} isLocked={editor.isLocked} ariaLabel="The component of the card" /> : null}
							{viewMenu}
							{chooser(true)}
							{chooseMessage ? <span className="doc-card-comp-message" role="alert">{chooseMessage}</span> : null}
						</div>
					) : null}
					<div ref={floatElementSet} className="doc-card-comp-float" />
				</div>
			) : null}
			{data.comp && !definition ? (
				// a component the page does not have (removed, renamed, of a package not loaded): said in the
				// card at its size, its data kept (the edit card shows it), another one offered in the editor
				<div className="doc-card-comp-empty is-unknown" role="alert">
					<TriangleAlert size={14} aria-hidden="true" />
					<span>No component <strong>{data.comp}</strong> on this page</span>
					{editor && !isFixed ? chooser(false) : null}
				</div>
			) : data.comp && isCanvas ? (
				<CardCompCanvas label={meta?.label ?? data.comp} Icon={compIconGet(definition)} isEditor={Boolean(editor)} isOpen={isCanvasOpen} onOpen={() => isCanvasOpenSet(true)} onClose={canvasClose}
					barRef={canvasFloatElementSet}>
					<DocEditBlockContext.Provider value={null}>
						<DocEditBlockFloatContext.Provider value={canvasFloatElement}>
							<RegisteredComp compName={data.comp} placement="commentBlock"
								input={{ raw: data.raw ?? '', lang: data.lang ?? 'yaml', propsAuthored: data.props ?? {} }}
								configRuntime={configRuntime} onEventRuntime={onEventRuntime} />
						</DocEditBlockFloatContext.Provider>
					</DocEditBlockContext.Provider>
				</CardCompCanvas>
			) : data.comp ? (
				<div ref={bodyRef} className="doc-card-comp-body">
					<DocEditBlockContext.Provider value={null}>
						<DocEditBlockFloatContext.Provider value={floatElement}>
							<RegisteredComp compName={data.comp} placement="commentBlock"
								input={{ raw: data.raw ?? '', lang: data.lang ?? 'yaml', propsAuthored: data.props ?? {} }}
								configRuntime={configRuntime} onEventRuntime={onEventRuntime} />
						</DocEditBlockFloatContext.Provider>
					</DocEditBlockContext.Provider>
				</div>
			) : (
				<div className="doc-card-comp-empty">
					<Puzzle size={16} aria-hidden="true" />
					<span>{editor ? 'No component yet' : 'An empty card'}</span>
					{editor && !isFixed ? chooser(false) : null}
				</div>
			)}
		</div>
	);
});

// a component drawing a canvas of React Flow itself, held by a card: the tile in the card, and the
// canvas in a dialog of the page, out of the node (a portal into the page: React Flow reads the handles
// of a node from everything inside it). Read, a click on the tile opens it; in the editor a click
// selects the card as on any card (a drag moves it), and its open button opens it. barRef: the place
// in the head of the dialog where the bar of its editor goes while an edit mode is open
function CardCompCanvas({ label, Icon, isEditor, isOpen, onOpen, onClose, barRef, children }) {
	const open = (event) => { event.stopPropagation(); onOpen(); };
	const tileContent = (
		<>
			<span className="doc-card-comp-canvas-icon" aria-hidden="true"><Icon /></span>
			<span className="doc-card-comp-canvas-label">{label}</span>
		</>
	);
	return (
		<>
			{isEditor ? (
				<div className="doc-card-comp-canvas-tile">
					{tileContent}
					<button type="button" className="doc-card-comp-canvas-open nodrag nopan" title={`Open ${label}: a canvas of its own, in a dialog`} aria-haspopup="dialog" aria-expanded={isOpen} onClick={open}>
						<Expand aria-hidden="true" />
					</button>
				</div>
			) : (
				<button type="button" className="doc-card-comp-canvas-tile" title={`${label}: a canvas of its own, opened in a dialog`} aria-haspopup="dialog" aria-expanded={isOpen} onClick={open}>
					{tileContent}
					<span className="doc-card-comp-canvas-open" aria-hidden="true"><Expand /></span>
				</button>
			)}
			{isOpen && typeof document !== 'undefined' ? createPortal(
				<PanelPopup panelId="cardCompCanvas" title={label} isOpen onClose={onClose} className="doc-card-comp-canvas-dialog" bodyClassName="doc-card-comp-canvas-body"
					headerRightContent={<span ref={barRef} className="doc-card-comp-canvas-bar doc-edit-popup" />}>
					{children}
				</PanelPopup>,
				document.body,
			) : null}
		</>
	);
}
