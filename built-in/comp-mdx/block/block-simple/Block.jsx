import { BlockMdx } from '../block-mdx/BlockMdx.jsx';
import { BlockSimple } from './BlockSimple.jsx';
import { blockVariantGet } from './BlockVariant.js';

function Block({ data = {}, config = {}, onEvent }) {
  const CompBlock = blockVariantGet(data) === 'mdx' ? BlockMdx : BlockSimple;
  return <CompBlock data={data} config={config} onEvent={onEvent} />;
}

export { Block };
