import { constraintTypeListDefault } from './ParametricConstraint.js';
import { layoutTypeListDefault } from './ParametricLayout.js';
import { createModeListDefault } from './ParametricCreateMode.js';
import { creatorListDefault } from './ParametricCreator.js';

// The catalog of a parametric canvas feature (card-diagram-parametric-canvas.md#everything-is-a-plugin):
// the plugins it is built from, each list with its lookup. Everything else of the layer reads a
// type, a mode or a creator from the catalog it is given, and names none itself.
//
//   constraintTypeList, constraintTypeByType   how a member follows its parents (ParametricConstraint.js)
//   layoutTypeList, layoutTypeByType           layout members and patterns (ParametricLayout.js)
//   createModeList, createModeById             gestures placing a new thing (ParametricCreateMode.js)
//   creatorList, creatorByWhat                 what makes the thing of a tool (ParametricCreator.js)
export function parametricCatalogBuild({ constraintTypeList = constraintTypeListDefault, layoutTypeList = layoutTypeListDefault, createModeList = createModeListDefault, creatorList = creatorListDefault } = {}) {
	const lookup = (list, key, what) => {
		const result = {};
		for (const item of list) {
			if (result[item[key]]) throw new Error(`Parametric canvas: the ${what} ${item[key]} is declared twice.`);
			result[item[key]] = item;
		}
		return result;
	};
	return {
		constraintTypeList, constraintTypeByType: lookup(constraintTypeList, 'type', 'constraint type'),
		layoutTypeList, layoutTypeByType: lookup(layoutTypeList, 'type', 'layout type'),
		createModeList, createModeById: lookup(createModeList, 'id', 'create mode'),
		creatorList, creatorByWhat: lookup(creatorList, 'what', 'creator'),
	};
}
