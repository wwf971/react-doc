import { compDefine } from '../../../main/comp-doc/registry/comp-registry.js';
import { MathFormulaBlock } from './MathFormula.jsx';
import { mathBlockExpose } from './math-block-expose.js';

// MathBlock for an app with no documents (zatelier-drawboard: the cards of its diagrams): a block of
// math held as data alone (placement commentBlock), what MathBlock draws for it, without the document
// renderer a block of $$ lines needs. Registered as common/MathBlock, tag MathBlock, so a card holding
// it is the same as on a doc page (comp_math.md#a-block-of-math-as-data)
export const mathFormulaDefine = compDefine(MathFormulaBlock, { placementList: ['commentBlock'], expose: mathBlockExpose });
