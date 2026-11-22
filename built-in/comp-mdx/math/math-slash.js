import { Sigma } from '../../../main/frontend/UICommon.js';
import { slashActionDefine } from '../../../main/comp-doc/slash/slash-define.js';
import { slashEffect, slashViewItemListGet } from '../../../main/frontend/src/lib/doc-slash.js';

// /math (or /latex): an empty formula at the caret, its field open below its
// chip (comp_math.md#adding-a-formula). where it stands is an
// optional parameter, as the view of /code is: Enter puts it in the line, Tab
// (or "/math " typed) lists the two places, which are on the row of the action
// for a pointer too.
//
// in a paragraph and in the text of a list item the formula is an atom of the
// text (the kind math, math-atom.js); in a surface that types no atom (the
// source of a whole list) its source is typed instead (textFallback)
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
  run: () => mathEffectGet(false),
  param: {
    label: 'place',
    placeholder: 'in the line or on a row; Enter: in the line',
    isListedOnRow: true,
    emptyText: 'No place is named so',
    itemListGet: (param) => slashViewItemListGet(MATH_PLACE_LIST, 'inline', param),
    itemChoose: (item) => mathEffectGet(item.id === 'row'),
  },
});

function mathEffectGet(isRow) {
  return slashEffect.atom('math', { isRow, textFallback: isRow ? '\n$$\nx\n$$\n' : '$x$' });
}
