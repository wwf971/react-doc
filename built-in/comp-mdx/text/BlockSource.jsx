import { BlockRender } from './BlockRender.jsx';
import { BlockSourceEdit } from './BlockSourceEdit.jsx';

// The registered component "BlockSource" (common/BlockSource): the fallback
// editor of every block that has no editor of its own (code, table,
// blockquote, math, html, custom components without edit support ...), and
// the editor of the frontmatter and of the whole document source.
//   config.isEdit -> BlockSourceEdit (the source edited in the block's place)
//   otherwise     -> the block rendered as in the document body
export function BlockSource({ data = {}, config = {}, onEvent }) {
  if (config.isEdit) return <BlockSourceEdit data={data} config={config} onEvent={onEvent} />;
  return (
    <BlockRender
      data={{ text: data.text }}
      config={{ format: config.edit?.format, sourcePath: config.sourcePath }}
    />
  );
}
