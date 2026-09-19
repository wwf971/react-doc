import { makeAutoObservable } from 'mobx';

// ui state of doc-embedded components, keyed by component instance id,
// so component state stays data-driven instead of hiding in local useState.
export class CompStateStore {
  stateById: Record<string, any> = {};

  constructor() {
    makeAutoObservable(this);
  }

  getState(id: string, stateInitial: any): any {
    if (!(id in this.stateById)) this.stateById[id] = stateInitial;
    return this.stateById[id];
  }

  patchState(id: string, patch: Record<string, any>) {
    this.stateById[id] = { ...this.stateById[id], ...patch };
  }
}
