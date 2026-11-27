import { compDefine } from '../../../main/comp-doc/registry/comp-registry.js';
import { MathBlock } from './MathBlock.jsx';
import { mathBlockExpose } from './math-block-expose.js';

// The component MathBlock (common/MathBlock, comp_math.md#a-block-of-math): the editor of a block of
// $$ lines of a document (placement edit, the default editor of the block kind math), and a block of
// math held as data where a block of a document is (placement commentBlock: a card of a card diagram).
// Registered by the page (registry.js); an app with no documents registers mathFormulaDefine
// (math-formula-comp.js) under the same id
export const mathBlockDefine = compDefine(MathBlock, { placementList: ['edit', 'commentBlock'], expose: mathBlockExpose });
