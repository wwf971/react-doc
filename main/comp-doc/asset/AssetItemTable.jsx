import { observer } from 'mobx-react-lite';
import { Lock } from '../../frontend/UICommon.js';
import './DocAsset.css';

// A list of asset items, one row each (design: doc_page_impl_asset.md):
// name, id, the component it declares, its versions, when it was created
// and what happened to it last. A click on a row selects the item, a
// click on the selected row unselects it; the host shows the selected one
// (the asset tab of the settings panel shows its asset panel below).
//
//   itemList        the items shown (AssetItem of DocAssetStore)
//   itemIdSelected  the selected item ('' when none)
//   onSelect          (itemId) => the row was clicked
export const AssetItemTable = observer(function AssetItemTable({ itemList, itemIdSelected, onSelect }) {
  return (
    <div className="doc-asset-table-scroll">
      <table className="doc-asset-table doc-asset-item-table">
        <thead>
          <tr>
            <th>name</th>
            <th>item</th>
            <th>component</th>
            <th className="doc-asset-version-size">versions</th>
            <th className="doc-asset-version-lock" aria-label="locked" />
            <th>created</th>
            <th>last event</th>
          </tr>
        </thead>
        <tbody>
          {itemList.map((item) => {
            const eventLast = item.eventList[item.eventList.length - 1];
            return (
              <tr
                key={item.itemId}
                className="doc-asset-version"
                data-selected={item.itemId === itemIdSelected ? '' : undefined}
                onClick={() => onSelect(item.itemId)}
              >
                <td>{item.name || <span className="doc-asset-muted">(no name)</span>}</td>
                <td className="doc-asset-mono doc-asset-muted">{item.itemId}</td>
                <td className="doc-asset-mono">{item.component?.name ?? ''}</td>
                <td className="doc-asset-mono doc-asset-muted doc-asset-version-size">{item.versionList.length}</td>
                <td className="doc-asset-version-lock" title={item.isLocked ? 'locked' : undefined}>
                  {item.isLocked ? <Lock size={11} aria-label="locked" /> : null}
                </td>
                <td className="doc-asset-mono doc-asset-muted">{item.timeCreated}</td>
                <td className="doc-asset-mono doc-asset-muted">{eventLast ? `${eventLast.eventType} ${eventLast.time}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
