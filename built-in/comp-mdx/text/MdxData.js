// The MDX block (doc_page_impl_mdx_embed.md): its marker and its views.
//
//   <!--renderComp=Mdx,view=icon,title=Notes-->
//   ```md
//   # Notes
//   the text of the embedded document
//   ```

import { markerValueNormalize } from '../../../main/frontend/src/lib/doc-edit-block.js';

export const MDX_COMPONENT_NAME = 'Mdx';
// icon: a tile in the line, the document in a popup; card: the document drawn
// in place, in a quiet frame (opened in the popup to be edited)
export const MDX_VIEW_LIST = ['icon', 'card'];
export const MDX_VIEW_DEFAULT = 'icon';

export function mdxViewGet(viewAuthored) {
  return MDX_VIEW_LIST.includes(viewAuthored) ? viewAuthored : MDX_VIEW_DEFAULT;
}

// the views as the slash action /mdx offers them (mdx-slash.js); isTile: the view draws a tile
export const MDX_VIEW_ENTRY_LIST = [
  { id: 'icon', label: 'Icon', description: 'a tile in the line; a click opens the document', isTile: true },
  { id: 'card', label: 'Card', description: 'the document drawn in place, in a quiet frame' },
];

// the source of a new MDX block: its marker, an empty fence. the view is
// written when one is chosen; without it the block has the default
export function mdxBlockSourceBuild({ title = '', view = '' } = {}) {
  const titleText = markerValueNormalize(title);
  const viewText = MDX_VIEW_LIST.includes(view) ? view : '';
  const props = [...(viewText ? [`view=${viewText}`] : []), ...(titleText ? [`title=${titleText}`] : [])];
  return `<!--renderComp=${[MDX_COMPONENT_NAME, ...props].join(',')}-->\n\`\`\`md\n\`\`\``;
}
