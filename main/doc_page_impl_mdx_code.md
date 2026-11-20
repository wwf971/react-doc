<!-- Design of the fenced code blocks of a document: their views, and which view a block gets. Parent document: doc_page_impl.md. A code block as a list item: doc_page_impl_mdx_li.md; editing such an item: doc_page_impl_edit_structure.md -->

# Fenced Code Blocks: Design

A fenced code block of a document is highlighted when the document is compiled and drawn by the `pre` component of the document body. The same lines can be drawn in more than one way, and which way is right depends on what the block is: a piece of code set apart from the text, or a few lines of text whose line breaks must be kept, standing in a list among other lines. These ways are the **views** of a code block.

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

- **A view** is a way a code block is drawn: `card` or `plain`. The lines, the highlighting and the copy button are the same in every view.
- **The view of a block** is decided per block: by its author, in the info string of the fence, else by the config of the document for the place the block stands in.
- **The place** of a block is where it stands in the document, as far as the default view depends on it. One place is told apart: a block that **is a list item**, the whole text of the item.

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

Outside a list a plain block is a block of the document and keeps the distance of a block above and below, less the room of its frame.

## Which view a block gets

<!--renderComp=DiagramText-->
````text
```text view=plain          1. the view its author wrote in the info string of the fence
                               (view=plain, view="plain"; with title="…" and the others, in any order)
                            2. else the config of the document, by the place of the block:
                                 the block is a list item      CodeBlockViewAsListItem   (default plain)
                                 anywhere else                 CodeBlockView             (default card)
````

- **The info string.** `view=…` is read with the other attributes of the fence (`codeMetaParse`, the `parseMetaString` of `rehypeCode`) and reaches the block as `data-view`. A view the page does not have is ignored, and the place decides.
- **The config keys** are doc-scope keys of the [config system](doc_page_impl_config.md#the-default-layer): a doc page, a source rule or the frontmatter of one document sets them, and a change in the settings panel shows at once, since the view is resolved when the block is drawn, not when the document is compiled.
- **A block that is a list item** is a fenced block that is the whole text of a list item: nothing stands before it in the item, and nothing after it but the lists under the item. It is what Shift + Enter in the editor of an item writes, an item whose line breaks are kept ([A text block](doc_page_impl_edit_structure.md#a-text-block)). `rehypeCodePlace` marks it `data-place="listItem"` after the highlighting. A block **under** the text of an item (the command of a step) is a block of its own and takes `CodeBlockView`, as does a block inside a component of an item.

A view is not a [view mode](doc_page_impl_mdx_comp.md#view-modes-and-edit-modes) of a component. A view mode is the reader's choice for one block, kept for the session and offered in the mode menu; the view of a code block is written by the author or set by config, and a fenced code block is no registered component with a menu of modes. The two could meet later: a registered code block component could offer the views as its view modes, with the authored view as the default.

## Implementation

<!--renderComp=DiagramText-->
```text
compile (mdx-compile.js)
  rehypeCode { parseMetaString: codeMetaParse,      view=… of the info string -> data-view of the <pre>
               transformers: codeTransformerList }  its language -> data-language
  rehypeCodePlace                                   a block that is a list item -> data-place="listItem"
render (mdx-comps.js: comps.pre)
  CodeFenceTag                                      data-view ?? config of the document for the place
    -> <figure class="shiki" data-view="plain" data-place="listItem">     the Fumadocs code block
style (code-fence.css)
  figure.shiki[data-view='plain'] { … }             the look of a view is css of that attribute
```

The component adds nothing but the attribute: a view is a look, and the block is the same element in every view. That is also what lets the editor of a list item lie over the lines of a text block in any view: it reads the type and the box of the rendered lines, whatever view drew them.

## Files

```text
frontend/src/lib/rehype-code-view.js        CODE_VIEW_LIST, codeMetaParse (the info string), codeTransformerList
                                            (the language), rehypeCodePlace (the place of a block)
frontend/src/lib/rehype-code-view.test.js   the info string and the places, tested
built-in/comp-mdx/text/CodeFence.jsx        codeFenceTagCreate: the "pre" component of the document body, which
                                            resolves the view
built-in/comp-mdx/text/code-fence.css       the look of the plain view
frontend/src/lib/doc-config-define.js       CodeBlockView, CodeBlockViewAsListItem
frontend/src/lib/mdx-compile.js, mdx-comps.js   where the two halves are plugged in
```
