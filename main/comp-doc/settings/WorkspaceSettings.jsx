import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { toJS } from 'mobx';
import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useDocStores } from '../../frontend/src/store/context.js';
import { BlockPopupSurface } from '../popup/BlockPopupSurface.jsx';
import { WORKSPACE_NODE_ID } from '../../frontend/src/lib/doc-workspace-graph.js';
import { ArrowDown, ArrowUp, FolderInput, LoaderCircle, Lock, LockOpen, Plus, Trash2, Unplug } from '../../frontend/UICommon.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { OsPathInput } from '../source/OsPathInput.jsx';
import './DocSettings.css';

// The "Workspace" tab of the settings panel (design:
// doc_page_impl_source.md#the-workspace-tab): the workspace, its doc pages
// and the packages it imports as a graph drawn with React Flow.
//
//   [base]                      packages, in their own tone, above:
//      │ needs                  a package above every package needing it
//   [cloud-dev-vis]
//      │ imports
//   [workspace: Site · 2 doc pages · 1 package]
//        │ example            │ extra
//   [example  React Doc Test] [extra ...]
//        │ as sub  (red: the alias this include gives is not the one kept)
//   [sub  Sub Document]
//
//   warnings: the doc page ... is mentioned as "sub" ..., but is "extra" already
//   chosen: alias, folder, entry, roots, mentions
//
// a doc page is one node however often it is mentioned (the loader
// identified it by its entry file); every mention is an edge from the
// workspace (a root-level doc page) or from the doc page whose file holds
// the include, labeled with the alias the mention gives. an include whose
// alias differs from the doc page's alias (another mention came first) is
// a conflict: a red dashed edge, a badge on the node, a line in the
// warnings. the graph is DocWorkspaceStore.graph; clicking a node shows
// its details under the graph; nodes can be dragged. [doc pages] and
// [packages] toggle what is drawn: with one of them alone, it grows below
// the workspace. the canvas opens in the block popup like a block of a
// document (BlockPopupSurface with a popupKey). Rendered by ConfigPanel as
// a custom full-width item; it reads the stores itself.
//
// above the graph, the workspace file is edited (WorkspaceFileEdit) and
// temporary doc pages are mounted (WorkspaceMountEdit):
//
//   Workspace file  workspace.yaml                         [🔒 Locked]
//   #  alias     path                          side panel  unfold
//   1  example   [dir|file] ../example_doc     default      [x]     [↑][↓][🗑]
//   2  second    [dir|file] ../example_doc/... default      [x]     [↑][↓][🗑]
//   [+ Add doc page]
//
// "unfold" is the mount option isRootUnfolded, checked by default
// (plugin/doc-sidebar-effective.ts): the sole wrapper item of the doc page's
// side panel shows its children at the top, directly under the section
// heading (the root a marked row above them when it is bound to a document);
// unchecked, it is an ordinary folder row
//
//   Temporary doc pages   not written; gone when the server restarts
//   extra  ../extra                                          [Unmount]
//   [Folder|Entry file] [~/path/with/completion…] [alias]    [Mount]
export const WorkspaceSettings = observer(function WorkspaceSettings() {
  const { workspaceStore } = useDocStores();
  const { graph } = workspaceStore;
  return (
    <div className="doc-workspace-settings">
      <WorkspaceVirtualNote />
      <WorkspaceFileEdit />
      <WorkspaceMountEdit />
      <div className="doc-workspace-settings-line">
        <span>{graph.docPageCount} doc page{graph.docPageCount === 1 ? '' : 's'}</span>
        <span className="doc-workspace-settings-muted">·</span>
        <span>{graph.mentionCount} mention{graph.mentionCount === 1 ? '' : 's'}</span>
        <span className="doc-workspace-settings-muted">·</span>
        <span>{graph.packageCount} package{graph.packageCount === 1 ? '' : 's'}</span>
        {graph.warningList.length > 0 ? (
          <>
            <span className="doc-workspace-settings-muted">·</span>
            <span className="doc-workspace-settings-warning-count">{graph.warningList.length} alias warning{graph.warningList.length === 1 ? '' : 's'}</span>
          </>
        ) : null}
        <span className="doc-workspace-settings-spacer" />
        <span className="doc-workspace-edit-kind" role="group" aria-label="Shown in the graph">
          <button
            type="button"
            className="doc-button-dialog"
            aria-pressed={workspaceStore.isDocPageVisible}
            title="Show the doc pages of the workspace, below it"
            onClick={() => workspaceStore.docPageVisibleSet(!workspaceStore.isDocPageVisible)}
          >
            doc pages
          </button>
          <button
            type="button"
            className="doc-button-dialog"
            aria-pressed={workspaceStore.isPackageVisible}
            title="Show the packages the workspace imports and the packages they need, above it (below it when the doc pages are hidden)"
            onClick={() => workspaceStore.packageVisibleSet(!workspaceStore.isPackageVisible)}
          >
            packages
          </button>
        </span>
        <button type="button" className="doc-button" onClick={() => workspaceStore.layoutReset()}>Reset layout</button>
      </div>
      <BlockPopupSurface popupKey="settings-workspace-graph" title="Workspace graph" className="doc-workspace-settings-canvas-shell">
        {({ isInPopup }) => (
          <div className={`doc-workspace-settings-canvas${isInPopup ? ' is-popup' : ''}`}>
            <ReactFlowProvider>
              <WorkspaceCanvas isInPopup={isInPopup} />
            </ReactFlowProvider>
          </div>
        )}
      </BlockPopupSurface>
      {graph.warningList.length > 0 ? (
        <ul className="doc-workspace-settings-warning-list" role="alert">
          {graph.warningList.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
      <WorkspaceDetail />
    </div>
  );
});

// the view is fitted again when the nodes shown change and when the canvas
// moves between the panel and the popup
const WorkspaceCanvas = observer(function WorkspaceCanvas({ isInPopup = false }) {
  const { workspaceStore } = useDocStores();
  const { fitView } = useReactFlow();
  const nodeList = toJS(workspaceStore.graph.nodeList);
  const edgeList = toJS(workspaceStore.graph.edgeList);
  const nodeCount = nodeList.length;
  useEffect(() => {
    const frameId = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 200 }));
    return () => cancelAnimationFrame(frameId);
  }, [fitView, nodeCount, isInPopup]);
  return (
    <ReactFlow
      className="doc-workspace-flow"
      nodes={nodeList}
      edges={edgeList}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.3}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      multiSelectionKeyCode={null}
      onNodesChange={workspaceStore.nodeListChange}
      onPaneClick={() => workspaceStore.nodeSelectedIdSet('')}
    >
      <Background gap={18} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
});

// a virtual workspace says so first, with what it means: what started it, and
// what it cannot do (doc_page_impl_source.md#the-virtual-workspace)
const WorkspaceVirtualNote = observer(function WorkspaceVirtualNote() {
  const { workspaceStore } = useDocStores();
  const { workspace } = workspaceStore;
  if (!workspace?.isVirtual) return null;
  const { launch } = workspace;
  const kindLabel = launch?.kind === 'package' ? 'a package, as a read-only doc page' : 'one doc page';
  return (
    <div className="doc-workspace-virtual-note" role="note">
      <span className="doc-workspace-node-kind">virtual workspace</span>
      <span>
        {launch ? <>Started by <code>{launch.command}</code> for {kindLabel} ({launch.mode} mode). </> : 'config.yaml names one doc page (docEntry). '}
        There is no workspace file: no list of doc pages to edit, no workspace config and no workspace keyboard map. A doc page can still be mounted for as long as the server runs.
      </span>
    </div>
  );
});

const WorkspaceNode = observer(function WorkspaceNode({ data, selected }) {
  return (
    <div className={`doc-workspace-node is-workspace${selected ? ' is-selected' : ''}`}>
      <div className="doc-workspace-node-head">
        <span className="doc-workspace-node-kind">{data.isVirtual ? 'virtual workspace' : 'workspace'}</span>
        <span className="doc-workspace-node-title">{data.title || 'untitled'}</span>
      </div>
      <div className="doc-workspace-node-note">
        {data.isVirtual ? 'holds one doc page, no workspace file' : `${data.docPageCount} doc page${data.docPageCount === 1 ? '' : 's'}`}
        {data.packageCount > 0 ? ` · ${data.packageCount} package${data.packageCount === 1 ? '' : 's'}` : ''}
      </div>
      <Handle id="up" type="source" position={Position.Top} isConnectable={false} />
      <Handle id="down" type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});

// a package the workspace imports, or one a package needs; drawn above the
// workspace (side up: entered from below, leaving upward to the packages it
// needs), or below it when the doc pages are hidden (side down)
const PackageNode = observer(function PackageNode({ data, selected }) {
  const item = data.package;
  const isUp = data.side === 'up';
  return (
    <div className={`doc-workspace-node is-package${selected ? ' is-selected' : ''}`}>
      <Handle id={data.side} type="target" position={isUp ? Position.Bottom : Position.Top} isConnectable={false} />
      <div className="doc-workspace-node-head">
        <span className="doc-workspace-node-kind">package</span>
        <span className="doc-workspace-node-alias">{item.name}</span>
        {item.isWorkspaceNamed ? null : <span className="doc-badge-outline">needed</span>}
      </div>
      <div className="doc-workspace-node-title doc-workspace-node-clamp" title={item.description}>{item.description || <span className="doc-workspace-settings-muted">no description</span>}</div>
      <div className="doc-workspace-node-note" title={item.dir}>{item.dir}</div>
      <Handle id={data.side} type="source" position={isUp ? Position.Top : Position.Bottom} isConnectable={false} />
    </div>
  );
});

const DocPageNode = observer(function DocPageNode({ data, selected }) {
  const { docPage } = data;
  return (
    <div className={`doc-workspace-node is-doc-page${selected ? ' is-selected' : ''}${data.aliasConflictCount > 0 ? ' is-conflict' : ''}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="doc-workspace-node-head">
        <span className="doc-workspace-node-alias">{docPage.alias}</span>
        {data.isRoot ? <span className="doc-badge-outline" data-primary="">root</span> : null}
        {docPage.packageName ? <span className="doc-badge-outline" title="A package treated as a doc page: read-only">package</span> : null}
        {data.aliasConflictCount > 0 ? <span className="doc-badge-outline is-warning">alias conflict</span> : null}
      </div>
      <div className="doc-workspace-node-title">{docPage.title || <span className="doc-workspace-settings-muted">no title</span>}</div>
      <div className="doc-workspace-node-note" title={docPage.entryFile}>{docPage.dirPage}</div>
      <div className="doc-workspace-node-note">
        {docPage.rootList.length} root{docPage.rootList.length === 1 ? '' : 's'}
        {' · '}
        mentioned {data.mentionCount}×
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});

const nodeTypes = { workspace: WorkspaceNode, docPage: DocPageNode, package: PackageNode };

// what the chosen node is: the workspace, or a doc page with its roots and mentions
const WorkspaceDetail = observer(function WorkspaceDetail() {
  const { workspaceStore } = useDocStores();
  const docPage = workspaceStore.docPageSelected;
  const packageSelected = workspaceStore.packageSelected;
  if (packageSelected) {
    const item = packageSelected.package;
    return (
      <div className="doc-workspace-settings-detail">
        <div className="doc-workspace-settings-detail-title">
          <span className="doc-workspace-node-alias">{item.name}</span>
          <span className="doc-workspace-settings-muted">package</span>
        </div>
        <dl className="doc-workspace-settings-grid">
          <dt>description</dt><dd>{item.description || <span className="doc-workspace-settings-muted">none</span>}</dd>
          <dt>folder</dt><dd>{item.dir}</dd>
          <dt>imported</dt><dd>{item.isWorkspaceNamed ? 'by the workspace (packageList)' : 'not by the workspace: only as a package another one needs'}</dd>
          <dt>needs</dt><dd>{item.dependNameList.length ? item.dependNameList.join(', ') : <span className="doc-workspace-settings-muted">no package</span>}</dd>
          <dt>needed by</dt><dd>{packageSelected.neededByList.length ? packageSelected.neededByList.join(', ') : <span className="doc-workspace-settings-muted">no package</span>}</dd>
        </dl>
      </div>
    );
  }
  if (workspaceStore.isWorkspaceSelected) {
    const { workspace } = workspaceStore;
    return (
      <div className="doc-workspace-settings-detail">
        <div className="doc-workspace-settings-detail-title">{workspace?.isVirtual ? 'Virtual workspace' : 'Workspace'}</div>
        <p className="doc-workspace-settings-muted">
          {workspace?.isVirtual
            ? (workspace.launch
              ? `Started by "${workspace.launch.command}" (${workspace.launch.mode} mode) for ${workspace.launch.target}: the page serves it as a workspace holding it alone, without a workspace file.`
              : 'config.yaml names one doc page (docEntry); the page serves it as a workspace holding that doc page alone. A workspace file (config.yaml workspace.file) lists several root-level doc pages.')
            : 'The root-level doc pages are the ones the workspace file lists; every other doc page was reached through an include.'}
        </p>
      </div>
    );
  }
  if (!docPage) {
    return <p className="doc-workspace-settings-muted doc-workspace-settings-hint">Choose a node to see its roots and where it is mentioned.</p>;
  }
  return (
    <div className="doc-workspace-settings-detail">
      <div className="doc-workspace-settings-detail-title">
        <span className="doc-workspace-node-alias">{docPage.alias}</span>
        {docPage.title ? <span className="doc-workspace-settings-muted">{docPage.title}</span> : null}
        {docPage.isRoot ? <span className="doc-badge-outline" data-primary="">root</span> : null}
        {docPage.packageName ? <span className="doc-badge-outline">package</span> : null}
        {docPage.isReadOnly ? <span className="doc-badge-outline">read-only</span> : null}
      </div>
      <dl className="doc-workspace-settings-grid">
        {docPage.packageName ? <><dt>package</dt><dd>{docPage.packageName}: its documents, assets and side panels are read, never written from the page</dd></> : null}
        <dt>folder</dt><dd>{docPage.dirPage}</dd>
        <dt>entry</dt><dd>{docPage.entryFile}</dd>
        <dt>roots</dt>
        <dd>
          {docPage.rootList.map((root) => (
            <div key={`${root.alias}:${root.path}`}>
              <span className="doc-workspace-settings-path">~{docPage.alias}:{root.alias}</span>
              <span className="doc-workspace-settings-muted"> → {root.path}{root.kind === 'file' ? ' (a file)' : ''}</span>
            </div>
          ))}
        </dd>
        <dt>mentions</dt>
        <dd>
          {docPage.mentionList.map((mention, index) => (
            <div key={index} className={mention.alias !== docPage.alias ? 'is-conflict' : ''}>
              {mention.fromAlias === '' ? 'the workspace' : `doc page ${mention.fromAlias}`}
              {' as '}
              <span className="doc-workspace-settings-path">{mention.alias}</span>
              {mention.isAliasGiven ? '' : ' (folder name, no alias given)'}
              <span className="doc-workspace-settings-muted"> · {mention.file ? `${mention.file} ` : ''}{mention.place}</span>
              {mention.alias !== docPage.alias ? <span className="doc-badge-outline is-warning">ignored</span> : null}
            </div>
          ))}
        </dd>
      </dl>
    </div>
  );
});

// the doc pages of the workspace file, in their order, each field edited in
// place once the file is unlocked
const WorkspaceFileEdit = observer(function WorkspaceFileEdit() {
  const { workspaceStore } = useDocStores();
  const { workspace, request } = workspaceStore;
  const disabledReason = workspaceStore.fileEditDisabledReason;
  const isEditable = workspaceStore.isFileEditable;
  const itemList = workspace?.itemList ?? [];
  const [isAdding, isAddingSet] = useState(false);
  const isRequestOfFile = request.key.startsWith('file');
  const edit = (requestEdit, key) => workspaceStore.fileEdit(requestEdit, `file:${key}`);
  return (
    <section className="doc-workspace-edit" aria-label="The workspace file">
      <div className="doc-workspace-edit-head">
        <span className="doc-workspace-edit-title">Workspace file</span>
        <span className="doc-workspace-settings-muted doc-workspace-edit-file" title={workspace?.file || undefined}>
          {workspace?.file || (workspace?.isVirtual ? 'none: a virtual workspace' : 'written in config.yaml')}
        </span>
        <span className="doc-workspace-settings-spacer" />
        {isRequestOfFile ? <WorkspaceRequestState /> : null}
        {disabledReason === '' ? (
          <button
            type="button"
            className="doc-button"
            aria-pressed={!workspaceStore.isFileLocked}
            title={workspaceStore.isFileLocked ? 'Unlock the workspace file to edit it here' : 'Lock the workspace file again'}
            onClick={() => workspaceStore.fileLockedSet(!workspaceStore.isFileLocked)}
          >
            {workspaceStore.isFileLocked
              ? <Lock aria-hidden="true" size={12} strokeWidth={2} />
              : <LockOpen aria-hidden="true" size={12} strokeWidth={2} />}
            <span>{workspaceStore.isFileLocked ? 'Locked' : 'Unlocked'}</span>
          </button>
        ) : null}
      </div>
      {disabledReason ? <p className="doc-workspace-settings-muted doc-workspace-edit-note">{disabledReason}</p> : null}
      {itemList.length > 0 ? (
        <div className="doc-workspace-edit-table" role="table" aria-label="Doc pages of the workspace file">
          <div className="doc-workspace-edit-row is-head" role="row">
            <span role="columnheader">#</span>
            <span role="columnheader">alias</span>
            <span role="columnheader">folder or entry file</span>
            <span role="columnheader">side panel</span>
            <span role="columnheader" title="Whether the sole root item of the side panel is unfolded: its children shown at the top (isRootUnfolded, on by default)">unfold</span>
            <span role="columnheader" aria-label="actions" />
          </div>
          {itemList.map((item, index) => (
            <WorkspaceFileItem
              key={`${index}:${item.alias ?? ''}:${item.dir ?? item.file ?? ''}`}
              item={item}
              index={index}
              count={itemList.length}
              isEditable={isEditable}
              edit={edit}
            />
          ))}
        </div>
      ) : null}
      {disabledReason === '' ? (
        isAdding ? (
          <WorkspaceDocPageForm
            actionLabel="Add"
            isDisabled={!isEditable}
            onCancel={() => isAddingSet(false)}
            onSubmit={async ({ kind, path, alias }) => {
              const result = await edit({ action: 'itemAdd', item: { alias, [kind]: path } }, 'add');
              if (result.code === 0) isAddingSet(false);
            }}
          />
        ) : (
          <div className="doc-workspace-edit-foot">
            <button type="button" className="doc-button" disabled={!isEditable} onClick={() => isAddingSet(true)}>
              <Plus aria-hidden="true" size={12} strokeWidth={2} />
              <span>Add doc page</span>
            </button>
          </div>
        )
      ) : null}
    </section>
  );
});

const WorkspaceFileItem = observer(function WorkspaceFileItem({ item, index, count, isEditable, edit }) {
  const kind = item.file !== undefined && item.dir === undefined ? 'file' : 'dir';
  const pathText = item[kind] ?? '';
  const isRootUnfolded = item.isRootUnfolded !== false;
  const nameDocPage = item.alias || pathText || `doc page ${index + 1}`;
  return (
    <div className="doc-workspace-edit-row" role="row">
      <span className="doc-workspace-settings-muted" role="cell">{index + 1}</span>
      <span role="cell">
        <EditValueInline
          className="doc-workspace-edit-value"
          value={item.alias ?? ''}
          placeholder="folder name"
          isLocked={!isEditable}
          newlineAs=""
          onCommit={(text) => void edit({ action: 'itemFieldSet', index, field: 'alias', value: text }, `alias:${index}`)}
        />
      </span>
      <span role="cell" className="doc-workspace-edit-path">
        <WorkspacePathKind
          kind={kind}
          isDisabled={!isEditable}
          onChange={(kindNext) => void edit({ action: 'itemPathSet', index, kind: kindNext, value: pathText }, `path:${index}`)}
        />
        <OsPathInput
          value={pathText}
          spec={kind === 'file' ? { kind: 'file', extList: ['yaml', 'yml'] } : { kind: 'dir' }}
          placeholder={kind === 'file' ? './folder/.doc-page/entry.yaml' : './folder'}
          isDisabled={!isEditable}
          onCommit={(text) => void edit({ action: 'itemPathSet', index, kind, value: text }, `path:${index}`)}
        />
      </span>
      <span role="cell">
        <EditValueInline
          className="doc-workspace-edit-value"
          value={item.sidePanel ?? ''}
          placeholder="default"
          isLocked={!isEditable}
          newlineAs=""
          onCommit={(text) => void edit({ action: 'itemFieldSet', index, field: 'sidePanel', value: text }, `sidePanel:${index}`)}
        />
      </span>
      <span role="cell" className="doc-workspace-edit-check">
        <input
          type="checkbox"
          checked={isRootUnfolded}
          disabled={!isEditable}
          aria-label={`Unfold the sole root item of the side panel of ${nameDocPage}`}
          title={isRootUnfolded
            ? 'Unfolded (the default): the children of a sole root item are shown at the top, the root a marked row above them when it opens a document. Uncheck to draw the root as a folder (isRootUnfolded: false)'
            : 'Not unfolded: a sole root item is drawn as a folder holding the rest. Check to unfold it again (the default)'}
          onChange={(event) => void edit({ action: 'itemRootUnfoldedSet', index, isRootUnfolded: event.target.checked }, `rootUnfolded:${index}`)}
        />
      </span>
      <span role="cell" className="doc-workspace-edit-actions">
        <button
          type="button"
          className="doc-button-icon"
          title="Move up"
          aria-label="Move up"
          disabled={!isEditable || index === 0}
          onClick={() => void edit({ action: 'itemMove', index, indexTo: index - 1 }, `move:${index}`)}
        >
          <ArrowUp aria-hidden="true" size={12} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="doc-button-icon"
          title="Move down"
          aria-label="Move down"
          disabled={!isEditable || index === count - 1}
          onClick={() => void edit({ action: 'itemMove', index, indexTo: index + 1 }, `move:${index}`)}
        >
          <ArrowDown aria-hidden="true" size={12} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="doc-button-icon"
          title={count === 1 ? 'The workspace needs one doc page at least' : 'Remove from the workspace file'}
          aria-label="Remove from the workspace file"
          disabled={!isEditable || count === 1}
          onClick={() => void edit({ action: 'itemRemove', index }, `remove:${index}`)}
        >
          <Trash2 aria-hidden="true" size={12} strokeWidth={2} />
        </button>
      </span>
    </div>
  );
});

// a doc page is named by its folder or by its entry file
function WorkspacePathKind({ kind, isDisabled, onChange }) {
  return (
    <span className="doc-workspace-edit-kind" role="group" aria-label="named by">
      {[['dir', 'folder'], ['file', 'entry']].map(([kindOne, label]) => (
        <button
          key={kindOne}
          type="button"
          className="doc-button-dialog"
          aria-pressed={kind === kindOne}
          disabled={isDisabled}
          title={kindOne === 'dir' ? 'Named by its folder: the entry is found in .doc-page/' : 'Named by its entry file'}
          onClick={() => {
            if (kind !== kindOne) onChange(kindOne);
          }}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

// a doc page to add or mount: folder or entry file, the path with
// completion from the file system, an optional alias
function WorkspaceDocPageForm({ actionLabel, isDisabled = false, onSubmit, onCancel }) {
  const [kind, kindSet] = useState('dir');
  const [path, pathSet] = useState('');
  const [alias, aliasSet] = useState('');
  const isSubmittable = !isDisabled && path.trim() !== '';
  return (
    <div className="doc-workspace-edit-form">
      <WorkspacePathKind kind={kind} isDisabled={isDisabled} onChange={kindSet} />
      <OsPathInput
        className="doc-workspace-edit-form-path"
        value={path}
        spec={kind === 'file' ? { kind: 'file', extList: ['yaml', 'yml'] } : { kind: 'dir' }}
        placeholder={kind === 'file' ? '~/…/.doc-page/entry.yaml' : '~/path, /path or ./path'}
        isDisabled={isDisabled}
        onChange={pathSet}
        onCommit={pathSet}
      />
      <EditValueInline
        className="doc-workspace-edit-value doc-workspace-edit-form-alias"
        value={alias}
        placeholder="alias (folder name)"
        isLocked={isDisabled}
        newlineAs=""
        onInput={aliasSet}
        onCommit={aliasSet}
      />
      <button
        type="button"
        className="doc-button"
        data-primary=""
        disabled={!isSubmittable}
        onClick={() => void onSubmit({ kind, path: path.trim(), alias: alias.trim() })}
      >
        {actionLabel === 'Mount' ? <FolderInput aria-hidden="true" size={12} strokeWidth={2} /> : <Plus aria-hidden="true" size={12} strokeWidth={2} />}
        <span>{actionLabel}</span>
      </button>
      {onCancel ? <button type="button" className="doc-button" onClick={onCancel}>Cancel</button> : null}
    </div>
  );
}

// the doc pages mounted for as long as the development server runs
const WorkspaceMountEdit = observer(function WorkspaceMountEdit() {
  const { workspaceStore } = useDocStores();
  const { request } = workspaceStore;
  if (!workspaceStore.isMountAvailable) return null;
  const isRequestOfMount = request.key === 'mount' || request.key.startsWith('unmount:');
  return (
    <section className="doc-workspace-edit" aria-label="Temporary doc pages">
      <div className="doc-workspace-edit-head">
        <span className="doc-workspace-edit-title">Temporary doc pages</span>
        <span className="doc-workspace-settings-muted">mounted at the root, not written; gone when the server restarts</span>
        <span className="doc-workspace-settings-spacer" />
        {isRequestOfMount ? <WorkspaceRequestState /> : null}
      </div>
      {workspaceStore.docPageTemporaryList.map((docPage) => (
        <div key={docPage.alias} className="doc-workspace-edit-mount">
          <span className="doc-workspace-node-alias">{docPage.alias}</span>
          <span className="doc-workspace-settings-muted">{docPage.title}</span>
          <span className="doc-workspace-edit-mount-path" title={docPage.entryFile}>{docPage.dirPage}</span>
          <button
            type="button"
            className="doc-button"
            disabled={request.status === 'submitting'}
            onClick={() => void workspaceStore.unmount(docPage.alias)}
          >
            <Unplug aria-hidden="true" size={12} strokeWidth={2} />
            <span>Unmount</span>
          </button>
        </div>
      ))}
      <WorkspaceMountForm />
    </section>
  );
});

// the form is emptied after a mount: a new key starts it over
const WorkspaceMountForm = observer(function WorkspaceMountForm() {
  const { workspaceStore } = useDocStores();
  const [formKey, formKeySet] = useState(0);
  return (
    <WorkspaceDocPageForm
      key={formKey}
      actionLabel="Mount"
      isDisabled={workspaceStore.request.status === 'submitting'}
      onSubmit={async ({ kind, path, alias }) => {
        const result = await workspaceStore.mount({ kind, path, alias });
        if (result.code === 0) formKeySet((key) => key + 1);
      }}
    />
  );
});

// writing…, or the failure of the last request with dismiss
const WorkspaceRequestState = observer(function WorkspaceRequestState() {
  const { workspaceStore } = useDocStores();
  const { request } = workspaceStore;
  if (request.status === 'submitting') {
    return (
      <span className="doc-settings-note doc-settings-request" role="status">
        <LoaderCircle aria-hidden="true" size={11} strokeWidth={2} className="doc-spin" />
        <span>writing…</span>
      </span>
    );
  }
  if (request.status !== 'error') return null;
  return (
    <span className="doc-settings-note doc-settings-request is-error doc-workspace-edit-error" role="alert" title={request.message}>
      <span className="doc-settings-head-text">{request.message}</span>
      <button type="button" className="doc-settings-asset-link" onClick={() => workspaceStore.requestMessageClear()}>dismiss</button>
    </span>
  );
});
