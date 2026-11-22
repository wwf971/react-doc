import { FileText } from '../../../main/frontend/UICommon.js';
import { slashBlockActionDefine } from '../../../main/comp-doc/slash/slash-define.js';
import { MDX_VIEW_DEFAULT, MDX_VIEW_ENTRY_LIST, mdxBlockSourceBuild } from './MdxData.js';

// /mdx: an MDX block at the caret (doc_page_impl_mdx_embed.md): a document of
// its own written inside this one, drawn as an icon whose popup shows it, and
// edits it in edit mode. in the text of a list item it is a chip of the text;
// in a paragraph a block between the text before and after the caret; in the
// source of a whole list its lines are typed where the caret is.
//
// its view is an optional parameter (slashBlockActionDefine): Enter puts the
// block in the icon view, Tab or "/mdx " lists the views, "/mdx card" chooses
// one by typing
export const mdxSlashAction = slashBlockActionDefine({
  name: 'mdx',
  aliasList: ['embed', 'doc'],
  label: 'MDX block',
  description: 'a document of its own inside this one, shown as an icon that opens it',
  icon: FileText,
  viewList: MDX_VIEW_ENTRY_LIST,
  viewDefaultGet: () => MDX_VIEW_DEFAULT,
  sourceBuild: (view) => mdxBlockSourceBuild({ view }),
});
