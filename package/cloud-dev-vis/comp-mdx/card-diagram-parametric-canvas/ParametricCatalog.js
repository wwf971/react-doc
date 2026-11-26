import { constraintTypeListDefault } from './ParametricConstraint.js';
import { layoutTypeListDefault } from './ParametricLayout.js';
import { constraintTypeLocate, layoutTypeLocator } from './ParametricLocator.js';
import { referenceFormatListDefault } from './ParametricReferencePoint.js';
import { createModeListDefault } from './ParametricCreateMode.js';
import { creatorListDefault } from './ParametricCreator.js';

// The catalog of a parametric canvas feature (card-diagram-parametric-canvas.md#everything-is-a-plugin):
// the plugins it is built from, each list with its lookup. Everything else of the layer reads a
// type, a mode or a creator from the catalog it is given, and names none itself.
//
//   constraintTypeList, constraintTypeByType   how a member follows its parents (ParametricConstraint.js;
//                                              on the lines of a locator: ParametricLocator.js)
//   layoutTypeList, layoutTypeByType           layout members and patterns (ParametricLayout.js), the
//                                              locator (ParametricLocator.js)
//   referenceFormatList, referenceFormatById   the formats a reference point is written in
//                                              (ParametricReferencePoint.js)
//   createModeList, createModeById             gestures placing a new thing (ParametricCreateMode.js)
//   creatorList, creatorByWhat                 what makes the thing of a tool (ParametricCreator.js)
// the types the package ships: those of ParametricConstraint.js and ParametricLayout.js, with the locator
export const parametricConstraintTypeList = [...constraintTypeListDefault, constraintTypeLocate];
export const parametricLayoutTypeList = [...layoutTypeListDefault, layoutTypeLocator];

export function parametricCatalogBuild({ constraintTypeList = parametricConstraintTypeList, layoutTypeList = parametricLayoutTypeList, referenceFormatList = referenceFormatListDefault, createModeList = createModeListDefault, creatorList = creatorListDefault } = {}) {
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
		referenceFormatList, referenceFormatById: lookup(referenceFormatList, 'id', 'reference point format'),
		createModeList, createModeById: lookup(createModeList, 'id', 'create mode'),
		creatorList, creatorByWhat: lookup(creatorList, 'what', 'creator'),
	};
}
