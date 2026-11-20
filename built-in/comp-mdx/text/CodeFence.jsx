import { createElement } from 'react';
import { observer } from 'mobx-react-lite';
import { defaultMdxComponents } from '../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../main/frontend/src/store/context.js';
import { CODE_PLACE_LIST_ITEM, CODE_VIEW_LIST } from '../../../main/frontend/src/lib/rehype-code-view.js';
import './code-fence.css';

// Fenced code blocks of a document.
//
// codeFenceTagCreate(sourcePath) is the "pre" component of the document
// body: the Fumadocs code block, drawn in the view of the block
// (main/doc_page_impl_mdx_code.md#the-views-of-a-code-block):
//
//   data-view    the view its author wrote in the info of the fence
//   data-place   where the block stands, marked by the compile ("listItem":
//                the block is a list item, the whole text of the item)
//
// without a view of its own, the block takes the view the config of its
// document gives its place: CodeBlockViewAsListItem for a block that is a
// list item, CodeBlockView elsewhere. the view is an attribute of the figure, and the
// look of each view is css (code-fence.css).
//
//   sourcePath   the document the block belongs to, when it is not the
//                current page
const PreDefault = defaultMdxComponents.pre ?? 'pre';

export function codeFenceTagCreate(sourcePath) {
  return observer(function CodeFenceTag({ 'data-view': viewAuthored, 'data-place': place, ...props }) {
    const { configStore, docStore } = useDocStores();
    const docPath = sourcePath ?? docStore?.docCurrentPath ?? '';
    const viewConfig = configStore?.valueDocGet(docPath, place === CODE_PLACE_LIST_ITEM ? 'CodeBlockViewAsListItem' : 'CodeBlockView');
    const view = [viewAuthored, viewConfig].find((value) => CODE_VIEW_LIST.includes(value)) ?? CODE_VIEW_LIST[0];
    return createElement(PreDefault, { ...props, 'data-view': view, 'data-place': place });
  });
}
