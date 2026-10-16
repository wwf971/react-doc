<!-- Design of the block popup. Parent document: doc_page_impl.md. This is the block-popup design document; other documents link here. -->

# Block Popup: Design

A component block can be opened in a popup dialog: larger than its place in the page, maximizable to the window, and switchable between **View** and **Edit** in the dialog itself. The page provides this once for every component; a component opts in and supplies only its rendering. ExcelUniver and the example application's StockTable use it.

```text
page (DocPageMdx)                                  document body (reading or edit)
<DocBlockPopup/> ── panelComponent dialog          DocComp ─► RegisteredComp ─► Xxx
   header: [editor bar] [View|Edit] [max] [x]                     │
   content: slot ◄──── element moved ─────────── BlockPopupSurface (config.sourcePath, sourceLine, compId)
        ▲                                                         │ children({ isInPopup })
        │                                                         ▼
DocBlockPopupStore ── mode, editEnter / viewEnter / editCancel ──► DocEditStore (session)
```

## Why the page owns it

The page replaces the subtree a component lives in more often than a reader sees: entering edit mode swaps the reading body for the edit body, and opening a block's session swaps its view renderer for its editor (`DocEditBlock`). A dialog owned by the component would close at each of these. So the dialog, its open state and its maximized state belong to the page (`DocBlockPopupStore`, `DocBlockPopup`), outside the document body; the renderers come and go under it, and whichever renderer of the block is on the page is shown in it. A renderer is not kept alive for the dialog: a replaced renderer is gone, and the new one renders from the block's data as usual.

## Opting in

A component renders itself, in both modes, as the children of `BlockPopupSurface`:

```jsx
<BlockPopupSurface config={config} title={data.title || 'Stock table'} className="not-prose my-2">
  {({ isInPopup }) => (config.isEdit ? <XxxEdit ... isInPopup={isInPopup} /> : <XxxView ... isInPopup={isInPopup} />)}
</BlockPopupSurface>
```

- `config` is the component's config: the block is known from `config.sourcePath`, `config.sourceLine` and `config.compId`.
- `className` is the outer box of the block in the page and carries the block's margins. The component's own root has no outer margins, so it sits flush in the dialog, and in an edit session the geometry lock measures the block from the outer box ([no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)).
- `isInPopup` tells the component to fill the dialog (a height of `100%` instead of its height in the page).

The surface shows an icon button at the top right of the block (on hover or focus) that opens the dialog. It is offered for a comment-marked block of a document (`placement` `commentBlock` with a `sourceLine`) when the host supplies a panel component; elsewhere the surface renders its children in place.

What the component declares beyond that is what it declares anyway: its edit modes ([What a component exposes](doc_page_impl_mdx_comp.md#what-a-component-exposes)), and, when its draft is not complete until it acts, a step that completes it before a save ([The editor contract](doc_page_impl_edit.md#the-editor-contract), `config.edit.submitPrepareSet`).

## Block identity

The popup names its block by **document, marker line and component**: `{sourcePath}#{sourceLine}#{compId}`. `sourceLine` is the line of the block's marker comment in the content without frontmatter; `remarkCommentComp` gives it to `DocComp` (reading body and edit body alike), and the edit model has the same number as `component.markerLine` ([Block model](doc_page_impl_edit.md#block-model)), which the editor of a session passes on. Two references to the same asset, or two blocks with the same data, are different blocks. The block's index in the edit model is found from the marker line when it is needed (entering Edit), so the identity does not depend on the edit model being loaded.

## The element that moves

The surface renders its children once, through a portal, into a container element it creates for itself. While the dialog shows the block, that element is moved into the dialog's content slot; when the dialog closes it moves back (`moveBefore` where the browser has it, so focus and running state survive the move; `appendChild` otherwise). The component is never mounted twice for the move, so an engine keeps its instance, its selection, its undo history and an unsaved draft across opening, maximizing and closing. The surface removes its container when it unmounts.

While the block is in the dialog the page keeps its place: the outer box keeps the height it had when the dialog opened and shows a note. When the dialog closes the focus returns to the button that opened it, without scrolling the page.

More than one surface of a block can exist for a moment (the view renderer and the editor replacing each other); the store shows the one registered last under the block's identity. A dialog without a surface (the body is being recompiled, the block is open in source mode) shows a placeholder.

## View and Edit

The mode is not stored by the popup. It is **Edit** while the edit layer has the block open in one of its component's edit modes (the session's block is the popup's block and its mode is not `source`), **View** otherwise. The switch in the dialog header changes it through the edit layer:

- **Edit**: the document goes into edit mode if it is not, its edit model is loaded (`docEditEnsure`), the block is found by its marker line, and its session opens in the component's default edit mode (`sessionBlockStart`). The editor replaces the view renderer and is shown in the dialog.
- **View**: the session is left, which saves it (`sessionLeave`): the editor's completing step runs first, then the draft is written. A failed save stays in Edit, with the message in the editor's bar.
- The editor's **Save** is the same leave; its **Cancel** drops the session (`sessionCancel`) and clears its message. Both return the dialog to View; neither closes it. The document stays in edit mode.
- **Close** returns the block to the page as it is: an open session stays open there, neither saved nor canceled.

One change of mode runs at a time: while it runs (and while a save runs) the switch and the close button do nothing. A failure to enter Edit (the document cannot be compiled, the block is gone, it has no enabled edit mode) is shown in the header and the dialog stays in View.

Edit is offered only where something can be written: without the edit api (a built page) the switch is not shown; for a document that is not an editable file, an asset that cannot be written (read-only snapshot, locked, a reference pinned to an old version) or a block without an enabled edit mode of its component, Edit is disabled with the reason as its tooltip. Before the edit model is loaded the reason is judged from where the block's data comes from (`assetInfo`); the block's edit modes decide when it is.

## The dialog

`DocBlockPopup` renders the host's panel component ([the panel contract](doc_page_impl.md#component-registry)) with the maximize button on and the block's title. The header holds, before the panel's own buttons, the floating bar of the block's editor (the surface points `DocEditBlockFloatContext` at a slot in the header while the block is in the dialog, so `EditFloatingPanel` renders there with the editor's controls and Save / Cancel), the message of a failed change of mode, and the View / Edit switch.

The dialog belongs to the edit session of its block: it carries `doc-edit-popup`, and while a popup is open the edit body does not leave a session on a pointer going down outside the block, since the page behind the dialog cannot be reached. Escape closes the dialog in View; in Edit the block's editor takes it (Escape cancels the session, Ctrl/⌘ + Enter saves it), and a component's own use of a key (a cell editor's Escape) is never taken from it. Menus the component's engine portals to the body stay above the dialog.

Navigating to another page closes the dialog and drops an Edit entry still in flight.

## Files

- `frontend/src/store/DocBlockPopupStore.ts`: the popup, the surfaces, the mode and its changes.
- `comp-doc/popup/DocBlockPopup.jsx`: the dialog of the page.
- `comp-doc/popup/BlockPopupSurface.jsx`: what a component renders in; `DocBlockPopup.css`.
- `frontend/src/lib/doc-block-popup-store.test.js`: mode, transitions, failures, navigation, surfaces.
