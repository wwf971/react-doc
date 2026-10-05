---
title: In-place Editing
description: Edit the blocks of this document from the page itself while the development server is running
---

This page is a playground for the edit layer. Open it on the local development server, switch **Edit** on in the toolbar, and change the blocks below; every change is written to `example_doc/edit-in-place.md` and the page reloads from the file. On a built site the toggle does not exist and the page is read-only.

## What edit mode shows

In edit mode the page looks exactly as it reads: nothing moves when the toggle is switched. Click a block to edit it where it is; only one block is in edit mode at a time. Leaving the block in any way that is not canceling saves it: click somewhere else, click another block, press Ctrl/⌘ + Enter, or use **Save** in the small bar floating above the block. Escape or **Cancel** abandons the change. Hovering a block shows a button group above it and one below it, left-aligned:

- edit the block above, delete the block above
- insert a new block here
- edit the block below, delete the block below

The group above the first block and the one below the last block only carry the buttons that make sense there. Deleting asks for confirmation in the same row. The toolbar buttons **Frontmatter** and **Source** edit the frontmatter as one piece and the whole source file.

## Default editors

Blocks without a component of their own are edited as source, in their own place and typography: this heading is edited as a heading, a paragraph as a paragraph, a code block in a monospace area. A few kinds add a control to the floating bar: this heading offers its level, the list below offers bullets or numbers.

1. the first item of an ordered list
2. the second item, with `inline code`
3. the third item

A paragraph with **bold**, _emphasis_, and a [link to the writing style page](mdx-usage/writing-style.md). Click it: the source replaces the text in the same place, and clicking elsewhere saves it.

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

## Insert at the end

Hover this paragraph and use the `+` of the group below it to insert a block at the end of the document. A floating menu offers a starting text for the basic blocks and for every component that declares an edit template; the chosen block is written to the file and opened in edit mode right away, with its text selected. Escape removes a block that was just created.
