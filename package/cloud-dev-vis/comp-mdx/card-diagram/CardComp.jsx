import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Pencil, Puzzle, TriangleAlert } from '../../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { RegisteredComp } from '../../../../main/comp-doc/registry/RegisteredComp.jsx';
import { DocEditBlockContext, DocEditBlockFloatContext } from '../../../../main/comp-doc/edit/DocEditDocContext.js';
import { EditButtonGroup } from '../../../../main/comp-doc/edit/EditButtonGroup.jsx';
import { compDefinitionNormalize, compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import { compDefinitionGet } from '../../../../main/comp-doc/registry/comp-definition.js';
import { compEditModeListGet, compMetaGet } from '../../../../main/comp-doc/registry/comp-expose.js';
import { ValueMenu } from './DiagramValueControls.jsx';
import { cardCompEntryListBuild } from './CardCompEntry.js';
import { cardCompIsAssetRef, cardCompPropsWithView, cardCompViewIsTile, cardCompViewListOf } from './CardCompData.js';
import { cardCompAssetEntryCreate, cardCompAssetWrite } from './CardCompAsset.js';
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
//                         edit card too, when it offers them (expose.dataFields: CardCompData.js)
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

	// the card left while its component is edited: what it reported is in the draft, the session ends
	useEffect(() => { if (session && !isSelected) store.compEditEnd(); }, [session, isSelected, store]);

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

	// the document it belongs to is the page's, if any: an app drawing diagrams has no document store
	// (docStore null), and the boundary reads one only when no sourcePath is given
	const configRuntime = {
		instanceId: `card-comp:${nodeId}`,
		sourcePath,
		docState,
		...(session || isInPlace ? {
			isEdit: true,
			edit: {
				modeId: session ? session.modeId : modeInPlace.id, label: meta?.label ?? data.comp, format: 'md', block: undefined, isSurfaceFloating: false,
				...(session ? {} : { isInPlace: true }),
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
			{/* where the bar of the component's editor goes, and the group of the card: over its top edge, at the size of the screen */}
			{editor ? <div ref={floatElementSet} className="doc-card-comp-float nodrag nopan" /> : null}
			{editor && isSelected && !session && !isFixed && definition ? (
				<div className="doc-card-comp-bar nodrag nopan">
					{actionList.length ? <EditButtonGroup actionList={actionList} isLocked={editor.isLocked} ariaLabel="The component of the card" /> : null}
					{viewMenu}
					{chooser(true)}
					{chooseMessage ? <span className="doc-card-comp-message" role="alert">{chooseMessage}</span> : null}
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
