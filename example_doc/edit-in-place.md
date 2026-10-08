---
title: In-place Editing
description: Edit the blocks of this document from the page itself while the development server is running
---

This page is a playground for the edit layer. Open it on the local development server, switch **Edit** on in the toolbar, and change the blocks below; every change is written to `example_doc/edit-in-place.md` and the page picks the new text up from the file without reloading: the scroll position, the part index, and the state of every other component stay as they are. On a built site the toggle does not exist and the page is read-only.

## What edit mode shows

In edit mode the page looks exactly as it reads: nothing moves when the toggle is switched, and hovering a block changes nothing but one small toolbar floating above it, centered, with the block's kind and its buttons:

- edit the block where it is
- open the asset panel (only on a block whose data comes from the [asset store](asset-store.md))
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

By default a block enters edit mode through its edit button, so text can be read and selected as usual. The settings panel (the gear at the top of the sidebar) has `EditBlockEnterMode`; set it to `click` and a click anywhere on a block enters it. The setting lasts for the page session. From inside a paragraph, pressing the down arrow on its last line continues in the next block, and the up arrow on the first line in the previous one; the block left behind is saved.

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

A component declares `isEditSupported` in its registration and renders `XxxEdit` when the page hands it `config.isEdit`. The editor keeps the component in the flow at its usual size, makes the values it displays editable where they are, and floats the rest, so entering edit mode does not move the page. The comment marker and its block are one block to the edit layer, so editing or deleting them never separates the two.

### Image

The caption is edited in the figcaption; the fields the page does not show (src, alt, size, display mode) are in the floating panel below the image.

<!--renderComp=Image-->
```yaml
src: mdx-usage/image/office-worker.svg
alt: An office worker at a desk
caption: Edit this caption where it is
width: 240
height: 160
```

### StockTable

The title, the headers, and the cells are edited in the table; a status cell cycles through the stock states; rows get insert / remove icons. Adding a row or a column is in the floating bar.

<!--renderComp=StockTable,title=Warehouse A-->
```
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #1024 | Wireless Ergonomic Mouse | In Stock |
| #2048 | Mechanical Keyboard (RGB) | Low Stock |
| #4096 | Monitor Arm | Out of Stock |
```

## Components without an editor

Components that do not declare edit support are edited as source, like any other block. The diagram below opens in the plain source editor:

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

Hover this paragraph and use **insert below** in its toolbar to insert a block at the end of the document. A floating menu offers a starting text for the basic blocks and for every component that declares an edit template; the chosen block is written to the file and opened in edit mode right away, with its text selected. Escape removes a block that was just created. Nothing is added to the page until a block is chosen: there is no placeholder at the end of the document.
