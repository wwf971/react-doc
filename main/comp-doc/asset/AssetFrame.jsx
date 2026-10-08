import { observer } from 'mobx-react-lite';
import { LoaderCircle } from '../../frontend/UICommon.js';
import './DocAsset.css';

// The place of a component whose data comes from the asset store while that
// data is not there: a short loading line until the version is read, or the
// error of a reference that cannot be resolved, with the reference text. Once
// the data is read, the component renders alone, exactly as it would with
// the data written inline; which asset it reads, and the asset panel, are
// reached from the block's toolbar in edit mode (DocEditBlockToolbar).
//
//   label      the component name
//   reference  { objectId, versionId } as written in the document
//   raw        the reference yaml, shown with an error
//   message    an error of the reference (not shown while loading)
//   children   the component, when the reference is resolved
export const AssetFrame = observer(function AssetFrame({ label, reference, raw, message, children }) {
  if (message) {
    return (
      <div className="doc-asset-frame not-prose" data-error="">
        <div className="doc-asset-frame-title">
          <span className="doc-asset-frame-label">{label}</span>
          <span className="doc-asset-frame-object">{reference.objectId || '(no objectId)'}</span>
        </div>
        <p className="doc-asset-frame-message">{message}</p>
        {raw ? <pre className="doc-asset-frame-raw">{raw}</pre> : null}
      </div>
    );
  }
  if (children === undefined) {
    return (
      <div className="doc-asset-frame not-prose" data-loading="">
        <div className="doc-asset-frame-title">
          <span className="doc-asset-frame-label">{label}</span>
          <span className="doc-asset-frame-object" title={reference.objectId}>{reference.objectId}</span>
          <LoaderCircle size={12} className="doc-edit-spin" aria-label="loading" />
        </div>
      </div>
    );
  }
  return children;
});
