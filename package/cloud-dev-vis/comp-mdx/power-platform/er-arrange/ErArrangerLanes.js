import { diagramLabelsPlace, diagramLineSceneGet, diagramLinesRoute } from '../../card-diagram/DiagramArrangeRouter.js';
import { erGeometryEstimateBuild } from './ErGeometry.js';

const TABLE_TYPE_LIST = ['dataverse-table', 'dataverse-choice', 'table'];
export const erArrangerIsApplicable = (diagram) => (diagram.nodes ?? []).some((node) => TABLE_TYPE_LIST.includes(node.renderer?.type));

// the cards stay where they are; every right-angled line gets a new route
export const erArrangerLanes = {
	id: 'er-lanes',
	label: 'Route the lines',
	description: 'Keeps the cards where they are. Replaces the anchors of every right-angled line, giving each a lane of its own, and places the labels clear of the cards.',
	isApplicable: erArrangerIsApplicable,
	geometryEstimate: (diagram, options) => erGeometryEstimateBuild(diagram, options),
	arrange(diagram, geometry, options) {
		const scene = diagramLineSceneGet(diagram, geometry, options);
		const { routeById, reportList } = diagramLinesRoute(scene);
		const labels = diagramLabelsPlace(diagram, geometry, routeById, options);
		return { routeById, labelPositionById: labels.positionById, reportList: [...scene.reportList, ...reportList, ...labels.reportList] };
	},
};
