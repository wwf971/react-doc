<!-- Design of the fenced code blocks of a document: their views, and which view a block gets. Parent document: doc_page_impl.md. A code block as a list item: doc_page_impl_mdx_li.md; editing such an item: doc_page_impl_edit_structure.md -->

# Fenced Code Blocks: Design

A fenced code block of a document is highlighted when the document is compiled and drawn by the `pre` component of the document body. The same lines can be drawn in more than one way, and which way is right depends on what the block is: a piece of code set apart from the text, a few lines of text whose line breaks must be kept, standing in a list among other lines, or lines the reader needs only now and then, kept out of the way behind a small chip. These ways are the **views** of a code block. An author chooses the view of a block in its text or from the page in edit mode, and can move its lines into the [asset service layer](doc_page_impl_asset.md), where the block reads them from an item.

<!--renderComp=DiagramText-->
````text
card                                        plain

╭────────────────────────────────╮          • second item
│                                │            • ┌──────────────────────────┐
│  const a = 1;                  │              │ Example Trading Co.      │
│  const b = 2;                  │              │ 1 Harbor Street          │
│                                │              └──────────────────────────┘
╰────────────────────────────────╯            • a plain item after it

a block set apart from the text:            lines that stand where plain text would:
its own background, rounded corners,        a quiet frame, lines as high as the lines
room around its lines, lines as tight       of the text around the block, and a block
as code                                     of text in the font of that text
````

## Core concepts

- **A view** is a way a code block is drawn: `card`, `plain` or `icon`. The lines, the highlighting and the copy button are the same in every view; the icon view shows them in a dialog.
- **The view of a block** is decided per block: by its author, in the info string of the fence, else by the config of the document for the place the block stands in.
- **The place** of a block is where it stands in the document, as far as the default view depends on it: a block of the document, a block that **is a list item** (the whole text of the item), or a block **in a list item** among its text. Each place has its default view ([Which view a block gets](#which-view-a-block-gets)).

## The views of a code block

| | `card` | `plain` |
| --- | --- | --- |
| Frame | a soft border, corners with a large radius, a light shadow | a soft line (15% of the text color), corners with a radius of 3 px, no shadow |
| Background | the card color | a tint that is barely there (2.5% of the text color): the page shows through |
| Room inside | 14 px above and below the lines, 16 px beside them | 3 px above and below, 10 px beside them |
| Lines | the size and the line height of code | as high as a line of the text around the block |
| Font | the code font | a block of text (language `text`): the font, the size and the color of the text around it, long lines wrapped. Code: the code font, a little smaller than the text, lines not wrapped |
| Distance to what is around | the distance of a block | none of its own: its first line is as far from the line above as a line of text would be |
| Copy button | always shown, in the corner | in the corner, shown while the pointer is on the block |

`card` is the look of the Fumadocs code block, unchanged. `plain` is made for lines that belong to the text around them.

**A block of text is text.** A fenced block of language `text` (also `txt`, `plaintext`, `plain`) holds no code: it is the way Markdown keeps line breaks, and what Shift + Enter in a list item writes. In the plain view it is set in the type of the text around it and wraps like text, so it reads as lines of the document with a frame around them, not as a terminal. A block of code keeps the code font, since its columns mean something. The compile writes the language of every block as `data-language` (`codeLanguageTransformer`), and the stylesheet tells the two apart by it.

The frame is deliberately quiet. A dark line around a few words is louder than the words; a soft line with the faintest tint says "these lines belong together" and leaves the text the first thing read.

### The plain view keeps the rhythm of text

A frame takes room that a line of text does not: its line, and the room between it and the lines inside. In a list, where every pair of lines has the same gap ([The spacing of a list](doc_page_impl_mdx_li.md#the-spacing-of-a-list)), that room would push the first line of the block away from the line above it. The plain view gives the room back with a negative margin of exactly its size, above and below:

<!--renderComp=DiagramText-->
```text
• second item
      ↕ the gap of the list                    the frame and its room (4 px) lie
  • ┌─────────────────────────┐   ┐            inside this gap: the margin of the
    │ Example Trading Co.     │   │ a line     block is minus that room
    │ 1 Harbor Street         │   ┘
    └─────────────────────────┘
      ↕ the gap of the list
  • a plain item after it
```

So the first line of the block stands where the line of a plain item would stand, every line inside is one line of text high, and the line after the block follows at the gap of the list. A block of several lines reads as several lines of text with a frame drawn around them. The frame is not moved sideways: the lines start one room (11 px) right of where the text of an item starts, so the frame never runs through the marker of the item.

Outside a list a plain block is a block of the document and keeps the distance of a block above and below, less the room of its frame. Next to a tile in a list item it keeps its room: the tile reaches the edge of its line, where a line of text leaves room the frame could take, so the frame stands the margin of the tile (2 px) away from it.

### The icon view

The icon view draws the block as a square tile, as a file stands in a folder, and its lines in a code editor when the tile is clicked (`CodeIconView`):

<!--renderComp=DiagramText-->
```text
┌────────┐
│   ▤    │       a block of the document: a tile of its own, with the
│setup.py│       distance of a block
└────────┘
• first step
  ┌────────┐     a list item: the tile in the line of the item, its bottom
  │   ▤    │     edge on the bottom edge of the line (CodeBlockIconAlign)
• │  bash  │
  └────────┘
      ┌──────┐      ┌──────┐     in the text of an item: tiles in its line,
      │  ▤   │      │  ▤   │     a space from the text beside them; an item
• see │weekly│ then │  sh  │     holds as many as it likes
      └──────┘      └──────┘
```

- **The tile** says what the lines are: a code icon over the title of the block (`title="…"` of its fence), else its language (`text` for a block of text), cut to the width of the tile; the number of lines is said on hover. It has the quiet frame of the plain view. It is a button: in edit mode a click on it opens the dialog and does not enter the block.
- **In a list item** a tile stands in the line of the item, whether it is the whole item or stands among text and other tiles: a block written under the text of an item (a fence on lines of its own) is drawn in that line, since a list without blank lines puts the text and the blocks of an item side by side, a space apart. By default its bottom edge is on the bottom edge of the line, so the text stands beside its lower part and the line below follows at the gap of the list; the doc-scope key `CodeBlockIconAlign` (`bottom`, `top`) puts its top edge at the top of the line instead. A block of another view takes a line of its own in an item (the text before it ends a line, the text after it starts one), which is not the whole item. No block has to be the whole item. The editor of the item shows each block as a chip of its text, typed around, never as its lines ([Code blocks in the text of an item](doc_page_impl_edit_structure.md#code-blocks-in-the-text-of-an-item)).
- **The dialog** is `PanelPopup` of the page ([A dialog of a component](doc_page_impl_popup.md#a-dialog-of-a-component)), moved by its header, resized by its edges, maximized, closed by its button or Escape; every code block opens the one dialog place (`docCodeLines`), so its size is kept from one block to the next. It shows the lines in a **code editor**, a text too: line numbers, folding of what can be folded, the words colored by their language, in View or in Edit ([Editing the lines](#editing-the-lines)).

The icon view is a view like the others: written by the author (`view=icon`), or given by the config for the place of the block (`CodeBlockView: icon` turns every block of a document into tiles).

### Editing the lines

The dialog of the icon view has two modes, switched in its header, like the [block popup](doc_page_impl_popup.md#view-and-edit):

<!--renderComp=DiagramText-->
```text
setup.py          sql [Copy] [⇧ To asset] [👁 View | ✎ Edit] [⤢] [×]   View, lines in the document
setup.py          sql [Copy] [⏱ Asset]    [👁 View | ✎ Edit] [⤢] [×]   View, lines in the asset store
setup.py [sql ▾] [✓ Save] [× Cancel] [⇧ To asset] [👁 View | ✎ Edit] [⤢] [×]  Edit
──────────────────────────────────────────────────────────────
 1 ˅ select e.cr_enrollmentid,
 2     c.cr_name as course
 3   from cr_enrollment e
```

- **View** shows the lines read only, with their language beside the actions (they can be selected and copied, and **Copy** copies them all); **Edit** makes them editable, and the language and the actions of the editor stand in the header line: **Save** writes them and goes back to View (a save that fails stays in Edit, with its message), **Cancel** drops the changes and goes back to View. Ctrl/⌘ + S and Ctrl/⌘ + Enter save; Escape in Edit is Cancel, in View it closes the dialog.
- **The language** is a field in Edit: the languages met most, each highlighted by the page and by the editor, are listed below it (`comp-doc/code-editor/code-lang-list.js`: all of them when it opens, those matching what is typed after, by name or alias: `py`, `sh`, `yml`), and any other word is taken as typed (a language the page does not highlight is shown plain). ArrowDown / ArrowUp and Enter choose, Escape closes the list without leaving the dialog. The editor colors the draft by it at once, reconfigured in place (the text, the caret and the history stay). Save writes it with the lines: the first word of the info string of a fence, its attributes kept (`codeInfoLangSet`; one word, no backtick), the `lang` of the asset item of a block of `Code` whose lines are in the store (`itemMetaSet`), the language of the fence of a block of `Code` written inline.
- **Every view has the dialog.** A block of another view has the same dialog, drawn only while it is open (`CodeLinesDialogHost`): it opens from the editor of a list item, a double click on the chip of the block. Every code block registers how its dialog opens under its key (`useCodeLinesOpener`, `codeLinesOpen` of `comp-doc/code-editor/code-lines-open.js`), and its element carries the key as `data-code-key`.
- **The asset service layer, from the dialog.** A block whose lines are in the document has **To asset**, asked in the header first (`Move the lines into the asset store? [Move] [Keep]`): its lines become an item of the store and the block a block of `Code` reading it ([below](#the-lines-in-the-asset-service-layer)), whatever the block stands in (`DocEditStore.codeFenceAssetMove`), and the dialog of that block opens where this one was. A block whose lines are an item has **Asset** in its place, the asset panel of the item (its versions and history). Both are buttons, never entries of a menu; To asset waits while the lines being edited are not saved, and is greyed out, with the reason, where the document or the store cannot be written. This is how a block standing in the text of an item, which has no toolbar of its own, reaches the store.
- **It opens in Edit** when the document is in edit mode and the lines can be written, in View otherwise. Edit is greyed out, with the reason, where they cannot: a built page, a document of a read-only package, an asset store that is not writable.
- **Where the lines are written.** A fenced block (of the document, a list item, or a block in the text of an item) is found in the source by the line of its fence: the compile puts it into the info string before highlighting (`rehypeCodeLine`, `__line=…`, never written by an author), and it reaches the `pre` of the block as `data-source-line`, counted without the frontmatter as the line of a component block is. `DocEditStore.codeFenceLinesWrite` reads the document's model (from reading mode too), finds the root-level code block whose fence starts there or the deepest list item whose own text has that line, takes the block out of that text (`codeBlockInTextReplace`: from its fence, or the marker before it, to its closing fence), replaces the lines inside the fence (`codeBlockValueTextSet`: the fence and its info string kept, the fence grown when a new line could close it) and writes the block, so it works wherever the page can write documents, in reading mode as well. A block of `Code` saves its lines as its data (`dataReplaceRequest { raw, lang? }`, `lang` when the language changed): into its asset item when they are in the store, the document untouched, or into the block when they are written inline.
- **The dialog outlives the block.** A save rewrites the block, which mounts anew; what the dialog holds (open, its mode, the draft, a save in flight) is kept by the [component state layer](doc_page_impl_mdx_comp_state.md) under the block's key (`fence:{document}#{line}` for a fence, the component's state key for `Code`), so the dialog stays as it was.
- **The editor** (`comp-doc/code-editor/CodeEditor.jsx`) is CodeMirror 6, a dependency of the package loaded the first time a dialog opens (its modules are a chunk of their own, not part of the page's first load). The language is found by name or alias among those CodeMirror knows (`@codemirror/language-data`, each loaded when first asked for); a language it does not know, and text, are shown plain, a text with its long lines wrapped. Its look is the page's: the card color, the mono font, a gutter in a quiet color, the line of the caret marked while editing, the words in a few colors for light and dark (`CodeEditor.css`, the classes of the highlighter).

## Which view a block gets

<!--renderComp=DiagramText-->
````text
```text view=plain          1. the view its author wrote in the info string of the fence
                               (view=plain, view="plain"; with title="…" and the others, in any order)
                            2. else the config of the document, by the place of the block:
                                 the block is a list item        CodeBlockViewAsListItem  (default plain)
                                 in a list item, among its text  CodeBlockViewInListItem  (default plain)
                                 a block of the document         CodeBlockView            (default card)
````

- **The info string.** `view=…` (`card`, `plain`, `icon`) is read with the other attributes of the fence (`codeMetaParse`, the `parseMetaString` of `rehypeCode`) and reaches the block as `data-view`. A view the page does not have is ignored, and the place decides.
- **The config keys** are doc-scope keys of the [config system](doc_page_impl_config.md#the-default-layer): a doc page, a source rule or the frontmatter of one document sets them, and a change in the settings panel shows at once, since the view is resolved when the block is drawn, not when the document is compiled.
- **A block that is a list item** is a fenced block that is the whole text of a list item: nothing stands before it in the item, and nothing after it but the lists under the item. It is what Shift + Enter in the editor of a plain item writes, an item whose line breaks are kept ([A text block](doc_page_impl_edit_structure.md#a-text-block)). `rehypeCodePlace` marks it `data-place="listItem"` after the highlighting.
- **A block in a list item** stands in the text of the item among other things: under its text (the command of a step), between two lines of it, beside other blocks. It is what Shift + Enter writes in the text of an item that holds code blocks ([Code blocks in the text of an item](doc_page_impl_edit_structure.md#code-blocks-in-the-text-of-an-item)). `rehypeCodePlace` marks it `data-place="inListItem"`; its default is `plain` too, so lines written in a list look like lines of the list wherever they stand (set `CodeBlockViewInListItem: card` for the card there). A block inside a component of an item is not marked, and takes `CodeBlockView`.
- **The place of a component block** is marked the same way by `remarkCommentComp` (`place="listItem"`, `place="inListItem"`), and reaches the component as `config.place`: the component `Code` takes the view of the config for it, and any component may declare a view mode as the default of a place ([View modes and edit modes](doc_page_impl_mdx_comp.md#view-modes-and-edit-modes): `isDefaultInPlaceList`).
- **A place that changes.** When text typed beside a block in the editor of the item (or taken away) changes its place, a view it had from the config is written into it, so it keeps its look.

A view is not a [view mode](doc_page_impl_mdx_comp.md#view-modes-and-edit-modes) of a component. A view mode is the reader's choice for one block, kept for the session; the view of a code block belongs to the document: written by its author (in its text, or from the page below) or set by config.

## Changing the view from the page

In edit mode the view of a code block is chosen from the page and **written into the block**, the same text an author would type:

| the block | where the choice is | what is written |
| --- | --- | --- |
| a fenced code block of the document | the mode menu of its toolbar (the `modes` button, [The mode menu](doc_page_impl_edit.md#floating-controls)): a **View** section | `view=…` in the info string of its fence |
| a list item that is a code block | the list menu of the item's toolbar: a **Code block** group, first ([The toolbar of an item](doc_page_impl_edit_structure.md#the-toolbar-of-an-item)) | the same, in the item's own text |
| a block of the component `Code` (its lines in the store, below) | the same menus | `view=…` on its marker |

<!--renderComp=DiagramText-->
```text
View ──────
Card
Plain              [current]     the view the block has
Icon
By config (card)                 none of its own: the config decides
Edit mode ──────
Source             [default, built-in]
```

**By config** removes the block's own view, so the config of the document decides by where the block stands; its label says what that gives (`By config (plain)` for a list item). A fence that names no language gets `text` before its view, since the first word of an info string is the language (`codeBlockViewTextSet`). The write is one replacement of the block (`DocEditStore.blockCodeViewWrite`) or of the item (`DocEditStructStore.itemCodeViewSet`, through the event `editItemCodeViewRequest`), with the history of every edit of the page; the text helpers are `lib/doc-edit-code.js` (`codeTextViewGet`, `codeTextViewSet`), which read and write the view of both forms.

## The lines as text

A code block can be turned into text of the document: its lines joined into **one line of text**, the line breaks removed, in the place of the block (`codeTextJoin`, `lib/doc-edit-code.js`). Each line is trimmed and the empty ones dropped; two lines are joined with a space, but between two CJK characters, where text has no space. The line is text from then on: a start Markdown would read as another block (`#`, `>`, `- `, `1.`, a fence, html) is escaped, the rest is left as it is. **To text** is where the other actions on a block are:

| the block | where | what it writes |
| --- | --- | --- |
| a code block of the document | the mode menu of its toolbar, a **Convert** section | a paragraph (an `Anchor` before the block stays) |
| a list item that is a code block | the Code block group of the list menu of the item | the item a plain item |
| an item edited as the lines of a code block (the whole item, or a block among its text) | **To text** in the bar of the editor of the item | the line in the place of the block; among text, joined to the line of text before and after it |
| a chip of the text of an item | **To text** in the bar, the chip selected (a click on it) | the line in the place of the chip, in the text being typed |

The lines of a block of `Code` reading an item of the store are not in the document: those blocks cannot be turned, and the entry says why. Whatever the view of the block (card, plain, icon), the result is the same.

## The lines in the asset service layer

The lines of a code block can move out of the document into an item of the [asset service layer](doc_page_impl_asset.md): versioned, edited in the asset panel, read by several documents. A reference to an item is a component block ([The reference in a document](doc_page_impl_asset.md#the-reference-in-a-document)), so the block becomes a block of the component **`Code`**, which draws lines from its data exactly as a fence draws its own:

````text
```python view=icon title="a.py"   <!--renderComp=Code,view=icon,title=a.py-->
def add(a, b):              ──►    ```asset
    return a + b                   store: local
```                                itemId: w6hiawfxu6m
                                   ```
````

- **Moving.** A root-level code block has the `to asset` button in its toolbar, as a component block with inline data has, asked first in the toolbar (`Move the data of this block into the asset service layer? [Move] [Keep]`). A list item that is a fenced code block has the same button in the toolbar of the item, asked first the same way (`Move the lines of this item into the asset service layer? [Move] [Keep]`, `itemCodeAssetConfirm`, `DocEditStructStore.itemCodeAssetMove`). A block drawn as an icon has **To asset** in the header of its dialog ([Editing the lines](#editing-the-lines)), the one way for a block in the text of an item. Every way is a button, and moved, the block has the asset button in the same place: in the toolbar of the block or the item, or **Asset** in the dialog. Either way the item is created first and the document written last, as every move into the store ([Moving inline data into the store](doc_page_impl_asset.md#moving-inline-data-into-the-store)): the item gets the lines, the language of the fence (`text` for none) as its `lang`, a file of that language (`.py`, `.sh`, `.txt`: the store knows the languages of code, `text/plain`), no name, `component: Code`, and the note `code block moved from …`; the block becomes the marker of `Code` with the view and the title of its info string (a title loses its commas, which the marker cannot hold), and a fence of language `asset` with the reference by id. Lines before the fence (an `Anchor` of the block) stay where they are.
- **Drawing.** `Code` (`built-in/comp-mdx/text/Code.jsx`, registered as `common/Code`, tag `Code`) receives the item's text and language as every component receives an item's data ([Resolution](doc_page_impl_asset.md#resolution-the-runtime-boundary)), highlights them in the page (`DynamicCodeBlock`, since they are not part of the compiled document), and draws the same figure with the same attributes (`data-view`, `data-language`, `data-place`), so each view looks as for a fence, the icon view included. Its view is `view` of its marker, else the config by its place. **The place** of a component block is marked like a fence's: `remarkCommentComp` gives a component block that is the whole text of a list item `place="listItem"`, which reaches the component as `config.place`, so a moved list item keeps its plain look.
- **Editing.** The lines are the item's, changed in its asset panel (the `asset` button of the toolbar, which saves by the item's save mode); the block is the reference, edited as source. Written inline (`<!--renderComp=Code-->` before a fence of any language), `Code` draws those lines the same way. `Code` is not offered by the insert menu: a block starts as a fenced code block, which is the form to write.

## Implementation

<!--renderComp=DiagramText-->
```text
compile (mdx-compile.js)
  rehypeCode { parseMetaString: codeMetaParse,      view=… of the info string -> data-view of the <pre>
               transformers: codeTransformerList }  its language -> data-language
  rehypeCodeLine (before rehypeCode)                the line of a fence -> data-source-line
  rehypeCodePlace                                   a block that is a list item -> data-place="listItem"
  remarkCommentComp                                 a component block that is one -> place="listItem"
render (mdx-comps.js: comps.pre)
  CodeFenceTag                                      data-view ?? config of the document for the place
    -> <figure class="shiki" data-view="plain" data-place="listItem">     the Fumadocs code block
    -> icon: CodeIconView, the tile; the lines in a code editor in the dialog (CodeEditor)
  Code (common/Code)                                the lines of an item, DynamicCodeBlock, the same figure
style (code-fence.css)
  figure.shiki[data-view='plain'] { … }             the look of a view is css of that attribute
  .doc-code-icon                                    the tile of the icon view
```

For `card` and `plain` the component adds nothing but the attribute: a view is a look, and the block is the same element. That is also what lets the editor of a list item lie over the lines of a text block in those views: it reads the type and the box of the rendered lines, whatever view drew them. The icon view is the one that draws something else in the block's place: a tile, and the lines in an editor in the dialog.

## Files

```text
frontend/src/lib/rehype-code-view.js        CODE_VIEW_LIST, codeMetaParse (the info string), codeTransformerList
                                            (the language), rehypeCodeLine (the line of a fence), rehypeCodePlace (the
                                            place of a block), the view, the language and the title of an info string
                                            read and written (codeInfo*)
frontend/src/lib/rehype-code-view.test.js   the info string and the places, tested
frontend/src/lib/doc-edit-code.js           the text of a code block changed from edit mode: its view (codeTextViewGet,
                                            codeTextViewSet, both forms), the block of Code reading an item
                                            (codeBlockAssetTextBuild, codeBlockAssetDataGet), its lines replaced
                                            (codeBlockValueTextSet), a block found by its fence inside a longer text
                                            (codeBlockInTextReplace), the lines as one line of text (codeTextJoin,
                                            textJoinSpaceIs); doc-edit-code.test.js
frontend/src/lib/doc-edit-item-atom.js      the code blocks of a list item as chips of the text its editor types
                                            (doc_page_impl_edit_structure.md#code-blocks-in-the-text-of-an-item)
built-in/comp-mdx/text/CodeFence.jsx        codeFenceTagCreate: the "pre" component of the document body, which
                                            resolves the view
built-in/comp-mdx/text/CodeIconView.jsx     the icon view: the tile, and the dialog of the lines with View and Edit
                                            (its state, CodeLinesStore, kept by the component state layer); the
                                            dialog of a block of another view (CodeLinesDialogHost)
comp-doc/code-editor/CodeEditor.jsx         the code editor: CodeMirror 6, loaded on first use; CodeEditor.css its look
comp-doc/code-editor/code-lang-list.js      the languages offered for a code block, codeLangSearch
comp-doc/code-editor/code-lines-open.js     the dialog of the lines of a block opened from elsewhere, by its key
built-in/comp-mdx/text/Code.jsx             the component Code: lines from its data, in the views of a fence
built-in/comp-mdx/text/code-fence.css       the look of the plain view, of the tile and of the dialog
frontend/src/lib/remark-comment-comp.js     place="listItem" on a component block that is a list item
frontend/src/lib/doc-config-define.js       CodeBlockView, CodeBlockViewAsListItem, CodeBlockViewInListItem,
                                            CodeBlockIconAlign
frontend/src/lib/mdx-compile.js, mdx-comps.js   where the two halves are plugged in
comp-doc/edit/code-view-entry.js            the views as entries of a menu (the mode menu, the list menu of an item), and
                                            To text (codeTextEntry)
frontend/src/store/DocEditStore.ts          blockCodeViewGet / blockCodeViewWrite, the code branch of the move into
                                            the store, codeAssetItemCreate, codeFenceLinesWrite (the lines of a fence)
                                            and codeFenceAssetMove (its lines to the store), both through
                                            codeFenceTextChange (the fence found wherever it stands)
frontend/src/store/DocEditStructStore.ts    itemCodeViewGet / itemCodeViewSet, itemCodeAssetMove, itemCodeAssetConfirm*,
                                            itemCodeAssetRefGet (the item a block of Code reads: the asset button)
```
