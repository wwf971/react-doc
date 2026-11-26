import { PARAMETRIC_DATA_KEY, PARAMETRIC_FEATURE_ID } from './ParametricData.js';
import { parametricCatalogBuild } from './ParametricCatalog.js';
import { parametricGraphResolveBuild } from './ParametricSolve.js';
import { ParametricEditStore } from './ParametricEditStore.js';
import { PARAMETRIC_TOOL_KEY, parametricToolMapDefault, toolMapMerge } from './ParametricTool.js';
import { ParametricCanvasLayer } from './ParametricCanvasLayer.jsx';
import { ParametricReadLayer } from './ParametricReadLayer.jsx';
import { parametricPanelTabBuild } from './ParametricPanel.jsx';
import { iconOf, toolIconOf } from './ParametricToolBar.jsx';
import { parametricKindList } from './ParametricShape.jsx';
import { parametricApiListBuild } from './ParametricApi.js';
import { ParametricLocatorLayer } from './ParametricLocatorLayer.jsx';
import { locatorActionListBuild, locatorCardSectionListBuild, locatorModeCardBuild } from './ParametricLocatorModel.js';

// what a layout type shows of itself in the editor and when read, by its type: the sections of
// its edit card, the card of a mode of its own, what a right-click offers, and what it draws over
// the canvas in the place of the frame of a layout. The catalog of the types is pure
// (ParametricCatalog.js); this is the part that draws, given beside it
export const parametricLayoutUiByType = {
	locator: { cardSectionListGet: locatorCardSectionListBuild, modeCardGet: locatorModeCardBuild, actionListGet: locatorActionListBuild, CanvasLayer: ParametricLocatorLayer, ReadLayer: ParametricLocatorLayer },
};
import './ParametricCanvas.css';

// The parametric canvas as a feature of a node registry (card-diagram-parametric-canvas.md): a
// registry that lists it (nodeRegistryBuild featureList) reads the section `parametric` of its
// diagrams and places their groups; a viewport that names it (viewport.featureList) offers its
// editing layer, the tool bar and the panel.
//
// Everything of it is a plugin: a feature is built from lists of constraint types
// (ParametricConstraint.js), layout types and patterns (ParametricLayout.js; the locator:
// ParametricLocator.js, with what it draws: layoutUiByType), the formats of reference points
// (ParametricReferencePoint.js), create modes
// (ParametricCreateMode.js), creators (ParametricCreator.js), tools (ParametricTool.js) and the
// kinds it draws with (ParametricShape.jsx: a shape, a text; kinds of every registry listing the
// feature), and the one below is built from those the package ships (a list left out is the shipped
// one). A series wanting more builds its own: parametricFeatureBuild({ constraintTypeList: [...parametricConstraintTypeList, mine] })
// (ParametricCatalog.js: the lists the package ships).
export function parametricFeatureBuild({ constraintTypeList, layoutTypeList, referenceFormatList, createModeList, creatorList, kindList = parametricKindList, toolMap = parametricToolMapDefault, layoutUiByType = parametricLayoutUiByType } = {}) {
	const catalog = parametricCatalogBuild({ constraintTypeList, layoutTypeList, referenceFormatList, createModeList, creatorList });
	// the frames of the layouts framed when read, over every canvas of a diagram reading the section
	const ReadLayer = ({ canvasStore }) => <ParametricReadLayer canvasStore={canvasStore} catalog={catalog} layoutUiByType={layoutUiByType} />;
	return {
		id: PARAMETRIC_FEATURE_ID,
		label: 'Parametric canvas',
		dataKey: PARAMETRIC_DATA_KEY,
		catalog,
		kindList,
		// the keys of the component config a diagram component declares for it (card-diagram-comp.js):
		// the tool bar, kept in the config layers
		configDefineList: [{ key: PARAMETRIC_TOOL_KEY, type: 'any', valueDefault: null, isUserSettable: false, description: 'The tools of the tool bar of the parametric canvas, by id: what each one makes and its parameters, its place on the bar. Changed from the tool bar itself.' }],
		graphResolve: parametricGraphResolveBuild(catalog),
		ReadLayer,
		// the apis of a diagram, for an agent (ParametricApi.js)
		apiListBuild: parametricApiListBuild({ catalog, toolMap }),
		// the session of the visual editor (DiagramVisualEdit.jsx). stores: the stores of the page,
		// when the diagram is in one: its config keeps the tool bar (the client layer is written)
		editCreate({ store, registry, config, canvas, isOnGet, stores }) {
			const configStore = stores?.configStore;
			const compId = config?.compId;
			const isConfigKept = Boolean(configStore?.layerCompValueSet && compId && configStore.configService?.compConfigDefineListGet?.(compId)?.some(define => define.key === PARAMETRIC_TOOL_KEY));
			const toolMapConfigGet = () => (isConfigKept ? configStore.configService.compConfigGet(compId, config.sourcePath ?? '')?.[PARAMETRIC_TOOL_KEY] : null) ?? {};
			const session = new ParametricEditStore({
				store, registry, config, canvas, isOnGet, catalog, toolIconGet: toolIconOf, iconGet: iconOf, layoutUiByType,
				toolMapGet: () => toolMapMerge(toolMap, toolMapConfigGet()),
				toolMapPatch: isConfigKept ? (patch) => { void configStore.layerCompValueSet('client', compId, PARAMETRIC_TOOL_KEY, toolMapMerge(toolMapConfigGet(), patch)); } : undefined,
			});
			session.CanvasLayer = ParametricCanvasLayer;
			// its tab of the panel of the editor: Structure (DiagramPanel.jsx)
			session.panelTabGet = editorGet => parametricPanelTabBuild(session, editorGet);
			return session;
		},
	};
}

export const parametricCanvasFeature = parametricFeatureBuild();
