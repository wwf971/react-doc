import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { assetSaveModeGet } from '../../frontend/src/store/DocAssetStore.js';
import { DocsBody, LoaderCircle } from '../../frontend/UICommon.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { sizeTextGet } from './AssetPanel.jsx';
import './DocAsset.css';

// The preview pane of an asset panel (design: doc_page_impl_asset.md):
// what the block the panel was opened from renders with the data as it is
// in the panel now. While the head text is edited that is the draft, on
// every keystroke, so the pane shows what a save would render as; otherwise
// it is the selected version. The block (component name, marker props,
// document) comes with the panel from the toolbar; the component is
// rendered through the same runtime boundary as in the document, with the
// data in place of the reference, so it sees what it would see there. A
// panel not opened from a block has no renderer: an image is shown as an
// image, anything else is only described.
//
//   panel   the AssetPanelModel shown
export const AssetPreview = observer(function AssetPreview({ panel }) {
  const object = panel?.object;
  if (!panel || !object) return null;
  const preview = panel.previewData;
  const block = panel.block;

  let subject;
  if (preview.isDraft) subject = 'the draft, as a save would render it now';
  else if (preview.versionId) subject = <>version <span className="doc-asset-mono">{preview.versionId}</span></>;
  else subject = 'no version selected';

  return (
    <aside className="doc-asset-preview" aria-label="Preview">
      <p className="doc-asset-section-title">
        preview
        <span className="doc-asset-muted"> — {block ? <>{block.compName} with </> : null}{subject}</span>
      </p>
      <div className="doc-asset-preview-body">
        <PreviewBody object={object} panel={panel} preview={preview} block={block} />
      </div>
    </aside>
  );
});

const PreviewBody = observer(function PreviewBody({ object, panel, preview, block }) {
  const { assetStore } = useDocStores();
  if (!preview.versionId) return <p className="doc-asset-muted">Select a version, or edit the head, to see what it renders as.</p>;
  const version = preview.version;
  if (!version || version.status === 'loading') {
    return <p className="doc-asset-panel-status"><LoaderCircle size={12} className="doc-spin" aria-hidden="true" /> loading</p>;
  }
  if (version.status === 'error') return <p className="doc-error doc-edit-message">{version.message}</p>;
  if (!version.isText) {
    const url = assetStore.dataUrlGet(panel.store, object.objectId, preview.versionId);
    if (object.contentType.startsWith('image/')) {
      return <img className="doc-asset-binary-preview" src={url} alt={object.name || object.objectId} />;
    }
    return (
      <p className="doc-asset-muted">
        The data is not text ({object.contentType}, {sizeTextGet(version.size)}); a component block reads text, so it has no rendering.
      </p>
    );
  }
  if (!block) {
    return <p className="doc-asset-muted">The panel was not opened from a component block, so nothing says how this text is rendered.</p>;
  }
  // the data comes from the asset, as in the document: a component declared
  // isAssetOnly renders only so, and one declared isAssetAware learns which
  // version (and its metadata) it shows
  const assetInfo = {
    isFromAsset: true,
    store: panel.store,
    objectId: object.objectId,
    name: object.name,
    versionIdRef: panel.versionIdRef || 'head',
    versionId: preview.versionId,
    versionIdHead: object.versionIdHead,
    isHead: preview.versionId === object.versionIdHead,
    hash: version.hash ?? '',
    saveMode: assetSaveModeGet(object),
    isLocked: object.isLocked,
    versionMetadata: version.metadata ?? {},
  };
  return (
    <DocsBody>
      <RegisteredComp
        compName={block.compName}
        configRuntime={{ instanceId: `asset-preview:${object.objectId}`, sourcePath: block.sourcePath, assetInfo }}
        input={{ lang: object.lang, raw: preview.text, propsAuthored: block.propsAuthored }}
        placement="commentBlock"
      />
    </DocsBody>
  );
});
