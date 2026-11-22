import { MathCopyLayer } from '../../../built-in/comp-mdx/math/MathCopyLayer.jsx';

// The layers of the page that components bring (doc_page_impl.md#page-layers):
// something drawn over the page, in no block, for whatever of a component the
// page shows (the copy control of a formula on a row: built-in/comp-mdx/math).
// A layer is a React component without props, drawn once by the page inside
// its stores (DocPageMdx); it finds what it is about in the page itself, and
// adds nothing to the flow (a portal, position fixed).
//
// by id ({layer}/{name}), as the other registries of the page: the package's
// here, the host's over them (config.pageLayerById; an id mapped to null
// removes one)
export const pageLayerById = {
  'math/copy': MathCopyLayer,
};

// the layers of the page, in the order of their ids -> [{ id, Layer }]
export function pageLayerListBuild(...layerList) {
  const byId = {};
  for (const layer of layerList) {
    for (const [id, Layer] of Object.entries(layer ?? {})) {
      if (Layer === null) {
        delete byId[id];
        continue;
      }
      if (typeof Layer !== 'function' && typeof Layer?.$$typeof !== 'symbol') {
        console.warn(`[doc-page-layer] ${id}: not a React component; left out`);
        continue;
      }
      byId[id] = Layer;
    }
  }
  return Object.keys(byId).sort().map((id) => ({ id, Layer: byId[id] }));
}
