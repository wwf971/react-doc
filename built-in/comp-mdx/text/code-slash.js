import { SquareCode } from '../../../main/frontend/UICommon.js';
import { slashBlockActionDefine } from '../../../main/comp-doc/slash/slash-define.js';
import { codeViewEntryListBuild } from '../../../main/comp-doc/edit/code-view-entry.js';
import { codeInfoLangSet, codeInfoViewSet, codeViewConfigKeyGet } from '../../../main/frontend/src/lib/rehype-code-view.js';

// /code: a fenced code block at the caret (doc_page_impl_mdx_code.md), put
// there as /mdx puts an MDX block: in the text of a list item a block of its
// text (its lines open at once, unless it is an icon), in a paragraph a block
// between the text before and after the caret.
//
// its view is an optional parameter (slashBlockActionDefine). the default is
// the view the config gives a block where the caret is (CodeBlockView in a
// document, CodeBlockViewInListItem in the text of a list item), and choosing
// it writes no view, so the block goes on following the config; another view
// is written in its info string (view=plain)
// the views as the menu lists them: the labels of the view menus of a block
// (code-view-entry.js), a description short enough for one row
const CODE_VIEW_DESCRIPTION_BY_ID = {
  card: 'set apart from the text, on a background of its own',
  plain: 'lines that stand like text, in a thin frame',
  icon: 'a tile in the line; its lines open in a dialog',
};
const CODE_VIEW_SLASH_LIST = codeViewEntryListBuild('')
  .filter((entry) => entry.id !== '')
  .map((entry) => ({ id: entry.id, label: entry.label, description: CODE_VIEW_DESCRIPTION_BY_ID[entry.id] ?? '' }));

export const codeSlashAction = slashBlockActionDefine({
  name: 'code',
  aliasList: ['fence'],
  label: 'Code block',
  description: 'lines kept as they are typed, in a fenced block',
  icon: SquareCode,
  viewList: CODE_VIEW_SLASH_LIST,
  viewDefaultGet: (context) => context?.configValueGet?.(codeViewConfigKeyGet(context?.place)),
  sourceBuild: (view) => codeBlockSourceBuild(view),
});

// the source of a new code block: an empty fence, its view in its info string
// when one is chosen (the language then written as text: the first word of an
// info string is the language)
export function codeBlockSourceBuild(view) {
  const info = codeInfoLangSet(codeInfoViewSet('', view ?? ''), '');
  return `\`\`\`${info}\n\`\`\``;
}
