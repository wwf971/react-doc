import { BlockRender } from '../text/BlockRender.jsx';
import { MathBlockEdit } from './MathBlockEdit.jsx';

// The registered component "MathBlock" (common/MathBlock): the default editor
// of a block of math, $$ on lines of its own (comp_math.md).
//   config.isEdit -> MathBlockEdit (the formula drawn in its place, its
//                    source typed below it)
//   otherwise     -> the block rendered as in the document body
export function MathBlock({ data = {}, config = {}, onEvent }) {
  if (config.isEdit) return <MathBlockEdit data={data} config={config} onEvent={onEvent} />;
  return (
    <BlockRender
      data={{ text: data.text }}
      config={{ format: config.edit?.format, sourcePath: config.sourcePath }}
    />
  );
}
