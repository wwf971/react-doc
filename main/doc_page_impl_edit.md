<!-- Design of in-place editing. Parent document: doc_page_impl.md. This is the edit-layer design document; other documents link here. -->

# In-place Editing: Design

A document can be edited from the page that displays it, one root-level block at a time, while the local development server is running. Editing is in place: the block is edited where it is displayed, in its own typography, and the page around it does not move; the only things that appear are small floating controls, which come and go without the document looking any different from reading mode. The edit layer is an additional layer beside the reading page: it has its own store, its own compiled body, and its own components, and it changes nothing in how a document is read. The file on disk stays the only source of truth; the page sends line operations to the development server, the server rewrites the file, and the changed document comes back to the page as data (a custom event with the new manifest, the text read over http), never as a replaced module, so nothing in the page reloads ([Saving without a reload](#saving-without-a-reload)). A built page has no server behind it, so it has no edit mode and shows no edit controls (a requirement, see [Availability and mode](#availability-and-mode)). For the overall architecture, refer to [Document Page: Design](doc_page_impl.md); the events of editors and toolbars travel through the [event layer](doc_page_impl_event.md). The labels of the side panel are edited by the same layer, in their yaml file: [Side panel: editing a label](doc_page_impl_side_panel.md#editing-a-label-in-place).

```text
browser (edit mode)                              development server (vite)
                                                 plugin/doc-edit-server.ts
DocEditStore                                     GET  {endpoint}/status
  ├─ read source ──────────────────────────────► GET  {endpoint}/source?path=
  │    { text, hash }                            POST {endpoint}/source/apply
  ├─ compile the text with remarkEditBlock         { internalPath, hashBase, operation }
  │    root blocks wrapped: <DocEditBlock i/>       │  hash check, lineOperationApply
  │    block model: lines of every block           ▼  write file
  ├─ session: one block / frontmatter / document file on disk ──► hotUpdate (plugin/doc-source.ts)
  │    the editor is a registered component          │  "doc-source-change" { configDoc, fileManifest }
  │    leave = save the draft, cancel = drop it       ▼
  │    its events arrive through the event layer   DocSourceStore.replaceSourceData: refreshes the
  ├─ insert menu: create a block from a template    changed paths only (text over GET __doc-source/file)
  ├─ move: swap a block with its neighbor            (the edit layer already accepted the response text)
  ├─ delete: confirmed in place
  └─ every write: operationApply (hash check, accept the new text)

DocPageView: docEditActiveGet(path) ? <DocEditBody/> : reading body
```

## Availability and mode

**A built page has no edit mode and shows no edit control.** This is a requirement of the layer, not a side effect: editing needs a server that owns the files, and a deployed site has none, so nothing of the edit layer may be reachable there, not the toggle, not a toolbar, not a setting that only edit mode honors. It is met at three points:

1. The virtual module `virtual:doc-source` exports `docEditEndpoint`: the url of the edit api under the configured `base` during `vite` (`/__doc-edit`), and the empty string in a build (`plugin/doc-source.ts`). The host passes it as `config.edit.endpoint` of `DocPageMdx`; without an endpoint `DocEditStore` has no api and never leaves `isAvailable = false`.
2. With an endpoint, `DocEditStore` asks `{endpoint}/status` once at start; only a positive answer (`isWritable`) makes `isAvailable` true. A preview of a build served by some other server answers nothing and stays read-only.
3. Everything of the edit layer renders behind `isAvailable`: the edit toggle (`DocEditToggle`, in the document toolbar and in the floating navigation) returns nothing without it, the edit body is never chosen (`docEditActiveGet`), and the settings panel greys out `EditBlockEnterMode` with the reason ([Config: user level](doc_page_impl_config.md#user-level)).

A deployed page and an embedded page without an endpoint therefore behave exactly as before this layer existed.

`isEditMode` is one global flag of the page. Switching it off leaves the open session (which saves its draft, see [Sessions](#sessions-leave-and-cancel)). Edit mode applies to documents that are md/mdx files of the collected source (`docIsEditable`); inline side-panel items, component panels, and synthesized source-file pages keep the reading view even in edit mode.

How a block enters its own edit mode is the config key `EditBlockEnterMode` (page scope, [config keys](doc_page_impl_config.md)): `button`, the default, enters through the Edit button of the block's toolbar only, so reading and selecting text in edit mode works as usual; `click` enters through a click anywhere on the block as well. The reader switches between the two in the settings panel for the page session (`DocEditStore.blockEnterMode` reads the resolved value).

## Block model

A document is a list of root-level blocks: headings, paragraphs, lists, code blocks, tables, quotes, math, html comments, MDX elements, and components. Every block owns a range of source lines, and every edit is expressed at this granularity: replace the lines of one block, insert lines between two blocks, remove the lines of one block.

`remarkEditBlock` (`lib/doc-edit-block.js`) runs first among the remark plugins of a dedicated compile (`config.remarkPluginsFirst`, a slot `compileDoc` applies right after `remarkMath`). It groups the root children of the mdast, wraps every group in an `mdxJsxFlowElement` named `DocEditBlock` carrying `blockIndex`, and reports the groups with their positions. The groups are the blocks; the remaining remark plugins (comment components, links, headings, structure) see the same nodes in the same sibling order inside each wrapper, so the edit body renders as the reading body does.

Grouping follows the degradation-compatible component form ([Graceful degradation](doc_page_impl.md#graceful-degradation-stipulation)): a comment marker binds to the node after it, so `<!--renderComp=Image-->` and its yaml block are one block, never two; a chain of markers (`Anchor`, `MultiLang`, then the heading) is one block of kind `heading`; a paragraph that ends with a marker joins the block after it; markers at the end of a document form a block of kind `marker`. A `MultiLang` or `Anchor` marker before a heading does not turn the heading into a component block, so headings keep their heading editor.

`editDocModelBuild` maps the reported positions onto the complete file: the frontmatter is stripped before parsing, so block lines are shifted by the frontmatter lines. The model is `{ lineList, lineCount, frontmatter?: { lineStart, lineEnd, text }, blockList }`, each block `{ index, kind, nodeType, lineStart, lineEnd, text, depth?, component? }`. A heading block records its `depth`, which the body needs for the prose spacing rules (see [Page integration](#page-integration)). A component block records `compName`, parsed marker `props`, the marked node's `lang` and `raw`, and the pieces needed to rebuild the block text (`textBefore`, `markerText`, `textBetween`, `nodeText`), so a component editor can hand over new `raw` or `props` without knowing how the block was written; the fence grows when a new raw line could close it.

## Edit api and line operations

`plugin/doc-edit-server.ts` adds one connect middleware to the vite development server. Every response is `{ code, data, message }`; `code` 0 is success, negative codes are failures: -1 bad request or unexpected error, -2 the file changed since it was read, -3 the path is not an editable md/mdx file of the current manifest. The manifest bounds what the page may write: the source rules of `config.yaml` decide, nothing else is reachable.

The browser never sends a whole file for a block edit. `plugin/doc-edit-lines.ts` defines the operations, pure functions shared by the server and by tests:

| operation      | effect                                                  |
| -------------- | ------------------------------------------------------- |
| `replaceLines` | lines `lineStart..lineEnd` (1-based, inclusive) → text  |
| `insertLines`  | the lines of text are inserted before line `lineAt`     |
| `deleteLines`  | lines `lineStart..lineEnd` are removed                  |
| `replaceAll`   | the whole file → text (the whole-document session)      |

The text of `replaceLines` / `insertLines` is a list of lines: `"a\n"` is the two lines `a` and an empty one, so the blank line a block needs after itself is expressed exactly. The file's line ending (`\n` or `\r\n`) and its trailing newline are preserved.

Every apply carries `hashBase`, the sha1 of the text the browser edited. A different hash on disk (an editor saved the file meanwhile) is refused with code -2 and the current text, nothing is overwritten; the page reports it and offers to re-read the file.

`lib/doc-edit-block.js` builds the operations from the model: `blockReplaceOperationBuild`, `frontmatterReplaceOperationBuild`, `blockInsertOperationBuild` (adds the blank lines a new block needs at the top, between two blocks, or at the end), `blockDeleteOperationBuild` (takes the blank lines after the block, or before it for the last block), `blockSwapOperationBuild` (one `replaceLines` over two neighbor blocks and the lines between them, in the other order, so moving a block keeps the blank lines that separate the blocks and the line count of the file). `lib/doc-edit-api.js` is the small fetch client; a network failure becomes code -1 like any other failure.

The same middleware answers `POST {endpoint}/side-panel/text`, the one write of the edit layer that is not a document: the label of a side-panel item, rewritten in its yaml file by a line operation built from the parsed yaml ([Side panel: editing a label](doc_page_impl_side_panel.md#editing-a-label-in-place)). Only the side-panel files the configuration loads are reachable (code -3 otherwise), and a label that is no longer the one the edit started from is refused with code -2, like a changed document.

## Saving without a reload

Document text is data of the page, not code. A build still bundles every document as a lazy `?raw` import (one chunk per document), but during development the page never imports a document: the virtual module `virtual:doc-source` carries the manifest metadata only (`fileMetadataBuild`: path, title, tags, config, and a sha256 `contentHash`), and the `load()` of an entry fetches the text from the plugin's source endpoint, `GET {base}/__doc-source/file?path=…`, plain text, `Cache-Control: no-store`, resolved against the collected source only. A document that changes on disk, by a save from the page or by an editor, is reported by the plugin's `hotUpdate` hook (environment api, `order: 'pre'`, so it runs before Tailwind's own hook sees the change) as the custom hmr event `doc-source-change` with the new `configDoc` and `fileManifest`; the hook returns an empty module list, because nothing executable depends on the file. The one exception is a live stylesheet that scanned the document (Tailwind utilities written in the document): the hook reloads such stylesheets itself, so a new utility class takes effect without the page reloading. Configuration changes (`config.yaml`, the source, side-panel and tag files) and files added to or removed from the source still regenerate the manifest and reload the page, through the plugin's own watcher handlers; those are separate from this path on purpose.

In the browser the emitted module keeps its listeners and the latest data across a replacement of itself (`import.meta.hot.data`), so a subscription a host keeps stays valid and a subscriber added later gets the current data at once (`subscribeDocSource` replays `sourceState.current`). `DocPageMdx` hands every event to `DocStore.replaceSourceData`, which navigates with `isRequestVersionKept` (the scroll position stays) and calls `DocSourceStore.replaceSourceData`: it compares the content hashes of the old and new manifests and refreshes only the paths that changed; unchanged paths keep their compiled body, raw text, search data and pending loads, so the part index of another document and every component on the page keep their state. A changed path that is loaded is read and compiled again right away while its previous result stays visible; removed paths lose their caches. Every path carries a version (`versionByPath`), bumped on each change, and a compile or a read accepts its result only when the version it started with is still current, so a slow older result can neither overwrite a newer one nor bring a removed path back. The compiled body is rendered through one stable adapter, `MdxBody` (`lib/MdxBody.jsx`), keyed by the document path: a recompiled document is a new `Body` prop of the same element type, so React updates the tree in place instead of remounting it, and only what the text changed re-renders.

A few directions were tried before this one and are recorded so they are not repeated: filtering the module graph by heuristics (which modules a changed `?raw` import reaches), suppressing `full-reload` messages globally, and patching `location.reload`. All of them passed narrow module-graph tests and still reloaded the page in the live workflow of switching documents and saving repeatedly, because other plugins and orphaned watcher nodes reach Vite's full-reload rule through paths such heuristics do not see. Treating the text as data removes the module from the graph instead of arguing with the graph. `lib/doc-source-hmr.test.js` runs the real middleware and the emitted client code without a listening server.

## DocEditStore

`DocEditStore` (`store/DocEditStore.ts`) sits beside the reading stores and never writes to them.

- `sourceByPath`: text and hash of a document as read from disk, CRLF normalized for the model.
- `docEditByPath`: the result of the dedicated compile: `Body` with block wrappers, `toc`, frontmatter title and description, and the block model, or the compile error. A newer source is compiled in the background; the previous body stays visible and `docEditIsStale(path)` is true until the new one is ready, so a save never shows a skeleton.
- `session`: the one thing being edited, `{ type: 'block' | 'frontmatter' | 'document', path, blockIndex, isCreated, selectionInitial, textInitial, textDraft, draftVersion, status, message }`. `textDraft` is always the text the block would be saved as right now (`sessionDraftSet`); `draftVersion` increases only when code sets the text (`sessionTextSet`: a level control), which tells the uncontrolled editing surface to rewrite its DOM. `isCreated` marks a block that this session created from the insert menu. `selectionInitial` is where the caret is when the surface opens: `end` for an edit started from the toolbar, `all` for a created block (typing replaces the template), `start` or `end` for a block entered by a focus shift from its neighbor. `status` is `editing`, `submitting` (controls locked), or `error` (message shown, draft kept).
- `insertMenu`: the one insert menu that is open: `{ path, borderIndex, blockIndexAnchor, status, message }`, the border the new block goes to and the block whose toolbar shows the menu (`-1` in an empty document).
- `deleteConfirm`: the one block whose deletion waits for confirmation, `{ path, blockIndex, status, message }`.
- `blockMove`: the one block being moved up or down, `{ path, blockIndex, direction, status, message }`, while the swap is written (`submitting`) or after it failed (`error`, the message shown in the toolbar).
- `blockTextPending`: the text of the last saved block until the document is recompiled, so the block shows what was saved instead of the old text meanwhile.
- `sidePanelText` and `sidePanelTextPending`: the one side-panel label being edited, and the label just saved until the new configuration has rebuilt the side panel; see [Side panel: editing a label](doc_page_impl_side_panel.md#editing-a-label-in-place).

A reaction reads the current document whenever edit mode is on and the document or the manifest changes; navigating to another document leaves the open session first.

**Every change of a file goes through one method, `operationApply(path, operation, { messageFailure, onApplied })`.** It sends the operation with the hash of the text it was built on, turns the result into `{ code, data, message }` (a conflict, code -2, gets the standard message), settles the caller's state in `onApplied` as soon as the file is written (the session closes, the confirmation disappears, `blockTextPending` is set) and then accepts the new text (`sourceAccept`), so the edit body updates without waiting for the data event; the `doc-source-change` event that follows carries the same text and compiles nothing new in the edit layer. `sourceAccept` resolves when the body of the new text is compiled, which is what the creation of a block waits for before opening it. Because saving, creating, moving, deleting, and canceling a creation all pass through this one place, a history of the edit layer (undo / redo) is a matter of recording the operation and its inverse there; nothing else in the store or the ui has to change for it. When a document's hash changes while a session, a menu, a confirmation, or a move failure is open and not submitting, they are dropped, because the lines they were about to change moved.

The store is also the handler of the edit domain of the [event layer](doc_page_impl_event.md): `editEventTypeList` names the events it answers, `eventHandle(event)` answers them. The session events are accepted only from the editor of the open session, checked against `event.source.sourcePath` ([the editor contract](#the-editor-contract)); a block event names its block itself through `event.source.sourcePath` and `event.source.blockIndex` (`editBlockMoveRequest { direction: 'up' | 'down' }`, reported by the toolbar); a side-panel label event names its item through `event.source.itemId`. Moving a block is `blockMoveApply`: leave the open session, check that a neighbor exists in that direction, then `operationApply` with `blockSwapOperationBuild`.

### Sessions: leave and cancel

A session ends in one of two ways, and the distinction is the saving rule of the whole layer:

```text
leave    the draft is saved when it changed, then the session closes
         -> a pointer going down outside the block, entering another block
            (its Edit button, a click on it in 'click' mode, a focus shift),
            any button of a toolbar or of the document controls, Save,
            Ctrl/⌘ + Enter, switching edit mode off, navigating to another document
cancel   the draft is dropped
         -> Escape, Cancel; a block created from the insert menu is removed again
```

Every edit action (`sessionBlockStart`, `insertMenuOpen`, `deleteConfirmSet`, `sessionFrontmatterStart`, `sessionDocumentStart`, `editModeSet(false)`) first calls `sessionLeave()` and only continues when it succeeded, so a draft is never lost by starting something else. `sessionLeave` is idempotent: a leave already in progress (started by the pointer going down, awaited by the click that follows) is awaited rather than started twice. A failed save (code -2, a network failure) keeps the session open with its message and makes the action that caused the leave a no-op. An unchanged draft closes the session without a request.

When the saved draft changed the number of blocks (a paragraph split in two, lines removed), the block and border indices of the action that caused the leave no longer name the same blocks; such an action is dropped and nothing opens (`sessionLeaveForIndexAction`).

**Focus shift.** An author moving through a document with the keyboard does not want to reach for the mouse at every block boundary. ArrowDown on the last line of a surface, or ArrowUp on its first line, is reported by the editor as `editFocusShiftRequest { direction: 'next' | 'previous' }`; `sessionFocusShift` leaves the session (saving it) and starts the neighbor block with `selectionInitial` `start` or `end`, so the caret continues where it was heading. At the first or last block the request is rejected and nothing happens. The direction is the whole contract: the editor does not know its neighbors, and the store does not know lines.

## Page integration

`DocPageView` asks `editStore.docEditActiveGet(path)`; when it returns a state, the page renders `DocEditBody` inside the usual `DocsPage` shell (toolbar, breadcrumb, toc from the edit compile) instead of the reading body. The reading compile result is left alone, and the destination hook receives status `done`, so switching modes keeps the reading position.

Reloading a document from disk is not a navigation request: `DocStore.replaceSourceData` navigates with `isRequestVersionKept`, and `useDocDestinationNavigation` applies a request version once, so a save (or any change of the current document on disk) keeps the scroll position instead of jumping to the top.

In edit mode the toolbar carries the document-level controls next to the toggle (`DocEditDocControls`: `Frontmatter`, `Source`, re-read, and the updating spinner), and the body is the document as it reads: every block in a wrapper that owns the floating controls of that block and nothing else.

```text
toolbar:  [Back] [Forward] [Up]   [Editing] [✎ Frontmatter] [Source] [↻]

  block 0                                  ◄ view mode, as in reading mode
                   [Paragraph] [✎] [+↑] [+↓] [˄] [˅] [🗑]   ◄ toolbar of block 1, on hover,
  block 1                                                  floating over the gap above it
            ┌ bar (floating) ──────────────────────────┐
            │ Heading │ H1 H2 H3 H4 H5 H6 │ ✓ Save ✕ Cancel │ ◄ bar of block 2 while it is edited
            └──────────────────────────────────────────┘
  ## block 2, edited in its place          ◄ the heading source, in heading typography
  block 3

scrolled, the top of block 3 out of view:
  ┌ scroll container ────────────────────────────────────┐
  │                 [Table] [✎] [+↑] [+↓] [˄] [˅] [🗑]   │ ◄ the toolbar of block 3 sticks
  │  … the rest of block 3 …                             │   at the top of its visible range
  │  block 4                                             │
```

### Floating controls

Each wrapper (`DocEditBlock`) starts with a zero-height **anchor** (`.doc-edit-block-anchor`), `position: sticky`, and inside it the **floating area** (`.doc-edit-block-float`), absolutely positioned with its bottom on the anchor: whatever is in the area is laid out upward from the top edge of the block, over the gap above it, so it takes no height. The area holds the block's toolbar (`DocEditBlockToolbar`) while the block is not edited, and the bar of the editor (`EditFloatingPanel`, placement `above`, which portals itself into the area through `DocEditBlockFloatContext`) while it is. The anchor sticks below the sticky rows of the layout (`--fd-docs-row-3`) by the height of the area (`--doc-edit-float-height`, kept current by `DocEditBlock` with a layout effect and a `ResizeObserver`) plus a small gap: as long as the top of the block is in view the controls sit above the block; when it scrolls out, they stay at the top of the block's visible range, and they leave with the block's bottom. The area is centered on the block; the insert menu of the toolbar opens below the area, centered as well.

The toolbar is the only hover control of a block: `[Label] [✎ edit] [⟲ asset] [+↑ insert above] [+↓ insert below] [˄ move up] [˅ move down] [🗑 delete]`, with the label naming the kind or the component; the `asset` button is present only on a block whose data comes from the [asset store](doc_page_impl_asset.md#the-frame-and-the-panel) and opens the asset panel of the referenced object. It is hidden, and does not catch the pointer, unless the block is hovered or its insert menu, delete confirmation, or move failure is open (`data-open`); there is no outline, no background, and no other change on hover, so the document looks exactly as it reads until a button is used. The block being edited shows no toolbar, only its bar. A delete asks for confirmation in the toolbar itself (`Delete this block? [Delete] [Keep]`), never through a browser dialog, and the block is tinted while the question is open. A pointer going down outside the toolbar closes its menu, confirmation, or failure message.

**Moving a block** swaps it with the block above or below: one `replaceLines` operation over the two blocks and the lines between them (`blockSwapOperationBuild`), so the blank lines that separate blocks stay where they are and nothing else in the file moves. The up button is greyed out for the first block, the down button for the last one, and both while a write is pending. The toolbar does not call the store: a move is an operation of the document, so the toolbar reports it as an event of the edit domain, `editBlockMoveRequest { direction }` with the document path and the block index as its source, and the [event layer](doc_page_impl_event.md) brings it to `DocEditStore.eventHandle` like a report of a component. The host application therefore sees it first (`component:editBlockMoveRequest`) and could answer it itself. A failure (a conflict, the server gone) is shown beside the buttons, and the toolbar stays open until the pointer goes down elsewhere.

**Creating a block** is a floating menu, then an ordinary block edit. An insert button opens `DocEditInsertMenu` under the floating area, over the top of the block: the starting texts of `edit-template.js` (paragraph, heading, list, quote, code, table, comment, and one entry per registered component that declares `editTemplate`). Choosing one writes that text to the file as the new block at the border the menu was opened for (`blockCreate`: an `insertLines` operation), waits for the body to compile with it, and opens the new block in edit mode in its place with its text selected, so typing replaces the template. Nothing that belongs to creating is ever inserted into the flow, at the end of the document as little as between two blocks: the menu floats, and the new block appears as document content, like any saved change. Escape on such a block removes it again, because canceling a creation leaves the document as it was. An empty document has no toolbar to insert from; its notice carries the insert button (`DocEditEmptyNotice`), the one place where an edit control is in the flow, because there is no content to float over.

**Entering a block** goes through its Edit button, or, when `EditBlockEnterMode` is `click`, through a click anywhere on the block as well (`onClickCapture` of the wrapper, so a link inside a block edits the block instead of navigating; the block's own controls, buttons, editable values, form fields, and the floating controls keep working). The store holds one session per page, so starting one leaves the one before it: one block of a document is in edit mode at a time. The wrapper of the block being edited owns the two keys every editor shares (Escape cancels, Ctrl/⌘ + Enter leaves) and the pointer-outside leave (`use-edit-outside-pointer.js`), so an editor never implements them.

Blocks that render nothing visible (an html comment, trailing markers) get a small floating chip with their first source line, so they can be found, edited, and deleted. When the document does not compile, the body shows the error and the `Source` button of the toolbar remains reachable, so a file can be repaired from the page. The editors of the frontmatter and of the whole document float from a zero-height anchor at the top of the body; they have no place in the body, so their surface is inside the panel.

### Prose spacing across the wrappers

The prose rules of the page (Tailwind typography) remove the outer margins of the first and last child of the body and the top margin of whatever follows an `h2`, `h3`, `h4`, or a rule (`h2 + *`); across the block wrappers those sibling relations are lost, so the page restates them from the `data-first` / `data-last` / `data-kind` / `data-depth` of the wrappers. The restatement must behave exactly as the original rules towards every other rule of the page, or a block that overrides its margin by its own class (a code block's `my-4`, an image figure) gets a different gap in edit mode than in reading mode. The prose rules are the `prose` utility of the typography plugin: they live in the cascade layer `utilities`, have specificity (0,1,0), and exclude `not-prose` content. The restated rules are therefore part of the same utility, written in `frontend/src/style.css` as `@utility prose { & :where(…):not(:where([class~="not-prose"], [class~="not-prose"] *)) { … } }`: Tailwind merges them into the generated `.prose` rules, after the typography rules of the same utility, so they win over those by order and lose to a block's own margin class by layer, exactly as the original rules do. They are not in `DocEdit.css`, because a component stylesheet is imported as a plain file and is never merged into a utility: a rule written there is either unlayered (and wins over the block's own margin class, shrinking the gap under a heading when edit mode is toggled) or in a `@layer utilities` of its own that the page's Tailwind output does not know about. Getting the heights equal is a matter of this cascade position, never of tuning sizes.

## In-place editing and the no-jitter rule

Entering edit mode, and entering the edit mode of a block, must not move anything on the page: no height is added to the flow for editing's sake, nothing below shifts. The block being edited is edited where it is, and everything that exists only for editing floats. Nothing in the edit layer may break this, and a component that implements its own edit mode must obey it too:

1. **Toggling edit mode adds nothing to the flow, and changes nothing visible.** The anchors have no height, toolbars float and appear only on hover, document-level controls live in the toolbar, invisible blocks get floating chips; a block that is not hovered or edited has no outline, no background, no cursor change beyond what its enter mode requires. The body in edit mode has exactly the height it has in reading mode (the wrappers restate the prose margin rules for the first and last block and after headings, in the same cascade position).
2. **A block that is not being edited renders its view mode**, even while the document is in edit mode. The edit layer hands `config.isEdit` only to the block whose session is open; everything else is the reading component with the reading props.
3. **A block is edited in its place, in its own typography.** The in-flow part of an editor is the block itself made editable, and nothing else: a paragraph edits as a `<p>`, a heading as its `<h2>`, with the prose styles of the page, so the author types into the page; a component keeps its render component in the flow and makes the values it displays editable where they are (`EditValueInline`: the image caption in the figcaption, the table title and cells in the table). No additional panel repeats the content of the block.
4. **The block keeps its geometry while it is edited.** The source of a block usually needs more room than the rendered block (`**bold**` and `[link](…)` are longer than what they render, a code block's fences are two more lines), sometimes less (a list as source). Neither may move what is below: the wrapper of the block being edited is locked to the height and the margins the block had in view mode (the **geometry lock**, measured by `DocEditBlock` the moment the session starts, before the editor renders, and set as inline styles with `display: flow-root`), the editor's in-flow root has no outer margins of its own, and it paints the page background. Source that needs more room extends downward over the next block, above it (`z-index`), and is covered up again when the session ends; source that needs less leaves the block at its height. An editor therefore renders exactly one in-flow root (the element the block renders as, or the component's render component), lets the wrapper carry the margins, and does not size itself to its content; a root with a background of its own (the source surface) keeps it. The lock is released when the session ends; the saved block then takes the height of its new content, which is the document changing, not the editing ui.
5. **Every control that exists only for editing floats, for editing and for creating alike.** Kind controls, fields the page does not display (the yaml of an image), add/remove buttons, and Save / Cancel go into `EditFloatingPanel`, a compact bar in the block's floating area, above the block by default, overlapping the content around it and staying at the top of the block's visible range while the block is scrolled. Creating a block floats too, at the end of the document as much as anywhere else: a toolbar on hover and a menu, never a form, a preview, or a placeholder in the flow; the created block enters the flow only as saved document content.
6. **Leaving saves, Escape cancels.** An editor does not need its own saving moment; the draft it reports is saved when the session is left (see [Sessions](#sessions-leave-and-cancel)). The block shows its locked surface while the save is pending, and `DocEditStore.blockTextPending` keeps the saved text in the block until the document is recompiled, so the block never flashes back to its old content.

The text editors (`TextBlockEdit`) and `ImageEdit` / `StockTableEdit` are the reference implementations. What a custom component must do to obey the rule is summarized for component authors in [MDX components](doc_page_impl_mdx_comp.md#text-blocks-and-edit-mode).

## Component edit mode

Editing is a job of the component. The page decides *which* lines are edited and *how* the result is written; the component decides how the author changes it. One chooser, `DocEditBlockEditor`, picks the editor of a session:

- A component block whose registered definition declares `isEditSupported` is rendered through `RegisteredComp` exactly as in the document (placement `commentBlock`, the same `raw`, `lang`, and authored props), with `configRuntime.isEdit = true`. The component sees `config.isEdit` and renders its own editor.
- A component block whose fenced block is in the language `asset` is edited as source whatever its component declares, labeled `Xxx (asset)`: the block holds a reference into the [asset store](doc_page_impl_asset.md#edit-mode), not data, and the reference is what the lines of this document contain. The component's editor would produce a draft that is not lines of this document, so it is not offered; the data is changed through the asset panel, opened with the toolbar's `asset` button, which saves it to the object in place or as a new version, and the component re-renders from `DocAssetStore` without a write to the document. Changing the `versionId` of the reference, or replacing the fence language and writing the data inline, is an ordinary source edit of the block.
- Any other block gets the default editor of its kind: the registered components `Heading`, `Paragraph`, `List`, or `BlockSource` for every other kind (code, table, quote, math, html, MDX, components without edit support). They are built-in names (`compIdBuiltinByName`), placement `edit`, input `data.text`; mapping one of them in `compRegistry` replaces the default editor of that kind.
- The frontmatter and the whole document use `BlockSource` with the surface in the floating panel.

### Naming and sharing

A component `Xxx.jsx` that supports editing has its editor in `XxxEdit.jsx` beside it, and `Xxx` branches on `config.isEdit`:

```jsx
export function Xxx({ data = {}, config = {}, onEvent }) {
  if (config.isEdit) return <XxxEdit data={data} config={config} onEvent={onEvent} />;
  …
}
```

The two files should share their rendering rather than duplicate it: the editor keeps the same render component the reading page uses in the flow and hands it render hooks for the values that become editable (`ImageEdit` renders `ImageRender` with `captionRender`; `StockTableEdit` renders `StockTableView` with `titleRender`, `headerRender`, `cellRender`, `rowActionsRender`), and floats the rest, as the [no-jitter rule](#in-place-editing-and-the-no-jitter-rule) requires. The pure data code (parse and serialize) lives in `XxxData.js` so both directions stay in one place (`StockTableData.js`: `parseMarkdownTable` / `markdownTableBuild`). A draft that the editor changes field by field lives in a small mobx store (`XxxEditStore.js`), not in component state, and every change is reported to the edit layer right away (`editDraftChange`), because the layer saves what it was last told when the session is left.

The default text components follow the same rule. `comp-mdx/text/` holds the render components of headings, paragraphs, and lists that the document body uses (`headingTagCreate`, `ParagraphTag`, `listTagCreate`, mapped by `buildMdxComps`), and beside them `Heading`/`HeadingEdit`, `Paragraph`/`ParagraphEdit`, `List`/`ListEdit`, `BlockSource`/`BlockSourceEdit`. The editors share `TextBlockEdit`: the block's source in the block's place (`EditSourceSurface` with the element of the block's kind) and the floating bar. `HeadingEdit` adds a level control, `ListEdit` a bullets/numbers control; both rewrite the draft through `HeadingData.js` / `ListData.js` and hand it back with `editTextSetRequest`, and the surface of a heading changes to the element of the new level. `BlockRender` (a block's source compiled with the document's configuration) is the view side of these components and shows a just-saved block until the document is recompiled.

### The editor contract

The editor receives, besides the component's usual `data`:

```text
config.isEdit      true
config.edit        { session, block, format, sourcePath, label,
                     viewRendered, isSurfaceFloating }
                   session:           the store session (textDraft, draftVersion,
                                      isCreated, selectionInitial, status, message)
                   block:             the block model entry (undefined for the
                                      frontmatter / document)
                   format:            'md' | 'mdx'
                   label:             what is being edited ("Paragraph", "Image", …)
                   viewRendered:      the block as the body already rendered it
                   isSurfaceFloating: the editor has no place in the body; its
                                      surface goes into the panel (frontmatter, document)
```

and reports through `onEvent`. The reports are events of the edit domain: the [event layer](doc_page_impl_event.md) routes them to `DocEditStore.eventHandle`, which answers with `{ code, data, message }`, so an editor never talks to the store or the server and does not know which block index it is:

| event                   | data                                 | effect                                                                 |
| ----------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `editDraftChange`       | `{ text }` or `{ raw, props }`       | the current draft, reported on every change; this is what a leave saves. `raw` / `props` are rebuilt into the block text; reported props replace authored props of the same name |
| `editTextSetRequest`    | `{ text }`                           | text set by a control; the surface is rewritten                        |
| `editSubmitRequest`     | optional, as `editDraftChange`       | Save: leave the session now                                            |
| `editCancelRequest`     |                                      | cancel the session                                                     |
| `editFocusShiftRequest` | `{ direction: 'previous' \| 'next' }` | the caret left the surface at its first / last line: leave, and open the neighbor block (code -1 at the ends of the document) |

While `session.status` is `submitting` the editor locks its controls and shows a spinner in the Save button; on `error` it shows `session.message` and keeps the draft. The editor of the session is rendered with `configRuntime.blockIndex`, which the event layer carries as `event.source.blockIndex`; the store accepts session events only when `event.source.sourcePath` is the session's document.

Registration options of `compDefine()`:

- `isEditSupported`: the component renders its own editor when `config.isEdit` is true.
- `editTemplate`: `{ lang, raw, props }` of a new block of this component, offered by the insert menu under the author-facing tag name (`componentTemplateTextBuild`).

### Editing primitives

`comp-doc/edit/` exports the pieces a component editor is made of, so editors stay consistent and small:

- `EditFloatingPanel`: the floating bar of an editor: one row with the label, the controls passed as `head`, and the `actions`; optional `children` as a body below the row for fields. With `placement` `above` (default) it portals itself into the floating area of the block, where it stays in view while the block is scrolled; `below` puts it absolutely under the block (`ImageEdit`, whose fields belong under the image). Pressing its buttons does not take the focus away from the surface.
- `EditSourceSurface`: a block's source made editable in the element of the block's kind (`tag`: `p`, `h1`..`h6`, `div`; `kind` for the typography), plain text, uncontrolled while typing, rewritten only when `textVersion` changes. `selectionInitial` places the caret when it opens (`end`, `start`, or `all` selected for a created block). Ctrl/⌘ + Enter submits, Esc cancels, Tab inserts two spaces, pasted text is inserted as plain text; ArrowUp on the first visual line and ArrowDown on the last one call `onFocusShiftRequest(direction)` (the caret rectangle against the content box; the text lines when the browser gives no rectangle).
- `EditValueInline`: a short value edited where it is displayed (a span made editable, underlined by a text decoration so its box is the text's box); Enter or blur commits when changed, Esc restores, Enter during IME composition does nothing, Ctrl/⌘ + Enter is left to the block.
- `EditActions`: Save / Cancel with the pending state and the error message, placed last in the bar's row.
- `use-edit-outside-pointer.js`: the "pointer went down outside" of the layer, used by the block wrapper (leave), the toolbars (close the menu or confirmation), and the top anchor; it blurs a focused inline value first so its text commits.
- `TextBlockEdit` (in `comp-mdx/text/`): the complete in-place source editor, for components whose edit mode is "edit the source" plus a control or two.

Not every component needs an edit mode; the ones that do not are edited as source through `BlockSource`. `Image` and the demo `StockTable` are the demonstrations: [In-place Editing](../example_doc/edit-in-place.md) in the example documents is the playground page.

## Files

```text
frontend/plugin/doc-edit-lines.ts      line operations, file hash (pure)
frontend/plugin/doc-edit-server.ts     the dev-server middleware (documents, side-panel labels)
frontend/plugin/doc-side-panel-text.ts a side-panel label as a line operation of its yaml file (pure)
frontend/plugin/doc-source.ts          docEditEndpoint export, middleware registration, the source
                                       endpoint and the "doc-source-change" data event (hotUpdate)
frontend/src/lib/doc-edit-block.js     remarkEditBlock, block model, operation builders
frontend/src/lib/doc-edit-api.js       fetch client
frontend/src/lib/doc-event.js          the event layer that routes editor and toolbar events here
frontend/src/lib/MdxBody.jsx           the stable adapter every compiled body renders through
frontend/src/lib/doc-source-hmr.test.js the data transport: endpoint, emitted client, caches, labels
frontend/src/store/DocSourceStore.ts   replaceSourceData: selective refresh, versions
frontend/src/store/DocEditStore.ts     availability, mode, sources, edit compiles, operationApply,
                                       sessions (leave / cancel / focus shift), eventHandle,
                                       insert menu and creation, moving, deletion, side-panel labels
frontend/src/style.css                 @utility prose: the margin rules restated for the wrappers
frontend/src/DocPageView.jsx           edit branch
comp-doc/edit/                         DocEditToggle, DocEditDocControls, DocEditBody (+ the
                                       empty-document notice), DocEditBlock (anchor, floating
                                       area, enter mode, geometry lock), DocEditBlockToolbar, DocEditInsertMenu,
                                       DocEditBlockEditor (editor chooser; asset-backed blocks → BlockSource),
                                       DocEditDocContext (doc + floating area
                                       contexts), edit-template.js, use-edit-outside-pointer.js,
                                       EditFloatingPanel, EditSourceSurface, EditValueInline,
                                       EditActions, DocEdit.css
comp-doc/asset/AssetPanel.jsx          the editing of asset data (doc_page_impl_asset.md): the head
                                       text saved in place or as a new version, outside the edit layer
comp-doc/side-panel/SidePanelItem.jsx  the default item label, editable in place (+ SidePanelItemHost)
comp-mdx/text/                         Heading/Paragraph/List/BlockSource (+ XxxEdit, XxxData),
                                       TextBlockEdit, BlockRender (+ BlockRenderStore)
comp-mdx/image/ImageEdit.jsx           component edit mode demonstration (+ ImageEditStore)
example_doc/comp-mdx/StockTableEdit.jsx  host component edit mode demonstration
example_doc/edit-in-place.md           playground document
```
