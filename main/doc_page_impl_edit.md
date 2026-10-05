<!-- Design of in-place editing. Parent document: doc_page_impl.md. This is the edit-layer design document; other documents link here. -->

# In-place Editing: Design

A document can be edited from the page that displays it, one root-level block at a time, while the local development server is running. Editing is in place: the block is edited where it is displayed, in its own typography, and the page around it does not move; the only things that appear are small floating controls. The edit layer is an additional layer beside the reading page: it has its own store, its own compiled body, and its own components, and it changes nothing in how a document is read. The file on disk stays the only source of truth; the page sends line operations to the development server, the server rewrites the file, and the ordinary reload path (HMR of the `?raw` import) brings the new text back. A built page has no server behind it, so it has no edit mode and shows no edit controls. For the overall architecture, refer to [Document Page: Design](doc_page_impl.md).

```text
browser (edit mode)                              development server (vite)
                                                 plugin/doc-edit-server.ts
DocEditStore                                     GET  {endpoint}/status
  ├─ read source ──────────────────────────────► GET  {endpoint}/source?path=
  │    { text, hash }                            POST {endpoint}/source/apply
  ├─ compile the text with remarkEditBlock         { internalPath, hashBase, operation }
  │    root blocks wrapped: <DocEditBlock i/>       │  hash check, lineOperationApply
  │    block model: lines of every block           ▼  write file
  ├─ session: one block / frontmatter / document file on disk ──► ?raw HMR ──► DocSourceStore
  │    the editor is a registered component          (reading cache; the edit layer
  │    leave = save the draft, cancel = drop it       re-reads directly from the response)
  ├─ insert menu: create a block from a template
  └─ delete: confirmed in place

DocPageView: docEditActiveGet(path) ? <DocEditBody/> : reading body
```

## Availability and mode

The virtual module `virtual:doc-source` exports `docEditEndpoint`: the url of the edit api under the configured `base` during `vite` (`/__doc-edit`), an empty string in a build. The host passes it as `config.edit.endpoint` of `DocPageMdx`. `DocEditStore` asks `{endpoint}/status` once at start; only a positive answer makes `isAvailable` true, and the edit toggle (`DocEditToggle`, in the document toolbar and in the floating navigation) renders only then. A deployed page and an embedded page without an endpoint behave exactly as before this layer existed.

`isEditMode` is one global flag of the page. Switching it off leaves the open session (which saves its draft, see [Sessions](#sessions-leave-and-cancel)). Edit mode applies to documents that are md/mdx files of the collected source (`docIsEditable`); inline side-panel items, component panels, and synthesized source-file pages keep the reading view even in edit mode.

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

`lib/doc-edit-block.js` builds the operations from the model: `blockReplaceOperationBuild`, `frontmatterReplaceOperationBuild`, `blockInsertOperationBuild` (adds the blank lines a new block needs at the top, between two blocks, or at the end), `blockDeleteOperationBuild` (takes the blank lines after the block, or before it for the last block). `lib/doc-edit-api.js` is the small fetch client; a network failure becomes code -1 like any other failure.

## DocEditStore

`DocEditStore` (`store/DocEditStore.ts`) sits beside the reading stores and never writes to them.

- `sourceByPath`: text and hash of a document as read from disk, CRLF normalized for the model.
- `docEditByPath`: the result of the dedicated compile: `Body` with block wrappers, `toc`, frontmatter title and description, and the block model, or the compile error. A newer source is compiled in the background; the previous body stays visible and `docEditIsStale(path)` is true until the new one is ready, so a save never shows a skeleton.
- `session`: the one thing being edited, `{ type: 'block' | 'frontmatter' | 'document', path, blockIndex, isCreated, textInitial, textDraft, draftVersion, status, message }`. `textDraft` is always the text the block would be saved as right now (`sessionDraftSet`); `draftVersion` increases only when code sets the text (`sessionTextSet`: a level control), which tells the uncontrolled editing surface to rewrite its DOM. `isCreated` marks a block that this session created from the insert menu. `status` is `editing`, `submitting` (controls locked), or `error` (message shown, draft kept).
- `insertMenu`: the one border whose insert menu is open, with the status of a creation in progress.
- `deleteConfirm`: the one block whose deletion waits for confirmation, with the border that asked.
- `blockTextPending`: the text of the last saved block until the document is recompiled, so the block shows what was saved instead of the old text meanwhile.

A reaction reads the current document whenever edit mode is on and the document or the manifest changes; navigating to another document leaves the open session first. After a successful apply the response text is accepted directly (`sourceAccept`), so the edit body updates without waiting for HMR; the HMR update that follows finds the same hash and compiles nothing. `sourceAccept` resolves when the body of the new text is compiled, which is what the creation of a block waits for before opening it. When a document's hash changes while a session, a menu, or a confirmation is open and not submitting, they are dropped, because the lines they were about to change moved.

### Sessions: leave and cancel

A session ends in one of two ways, and the distinction is the saving rule of the whole layer:

```text
leave    the draft is saved when it changed, then the session closes
         -> a pointer going down outside the block, clicking another block,
            any button of the borders or of the toolbar, Save, Ctrl/⌘ + Enter,
            switching edit mode off, navigating to another document
cancel   the draft is dropped
         -> Escape, Cancel; a block created from the insert menu is removed again
```

Every edit action (`sessionBlockStart`, `insertMenuOpen`, `deleteConfirmSet`, `sessionFrontmatterStart`, `sessionDocumentStart`, `editModeSet(false)`) first calls `sessionLeave()` and only continues when it succeeded, so a draft is never lost by starting something else. `sessionLeave` is idempotent: a leave already in progress (started by the pointer going down, awaited by the click that follows) is awaited rather than started twice. A failed save (code -2, a network failure) keeps the session open with its message and makes the action that caused the leave a no-op. An unchanged draft closes the session without a request.

When the saved draft changed the number of blocks (a paragraph split in two, lines removed), the block and border indices of the action that caused the leave no longer name the same blocks; such an action is dropped and nothing opens (`sessionLeaveForIndexAction`).

## Page integration

`DocPageView` asks `editStore.docEditActiveGet(path)`; when it returns a state, the page renders `DocEditBody` inside the usual `DocsPage` shell (toolbar, breadcrumb, toc from the edit compile) instead of the reading body. The reading compile result is left alone, and the destination hook receives status `done`, so switching modes keeps the reading position.

Reloading a document from disk is not a navigation request: `DocStore.replaceSourceData` navigates with `isRequestVersionKept`, and `useDocDestinationNavigation` applies a request version once, so a save (or any HMR reload of the current document) keeps the scroll position instead of jumping to the top.

In edit mode the toolbar carries the document-level controls next to the toggle (`DocEditDocControls`: `Frontmatter`, `Source`, re-read, and the updating spinner), and the body is the document as it reads, with one zero-height border between every two blocks:

```text
toolbar:  [Back] [Forward] [Up]   [Editing] [✎ Frontmatter] [Source] [↻]

  ·· border 0 ··  (height 0)
  block 0                      ◄ hover: border 0 and border 1 show their rows
  ·· border 1 ··
  ┌ bar (floating) ──────────────────────────┐
  │ Heading │ H1 H2 H3 H4 H5 H6 │ ✓ Save ✕ Cancel │
  └──────────────────────────────────────────┘
  ## block 1, edited in its place            ◄ the heading source, in heading typography
  ·· border 2 ··
  block 2                      ◄ view mode, as in reading mode
  ·· border 3 ··

border row, shown while the block above, the block below, or the row itself is hovered:
  [↑✎ ↑🗑  +  ↓✎ ↓🗑] ─────────────────────────────  between two blocks
  [+  ↓✎ ↓🗑] ─────────────────────────────────────  above the first block
  [↑✎ ↑🗑  +] ─────────────────────────────────────  below the last block

insert menu, floating below the row after [+]:
  ┌─────────────────────────────────────────────────┐
  │ Text        Paragraph Heading List Quote Code … │
  │ Components  Image StockTable                    │
  └─────────────────────────────────────────────────┘
```

Every wrapper (`DocEditBlock`) draws the border above its block (`DocEditBorder`, `indexBefore` = its own index); the body draws the last border. A border takes no height; its row is positioned over the gap between the two blocks (into the bottom margin of the block above, below the line for the end border) and is hidden unless the block above, the block below, or the row itself is hovered, or its menu or a confirmation is open (sibling selectors in `DocEdit.css`, which rely on the flat order border, block, border, block, … inside `.doc-edit-body`; the rows next to the block being edited stay hidden). The button group is left-aligned: edit above, delete above, insert here, edit below, delete below; buttons of a missing neighbour are left out, which is how the top and end borders lose their irrelevant actions. A delete asks for confirmation in the same row (`Delete the block above? [Delete] [Keep]`), never through a browser dialog, and the block is marked while the question is open. A pointer going down outside the row closes its menu or confirmation.

**Creating a block** is a floating menu, then an ordinary block edit. `[+]` opens `DocEditInsertMenu` below the row: the starting texts of `edit-template.js` (paragraph, heading, list, quote, code, table, comment, and one entry per registered component that declares `editTemplate`). Choosing one writes that text to the file as the new block (`blockCreate`: an `insertLines` operation), waits for the body to compile with it, and opens the new block in edit mode in its place with its text selected, so typing replaces the template. Nothing that belongs to editing is ever inserted into the flow: the new block appears as document content, like any saved change. Escape on such a block removes it again, because canceling a creation leaves the document as it was.

A click anywhere on a block starts its session (`onClickCapture` of the wrapper, so a link inside a block edits the block instead of navigating); the block's own controls (buttons, editable values, form fields) keep working. The store holds one session per page, so starting one leaves the one before it: one block of a document is in edit mode at a time. The wrapper of the block being edited owns the two keys every editor shares (Escape cancels, Ctrl/⌘ + Enter leaves) and the pointer-outside leave (`use-edit-outside-pointer.js`), so an editor never implements them.

Blocks that render nothing visible (an html comment, trailing markers) get a small floating chip with their first source line, so they can be found, edited, and deleted. When the document does not compile, the body shows the error and the `Source` button of the toolbar remains reachable, so a file can be repaired from the page. The editors of the frontmatter and of the whole document float from a zero-height anchor at the top of the body; they have no place in the body, so their surface is inside the panel.

The prose rules of the page remove the top margin of whatever follows an `h2`, `h3`, `h4`, or a rule (`h2 + *`); across the block wrappers that sibling relation is lost, so `DocEdit.css` restates it from the `data-kind` / `data-depth` of the wrapper before. Without this the edit body would be a few pixels taller than the reading body after every heading.

## In-place editing and the no-jitter rule

Entering edit mode, and entering the edit mode of a block, must not move anything on the page: no height is added to the flow for editing's sake, nothing below shifts. The block being edited is edited where it is, and everything that exists only for editing floats. Nothing in the edit layer may break this, and a component that implements its own edit mode must obey it too:

1. **Toggling edit mode adds nothing to the flow.** Borders have no height, their rows float and appear only on hover, document-level controls live in the toolbar, invisible blocks get floating chips. The body in edit mode has exactly the height it has in reading mode (the wrappers restore the prose margin rules for the first and last block and after headings).
2. **A block that is not being edited renders its view mode**, even while the document is in edit mode. The edit layer hands `config.isEdit` only to the block whose session is open; everything else is the reading component with the reading props.
3. **A block is edited in its place, in its own typography.** The in-flow part of an editor is the block itself made editable, and nothing else: a paragraph edits as a `<p>`, a heading as its `<h2>`, with the prose styles of the page, so the author types into the page; a component keeps its render component in the flow and makes the values it displays editable where they are (`EditValueInline`: the image caption in the figcaption, the table title and cells in the table). No additional panel repeats the content of the block. The block's height may follow its content while it is edited, as content does; that is the document changing, not the editing ui.
4. **Every control that exists only for editing floats.** Kind controls, fields the page does not display (the yaml of an image), add/remove buttons, and Save / Cancel go into `EditFloatingPanel`, a compact bar anchored to the block, above it by default, overlapping the content around it. Creating a block floats too: a menu, never a form or a preview in the flow.
5. **Leaving saves, Escape cancels.** An editor does not need its own saving moment; the draft it reports is saved when the session is left (see [Sessions](#sessions-leave-and-cancel)). The block shows its locked surface while the save is pending, and `DocEditStore.blockTextPending` keeps the saved text in the block until the document is recompiled, so the block never flashes back to its old content.

The text editors (`TextBlockEdit`) and `ImageEdit` / `StockTableEdit` are the reference implementations.

## Component edit mode

Editing is a job of the component. The page decides *which* lines are edited and *how* the result is written; the component decides how the author changes it. One chooser, `DocEditBlockEditor`, picks the editor of a session:

- A component block whose registered definition declares `isEditSupported` is rendered through `RegisteredComp` exactly as in the document (placement `commentBlock`, the same `raw`, `lang`, and authored props), with `configRuntime.isEdit = true`. The component sees `config.isEdit` and renders its own editor.
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
                                      isCreated, status, message)
                   block:             the block model entry (undefined for the
                                      frontmatter / document)
                   format:            'md' | 'mdx'
                   label:             what is being edited ("Paragraph", "Image", …)
                   viewRendered:      the block as the body already rendered it
                   isSurfaceFloating: the editor has no place in the body; its
                                      surface goes into the panel (frontmatter, document)
```

and reports through `onEvent`; the edit layer (`editEventHandlerCreate`) turns these into store calls, so an editor never talks to the server:

| event                | data                           | effect                                                                 |
| -------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `editDraftChange`    | `{ text }` or `{ raw, props }` | the current draft, reported on every change; this is what a leave saves. `raw` / `props` are rebuilt into the block text; reported props replace authored props of the same name |
| `editTextSetRequest` | `{ text }`                     | text set by a control; the surface is rewritten                        |
| `editSubmitRequest`  | optional, as `editDraftChange` | Save: leave the session now                                            |
| `editCancelRequest`  |                                | cancel the session                                                     |

While `session.status` is `submitting` the editor locks its controls and shows a spinner in the Save button; on `error` it shows `session.message` and keeps the draft.

Registration options of `compDefine()`:

- `isEditSupported`: the component renders its own editor when `config.isEdit` is true.
- `editTemplate`: `{ lang, raw, props }` of a new block of this component, offered by the insert menu under the author-facing tag name (`componentTemplateTextBuild`).

### Editing primitives

`comp-doc/edit/` exports the pieces a component editor is made of, so editors stay consistent and small:

- `EditFloatingPanel`: the floating bar of an editor: one row with the label, the controls passed as `head`, and the `actions`; optional `children` as a body below the row for fields. Above the block by default, below it when the bar would be out of view or behind a sticky header (`placement`). Pressing its buttons does not take the focus away from the surface.
- `EditSourceSurface`: a block's source made editable in the element of the block's kind (`tag`: `p`, `h1`..`h6`, `div`; `kind` for the typography), plain text, uncontrolled while typing, rewritten only when `textVersion` changes; selects its whole text when `isSelectAll` (a created block). Ctrl/⌘ + Enter submits, Esc cancels, Tab inserts two spaces, pasted text is inserted as plain text.
- `EditValueInline`: a short value edited where it is displayed (a span made editable, underlined by a text decoration so its box is the text's box); Enter or blur commits when changed, Esc restores, Enter during IME composition does nothing, Ctrl/⌘ + Enter is left to the block.
- `EditActions`: Save / Cancel with the pending state and the error message, placed last in the bar's row.
- `use-edit-outside-pointer.js`: the "pointer went down outside" of the layer, used by the block wrapper (leave), the borders (close the menu or confirmation), and the top anchor; it blurs a focused inline value first so its text commits.
- `TextBlockEdit` (in `comp-mdx/text/`): the complete in-place source editor, for components whose edit mode is "edit the source" plus a control or two.

Not every component needs an edit mode; the ones that do not are edited as source through `BlockSource`. `Image` and the demo `StockTable` are the demonstrations: [In-place Editing](../example_doc/edit-in-place.md) in the example documents is the playground page.

## Files

```text
frontend/plugin/doc-edit-lines.ts      line operations, file hash (pure)
frontend/plugin/doc-edit-server.ts     the dev-server middleware
frontend/plugin/doc-source.ts          docEditEndpoint export, middleware registration
frontend/src/lib/doc-edit-block.js     remarkEditBlock, block model, operation builders
frontend/src/lib/doc-edit-api.js       fetch client
frontend/src/store/DocEditStore.ts     availability, mode, sources, edit compiles, sessions
                                       (leave / cancel), insert menu and creation, deletion
frontend/src/DocPageView.jsx           edit branch
comp-doc/edit/                         DocEditToggle, DocEditDocControls, DocEditBody, DocEditBlock,
                                       DocEditBorder, DocEditInsertMenu, DocEditBlockEditor,
                                       edit-template.js, use-edit-outside-pointer.js,
                                       EditFloatingPanel, EditSourceSurface, EditValueInline,
                                       EditActions, DocEdit.css
comp-mdx/text/                         Heading/Paragraph/List/BlockSource (+ XxxEdit, XxxData),
                                       TextBlockEdit, BlockRender (+ BlockRenderStore)
comp-mdx/image/ImageEdit.jsx           component edit mode demonstration (+ ImageEditStore)
example_doc/comp-mdx/StockTableEdit.jsx  host component edit mode demonstration
example_doc/edit-in-place.md           playground document
```
