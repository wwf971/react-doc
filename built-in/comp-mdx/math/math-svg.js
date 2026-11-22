import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

// A formula as an SVG of its own (comp_math.md#copying-a-formula): the
// page draws formulas with KaTeX, which draws HTML only; MathJax (version 3,
// mathjax-full) turns the same LaTeX into an SVG of paths, its TeX font in
// the package, so the SVG needs no font and nothing is fetched. Loaded only
// when a formula is copied as SVG (a dynamic import of this module).
//
// the packages of TeX: all but those that load more at run time (autoload,
// require), which a bundled page has no loader for

const PACKAGE_LEFT_OUT_LIST = ['autoload', 'require'];

let documentMath;
let adaptor;

function documentGet() {
  if (documentMath) return documentMath;
  adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  documentMath = mathjax.document('', {
    InputJax: new TeX({ packages: AllPackages.filter((name) => !PACKAGE_LEFT_OUT_LIST.includes(name)) }),
    // its glyphs as paths inside the SVG itself (not shared between SVGs)
    OutputJax: new SVG({ fontCache: 'local' }),
  });
  return documentMath;
}

// the SVG of a formula: <svg xmlns=… width=…ex height=…ex viewBox=…>, drawn
// in currentColor. what TeX cannot read is drawn as MathJax draws an error
//   isDisplay   a formula of its own lines (display style)
export function mathSvgGet(source, { isDisplay = true } = {}) {
  const node = documentGet().convert(String(source ?? ''), { display: isDisplay });
  // the container MathJax wraps the SVG in is left out
  return adaptor.innerHTML(node);
}
