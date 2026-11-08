import { makeAutoObservable, observable } from 'mobx';

// Find in a part of the page (design: doc_page_impl_api.md#finding-in-a-part-of-the-page).
// A component that can search what it draws itself (a diagram canvas) registers a find scope
// for its area, and says when the area is the active one: the pointer is over it, or the focus
// is in it. The page apis find/open and find/close act on the active scope, and the context
// names findScopeActive and findOpen let a keyboard map bind keys to them only then, so the
// key of the browser's own find stays the browser's everywhere else.
//
//   scope  { id, label?, open(), close(), isOpenGet() }   the component's search, its own
export type FindScope = {
  id: string;
  label?: string;
  open: () => void;
  close: () => void;
  isOpenGet: () => boolean;
};

export class DocFindStore {
  scopeById = observable.map<string, FindScope>({}, { deep: false });
  // the scopes the pointer is over or the focus is in, the most recent last
  activeIdList: string[] = [];

  constructor() {
    makeAutoObservable(this, { scopeById: false });
  }

  // registered while the component is mounted; the function returned takes it away
  scopeRegister(scope: FindScope): () => void {
    this.scopeById.set(scope.id, scope);
    return () => {
      if (this.scopeById.get(scope.id) === scope) this.scopeById.delete(scope.id);
      this.scopeActiveSet(scope.id, false);
    };
  }

  scopeActiveSet(id: string, isActive: boolean) {
    const rest = this.activeIdList.filter((item) => item !== id);
    this.activeIdList = isActive ? [...rest, id] : rest;
  }

  get scopeActive(): FindScope | undefined {
    for (let index = this.activeIdList.length - 1; index >= 0; index -= 1) {
      const scope = this.scopeById.get(this.activeIdList[index]);
      if (scope) return scope;
    }
    return undefined;
  }

  get isScopeActive(): boolean {
    return Boolean(this.scopeActive);
  }

  // the find of the active scope is open
  get isOpen(): boolean {
    return this.scopeActive?.isOpenGet() === true;
  }

  open(): boolean {
    const scope = this.scopeActive;
    if (!scope) return false;
    scope.open();
    return true;
  }

  close(): boolean {
    const scope = this.scopeActive;
    if (!scope || !scope.isOpenGet()) return false;
    scope.close();
    return true;
  }
}
