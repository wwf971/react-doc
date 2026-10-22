import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { toJS } from 'mobx';
import { EditActions } from '../../comp-doc/edit/EditActions.jsx';
import { EditFloatingPanel } from '../../comp-doc/edit/EditFloatingPanel.jsx';
import { EditValueInline } from '../../comp-doc/edit/EditValueInline.jsx';
import { ImageRender } from './Image.jsx';
import { imageDisplayModeList, imageEditFieldList, ImageEditStore } from './ImageEditStore.js';
import './ImageEdit.css';

// Edit mode of Image. The image stays in the flow, rendered from the draft by
// the same ImageRender the document body uses, so it does not move or resize
// when editing starts and follows every field change. The caption is edited
// where it is displayed, in the figcaption; the fields that are not visible
// on the page (src, alt, size, display mode) are in the floating panel below
// the image (doc_page_impl_edit.md#no-jitter-rule). Every change is reported
// to the edit layer as the new yaml, so leaving the block saves it; the layer
// rewrites the fenced block and reloads the document.
//
//   data                     the block as authored (raw yaml or fields)
//   config.edit.session      status / message of the pending change request
//
// events (handled by the edit layer):
//   editDraftChange { raw }
//   editSubmitRequest
//   editCancelRequest
export const ImageEdit = observer(function ImageEdit({ data = {}, config = {}, onEvent }) {
  const [store] = useState(() => new ImageEditStore(data));
  const session = config.edit?.session ?? {};
  const isLocked = session.status === 'submitting';
  const draft = toJS(store.draft);

  // a change of the draft: applied to the store, then reported as the yaml
  // the block would be saved as
  const draftChange = (change) => {
    change();
    void onEvent?.('editDraftChange', { raw: store.rawYaml });
  };
  const submitRequest = () => {
    if (isLocked) return;
    void onEvent?.('editSubmitRequest');
  };
  const cancelRequest = () => {
    if (isLocked) return;
    void onEvent?.('editCancelRequest');
  };

  const captionRender = (caption) => (
    <EditValueInline
      value={caption}
      placeholder="(caption)"
      isLocked={isLocked}
      onCommit={(value) => draftChange(() => store.fieldSet('caption', value))}
    />
  );

  // a pasted image (written as a file by the doc page source service layer, Image's paste
  // flow) becomes the src of the draft, like a value typed in the panel
  const sourcePaste = (sourcePath) => draftChange(() => store.fieldSet('src', sourcePath));

  return (
    <>
      <ImageRender data={draft} config={config} onEvent={onEvent} captionRender={captionRender} onSourcePaste={sourcePaste} />
      <EditFloatingPanel
        label="Image"
        placement="below"
        head={store.message ? <span className="doc-edit-message" role="alert">{store.message}</span> : null}
        actions={(
          <EditActions status={session.status} message={session.message} onSubmit={submitRequest} onCancel={cancelRequest} />
        )}
      >
        <div className="doc-image-edit-fields">
          {imageEditFieldList.map((name) => (
            <label key={name} className="doc-image-edit-field">
              <span className="doc-image-edit-field-name">{name}</span>
              <EditValueInline
                value={draft[name]}
                placeholder={name === 'src' ? 'path/to/image.png' : '(empty)'}
                isLocked={isLocked}
                onCommit={(value) => draftChange(() => store.fieldSet(name, value))}
              />
            </label>
          ))}
          <div className="doc-image-edit-field">
            <span className="doc-image-edit-field-name">displayMode</span>
            <span className="doc-edit-segment" role="group" aria-label="Display mode">
              {imageDisplayModeList.map((displayMode) => (
                <button
                  key={displayMode}
                  type="button"
                  className={store.displayMode === displayMode ? 'is-active' : ''}
                  aria-pressed={store.displayMode === displayMode}
                  disabled={isLocked}
                  onClick={() => draftChange(() => store.displayModeSet(displayMode))}
                >
                  {displayMode}
                </button>
              ))}
            </span>
          </div>
        </div>
      </EditFloatingPanel>
    </>
  );
});
