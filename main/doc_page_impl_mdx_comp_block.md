<!-- Guidance for block-like MDX components. Parent document: doc_page_impl_mdx_comp.md. Read this before implementing or changing a component that takes a box of its own in the document (a canvas, a sheet, an image, a table, a dashboard). -->

# Block-like MDX Components: What They Must and Should Do

A **block-like component** is one that occupies a box of its own in the document and lets the reader do something inside that box: a diagram on a canvas, a spreadsheet, an image, a wide table, a dashboard. Readers expect the same things from every such box, whatever it holds, and the page already provides most of them once. This document lists them, so a new component of this kind (or a change to one) starts from the same expectations. `DiagramER`, `DiagramDataverseEntity`, `ExcelUniver` and the demo `StockTable` are the reference implementations; `Image` has its own pan-and-zoom view.

```text
                   view mode                              edit mode
  ┌ outer box (BlockPopupSurface, margins) ──────────────────────────────────────┐
  │ [⤢ open in popup]                                                           │
  │ ┌ the component's root, no margins ───────────────────────────────────────┐ │
  │ │  pan / zoom / select text  ·  nothing is written      cells, rows, lines │ │
  │ │                                                      edited in place     │ │
  │ └─────────────────────────────────────────────────────────────────────────┘ │
  └──────────────────────────────────────────────────────────────────────────────┘
     floating bar above the block (EditFloatingPanel)     edit card beside the selection
```

## Must: the popup

Every block-like component renders both of its modes as the children of `BlockPopupSurface` ([Block popup](doc_page_impl_popup.md#opting-in)), so the block can be opened in the popup, maximized to the window, and switched between **View** and **Edit** there without the component doing anything for it:

- The surface's `className` is the **outer box** and carries the block's margins (`margin: 1rem 0 1.5rem` or whatever the block needs). The component's own root has **no outer margins**, so it sits flush in the popup and the geometry lock of an edit session measures the block from the outer box. This is also what keeps the page from moving when the block enters edit mode ([the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)): a margin on the editor's root inside the locked wrapper would push the content down by that margin.
- `isInPopup` tells the component to fill the dialog: the root gets height `100%` (a flex column with `flex: 1 1 auto; min-height: 0` when the editor wraps it) instead of its height in the page; a fixed width becomes `100%`.
- The engine or canvas is **not remounted** for the popup: the surface moves the element, so the camera, the selection and an unsaved draft survive opening, maximizing and closing. Keep every such state in the component's own store or in the [component state service layer](doc_page_impl_mdx_comp_state.md), never in a place that a remount would lose.
- The surface draws its open button at the top right of the outer box; a toolbar of the component's own keeps clear of that corner.

## Must: view mode changes nothing and moves nothing

- Whatever the reader does inside the box (pan, zoom, scroll a sheet, select cells or text, hover) **never writes the document**; what is remembered (a camera, a selected range) is remembered for the block while the page is open and is dropped with it.
- The reader **cannot move or edit the content**: a node of a diagram is not draggable, a cell of a sheet is read-only. Positions and values are part of the document and change only in an edit session. Text in the box stays selectable where it is text.
- **The wheel belongs to the box.** When the box consumes the wheel (a canvas zooms, a sheet scrolls), it consumes it everywhere inside the box, including over a card, a node or a cell, and the page behind never scrolls as a side effect; when the box does not consume it, the page scrolls as usual. A sub-area that opts out of the box's wheel handling (a `nowheel` region) must scroll itself, or it will scroll the page.
- A click in the box does not enter edit mode even when the document's enter mode is `click` (`meta.isEditEnterButtonOnly`): the box takes clicks itself, so entering is the Edit button, the mode menu, or **Edit** in the popup.

## Must: edit mode in place

The edit mode of a block-like component obeys the [editor contract](doc_page_impl_edit.md#the-editor-contract) and the [no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule) like every other editor, and these points matter most for a box:

- **Entering moves nothing:** the block keeps its height and its place, the camera of a canvas stays, and the page's scroll position does not change. Verify both (measure the block's top and the scroll container's `scrollTop` before and after entering) before reporting an edit mode done.
- **The same renderer in both modes.** The editor renders the view component and hands it an `editor` object that makes values editable where they are displayed (a cell is typed in place, in the same grid, so nothing resizes), instead of a second rendering of the content.
- **Everything that exists only for editing floats:** the bar with Save / Cancel and the editor's controls goes into `EditFloatingPanel`; the settings of what is selected go into a popup beside it (an **edit card**, marked `doc-edit-popup` so a click in it is not a click outside the editor). Nothing is added to the flow.
- **Leaving saves, Escape steps out.** The draft is reported on every change (`editDraftChange`); a leave saves it. A box with selections consumes Escape for its own steps (a cell, then the selection) and never ends the session with it; Cancel is the explicit way out and says so (`EditActions titleCancel`).
- **A refused change says why** (the validation message in the edit card or the bar) and leaves the draft as it was.

## Should: interaction patterns of a canvas

For a component whose box is a canvas of things (nodes and lines, shapes, images), these patterns are what readers of design and engineering tools expect; implement the ones that apply, in this form:

- **Dragging pans, the wheel zooms around the pointer**, with controls for zoom in / out / fit; the camera is kept for the block.
- **Selection is one model for everything on the canvas:** a node, a part of it (a row, a cell), and a line are selected the same way, show the same kind of highlight, and open the same kind of edit card with the tabs that apply (a tab without a subject greyed out). A line is selected by clicking near its path or on its label. The focus is one state, a **path** into the principal (the node, or the line by itself), and the tabs, the views and the highlights are read off it, so a highlight can never be stale and a thing that disappears redirects the path to its list; the edit card shows the path under its tabs, and a segment of it is a place to go back to.
- **Everything in the box answers a click.** In edit mode every part of a thing takes the focus when clicked and shows it, whether or not it can be changed: a head field, a description line, a fixed column header, a cell that is read-only. A button an item does not support is greyed out, never missing, and its title says why. A click that does nothing visible reads as a broken editor.
- **The edit card stands beside the principal and keeps its top edge.** It is anchored to the whole node or the line, never to the row or cell within it, so moving the focus inside a card does not move the card; and its top edge is computed from the anchor alone, never from the card's own height, so a change of its content (a setting that adds rows, a tab that changes the view) grows or shrinks it downward only, with the overflow scrolling inside it. Nothing the author does in the card moves the card.
- **Direct manipulation of structure on the thing itself:** a focused row or column shows a small toolbar (the control group of the edit layer, `.doc-button-group`) with a grip to drag it among its siblings, insert before / after, move, remove; the list in the edit card offers the same with a drag handle and a remove button before each item.
- **Direct manipulation over menus:** a value is typed where it is shown; a line is drawn by dragging from a handle and moved by dragging its end; a thing is created by double-clicking where it should go (a create panel with a search, like the insert menu of a block); a handle is added at the edge of the row that should have it. The edit card holds what has no place on the canvas (styles, policies, insert / move / remove).
- **Gestures hide the edit card** while they last and bring it back when they end; a drag never opens a card.
- **A drag is validated while it lasts:** the line being drawn shows whether its target will take it, and releasing on an invalid target does nothing.
- **Nothing is discarded silently:** removing a thing that others depend on (a handle with lines, a row with handles, a node with lines) reroutes or detaches them and keeps them visible (a free end), rather than refusing or deleting the dependents.
- **Keyboard:** Escape steps out, Enter confirms a cell, Ctrl/⌘ + Enter saves, ArrowUp / ArrowDown and Enter in a search list.

`DiagramER` implements all of these; its rules are written out for authors in [Data diagrams](../example_doc/mdx-usage/comp-diagram-er.md#diagram-er-view) and for implementers in [comp_db_vis.md](../built-in/comp-mdx/diagram/diagram-er/comp_db_vis.md#card-editing).

## Should: switching view and edit while open

A component that can be read and edited in the popup lets the reader switch between the two there. This is given by the popup once the component exposes its edit modes; what the component must do is keep its instance across the switch (no remount of an engine when `config.isEdit` changes, when it can be avoided) and start its editor from the data as saved, not from uncommitted reading interactions.

## Checklist

Before reporting a block-like component done, check each line:

| | Check |
| --- | --- |
| ☐ | Both modes render inside `BlockPopupSurface`; the surface's class carries the margins; the root has none |
| ☐ | In the popup the component fills the dialog (`isInPopup`), and its state survives open / maximize / close |
| ☐ | View mode: nothing writes; content is not movable or editable; text is selectable; the wheel over any part of the box behaves like the wheel over the box itself and never scrolls the page |
| ☐ | `meta.isEditEnterButtonOnly` when the box takes clicks |
| ☐ | Entering edit mode: block height, block top, camera, and the scroll container's `scrollTop` are unchanged (measured, not assumed) |
| ☐ | Values are edited in place in the same layout; the bar floats; the edit card is a `doc-edit-popup` beside the selection and hides during gestures |
| ☐ | Escape steps out and never cancels the session; Cancel says so; Ctrl/⌘ + Enter saves |
| ☐ | A refused change shows its reason and keeps the draft |
| ☐ | Every part of the box answers a click with a visible focus; unsupported actions are greyed out with their reason, not missing |
| ☐ | The edit card is anchored to the principal (node or line) and its top edge does not move when its content changes (measured) |
| ☐ | The rules of the component are written in its usage document, organized by reading and editing, and demonstrated in `example_doc/` |
