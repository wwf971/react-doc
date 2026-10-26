<!-- Design of the block-level operations of a document: inserting, deleting, moving, duplicating, copying and pasting whole blocks. Parent document: doc_page_impl.md. Writes go through the edit layer: doc_page_impl_edit.md. -->

# Block-level Operations: Design

In edit mode a document is a list of root-level **blocks**: a heading, a paragraph, a list, a comment-marked component with its fenced block ([Block model](doc_page_impl_edit.md#block-model)). Besides changing what is inside a block, the author changes the list itself: blocks are inserted, deleted, moved, duplicated, copied or moved to another place, and pasted. This document is about these block-level operations: what they act on, where the author finds them, and how each is written. Every one of them is a write of the edit layer, hash-checked against the text it was chosen in and recorded in the edit history like any other change of a document ([In-place editing](doc_page_impl_edit.md)).

Operations work on whole blocks: blocks are inserted together between two blocks of a document (or at its start or end). Putting blocks into the middle of a block, or as items of an existing list, is not supported yet; the place model is already a tree so that it can grow there ([Choosing where the blocks go](#choosing-where-the-blocks-go)). The one way into a block is a paste into the component being edited, which hands the text to the component instead of writing it ([below](#pasting-into-the-component-being-edited)).

## The operations

| Operation | Acts on | Offered in | Written by |
| --- | --- | --- | --- |
| Insert a new block | a border | edit mode: the toolbar's insert buttons and the insert menu ([edit](doc_page_impl_edit.md#floating-controls)) | `blockCreate` / `blockInsertOperationBuild` |
| Move up / down | one block | edit mode: the toolbar; block selection mode: the menu | `blockMoveApply` (`blockSwapOperationBuild`) |
| Duplicate above / below | one block | block selection mode: the menu | `blockListCopy` into the same document |
| Delete | one block | edit mode: the toolbar (with its asset object, optionally) | `blockDelete` |
| Delete | the selected blocks | block selection mode: the menu | `blockListDelete` |
| Copy to / Move to | the selected blocks | block selection mode: the menu, then a dialog | `blockListCopy` / `blockListMove` |
| Paste as blocks | a text, made into blocks | edit mode: a paste on the page, Paste… of the insert menu | `blockListInsert` |
| Paste into a component | a text, given to the component being edited | edit mode: a paste while a component is edited | the component's draft (`pasteRequest`) |
| Move data into the asset service layer | one component block | edit mode: the toolbar | `blockAssetMoveApply` ([asset](doc_page_impl_asset.md#moving-inline-data-into-the-store)) |

```text
edit mode: toolbar of a block    block selection mode: menu of the selection    a paste on the page
  insert · move · delete           move · duplicate · delete · Copy/Move To…        │ a text
        │                                │                    │                    ▼
        │                                │          DocBlockSelectStore.transfer  DocPasteStore.review
        │                                │            (copy / move dialog)          ├─ as blocks: pipeline, place
        │                                │                    │                    └─ into the component: pasteRequest
        ▼                                ▼                    ▼                          │           │
DocEditStore: blockCreate · blockMoveApply · blockDelete · blockListCopy · blockListMove ·  │     the editor's draft
              blockListDelete · blockListInsert ◄──────────────────────────────────────────┘     (saved with its session)
        └──────────── hash-checked writes, recorded in the edit history ────────────┘
                                   ▼
file on disk ──► the page picks the new text up without a reload
```

The operations of edit mode's toolbar are specified with the toolbar ([Floating controls](doc_page_impl_edit.md#floating-controls)); the others, and what all of them share, below.

## What the operations act on

### Blocks belong to a text

A block is named by its index in the document's block model, and an index means something only in the text it was read in: after any write the blocks may be numbered otherwise. So everything that holds blocks for later holds the hash of the text with them (the selection, the blocks the author is at, the blocks of an open copy / move dialog), counts as empty when the document has another text, and a write is refused when its source document changed since the blocks were chosen (`DocEditStore.blockSourceGet`, `code: -2`).

### Selecting blocks

Blocks are selected in **block selection mode**, a mode of the page beside view and edit mode. Its switch (`DocBlockSelectToggle`, a list-with-checks icon) sits next to the edit switch, in the document toolbar and in the floating navigation, and exists under the same condition (a development server answering the edit api). The two modes are never on together: switching one on switches the other off, and leaving edit mode leaves its open session, which saves the draft (`DocEditStore.isBlockSelectMode`, `blockSelectModeSet`). Switching the mode on starts with the blocks a text selection of edit mode touched selected ([the blocks the author is at](#the-blocks-the-author-is-at)), nothing otherwise.

The mode shows the body of edit mode, so its blocks are the edit layer's blocks, but nothing in it edits: every root-level block is wrapped in `DocBlockSelectBlock` instead of the editable wrapper (`DocEditBlock` chooses), with the same element and attributes and the same zero-height anchor, so switching between the modes moves nothing on the page. A hovered block gets a dashed outline, a selected one a solid outline and a light tint; outlines and backgrounds take no room ([the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)). Text cannot be selected in the mode, so Shift + click does not drag a text selection. A block that renders nothing (a comment, trailing markers) keeps its chip, and the chip shows the selection.

```text
click               this block only; it becomes the anchor
Ctrl / ⌘ + click    this block in or out of the selection; it becomes the anchor
Shift + click       the blocks from the anchor to this one (with Ctrl / ⌘: added to the selection)
Escape              nothing selected
right click         the menu of the selection
```

A click selects only: links, buttons and fields inside a block do nothing in the mode. A right click on a selected block opens the menu for the whole selection; on a block that is not selected, that block alone becomes the selection, then the menu opens. The selection belongs to one document and to its text (`DocBlockSelectStore.selection { path, hash, blockIndexList, blockIndexAnchor }`).

### The blocks the author is at

Some operations act "here": a paste goes after the blocks the author is at, block selection mode starts with them selected. The page keeps them in one place, `DocBlockSelectStore.blockIndexListCurrentGet(path)`, so an operation asks instead of reading the DOM:

```text
block selection mode     the selected blocks
an open block session    its block
edit mode otherwise      the root-level blocks a text selection of the page touches (a caret in a block counts)
```

The text selection is reported by the body of edit mode (`DocEditBody`, on `selectionchange`) as `textSelection { path, hash, blockIndexList }`; a selection outside the body (the side panel, a dialog) is none. The reading body has no blocks, so in reading mode there are none.

### Choosing where the blocks go

A place is said the way the author sees it in a tree of the document, not as a line number: next to a node, or inside it (`frontend/src/lib/doc-block-place.js`).

```text
place = { docPath, nodeId, position }

tree of a document           nodeId        positions it takes now
▾ 🗎 a.md                     doc           Into, first (start)  ·  Into, last (end)
    [Heading] Title           block-0       Before  ·  After
    [Paragraph] First …       block-1       Before  ·  After
    [List] - one / - two      block-2       Before  ·  After       (later: Into, as list items)
```

`blockPlaceResolve` is the one place that decides whether a place can take blocks and turns it into the border of the document the edit layer inserts at (border `b` = before block `b`; the number of blocks = after the last one). A position the chosen node does not take is disabled with the reason on hover: the document has no place before or after itself, and a block holds nothing yet. When the author picks another node, the position stays if the node takes it, else it becomes the node's usual one (after a block, the end of the document: `blockPlaceNodeChange`).

The tree is a tree on purpose. Today only the document has children, its root-level blocks; when list items become places of their own, a list block gets its items as children, a place inside a list is `{ nodeId: 'block-2', position: 'insideLast' }` or a place next to an item, and the pickers, the stores, and the dialogs stay as they are: only `blockPlaceNodeListBuild` (the nodes) and `blockPlaceResolve` (the write) learn about items.

The place is chosen with `BlockPlacePicker`, which looks and behaves like the [move picker of the side panel](doc_page_impl_side_panel.md#moving-an-item): the same tree component (`SourceTreeSelect`; a block row is the badge of its kind, then the first words of the block), the same row of position buttons, the same hint line below them ("The blocks go after “First …”."). The border the chosen place puts the blocks at is drawn in the tree as a line between the two rows the blocks will go between: on the chosen block's top or bottom border for Before / After, above the first block or below the last one for Into, first / Into, last of the document (`blockPlaceNodeListMark` sets `insertMark` on that row; the line is drawn over the rows and takes no room). A place the node does not take draws nothing.

```text
▾ 🗎 a.md
    [Heading] Title
    [Paragraph] First …        ◄ chosen, After
  ───────────────────────────  ◄ the border the blocks go to
    [List] - one / - two
```

A paste can go into another document: the picker's document field takes any `md` / `mdx` document of the source, with completion (`SourcePathInput`), and its tree appears as soon as the edit layer has read it. A copy or a move chooses the document in a step of its own before the place ([the dialog](#the-dialog)).

## Where the operations are offered

### The toolbar of a block, in edit mode

The hover toolbar of every block carries the operations on that one block: insert above / below (the insert menu, with Paste… in its Text row), move up / down, delete (confirmed in the toolbar, with the block's asset object optionally), and to asset. They are specified with the toolbar ([Floating controls](doc_page_impl_edit.md#floating-controls)); a move is reported as the event `editBlockMoveRequest`, so the host application sees it first.

### The menu of the selection, in block selection mode

```text
Copy Blocks To…      the copy / move dialog, Copy first
Move Blocks To…      the same dialog, Move first
─────
Duplicate Above      a copy of the block right above / below it
Duplicate Below
Move Up              the block swapped with its neighbor: the toolbar's move
Move Down            (duplicate and move: one selected block only, greyed out with the reason otherwise)
─────
Delete Blocks…       the menu asks first: "Delete the 3 selected blocks?"  Delete · Cancel
```

The menu is the injected `Menu` (`config.components.Menu`), styled like the mode menu of a block (`DocBlockSelectMenu`). Its state is `DocBlockSelectStore.contextMenu { path, blockIndex, offset, openId, step, status, message }`.

- **It stays with its block.** The menu is anchored to the point of the block that was right-clicked (`config.anchor`: the block's rect plus the offset of the click in it), not to the window, so it moves with the block when the page scrolls.
- **Opening again.** A right click while it is open must not leave a stale menu at the old point or reuse the state of the old one: opening is always a close, then an opening on the next animation frame with a new `openId`, by which the menu is keyed. A pointer going down elsewhere closes the menu, and the click of that same gesture only closes: it does not change the selection.
- **Writes from the menu.** Duplicate, Move and Delete write at once (Delete after its confirmation step, which Escape leaves). While the write runs the entries are locked and the menu stays; written, the menu closes and the selection is dropped, since the document has a new text; failed, the menu shows why. Copy / Move To… open the dialog instead.

### A paste on the page, in edit mode

There are two ways in, both only on a document the edit layer can write (an `md` / `mdx` file of the source):

- **A paste on the page.** When the author pastes while nothing editable has focus (a click on an empty part of the page, or some text of the page selected, then Ctrl/⌘ + V), the body of edit mode (`DocEditBody`) takes the plain text of the clipboard and opens the review with it. A paste into a field, a block's editor, or a dialog is left to that element, so pasting inside a paragraph being edited still pastes into the paragraph. While a component that takes pastes is being edited, the review starts as a paste into it ([below](#pasting-into-the-component-being-edited)) and the session stays open; otherwise the open session is left first, saving it, and the blocks go right after the [blocks the author is at](#the-blocks-the-author-is-at) (the last block a text selection touches), or to the end of the current document when there are none, until the author chooses another place.
- **Paste… in the insert menu.** The last entry of the menu's Text row opens the review with an empty text, as blocks at the border the menu was opened for (before the next block, or at the end). The text field of the review is open and focused, for the author to paste into. The page does not read the clipboard by itself, because that asks the browser for a permission.

Both are offered only when the host supplies the panel component that frames the dialog (`config.compConfigHost.panelComponent`, as for the asset panel).

## The operations

### Moving and duplicating one block

**Move up / down** swaps the block with its neighbor: one `replaceLines` operation over the two blocks and the lines between them (`blockSwapOperationBuild`), so the blank lines that separate blocks stay where they are and nothing else in the file moves. It is one operation wherever it is offered: the toolbar reports `editBlockMoveRequest { direction }`, the menu of the selection calls the same `DocEditStore.blockMoveApply`. Up is refused for the first block, down for the last.

**Duplicate above / below** is a copy of the one selected block into its own document, at the border before it or after it (`blockListCopy`, [below](#the-write-of-a-copy-or-a-move)).

Both take one block for now; the menu greys them out, with the reason, for a selection of several.

### Deleting blocks

A block deleted from its toolbar is confirmed there, and a block whose data is an asset object can be deleted with its object ([Floating controls](doc_page_impl_edit.md#floating-controls), [Usage](doc_page_impl_asset.md#usage)). The selected blocks are deleted from the menu of the selection after its confirmation step, in one write (`DocEditStore.blockListDelete`: the runs of blocks taken out with their blank lines, `blockListDeleteOperationListBuild`); asset objects they reference are left to the asset service layer, where an object nothing references shows as an orphan.

### Copying and moving blocks

#### The dialog

Copy Blocks To… and Move Blocks To… open the same dialog (`comp-doc/block-select/DocBlockTransferPopup.jsx`, open while `DocBlockSelectStore.transfer` is set), framed by the host's panel component, with the two columns of the paste review:

```text
┌ Move blocks ────────────────────────────────────────────────────────────── × ┐
│ Blocks (2 of 3)    [Lines] [Sources] [All blocks]  │ To                      │
│ [☑] [Paragraph] First of three short paragraphs …  │ ◄ document step         │
│ [☐] [List] - one - two                             │ [~example/a.md       ]  │
│ [☑] [Image] <!--renderComp=Image--> ```yaml …      │ [🔍 search by name   ]  │
│                                                    │ ▾ 📁 ~example           │
│                                                    │     🗎 a.md             │
│                                                    │               [Choose]  │
│                                                    │ ◄ place step            │
│                                                    │ [←] ~example/a.md       │
│                                                    │ ▾ 🗎 a.md               │
│                                                    │   [Paragraph] First … chosen │
│                                                    │ ───────────────────     │
│                                                    │ [Before] [After] …      │
│ ──────────────────────────────────────────────────────────────────────────── │
│ (why not, or the error of the write)     [Cancel] [Copy here] [Move here]    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **The blocks** (left): the selected blocks, one line each (`Lines`: a checkbox, the badge, the beginning of the raw source), or each with its source and the render toggle (`Sources`). Every block is checked at first; unchecking leaves it out. **All blocks** lists every block of the document instead, the selected ones checked, so blocks can be added without leaving the dialog; going back to the selection leaves out what was checked among the others.
- **To** (right), in two steps. First the document, with the [source path picker](doc_page_impl_source.md#choosing-a-path): a path typed with completion, or chosen in the tree of the source (narrowed by its search field, the matches highlighted), any `md` / `mdx` document; the current document is chosen at first. **Choose** (or a double click in the tree) goes on to the place in that document, with the [place picker](#choosing-where-the-blocks-go) without its document field; when it is the blocks' own document, the checked blocks are marked "chosen" in its tree. The arrow goes back to choose another document.
- **Copy here** and **Move here** are both always offered, whichever entry opened the dialog; the entry's one is the primary button. Each is disabled with its reason: no block checked, no place yet, the place cannot take blocks, the document changed since the blocks were chosen, or (Move into the same document) the blocks already are there. A write that succeeds closes the dialog and drops the selection; one that fails keeps the dialog with the message. Cancel, the ×, and Escape write nothing.

The state is `DocBlockSelectStore.transfer { actionInitial, sourcePath, sourceHash, blockIndexOfferedList, blockIndexCheckedList, isSourceAllShown, listDisplay, isRenderedById, targetStep, targetDocPath, targetDocMessage, place, status, message }`.

#### The write of a copy or a move

The dialog sends the source document, the hash of the text the blocks were chosen in, the checked block indices, the target document, and the border the place resolves to. A source that changed since is refused, because its indices may name other blocks now.

- **Copy** (`DocEditStore.blockListCopy`): the blocks' source in document order, joined by one blank line (`blockListTextGet`), inserted at the border like a paste (`blockListInsert`). One write, one record of the history. Duplicate is a copy into the blocks' own document.
- **Move within one document** (`blockListMove`, same path): one write of several line operations applied together on the server (`/source/apply` with `operationList`, applied bottom-up by `lineOperationListApply`): the runs of moved blocks deleted with their blank lines, and the blocks inserted next to a block that stays (`blockListMoveOperationListBuild`), so the insertion never falls inside a deleted run. A move that would leave the order as it is writes nothing.
- **Move into another document**: two writes, the insertion into the target first and the removal from the source last (`blockListDeleteOperationListBuild`), so a failure never loses the blocks: when the removal fails, they are in both documents and the message says so. Both writes are one record of the history (kind `blockListMove`, two file changes), undone together.

After a copy, a move or a delete the asset service layer is told which documents changed, so it reads their asset references again ([usage](doc_page_impl_asset.md#usage)). Copied and moved blocks do not go through the [transforms](#transforms) of a paste: they are written as their source is.

### Pasting

A pasted text is not written at once. A dialog shows it for review: as the blocks it makes, beside the target document, where the author chooses the place; or, while a component is being edited, as the text handed to that component. Only the dialog's button acts.

#### Pasting as blocks: the pipeline

The pipeline is a pure function (`pasteBlockListBuild` in `frontend/src/lib/doc-paste.js`). It runs again whenever the text, the target document, or its format changes, so the review always shows what Insert would write:

```text
pasted text
  -> normalized: "\n" line endings, no blank lines before or after it
  -> transforms of stage 'text', in order          (text, context) => text
  -> parsed into blocks, as a document of the target's format
       (md or mdx: the parse of the edit layer's block model, editTextModelBuild)
  -> transforms of stage 'block', on every block   (blockText, { ...context, block }) => text
       -> parsed again, because a transform may turn one block into two
  -> blockList, and the text Insert writes: the blocks with one blank line between them
```

The parse is the one the edit layer uses for documents (`remarkEditBlock` grouping, `blockDescribe`), so a pasted block is exactly the block it will be once inserted: a comment-marked component with its fenced block is one block, a list is one block, a heading is one block. The format is the target document's, which matters: in an `.md` document `<Callout>…</Callout>` is HTML text inside a paragraph, in an `.mdx` document written on lines of its own it is a JSX element; a text that is not valid MDX (an HTML comment, an unclosed tag) gives no blocks and an error with its line, and Insert stays disabled. Changing the target document can therefore change the blocks.

A frontmatter at the start of the pasted text is not inserted (a document has one frontmatter, at its top), and the review says so.

#### Transforms

Transforms are the place for the conversions a pasted text needs before it fits the document: an MDX element turned into the comment-block form of an `.md` document, links rewritten to the paths of the source, and the like. The host application supplies them in `DocPageMdx` `config.edit.pasteTransformList`:

```js
pasteTransformList: [
  { id: 'link-relative', label: 'Links made relative', stage: 'text',
    transform: (text, { format, docPath }) => text },
  { id: 'callout-comment', label: 'Callout as comment block', stage: 'block',
    transform: (blockText, { format, docPath, block }) => blockText },
]
```

A `text` transform sees the whole text before it is parsed; a `block` transform sees one block at a time with what the parse knows about it (`block.kind`, `block.component.compName`), so it can change only the blocks it is about. The context names the target (`format`, `docPath`), because the same paste may need different conversions for an `.md` and an `.mdx` document. A transform that changes something is listed in the review ("Changed by: …"); a transform that throws leaves its input as it was and is reported, and the paste continues without it. No transform is built in yet.

#### The review dialog

`comp-doc/paste/DocPastePopup.jsx`, open while `DocPasteStore.review` is set:

```text
┌ Paste as blocks ──────────────────────────────────────────────────────── × ┐
│ Blocks (3)  ▸ Pasted text                │ [Into StockTable] [As blocks]  │ ◄ only while a component
│ ┌──────────────────────────────────────┐ │ Insert into                    │   that takes pastes is edited
│ │ [Paragraph] [👁]                     │ │ Document  ~example/a.md        │
│ │ A pasted paragraph with **bold**.    │ │ ▾ 🗎 a.md                      │
│ └──────────────────────────────────────┘ │   [Heading] Title              │
│ ┌──────────────────────────────────────┐ │   [Paragraph] First para…      │ ◄ chosen
│ │ [List] [</>]                         │ │ ──────────────────────         │ ◄ where they go
│ │ • one   • two                        │ │   [List] - one                 │
│ └──────────────────────────────────────┘ │ [Before] [After] [Into, first] │
│                                          │ The blocks go after “First…”.  │
│ ─────────────────────────────────────────────────────────────────────────  │
│ (why Insert is not possible, or the error of the write)  [Cancel] [Insert] │
└────────────────────────────────────────────────────────────────────────────┘
```

- **The blocks** (left): every root-level block the text makes, with a badge naming its kind (`Paragraph`, `List`, `Heading`, the component's name for a component block, the same labels as the block toolbar) and its raw source. The button next to the badge switches that block between its source and its rendering; the rendering is the target document's (its format and its path, so relative links and images resolve from there).
- **Pasted text** opens the text itself above the blocks, editable as plain text; the blocks follow every change. A review opened with no text opens with it.
- **Insert into** (right): the place ([Choosing where the blocks go](#choosing-where-the-blocks-go)).
- **Insert** is disabled, with the reason beside it, while the text gives no blocks, does not parse, or the place cannot take blocks. Insert writes the blocks and closes the dialog; when the write fails (the file changed meanwhile, the server refused) the dialog stays with the message. **Cancel**, the ×, and Escape close it and write nothing; Ctrl/⌘ + Enter in the pasted text inserts.
- **The status line** of the footer is one line: a long reason is cut with an ellipsis and shown whole on hover, so a message appearing or changing never changes the height of the dialog ([the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)).

The state of the review lives in `DocPasteStore`, not in the dialog: `review { target, text, textVersion, isSourceOpen, place, placeMessage, isRenderedById, status, message }`, and the pipeline result is derived from it (`result`, recomputed when the text or the target changes).

#### Pasting into the component being edited

A component being edited in one of its own edit modes can take a pasted text itself: a table turns tab-separated lines into rows, a diagram could turn a text into nodes. What the text means is the component's business, so the page does not parse it; it hands the text over and the component accepts or refuses.

- **The offer.** While a component block is open in one of its own edit modes (not `source`, whose surface is a field and takes a paste itself) and its editor takes pastes (`DocPasteStore.inPlaceIsAvailable`), a paste on the page opens the review as a paste into it (`review.target` `inPlace`; the title "Paste into StockTable"), and the open session is not left. The switch at the top of the right column changes to **As blocks** and back; as blocks, the session is left (saved) when Insert writes, like any insert. Paste… of the insert menu always pastes as blocks.
- **The review.** The left column is the pasted text, editable; the right column says that the text goes to the component. The primary button is **Paste into StockTable**.
- **The hand-over.** The button sends the event `pasteRequest { text, format, sourcePath }` to the editor of the session (`DocEditStore.sessionEventSend`). The editor answers `{ code: 0 }` when it took the text into its draft: the dialog closes, the session stays open, and the draft is saved when the session is left, like any change of it. It answers `{ code: -1, message }` to refuse ("“…” is not a table row …"): the dialog stays, with the reason in its one-line status line, so the author can change the text or paste it as blocks. An editor that throws, or answers nothing, refuses.
- **The dialog belongs to the session.** It carries `doc-edit-popup`, so a pointer going down in it does not leave the session of the component (as for the [block popup](doc_page_impl_popup.md#the-dialog)).

An editor takes events from the page through the editor contract ([the editor contract](doc_page_impl_edit.md#the-editor-contract)): `config.edit.receiverSet(handler, { typeList: ['pasteRequest'] })` in an effect, returning the unregistration as the effect's cleanup. It is the page-to-component direction of the component's events: the component reports to the page with `onEvent`, the page sends to the component through its receiver, and both answer `{ code, message }`. `typeList` says which event types it takes, so the page offers only what will be received. `StockTableEdit` of the example application is the example: tab-separated lines (copied from a spreadsheet) or Markdown table rows become rows added at the end; a line that is not a row, or a row with more cells than the table has columns, is refused.

### Dialogs

Both dialogs of this document move by the empty part of their header and resize by their edges; the size a resize leaves is kept for the next opening, also after a reload ([the panel contract](doc_page_impl.md#the-panel-contract), `DocPanelLayoutStore`, ids `paste` and `blockTransfer`).

## General components

The parts of the dialogs know nothing about the clipboard, the selection or the stores; what they show and what is chosen belong to the caller:

- `BlockListReview` (`comp-doc/block-list/`): a list of blocks `[{ id, label, kind, text }]`, each starting with its badge. `display: 'full'` shows every block with its source, or rendered (`isRenderedById`, `onRenderToggle`); `display: 'compact'` one line per block, its source cut where the line ends. `isCheckable` puts a checkbox before every badge (`isCheckedById`, `onCheckToggle`; in the compact display a click on the line toggles it). The paste review uses it full and without checkboxes, the copy / move dialog both ways with them.
- `BlockPlacePicker` (`comp-doc/block-list/`): a document field (hidden with `isDocFieldShown: false`), the tree of the document with the line of the chosen border, the positions with their reasons, and the hint; the place belongs to the caller (`place`, `onDocCommit`, `onNodeSelect`, `onPositionSelect`, `positionReasonGet`).
- `SourceTreeSelect` (`comp-doc/source/`, a part of the doc page source service layer): the tree, of the source or of anything in its node shape; a node's `insertMark` (`before` / `after`) draws the line of a border ([browsing as a tree](doc_page_impl_source.md#browsing-as-a-tree)).
- `SourcePathPicker` (`comp-doc/source/`): a path of the source, typed or browsed, of any kind the [completion](doc_page_impl_source.md#choosing-a-path) knows (a document here, a folder in the location prompt of a new file).

## Files

```text
frontend/src/lib/doc-paste.js           the pipeline: normalize, transforms, parse into blocks (pure)
frontend/src/lib/doc-block-place.js     the place model: nodes of a document's tree, positions, resolving a
                                        place to a border, the mark of that border, how a place reads (pure)
frontend/src/lib/doc-edit-block.js      editTextModelBuild: the block model of a text that is not a file;
                                        blockSwapOperationBuild, blockListTextGet, blockListDeleteOperationListBuild,
                                        blockListMoveOperationListBuild: the operations of the writes
frontend/src/store/DocPasteStore.ts     the open review, its target, the pipeline result, the place, Insert,
                                        the hand-over to the component being edited
frontend/src/store/DocBlockSelectStore.ts the selection, the blocks the author is at, the menu (duplicate,
                                        move, delete), the copy / move dialog
frontend/src/store/DocEditStore.ts      isBlockSelectMode; blockMoveApply, blockListInsert, blockListCopy,
                                        blockListMove, blockListDelete: the writes; sessionReceiverSet,
                                        sessionEventSend: the page to the editor of the session
frontend/src/store/DocPanelLayoutStore.ts where the dialogs were moved, their sizes (comp-doc/popup/use-panel-layout.js)
comp-doc/paste/DocPastePopup.jsx        the review dialog (+ DocPaste.css)
comp-doc/block-select/                  DocBlockSelectToggle, DocBlockSelectBlock, DocBlockSelectMenu,
                                        DocBlockTransferPopup (+ DocBlockSelect.css)
comp-doc/block-list/BlockListReview.jsx the blocks, full or one line each, with checkboxes (+ BlockList.css)
comp-doc/block-list/BlockPlacePicker.jsx the document, its tree, the positions
comp-doc/source/SourcePathPicker.jsx    a path of the source, typed or browsed
comp-doc/edit/DocEditBody.jsx           the paste on the page; the blocks a text selection touches; the body of both modes
comp-doc/edit/DocEditBlock.jsx          editable or selectable, by the mode
comp-doc/edit/DocEditBlockToolbar.jsx   the operations on one block in edit mode
comp-doc/edit/DocEditInsertMenu.jsx     Paste… in the Text row
example_doc/comp-mdx/table/stock-table/StockTableEdit.jsx a component taking a paste (pasteRequest)
example_doc/mdx-doc-edit-in-place.md            "Pasting blocks", "Copying and moving blocks": texts and blocks to try
```
