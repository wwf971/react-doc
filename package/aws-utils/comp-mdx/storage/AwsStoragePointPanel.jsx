import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { awsStoragePointModelGet } from './AwsStoragePointModel.js';
import '../auth/AwsAuth.css';

// What is its own of a storage point of the type aws-utils.remote, in the Asset service tab of
// the settings panel (react-doc: main/doc_page_impl_asset_storage.md#what-a-type-adds-to-the-tab):
// the account at the storage service, the space of the point with what it holds, and the
// partitions of that space no object of the page is bound to, each restored or removed for good.
// What every remote point has (the session, the cache, the partitions bound) is drawn by the tab.
//
//   data.pointId, data.docPageAlias   the storage point
export const AwsStoragePointPanel = observer(function AwsStoragePointPanel({ data = {} }) {
  const { assetRemoteStore, authStore } = useDocStores();
  const pointId = String(data.pointId ?? '');
  const docPageAlias = String(data.docPageAlias ?? '');
  const point = assetRemoteStore?.pointGet(pointId, docPageAlias);
  const model = assetRemoteStore && point ? awsStoragePointModelGet(assetRemoteStore, pointId, docPageAlias) : undefined;
  const reason = assetRemoteStore && point ? assetRemoteStore.pointUnavailableReasonGet(point) : { code: -1, message: 'the page has no storage point of this id' };
  const subject = authStore?.sessionGet(assetRemoteStore?.providerRefOfPointGet(point) ?? '')?.identity?.subject ?? '';
  const isAskable = reason.code === 0;
  useEffect(() => {
    if (model && isAskable) void model.load();
  }, [model, isAskable, subject]);

  if (!model) return null;
  const pointState = assetRemoteStore.pointStateGet(pointId);
  const { service, account } = pointState;
  const providerConfig = authStore?.providerGet(assetRemoteStore.providerRefOfPointGet(point))?.config ?? {};
  // a service trusting another user pool than the one the provider signs in to never accepts the session
  const isPoolOther = Boolean(service?.auth?.userPoolId) && Boolean(providerConfig.userPoolId) && service.auth.userPoolId !== providerConfig.userPoolId;
  const space = model.space;
  const isPending = model.action.status === 'pending';
  return (
    <div className="aws-auth aws-storage-panel">
      <div className="aws-auth-section-title">AWS storage service</div>
      {isPoolOther ? (
        <div className="aws-auth-message" data-error>
          The service trusts the user pool {service.auth.userPoolId}, and the auth provider of this point signs in to {providerConfig.userPoolId}: its session is not accepted there.
        </div>
      ) : null}
      {!isAskable ? <div className="aws-auth-note">{reason.message}</div> : null}
      {isAskable ? (
        <>
          <div className="aws-auth-fact-list">
            <Fact label="Account" value={account ? `${account.name || '—'} · user id ${account.userId}` : pointState.status === 'checking' ? 'asking' : '—'} />
            <Fact label="Groups" value={account ? (account.groupList ?? []).join(', ') || 'none' : '—'} />
            <Fact label="Space of this point" value={space ? `${space.key}${space.label && space.label !== space.key ? ` (${space.label})` : ''} · ${space.partitionCount} partition(s), ${space.itemCount} item(s), ${sizeTextGet(space.size)}` : model.status === 'loading' ? 'reading' : `${model.spaceKey} · not made yet: the first write of this point makes it`} title="Everything this point reads and writes lies in its space; no other point reaches it" />
            <Fact label="Spaces of the account" value={model.spaceList.length > 0 ? model.spaceList.map((one) => one.key).join(', ') : model.status === 'loading' ? 'reading' : 'none yet'} title="One per storage point that wrote something as this account" />
            <Fact label="Limits" value={service?.limit ? `one version ${sizeTextGet(service.limit.dataSizeMax)}, one space ${sizeTextGet(service.limit.spaceSizeMax)}, ${service.limit.spaceCountMax} spaces per account` : '—'} />
            <Fact label="In use" value={account?.usage ? `${account.usage.spaceCount} space(s), ${sizeTextGet(account.usage.size)}` : '—'} />
          </div>
          <div className="aws-auth-message" {...(model.status === 'error' ? { 'data-error': true } : {})}>{model.status === 'error' ? model.message : ''}</div>
          <div className="aws-auth-button-row">
            <button type="button" className="doc-button" disabled={model.status === 'loading'} onClick={() => void model.load()}>Read again</button>
          </div>

          <div className="aws-auth-section">
            <div className="aws-auth-section-title">Partitions of the space no object of this page reads <span className="aws-auth-count">{model.partitionUnboundList.length}</span></div>
            {model.partitionUnboundList.length === 0 ? (
              <div className="aws-auth-note">None. A partition stays here when it was moved away keeping a copy, deleted, or made by another checkout; an object claims its own in the Frontend objects tab (Create or claim).</div>
            ) : (
              <div className="aws-auth-table-scroll">
                <table className="aws-auth-table">
                  <thead><tr><th>Object</th><th>Partition</th><th>State</th><th>Items</th><th>Size</th><th /></tr></thead>
                  <tbody>
                    {model.partitionUnboundList.map((partition) => (
                      <tr key={partition.partitionId}>
                        <td title={`${partition.ownerRef} · ${partition.ownerTypeId}`}>{partition.objectName || partition.ownerRef}</td>
                        <td>{partition.partition}</td>
                        <td>
                          <span className="doc-badge-outline" {...(partition.isDeleted ? { 'data-error': true } : {})}>
                            {partition.isDeleted ? 'deleted' : partition.isObjectOfPage ? 'not bound' : 'of an object not on this page'}
                          </span>
                        </td>
                        <td>{partition.itemCount}</td>
                        <td>{sizeTextGet(partition.size)}</td>
                        <td className="aws-auth-cell-action">
                          {model.confirm === `purge:${partition.partitionId}` ? (
                            <>
                              <button type="button" className="doc-button" data-danger disabled={isPending} onClick={() => void model.partitionAction(partition.partitionId, 'purge')}>Remove {partition.itemCount} item(s) for good</button>
                              <button type="button" className="doc-button" onClick={() => model.confirmSet('')}>Cancel</button>
                            </>
                          ) : (
                            <>
                              {partition.isDeleted ? <button type="button" className="doc-button" disabled={isPending} title="take the deletion mark off: an object can claim it again" onClick={() => void model.partitionAction(partition.partitionId, 'restore')}>Restore</button> : null}
                              <button type="button" className="doc-button" data-danger disabled={isPending} title="its rows and bytes leave the storage service" onClick={() => model.confirmSet(`purge:${partition.partitionId}`)}>Remove…</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="aws-auth-message" {...(model.action.isError ? { 'data-error': true } : {})}>{isPending ? 'Working…' : model.action.message}</div>
          </div>
        </>
      ) : null}
    </div>
  );
});

function Fact({ label, value, title = '' }) {
  return (
    <div className="aws-auth-fact" title={title || undefined}>
      <span className="aws-auth-fact-label">{label}</span>
      <span className="aws-auth-fact-value">{value}</span>
    </div>
  );
}

function sizeTextGet(size) {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
