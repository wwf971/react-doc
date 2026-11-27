import { Sigma } from '../../../main/frontend/UICommon.js';
import { slashActionDefine } from '../../../main/comp-doc/slash/slash-define.js';
import { slashEffect, slashViewItemListGet } from '../../../main/frontend/src/lib/doc-slash.js';
import { mathSourceBuild } from './MathData.js';
import { MATH_BLOCK_SOURCE_DEFAULT } from './math-block-expose.js';

// /math (or /latex): an empty formula at the caret, its field open below its
// chip (comp_math.md#adding-a-formula). where it stands is an
// optional parameter, as the view of /code is: Enter puts it in the line, Tab
// (or "/math " typed) lists the two places, which are on the row of the action
// for a pointer too.
//
// in a paragraph and in the text of a list item the formula is an atom of the
// text (the kind math, math-atom.js); in a surface that types no atom (the
// source of a whole list) its source is typed instead (textFallback); in a surface taking a
// block alone (the create panel of a card diagram) a block of math, which a card holds
const MATH_PLACE_LIST = [
  { id: 'inline', label: 'In the line', description: 'among the words: $…$' },
  { id: 'row', label: 'On a row', description: 'set apart, on lines of its own: $$' },
];

export const mathSlashAction = slashActionDefine({
  name: 'math',
  aliasList: ['latex'],
  label: 'Formula',
  description: 'LaTeX, in the line or on a row of its own',
  icon: Sigma,
  // where a surface takes a block alone (context.isBlockOnly: a card of a card diagram), a block of
  // math, whichever place is chosen: the card holds it (MathBlock, comp_math.md#a-block-of-math-as-data)
  block: { viewList: [] },
  run: (context) => mathEffectGet(false, context),
  param: {
    label: 'place',
    placeholder: 'in the line or on a row; Enter: in the line',
    isListedOnRow: true,
    emptyText: 'No place is named so',
    itemListGet: (param) => slashViewItemListGet(MATH_PLACE_LIST, 'inline', param),
    itemChoose: (item, param, context) => mathEffectGet(item.id === 'row', context),
  },
});

function mathEffectGet(isRow, context) {
  if (context?.isBlockOnly) return slashEffect.block(mathSourceBuild(MATH_BLOCK_SOURCE_DEFAULT, true));
  return slashEffect.atom('math', { isRow, textFallback: isRow ? '\n$$\nx\n$$\n' : '$x$' });
}
