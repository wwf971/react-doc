import { BlockRender } from '../text/BlockRender.jsx';
import { MathBlockEdit } from './MathBlockEdit.jsx';
import { MathFormulaBlock } from './MathFormula.jsx';

// The registered component "MathBlock" (common/MathBlock): a block of math (comp_math.md).
//
// A block of a document, $$ on lines of its own (data.text: placement edit, the default editor of
// the block kind math):
//   config.isEdit -> MathBlockEdit (the formula drawn in its place, its source typed below it)
//   otherwise     -> the block rendered as in the document body
//
// A block of it held as data (data.raw, the formula: placement commentBlock, a card of a card diagram
// holding it, comp_math.md#a-block-of-math-as-data): MathFormulaBlock (MathFormula.jsx)
export function MathBlock({ data = {}, config = {}, onEvent }) {
  if (data.text !== undefined) {
    if (config.isEdit) return <MathBlockEdit data={data} config={config} onEvent={onEvent} />;
    return (
      <BlockRender
        data={{ text: data.text }}
        config={{ format: config.edit?.format, sourcePath: config.sourcePath }}
      />
    );
  }
  return <MathFormulaBlock data={data} config={config} onEvent={onEvent} />;
}
