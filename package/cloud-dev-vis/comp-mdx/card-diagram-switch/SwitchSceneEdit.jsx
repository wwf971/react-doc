import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DiagramVisualEdit } from '../card-diagram/DiagramVisualEdit.jsx';
import { DiagramERView } from '../card-diagram/CardDiagram.jsx';
import { ValueMenu } from '../card-diagram/DiagramValueControls.jsx';
import { SwitchSceneEditStore } from './SwitchSceneEditStore.js';

// The visual edit mode of a block of scenes: the scene (or the view of one) chosen above the canvas
// is edited in the visual editor of the framework, with its history; another can be chosen at any
// time, what was done to the first kept as its draft; Save writes the whole document once, every
// edited diagram in its place (SwitchSceneEditStore.js). The page is told the document, never the
// diagram of one scene.
export const SwitchSceneEdit = observer(function SwitchSceneEdit({ data, config, onEvent, registry, isInPopup }) {
	const [store] = useState(() => new SwitchSceneEditStore(data.source || data.raw || ''));
	if (store.message) return <div className="doc-er-diagram-message is-error" role="alert"><strong>The scenes cannot be edited visually.</strong><span>{store.message}</span></div>;
	const { target } = store;
	const raw = store.textOf(target);
	// a report of the editor is of one diagram: the page gets the document written from the drafts
	const onEventScene = (type, payload) => {
		if (type === 'editDraftChange' || type === 'editSubmitRequest') {
			store.draftSet(target.key, payload?.raw);
			return onEvent?.(type, store.reportOf(payload ?? {}));
		}
		return onEvent?.(type, payload);
	};
	return (
		<div className="doc-switch-scene-edit">
			<div className="doc-switch-scene-edit-bar nodrag nopan">
				<span className="doc-switch-scene-edit-label">Scene</span>
				<ValueMenu label="Scene to edit" value={store.targetKey} values={store.targetList.map((item) => item.key)} valueLabels={Object.fromEntries(store.targetList.map((item) => [item.key, item.label]))} onChange={store.targetSet} />
				<span className="doc-switch-scene-edit-note">{store.isDirty ? 'Edited scenes are kept while another is chosen; Save writes them all.' : 'Choose a scene; its diagram opens in the editor.'}</span>
			</div>
			<DiagramVisualEdit key={target.key} data={{ ...data, source: raw, raw }} config={config} onEvent={onEventScene} kind="diagram" registry={registry} isInPopup={isInPopup}
				renderContent={(props) => <DiagramERView {...props} config={{ ...config, stateKey: config.stateKey ? `${config.stateKey}|scene:${target.key}` : undefined }} onEvent={onEvent} registry={registry} isInPopup={isInPopup} />} />
		</div>
	);
});
