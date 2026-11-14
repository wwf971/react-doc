import { makeAutoObservable, runInAction } from 'mobx';

// The state of the panel of one storage point of the type aws-utils.remote (AwsStoragePointPanel):
// what the storage service says of the account signed in, of the space of the point, and of the
// partitions that space holds beside those the objects of the page are bound to. One model per
// point; the panel draws it and asks it for every change (contract: doc/storage-contract.md).
export class AwsStoragePointModel {
  remoteStore;
  pointId;
  docPageAlias;
  status = 'idle';
  message = '';
  spaceList = [];
  partitionList = [];
  // the question open in a row: 'purge:{partitionId}', '' none
  confirm = '';
  action = { status: 'idle', message: '', isError: false };

  constructor({ remoteStore, pointId, docPageAlias }) {
    this.remoteStore = remoteStore;
    this.pointId = pointId;
    this.docPageAlias = docPageAlias;
    makeAutoObservable(this, { remoteStore: false, pointId: false, docPageAlias: false });
  }

  get point() {
    return this.remoteStore.pointGet(this.pointId, this.docPageAlias);
  }

  // the key of the space of the point: what its config says, else its id
  get spaceKey() {
    return String(this.point?.config?.space || this.pointId);
  }

  get space() {
    return this.spaceList.find((space) => space.key === this.spaceKey);
  }

  // the partitions the space holds that no object of this page reads: copies left behind, what
  // another checkout made, what was deleted and can still be restored
  get partitionUnboundList() {
    return this.partitionList.filter((partition) => !partition.isBound);
  }

  async load() {
    if (this.status === 'loading') return;
    this.status = 'loading';
    this.message = '';
    const [spaceResult, partitionResult] = await Promise.all([
      this.remoteStore.pointCall(this.pointId, 'spaceList', {}, this.docPageAlias),
      this.remoteStore.pointPartitionList(this.pointId, this.docPageAlias),
    ]);
    runInAction(() => {
      const failure = [spaceResult, partitionResult].find((result) => result.code !== 0);
      this.status = failure ? 'error' : 'done';
      this.message = failure ? failure.message : '';
      this.spaceList = spaceResult.code === 0 ? spaceResult.data?.spaceList ?? [] : [];
      this.partitionList = partitionResult.code === 0 ? partitionResult.data?.partitionList ?? [] : [];
    });
  }

  confirmSet(confirm) {
    this.confirm = confirm;
  }

  // a partition of the space removed for good, or brought back from its deletion mark
  async partitionAction(partitionId, action) {
    if (this.action.status === 'pending') return;
    this.confirm = '';
    this.action = { status: 'pending', message: '', isError: false };
    const result = action === 'purge'
      ? await this.remoteStore.pointPartitionPurge(this.pointId, partitionId, this.docPageAlias)
      : await this.remoteStore.pointPartitionRestore(this.pointId, partitionId, this.docPageAlias);
    runInAction(() => {
      this.action = { status: 'idle', message: result.code === 0 ? (action === 'purge' ? 'The partition was removed from the storage service.' : 'The partition was restored.') : result.message, isError: result.code !== 0 };
    });
    if (result.code === 0) await this.load();
  }
}

// one model per point of a remote store, shared by every rendering of the panel
const modelByStore = new WeakMap();

export function awsStoragePointModelGet(remoteStore, pointId, docPageAlias) {
  let modelByKey = modelByStore.get(remoteStore);
  if (!modelByKey) {
    modelByKey = new Map();
    modelByStore.set(remoteStore, modelByKey);
  }
  const key = `${docPageAlias}:${pointId}`;
  if (!modelByKey.has(key)) modelByKey.set(key, new AwsStoragePointModel({ remoteStore, pointId, docPageAlias }));
  return modelByKey.get(key);
}
