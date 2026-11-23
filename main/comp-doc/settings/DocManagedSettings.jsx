import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ExternalLink, FileBox, FolderCog, FolderOutput, ListTree, LoaderCircle } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { SourcePathPicker } from '../source/SourcePathPicker.jsx';
import { timeTextDisplay } from '../../frontend/src/lib/time-text.js';
import '../asset/DocAsset.css';
import './DocSettings.css';

// The "Managed documents" tab of the settings panel (design:
// doc_page_impl_doc_managed.md#in-the-page): the virtual roots of the doc pages, the
// documents the page keeps in them, and what only they have.
//
//   New virtual root   doc page [demo]  alias [notes]  name [Notes]  mode [text|block]  form [plain|pack]  [Create]
//   Virtual roots (2)  one row per root: ~page:alias, name, mode, form, documents, folder
//     the chosen one (a click on its row; again to close):
//       name edited in place; the mode of its new documents; the form it keeps them in
//       (a change writes every document of the root in the other form)
//       its documents: path, mode [text|block], form, size, updated, [Open] [Move…] [Blocks]
//       the blocks of one of mode block, with their ids
//   Make a document managed   document [~page:root/a.md]  into [notes]  [Move…]
//                             the move dialog, its references followed (doc_page_impl_nav_backlink.md#relocation)
//
// rendered by ConfigPanel as a custom full-width item; every state it shows is
// DocManagedStore's. the list is read again when the source changes.
export const DocManagedSettings = observer(function DocManagedSettings() {
  const { managedStore: store, sourceStore, docStore } = useDocStores();
  const manifestKey = sourceStore.manifestKey;
  useEffect(() => {
    void store?.listLoad();
  }, [store, manifestKey]);
  if (!store) return null;
  if (store.unavailableReason) return <div className="doc-settings-tab not-prose"><p className="doc-note">{store.unavailableReason}</p></div>;
  if (store.list.status !== 'done' && !store.list.data) {
    return (
      <div className="doc-settings-tab not-prose">
        {store.list.status === 'error' ? <p className="doc-error" role="alert">{store.list.message}</p> : <p className="doc-note">Reading the virtual roots…</p>}
      </div>
    );
  }
  const { modeList, storageList } = store.list.data;
  const isCreating = store.write.key === 'create' && store.write.status === 'submitting';
  const rootList = store.rootList;
  return (
    <div className="doc-settings-tab not-prose">
      <p className="doc-note">
        Documents the page keeps itself, gathered under virtual roots. A virtual root is one folder of .doc-page/doc-managed/;
        its documents lie flat in it, named by id, whatever path they have in the root. They are read, linked, placed in a
        side panel and edited as files are, under their source paths (~root/path). Mode text keeps a document as its text;
        mode block keeps its blocks and list items, each with an id. Form plain is the one git reads; form pack puts each
        document in one binary file, the form a deployment on a cloud keeps. A document moves into a root, out of it or
        inside it by Move document…, which rewrites what refers to it.
      </p>

      <h3>New virtual root</h3>
      {store.docPageCreateList.length === 0 ? <p className="doc-note">No doc page of this page can hold managed documents (read-only, or docManaged: false).</p> : (
        <div className="doc-settings-tab-form">
          <span className="doc-settings-tab-label">doc page</span>
          <span className="doc-button-group" role="group" aria-label="Doc page">
            {store.docPageCreateList.map((docPage) => (
              <button key={docPage.docPageAlias} type="button" aria-pressed={docPage.docPageAlias === store.createDocPageAlias} title={docPage.folder} onClick={() => store.createSet({ docPageAlias: docPage.docPageAlias })}>
                {docPage.docPageAlias}
              </button>
            ))}
          </span>
          <span className="doc-settings-tab-label">alias</span>
          <span className="doc-settings-tab-row">
            <EditValueInline value={store.create.alias} placeholder="(one word: the root of its paths, ~alias/…)" isLocked={isCreating} onCommit={(value) => store.createSet({ alias: value })} />
          </span>
          <span className="doc-settings-tab-label">name</span>
          <span className="doc-settings-tab-row">
            <EditValueInline value={store.create.name} placeholder="(what readers see; the alias when empty)" isLocked={isCreating} onCommit={(value) => store.createSet({ name: value })} />
          </span>
          <span className="doc-settings-tab-label">mode</span>
          <ChoiceGroup label="Mode" valueList={modeList} value={store.create.mode} isDisabled={isCreating} onChoose={(mode) => store.createSet({ mode })} />
          <span className="doc-settings-tab-label">form</span>
          <span className="doc-settings-tab-row">
            <ChoiceGroup label="Form" valueList={storageList} value={store.create.storage} isDisabled={isCreating} onChoose={(storage) => store.createSet({ storage })} />
            <button type="button" className="doc-button" data-primary="" disabled={isCreating} onClick={() => void store.rootCreate()}>
              {isCreating ? <LoaderCircle size={12} className="doc-spin" aria-hidden="true" /> : null}
              <span>Create</span>
            </button>
          </span>
        </div>
      )}
      {store.write.key === 'create' && store.write.status === 'error' ? <p className="doc-error" role="alert">{store.write.message}</p> : null}

      <h3>Virtual roots ({rootList.length})</h3>
      {rootList.length === 0 ? <p className="doc-note">No doc page has a virtual root yet; the first one makes .doc-page/doc-managed/.</p> : (
        <div className="doc-asset-table-scroll">
          <table className="doc-asset-table">
            <thead>
              <tr><th>root</th><th>name</th><th>mode</th><th>form</th><th className="doc-asset-version-size">documents</th><th>folder</th></tr>
            </thead>
            <tbody>
              {rootList.map((root) => (
                <tr key={root.rootPath} className="doc-asset-version" data-selected={store.rootPathSelected === root.rootPath ? '' : undefined} onClick={() => store.rootSelect(root.rootPath)}>
                  <td>
                    <span className="doc-managed-settings-root">
                      <FolderCog aria-hidden="true" size={12} strokeWidth={1.8} className="doc-managed-settings-glyph" />
                      {root.rootPath}
                    </span>
                  </td>
                  <td>{root.name || <span className="doc-asset-muted">({root.alias})</span>}</td>
                  <td>{root.mode}</td>
                  <td>{root.storage}</td>
                  <td className="doc-asset-muted doc-asset-version-size">{root.docList.length}</td>
                  <td className="doc-asset-muted" title={root.folder}>{root.folder.split('/').at(-1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {store.rootSelected ? <DocManagedRootDetail root={store.rootSelected} modeList={modeList} storageList={storageList} onOpen={(path) => docStore.navigate(path)} /> : null}

      <h3>Make a document managed</h3>
      {rootList.length === 0 ? <p className="doc-note">Make a virtual root first.</p> : (
        <div className="doc-settings-tab-form">
          <span className="doc-settings-tab-label">document</span>
          <span className="doc-settings-tab-row doc-managed-settings-picker">
            <SourcePathPicker
              value={store.manage.path}
              spec={{ kind: 'file', extList: ['md', 'mdx'], isMatch: (candidate) => !candidate.entry?.managed }}
              placeholder="~page:root/a.md"
              isTreeCollapsible
              onSelect={(path) => store.manageSet({ path })}
            />
          </span>
          <span className="doc-settings-tab-label">into</span>
          <span className="doc-settings-tab-row">
            <span className="doc-button-group" role="group" aria-label="Virtual root">
              {rootList.filter((root) => !root.isReadOnly).map((root) => (
                <button key={root.rootPath} type="button" aria-pressed={store.manage.rootPath === root.rootPath} onClick={() => store.manageSet({ rootPath: root.rootPath })}>
                  {root.alias}
                </button>
              ))}
            </span>
            <button
              type="button"
              className="doc-button"
              data-primary=""
              disabled={!store.manage.path || !store.manage.rootPath}
              title="Choose the folder in the root and see what changes before anything is written"
              onClick={(event) => store.docManageOpen({ clientX: event.clientX, clientY: event.clientY })}
            >
              Move…
            </button>
          </span>
        </div>
      )}
    </div>
  );
});

// the root chosen: its name, mode and form, and its documents
const DocManagedRootDetail = observer(function DocManagedRootDetail({ root, modeList, storageList, onOpen }) {
  const { managedStore: store } = useDocStores();
  const keyRoot = `root:${root.rootPath}`;
  const isRootWriting = store.write.key === keyRoot && store.write.status === 'submitting';
  const isLocked = root.isReadOnly || isRootWriting;
  return (
    <div className="doc-settings-tab-detail">
      <h4>{root.rootPath}</h4>
      <div className="doc-settings-tab-form">
        <span className="doc-settings-tab-label">name</span>
        <span className="doc-settings-tab-row">
          <EditValueInline value={root.name} placeholder={`(${root.alias})`} isLocked={isLocked} onCommit={(value) => { if (value !== root.name) void store.rootSet(root.rootPath, { name: value }); }} />
        </span>
        <span className="doc-settings-tab-label">new documents</span>
        <ChoiceGroup label="Mode of new documents" valueList={modeList} value={root.mode} isDisabled={isLocked} onChoose={(mode) => void store.rootSet(root.rootPath, { mode })} />
        <span className="doc-settings-tab-label">form</span>
        <span className="doc-settings-tab-row">
          <ChoiceGroup label="Form" valueList={storageList} value={root.storage} isDisabled={isLocked} onChoose={(storage) => void store.rootSet(root.rootPath, { storage })} />
          {isRootWriting ? <LoaderCircle size={12} className="doc-spin" aria-hidden="true" /> : null}
          <span className="doc-asset-muted">{root.storage === 'pack' ? 'one binary file per document' : 'a record and a text (or its blocks) per document, as git reads them'}</span>
        </span>
      </div>
      {store.write.key === keyRoot && store.write.status === 'error' ? <p className="doc-error" role="alert">{store.write.message}</p> : null}
      {root.problemList.length > 0 ? <ul className="doc-settings-tab-list">{root.problemList.map((problem) => <li key={problem} className="doc-settings-tab-issue">{problem}</li>)}</ul> : null}
      {root.docList.length === 0 ? <p className="doc-note">No document yet: New document in a side panel item mirroring the root, or Make a document managed below.</p> : (
        <div className="doc-asset-table-scroll">
          <table className="doc-asset-table">
            <thead>
              <tr><th>document</th><th>mode</th><th>form</th><th className="doc-asset-version-size">size</th><th>updated</th><th /></tr>
            </thead>
            <tbody>
              {root.docList.map((doc) => {
                const keyDoc = `doc:${doc.path}`;
                const isDocWriting = store.write.key === keyDoc && store.write.status === 'submitting';
                return [
                  <tr key={doc.path} className="doc-asset-version" data-selected={store.outline.path === doc.path ? '' : undefined}>
                    <td>
                      <span className="doc-managed-settings-root" title={`id ${doc.docId}\n${doc.fileList.join('\n')}`}>
                        <FileBox aria-hidden="true" size={12} strokeWidth={1.8} className="doc-managed-settings-glyph" />
                        {doc.path.slice(root.rootPath.length + 1)}
                      </span>
                    </td>
                    <td><ChoiceGroup label="Mode" valueList={modeList} value={doc.mode} isDisabled={root.isReadOnly || isDocWriting} onChoose={(mode) => void store.docModeSet(doc.path, mode)} /></td>
                    <td className="doc-asset-muted">{doc.storage}</td>
                    <td className="doc-asset-muted doc-asset-version-size">{sizeText(doc.size)}</td>
                    <td className="doc-asset-muted" title={doc.timeUpdated ? timeTextDisplay(doc.timeUpdated) : ''}>{doc.timeUpdated ? timeTextDisplay(doc.timeUpdated, { isYearShown: false }) : ''}</td>
                    <td>
                      <span className="doc-managed-settings-action">
                        <button type="button" className="doc-button-icon" title="Open the document" aria-label="Open the document" onClick={() => onOpen(doc.path)}>
                          <ExternalLink aria-hidden="true" size={13} strokeWidth={1.8} />
                        </button>
                        <button type="button" className="doc-button-icon" title="Move or rename it; what refers to it follows" aria-label="Move the document" disabled={root.isReadOnly} onClick={(event) => store.docMoveOpen(doc.path, { clientX: event.clientX, clientY: event.clientY })}>
                          <FolderOutput aria-hidden="true" size={13} strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          className="doc-button-icon"
                          aria-label="Its blocks"
                          aria-pressed={store.outline.path === doc.path}
                          disabled={doc.mode !== 'block'}
                          title={doc.mode === 'block' ? 'Its blocks and list items, with their ids' : 'A document of mode text is kept as its text'}
                          onClick={() => void store.outlineLoad(doc.path)}
                        >
                          <ListTree aria-hidden="true" size={13} strokeWidth={1.8} />
                        </button>
                      </span>
                    </td>
                  </tr>,
                  store.write.key === keyDoc && store.write.status === 'error'
                    ? <tr key={`${doc.path}:error`}><td colSpan={6} className="doc-error">{store.write.message}</td></tr>
                    : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {root.docList.some((doc) => doc.path === store.outline.path) ? (
        <>
          <h4>Blocks of {store.outline.path.slice(root.rootPath.length + 1)}</h4>
          <DocManagedOutline />
        </>
      ) : null}
    </div>
  );
});

// the blocks of a document of mode block, as it keeps them
const DocManagedOutline = observer(function DocManagedOutline() {
  const { managedStore: store } = useDocStores();
  const { outline } = store;
  if (outline.status === 'loading') return <p className="doc-status"><LoaderCircle size={12} className="doc-spin" aria-hidden="true" /> Reading its blocks…</p>;
  if (outline.status === 'error') return <p className="doc-error">{outline.message}</p>;
  if (!outline.isStructured) return <p className="doc-note">Its text could not be read as blocks (invalid MDX, or \r line endings): it is kept as its text until it can be.</p>;
  return (
    <ul className="doc-managed-settings-outline">
      {outline.rowList.map((row) => (
        <li key={row.id} style={{ paddingInlineStart: `${row.depth * 14}px` }}>
          <span className="doc-badge">{row.kind}</span>
          <span className="doc-asset-muted">{row.id}</span>
          <span className="doc-managed-settings-outline-label">{row.label}</span>
        </li>
      ))}
    </ul>
  );
});

function ChoiceGroup({ label, valueList, value, isDisabled, onChoose }) {
  return (
    <span className="doc-button-group" role="group" aria-label={label}>
      {valueList.map((one) => (
        <button key={one} type="button" aria-pressed={one === value} disabled={isDisabled} onClick={(event) => { event.stopPropagation(); if (one !== value) onChoose(one); }}>
          {one}
        </button>
      ))}
    </span>
  );
}

function sizeText(size) {
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} kB`;
}
