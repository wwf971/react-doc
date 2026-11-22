<!-- Design of structural edit: selecting, moving and re-leveling the blocks of a document and the items of its lists, and editing one list item. Parent document: doc_page_impl_edit.md. What the block-level operations write: doc_page_impl_block_ops.md. How a list item is written in the source: doc_page_impl_mdx_li.md. -->

# Structural Edit: Design

Editing a document from the page is of two kinds, and the page keeps them apart:

- A **content edit** changes what one thing says: the text of a paragraph, the data of a component, the text of one list item.
- A **structural edit** changes the structure of the document: which blocks and list items exist, their order, and how the items of a list are nested.

Content is edited with the plain pointer and the keyboard: a click on a thing opens it, and what is typed goes into it ([In-place editing](doc_page_impl_edit.md)). Structure is addressed with **Shift**: Shift + click selects a thing instead of opening it, Shift + drag moves it. The toolbars offer every structural edit as buttons, so the key is a shortcut, never the only way.

This document is the interaction design of structural edit: what can be selected, what a selection shows, the gestures and keys, dragging, and the part of it that is new with lists, the items of a list block treated like blocks. What the block-level operations write to the file is in [Block-level operations](doc_page_impl_block_ops.md).

<!--renderComp=DiagramText-->
```text
a document                        what a click does      what Shift + click does
├─ Heading                        opens the block        selects the block
├─ Paragraph                      opens the block        selects the block
└─ List            (a list block)
   ├─ fruit                       opens the item         selects the item ...
   │  ├─ apple                    opens the item         ... again: with what is
   │  │  ├─ fuji                                             under it, then the
   │  │  └─ gala                                             item above, ...
   │  └─ pear                                                up to the list block
   └─ bread
        content edit                 structural edit
        one thing is open            one thing is selected
        (a session, DocEditStore)    (a selection, DocEditStructStore)
```

## Core concepts

- **The things of structure.** A document is a list of root-level **blocks** ([Block model](doc_page_impl_edit.md#block-model)). A block that is a list holds **items**, each with its own text and, under it, more items. A structural edit acts on one of three things: a block, a list item **alone**, or a list item **with what is under it** (its sub-items, at every depth). The last two are the two **scopes** of an item, `item` and `subtree`.
- **The selection.** One thing is selected at a time, in edit mode: `{ path, hash, blockIndex, itemPath, scope }`. The selected thing is marked and its toolbar is pinned; while something is selected, no other toolbar shows.
- **Shift is the key of structure.** With Shift the pointer addresses things, not their content. One place needs no Shift: in a list a line is an item, so in an item being typed Enter, Backspace and Tab are structural edits, as an author expects of an outline ([The keys of an item](#the-keys-of-an-item)).
- **The item model.** The items of a list block are read from the positions the Markdown parser reports and kept as a tree; an edit changes the tree and writes the whole list back ([The list model](#the-list-model)).
- **The layer.** Everything structural edit shows of a list item (its toolbar, the frame of the selection, the editor of its text, a drag) floats in one layer over the body; nothing is added inside the list ([The layer](#the-layer)).
- **A thing is deleted from its right-click menu.** Whatever is drawn as one unit (a block, a code block or an MDX block in any view, a formula) is deleted from the menu a right click on it opens, wherever it stands: a root-level block, the text of a list item, a paragraph, a document embedded in an MDX block, a text being typed. One menu, the menu of the page, whose first entry is about the thing under the pointer ([Deleting a thing](#deleting-a-thing)).

Structural edit exists in edit mode, on a document the page can write ([Availability and mode](doc_page_impl_edit.md#availability-and-mode)). The older **block selection mode**, a mode of its own beside edit mode, is being merged into it ([Block selection mode](#block-selection-mode)).

## The gestures

| Gesture | Effect |
| --- | --- |
| click | content edit: opens the block, or the list item, under the pointer ([Entering a block](doc_page_impl_edit.md#floating-controls), [Editing an item](#editing-an-item)); ends a selection |
| Shift + click | selects the block or list item under the pointer; on the selection, makes it one step larger ([The selection](#the-selection)) |
| Shift + drag | moves the selection; started outside it, moves what is under the pointer (an item with what is under it, or the block) ([Dragging](#dragging)) |
| the grip `⠿` of a toolbar | the same without a key: a click selects the thing of the toolbar (on a pinned toolbar: one step larger), a drag moves it |
| a pointer going down anywhere else | ends the selection |
| the keys of the selection | Tab, Shift + Tab, Alt + ↑ / ↓, Enter, Delete, Escape ([The keys of the selection](#the-keys-of-the-selection)) |

A structural gesture never changes content and never moves the caret: the press of a Shift + click or of a grip prevents the default of the pointer and the mouse event, so it selects no text and takes no focus, and its click does not reach the block wrapper, so it enters nothing. Three places keep their own Shift + click: the surface of a block or item being edited (the browser extends the text selection), a control (a button, a field), and a block of a component declared `isEditEnterButtonOnly` (a dashboard, a canvas: it works by its own clicks). Such a block is selected by the grip of its toolbar.

The gestures are native listeners of the document in the capture phase, one set per edit body (`comp-doc/edit-structure/use-struct-pointer.js`). They come before the click handling of the block wrappers, which is how a Shift + click never opens a block.

## The selection

### One thing, growing

Shift + click on something outside the selection selects the smallest thing there: the list item alone, or the block when the pointer is not on an item. Shift + click **inside** the selection makes it one step larger, and from the whole block it starts over at the item that was clicked:

<!--renderComp=DiagramText-->
```text
Shift + click on "fuji", again and again

  the item alone            item      fuji
  (fuji has nothing under it: the next step is the item above)
  the item above, with      subtree   apple + fuji, gala
  what is under it
  the item above that       subtree   fruit + everything under it
  the whole list            block     the list block
  the item again            item      fuji
```

An item with sub-items has one more step, between the first and the second: the item with what is under it. A block that is not a list has one step, itself.

The two scopes of an item are the two things an author means by "this item": the line itself, or the branch that starts at it. The selection says which, and the edits follow it ([The operations on items](#the-operations-on-items)).

### What a selection shows

- **A block**: an outline and a light tint on its wrapper, which take no room (`data-struct-selected`), and its toolbar pinned above it.
- **A list item**: a frame of the layer around its own text (scope `item`) or around the item and everything under it (scope `subtree`), following the selection as it grows, and the toolbar of the item pinned where it covers nothing of what is selected: on the line of the item, right after its text, when the item is one short line, else above the frame, at its right end.
- **Nothing else**: while something is selected, the toolbar of every other block and item stays hidden, also under the pointer. The pinned toolbar shows whether or not the pointer is on its thing.

The pinned toolbar is the toolbar of the selected thing, with what the selection adds: the name of what is selected (`Item`, `Item only`, `Item with 3 sub-items`), and the operations that act on a scope as buttons ([The toolbar of an item](#the-toolbar-of-an-item)).

### Ending and keeping

A pointer going down outside the pinned toolbar ends the selection, and the click of that gesture does what it would do without one: a click on a block opens it. Escape ends it too, after closing what is open on it (a menu, a confirmation). Leaving edit mode, or going to another document, ends it.

A selection belongs to the text it was made in (its `hash`), like a selection of block selection mode ([Blocks belong to a text](doc_page_impl_block_ops.md#blocks-belong-to-a-text)): any other write of the document drops it. A structural edit of the selected thing is the exception: the edit knows where the thing is in the new text, so the selection follows it there (`selectionFollow`). An item indented with Tab stays selected and can be indented again.

### The blocks the author is at

Some operations act "here": a paste goes after the blocks the author is at, block selection mode starts with them selected. The page keeps them in one place, `DocBlockSelectStore.blockIndexListCurrentGet(path)`, so an operation asks instead of reading the DOM:

```text
block selection mode       the selected blocks
an open session            its block (the list block of an item being edited)
a structural selection     its block (the list block of a selected item)
edit mode otherwise        the root-level blocks a text selection of the page touches (a caret in a block counts)
```

The text selection is reported by the body of edit mode (`DocEditBody`, on `selectionchange`) as `textSelection { path, hash, blockIndexList }`; a selection outside the body (the side panel, a dialog) is none. The reading body has no blocks, so in reading mode there are none. The api context adds the item the author is at (`context.item`): the one being edited, else the selected one ([The apis](#the-apis)).

## Lists

A list block used to be one thing: edited as a whole, as its source. Now each of its items is edited like a block: it has a toolbar on hover, a click opens it, and it is created, deleted, moved and re-leveled on its own. The whole list as source stays one click away, on the Edit button of the block's toolbar.

### The list model

The items are not found by a line parser of our own. `remarkEditBlock` describes every root-level list from the positions the Markdown parser gives its items (`listDescribe`), and `editDocModelBuild` cuts the lines of each item from the source (`listModelBuild`, `lib/doc-edit-list.js`). A list block of the model carries the result as `block.list`:

<!--renderComp=DiagramText-->
```text
- fruit                      item 0        own text "fruit"
  - apple                    item 0.0      own text "apple\nand more"
    and more
    - fuji                   item 0.0.0
  - pear                     item 0.1
- bread                      item 1

list  { ordered, numberStart, numberStyle, itemList }
item  { path, depth, markerText, spaceCount, indentExtra, gapBefore,
        isMarkerLineOwn, segmentList, lineStart, lineEnd }
        segmentList   what the item holds, in order:
                      { type: 'content', lineList }   lines without the
                                                      item's indentation
                      { type: 'list', list }          a nested list
```

- **The path** of an item is its index among the items of its parent, at every depth: `0.0.1`. The children of an item are the items of all its nested lists, counted on in order.
- **The own text** of an item is its first content segment: the lines before its first nested list, without the marker and without the indentation of the item. It is what the author edits as "the item".
- **Everything is relative.** A content line is kept relative to the text column of its item, a marker relative to the text column of the item holding its list. So an item can go to any depth, or get a wider marker (`9.` becoming `10.`), and the serializer indents its lines again; this is what makes every edit below one small change of the tree.
- **The rendered list is marked.** `listAnnotate` gives every `<li>` the attribute `data-edit-item` (its path) and every `<ul>` / `<ol>` `data-edit-list`, so the layer finds the element of an item. Only the edit compile does this; the reading body has no mark.

A list the model does not take is edited as a whole only: one indented with tabs (`block.listMessage` says why). A list inside a quote or a component is not a list block and has no items of its own.

### Editing an item

A click on a list block opens the item under the pointer (`editItemEnterRequest`), with the caret at the clicked text, as a click on a paragraph does; a click beside the text (on a marker, in the gap between two items) opens the item at that height. The session is of type `item`: `{ type: 'item', blockIndex, itemPath, textInitial }`, the block index naming the list block and `textInitial` the own text of the item.

The author edits **the text of the item and nothing of the list around it**: no marker, no indentation. A text of several lines is typed from the left edge; the page indents every line into the item when it saves ([Items written by the page](doc_page_impl_mdx_li.md#items-written-by-the-page)).

<!--renderComp=DiagramText-->
````text
the source                      what the editor of item 0.0 shows

- fruit
  - apple, see:                 apple, see:
    ```js                       ```js
    const a = 1;                const a = 1;
    ```                         ```
    - fuji
  - pear
````

- **The surface lies over the rendered item.** The rendered `<li>` stays as it is; the source is laid exactly over its own text by the layer, in the type of the item, on the page background (`DocEditItemEditor`). So entering an item moves nothing, whatever the margins of the list are ([The layer](#the-layer)). As the text is typed, the item takes the room its source needs ([The room of an item being edited](#the-room-of-an-item-being-edited)).
- **The bar** stands where the text ends: while the text is one line that leaves room after it, the bar is on that line, right after the text, and moves on as the text is typed; else it floats above the first line of the item, at its right end. It holds the label, the level buttons, the new-item buttons (`+↑` a new item above, `+↓` below, as the block toolbar draws its insert buttons), **To text** for an item with code blocks ([The lines as text](doc_page_impl_mdx_code.md#the-lines-as-text)), the switch of the [slash menu](doc_page_impl_edit_slash.md#on-and-off), Save and Cancel.

<!--renderComp=DiagramText-->
```text
[List item] [⇤][⇥] [+↑][+↓] [¶ To text] [☑ / menu] [✓ Save] [× Cancel]
                    │    │    └ the lines being edited, or the chip selected,
                    │    │      joined into one line of text
                    │    └ a new item below (Enter at the end of the text)
                    └ a new item above: this one written as typed
```
- **The editor is a registered component**, `ListItem` (`common/ListItem`, `built-in/comp-mdx/text/ListItemEdit.jsx`), built on `TextBlockEdit` like the editors of paragraphs and headings, so a host replaces it through `compRegistry`, and it offers the [slash mode](doc_page_impl_edit_slash.md).
- **Leaving saves, Escape cancels**, as for a block ([Sessions](doc_page_impl_edit.md#sessions-leave-and-cancel)). A leave writes the list block with the new text of the item; the block shows the saved text until the document is compiled again.

**A new item** is created without a text and opened at once, the caret in it. Escape removes it again, and so does leaving it without a text: a list keeps no item nobody typed. A new item that came to hold items meanwhile (Enter in it took it one level up, and the items after it came under it) gives them back to the row above when it goes.

**What a text cannot be.** The text is the author's, but the item must stay an item with what is under it. The page reads the result back before writing it ([The write of a structural edit](#the-write-of-a-structural-edit)); a text that would take what is under the item is refused, and the session stays open with the reason: a code fence that is never closed swallows the sub-items as code. List items typed at the end of a text are welcome: they become the first sub-items.

#### The room of an item being edited

The source of an item lies over the rendered item, and the rendered item shows the text the session started with. When the text being typed gets higher or lower than that (a line more in a text block, a sentence that wraps onto a second line), the rendered item is given the height of the source, and what follows moves down or up:

<!--renderComp=DiagramText-->
```text
• second item                        • second item
  • ┌──────────────────┐               • ┌──────────────────┐
    │ init while       │                 │ init while       │
    │ second line      │   + 2 lines     │ second line      │
    └──────────────────┘                 │ third            │
  • a plain item                         │ fourth│          │
• last item                              └──────────────────┘
                                       • a plain item          <- moved down as the lines were typed,
                                     • last item                  where it will stand once they are saved
```

- **Why the list moves here.** Elsewhere an editor keeps the geometry of what it edits, and source that needs more room lies over what follows ([the geometry lock](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)). That rule is about the editing ui: opening an editor, a toolbar, a selection must not move the page. A list item growing by a line is the document changing under the author's hands, as it does in any text editor; laid over what follows, the new lines would hide the items below, and a text block would leave its frame behind. So the room follows the text, and nothing is laid over another item.
- **A text block follows exactly**, growing and shrinking: its rendered `<pre>` gets the height of the lines being typed, what its old lines had beyond that is cut, and a long block shows all its lines instead of scrolling in itself.
- **An item of text only grows.** Its rendered text is no element that could be made lower, so the room the source needs beyond the height the text had is added below it: as margin above its first nested list, or as padding of an item without one. A text that gets shorter leaves the item at its height until it is saved.
- **Nothing is added to the list.** The room is a style set on an element the list already has (`itemRoomOpen`, `struct-geometry.js`, driven by a `ResizeObserver` on the source), and it is taken off when the session ends: saved, the item is drawn with its new text at that height; canceled, it is as it was.
- **Entering.** An item whose source is longer than what it renders (a link, bold text) may need a line more than its rendered text at once; then what follows moves by that line when the item is entered.
- **The room follows the item as it is drawn.** The rendered item can be drawn anew while its session is open: a document edited in a popup is compiled again after the write that opened the session (Shift + Enter made the item a text block, and its `<pre>` comes after the session), and every write of its host draws it again. The room is then opened again on the item as it stands now, its `<pre>` when it has one (a `MutationObserver` on the body beside the `ResizeObserver`), never left on an element that is gone.

### The keys of an item

An item is structure as well as text. In a list a line is an item, so while an item is typed the keys every outline has act on the list, without Shift:

| Key | Where the caret is | Effect |
| --- | --- | --- |
| Enter | in the text | the item is split at the caret: a new item right below takes the text after the caret and everything that was under the item; the author goes on at its start |
| Enter | at the end of the text | a new item without text right below the caret: after the item, or, when the item has items under it, as the first of them |
| Enter | in an item without text | the item goes one level up; at the first level it is taken out and the editing ends, which is the way out of a list |
| Enter | in the lines of a code block | the lines after the caret leave the block: they become text of the item right after it, joined into one line, and joined to the text already there (Shift + Enter is a line break of the block) |
| Shift + Enter | anywhere | a line break: the item becomes a [text block](#a-text-block); in a text block, one more line; in the text of an item with code blocks, the segment at the caret becomes a text block of its own ([Code blocks in the text of an item](#code-blocks-in-the-text-of-an-item)) |
| Backspace | at the start of the text | the item joins the row above: its text goes to the end of that row, and the caret stands where the two texts meet |
| Delete | at the end of the text | the row below joins the item, the same way |
| Tab, Shift + Tab | anywhere | the item one level deeper, one level up, with what is under it; the caret stays where it was |
| ← , → | at the start, at the end | the caret goes on at the end of the row above, the start of the row below |
| ↑ , ↓ | on the first line, on the last | the row above, below, the caret keeping its x; from the first or last item the neighbor block, and from a block the first or last item of a list (`sessionFocusShift`). The lines of a code block among the text of an item are lines like the others: the caret goes into them and out of them at its x ([Code blocks in the text of an item](#code-blocks-in-the-text-of-an-item)) |

<!--renderComp=DiagramText-->
```text
Enter, the caret after "apple"            Backspace, the caret before "pear"

- fruit              - fruit              - fruit              - fruit
  - apple│and pear     - apple              - apple              - apple
    - fuji             - │and pear            - fuji               - fuji│pear
  - plum                 - fuji             - │pear                - seckel
                       - plum                 - seckel

the new item takes the text after the      the text joins the row above, which is
caret and what was under the item          "fuji"; "seckel" keeps its level
```

- **A split or a join moves no other line and changes no other level**, like a level change ([The operations on items](#the-operations-on-items)). So what was under a split item is under its second part, which stands where the item's sub-items begin; and what was under a joined item keeps its level: it comes under the item that now stands above it at that level, and takes the item's place when the row above is the item it was under.
- **The spaces at a split are text of neither item**: `apple│ and pear` and `apple │and pear` give the same two items.
- **At the end of an item with sub-items, Enter makes the first of them**, not an item beside it. The new row stands right below the caret either way; but a split gives its second part everything under the item, and a part without text has no claim to it.
- **An item without text that holds items** (a new item that Enter took one level up, an item whose text was deleted) is no way out of the list at the first level: Enter says so in the bar, and Backspace gives the items back to the item above.
- **A text block is split and joined like a line**, at any place of its lines ([A text block](#a-text-block)).
- **A text of lines that is no text is left whole.** In a block of code, and in an item whose source has several lines (two paragraphs, a component with its data), Enter is a line break, and Backspace at its start joins nothing while it has a text: a place in such a source is not always one an item can be cut at ([TODO](doc_page_impl_TODO.md#edit-structure-split-lines)).
- **No kind of thing has to be the whole text of an item.** Texts that meet at a code block are joined as they are written, a line apart: a row that ends with a block of code (or with any fenced block) takes the text of the row below after its block, and a text joins a row above it that is a block of code the same way. Only the lines of a text block of text join like lines of text. So an item holds text and blocks in any order, and Backspace and Delete never refuse because of a block (`listItemMergeUp`; the caret goes where the two texts meet, counted in the text as written, `isOffsetSource`).

**One write, with the text being typed.** A key of the list does not save the item first and change the list after: the draft goes into the edit. The store closes the session without a write (`sessionDiscard`), computes the edit on the item model with the draft as the text of the item (`listItemSplit`, `listItemMergeUp`, or `listEditThen(listItemTextSet, listItemIndent)` for a level change), writes the result once, and opens the session of the item the caret belongs in, at the offset the edit names. An edit that is refused leaves the session as it was, with the reason in its bar; a write that fails opens the item again with the draft.

**Typing on through an edit.** That write takes a moment, because the document is read again before the next item opens: about 60 ms in a short document, 100 to 200 ms in one of 70 blocks ([TODO](doc_page_impl_TODO.md#edit-structure-write-wait)). An author who presses Enter and types on at once must lose nothing, so the keys of that moment are kept and typed into the editor that opens:

<!--renderComp=DiagramText-->
```text
Enter ─┬─ the session is closed, the list written, the document read again ─┬─ the next item is open
       │   keys typed now:  r  y  e  Enter  o  a  t                         │
       │   kept in order (DocEditStructStore.typeAheadKeyList)              │
       └────────────────────────────────────────────────────────────────────┘
the editor that opens takes "rye" at its caret and presses the kept Enter as its own key,
which splits again; "oat" waits for the editor after that
```

Characters, Backspace (taking back the last kept character), Enter and Tab are kept; the pointer layer hears them in the capture phase and holds them from the page, whose keys they would be while no editor has the focus. The editor takes them when its surface has the focus (`typeAheadTake`: the text up to the first kept key, then that key, pressed as a key event of the surface so it goes the way a typed key goes). The keys of an input method are not kept, since their text is not known at the key. The moment ends by itself 1.5 s after the edit, whatever happened to the editor.

#### A text block

A list item of Markdown is a paragraph, and a paragraph does not keep its line breaks. An item that needs them (an address, a few lines of a log) is written as a **text block**: its own text is one fenced block of language `text` and nothing else ([Items written by the page](doc_page_impl_mdx_li.md#items-written-by-the-page)).

<!--renderComp=DiagramText-->
````text
Shift + Enter, the caret after "Example Trading Co."

- contact                          - contact
  - Example Trading Co.│             - ```text
  - phone                              Example Trading Co.
                                       │
                                       ```
                                     - phone
````

- **Shift + Enter** in an item of one line turns it into a text block with the line break at the caret (`editItemFormatRequest`), and the author goes on typing on the new line. The fences are the page's: the session of such an item (`itemFormat: 'block'`) holds the lines inside them, and the save writes the fences around the lines again, longer than any run of backquotes a line starts with (`itemBlockFormatGet`, `itemBlockTextBuild`).
- **It is drawn in the view `plain`** by default: a thin frame around lines that stand like the lines of plain text, so the block keeps the rhythm of the list ([The views of a code block](doc_page_impl_mdx_code.md#the-views-of-a-code-block); `CodeBlockViewAsListItem`, or `view=card` in the info of the fence, for the card).
- **Its editor lies over the lines of the rendered code block**, in their type and on the background of the block, whatever view drew it, so the frame of the block stays around the text being typed and nothing moves when the item is entered. The block grows and shrinks with the lines as they are typed ([The room of an item being edited](#the-room-of-an-item-being-edited)). A long line is wrapped where the block wraps it (a block of text in the view `plain`), and not where it does not (code).
- **Shift + Enter in a text block is one more line; Enter splits the block**, as it splits any item: the lines after the caret go into a new item below, with what was under the item, and the author goes on at its start. Tab changes the level of the item, as for any item.
- **A text is a block while it holds a line break.** Every text the page writes out of a text block (the two parts of a split, the text of a join, the block when it is saved) is written as its lines ask (`itemTextWrite`): a text block when it still holds a line break, a plain line when it is down to one. So a block never loses its fences while it has lines, and a block of one line is a line of text again.
- **Backspace and Delete join it like a line**: the text of the item below goes to the end of the last line of the block, the block to the end of the line above it, and the joined text is a block when it holds a line break. Enter and Backspace undo each other here too.
- **A fenced block of another language** that is the whole text of an item is code, not text: it is edited as its lines the same way and keeps its language, but it is left whole. Shift + Enter is a line break in it; Enter takes the lines after the caret out of it, as a line of text of the item after the block ([below](#code-blocks-in-the-text-of-an-item)). No text joins its lines (a text joining the item stands after the block, as written), it stays a block when it is one line, and the new-item button of its bar adds an item below it.
- **A code block drawn as an icon** is not edited as its lines: it is one thing of the text of the item ([below](#code-blocks-in-the-text-of-an-item)), whether it is the whole item or stands among other things; so is a code block of any view standing among text.
- **Back to one line**: **To text** in the bar joins all its lines at once into one line of text, the line breaks removed ([The lines as text](doc_page_impl_mdx_code.md#the-lines-as-text)); by hand, Backspace at the start of a line of the block joins it to the line above, and the block that is down to one line is saved as a plain line.

<!--renderComp=DiagramText-->
````text
Enter, the caret after "one"                  Enter, the caret after "two"

- ```text           - one                     - ```text           - ```text
  one│              - ```text                   one                 one
  two                 │two                      two│                two
  three               three                     three               ```
  ```                 ```                       ```               - │three

the part of one line is a plain line,         each part is written as its lines ask
the part with lines a text block
````

#### Code blocks in the text of an item

An item holds text and code blocks in any order, and no block has to be the whole item. How a block stands in the item is told by its view ([The views of a code block](doc_page_impl_mdx_code.md#the-views-of-a-code-block)): a block in the view `icon` is a tile **in the line** of the text, its bottom edge on the bottom edge of the line by default (`CodeBlockIconAlign`); a block in another view (`card`, `plain`) takes **a line of its own**: the text before it ends a line, the text after it starts one. A line of its own is not the whole item: text and other blocks stand around it. The editor of the item shows each code block as **one thing of its text**, a chip in the place of the rendered block, never as its source:

<!--renderComp=DiagramText-->
````text
the source of the item          what the editor of the item types, one
                                character for each chip (U+E000 + its number):
- see the query
  ```sql view=icon title="weekly"   see the query￼then the script￼and after
  select 1                          the card
  ```
  then the script
  ```js view=card
  const a = 1;
  ```
  and after the card

the item, rendered, and in its editor with a chip in the place of each block

                ┌──────┐
                │  ▤   │                    an icon: in the line, its bottom
• see the query │weekly│ then the script    edge on the bottom edge of the line
                └──────┘
  ╭──────────────────────────────╮
  │ const a = 1;                 │          a block of another view: a line of
  ╰──────────────────────────────╯          its own, not the whole item
  and after the card
````

- **What is an atom.** Every code block of the own text of the item: a fenced code block, or a block of `Code` (its marker on the line before its fence), of the kind its view gives it, the view written in it or given by the config for its place (`itemAtomModelBuild`, `lib/doc-edit-item-atom.js`; the session holds it as `itemAtom`): `icon`, a chip in the line, or `block`, a chip as wide as the item. A block of another view that is the whole text of the item is no atom: that item is edited as the lines of its block ([A text block](#a-text-block)). An [MDX block](doc_page_impl_mdx_embed.md#in-the-text-of-a-list-item) is an atom too, even when it is the whole item, since its lines are a document edited in its popup (`isEmbed`). Other blocks of an item (the data of an `Image`) stay source in the editor.
- **Typed as one character.** The text the editor types holds one character of the private use area per atom; the atom stands for its block and for the line breaks around it, which only Markdown needs. Saved, every atom is a block on lines of its own again, the text around it on the lines before and after it, the spaces next to it dropped (a blank line would make the list loose, an indented line code) (`itemAtomTextBuild`). A text not typed is written back as it was.
- **The chip is the rendered block, in its place.** So nothing moves when the item is entered. The chip of an icon is the tile, the same box at the same alignment, a space from what stands beside it; it holds no text of its own (`surface-atom.js`: its icon and label are drawn by the stylesheet). The chip of a block is as wide as the surface, which puts it on a line of its own, and shows a copy of the rendered block, inert, with the margins it has in the item (DocEditItemEditor fills it as soon as the surface writes it, `ATOM_FILL_EVENT`, before the caret is placed: the chips of code stand for the code blocks of the rendered item in order, and the chips of the kinds of atoms, a formula among the text, are not counted). The text of the editor, the ranges of the browser and the slash mode never meet the words of a chip. A text node stands on each side of every chip (a zero-width spacer where there is none), so the caret has a place between two chips and after the last one. **The caret beside a block** is drawn by the page, as tall as the frame of the block, on the side it stands (`data-caret` of the chip, a blinking bar of the color of the caret): the caret of the browser is as high as the line of text it stands in, the spacer beside the chip, and is hidden there. Beside an icon, and in any text, the caret is the browser's.
- **The keys.** ← and → move over a chip in one step, Shift + ← / → select over it; Backspace or Delete next to a chip selects it first, and deletes it when pressed again (Undo brings it back); a click on a chip selects it (and To text in the bar turns it into its lines as one line of text); a double click on the chip of a block edits its lines in place (below), on the chip of an icon it saves the item and opens the dialog of the lines (`codeLinesOpen`, [Editing the lines](doc_page_impl_mdx_code.md#editing-the-lines)). A copy of a part of the text with chips carries their blocks as text; a paste never makes a chip. Enter splits the item between the chips (before a block, the block goes to the new item with what follows it), Backspace at its start joins it to the row above, Tab changes its level, as for any item.
- **Shift + Enter makes a text block.** In the text of an item with code blocks, Shift + Enter makes **the segment of text the caret is in** (the run between two chips, or between line breaks) a text block of its own, broken at the caret: a fenced block of language `text` standing where the segment stood, drawn in the view of a block in a list item (`CodeBlockViewInListItem`, plain by default), and the author goes on in its lines, after the break. The text before and after the segment stays as it was.
- **The lines of a block among the text** are edited where they are drawn, as the lines of an item that is one block are ([A text block](#a-text-block)): the session edits one **part** of the item (`session.itemPart`, `itemPartGet` and `itemPartTextWrite` of `lib/doc-edit-item-atom.js`), laid over the lines of that block, and writes them back into the text of the item. A part is entered by a click on the lines of the block, by a double click on its chip, by Shift + Enter as above, or by adding the block (`/code`: the author goes on in its new lines). In it, Shift + Enter is a line break, and **Enter takes the lines after the caret out of the block**: they become text of the item right after the block, joined into one line (as To text joins them) and joined to the line of text that already follows the block, and the caret goes on at their start (`editItemBlockSplitRequest`, `itemBlockSplitOut`); a block left with no lines is taken out. ← at the start of the lines and → at their end write the lines and lead back into the text of the item, beside the chip (`editItemPartLeaveRequest`); Backspace or Delete in empty lines takes the block out.
- **↑ and ↓ go through the lines of a block** as through lines of text, the caret keeping its x: from a line of text (or an icon) right above or below a block into its first or last line (`surfaceAtomBlockLineGet`, `ATOM_LINES_EVENT`); from its first or last line to the line above or below it in the item, or on to the row above or below when the block begins or ends the item; and from the row above or below into the block that begins or ends an item (`sessionItemStart` with a line to start on). A block of text down to one line is written as a line of text among the others. Tab changes the level of the item, and the part stays open. An icon has no part: its lines are in its dialog.
- **Its place.** A block that is the whole item, and one among other things, can be drawn differently when their view is the config's (`CodeBlockViewAsListItem`, `CodeBlockView`). A block whose view came from the config keeps it when text is typed beside it, or taken away: the view is written into it.

#### Atoms of a kind

A component can write things of its own inside a text that are not code blocks: a formula of LaTeX, `$x^2$` or a `$$` block, is the one the page has ([the component math](../built-in/comp-mdx/math/comp_math.md)). The edit layer types them as it types code blocks, one character and a chip for each, but knows none of them by name: the component gives a **kind of atom**, and the editor of a text asks every kind where its things are.

<!--renderComp=DiagramText-->
```text
atomKindDefine({
  name                     'math': what the atoms of the kind are called
  label                    'formula': what a chip says it is
  spanListGet(text)        where its things are in a text (Markdown):
                           [{ start, end, value, isRow }]
  sourceBuild(value, isRow)  how one is written
  draw(element, value, isRow) -> message   draws one into its chip; '' or
                           what is wrong with it
  Editor                   edits a value below its chip: { anchorGet, value,
                           isRow, message, onChange(value), onLeave(how) }
  elementSelector          optional: the element the rendered document draws
                           one thing as ('.katex'), one per thing, in order:
                           which one a right click is on (Deleting a thing)
})
```

- **The registry.** The kinds are a registry of the page built as the slash actions are ([The slash action registry](doc_page_impl_edit_slash.md#the-slash-action-registry)): the package's by id in `comp-doc/edit/atom-kind-registry.js` (`text/math`), the host's over them (`config.atomKindById`, an id mapped to `null` removes one), built by `atomKindRegistryBuild` in `DocPageMdx` and held by name by the edit store (`DocEditStore.atomKindByName`, `replaceAtomKindByName`).
- **Where they are typed.** In a paragraph (its session holds them as `blockAtom`) and in the text of a list item (`itemAtom`, with its code blocks), not in the lines of a block. A thing of a kind inside a code block, or overlapping another, is no atom. The atoms of code are numbered first, those of the kinds after them (`atomOrderList` keeps the order of the text).
- **In the line or a row.** An atom of a kind is `inline`: written where it stands, the spaces around it the text's own, its chip in the line and keeping no gap of its own; or a `row`: on lines of its own, its chip as wide as the surface, the caret beside it as tall as the row. Saved, a row is lines of the item; in a paragraph, a block of its own between the paragraphs before and after it (`itemAtomTextBuild`, `pieceGap`). An atom with an empty value is written as nothing.
- **A row keeps its room while its value is typed.** The chip of a row is drawn again at every key, and its height follows what it draws; so, as a block being edited keeps the geometry it had ([the geometry lock](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule), rule 4), the chip keeps the margin box it had when its field opened (`surfaceAtomRowLock`: its margins and height inline, `data-locked`). Drawn taller, it grows and its bottom margin is less by as much (`surfaceAtomRowLockFollow`), so its line keeps its height: it extends over the lines after it, above them, on the page background. Drawn shorter, it keeps its height (`min-height`). The lock is released when the field closes (`surfaceAtomRowUnlock`), and the row then takes the room its value needs, as a saved block does.
- **Its value is typed below its chip.** A click on the chip, or Enter on it selected, opens the `Editor` of its kind under it; so does the click that enters the paragraph or the item, when it lands on the chip (`selectionInitial` a point on it, `surfaceAtomKindChipAt`: what is drawn there first, since the glyphs of a formula reach out of its box) (the surface keeps the chip and marks it `data-editing`). Each value typed is reported (`editAtomValueChange { char, value, source }`, `itemAtomValueSet`) and the chip is drawn again by its kind; the typed text does not change, so the save writes the source of the value (`model.isEdited`). The editor leaves with how: `before` or `after` (the caret goes on there), `done` and `cancel` (after it), `remove` (the atom is taken out, as a typed delete Undo brings back), `blur`.
- **Added by an action.** `slashEffect.atom(atomKind, { isRow, textFallback })` takes the slash text away and asks the editor of the text for a new atom at the caret (`editAtomAdd { atomKind, isRow, offset, text }`, `itemAtomKindAdd`): the surface is drawn again with its chip, and its editor opens (`session.atomOpenRequest`). A surface that types no atoms gets `textFallback` typed instead.

### The toolbar of an item

<!--renderComp=DiagramText-->
```text
under the pointer   [⠿] [✎] [+↑] [+↓] [list ▾] [🗑]
a code block        [⠿] [✎] [⇧] [+↑] [+↓] [list ▾] [🗑]   ⇧ to asset, asked first
its lines moved     [⠿] [✎] [⏱] [+↑] [+↓] [list ▾] [🗑]   ⏱ asset: the panel of the item it reads

pinned              [Item with 2 sub-items]
                    [⠿] [✎] [+↑] [+↓] [⇤] [⇥] [˄] [˅] [list ▾] [🗑]

list ▾   CODE BLOCK  Card · Plain · Icon · By config · To text
         LEVEL    Deeper, item only · Deeper, with sub-items · Up
         ORDER    Move up · Move down
         LIST     New sub-item · Bullets · Numbers
         SELECT   Select this item
```

- **Where it is.** An item of one line that leaves room after its text has the toolbar there, starting a little after the end of the text: next to what it is about, a short way for the pointer, covering nothing. An item whose first line is long has it at the right end of that line, as high as a line, so it covers no other item; pinned to a selection, such an item has it above the frame, at its right end. A toolbar that starts after the text grows to the right: the name of the selection, a confirmation or a failure message follow the buttons, which stay where they are. A block's toolbar keeps showing above the list while the pointer is on an item, since a list block has no place that is not an item.
- **`⠿`** the grip: a click selects the item, a drag moves it with what is under it ([Dragging](#dragging)).
- **`✎`** opens the text of the item. **`+↑` `+↓`** create an item above, or below the item and what is under it.
- **`list ▾`** holds the operations of the list. An item with sub-items can go deeper alone or with them; an entry that cannot be chosen is greyed out and says why on hover (the first item of a list has no item before it to go under). An item that is a code block (a fenced block that is its whole text, or a block of the component `Code`) has a **Code block** group first: its view, written into it ([Changing the view from the page](doc_page_impl_mdx_code.md#changing-the-view-from-the-page)), and **To text**, its lines joined into one line, the item a plain item ([The lines as text](doc_page_impl_mdx_code.md#the-lines-as-text)).
- **`⇧` `⏱`** the asset service layer, as buttons of the toolbar, never entries of the menu. An item that is a fenced code block has the **to asset** button (`⇧`), asked first in the toolbar like a deletion; an item whose lines are an item of the store (a block of `Code` reading it) has the **asset** button (`⏱`) in its place, which opens the asset panel of that item ([The lines in the asset service layer](doc_page_impl_mdx_code.md#the-lines-in-the-asset-service-layer)). A code block standing in the text of an item among other things has the same two buttons in the dialog of its lines (a click on its icon, a double click on its chip).
- **Pinned**, the level and move operations are buttons, because what they act on is the selection: `⇥` takes the item alone or with its sub-items, as selected.
- **`🗑`** asks in the toolbar itself, like the deletion of a block. Under the pointer, an item with sub-items offers both ways (`With the 3 items under it` · `Item only`); pinned, the question is about what is selected.

In a toolbar at the right end, the confirmation and a failure message stand left of the buttons; either way the buttons do not move under the pointer when one appears. The width the toolbar has when it first shows decides which place it gets. The toolbar is `DocEditItemToolbar`; the menu is the injected `Menu`, styled like the mode menu of a block.

### The operations on items

One principle orders them: **a change of level moves no line up or down, and only a move changes the order.** Indenting and outdenting change levels where the lines stand, as the Tab key of a text editor would; everything that reorders is a move.

| Operation | Item with what is under it (`subtree`) | Item alone (`item`) |
| --- | --- | --- |
| Deeper (indent) | the item becomes the last sub-item of the item before it, with everything under it | only the item goes deeper; its sub-items keep their level, so they follow it as its siblings |
| Up (outdent) | the item becomes the item after its parent, with everything under it; the items after it in the list it leaves come under it | the same: a list cannot skip a level, so what is under the item goes with it |
| Move up / down | swapped with the item before / after it in its list | (a move among siblings takes the sub-items along) |
| Move to a place (drag) | the item with everything under it goes there | the item goes alone; its sub-items take its place, one level up |
| Delete | the item and everything under it | the item alone; its sub-items take its place, one level up |
| New item | beside the item: above it, or below it and what is under it; or under it, as its last sub-item. Created without a text and opened ([Editing an item](#editing-an-item)) | |
| Split, join | the keys of an item being typed ([The keys of an item](#the-keys-of-an-item)) | |
| Bullets / Numbers | the list the item is in changes its markers; its nested lists stay as they are | |

<!--renderComp=DiagramText-->
```text
the list            Deeper, item only        Deeper, with sub-items
(on "apple")        (fuji keeps its level)

- fruit             - fruit                  - fruit
- apple               - apple                  - apple
  - fuji              - fuji                     - fuji
- pear              - pear                   - pear


the list            Up
(on "apple")        (no line moved: pear, which came after apple in the
                     list of fruit, comes under it)
- fruit             - fruit
  - apple           - apple
    - fuji            - fuji
  - pear              - pear
```

Details that keep a list tidy:

- **An item is written like the list it joins**: it takes the marker of its new siblings (`-`, `*`, `1.`), the spaces after it and their indentation. The first item of a new nested list keeps its own marker.
- **A numbered list is numbered again** after its items changed, counted on from its first number; a list its author numbered all the same (`1.` `1.` `1.`) stays so.
- **Blank lines stay with their place.** A loose list keeps one blank line between its items when an item is inserted or moved in; a level change keeps the blank lines above the item where they are.
- **An item with text after its sub-items** (a paragraph below its nested list) cannot leave them behind: the edits of the item alone are greyed out, with the reason.

### What Markdown does not let a list be

Some rules of Markdown limit how a list can be written. The page writes around them where it can, and says so where it cannot:

- **An item without text cannot be the first sub-item right under a line of text.** `-` alone under a text line underlines it as a heading, and no other marker reads as an item there. Such an item is written with an empty comment as its text (`<!---->`, in MDX `{/**/}`), which renders nothing and is read as no text again; the author never sees it ([Items written by the page](doc_page_impl_mdx_li.md#items-written-by-the-page)).
- **A numbered list right under a line of text starts at 1**, or it is text. A nested list the page creates starts at 1.
- **A code fence that is never closed takes what is under its item as code.** A text that does this is refused, with the item still open.

None of these is a special case of an edit: each was found by reading the result back ([The write](#the-write-of-a-structural-edit)), which is also what catches the ones nobody thought of.

### The spacing of a list

A list that is edited line by line must keep its rhythm: an item that goes one level deeper moves sideways, and no line above or below it moves. The typography of the page gives a nested list a larger margin than an item, so the page sets the spacing of its lists itself, with one gap for every pair of lines, and makes its two measures config keys of the document, `ListItemGap` and `ListMarkerGap` ([The spacing of a list](doc_page_impl_mdx_li.md#the-spacing-of-a-list)).

Every item is a row, also one without text. A browser puts the marker of an item that holds nothing but a list on the line of its first sub-item, two items in one row, which no editor can be laid over; such an item is marked when the document is compiled and gets an empty line of its own ([Every item is a row](doc_page_impl_mdx_li.md#the-spacing-of-a-list)).

## Dragging

A drag moves the selection to another place: a block to a border between two blocks, a list item into a list, of its own block or of another list block of the document.

<!--renderComp=DiagramText-->
```text
- fruit
  - apple
┆ - pear             ┆  the dragged item stays where it is, dimmed,
- bread                 in a dashed frame, until it is dropped
  - rye
  ○──────────────────   the line of the place: in the gap, starting at
  - wheat    ⠿ pear     the marker column of the level the item would get
- cheese                the chip at the pointer says what is dragged ("+3":
                        with 3 items under it)
```

- **Starting.** Shift + press on a thing, or a press on the grip of a toolbar, then the pointer moving more than a few pixels. A drag started on the selection moves the selection, in its scope; started anywhere else, it first selects what is under the pointer: an item with what is under it, or the block.
- **What shows.** Three things, all of the layer: the dragged thing dimmed where it still stands; one line in the gap where it would go; a chip at the pointer with the first words of the dragged thing and the number of items it takes along. Nothing in the document moves until the drop, so the place is read against a page that holds still. The line and the chip move by transitions of a few tens of milliseconds; the chip is brighter over a place the thing can go to.
- **The place of a block** is the border nearest to the pointer.
- **The place of an item** is a gap between two rows of a list block, and a level. The gap alone does not say the level: below the last sub-item of an item, the dragged item may become one more sub-item, or follow the item, or follow the item above that. A gap takes the levels from the level of the row below it to one deeper than the row above it. Among them **the item keeps the level it has, and the pointer moved sideways changes it**: one level deeper for every indentation it moved to the right since the drag began, one level up for every one to the left. So a drag straight down reorders, and a drag that drifts to the right nests. The left end of the line stands at the marker column of the level, which is how the level is seen before the drop.
- **No place**: on the dragged thing itself, at the place it already has, inside what is dragged, and for an item anywhere that is not a list. Then no line shows, and a drop changes nothing.
- **Scrolling.** Near the top or the bottom of what scrolls the document, the page scrolls under the dragged thing.
- **Ending.** Releasing the pointer drops; Escape cancels. The selection follows the thing to its new place.

The rows and blocks are measured once when the drag begins, relative to the body, so scrolling does not move them. From them `dropTargetFind` (pure, `struct-geometry.js`) answers the place in terms of the model (`{ kind: 'item', blockIndex, itemPath, position, depth }` or `{ kind: 'block', borderIndex }`) and the line; the DOM is asked for positions only, never for what a thing is. The store checks the place (`dragTargetReasonGet`) and the drop is the write of [the operations](#the-operations-on-items): `listItemMove` in one list block, a detach and an attach across two (one write; a list whose last item left is removed), `blockListMove` for a block.

Not offered: a block dropped into a list as an item, and an item dropped between blocks as a block of its own; both change what the thing is ([TODO](doc_page_impl_TODO.md#edit-structure-convert)).

## The keys of the selection

While something is selected, and no session is open, the keys of the default keyboard map act on it ([Keyboard maps](doc_page_impl_api_hotkey.md)); each is an api, so a doc page rebinds it:

| Key | Api | Effect |
| --- | --- | --- |
| Tab | `doc/itemIndent` | the selected item one level deeper, alone or with its sub-items as selected |
| Shift + Tab | `doc/itemOutdent` | the selected item one level up |
| Alt + ↑ / ↓ | `edit/selectionMove` | the selected block or item swapped with its neighbor; the selection stays on it |
| Enter | `edit/selectionEnter` | the content of the selected thing opened for editing |
| Delete, Backspace | `edit/selectionDeleteAsk` | the deletion asked in the pinned toolbar |
| Escape | `edit/selectClear` | closes what is open on the selection, else ends it |

The bindings hold only while something is selected (`when: structSelected`, `structItemSelected`), so Tab and Alt + ↑ keep their meaning everywhere else. A key that cannot act (Tab on the first item of a list) says why in the notice of the api layer.

## The write of a structural edit

Every edit of items is computed on the item model and written as text:

<!--renderComp=DiagramText-->
```text
the edit asked (a button, a key, a drop, an api)
  -> an event of the document: editItemLevelRequest { direction, scope }, ...
  -> DocEditStructStore: the open session is left (saved) first; an edit asked
       from the editor of an item takes its draft along instead (one write)
  -> lib/doc-edit-list.js, on a copy of the tree of block.list
       the tree changed: items moved, markers adapted, lists numbered again
       the whole list serialized: the new text of the block
       the new text parsed again, and compared with the tree that was meant
         differs -> refused with the reason; nothing is written
  -> DocEditStore.blockChangeListApply: one hash-checked write
       the block rewritten (or removed, when its last item left; two blocks
       for a move between two lists), recorded in the edit history
  -> the document compiled with the new text; the selection follows the item
```

- **The read-back is the safety of the whole design.** The result of an edit is parsed by the same parser that will render it, and must read as the items that were meant: the same nesting, the same markers, the same texts. Whatever Markdown would do to a text we did not foresee is caught here, before the write, and refused with a reason, rather than found on the page afterwards. For the own text of an item the comparison is lenient about the text itself and strict about everything under and around the item.
- **One write.** The edit is one line operation on the lines of the list block, sent with the hash of the text it was computed on ([Edit api and line operations](doc_page_impl_edit.md#edit-api-and-line-operations)); a conflict is refused like any other. It is one record of the history.
- **Only what changed is rewritten in spirit, the whole list in fact.** The list block is serialized as a whole, and it comes back as it was written wherever it was not changed. One thing is tidied: a lazily indented continuation line is written at the text column of its item.

## The events

A structural edit of an item is an operation of the document, so the toolbar, the editor of an item and the apis report it as an event, and the host application sees it first ([Event layer](doc_page_impl_event.md)). The item is named by the source of the event: `{ sourcePath, blockIndex, itemPath }`. An event from the editor of an item carries no `itemPath`: the item is the one of the open session.

| Event | Data | Answered by |
| --- | --- | --- |
| `editItemEnterRequest` | the click as `point` | `DocEditStore`: the session of the item |
| `editItemInsertRequest` | `{ position: 'before' \| 'after' \| 'child', text? }` | `DocEditStructStore.itemInsert`; without `text`, the new item is created empty and opened. From the editor of an item: a split at the end of its text |
| `editItemSplitRequest` | `{ offsetStart, offsetEnd }`, the caret or the selection in the draft | from the editor of an item: `sessionItemSplit` |
| `editItemMergeRequest` | `{ direction: 'previous' \| 'next' }` | from the editor of an item: `sessionItemMerge` |
| `editItemFormatRequest` | `{ format: 'block', offsetStart, offsetEnd }` | from the editor of an item: `sessionItemBlockFormat`, the item as a text block |
| `editItemDeleteRequest` | `{ scope }` | `itemDelete` |
| `editItemLevelRequest` | `{ direction: 'in' \| 'out', scope, offset? }` | `itemLevelChange`; from the editor of an item: `sessionItemLevelChange`, with the draft, and the item opened again with the caret at `offset` |
| `editItemMoveRequest` | `{ direction: 'up' \| 'down' }` | `itemMoveSibling` |
| `editItemListTypeRequest` | `{ type: 'ordered' \| 'unordered' }` | `itemListTypeSet` |
| `editItemCodeViewRequest` | `{ view: 'card' \| 'plain' \| 'icon' \| '' }` | `itemCodeViewSet`: the view of an item that is a code block, written into it; `''` removes it |
| `editItemCodeAssetRequest` | `{}` | `itemCodeAssetMove`: the lines of an item that is a fenced code block into an item of the store, the item a block of `Code` |
| `editStructDropRequest` | `{ target }` | `dragDropApply`: the selection moved to a place |

The selection itself is state of the page, not a change of the document: it is set by calls of the store.

## The apis

Everything the toolbars do is an api of the [unified api registry](doc_page_impl_api.md), for the keyboard maps, the command palette and callers outside the page (`comp-doc/api/api-struct.js`). An item is located by `block` (the list block, as for the block apis) and `item` (its path); without `item`, the item the author is at, with the scope of the selection.

| Api | Does |
| --- | --- |
| `doc/itemListGet { block?, doc? }` | every item of a list block: path, depth, lines, own text, number of sub-items |
| `doc/itemGet { item?, … }` | one item |
| `doc/itemTextSet { text, item?, … }` | the own text of an item replaced |
| `doc/itemInsert { text?, position?, item?, … }` | a new item beside an item or under it: with `text`, written with it; without, created empty and opened for the author to type |
| `doc/itemDelete { scope?, item?, … }` | an item removed, with what is under it or alone |
| `doc/itemIndent { scope?, … }`, `doc/itemOutdent { … }` | the level of an item |
| `doc/itemMove { direction, … }` | an item swapped with its sibling |
| `doc/itemMoveTo { targetItem, position, targetBlock?, scope?, … }` | an item moved before / after another item or under it, in its list block or another |
| `doc/itemListTypeSet { type, … }` | bullets or numbers for the list of an item |
| `doc/blockMove { direction? \| borderIndex?, block?, doc? }` | a block swapped with its neighbor, or moved to a border |
| `edit/itemEnter { item?, … }` | the text of an item opened for editing |
| `edit/select { block?, item?, scope? }`, `edit/selectGrow`, `edit/selectClear`, `edit/selectionGet` | the selection |
| `edit/selectionMove { direction }`, `edit/selectionEnter`, `edit/selectionDeleteAsk` | the keys of the selection |

A caller outside the page works a list the way it works blocks: `doc/blockListGet` to find the list block, `doc/itemListGet` for its items and their paths, then the edits. Paths belong to a text: after an edit, the answer names the item's new path (`data.itemPath`).

## The layer

`DocEditStructLayer` lies over the edit body (`position: absolute; inset: 0`, no pointer events of its own) and draws, each placed from the rectangle of the element it belongs to:

<!--renderComp=DiagramText-->
```text
.doc-edit-body
├─ the blocks (MdxBody)            the document, as it reads
└─ .doc-edit-struct-layer
   ├─ the frame of the selected item         StructItemFrame
   ├─ the toolbar of an item                 DocEditItemToolbar
   ├─ the editor of the item being edited    DocEditItemEditor
   └─ a drag: veil, line, chip               StructDragOverlay
```

**Nothing is added inside a list.** An item of the edit body is the `<li>` it is in reading mode: no wrapper, no anchor element, no attribute that changes on hover or selection. This is a deliberate difference from the blocks, whose wrappers carry an anchor. Inside a list, an extra element changes which rules of the typography match (`li > p:first-child`), and margins collapse through items and nested lists in ways a measured lock cannot restore. A layer over the list cannot move it at all: [the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule) holds by construction, for hovering, selecting and entering an item alike. What moves a list is its text being typed, and that by a style on an element the list has ([The room of an item being edited](#the-room-of-an-item-being-edited)). A list of any length also costs nothing until an item is pointed at: there is one toolbar, not one per item.

- **Rectangles** come from `struct-geometry.js`: the rows of the own text of an item (from the top of its first line to the bottom of its last one, before its first nested list), the item with what is under it, where its text and its marker start, where its text ends and whether it is one line (what the place of a toolbar and of the editor's bar is decided from), and the lines of the code block of an item that is a text block. They are relative to the body, and measured again when the text of the document or the size of the body changes (a `ResizeObserver`).
- **The hover** of an item is tracked from the element under the pointer (`itemHover` of the store); on the toolbar, the item stays. The toolbar fades in after a moment, so a pointer crossing a list does not flicker. While the author types, the pointer is at rest where it was left, and the toolbar of the item under it would stand beside the text being typed: it goes with the first key typed in an editor, and comes back when the pointer moves a few pixels (a list drawn again under a resting pointer does not bring it back).
- **While a block shows a text just saved** (the list rendered from `blockTextPending`), its items are not the model's yet: the layer shows nothing of them, and a click on the list waits.

A document drawn inside a block (the text of a zettel) has an edit body of its own, and so a layer and gestures of its own.

## Blocks

The structural edits of blocks existed before this design and keep their writes ([Block-level operations](doc_page_impl_block_ops.md)): insert, move up and down, delete, from the toolbar of a block. Structural edit adds to them:

- **Selecting a block** in edit mode (Shift + click, or the grip of its toolbar), which pins its toolbar and gives it the keys of the selection.
- **Dragging a block** to another border of its document (`DocEditStructStore.blockMoveTo`, the write of a move of blocks).
- **A move of the selected block keeps the selection on it** (`selectionBlockMove`), so Alt + ↓ pressed three times moves it three places.

## Deleting a thing

**Design principle: a thing drawn as one unit is deleted from its right-click menu, wherever it stands.** A thing is what the page draws as one unit and the author points at as one: a root-level block, a code block or an MDX block in any view (an icon, a card, plain lines), a formula. Where it stands does not change how it goes: at the root of a document, in the text of a list item, among the words of a paragraph, in a document embedded in an MDX block (its popup), in a text being typed (its chip). The author never has to open a thing's editor, find its source or select its characters to take it out.

- **One menu.** The menu is the menu of the page, the [menu of the selection](#the-menu-of-the-selection); no second menu is made for things. A right click on a thing inside the text of a block heads it with the entry of that thing, `Delete Formula…`, `Delete Code Block…`, `Delete MDX Block…`, then the entries of the block. A right click on a thing that is itself a block (a code block, an MDX block or a `$$` block at the root) opens the menu of the block as it is: its delete is `Delete Blocks…`.
- **A tile is the thing, not a control.** A tile and an MDX card are buttons (a click opens them), but a right click on them is about the thing: the browser's own menu stays only in a field, an editor, the floating area of the block and a popup of the edit layer (`EDIT_CONTEXT_OWN_SELECTOR`).
- **Written or typed.** Outside a text being typed the delete is a write of the file, and the menu asks first, as it does for blocks: `Delete the formula?` Delete · Cancel. In a text being typed (a paragraph or an item open in its editor) the thing is a chip, and its delete is a typed delete, as Backspace twice is: at once, the menu having that entry alone (the block is being edited, so it has no entries of the block), and Undo brings it back; the draft is saved as any draft.
- **What goes with it.** The text around a thing reads as before: a formula in the line takes a space next to it, a thing on lines of its own the line break around it (`atomRemoveSpanGet`, the same for the typed delete and the write). An item left with no text and nothing under it goes with its last thing; a paragraph that was one formula goes with it.

<!--renderComp=DiagramText-->
```text
right click on                  first entry          written by
a root-level block, any view    (the block's menu)   blockListDelete
a formula of a paragraph        Delete Formula…      blockAtomRemove
a formula of an item            Delete Formula…      itemPartRemove
a code / MDX block of an item   Delete Code Block…   itemPartRemove
  (tile, card, plain lines)     Delete MDX Block…
a chip of a text being typed    Delete Formula       a typed delete
                                (alone, not asked)
```

**Which thing.** In a block not being edited, the wrapper of the block finds the thing under the pointer in the rendered block (`blockPartAtGet`, `comp-doc/edit/block-part-at.js`) and names it by its place among the things of its sort, as the model counts them: a code block or MDX block of an item by its place among the code blocks of the item (`[data-code-key]`, the order of `itemCodeBlockListGet`, as [the parts of an item](#code-blocks-in-the-text-of-an-item) are counted), a formula by its place among the elements of its kind in the paragraph or the item (`elementSelector` of the [kind](#atoms-of-a-kind)), leaving out those of sub-items, of code blocks and of embedded documents. The delete then takes that thing out of the text of the model (`itemPartTextWrite` with `isRemoved`, `itemAtomKindTextRemove`) and writes the block (`DocEditStructStore.itemPartRemove`, `DocEditStore.blockAtomRemove`, through `blockChangeListApply`). While the block shows a text just saved, its rendering is not the model's, and the menu has no entry of a thing. In a text being typed the surface asks for the menu itself: a right click on a chip sends `ATOM_MENU_EVENT` (`surface-atom.js`, cancelable) with what the thing is called and how to delete it; the menu of the page takes it for the block of the session (`DocBlockSelectMenu`) and cancels the event, and only then does the surface keep the browser's menu away. A surface no page menu listens to keeps the browser's.

## Block selection mode

Before structural edit existed in edit mode, blocks were selected in a mode of the page of its own, **block selection mode**. It still exists for what edit mode does not offer yet: several blocks selected together, duplicated, deleted, and copied or moved to another place or document through a dialog. It is being merged into edit mode ([TODO](doc_page_impl_TODO.md#edit-structure-merge)); new structural features go into edit mode.

Its switch (`DocBlockSelectToggle`, a list-with-checks icon) sits next to the edit switch, in the document toolbar and in the floating navigation, and exists under the same condition (a development server answering the edit api). The two modes are never on together: switching one on switches the other off, and leaving edit mode leaves its open session, which saves the draft (`DocEditStore.isBlockSelectMode`, `blockSelectModeSet`). Switching the mode on starts with [the blocks the author is at](#the-blocks-the-author-is-at) selected.

The mode shows the body of edit mode, so its blocks are the edit layer's blocks, but nothing in it edits: every root-level block is wrapped in `DocBlockSelectBlock` instead of the editable wrapper (`DocEditBlock` chooses), with the same element and attributes and the same zero-height anchor, so switching between the modes moves nothing on the page. A hovered block gets a dashed outline, a selected one a solid outline and a light tint. Text cannot be selected in the mode. A block that renders nothing (a comment, trailing markers) keeps its chip, and the chip shows the selection.

```text
click               this block only; it becomes the anchor
Ctrl / ⌘ + click    this block in or out of the selection; it becomes the anchor
Shift + click       the blocks from the anchor to this one (with Ctrl / ⌘: added to the selection)
Escape              nothing selected
right click         the menu of the selection
```

A click selects only: links, buttons and fields inside a block do nothing in the mode. The selection belongs to one document and to its text (`DocBlockSelectStore.selection { path, hash, blockIndexList, blockIndexAnchor }`).

### The menu of the selection

A right click on a selected block opens the menu for the whole selection; on a block that is not selected, that block alone becomes the selection, then the menu opens.

**In edit mode too.** A right click on a block that is not being edited opens the same menu, the block alone selected, so a block is deleted, duplicated or moved from where the pointer is, by the same entries and writes (`DocEditBlock`, `DocBlockSelectStore.isContextMenuAvailable`). There the selection lasts only while the menu or its dialog is open, and is not drawn: the menu stands at the block. A right click on a thing inside the text of the block heads the menu with the entry that deletes it, and a right click on a chip of a text being typed opens the menu with that entry alone ([Deleting a thing](#deleting-a-thing)). In the rest of the block being edited, in a field and in the floating area of a block the browser keeps its own menu (spelling, paste); a tile or a card is not such a control. The menu is anchored at the block of the body it was opened in (`.doc-edit-body[data-edit-path]`), so in a [document edited in a popup](doc_page_impl_mdx_embed.md#a-document-in-a-popup) it opens there.

```text
Delete Formula…      only on a thing of the text of the block: "Delete the formula?"  Delete · Cancel
─────
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

The menu is the injected `Menu` (`config.components.Menu`), styled like the mode menu of a block (`DocBlockSelectMenu`). Its state is `DocBlockSelectStore.contextMenu { path, blockIndex, offset, openId, step, status, message }`, and the thing right-clicked `contextMenuPart { label, isTyped, remove() }` (kept by reference: `remove` may be a typed delete of the surface).

- **It stays with its block.** The menu is anchored to the point of the block that was right-clicked (`config.anchor`: the block's rect plus the offset of the click in it), not to the window, so it moves with the block when the page scrolls.
- **Opening again.** A right click while it is open must not leave a stale menu at the old point or reuse the state of the old one: opening is always a close, then an opening on the next animation frame with a new `openId`, by which the menu is keyed. A pointer going down elsewhere closes the menu, and the click of that same gesture only closes: it does not change the selection.
- **Writes from the menu.** Duplicate, Move and Delete write at once (Delete after its confirmation step, which Escape leaves). While the write runs the entries are locked and the menu stays; written, the menu closes and the selection is dropped, since the document has a new text; failed, the menu shows why. Copy / Move To… open [the dialog](doc_page_impl_block_ops.md#the-dialog) instead.

## Files

```text
frontend/src/lib/doc-edit-list.js          the item model of a list block: the positions of a list (listDescribe,
                                           listAnnotate), the tree (listModelBuild), its text (listTextBuild), the
                                           edits (listItemTextSet / Insert / Delete / Indent / Outdent / Move /
                                           MoveSibling / Detach / Attach / ListTypeSet / Split / MergeUp, and
                                           listEditThen for two as one), each read back before it is answered; an
                                           item as a text block (itemBlockFormatGet, itemBlockTextBuild); texts
                                           meeting at a block joined as written (itemJoinIsSource) (pure)
frontend/src/lib/doc-edit-item-atom.js     the atoms of an item: its code blocks as chips, the text the editor
                                           types (one character each) and the text written back (itemAtomModelBuild,
                                           itemAtomTextBuild, itemAtomOffsetDisplayGet); a part, one block among the
                                           text edited as its lines (itemPartGet, itemPartTextWrite); a thing taken
                                           out by its menu (itemAtomKindTextRemove, atomRemoveSpanGet); atoms of a kind
                                           (itemAtomKindAdd, itemAtomValueSet) (pure); .test.js
frontend/src/lib/doc-edit-atom-kind.js     atomKindDefine, atomKindRegistryBuild: the kinds of atoms; .test.js (the
                                           store with a kind: added, typed, saved; a block taken out)
comp-doc/edit/atom-kind-registry.js        the package's kinds of atoms by id (text/math)
frontend/src/lib/doc-edit-block.js         remarkEditBlock marks and describes the list blocks; editDocModelBuild
                                           gives a list block its item model (block.list)
frontend/src/store/DocEditStructStore.ts   the selection and its growth, the hover / menu / confirmation of an item,
                                           the edits of items (itemEdit: session left, computed, written, selection
                                           followed), the edits asked from the editor of an item (sessionItemEdit:
                                           the draft taken along, one write, the next item opened), the keys kept
                                           through such an edit (typeAhead...), blocks moved, the drag, eventHandle
                                           (structEventTypeList)
frontend/src/store/DocEditStore.ts         the session of an item (sessionItemStart, its save and its cancel, a new
                                           item removed again, sessionDiscard), the focus shift through items,
                                           blockChangeListApply (the write of a structural edit)
comp-doc/edit-structure/                   DocEditStructLayer (the layer: frame, toolbar place, DocEditItemEditor,
                                           the drag), DocEditItemToolbar (the toolbar, the list menu, the delete
                                           confirmation), use-struct-pointer.js (Shift + click, Shift + drag, the
                                           grip, the hover, scrolling under a drag), struct-geometry.js (elements,
                                           rectangles, dropTargetFind, itemRoomOpen: the room of an item being
                                           edited), DocEditStruct.css
comp-doc/edit/DocEditBlock.jsx             a click on a list block opens the item under it; the selected block; a
                                           right click: the menu of the block, headed by the thing under it
comp-doc/edit/block-part-at.js             the thing drawn as one unit under a right click in a block not being
                                           edited (blockPartAtGet): a code / MDX block or a formula, by its place
comp-doc/edit/DocEditBlockToolbar.jsx      the grip of a block; a move of the selected block
comp-doc/edit/DocEditBody.jsx              the layer; data-struct-selected / data-struct-dragging of the body
comp-doc/edit/EditSourceSurface.jsx        onKeyDownFirst: the keys an editor takes before the surface, with the
                                           place of the caret in the text; atomModel: chips in the text
comp-doc/edit/surface-atom.js              the chips of a surface: written and read, spacers, the keys over them,
                                           the selection marked, a double click asking to open one; a chip of a kind
                                           drawn by its kind (surfaceAtomKindRender); a right click asking for the
                                           menu of its thing (ATOM_MENU_EVENT)
comp-doc/edit/caret-place.js               the caret at an offset of the text
built-in/comp-mdx/text/ListItem.jsx, ListItemEdit.jsx   the default editor of a list item (common/ListItem): the
                                           keys of an item
frontend/src/DocPageMdx.css, DocPageMdx.jsx   the spacing of the lists of a document, from ListItemGap and
                                           ListMarkerGap (lib/doc-config-define.js)
frontend/src/lib/rehype-list-item.js       an item without a text of its own marked, so that it is a row
comp-doc/api/api-struct.js                 the apis of items, of a block move, of the selection
main/hotkey/default.yaml                   the keys of the selection
comp-doc/block-select/                     block selection mode: DocBlockSelectToggle, DocBlockSelectBlock,
                                           DocBlockSelectMenu, DocBlockTransferPopup (+ DocBlockSelect.css)
frontend/src/store/DocBlockSelectStore.ts  the selection of that mode, its menu (with the thing right-clicked,
                                           contextMenuPart), the blocks the author is at
frontend/src/lib/doc-edit-list.test.js     the item model and every edit, with the texts they write
frontend/src/lib/doc-edit-struct.test.js   the selection, the edits and the item session over the stores; the place
                                           of a drag
example_doc/mdx-doc-edit-structure.md      the playground document
```
