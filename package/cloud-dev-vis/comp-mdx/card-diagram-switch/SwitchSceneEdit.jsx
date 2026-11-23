import { useEffect, useLayoutEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ChevronRight } from '../../../../main/frontend/UICommon.js';
import { DiagramVisualEdit } from '../card-diagram/DiagramVisualEdit.jsx';
import { DiagramERView } from '../card-diagram/CardDiagram.jsx';
import { DiagramPanel } from '../card-diagram/DiagramPanel.jsx';
import { ValueMenu } from '../card-diagram/DiagramValueControls.jsx';
import { switchPathChain, switchPathLast } from './SwitchData.js';
import { SwitchSceneEditStore } from './SwitchSceneEditStore.js';
import { sceneKeyOf } from './SwitchSceneEditTree.js';
import { SwitchSceneFloatingCard, switchSceneCardSourceBuild, switchScenePanelTabBuild } from './SwitchSceneEditPanel.jsx';

// The visual edit mode of a block of scenes (card-diagram-flexible-switch.md#editing-a-block-of-scenes):
//
//   [path of what is edited]   Overview › Detail  @cards ▾
//   [the visual editor]        the diagram of one scene, or of one view of a scene, with its history
//   [the panel]                Scenes (the tree of the block, relations, properties) and the tabs of
//                              the features (Structure, the parametric canvas)
//
// The block session (SwitchSceneEditStore.js) keeps the document, its commands and its history, and
// the panel, for the whole visual session: the editor of the canvas opens again for another scene
// (editToken) and finds the panel as it left it. The page is told the document, never the diagram
// of one scene. The feature layers the document names (featureList) are offered for every scene.
export const SwitchSceneEdit = observer(function SwitchSceneEdit({ data, config, onEvent, registry, isInPopup, mounted }) {
	const [store] = useState(() => new SwitchSceneEditStore(data.source || data.raw || ''));
	// the page is told the document after every command of the block
	store.onReport = () => { void onEvent?.('editDraftChange', store.reportOf()); };
	useEffect(() => { store.mountedSet(mounted); }, [store, mounted]);
	// the tab Scenes and the card of what is focused in it, for the whole session
	useLayoutEffect(() => {
		const disposeTab = store.panel.tabRegister(switchScenePanelTabBuild(store));
		const disposeCard = store.panel.cardSourceRegister(switchSceneCardSourceBuild(store));
		return () => { disposeTab(); disposeCard(); };
	}, [store]);
	if (!store.isReadable) return <div className="doc-er-diagram-message is-error" role="alert"><strong>The scenes cannot be edited visually.</strong><span>{store.message}</span></div>;
	const { target } = store;
	const raw = store.textOf(target);
	const configScene = {
		...config,
		...(store.featureList?.length ? { featureList: [...(config.featureList ?? []), ...store.featureList] } : {}),
		// the panel is the block's, drawn here under the editor; the editor knows the block session
		panel: store.panel,
		sceneEdit: store,
	};
	// a report of the editor is of one diagram: the page gets the document written from the drafts
	const onEventScene = (type, payload) => {
		if (type === 'editDraftChange' || type === 'editSubmitRequest') {
			store.reportBaseSet(payload);
			store.draftSet(target.key, payload?.raw);
			return onEvent?.(type, store.reportOf(payload ?? {}));
		}
		return onEvent?.(type, payload);
	};
	return (
		<div className={`doc-switch-scene-edit doc-vis-panel-host${isInPopup ? ' is-popup' : ''}`}>
			<SceneEditBar store={store} />
			<DiagramVisualEdit key={store.editToken} data={{ ...data, source: raw, raw }} config={configScene} onEvent={onEventScene} kind="diagram" registry={registry} isInPopup={isInPopup}
				renderContent={(props) => <DiagramERView {...props} config={{ ...configScene, stateKey: config.stateKey ? `${config.stateKey}|scene:${target.key}` : undefined }} onEvent={onEvent} registry={registry} isInPopup={isInPopup} />} />
			<DiagramPanel panel={store.panel} isInPopup={isInPopup} />
			<SwitchSceneFloatingCard store={store} />
		</div>
	);
});

// what is on the canvas, as a path: each segment a scene opens it (the panel is where to go anywhere
// else); the view of a scene of views, with a menu of its views
const SceneEditBar = observer(function SceneEditBar({ store }) {
	const { target } = store;
	if (!target) return null;
	const model = store.treeModel;
	const chain = switchPathChain(target.path);
	const viewIdList = model.itemGet(sceneKeyOf(target.path))?.viewIdList ?? [];
	return (
		<div className="doc-switch-scene-edit-bar nodrag nopan">
			<span className="doc-switch-scene-edit-label">Editing</span>
			<span className="doc-path doc-switch-scene-edit-path" data-plain="">
				{chain.map((path, index) => {
					const item = model.itemGet(sceneKeyOf(path));
					const isScene = item?.kind === 'scene';
					return <span key={path} className="doc-switch-scene-edit-segment">
						{index > 0 ? <ChevronRight size={11} aria-hidden="true" className="doc-switch-scene-edit-separator" /> : null}
						{isScene && path !== target.path
							? <button type="button" title={`Edit ${path}`} onClick={() => store.focusSet(sceneKeyOf(path), { isOpen: true })}>{item.label}</button>
							: <span className={isScene ? 'is-current' : 'is-folder'} title={path}>{item?.label ?? switchPathLast(path)}</span>}
					</span>;
				})}
			</span>
			{target.view ? <ValueMenu label="View edited" value={target.view} values={viewIdList} valueLabels={Object.fromEntries(viewIdList.map(id => [id, `@${model.itemGet(`view:${target.path}@${id}`)?.label ?? id}`]))} onChange={id => store.targetSet(`${target.path}@${id}`)} /> : null}
			{store.message ? <span className="doc-error doc-switch-scene-edit-note" role="alert">{store.message}</span> : <span className="doc-switch-scene-edit-note">{store.isDirty ? 'Every scene keeps what was done; Save writes them all.' : ''}</span>}
		</div>
	);
});
