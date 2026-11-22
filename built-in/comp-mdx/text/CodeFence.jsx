import { createElement } from 'react';
import { observer } from 'mobx-react-lite';
import { defaultMdxComponents } from '../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../main/frontend/src/store/context.js';
import { CODE_VIEW_LIST, codeViewConfigKeyGet } from '../../../main/frontend/src/lib/rehype-code-view.js';
import { useDocEditLineGet } from '../../../main/comp-doc/edit/DocEditDocContext.js';
import { CodeIconView, CodeLinesDialogHost, codeTextFromChildren } from './CodeIconView.jsx';
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
// look of each view is css (code-fence.css). the icon view draws a square
// tile in its place (CodeIconView), and the lines in a code editor in the
// dialog the tile opens, where they can be edited: the block is found in the
// source by the line of its fence (data-source-line, rehypeCodeLine) and its
// lines written there (DocEditStore.codeFenceLinesWrite), from reading mode
// too, wherever the page can write documents. the To asset button of the
// dialog moves the lines into the asset store the same way
// (DocEditStore.codeFenceAssetMove), whether the block stands alone, is a
// list item, or stands in the text of an item among other things.
//
//   sourcePath   the document the block belongs to, when it is not the
//                current page
const PreDefault = defaultMdxComponents.pre ?? 'pre';

export function codeFenceTagCreate(sourcePath) {
  return observer(function CodeFenceTag({ 'data-view': viewAuthored, 'data-place': place, 'data-source-line': sourceLineText, ...props }) {
    const { assetStore, configStore, docStore, editStore, envStore } = useDocStores();
    const docPath = sourcePath ?? docStore?.docCurrentPath ?? '';
    // in the edit body, the line of the compile that drew the block, read with
    // how far the block moved since (useDocEditLineGet)
    const sourceLineNowText = useDocEditLineGet(docPath)(sourceLineText);
    const viewConfig = configStore?.valueDocGet(docPath, codeViewConfigKeyGet(place));
    const view = [viewAuthored, viewConfig].find((value) => CODE_VIEW_LIST.includes(value)) ?? CODE_VIEW_LIST[0];
    const value = codeTextFromChildren(props.children);
    const sourceLine = Number(sourceLineNowText);
    let editReason = '';
    if (!Number.isInteger(sourceLine) || sourceLine < 1) editReason = 'the line of the block in its document is not known';
    else if (!editStore?.docIsEditable(docPath)) {
      editReason = editStore?.isAvailable
        ? 'this document cannot be written from the page'
        : envStore?.reasonGet?.('edit') || 'editing is available on the development server only';
    }
    // what the dialog of the lines needs, in every view: the tile of the icon
    // view opens it, and a block of another view has it too, opened from the
    // editor of a list item (a double click on its chip)
    const stateKey = `fence:${docPath}#${sourceLineNowText ?? ''}`;
    const dialogProps = {
      lang: props['data-language'] ?? '',
      title: typeof props.title === 'string' ? props.title : '',
      value,
      stateConfig: { stateKey, compId: 'common/CodeFence' },
      editReason,
      isEditStart: Boolean(editStore?.isEditMode) && editReason === '',
      onSave: (text, lang) => editStore.codeFenceLinesWrite(docPath, sourceLine, text, lang),
      // where the page can write documents and has an asset store: the lines
      // can move into it, from the dialog, whatever the block stands in
      assetMove: editStore?.isAvailable && assetStore
        ? {
            reason: editReason || editStore.codeFenceAssetMoveReasonGet(docPath),
            onMove: () => editStore.codeFenceAssetMove(docPath, sourceLine),
          }
        : undefined,
    };
    if (view === 'icon') {
      return (
        <CodeIconView
          {...dialogProps}
          lineCount={value === '' ? 0 : value.split('\n').length}
          place={place}
          align={configStore?.valueDocGet(docPath, 'CodeBlockIconAlign') === 'top' ? 'top' : 'bottom'}
        />
      );
    }
    return (
      <>
        {createElement(PreDefault, { ...props, 'data-view': view, 'data-place': place, 'data-code-key': stateKey })}
        <CodeLinesDialogHost {...dialogProps} />
      </>
    );
  });
}
