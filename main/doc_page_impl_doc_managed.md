<!-- Design of managed documents: documents the page keeps itself under virtual roots. Parent document: doc_page_impl_source.md -->

# Managed Documents: Design

Most documents of a doc page are files of its folder, and the folders they lie in are their paths. A **managed document** is kept by the page itself, in a **virtual root**: a folder of the doc page's metadata folder where its documents lie flat, each named by its id, and where the path a document has in the root is a field of its record, not a place on disk. Apart from where its bytes are, a managed document is a document like any other: it has a source path, is linked, placed in a side panel, searched, compiled, edited in place, undone, built. The feature exists for two reasons:

- **Documents as data of the page.** A document whose place is a record can be renamed or moved inside its root without touching the disk layout, kept as structure (its blocks and list items with ids) instead of text, and written in a binary form.
- **A page hosted on a cloud.** A deployment that keeps its documents in an object storage (s3) wants one object per document named by id, read in one request, small; the pack form of a root is that object, practiced on a local disk first ([Toward a cloud](#toward-a-cloud)).

```text
the source of a doc page                          on disk
~example/doc.md            a file of a folder      example_doc/doc.md
~example/guide/a.md                                example_doc/guide/a.md
~notes/guide/intro.md      a managed document      example_doc/.doc-page/doc-managed/{rootId}--notes/
~notes/guide/b.md          of the virtual root       {docId}--intro.doc.yaml + {docId}--intro.md
                           "notes"                   {docId}--b.doc.yaml + {docId}--b.block.yaml
~archive/2026/old.md       of the root "archive"   .../{rootId}--archive/{docId}--old.rdoc (pack form)
```

Making a document managed is a **move**, from a folder of files to a virtual root; leaving is the move back. Every move, of any file, goes through one mechanism of the backlink layer that rewrites what refers to the file ([Relocation](doc_page_impl_nav_backlink.md#relocation)).

## Concepts

```text
doc page
└── virtual root   "notes"     a root of the doc page's source, like a folder root, whose documents the
    │                          page keeps: a folder .doc-page/doc-managed/{rootId}--{alias}/ with root.yaml
    │                          alias      the root segment of the source paths of its documents (~notes/…)
    │                          name       what readers see (any language)
    │                          mode       the mode of its new documents: text | block
    │                          storage    the form it keeps its documents in: plain | pack
    │                          dirList    folders it keeps while no document is in them
    └── managed document       a record and a content, named {docId}--{name}
                               docId      ms_48, the identity; kept through renames and moves between roots
                               path       where it is in the root: folders and its file name (guide/intro.md)
                               mode       text | block, its own (a root's mode only seeds new documents)
                               times, hash   created, updated (with their zone), sha1 of its text
```

- **Mode** is what the root keeps of a document. `text`: its text as written. `block`: its root-level blocks and the items of its lists, each with an id ([The block mode](#the-block-mode)).
- **Form** (`storage`) is how the root writes it. `plain`: a record in yaml and the content beside it, what git diffs and a person reads; the default on a local disk. `pack`: one binary file per document ([The pack form](#the-pack-form)).
- Mode and form are independent: a block-mode document in the pack form is a binary file holding blocks. Whatever both are, **every reader of the page gets the document's text**; the mode and the form are the store's business.

## On disk

```text
.doc-page/doc-managed/                     the convention folder (doc-managed.yaml names others)
└── {rootId}--{alias}/                     one virtual root; the folder IS the root (copy = move)
    ├── root.yaml                          rootId, alias, name, mode, storage, dirList
    ├── {docId}--{name}.doc.yaml           plain: the record
    ├── {docId}--{name}.md | .mdx          plain, mode text: the text, as it is
    ├── {docId}--{name}.block.yaml         plain, mode block: the blocks
    ├── {docId}--{name}.rdoc               pack: the record and the content in one file
    └── .{file}.{uuid}.deleted             a document deleted, or moved out, kept as hidden backups
```

- **Id first, name after.** `{name}` is the ASCII part of the document's file name without its extension (`itemDirNameBuild`, as for asset items, [Folder names](doc_page_impl_dir.md#folder-names-of-assets)); the files follow it when the document is renamed. The id of a file is what stands before `--`.
- **Flat.** The folders of a root are not folders on disk: a document's path is in its record, so moving a document inside its root rewrites a record and nothing else. A folder holding no document is kept in `dirList` of `root.yaml`.
- **The folder is the root.** Nothing else names it; the loader finds every folder holding a `root.yaml` in the managed folders of the doc page, so copying one into another doc page moves the root with its documents.
- **No index file.** Listing a root reads one record per document (in the pack form, the record at the head of the file, without its body), as the asset store reads one `item.yaml` per item.
- A write leaves no `.bak` beside a document's files (its history is the edit history and git's); `root.yaml`, which the page rewrites in place, gets one, as every yaml file does. The `.gitignore` keeps `*.bak` and `*.tmp` of a root and the hidden backups out ([Local content kept out of git](doc_page_impl_dir.md#local-content-kept-out-of-git)).

```yaml
# root.yaml
rootId: w6jd09uchlh
alias: notes
name: Notes
mode: text
storage: plain
dirList: [drafts]          # optional
```

```yaml
# {docId}--intro.doc.yaml (plain form)
docId: w6jd09ug0i8
path: guide/intro.md
mode: text
timeCreated: 20261123_01370501+09
timeUpdated: 20261123_01370501+09
hash: 3b5f631412de581358d9c06b836693df977c9a18
```

### The block mode

A document of mode `block` is kept as its structure: the root-level blocks the edit layer reads (`editTextModelBuild`, [the block model](doc_page_impl_edit.md)), and in a list block the tree of its items as the item model reads it (`lib/doc-edit-list.js`, [the list model](doc_page_impl_edit_structure.md#the-list-model)). The text is built from the blocks whenever it is read, and a text written is read back into blocks (`lib/doc-managed-block.js`):

```yaml
# {docId}--blocks.block.yaml
format: md                       # md | mdx, from the extension of its path
frontmatter: |                   # the lines of the frontmatter with its fences, '' for none
  ---
  title: Blocks
  ---
blockList:
  - { blockId: 1vd045, kind: heading, gapBefore: 1, text: "# Blocks" }
  - blockId: am8yfn
    kind: list
    gapBefore: 1
    list:
      itemList:
        - { itemId: y5wi6w, marker: "-", text: first }
        - itemId: dh4ttw
          marker: "-"
          text: second
          itemList:
            - { itemId: k2p0aa, marker: "-", text: nested }
gapAfter: 1                      # the lines after the last block
```

- **Nothing is lost.** The blocks must write the text again exactly; a list whose items would not (a layout the item model reads differently) is kept as its text, and a text that cannot be read as blocks at all (invalid MDX, `\r` line endings) is kept whole as `{ raw }` until it can be. The gaps between blocks are counts of empty lines, or the lines themselves when one holds spaces.
- **Ids survive writes.** Every write is a text (the edit layer writes line operations, as for a file); reading it into blocks pairs the new blocks with the old ones: the longest run of unchanged blocks keeps their ids, and between two unchanged blocks a block of the same kind is the one edited in place and keeps its id. The items of a list block are paired the same way, by their own text. Ids are six characters of `0-9 a-z`, unique in one document.
- **What the ids are for.** Today, the structure is shown with its ids (the Managed documents tab) and survives every edit; a reference to a block by its id, and a sync of one block instead of a whole document, are what it is kept for ([TODO](doc_page_impl_TODO.md#doc-managed-block-ref)).

### The pack form

One file per document, `{docId}--{name}.rdoc` (`lib/doc-managed-pack.js`, free of node and of the DOM, its deflate handed in: zlib on the server, `CompressionStream` in a browser):

```text
offset  size  field
0       4     "RDOC"
4       1     format version (1)
5       1     flags: bit 0, the body is deflated (raw deflate)
6       2     0
8       4     R, the length of the record (uint32, little endian)
12      R     the record: the json of the fields of a plain record
12+R    4     B, the length of the body as stored
16+R    B     the body: the text (mode text) or the json of the blocks (mode block), deflated
```

The record is never deflated, so a listing reads it alone. A root's form is changed in the settings panel: every document is written in the other form (its blocks kept), and its former files removed only once the new ones are written. A document found in both forms (a change cut short) is read in the form of its root.

## In the source

A virtual root is a **root of the doc page's source**, like the folder of an `addFolder` rule ([source paths](doc_page_impl_source.md#source-paths)): its alias is the root segment of its documents' source paths, unique among the roots of its doc page (a rule naming a folder under the alias of a virtual root is an error). Nothing is written to declare it: when the entry of a doc page loads, every root of its managed folders becomes an implicit source rule placed **before** the rules of the entry, so the doc page's rules (tags, config, `removeByPath`) apply to managed documents as to files:

```yaml
# the rule the loader adds for a root (not written in any file)
- { action: addManaged, alias: notes, path: <its folder>, rootId: w6jd09uchlh, collect: recursive, docPageAlias: example }
```

| what | as a file | as a managed document |
| --- | --- | --- |
| source path | `~root/path` | the same: `~notes/guide/intro.md` |
| entry of the manifest | collected by a rule | listed from its root; `managed: { docId, rootAlias, mode, storage, timeUpdated }` on the page |
| folders (`dirManifest`) | the folders below the rule | the folders of its documents' paths and `dirList`, `isManaged: true`, no folder on disk |
| a page, searched, in a side panel | yes | yes: `sourceRoot: notes` mirrors the root, `doc: ~notes/a.md` binds one |
| collect mode | the rule's | `recursive`: every document is a page |
| what it can hold | any file | documents only (`.md`, `.mdx`) |

**Configuration.** The convention is the folder `.doc-page/doc-managed/`, made by its first root. `.doc-page/doc-managed.yaml` names other folders (`folderList`, relative to the file; the first is where a new root goes), `docManaged: { file }` of the entry names another config file, and `docManaged: false` says the doc page has no managed documents ([a convention with a config file over it](doc_page_impl_dir.md#layout)). A package treated as a doc page keeps its roots read-only, like the rest of it.

## Reading and writing

Everything of the development server and of a build that reads or writes the text of a document goes through **one door**, `plugin/doc-source-access.ts`: `sourceEntryTextRead(entry)`, `sourceEntryBytesRead(entry)`, `sourceEntryTextWrite(entry, text)`. A file is read on disk; an entry with `managed` through the store of its root (`plugin/doc-managed-store.ts`), whatever its mode and form. The readers are the source api (`GET /file`, `/data`), the manifest (title, hash, frontmatter config), the link index, the attachment and pruning scans, the edit api (`/source`, `/source/apply`, the history steps), and the build. A new reader of documents uses the door, never `fs.readFileSync(entry.absPath)`: for a managed document `absPath` is the file holding its content, which is a yaml file of blocks or a binary pack.

```text
GET  {source}/file?path=~notes/a.md     sourceEntryTextRead   -> the text (built from blocks, inflated)
POST {edit}/source/apply                line operations on that text -> sourceEntryTextWrite
                                          mode text   the text written (plain: the .md file; pack: the .rdoc)
                                          mode block  the text read into blocks, ids kept, then written
                                        the record's timeUpdated and hash follow; history recorded as for a file
POST {source}/file/create  { dirPath: ~notes/guide, name }   a new managed document, in the root's mode and form
side panel: a removed item with its document, a block deleted with its files
                                        the document's files moved into hidden backups, restored on a failure
```

- **Changes are told as data.** A file of a virtual root changed on disk (a write of the page, an editor, a git checkout, a root copied in) is reported to the page as the source data again (`doc-source-change`), the files of one write coalesced; a root never reloads the page. The managed folders are kept out of the source scan of every rule and of the watcher's reload, as the other managed folders are ([The folders a doc page keeps out by convention](doc_page_impl_source.md#the-folders-a-doc-page-keeps-out-by-convention)).
- **A build** has no store to ask: each managed document's text is a module of its own (`virtual:doc-managed-text/{source path}`), imported lazily like a document's `?raw`, so a built page, one html file included, reads managed documents offline.

## In the page

- **Glyphs.** A virtual root and its folders are drawn with a folder with a cog (`FolderCog`), a managed document with a file in a box (`FileBox`), in a tint of their own (`--doc-managed-color`, `frontend/src/css/badge.css`; the badge `.doc-badge[data-kind="managed"]`): in the side panel (the item mirroring a root, its generated folders and documents, and after the label of a written item showing a managed document), in every tree of the source (`SourceTreeSelect`: the root also says *virtual root*), in the move dialog and the settings tab.
- **Moving.** The side panel menu of an item showing a document has **Rename document…** and **Move document…**, which open the move dialog ([Relocation](doc_page_impl_nav_backlink.md#relocation)); choosing a virtual root as the folder makes the document managed, choosing a folder of files makes a managed one a file again.
- **The Managed documents tab** of the settings panel (`DocManagedSettings`, its state `DocManagedStore`): the doc pages and their roots; a new root (doc page, alias, name, mode, form); a root's name, the mode of its new documents and its form (a change converts every document); its documents with their mode (changeable one by one), form, size, update time, and three actions: open, move, and the blocks of a document of mode block with their ids; and **Make a document managed**: a document of a folder and a root, opening the move dialog with that root as the target.
- **Apis**: `source/move`, `source/movePlan`, `source/moveDialogOpen` (the palette: the current document), `source/managedRootList`, `source/managedRootCreate` (`comp-doc/api/api-source.js`).

The routes only managed documents have (`plugin/doc-managed-source.ts`; everything else is the ordinary source and edit api):

| Route of the source api | Answer |
| --- | --- |
| `GET /managed/list` | `{ docPageList: [{ docPageAlias, isEnabled, isReadOnly, folder, rootList: [{ rootPath, alias, name, mode, storage, dirList, folder, problemList, docList }] }], modeList, storageList }` |
| `GET /managed/doc/block?path=` | `{ mode, isStructured, rowList: [{ id, kind, depth, label }] }`: the blocks and items of a document of mode block |
| `POST /managed/root/create` `{ docPageAlias, alias, name?, mode?, storage? }` | `{ rootPath }`; `-2` an alias taken in the doc page, `-4` a read-only doc page |
| `POST /managed/root/set` `{ rootPath, name?, mode?, storage? }` | the root changed; a new `storage` writes every document in that form |
| `POST /managed/doc/mode/set` `{ path, mode }` | the document read into blocks, or kept as its text again |
| `POST /managed/dir/create` `{ dirPath }` | a folder of a root kept while empty (`dirList`) |

## Toward a cloud

The local store is the first implementation of a contract a cloud deployment will implement again: the roots of a doc page, the records of a root, the text of a document read and written, in two forms. What a cloud keeps is the pack form: an object `{rootId}/{docId}.rdoc` per document, its record readable from the first bytes (a ranged read lists a root), its body small. What is already in place for it:

- the pack format and the block model are modules of `src/lib`, with no node in them: a page reading a bucket decodes a document itself;
- every reader goes through one door (`doc-source-access.ts`), so a remote root is one more branch there and one more driver of the store, not a change of its readers;
- a document is named by its id and its path is data, so a bucket needs no folders, and a move inside a root rewrites one record;
- the edit layer writes texts with a base hash, which a remote store checks as a version (an `If-Match` of s3).

What is missing is listed in the TODO ([Managed documents on a cloud](doc_page_impl_TODO.md#doc-managed-cloud)).

## Implementation

| Place | Role |
| --- | --- |
| `plugin/doc-managed-store.ts` | the store: roots (`docManagedRootRead`, `docManagedRootCreate`, `docManagedRootSet`), documents (`docManagedDocListRead`, `docManagedTextRead`, `docManagedTextWrite`, `docManagedDocCreate`, `docManagedDocPathSet`, `docManagedDocMove`, `docManagedDocModeSet`, `docManagedDocStorageSet`), the folders of a doc page (`docManagedFolderListGet`) |
| `plugin/doc-managed-source.ts` | the roots as roots of the source (their documents and folders for `doc-source.ts`), the routes `/managed/*` |
| `plugin/doc-source-access.ts` | the one door to the text of a document: a file, or a managed document |
| `plugin/doc-entry.ts` | `docManaged` of the entry; the rule `addManaged` of every root, before the entry's rules; `kind: 'managed'` of a root of a doc page |
| `plugin/doc-source.ts` | `addManaged` in the scan, the folders, the roots, file creation in a root, the watcher of the roots, the build modules `virtual:doc-managed-text/` |
| `src/lib/doc-managed-block.js` | the block mode: a text read into blocks with ids kept, the text of blocks, an outline |
| `src/lib/doc-managed-pack.js` | the pack form: encode, decode, the record alone |
| `src/store/DocManagedStore.ts`, `comp-doc/settings/DocManagedSettings.jsx` | the Managed documents tab |
| `comp-doc/api/api-source.js` | the apis of moves and roots |
| `plugin/doc-managed-store.test.js`, `src/lib/doc-managed-block.test.js` | the store in both forms and modes; the block mode and the pack form |
| `example_doc/doc-managed.md`, `example_doc/.doc-page/doc-managed/` | the demonstration: the roots `notes` (plain, a document of each mode) and `archive` (pack) |
