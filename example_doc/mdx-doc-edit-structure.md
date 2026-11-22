---
title: Editing the Structure of a Document
description: Select, move and re-level blocks and list items in edit mode, and edit the items of a list one by one
---

Editing a document from the page is of two kinds. A **content edit** changes what one thing says: the text of a paragraph, the text of one list item. A **structural edit** changes which blocks and list items exist, their order, and how the items of a list are nested. This page is the playground of the second kind, and of lists, whose items are edited one by one. Open it on the local development server and switch **Edit** on; every change is written to `example_doc/mdx-doc-edit-structure.md`. [MDX Document In-place Editing](mdx-doc-edit-in-place.md) is the playground of content edits.

<!--renderComp=DiagramText-->
```text
          content edit                       structural edit
          what one thing says                which things exist, their order, their levels

pointer   click: opens it                    Shift + click: selects it
          type into it                       Shift + drag: moves it
toolbar   ✎                                  ⠿ grip (click: select, drag: move), + ↑ ↓, 🗑
keys      type; Ctrl/⌘ + Enter: save         in an item: Enter splits it, Backspace joins it
          Shift + Enter: a line break        selected: Tab, Shift + Tab, Alt + ↑ ↓, Delete
```

## The items of a list

Hover an item of the list below: a small toolbar appears right after its text, like the toolbar of a block (an item whose first line is long has it at the right end of that line). Click an item: its own text opens for editing where it stands, without its marker and its indentation, and nothing on the page moves. Click outside, or press Ctrl/⌘ + Enter, to save; Escape drops the change.

- fruit
  - apple
    - fuji
    - gala
  - pear
- bread
  - rye
  - wheat
- cheese

In a list a line is an item, so the keys of the editor of an item are the keys of an outline. Things to try:

1. Put the caret in the middle of `apple` and press **Enter**: the item is split there. The new item below takes the text after the caret and what was under `apple`, and you go on typing at its start.
2. Press **Enter** at the end of `pear`: a new item without text opens below. At the end of an item that has sub-items, such as `fruit`, the new item is the first of them. Type a word and press Enter again, as fast as you like: nothing typed is lost while the list is written. Press **Enter** in an item without text: it goes one level up, and at the first level it is taken out, which is the way out of a list. A new item left without a text is gone again.
3. Press **Backspace** at the start of an item: it joins the row above, the caret where the two texts meet. **Delete** at the end of an item joins the row below to it.
4. Press **Tab**: the item goes one level deeper, under the item before it, and the caret stays where it was. **Shift + Tab** takes it one level up. The lines of the list keep their distance at every level.
5. Press **←** at the start or **→** at the end of the text: the caret goes on in the row above or below. **↑** and **↓** do the same from the first and the last line, and from the first or last item they go on to the block beside the list.

The whole list as its source is still one click away: the **Edit** button of the toolbar above the list (the toolbar of the block, labelled `List`).

## Line breaks in an item

**Shift + Enter** is a line break. A list item of Markdown is one paragraph, whose line breaks are not kept, so the item becomes a **text block**: a fenced block of language `text` that holds the lines as they were typed. The page writes the fences; you edit the lines inside, over the block as it is rendered. The block grows and shrinks with the lines you type, and the items below it move with it.

In a text block **Shift + Enter** is one more line, and **Enter** splits the block like any item: the lines after the caret go into a new item below. A part that still has line breaks is a text block, a part of one line is a plain item. **Backspace** at the start of the item below joins it back.

- a name and an address
  - ```text
    Example Trading Co.
    1 Harbor Street
    Springfield
    ```
  - an item of one line: press Shift + Enter in it, and again
  - ```text view=card
    the same kind of item, drawn as a card:
    view=card in the info of its fence
    ```
  - ```text view=icon title="delivery notes"
    Leave the parcel at the side door.
    Ring twice; the bell is quiet.
    Signature not needed.
    ```
  - run the weekly query
    ```sql view=icon title="weekly query"
    select customer, sum(amount) as total
    from orders
    group by customer
    ```
    then send the result with
    ```sh view=icon
    mail -s "weekly" team@example.com < result.csv
    ```
  - a card among text: the lines of the query
    ```sql view=card
    select customer from orders
    ```
    stand on lines of their own, between the text before and after them

A code block that is a list item is drawn in the view **plain**: a quiet frame around lines that stand where the lines of plain text would, so the list keeps its rhythm. A block of language `text` is set in the font of the text around it and wraps like text; code keeps the code font. The other view, **card**, is the code block as it stands between paragraphs. The third view, **icon**, keeps the lines out of the way: the block is a square tile with its title (or its language), and a click on it opens the lines in a code editor in a dialog, with line numbers and the words colored by their language; try *delivery notes* above. The dialog shows the lines in **View**, and in **Edit** they can be changed, and their language chosen from a list or typed, then saved (Save in its header, or Ctrl/⌘ + S) wherever the page can write, from reading mode too; it opens in Edit when the document is in edit mode, and a save goes back to View. An author chooses per block with `view=plain`, `view=card` or `view=icon` in the info of the fence; the defaults are the config keys `CodeBlockViewAsListItem` (a block that is a list item) and `CodeBlockView` (any other block).

No block has to be a list item of its own: *run the weekly query* holds text and two icons, which stand in the line of the item, their bottom edge on the bottom edge of the line (the doc-scope key `CodeBlockIconAlign` puts their top edge at the top instead). A code block of another view takes a line of its own, as in the item after it, without being the whole item. In edit mode a click on the text opens the item, and each code block is one thing of its text, a chip where the block was: type before, between and after the chips; ← and → step over a chip; Backspace next to one selects it, and deletes it when pressed again (Ctrl/⌘ + Z brings it back); Enter splits the item between them, and Backspace at the start of the next item joins it back. A double click on the chip of an icon opens its lines in its dialog; the lines of a block of another view are edited where they are drawn, after a click on them (or a double click on the chip). Shift + Enter in the text among chips makes the text at the caret a text block of its own, and you go on typing its lines. On save every chip is written as its fenced block again, on lines of its own.

Any code block can be turned into text, its lines joined into one line with the line breaks removed: **To text** in the mode menu of a code block (the sliders button of its toolbar), in the list menu of an item that is a code block, and in the bar while an item is edited, for the lines being edited or a chip selected with a click. The bar also has the buttons of a new item above and below the item being edited.

In edit mode the view is also chosen from the page: the list menu of an item that is a code block starts with a **Code block** group (**Card**, **Plain**, **Icon**, **By config**), and a code block between paragraphs has the same views in the mode menu of its toolbar (the sliders button). The choice is written into the info of the fence, as if typed. The toolbar of a code block, between paragraphs or a list item, has its `to asset` button, and the dialog of an icon has **To asset** in its header, which is how an icon in the text of an item gets there: the lines move into an item of the asset service layer, and the block becomes a block of `Code` that reads them from there and looks as it did. In the same place it then has the **asset** button (**Asset** in the dialog), which opens the item's asset panel with its versions. Try the views on a copy in the [Playground](playground/playground.md), which git ignores, rather than here.

A block under the text of an item, like the command of a step, is a block of its own and stays a card:

1. run the tests:
   ```bash
   npm test
   ```
2. read what they say

## The toolbar of an item

The buttons of the toolbar of an item, from the left: the grip, edit, a new item above, a new item below, the list menu, delete. The list menu holds the operations of the list:

- **Deeper** and **Up** change the level of the item. An item with sub-items can go deeper alone, its sub-items keeping their level, or with them. A change of level moves no line up or down: try **Up** on `apple` above, and `pear`, which came after it, comes under it.
- **Move up** and **Move down** swap the item with its neighbor in its list, with what is under it.
- **New sub-item** adds an item under this one.
- **Bullets** and **Numbers** change the markers of the list the item is in; its nested lists stay as they are.

Deleting an item asks in the toolbar itself. An item with sub-items offers two ways: with them, or alone, and then its sub-items take its place one level up.

An entry that cannot be chosen is greyed out and says why on hover: the first item of a list has no item before it to go under.

## Selecting

Hold **Shift** and click `fuji` in the list above. The item is selected: a frame around it, its toolbar pinned beside its text (above the frame, for an item whose line is long), and no other toolbar on the page shows, wherever the pointer is. Shift + click it again and the selection grows: the item above with what is under it, then the item above that, then the whole list, and then it starts over at `fuji`. An item with sub-items has one more step between the first two: itself with what is under it.

The pinned toolbar says what is selected (`Item`, `Item only`, `Item with 2 sub-items`), and its buttons act on exactly that. The same without a key: a click on the grip of any toolbar selects its thing.

While something is selected, the keyboard acts on it:

| Key | Effect |
| --- | --- |
| Tab, Shift + Tab | the selected item one level deeper, one level up |
| Alt + ↑, Alt + ↓ | the selected item or block swapped with its neighbor |
| Enter | its content opened for editing |
| Delete | its deletion asked in the toolbar |
| Escape | the selection ended |

A click anywhere else ends the selection. Shift + click on a paragraph or a heading selects it as a block, with the toolbar of the block pinned.

## Dragging

Hold **Shift**, press on an item, and drag; or drag the grip of its toolbar, which needs no key. The item stays where it is, dimmed, until it is dropped; a line shows the gap it would go to, and a chip at the pointer says what is dragged.

- A drag straight down or up reorders: the item keeps the level it has.
- A drag that drifts to the right nests: the left end of the line moves one level deeper for every indentation the pointer moves to the right, and back for every one to the left.
- An item can be dropped into another list of the document: drag `cheese` above into the steps below.
- A paragraph, a heading or any other block is dragged the same way, to a border between two blocks: try the grip of this list.
- Escape cancels a drag.

1. first step
2. second step
   - a detail of the second step
   - another detail
3. third step

A drag started on a selection moves what is selected: select `apple` alone (one Shift + click) and drag it, and its sub-items stay behind, taking its place; select it with its sub-items (two) and they go with it.

## A loose list, and a component in an item

The items of a list with blank lines between them keep their blank lines when one is inserted or moved in. An item can hold more than a line of text: the image below belongs to its item, and moves with it to any level.

- a first item, with a second paragraph below

  this paragraph belongs to the first item

- an item with a picture<!--renderComp=Image-->
  ```yaml
  src: mdx-usage/image/office-worker.svg
  alt: A staff member at a desk
  width: 160
  ```

- the last item

Some things Markdown does not let a list be. An item without text cannot be the first sub-item right under a line of text; the page writes such an item with an empty comment as its text, which renders nothing. A code fence opened in the text of an item and never closed would take the sub-items of the item as code; the page reads every result back before it writes it, so it refuses that text and says why, with the item still open.

## A document inside a document

An item can hold a whole document of its own, kept out of the way behind a tile: an **MDX block**. A click on the tile opens it in a popup; in edit mode the popup edits it as any document, and every change is written into the block, in this file. Its header is that of the dialog of a code block: **Copy**, **View | Edit**, and in Edit the title is a field (rename it there, and the tile follows). Type `/mdx` in the text of an item to add one at the caret, or choose **MDX block** in the insert menu of a block.

- the weekly check
  <!--renderComp=Mdx,view=icon,title=Checklist-->
  ```md
  ## How to check

  Run the check **once a week**, on Monday morning.

  - read the report
  - answer every warning in it
  ```
  and its report after it
- an item without a document

**Choosing the view as you add it.** `/mdx` and `/code` put a block in its default view on Enter. Press Tab instead (or type a space after the name) to list the views and choose one, type it (`/mdx card`, `/code ic`), or click one of the views shown on the row of the action. Try `/code` at the end of the item above: in a list item the default is the view `plain`, and you go on typing in its lines.

In the view `card` the document is drawn in place, and a click on it in edit mode opens it to edit it:

<!--renderComp=Mdx,view=card-->
```md
A note drawn **in place**: in edit mode, click it to edit it in its popup.
```

**Deleting one.** Right-click a tile, a card or the lines of a code block: in an item the menu starts with **Delete MDX Block…** or **Delete Code Block…**, which takes that block out of the item and leaves its text; at the root of the document the menu is that of the block, **Delete Blocks…**. The same works on a formula, inside the popup, and on a chip of an item being typed (there the delete is typed, and Undo brings it back).

A link written with `?nav=popup` opens its document in the same popup, and that document is edited there too: [the playground of content edits](./mdx-doc-edit-in-place.md?nav=popup). In edit mode a click on a link edits the text it stands in, so the link is followed by Ctrl/⌘ + click. `/inline` writes such a link.

## The spacing of a list

The space between two lines of a list and the space between a bullet and its text are config keys of the document, `ListItemGap` and `ListMarkerGap`, in px. Change them in the settings panel and every list of the page follows at once; a doc page sets them for all its documents, and one document in its frontmatter:

```yaml
---
config:
  ListItemGap: 8
  ListMarkerGap: 8
---
```

One gap stands between every pair of lines, whatever their levels: indenting an item moves it sideways and nothing else.

## From an agent or a script

Everything on this page is an api of the page as well ([API registry](api-command-palette.md)): `doc/itemListGet` answers the items of a list block with their paths, and `doc/itemTextSet`, `doc/itemInsert`, `doc/itemDelete`, `doc/itemIndent`, `doc/itemOutdent`, `doc/itemMove` and `doc/itemMoveTo` change them; `edit/select` selects a block or an item as Shift + click does.
