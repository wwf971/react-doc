---
title: In-place Editing
description: Edit the blocks of this document from the page itself while the development server is running
---

This page is a playground for the edit layer. Open it on the local development server, switch **Edit** on in the toolbar, and change the blocks below; every change is written to `example_doc/edit-in-place.md` and the page picks the new text up from the file without reloading: the scroll position, the part index, and the state of every other component stay as they are. On a built site the toggle does not exist and the page is read-only.

## What edit mode shows

In edit mode the page looks exactly as it reads: nothing moves when the toggle is switched, and hovering a block changes nothing but one small toolbar floating above it, centered, with the block's kind and its buttons:

- choose a view mode or an edit mode of the block (only on a component block that has modes to choose from; see [View modes and edit modes](#view-modes-and-edit-modes))
- edit the block where it is
- open the asset panel (only on a block whose data comes from the [asset store](asset-store.md)), or move the block's inline data into the store (only on a component block with a data block)
- insert a new block above it
- insert a new block below it
- move the block up, swapping it with the block above
- move the block down, swapping it with the block below
- delete the block

When the top of a long block is scrolled away, the toolbar stays at the top of what is visible of it. Only one block is in edit mode at a time. Leaving the block in any way that is not canceling saves it: click somewhere else, enter another block, press Ctrl/⌘ + Enter, or use **Save** in the small bar floating above the block. Escape or **Cancel** abandons the change. Deleting asks for confirmation in the same toolbar. The toolbar buttons **Frontmatter** and **Source** edit the frontmatter as one piece and the whole source file.

The move buttons are greyed out where there is nothing to swap with: up on the first block of the document, down on the last one. Try them on the three short paragraphs below; the blank line between two blocks stays where it is, only the blocks change places.

First of three short paragraphs.

Second of three short paragraphs.

Third of three short paragraphs.

## Side-panel labels

Edit mode also reaches the side panel. Hover an item of the sidebar and a small pencil appears after its label; click it and the label becomes editable in its place: type, then press Enter or click elsewhere to save, Escape to drop the change. The new text is written into the yaml file the item comes from (`example_doc/side-panel.yaml`, or `mdx-usage/side-panel.yaml` for the items of the MDX Components folder), only on the line of that label: comments, order, and everything else in the file stay as they are, and the side panel updates without a reload. A document item whose label is its title (this page's own item, for example) gets a `text:` line added below its `doc:` line. The item of this page in the sidebar, `In-place Editing`, is a good one to try, as is the separator `Tests` and the two-language label of the `Component Panel` item below it, whose displayed translation is the one that is edited. Items generated from a source folder have no line to write and show no pencil.

## Entering a block and where the caret goes

By default a click anywhere on a block enters it, and the caret lands on the source text nearest to where you clicked, so a word in the middle of a paragraph is reached in one click; the edit button of the toolbar enters the block too, with the caret at the end. The settings panel (the gear at the top of the sidebar, tab **Config**) has `EditBlockEnterMode`; set it to `button` and only the edit button enters a block, so text can be read and selected as usual. The setting lasts for the page session. From inside a paragraph, pressing the down arrow on its last line continues in the next block, and the up arrow on the first line in the previous one; the caret keeps its column, and the block left behind is saved. Try it on the three short paragraphs above: click into the middle of one, then arrow down through the others.

## Default editors

Blocks without a component of their own are edited as source, in their own place and typography: this heading is edited as a heading, a paragraph as a paragraph, a code block in a monospace area. The block keeps the height it has when read: source that needs more lines than the rendered block extends over the block below, and the page does not move; the code block below shows it, its fences are two more lines. A few kinds add a control to the floating bar: this heading offers its level, the list below offers bullets or numbers.

1. the first item of an ordered list
2. the second item, with `inline code`
3. the third item

A paragraph with **bold**, _emphasis_, and a [link to the writing style page](mdx-usage/writing-style.md). Enter it: the source replaces the text in the same place, and clicking elsewhere saves it.

> A quote block, a table, or a code block falls back to the plain source editor.

```js
function greet(name) {
  return `hello ${name}`;
}
```

## Components with their own editor

A component exposes the edit modes of its editor in its registration (`expose.editModeList`) and renders `XxxEdit` when the page hands it `config.isEdit`. The editor keeps the component in the flow at its usual size, makes the values it displays editable where they are, and floats the rest, so entering edit mode does not move the page. The comment marker and its block are one block to the edit layer, so editing or deleting them never separates the two. Every such block also keeps the plain source editor as a second edit mode, **Source**, one entry away in the mode menu.

### Image

The edit mode **Fields** is the default: the caption is edited in the figcaption; the fields the page does not show (src, alt, size, display mode) are in the floating panel below the image. A paste over the image replaces it.

<!--renderComp=Image-->
```yaml
src: mdx-usage/image/office-worker.svg
alt: An office worker at a desk
caption: Edit this caption where it is
width: 240
height: 160
```

### ImageGrid

The edit mode **Images** is the default: a click on the grid keeps the grid as it is and makes its slots take pastes, so filling a grid is pasting into one slot after another; a slot shows a remove icon on hover, and **Add image** in the floating bar appends an empty slot. The gap and the slot width are in the same bar. The yaml of the grid is not shown in this mode; choose **Source** in the mode menu to see or edit it.

<!--renderComp=ImageGrid-->
```yaml
itemWidth: 200
gap: 12
images:
  - src: mdx-usage/image/robot-computer.svg
    alt: A robot at a computer
    caption: Paste over a slot to replace it
    height: 150
  - src:
    caption: an empty slot
    height: 150
```

### StockTable

The edit mode **Cells** is the default: the title, the headers, and the cells are edited in the table; a status cell cycles through the stock states; rows get insert / remove icons. Adding a row or a column is in the floating bar.

<!--renderComp=StockTable,title=Warehouse A-->
```
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #1024 | Wireless Ergonomic Mouse | In Stock |
| #2048 | Mechanical Keyboard (RGB) | Low Stock |
| #4096 | Monitor Arm | Out of Stock |
```

## View modes and edit modes

A component can expose several ways of displaying its data (view modes) and several ways of editing it (edit modes). Where there is something to choose, the toolbar of the block shows a **modes** button next to the block's label, and so does the bar of its editor; it opens a menu with the view modes first and the edit modes after them, the current and the default ones marked:

```text
VIEW MODE
  Table     [current, default]
  Summary
EDIT MODE
  Cells     [default]
  Source    [built-in]
```

Choosing a view mode re-renders the block at once; the choice lasts for the page session and is not written to the file. Choosing an edit mode opens the block in it; choosing another while the block is open saves it and opens it again in the new mode. The `StockTable` below has two view modes: **Table**, and **Summary**, which counts the rows by their status. Switch it to Summary, then open the mode menu again and choose **Cells**: the editor is the table, whatever the view mode, and the block returns to Summary when the editor closes.

<!--renderComp=StockTable,title=Warehouse D-->
```
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #1101 | Standing Desk | In Stock |
| #1102 | Desk Lamp | In Stock |
| #1103 | Cable Tray | Low Stock |
| #1104 | Footrest | Out of Stock |
```

Edit modes are greyed out when they cannot be chosen now: while a save is pending, or on a block whose data is an asset, where only **Source** can be chosen ([below](#components-backed-by-the-asset-store)). The **Source** mode is built in and belongs to every block whose component does not refuse it; a component that has no editor of its own has only this mode, and shows no modes button.

### Read-only components

A component that displays what the page knows, and has no data of its own to change, declares itself read-only. Its block has no edit mode: the Edit button is greyed out, a click does not enter it, and the mode menu, when there is one, says so. The tag list below is such a component (it renders every tag of this page); it can still be moved, deleted, or have a block inserted around it.

<!--renderComp=TagListAllDemo-->

## Components without an editor

Components that expose no edit mode are edited as source, like any other block. The diagram below opens in the plain source editor:

<!--renderComp=DiagramText-->
```
+---------+      +---------+
|  page   | ---> |  file   |
+---------+      +---------+
```

## Components backed by the asset store

A component block whose code block is written in the language `asset` holds a reference into the asset store instead of its data (see [Asset Store](asset-store.md)). In edit mode such a block is edited as source, whatever its component declares: the block is the reference, and the editor shows the reference, labeled `Image (asset)`. The data belongs to the object and is changed through the asset panel, opened with the **asset** button that the toolbar of such a block shows next to Edit; the panel saves the head text in place or as a new version.

<!--renderComp=Image-->
```asset
objectId: w4laejhlzjh
```

## Insert at the end

Hover this paragraph and use **insert below** in its toolbar to insert a block at the end of the document. A floating menu offers a starting text for the basic blocks and for every component that exposes an edit template, each with the component's icon; the chosen block is written to the file and opened in its default edit mode right away, with its text selected. Escape removes a block that was just created. Nothing is added to the page until a block is chosen: there is no placeholder at the end of the document.
