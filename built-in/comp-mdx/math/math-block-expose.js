import { Sigma } from '../../../main/frontend/UICommon.js';
import { mathBlockTextRead, mathSourceBuild } from './MathData.js';

// What the component MathBlock tells the page (comp_math.md#a-block-of-math-as-data): a block of math
// stands in a document as $$ lines, its native form, and is held as data where a block of a document
// is (a card of a card diagram: { comp: MathBlock, lang: latex, raw: the formula }).
//
//   sourceDefaultCreate   a new block: $$ lines (the insert menu writes them in a document; what
//                         holds a block as data reads them by blockTextRead)
//   blockTextRead         $$ lines, the data of a block of it: its formula
//   editModeList          Formula, in place: the formula drawn where it stands, a click types its
//                         source below it (a card of a card diagram keeps it open)
//
// A block of $$ lines of a document is edited by the edit layer (MathBlock in placement edit, the
// editor of the block kind math), not by these modes: they are for a block of it held as data.
export const MATH_BLOCK_SOURCE_DEFAULT = 'x';

export const mathBlockExpose = {
  meta: {
    label: 'Math',
    description: 'A formula of LaTeX on a row of its own ($$), drawn by KaTeX.',
  },
  icon: Sigma,
  sourceDefaultCreate: () => ({ text: mathSourceBuild(MATH_BLOCK_SOURCE_DEFAULT, true) }),
  blockTextRead: mathBlockTextRead,
  editModeList: [
    { id: 'formula', label: 'Formula', description: 'its source typed below it, the formula drawn as it is typed', icon: Sigma, isDefault: true, isInPlace: true },
  ],
};
