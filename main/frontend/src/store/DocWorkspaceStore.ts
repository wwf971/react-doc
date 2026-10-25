import { makeAutoObservable, runInAction } from 'mobx';
import { applyNodeChanges } from '@xyflow/react';
import type { DocSourceStore } from './DocSourceStore.js';
import { workspaceGraphBuild, WORKSPACE_NODE_ID } from '../lib/doc-workspace-graph.js';
import { docEditApiCreate } from '../lib/doc-edit-api.js';

// the state of the last request of the tab (a change of the workspace file,
// a mount): key names what it is for, so its row shows it; what failed
// stays until dismissed
export type WorkspaceRequest = { status: 'idle' | 'submitting' | 'error'; message: string; key: string };

// The workspace as the page shows it (design: doc_page_impl_source.md#the-workspace-tab):
// the graph of the Workspace tab of the settings panel, derived from
// configDoc.workspace of the source service layer, and the state of that
// tab: the node chosen (its details are shown under the graph) and where
// the nodes were dragged to. a new configuration (an include added) builds
// the graph again; a node keeps the place it was dragged to while it exists.
//
// the tab also edits the workspace file (doc_page_impl_source.md#editing-the-workspace-file):
// every change is one request of the edit api (workspace/edit), built on the
// version of the file the page shows (workspace.fileHash); the new workspace
// comes back as data. the file is locked whenever the page opens
// (isFileLocked), a state of the page only. temporary doc pages are mounted
// and unmounted through the source api (workspace/mount, workspace/unmount).
export class DocWorkspaceStore {
  sourceStore: DocSourceStore;
  nodeSelectedId = '';
  // node id -> position, for nodes the person moved
  positionByNodeId: Record<string, { x: number; y: number }> = {};

  // the workspace file is edited only once unlocked; never stored
  isFileLocked = true;
  request: WorkspaceRequest = { status: 'idle', message: '', key: '' };

  constructor(options: { sourceStore: DocSourceStore }) {
    this.sourceStore = options.sourceStore;
    makeAutoObservable(this, { sourceStore: false });
  }

  // ---------- the workspace file ----------

  // why the workspace file cannot be edited here; '' when it can
  get fileEditDisabledReason(): string {
    const { envStore } = this.sourceStore;
    if (!envStore.isCapable('edit')) return envStore.reasonGet('edit');
    if (!this.workspace?.file) {
      return this.workspace?.isVirtual
        ? 'config.yaml names one doc page (docEntry); a workspace file (workspace.file) is edited here'
        : 'the workspace is written in config.yaml; a workspace file of its own (workspace.file) is edited here';
    }
    return '';
  }

  get isFileEditable(): boolean {
    return this.fileEditDisabledReason === '' && !this.isFileLocked;
  }

  fileLockedSet(isLocked: boolean): void {
    this.isFileLocked = isLocked;
  }

  requestMessageClear(): void {
    if (this.request.status === 'error') this.request = { status: 'idle', message: '', key: '' };
  }

  // one change of the workspace file (plugin/doc-workspace-edit.ts)
  async fileEdit(request: Record<string, any>, key = ''): Promise<{ code: number; message: string }> {
    const endpoint = this.sourceStore.envStore.endpointGet('edit');
    if (!endpoint || !this.isFileEditable) return { code: -1, message: this.fileEditDisabledReason || 'the workspace file is locked' };
    this.request = { status: 'submitting', message: '', key };
    const result = await docEditApiCreate(endpoint).workspaceEdit(request, this.workspace?.fileHash);
    runInAction(() => {
      this.request = result.code === 0 ? { status: 'idle', message: '', key: '' } : { status: 'error', message: result.message, key };
    });
    return result;
  }

  // ---------- temporary doc pages ----------

  get docPageTemporaryList(): any[] {
    return (this.workspace?.docPageList ?? []).filter((docPage: any) => docPage.isTemporary);
  }

  get isMountAvailable(): boolean {
    return Boolean(this.sourceStore.sourceEndpoint);
  }

  // { kind: 'dir' | 'file', path, alias?, sidePanel? }
  mount(body: Record<string, any>): Promise<{ code: number; message: string; data?: any }> {
    return this.sourceApiPost('/workspace/mount', body, 'mount');
  }

  unmount(alias: string): Promise<{ code: number; message: string; data?: any }> {
    return this.sourceApiPost('/workspace/unmount', { alias }, `unmount:${alias}`);
  }

  private async sourceApiPost(route: string, body: Record<string, any>, key: string): Promise<{ code: number; message: string; data?: any }> {
    const endpoint = this.sourceStore.sourceEndpoint;
    if (!endpoint) return { code: -1, message: 'only the development server mounts doc pages' };
    this.request = { status: 'submitting', message: '', key };
    let result: { code: number; message: string; data?: any };
    try {
      const response = await fetch(`${endpoint}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => undefined);
      result = payload && typeof payload.code === 'number' ? payload : { code: -1, message: `the source api answered ${response.status}` };
    } catch (error: any) {
      result = { code: -1, message: `the source api is not reachable: ${String(error?.message ?? error)}` };
    }
    runInAction(() => {
      this.request = result.code === 0 ? { status: 'idle', message: '', key: '' } : { status: 'error', message: result.message, key };
    });
    return result;
  }

  get workspace(): any {
    return this.sourceStore.configDoc?.workspace;
  }

  get graph() {
    const graph = workspaceGraphBuild(this.workspace);
    const nodeList = graph.nodeList.map((node: any) => ({
      ...node,
      position: this.positionByNodeId[node.id] ?? node.position,
      selected: node.id === this.nodeSelectedId,
    }));
    return { ...graph, nodeList };
  }

  // the doc page chosen, or undefined for the workspace node / none
  get docPageSelected(): any {
    const node = this.graph.nodeList.find((item: any) => item.id === this.nodeSelectedId);
    return node?.type === 'docPage' ? node.data.docPage : undefined;
  }

  get isWorkspaceSelected(): boolean {
    return this.nodeSelectedId === WORKSPACE_NODE_ID;
  }

  nodeSelectedIdSet(nodeId: string): void {
    this.nodeSelectedId = nodeId;
  }

  // React Flow reports a drag (and the selection) as node changes
  nodeListChange = (changeList: any[]): void => {
    const nodeListNext = applyNodeChanges(changeList, this.graph.nodeList as any[]);
    for (const change of changeList) {
      if (change.type === 'position' && change.position) this.positionByNodeId[change.id] = { ...change.position };
      if (change.type === 'select') {
        if (change.selected) this.nodeSelectedId = change.id;
        else if (this.nodeSelectedId === change.id) this.nodeSelectedId = '';
      }
    }
    void nodeListNext;
  };

  // the nodes back to the computed layout
  layoutReset(): void {
    this.positionByNodeId = {};
  }
}
