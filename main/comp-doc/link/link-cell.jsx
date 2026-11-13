import { cellLinkMatchList } from '../../frontend/src/lib/doc-cell.js';
import { linkUrlIsExternal, linkUrlIsFragment } from '../../frontend/src/lib/doc-link-classify.js';
import { cellTokenDefine } from '../cell/cell-define.js';
import { DocLink } from './DocLink.jsx';
import { linkSlashActionBuild } from './link-slash.js';

// The link in a cell (doc_page_impl_edit_cell.md#token-kinds, doc_page_impl_nav.md#writing-a-link):
// the token kind the navigation layer offers the cell edit layer. A link is
// written in a cell as it is in a document, [label](target), with the target
// grammar of the navigation layer, and is drawn by DocLink: resolved against
// the source of the workspace, followed through the routes of the page, with
// its candidate list, its popup and its warning, as a link of a document is.
//
// A cell belongs to data, not to one document: the same cell is drawn
// wherever a block shows its object. So /link writes the target in the full
// form (~page:root/a.md), which names the same document from everywhere; a
// relative target typed by hand is resolved from the document the cell is
// drawn in.
export const linkCellToken = cellTokenDefine({
  name: 'link',
  label: 'Link',
  description: 'a link to a document of the workspace: [label](target)',
  match: cellLinkMatchList,
  Render: LinkCellRender,
  textGet: (token) => token.data.label || token.data.target,
  slashAction: linkSlashActionBuild({ isTargetFull: true }),
});

function LinkCellRender({ token, cell }) {
  const { label, target } = token.data;
  // a url and a place of the page itself are the browser's, as in a document
  if (linkUrlIsExternal(target) || linkUrlIsFragment(target)) {
    return <a href={target} {...(linkUrlIsExternal(target) ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>{label || target}</a>;
  }
  return <DocLink target={target} from={cell?.sourcePath ?? ''} kind="inline">{label || target}</DocLink>;
}
