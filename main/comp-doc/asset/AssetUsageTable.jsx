import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { docPlaceTextGet } from '../../frontend/src/lib/doc-place.js';
import { LoaderCircle, RotateCw } from '../../frontend/UICommon.js';
import './DocAsset.css';

// The uses of asset objects by blocks of the documents, one row per block
// (design: doc_page_impl_asset.md#usage): the component of the block, where
// it is (a link that goes there, and a read-again button for its document
// next to it), the version it reads (following the head, or pinned), and
// what is wrong with it. Shown by the asset panel (the backlinks of one
// object) and by the asset tab of the settings panel (the references that
// do not resolve); the host says which columns and notes it wants.
//
//   usageList           the uses shown (AssetUsage of DocAssetStore)
//   isObjectShown       a column with the object each use names
//   componentNameObject the component the object declares: a block of
//                       another component is noted
//   usageIsCurrent      (usage) => true for the block the host was opened from
//   docPathRefreshing   the document being read again ('' for every document)
//   onDocRefresh        (docPath) => reads one document again
//   onNavigate          (place) => goes to the block
export const AssetUsageTable = observer(function AssetUsageTable({
  usageList,
  isObjectShown = false,
  componentNameObject = '',
  usageIsCurrent,
  docPathRefreshing,
  onDocRefresh,
  onNavigate,
}) {
  const { assetStore } = useDocStores();
  return (
    <div className="doc-asset-table-scroll">
      <table className="doc-asset-table doc-asset-usage-table">
        <thead>
          <tr>
            <th>component</th>
            <th>place</th>
            {isObjectShown ? <th>object</th> : null}
            <th>reads</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {usageList.map((usage) => {
            const docPath = usage.place.docPath;
            const isRefreshing = docPathRefreshing === docPath || docPathRefreshing === '';
            const problem = assetStore.usageProblemGet(usage);
            const isOtherComponent = componentNameObject !== '' && usage.compName !== componentNameObject;
            return (
              <tr key={`${docPath}#${usage.place.sourceLine}`}>
                <td className="doc-asset-mono">{usage.compName || usage.componentId}</td>
                <td className="doc-asset-usage-place">
                  <button
                    type="button"
                    className="doc-asset-link is-inline"
                    title={`line ${usage.place.sourceLine} of ${docPath}${usage.place.fragment ? `, anchor #${usage.place.fragment}` : ''}`}
                    onClick={() => onNavigate(usage.place)}
                  >
                    {docPlaceTextGet(usage.place)}
                  </button>
                  <button
                    type="button"
                    className="doc-asset-icon-button"
                    disabled={isRefreshing}
                    title={`reads ${docPath} again`}
                    aria-label={`read ${docPath} again`}
                    onClick={() => onDocRefresh(docPath)}
                  >
                    {isRefreshing
                      ? <LoaderCircle size={11} className="doc-spin" aria-hidden="true" />
                      : <RotateCw size={11} aria-hidden="true" />}
                  </button>
                </td>
                {isObjectShown ? (
                  <td className="doc-asset-mono doc-asset-muted">{usage.reference.objectId || usage.reference.name || ''}</td>
                ) : null}
                <td>
                  {usage.reference.versionId === 'head'
                    ? <span className="doc-badge-outline" data-primary="" title="follows the head">head</span>
                    : <span className="doc-asset-mono" title="pinned to this version">{usage.reference.versionId}</span>}
                </td>
                <td>
                  <span className="doc-asset-usage-notes">
                    {usageIsCurrent?.(usage) ? <span className="doc-badge-outline">this block</span> : null}
                    {isOtherComponent ? <span className="doc-asset-muted">the object is for {componentNameObject}</span> : null}
                    {problem ? <span className="doc-asset-usage-problem" title={problem}>{problem}</span> : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
