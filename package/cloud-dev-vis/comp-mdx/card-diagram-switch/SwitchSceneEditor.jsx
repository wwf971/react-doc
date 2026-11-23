import { useCallback, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DocEditBlockFloatContext } from '../../../../main/comp-doc/edit/DocEditDocContext.js';
import { yamlParse, yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';
import { DiagramVisualEdit } from '../card-diagram/DiagramVisualEdit.jsx';
import { DiagramERView } from '../card-diagram/CardDiagram.jsx';
import { SWITCH_TITLE_EDIT_ID } from './SwitchData.js';
import { switchRegistryBuild } from './SwitchNodeKinds.jsx';

// A scene of a provider edited in place (card-diagram-flexible-switch.md#a-scene-edited-in-place): the
// visual editor of the framework over the canvas of the viewport, on the draft the scene gives
// (edit.source: a diagram, or its YAML), with everything of the editor: cells typed where they
// stand, lines drawn and taken away, the edit card beside what is focused, undo and redo.
//
// It takes the place of the canvas without being seen to: the draft is drawn where the scene is
// (the title of the scene is a node of the draft, at its place), at the camera of the canvas,
// which follows the editor's from then on, and the canvas stays under it until the editor has
// drawn. Its bar (undo, redo, Save, Cancel) floats over the top of the canvas and takes no room.
// Save hands the draft to the scene (edit.save(raw, { title })), whose writes make the provider
// anew; a failure is said in the bar and the draft stays. An edit that changed nothing ends by
// itself when nothing is focused any more.
const registryWithTitleByRegistry = new WeakMap();

// the kinds a draft may hold: those the scene names (edit.registry), with the title of a scene
function registryEditOf(registryGiven, registryViewport) {
	const registry = registryGiven ?? registryViewport;
	if (registry.kindByType['scene-title']) return registry;
	if (!registryWithTitleByRegistry.has(registry)) registryWithTitleByRegistry.set(registry, switchRegistryBuild(registry));
	return registryWithTitleByRegistry.get(registry);
}

export const SwitchSceneEditor = observer(function SwitchSceneEditor({ store, config, registry }) {
	const edit = store.sceneEditDesc;
	const { sceneEdit } = store;
	const [floatElement, floatElementSet] = useState(null);
	// what the editor opens on, read once per edit: the draft with the title of the scene as a
	// node of it, and the camera the canvas has
	const [session] = useState(() => {
		const held = store.sceneEditSource;
		if (!held) return null;
		const path = store.pathCurrent;
		const rect = store.titleRectOf(path);
		const titleNode = rect && !held.nodeIdSet.has(SWITCH_TITLE_EDIT_ID)
			? { id: SWITCH_TITLE_EDIT_ID, renderer: { type: 'scene-title' }, position: { x: rect.x, y: rect.y }, size: { width: 'auto', height: rect.height }, isPositionLocked: true, data: { text: store.titleOf(path), scale: store.titleScaleOf(path) }, handles: [] }
			: null;
		return {
			raw: yamlStringify({ version: 1, ...held.source, nodes: [...(titleNode ? [titleNode] : []), ...(held.source.nodes ?? [])] }, { aliasDuplicateObjects: false }),
			camera: store.viewportApi?.viewportGet() ?? store.cameraLive ?? null,
			hasTitle: Boolean(titleNode),
		};
	});
	const registryEdit = useMemo(() => registryEditOf(edit?.registry, registry), [edit, registry]);
	const key = `${store.scope}|edit|${sceneEdit?.path ?? ''}`;
	// what of the draft may change: what the scene says, and its title where the scene lets it be typed
	const editScope = useMemo(() => (edit ? {
		isStructureFixed: Boolean(edit.isStructureFixed),
		fieldIsEditable: (node, rowId, fieldId) => (node.id === SWITCH_TITLE_EDIT_ID && session?.hasTitle ? Boolean(edit.isTitleEditable) && fieldId === 'text' : edit.fieldIsEditable ? edit.fieldIsEditable(node, rowId, fieldId) !== false : true),
		react: edit.react,
	} : null), [edit, session]);
	const configEdit = useMemo(() => ({
		...config, isEdit: true, edit: { modeId: 'visual', session: { status: sceneEdit?.status ?? 'editing', message: sceneEdit?.message ?? '' } },
		editScope, editLabel: edit?.label ?? 'Scene', editSelect: sceneEdit?.select ?? null,
		onEditRest: () => store.sceneEditRest(),
		viewInitial: session?.camera ?? undefined, onViewChange: (view) => store.sceneEditCameraSet(view),
		createSourceList: edit?.createSourceList, createActionList: edit?.createActionList, sourcePath: key, blockIndex: 0, instanceId: key, height: store.box?.height ?? 600,
		// the feature layers the scene offers while it is edited (edit.featureList: a scene only partly
		// made from data may offer the parametric canvas; one made again from data at each change does not)
		featureList: edit?.featureList ?? [],
	}), [config, edit, editScope, session, sceneEdit?.status, sceneEdit?.message, sceneEdit?.select, key, store]);
	const onEvent = useCallback(async (name, payload) => {
		if (name === 'editDraftChange') store.sceneEditDirtySet(payload?.isDirty);
		else if (name === 'editCancelRequest') store.sceneEditEnd();
		else if (name === 'editSubmitRequest') {
			// nothing changed: nothing to write
			if (!payload?.isDirty) { store.sceneEditEnd(); return { code: 0 }; }
			// the title of the scene is not of its diagram: it is handed over beside the draft
			const draft = yamlParse(payload.raw);
			const titleNode = session?.hasTitle ? (draft.nodes ?? []).find((node) => node.id === SWITCH_TITLE_EDIT_ID) : null;
			const raw = session?.hasTitle ? yamlStringify({ ...draft, nodes: (draft.nodes ?? []).filter((node) => node.id !== SWITCH_TITLE_EDIT_ID) }, { aliasDuplicateObjects: false }) : payload.raw;
			await store.sceneEditSave(raw, titleNode && edit?.isTitleEditable ? { title: String(titleNode.data?.text ?? '').trim() } : {});
		}
		return { code: 0 };
	}, [store, session, edit]);
	if (!edit || !sceneEdit || !session) return null;
	return (
		<div className="doc-switch-scene-editor">
			<div ref={floatElementSet} className="doc-switch-scene-editor-float nodrag nopan" />
			<DocEditBlockFloatContext.Provider value={floatElement}>
				<DiagramVisualEdit data={{ source: session.raw }} config={configEdit} onEvent={onEvent} kind="diagram" registry={registryEdit} isInPopup
					renderContent={(props) => <DiagramERView {...props} config={configEdit} onEvent={onEvent} registry={registryEdit} isInPopup />} />
			</DocEditBlockFloatContext.Provider>
		</div>
	);
});
