<!-- Design of undo and redo: the edit history of documents, kept by the development server, and which history an undo goes to. Parent document: doc_page_impl_edit.md. The event layer it is routed through: doc_page_impl_event.md. -->

# The Edit History: Design

Every change the edit layer writes to a document can be taken back (**undo**) and made again (**redo**). The history is kept **per document** by the development server, in its memory: every write of the edit api is recorded there with the text of the file before and after, whoever made it (a block saved, a block moved, a paste, an api called by an agent). A page reloaded, or a second tab, finds it as it was; a server started again starts with none, and nothing of it is ever written to disk. An undo writes the text before back through the same server, so it is a write like any other, seen by every tab as one.

Which history an undo takes is decided by **where the author is**: the document of the body they are in (the page, the popup of a link, the popup of an MDX block), and before it the component of the block they are at, which may have changes of its own that are not in the document. The request travels through the [event layer](doc_page_impl_event.md), so the host application sees an undo as it sees any change of a document, and a component takes part by an event delivered to its block, without knowing the stores. After a step, the page shows where it took place; the caret and the selection are not part of the history. For the edit layer the history belongs to, see [MDX Document In-place Editing](doc_page_impl_edit.md); a demonstration is [Undo and Redo](../example_doc/mdx-doc-edit-history.md).

<!--renderComp=DiagramText-->
```text
the page                                        development server
                                                plugin/doc-edit-server.ts
DocEditStore.operationApply ── write + what ──► /source/apply
  (every write of the edit layer)   it is         write the file
                                                  DocEditHistory.record
  historySummaryByPath ◄────────── summary ────── per document, in memory

Ctrl/⌘+Z, ↶, palette, agent
  └► historyUndoRequest ─► DocEventRouter
       host first, then the route 'history' ─► DocHistoryStore
         the component the author is at ─► historyUndo delivered to it
         else the document of the body  ─► DocEditStore.historyStepApply
                                              └──► /history/step
                                                   text before written
                                                   back, merged with
                                                   what changed since
         the new texts accepted as any write; the change shown
```

## Core concepts

- **An entry** is one action of the author: one write of a document, or the writes of several documents an action made together (blocks moved from a document into another), with the text of every file before and after, and what the page said of it (its label, the document it was made in).
- **The history of a document** is its entries, oldest first, each *done* or *undone*. An undo takes the last done entry, a redo the entry undone last; a new entry drops the undone ones, as in any editor. An entry of two documents is in the history of both.
- **A step** is an undo or a redo of one entry: the server writes, for every file of the entry, the text the entry left it with taken back (put again).
- **The scope** is the history a request goes to: a document, or the entries of an MDX block among those of its host; a component with changes of its own is asked before the scope of its document.
- **The place of the author** is the element they last pointed at or focused: its edit body names the document, its block wrapper the block.

## What is recorded

Every write the edit api applies, recorded by the server as it writes (`/source/apply`, also for a [document that is not a file](doc_page_impl_edit.md#documents-that-are-not-files), whose layer the server writes through). The edit layer has one door for its writes, `DocEditStore.operationApply` ([DocEditStore](doc_page_impl_edit.md#doceditstore)), and it sends with each write what the history keeps of it (`EditHistoryMeta`, the field `history` of the request):

| field | meaning |
| --- | --- |
| `label` | what an Undo button says: "Move block", "Edit paragraph", "Paste"; made from the operation and the block it touches when the caller gives none (`historyLabelDerive`) |
| `actionId` | the writes of one action carry one id and are one entry; the move of blocks into another document is the one action of two writes |
| `docPath`, `embed` | the action was made in an embedded document: its path, its line in the host, the hashes of its text before and after ([below](#the-popup-of-an-mdx-block)) |
| `isRetract` | the write takes back the last entry of the document: the creation of a block, canceled. The entry goes, and nothing is recorded, so Escape on a block just created leaves no step behind |

- **One action, one entry.** A save of a block, a move, a paste, a split of a list item, a view chosen from the mode menu: each is one write and one entry. An action that is two writes says so with one `actionId` (the server joins a write to the entry of the same id it recorded last, within a short time). A write that changed nothing is not recorded.
- **Files deleted with a block** ([Deleting blocks](doc_page_impl_block_ops.md#deleting-blocks)) are recorded with the entry, as their backups: an undo of the deletion puts them back from their backups before the document is written, refused when a file of that name exists again; a redo deletes them again into new backups.
- **Anyone's writes.** The server records what it writes, so the writes of an api called by an agent or a script through the page are in the history as an author's are; a page or a tab never records anything itself.
- **The text before is shared.** The text a write starts from is mostly the text the entry before it left; the server keeps it once (one string for both), so an entry costs about one text of its document.

The history of a document keeps its last 100 entries, and the server all its histories within 64 MB of text, the oldest entries going first (`DocEditHistory`, `entryCountMaxPerPath`, `byteCountMax`).

## What is not recorded

Like the history of Yamd's document store, the history holds what the document says, never the state of its editing:

- **Where the author is.** The caret, the selection, the block or the item that is open, the scroll position, a menu, a block selected for a structural edit. A step changes none of them on purpose and is never made by them.
- **A draft.** The text of a block being typed is the editor's until the session is left; the save is one entry. While it is typed, its own undo is the editor's ([The keys](#the-keys)).
- **What is not the text of a document.** The data a component saves elsewhere: the asset items of a [frontend object](doc_page_impl_obj_frontend.md), the head of an item written from the asset panel, the state of a dashboard, the state of a component (`useCompState`). These have their own versions, or a history of their component ([A component with changes of its own](#a-component-with-changes-of-its-own)). A block rewritten as a reference to an asset item is a write of the document and is recorded; the item made for it stays when the write is undone.
- **The side panel and the configuration.** A label renamed, an item moved, a node inserted, a config value written from the page change yaml files, not documents ([TODO](doc_page_impl_TODO.md#edit-history-side-panel)); so does a file created or deleted from the side panel.
- **A move of a document.** A file moved or renamed ([Relocation](doc_page_impl_nav_backlink.md#relocation)) is not an entry, nor are the references it rewrote in other documents: the move is undone by the move back. The entries of the moved document follow it to its new path (`DocEditHistory.pathMove`), so an undo after the move writes it where it is now ([TODO](doc_page_impl_TODO.md#source-file-rename)).
- **Changes made outside the page.** A file saved by an editor is not an entry. It does not break the history either: a step is merged with it ([below](#a-step-on-a-file-that-changed-since)).

## Kept by the development server

The history lives in the server's memory, one `DocEditHistory` per edit middleware (`plugin/doc-edit-history.ts`), for every document written while the server runs; it is what makes it a history of the document, not of a page:

- **A reload keeps it.** A page is reloaded more often than a server is restarted: by the author, by a change of the configuration (the side panel, a yaml file), by vite itself. The history is read again with the document (`/source` answers the summary of its history with its text).
- **Every tab sees one history.** A write from one tab is undone from another; each answer of the server carries the summary of the documents it touched, and a document read again (the data event of a write elsewhere) brings its summary with it.
- **No file, no persistence.** A server stopped forgets every history, by design: a history read from disk after the files were edited for hours elsewhere would take back changes nobody remembers. The page does not keep one either.
- **Never on a built page.** A built page has no edit api, so no history, no keys and no buttons ([Availability](doc_page_impl_edit.md#availability-and-mode)).

The page keeps only what the server answered last of each document it read, its **summary** (`DocEditStore.historySummaryByPath`): the entries without their texts (`entryId`, `label`, `state`, `docPath`, `embed`, `pathList`), and the entries an undo and a redo of the whole document take (`undoEntryId`, `redoEntryId`). The buttons are drawn from it; the server decides.

## A step

<!--renderComp=DiagramText-->
```text
undo of an entry, for every file of it
  the file is as the entry left it (hash after)  -> write the text before
  the file is as before already                  -> nothing to write
  else: changed since (an editor, a later entry) -> merge three texts:
          base   the text after
          ours   the file now          the lines changed since are kept,
          theirs the text before       the entry's lines taken back
        both changed the same lines    -> refused, nothing written (-2)
every file written, or none; then the entry is undone (redone)
```

A redo is the same with the texts the other way round. The texts of an entry never change: a step on a file that changed since is a merge with the entry's own texts, so an entry undone after a merge is redone by a merge too.

### A step on a file that changed since

The merge (`textMerge3`, `lib/doc-text-merge.ts`) compares lines: the hunks of each side against the base (Myers' difference of lines), applied together where they do not meet; two hunks of the same lines are one when they write the same, a conflict otherwise. A conflict refuses the whole step, every file of the entry as it was, with the lines named ("line 26 of the text it left"); the entry stays done, so the author can repair the text and try again, or forget the history of the document (`history/clear`).

The merge is what makes the history robust where documents are edited from several places at once, which is the normal case here: an author types in the page while an editor or an agent writes the same file. Without it, any change made outside the page would end the history of the document. It also makes possible the one step that is not the last: the popup of an MDX block undoes its own entry while the host has later ones ([below](#the-popup-of-an-mdx-block)).

### The order of steps

A history of a document is a line, not the tree of Yamd's store: a new entry drops what was undone in that document ([TODO](doc_page_impl_TODO.md#edit-history-tree)). An entry of two documents is undone from either and goes back to both; a new entry of one of them drops it from both, undone.

## Which history: the scope

| the author is at | the history | the request |
| --- | --- | --- |
| the body of the page | the page's document | `{ path }` of the page |
| the popup of a link (`?nav=popup`) | the linked document, the same history it has as a page | its path |
| the popup of an MDX block | the entries of the host made in that block | the embedded path, `{host}::embed@{line}` |
| the block popup of a component | the document of the block (it is the page's) | the page's path |
| a component with changes of its own | that component first, then its document | delivered to its block |

**A document is its history wherever it is shown.** The history is keyed by the path of the document, not by the page or the popup: a document edited as the page, then left for another one and opened in the popup of a link from there, undoes in the popup the edits made when it was the page, and the reverse. The popup of a link and of an MDX block shows **Undo** and **Redo** in its header, for its document; the toolbar of the page shows them for the page's.

### The popup of an MDX block

An [embedded document](doc_page_impl_mdx_embed.md) is not a file: every edit of it is a write of its host. Its entries are therefore entries of the host, which the toolbar of the host undoes like the others (its title says "(in an MDX block)"), and the popup of the block finds among them as its own, by the text they leave: an entry made in the block carries the hashes of the block's text before and after (`embed`, `embedHistoryHashGet`: the text without its trailing newlines, which the fence may add or drop). The popup's undo is the last done entry whose hash after is the block's text now, its redo the entry undone last whose hash before is the block's text now. A chain of edits in the block is undone link by link; an edit of the block made from the host (its fence edited as source) ends the chain, since the popup cannot know what it was.

The hashes identify the block across edits above it, which move its line and so its path; the line is kept with the entry only to tell two blocks of the same text apart. The popup's step names its entry (`entryId`), which may not be the last of the host: the server merges it, so the host's later entries stay.

## Routing an undo

An undo is the event `historyUndoRequest` (a redo `historyRedoRequest`) of the route `history`, answered by `DocHistoryStore.eventHandle`. Who reports it decides what it names:

| reported by | data | goes to |
| --- | --- | --- |
| a button of the toolbar or of a popup header (`DocHistoryButtons`) | `{ path }` | the history of that document |
| the api `history/undo` with `doc` | `{ path }` | the history of that document |
| the api `history/undo` without `doc` (the keys, the palette, an agent) | `{ isPlaceUsed: true }` | the component of the place, then the document of the place |
| a component | `{}` | the history of its document (`source.sourcePath`) |

<!--renderComp=DiagramText-->
```text
isPlaceUsed: the place of the author (DocHistoryStore.placeCurrentGet)
  the focused element, else the one last pointed at, else the page
  -> its edit body: the document ([data-edit-path]; in a popup's header,
     the body of that popup)
  -> its block: the component's marker line (the block identity)
1. the component    publish historyUndo { subject: document + block line }
                    isAcceptedFirst: the first that answers { code: 0 }
                    took it; nobody: go on
2. the document     DocHistoryStore.step(direction, path)
```

The host application answers first, as for any event (`component:historyUndoRequest`), so an application with a history of its own takes the keys of the page over without knowing the stores.

A step leaves the open session first, saving it (`historyStepApply`): an undo pressed while a block is open, its draft changed, saves the draft (one entry) and undoes that entry, so the block is back as it was before it was opened and a redo brings the draft back. A step is refused while another write of the layer is pending.

## The keys

<!--renderComp=DiagramText-->
```text
mod+z         history/undo   when editBody && !textFocused
mod+shift+z   history/redo   when editBody && !textFocused
ctrl+y        history/redo   when editBody && !textFocused
```

The keys are bindings of the package's map (`main/hotkey/default.yaml`), so a doc page or a reader rebinds them like any key ([Keyboard maps](doc_page_impl_api_hotkey.md)). Two names of the context keep them where they belong:

- **`editBody`**: edit mode or block selection mode, where the edit body is shown. In reading mode the keys do nothing: a reader pressing Ctrl/⌘ + Z does not take back an edit made an hour ago that the page does not show.
- **`!textFocused`**: a text being typed keeps its keys. In a field, the source of a block being edited, a cell, Ctrl/⌘ + Z is the browser's own undo of that text, and the page's map passes the key over (`textFocused` is set from the key's target when the key is pressed). Leaving the text (a click outside the block) saves it, and the next Ctrl/⌘ + Z is the document's ([TODO](doc_page_impl_TODO.md#edit-history-text-continue)).

An editor that keeps steps of its own takes the keys itself while it has the focus, before the page sees them (the listener of the keyboard maps skips a key whose default was prevented): the visual editor of the card diagrams does ([History](../package/cloud-dev-vis/doc/card-diagram-impl.md#history)).

## Where it took place

After a step, the page shows where the document changed, in the body that shows the document the step was asked in (the page, or the popup): the lines that differ between the text before and after the step (`textChangeRangeListGet`) give the blocks of the new text they fall in (`historyChangeBlockListGet`, `lib/doc-history-reveal.js`), and once the body is drawn:

- **The first block is brought into view when it is not**: its top a third down the visible part of what scrolls it, below the sticky head of the page; a block already in view stays where it is, so a step on what the author is looking at moves nothing. The scroll is smooth unless the reader asked for reduced motion.
- **Every block it changed is marked for a moment**: tinted, with a ring of the same tint, fading out in 1.6 s; lines only taken away are a bar at the border where they were (the top of the block after them, the bottom of the last block). The mark is an attribute the page sets on the wrapper (`data-history-mark`), drawn by css as a background and a box-shadow: it takes no room, so nothing moves ([the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)).
- **Nothing is focused, nothing selected, no block opened.** The caret and the selection are not in the history, so a step has nothing to put back there; the mark shows the place, and a click opens the block.

The page also reports the step in its notice ("Undone: Move block"), from the keys and from the buttons alike, and a refusal there with its reason.

## A component and the history

Components are written to be used outside a document too (another host, a test, a preview), so a component never calls the history, never binds the page's keys, and never knows the server. What it does depends on where its changes go:

<!--renderComp=DiagramText-->
```text
its change is                   the history              what to do
a write of its block            the document's:          nothing
  (dataReplaceRequest,            one entry
  blockPropSetRequest, a draft
  saved by a session)
a step of a draft while its     its own, in the editor,  take the keys while
  session is open (a canvas,      dropped with the       focused; the save
  a sheet)                        session                is one entry
data kept outside the document  its own, if it wants     answer historyUndo /
  (component state, asset         one                    historyRedo at its
  items, its own api)                                    block
```

### Changes written to its block

A component reporting the new data of its block (`dataReplaceRequest`, `blockPropSetRequest`, [Changing its own block](doc_page_impl_mdx_comp.md#changing-its-own-block)), or an editor whose draft a session saves ([The editor contract](doc_page_impl_edit.md#the-editor-contract)), is in the history of the document by the write itself: each write is an entry, labeled by the block it touched, and undone like any other. Nothing is needed of it, and it should not keep a second history of the same changes.

### Steps of a draft while it is edited

An editor whose draft goes through many steps before it is saved (the visual editor of a diagram, a spreadsheet) keeps them itself, in the editor, for the session: the page knows nothing of a draft before it is saved. The card diagrams are the reference ([History](../package/cloud-dev-vis/doc/card-diagram-impl.md#history), `DiagramEditHistory.js`): recorded at the one place every change of the draft passes, the selection not a step, typing grouped, the history dropped with the session. While the editor has the focus it takes Ctrl/⌘ + Z and Ctrl/⌘ + Shift + Z (Ctrl/⌘ + Y) itself and prevents their default, as a text field does; its bar may show Undo / Redo of the draft. The save is one entry of the document: after it, Ctrl/⌘ + Z outside the editor takes the whole session back.

### A component with changes of its own

A component whose changes are not in the document (its count in the component state layer, the items of the frontend object it shows, the data it saves through its own api) may keep a history of them and let the page's undo reach it. It subscribes to the events delivered to its block ([Events delivered to components](doc_page_impl_event.md#events-delivered-to-components)):

```jsx
import { useDocEventSubscribe } from '.../comp-doc/registry/use-doc-event.js';

useDocEventSubscribe(config, 'historyUndo', (data) => {
  // data.target: the element the author was at; data.subject: { sourcePath, blockLine }
  const step = store.stepUndoTake();
  if (!step) return undefined;         // nothing of its own: the document is asked
  store.stepUndoApply(step);
  return { code: 0, message: `count back to ${step.value}` };   // taken; said in the notice
});
useDocEventSubscribe(config, 'historyRedo', (data) => { … });
```

The rules of such a component:

- **Answer only for a step of its own.** `{ code: 0 }` when it took a step back (put one again), `undefined` when it has none: the page then undoes the document. A component that answers without a step swallows the author's undo.
- **Its own steps, its own data.** The listener changes the component's data through the component's usual way (its state, its api), never the document: a change of the document is an entry of the document's history. The steps live with the data (the state object, the store of the component), not in the mount, so a block drawn again keeps them.
- **The place decides.** The page delivers the event to the block the author is at, so a component is asked only when the author last pointed at it or focused something inside it; `data.target` is that element, for a component holding several things.
- **Independent of the page.** The subscription is the only tie: outside a document nothing is delivered, and the component works as before. It never binds the page's keys globally; while one of its own fields has the focus, the browser's undo of the field applies.
- **Inside another component.** A component rendered by another one (a view of a `SwitchView`) has no block of its own; the outer one is asked, and may forward.

`DemoCounter` (`example_doc/.doc-page/comp-mdx/DemoCounter.jsx`) is the demonstration: its count is component state, its past counts are kept beside it, and Ctrl/⌘ + Z takes the clicks back one by one while the author is at it, then goes on to the document.

### Checklist for a new component

| | Check |
| --- | --- |
| ☐ | Every change of the document goes through an event of the edit layer (`dataReplaceRequest`, `blockPropSetRequest`, `editDraftChange`), never a write of its own: it is then in the history |
| ☐ | An editor with steps of its own keeps them for the session only, takes the keys while it has the focus, and never saves them with the data |
| ☐ | Changes kept outside the document: either not undoable from the page, or answered at the block (`historyUndo` / `historyRedo`), `undefined` when there is no step |
| ☐ | Nothing of the history is in the component's data, and it never reads the history or the keys of the page |
| ☐ | A step taken back draws as the change did: what a step changes is drawn from data, not from the state of a gesture |

## The api and the buttons

| api | params | |
| --- | --- | --- |
| `history/undo` | `doc?` | the event `historyUndoRequest`: the document named, else the place of the author, its component first |
| `history/redo` | `doc?` | the same, `historyRedoRequest` |
| `history/list` | `doc?` | the summary of the history of a document (the current one without `doc`), read from the server |
| `history/clear` | `doc?` | the history of a document forgotten |

`DocHistoryButtons` draws ↶ / ↷ for one document: in the document controls of the toolbar for the page, in the header of the popup of a link and of an MDX block (in Edit) for theirs. A button is greyed out when its scope has nothing to take, its title says what it would take ("Undo: Move block (⌘Z)", from the summary and the keyboard map), and a click reports the event with the document named; the result goes to the notice of the page.

The routes of the edit api (`plugin/doc-edit-server.ts`):

```text
POST /source/apply   + history: { label, kind, actionId, docPath, embed,
                       isRetract }         answers data.history: the summary
GET  /source?path=   answers data.history with the text
GET  /history?path=  -> { path, entryList, undoEntryId, redoEntryId }
POST /history/step   { path, direction, entryId? }
                     -> { entry, fileList: [{ internalPath, textBefore,
                          text, hash }], historyByPath }
                     -1 nothing to step, -2 changed since where it would
                     write, -3 not a document of the source, -4 read-only
POST /history/clear  { path } -> the summary
```

The page takes a step in as it takes a write in (`DocEditStore.historyStepApply`): the new text of every file it has read is accepted and compiled, the states of the blocks follow their lines (the step as line operations, `textChangeOperationListGet`, [the component state layer](doc_page_impl_mdx_comp_state.md#following-the-lines-of-a-document)), and the embedded documents of a written host are read from it again.

## Files

```text
frontend/plugin/doc-edit-history.ts     DocEditHistory: the entries of every document, record, summary,
                                        stepPrepare (the merge) / stepCommit, the bounds; historyMetaNormalize
frontend/plugin/doc-edit-server.ts      records every write of /source/apply; /history, /history/step,
                                        /history/clear; the files of a deletion put back or deleted again
frontend/src/lib/doc-text-merge.ts      lines compared (lineHunkListGet), three texts merged (textMerge3),
                                        the changed lines, a change as line operations; shared
frontend/src/lib/doc-edit-api.js        sourceApply (history), historyGet, historyStep, historyClear
frontend/src/lib/doc-edit-embed.js      embedHistoryHashGet: the identity of the text of an MDX block
frontend/src/store/DocEditStore.ts      operationApply (EditHistoryMeta, historyLabelDerive),
                                        historySummaryByPath, historyStepApply, historyRead, historyClear
frontend/src/store/DocHistoryStore.ts   the place of the author, the scopes, the route 'history', the
                                        component asked first, the step and where it took place
frontend/src/lib/doc-history-reveal.js  the blocks a step changed, scrolled into view and marked
frontend/src/lib/doc-event.js           publish { isAcceptedFirst }: one component takes a delivered undo
frontend/src/store/DocHotkeyStore.ts    the context names editBody and textFocused
comp-doc/api/api-history.js             history/undo, history/redo, history/list, history/clear
comp-doc/edit/DocHistoryButtons.jsx     ↶ / ↷ of a document (toolbar, popup headers)
comp-doc/edit/DocEdit.css               the mark of a step (data-history-mark), the buttons
main/hotkey/default.yaml                mod+z, mod+shift+z, ctrl+y
example_doc/mdx-doc-edit-history.md     the demonstration; DemoCounter: a component with steps of its own
```

Tests: `plugin/doc-edit-history.test.js` (the server's entries, steps, merges, actions of two files, retracts, an MDX block's entry), `src/lib/doc-text-merge.test.js`, `src/lib/doc-edit-history.test.js` (the scopes, the routing, a step taken in).
