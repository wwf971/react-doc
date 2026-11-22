import { observer } from 'mobx-react-lite';
import { Check, Copy, DocsBody, Eye, Pencil } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { PanelPopup } from './PanelPopup.jsx';
import { DocPopupBody } from '../edit/DocPopupBody.jsx';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { EDIT_POPUP_CLASS } from '../edit/use-edit-outside-pointer.js';

// The popup of an MDX block (doc_page_impl_mdx_embed.md#the-popup), drawn by
// the page from DocEmbedPopupStore, never by the block: a write of the host
// draws the block again, and this popup, with the caret and the session in
// it, stays as it is.
//
// its header is the header of the dialog of a code block, less what only
// lines have (a language, the asset store):
//
//   Notes                                    [Copy] [👁 View | ✎ Edit] [⤢] [×]   View
//   [Notes        ]                          [Copy] [👁 View | ✎ Edit] [⤢] [×]   Edit: the title a field
//
// View shows the document rendered; Edit its edit body (DocPopupBody), the
// page in edit mode: Edit turns it on when it is off, as its own switch would.
// In Edit the title is a field written on the marker of the block when it is
// left (Enter, or a click elsewhere); emptied, the block has no title.
export const DocEmbedPopup = observer(function DocEmbedPopup() {
  const { embedPopupStore: store, editStore } = useDocStores();
  const popup = store?.popup;
  if (!store || !popup) return null;
  const isEditShown = store.isEditShown;
  const editReason = store.editReason;
  const titleShown = popup.title || 'MDX block';
  const Renderer = popup.Renderer;
  const contentRead = Renderer ? (
    <Renderer
      data={{ source: popup.raw }}
      config={{
        className: 'doc-mdx-embed-content',
        isExpressionAllowed: false,
        sourcePath: popup.hostPath,
        textEmpty: 'An empty document',
        textError: 'The text of the block cannot be shown.',
      }}
    />
  ) : <pre className="doc-mdx-embed-content">{popup.raw}</pre>;

  const title = isEditShown ? (
    <EditValueInline
      key={`${popup.key}:${popup.title}`}
      className="doc-mdx-embed-title-field"
      value={popup.title}
      placeholder="MDX block (a title)"
      isLocked={store.titleStatus === 'saving'}
      aria-label="The title of the block"
      title="The title of the block: what its tile and this popup say. Enter or a click elsewhere writes it"
      onCommit={(value) => void store.titleSave(value)}
    />
  ) : titleShown;

  const headerRightContent = (
    <span className="doc-block-popup-head doc-code-lines-head not-prose">
      {store.titleStatus === 'error' ? <span className="doc-error doc-code-lines-message" role="alert" title={store.titleMessage}>{store.titleMessage}</span> : null}
      <button type="button" className="doc-button" title="Copy the text of the document (Markdown)" onClick={() => void store.copy()}>
        {store.isCopied ? <Check aria-hidden="true" size={12} strokeWidth={2.2} /> : <Copy aria-hidden="true" size={12} strokeWidth={2.2} />}
        <span>{store.isCopied ? 'Copied' : 'Copy'}</span>
      </button>
      <span className="doc-edit-segment" role="group" aria-label="Mode">
        <button type="button" className={isEditShown ? undefined : 'is-active'} aria-pressed={!isEditShown}
          title="View the document" onClick={() => void store.modeSet('view')}>
          <Eye aria-hidden="true" size={12} strokeWidth={2.2} />
          <span>View</span>
        </button>
        <button type="button" className={isEditShown ? 'is-active' : undefined} aria-pressed={isEditShown}
          disabled={editReason !== ''}
          title={editReason || (editStore?.isEditMode ? 'Edit the document and its title' : 'Edit the document and its title: the page goes into edit mode')}
          onClick={() => void store.modeSet('edit')}>
          <Pencil aria-hidden="true" size={12} strokeWidth={2.2} />
          <span>Edit</span>
        </button>
      </span>
    </span>
  );

  return (
    <PanelPopup
      panelId="docMdxEmbed"
      title={title}
      isOpen
      onClose={() => store.close()}
      headerRightContent={headerRightContent}
      // a popup of the edit layer: a click in it is not a click on the block it belongs to
      className={`doc-mdx-embed-popup ${EDIT_POPUP_CLASS}`}
      bodyClassName="doc-mdx-embed-popup-body"
    >
      <DocsBody className="doc-mdx-embed-popup-doc" data-doc-content="">
        <DocPopupBody path={store.path} isEditWanted={isEditShown}>{contentRead}</DocPopupBody>
      </DocsBody>
    </PanelPopup>
  );
});
