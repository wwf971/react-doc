import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../../main/frontend/src/store/context.js';
import { DynamicCodeBlock } from '../../../main/comp-doc/mdx-render/DynamicCodeBlock.js';
import { CODE_PLACE_IN_LIST_ITEM, CODE_PLACE_LIST_ITEM, CODE_VIEW_LIST, codeViewConfigKeyGet } from '../../../main/frontend/src/lib/rehype-code-view.js';
import { CodeIconView, CodeLinesDialogHost } from './CodeIconView.jsx';
import { useAssetPanelIsAvailable } from '../../../main/comp-doc/asset/AssetPanelPopup.jsx';
import './code-fence.css';

// The component Code: lines of code or of text drawn as a fenced code block
// draws them, from its data rather than from the document
// (main/doc_page_impl_mdx_code.md#the-lines-in-the-asset-service-layer). It
// is what a code block becomes when its lines move into the asset service
// layer: the block names the item, and the page hands the component the
// item's text and language, as for any component:
//
//   <!--renderComp=Code,view=icon,title=setup.py-->
//   ```asset
//   store: local
//   itemId: w4okcncucnu
//   ```
//
// written inline (```python and the lines), it draws them the same way.
//
//   data.raw, data.lang   the lines and their language (an item of the store: its text, its lang)
//   data.view             the view its author chose (card | plain | icon), the
//                         view= of the info string it was a fence with; without
//                         one, the config of the document decides by its place,
//                         as for a fence (CodeBlockView, CodeBlockViewAsListItem)
//   data.title            the title of the block, title="…" of the fence it was
//   config.place          'listItem': the block is the whole text of a list
//                         item (remark-comment-comp.js marks it)
//
// the lines are highlighted in the page (DynamicCodeBlock), since they are
// not part of the compiled document; the figure carries the same attributes
// as a fence's (data-view, data-language, data-place), so every view looks
// the same (code-fence.css). in the icon view the lines are edited in the
// dialog of the tile and saved as the component's data (dataReplaceRequest,
// with lang when the language changed): into the asset item when they are in
// the store (config.assetInfo; its lang changed too), into the block when they
// are written inline (the language of its fence). lines of an item have the
// Asset button in the header of the dialog: the asset panel of the item.
const LANG_TEXT = 'text';

export const Code = observer(function Code({ data = {}, config = {}, onEvent }) {
  const { assetStore, configStore, editStore, envStore } = useDocStores();
  const isAssetPanelAvailable = useAssetPanelIsAvailable();
  const lang = typeof data.lang === 'string' && data.lang && data.lang !== 'asset' ? data.lang : LANG_TEXT;
  const code = String(data.raw ?? '').replace(/\n$/, '');
  const place = [CODE_PLACE_LIST_ITEM, CODE_PLACE_IN_LIST_ITEM].includes(config.place) ? config.place : undefined;
  const docPath = config.sourcePath ?? '';
  const viewConfig = configStore?.valueDocGet(docPath, codeViewConfigKeyGet(place));
  const view = [data.view, viewConfig].find((value) => CODE_VIEW_LIST.includes(value)) ?? CODE_VIEW_LIST[0];
  const title = typeof data.title === 'string' ? data.title : '';
  const isFromAsset = Boolean(config.assetInfo?.isFromAsset);
  let editReason = '';
  if (isFromAsset && !assetStore?.isWritable) editReason = 'the asset service layer cannot be written here';
  else if (!isFromAsset && !editStore?.docIsEditable(docPath)) editReason = envStore?.reasonGet?.('edit') || 'this document cannot be written from the page';
  // what the dialog of the lines needs, in every view (the icon view opens it
  // from its tile, another view from the chip of the block in the editor of a list item)
  const dialogProps = {
    lang,
    title,
    value: code,
    stateConfig: config,
    editReason,
    isEditStart: Boolean(config.docState?.isEditing) && editReason === '',
    onSave: async (text, langNew) => (await onEvent?.('dataReplaceRequest', langNew === undefined ? { raw: text } : { raw: text, lang: langNew }))
      ?? { code: -1, message: 'the lines cannot be written here' },
    // the lines are an item of the store: the Asset button opens its panel
    assetOpen: isFromAsset && isAssetPanelAvailable
      ? {
          onOpen: () => assetStore.panelOpen(config.assetInfo.store, config.assetInfo.itemId, config.assetInfo.versionIdRef ?? '', {
            compName: 'Code',
            propsAuthored: { ...(data.view ? { view: data.view } : {}), ...(title ? { title } : {}) },
            sourcePath: docPath,
            sourceLine: config.sourceLine,
          }),
        }
      : undefined,
  };
  if (view === 'icon') {
    return (
      <CodeIconView
        {...dialogProps}
        lineCount={code === '' ? 0 : code.split('\n').length}
        place={place}
        align={configStore?.valueDocGet(docPath, 'CodeBlockIconAlign') === 'top' ? 'top' : 'bottom'}
      />
    );
  }
  return (
    <>
      <DynamicCodeBlock
        code={code}
        lang={lang}
        codeblock={{
          title: title || undefined,
          // the margin of a block of the document, as a fence's; the views set their own
          className: view === 'card' && place === undefined ? 'my-4' : undefined,
          'data-view': view,
          'data-language': lang,
          'data-place': place,
          'data-code-key': config.stateKey || undefined,
        }}
      />
      <CodeLinesDialogHost {...dialogProps} />
    </>
  );
});
