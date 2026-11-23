import { makeAutoObservable, runInAction } from 'mobx';
import type { DocSourceStore, SourceResult } from './DocSourceStore.js';
import type { DocRelocateStore } from './DocRelocateStore.js';

// Managed documents as the page shows them (design: doc_page_impl_doc_managed.md#in-the-page):
// the virtual roots of the doc pages and their documents, read from the development server
// (GET {source}/managed/list), and what only they have: a root made, the mode of its new
// documents and the form it keeps them in changed, the mode of one document changed, the
// blocks of a document of mode block. A document goes into a root, out of it, or elsewhere in
// it by a move (DocRelocateStore): its references follow, as for any file.
//
//   list        { status, data: { docPageList, modeList, storageList }, message }
//   create      the form of a new root: doc page, alias, name, mode, storage
//   write       the request being written, by key (create | root:{path} | doc:{path}), and its failure
//   rootPathSelected   the root unfolded in the tab
//   outline     the blocks of one document of mode block: { path, status, rowList, isStructured, message }
//   manage      the document chosen to be made managed, and the root it goes to

type ListState = { status: 'idle' | 'loading' | 'done' | 'error'; data: any; message: string };

export class DocManagedStore {
  sourceStore: DocSourceStore;
  relocateStore: DocRelocateStore;
  list: ListState = { status: 'idle', data: undefined, message: '' };
  create = { docPageAlias: '', alias: '', name: '', mode: 'text', storage: 'plain' };
  write = { key: '', status: 'idle' as 'idle' | 'submitting' | 'error', message: '' };
  rootPathSelected = '';
  outline = { path: '', status: 'idle' as 'idle' | 'loading' | 'done' | 'error', rowList: [] as any[], isStructured: false, message: '' };
  manage = { path: '', rootPath: '' };
  private listSeq = 0;

  constructor({ sourceStore, relocateStore }: { sourceStore: DocSourceStore; relocateStore: DocRelocateStore }) {
    this.sourceStore = sourceStore;
    this.relocateStore = relocateStore;
    makeAutoObservable(this, { sourceStore: false, relocateStore: false }, { autoBind: true });
  }

  // why the roots cannot be read here ('' when they can)
  get unavailableReason(): string {
    if (!this.sourceStore.isWritable) return 'Managed documents are listed and changed through the development server. A built page reads them like files.';
    return '';
  }

  get docPageList(): any[] {
    return this.list.data?.docPageList ?? [];
  }

  get rootList(): any[] {
    return this.docPageList.flatMap((docPage) => docPage.rootList.map((root: any) => ({ ...root, docPageAlias: docPage.docPageAlias, isReadOnly: docPage.isReadOnly })));
  }

  get rootSelected(): any {
    return this.rootList.find((root) => root.rootPath === this.rootPathSelected);
  }

  // the doc pages a root can be made in, the one of the form first
  get docPageCreateList(): any[] {
    return this.docPageList.filter((docPage) => docPage.isEnabled && !docPage.isReadOnly);
  }

  get createDocPageAlias(): string {
    const list = this.docPageCreateList;
    return list.some((docPage) => docPage.docPageAlias === this.create.docPageAlias) ? this.create.docPageAlias : list[0]?.docPageAlias ?? '';
  }

  async listLoad(): Promise<void> {
    if (this.unavailableReason) return;
    const seq = ++this.listSeq;
    if (this.list.status !== 'done') this.list = { ...this.list, status: 'loading' };
    const result = await this.sourceStore.sourceApiCall('/managed/list', { method: 'GET' });
    runInAction(() => {
      if (seq !== this.listSeq) return;
      this.list = result.code === 0 ? { status: 'done', data: result.data, message: '' } : { status: 'error', data: this.list.data, message: result.message };
    });
  }

  createSet(change: Partial<DocManagedStore['create']>) {
    Object.assign(this.create, change);
    if (this.write.key === 'create') this.write = { key: '', status: 'idle', message: '' };
  }

  rootSelect(rootPath: string) {
    this.rootPathSelected = this.rootPathSelected === rootPath ? '' : rootPath;
    this.outline = { path: '', status: 'idle', rowList: [], isStructured: false, message: '' };
  }

  manageSet(change: Partial<DocManagedStore['manage']>) {
    Object.assign(this.manage, change);
  }

  async rootCreate(): Promise<SourceResult> {
    const alias = this.create.alias.trim();
    if (!alias) return this.writeFail('create', 'A virtual root needs an alias: the root segment of its paths (~alias/...).');
    return this.writeRun('create', '/managed/root/create', {
      docPageAlias: this.createDocPageAlias, alias, name: this.create.name.trim(), mode: this.create.mode, storage: this.create.storage,
    }, (data) => {
      this.create = { ...this.create, alias: '', name: '' };
      this.rootPathSelected = data?.rootPath ?? '';
    });
  }

  rootSet(rootPath: string, change: { name?: string; mode?: string; storage?: string }): Promise<SourceResult> {
    return this.writeRun(`root:${rootPath}`, '/managed/root/set', { rootPath, ...change });
  }

  docModeSet(path: string, mode: string): Promise<SourceResult> {
    return this.writeRun(`doc:${path}`, '/managed/doc/mode/set', { path, mode }, () => {
      if (this.outline.path === path) void this.outlineLoad(path);
    });
  }

  // a document of the source made managed: the move dialog, the root as its target
  docManageOpen(point?: { clientX: number; clientY: number }) {
    if (!this.manage.path || !this.manage.rootPath) return;
    this.relocateStore.dialogOpen({ from: this.manage.path, mode: 'move', dirPath: this.manage.rootPath, point });
  }

  docMoveOpen(path: string, point?: { clientX: number; clientY: number }) {
    this.relocateStore.dialogOpen({ from: path, mode: 'move', point });
  }

  async outlineLoad(path: string): Promise<void> {
    if (this.outline.path === path && this.outline.status === 'done') {
      this.outline = { path: '', status: 'idle', rowList: [], isStructured: false, message: '' };
      return;
    }
    this.outline = { path, status: 'loading', rowList: [], isStructured: false, message: '' };
    const result = await this.sourceStore.sourceApiCall(`/managed/doc/block?path=${encodeURIComponent(path)}`, { method: 'GET' });
    runInAction(() => {
      if (this.outline.path !== path) return;
      this.outline = result.code === 0
        ? { path, status: 'done', rowList: result.data.rowList, isStructured: result.data.isStructured, message: '' }
        : { path, status: 'error', rowList: [], isStructured: false, message: result.message };
    });
  }

  private writeFail(key: string, message: string): SourceResult {
    this.write = { key, status: 'error', message };
    return { code: -1, message };
  }

  private async writeRun(key: string, route: string, body: any, onDone?: (data: any) => void): Promise<SourceResult> {
    if (this.unavailableReason) return this.writeFail(key, this.unavailableReason);
    this.write = { key, status: 'submitting', message: '' };
    const result = await this.sourceStore.sourceApiCall(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    runInAction(() => {
      this.write = result.code === 0 ? { key: '', status: 'idle', message: '' } : { key, status: 'error', message: result.message };
      if (result.code === 0) onDone?.(result.data);
    });
    await this.listLoad();
    return result;
  }
}
