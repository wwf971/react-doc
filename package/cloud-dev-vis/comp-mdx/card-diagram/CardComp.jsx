import { useEffect, useMemo, useState } from 'react';
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
import './CardComp.css';

// The card holding a component (card-diagram-impl.md#a-component-in-a-card): one component of the
// page, drawn as a block of a document draws it (the page's boundary RegisteredComp, placement
// commentBlock, the lang, raw and props the node writes), or none yet.
//
// In the editor of the diagram:
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
	const entryList = useMemo(() => (editor ? cardCompEntryListBuild({ compById: stores?.compById, configDoc }) : []), [editor, stores?.compById, configDoc]);

	// the card left while its component is edited: what it reported is in the draft, the session ends
	useEffect(() => { if (session && !isSelected) store.compEditEnd(); }, [session, isSelected, store]);

	const choose = (compName) => {
		const entry = entryList.find((one) => one.compName === compName) ?? null;
		editor.change(() => store.nodeCompChoose(nodeId, entry));
	};
	const chooser = (isCompact) => (
		<ValueMenu label="The component the card holds" value={data.comp ?? ''} values={['', ...entryList.map((entry) => entry.compName)]}
			valueLabels={{ '': 'None', ...Object.fromEntries(entryList.map((entry) => [entry.compName, entry.label ?? entry.compName])) }}
			isSearchable isLocked={editor?.isLocked} className={isCompact ? 'doc-card-comp-chooser is-compact' : 'doc-card-comp-chooser'} onChange={choose} />
	);

	// what the component reports: while its edit mode is open, its draft and the end of the session;
	// in the editor, a write of its data (dataReplaceRequest). Every other report of the edit domain
	// is answered here, so it never reaches the document around the diagram
	const onEventRuntime = (type, payload = {}) => {
		if (type === 'editDraftChange' && session) {
			editor.change(() => store.nodeCompDataSet(nodeId, payload));
			return { code: 0 };
		}
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
			if (!store || isFixed || payload.raw === undefined) return { code: -1, message: 'The component of a card is changed in the editor of its diagram.' };
			editor.change(() => store.nodeCompDataSet(nodeId, payload, { groupKey: null }));
			return { code: 0 };
		}
		if (/^edit[A-Z]/.test(type)) return { code: -1, message: 'Not taken by a card of a card diagram.' };
		return undefined;
	};

	// the document it belongs to is the page's, if any: an app drawing diagrams has no document store
	// (docStore null), and the boundary reads one only when no sourcePath is given
	const configRuntime = {
		instanceId: `card-comp:${nodeId}`,
		sourcePath: stores?.docStore?.docCurrentPath ?? '',
		...(session ? {
			isEdit: true,
			edit: {
				modeId: session.modeId, label: meta?.label ?? data.comp, format: 'md', block: undefined, isSurfaceFloating: false,
				session: { status: 'editing', message: '', textDraft: data.raw ?? '' },
				submitPrepareSet: () => () => {},
				receiverSet: () => () => {},
			},
		} : {}),
	};

	const actionList = editModeList.map((mode) => ({
		id: `edit-${mode.id}`,
		Icon: mode.icon ?? Pencil,
		title: `Edit it: ${mode.label}${mode.description ? ` (${mode.description})` : ''}`,
		act: () => store.compEditStart(nodeId, mode.id),
	}));

	return (
		<div className={`doc-card-comp${session ? ' is-editing nodrag nopan nowheel' : ''}${data.comp ? '' : ' is-empty'}`} data-comp={data.comp || undefined}>
			{/* where the bar of the component's editor goes, and the group of the card: over its top edge, at the size of the screen */}
			{editor ? <div ref={floatElementSet} className="doc-card-comp-float nodrag nopan" /> : null}
			{editor && isSelected && !session && !isFixed && definition ? (
				<div className="doc-card-comp-bar nodrag nopan">
					{actionList.length ? <EditButtonGroup actionList={actionList} isLocked={editor.isLocked} ariaLabel="The component of the card" /> : null}
					{chooser(true)}
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
				<DocEditBlockContext.Provider value={null}>
					<DocEditBlockFloatContext.Provider value={floatElement}>
						<RegisteredComp compName={data.comp} placement="commentBlock"
							input={{ raw: data.raw ?? '', lang: data.lang ?? 'yaml', propsAuthored: data.props ?? {} }}
							configRuntime={configRuntime} onEventRuntime={onEventRuntime} />
					</DocEditBlockFloatContext.Provider>
				</DocEditBlockContext.Provider>
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
