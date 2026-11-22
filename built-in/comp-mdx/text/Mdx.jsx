import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { FileText } from '../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../main/frontend/src/store/context.js';
import { useCodeLinesOpener } from '../../../main/comp-doc/code-editor/code-lines-open.js';
import { CODE_PLACE_IN_LIST_ITEM, CODE_PLACE_LIST_ITEM } from '../../../main/frontend/src/lib/rehype-code-view.js';
import { mdxViewGet } from './MdxData.js';
import './code-fence.css';

// The MDX block (doc_page_impl_mdx_embed.md): a document of its own written
// inside this one, in the fence of its block. Like a code block it has views,
// written on its marker:
//
//   icon (default)   a tile in the line, as a code block in the icon view; a
//                    click opens the document in a popup
//   card             the document drawn in place, in a quiet frame; in edit
//                    mode a click on it opens the popup
//
// the popup is the page's (DocEmbedPopup, DocEmbedPopupStore), not this
// component's: this block is drawn again on every write of its host, and
// every edit made in the popup is one; a popup drawn here would be drawn anew
// each time, the caret and the open session in it lost. the block asks the
// page to open it, and while it is open hands it what the block says now
// (its title, its text, its line). the popup shows the document rendered, or
// in edit mode its edit body (the embedded document, embedPathBuild of the host
// and the line of the block), written into this fence. in the text of a list
// item the block is a chip of the text, as a code block is.
//
//   data.raw       the text of the embedded document
//   data.view      icon | card
//   data.title     what the tile and the popup say
//   config.sourceLine  the line of its marker: the embedded document's path
export const Mdx = observer(function Mdx({ data = {}, config = {}, onEvent }) {
  const { configStore, embedPopupStore } = useDocStores();
  const view = mdxViewGet(data.view);
  const title = typeof data.title === 'string' ? data.title : '';
  const raw = String(data.raw ?? '').replace(/\n$/, '');
  const docPath = config.sourcePath ?? '';
  const line = Number(config.sourceLine);
  const key = config.stateKey || `mdx:${docPath}#${config.sourceLine ?? ''}`;
  const place = [CODE_PLACE_LIST_ITEM, CODE_PLACE_IN_LIST_ITEM].includes(config.place) ? config.place : undefined;
  const isEditing = Boolean(config.docState?.isEditing);
  const MdxRenderer = config.MdxRenderer;
  const isOpen = Boolean(embedPopupStore?.isOpenFor(key));
  const open = () => embedPopupStore?.open({ key, hostPath: docPath, line, title, raw, Renderer: MdxRenderer });
  // the editor of a list item opens it from its chip (a double click)
  useCodeLinesOpener(config.stateKey, open);
  // open: the popup follows what the block says now (a write of the host,
  // an edit made in the popup itself, a new title)
  useEffect(() => {
    if (isOpen) embedPopupStore.update(key, { title, raw, line, Renderer: MdxRenderer });
  }, [embedPopupStore, isOpen, key, title, raw, line, MdxRenderer]);
  const contentRead = MdxRenderer ? (
    <MdxRenderer
      data={{ source: raw }}
      config={{
        className: 'doc-mdx-embed-content',
        isExpressionAllowed: false,
        sourcePath: docPath,
        textEmpty: 'An empty document',
        textError: 'The text of the block cannot be shown.',
      }}
      onEvent={onEvent}
    />
  ) : <pre className="doc-mdx-embed-content">{raw}</pre>;

  if (view === 'card') {
    return (
      <div
        className="doc-mdx-embed-card not-prose"
        data-place={place}
        data-code-key={config.stateKey || undefined}
        // in edit mode the card is a control: its click opens the document to edit it
        role={isEditing ? 'button' : undefined}
        title={isEditing ? 'Open the document of this block to edit it' : undefined}
        onClick={isEditing ? open : undefined}
      >
        <div className="prose">{contentRead}</div>
      </div>
    );
  }
  const label = title || 'mdx';
  return (
    <button
      type="button"
      className="doc-code-icon doc-mdx-embed-icon not-prose"
      data-place={place}
      data-align={configStore?.valueDocGet(docPath, 'CodeBlockIconAlign') === 'top' ? 'top' : 'bottom'}
      data-code-key={config.stateKey || undefined}
      title={`${title || 'MDX block'}: click to show${isEditing ? ' or edit' : ''} the document`}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      onClick={open}
    >
      <span className="doc-code-icon-glyph"><FileText aria-hidden="true" size={20} strokeWidth={1.7} /></span>
      <span className="doc-code-icon-label">{label}</span>
    </button>
  );
});
