import { observer } from 'mobx-react-lite';
import { Lock } from '../../frontend/UICommon.js';
import './DocAsset.css';

// A list of asset objects, one row each (design: doc_page_impl_asset.md):
// name, id, the component it declares, its versions, when it was created
// and what happened to it last. A click on a row selects the object, a
// click on the selected row unselects it; the host shows the selected one
// (the asset tab of the settings panel shows its asset panel below).
//
//   objectList        the objects shown (AssetObject of DocAssetStore)
//   objectIdSelected  the selected object ('' when none)
//   onSelect          (objectId) => the row was clicked
export const AssetObjectTable = observer(function AssetObjectTable({ objectList, objectIdSelected, onSelect }) {
  return (
    <div className="doc-asset-table-scroll">
      <table className="doc-asset-table doc-asset-object-table">
        <thead>
          <tr>
            <th>name</th>
            <th>object</th>
            <th>component</th>
            <th className="doc-asset-version-size">versions</th>
            <th className="doc-asset-version-lock" aria-label="locked" />
            <th>created</th>
            <th>last event</th>
          </tr>
        </thead>
        <tbody>
          {objectList.map((object) => {
            const eventLast = object.eventList[object.eventList.length - 1];
            return (
              <tr
                key={object.objectId}
                className="doc-asset-version"
                data-selected={object.objectId === objectIdSelected ? '' : undefined}
                onClick={() => onSelect(object.objectId)}
              >
                <td>{object.name || <span className="doc-asset-muted">(no name)</span>}</td>
                <td className="doc-asset-mono doc-asset-muted">{object.objectId}</td>
                <td className="doc-asset-mono">{object.component?.name ?? ''}</td>
                <td className="doc-asset-mono doc-asset-muted doc-asset-version-size">{object.versionList.length}</td>
                <td className="doc-asset-version-lock" title={object.isLocked ? 'locked' : undefined}>
                  {object.isLocked ? <Lock size={11} aria-label="locked" /> : null}
                </td>
                <td className="doc-asset-mono doc-asset-muted">{object.timeCreated}</td>
                <td className="doc-asset-mono doc-asset-muted">{eventLast ? `${eventLast.eventType} ${eventLast.time}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
