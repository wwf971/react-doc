import { LinkIcon } from '../../frontend/UICommon.js';
import { linkDirParamGet, linkItemListGet, linkMarkdownBuild, LINK_DOC_EXT_LIST } from '../../frontend/src/lib/doc-link-complete.js';
import { slashEffect } from '../../frontend/src/lib/doc-slash.js';
import { slashActionDefine } from '../slash/slash-define.js';

// /link: a link to a document of the workspace, written while typing.
// the navigation layer offers it to the slash mode of the default editors
// (doc_page_impl_nav.md#writing-a-link, doc_page_impl_edit_slash.md).
//
//   /link guide          documents whose name, title or path hold "guide"
//   /link ~example/      what is in the folder ~example (a folder chosen
//                        goes on inside it)
//   /link guide#setup    the place is kept: [Guide](./guide.md#setup)
//
// a document chosen replaces the slash text with [title](target), the
// target the shortest that names exactly that document from the one being
// edited: relative in the same root, ~root/... in another root of the same
// doc page, ~page:root/... in another doc page of the workspace.
//
//   isTargetFull   the target is written in the full form (~page:root/a.md)
//                  whatever document is edited: for a text that does not belong
//                  to one document (a cell of a frontend object, link-cell.jsx)
export function linkSlashActionBuild({ isTargetFull = false } = {}) {
  return slashActionDefine({
    name: 'link',
    aliasList: ['ln'],
    label: 'Link',
    description: 'a link to a document of the workspace',
    icon: LinkIcon,
    param: {
      placeholder: 'a document name or title, or a path (~root/, ./)',
      emptyText: 'No document matches',
      itemListGet: (param, context) => linkItemListGet(param, {
        candidateList: context.source.pathComplete('', { kind: 'any', extList: LINK_DOC_EXT_LIST }),
        fromPath: context.sourcePath,
      }),
      itemChoose: (item, param, context) => (item.kind === 'dir'
        ? slashEffect.paramSet(linkDirParamGet(item, param))
        : slashEffect.replace(linkMarkdownBuild(item, param, isTargetFull ? '' : context.sourcePath))),
    },
  });
}

// the action of the page's registry: what a paragraph or a list offers
export const linkSlashAction = linkSlashActionBuild();
