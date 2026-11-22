import { atomKindDefine } from '../../../main/frontend/src/lib/doc-edit-atom-kind.js';
import { mathRender, mathSourceBuild, mathSpanListGet } from './MathData.js';
import { MathSourceField } from './MathSourceField.jsx';
import './math.css';

// A formula as one thing of a text being typed (comp_math.md):
// the atom kind math. In a paragraph or the text of a list item a formula is a
// chip, drawn by KaTeX as the page draws it, in the line ($x^2$) or on lines
// of its own ($$ … $$, a chip as wide as the text); its source is typed in a
// field below it (MathSourceField), and the chip is drawn again as it is typed.
export const mathAtomKind = atomKindDefine({
  name: 'math',
  label: 'formula',
  spanListGet: mathSpanListGet,
  sourceBuild: mathSourceBuild,
  draw: mathRender,
  Editor: MathSourceField,
  // KaTeX draws each formula as one .katex (a formula on a row: in .katex-display)
  elementSelector: '.katex',
});
