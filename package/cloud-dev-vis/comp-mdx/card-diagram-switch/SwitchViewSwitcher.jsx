import { observer } from 'mobx-react-lite';
import { ValueMenu } from '../card-diagram/DiagramValueControls.jsx';

const clickStop = (event) => event.stopPropagation();

// The views of a scene to switch between (card-diagram-flexible-switch.md#the-views-of-a-scene),
// in the same control as a table card's: words alone when there is one to show. For the
// presentation it is given: in the path bar for the scene focused, in the title line of what
// embeds it. viewAsked: the view that embedding asks for; viewShown: what it shows now, if the
// pointer has made that another view.
export const SwitchViewSwitcher = observer(function SwitchViewSwitcher({ store, presentation, viewAsked, viewShown }) {
	const switcher = store?.viewSwitcherGet(presentation, viewAsked);
	if (!switcher?.isShown) return null;
	const { viewList } = switcher;
	const view = viewList.some((item) => item.id === viewShown) ? viewShown : switcher.view;
	const labelOf = (id) => viewList.find((item) => item.id === id)?.label ?? id;
	if (viewList.length <= 1) return <span className="doc-card-view-switcher is-single doc-switch-view-switcher nodrag nopan">{labelOf(view)}</span>;
	return (
		<span className="doc-switch-view-switcher" onClick={clickStop}>
			<ValueMenu label="View" className="doc-card-view-switcher" value={view} values={viewList.map((item) => item.id)} valueLabels={Object.fromEntries(viewList.map((item) => [item.id, item.label]))} onChange={(next) => { void store.viewSet({ path: presentation.path, view: next, pathEmbedder: presentation.pathEmbedder }); }} />
		</span>
	);
});
