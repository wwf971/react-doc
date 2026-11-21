<!-- Design of components as list elements, and of how the source of a list item is written. Parent document: doc_page_impl.md. The page editing list items one by one: doc_page_impl_edit_structure.md -->

# Components in Lists: Design

A component should be usable as an element of a list item at any depth, in ordered and unordered lists. Components that span several source lines, or that render as a rectangular block (a code block, an image, a diagram), are the important case. This document explains why that is hard in Markdown, which writing styles were considered, and the stipulated style. The same rules are what the page follows when it writes a list itself, an item edited or moved in edit mode ([Items written by the page](#items-written-by-the-page)). The user-facing version with live examples is the example document `example_doc/comp-custom-list-el.md`.

## The problem

Many Markdown-based note tools, such as Notion and Obsidian, make it hard to put a code block inside a list item. Even when it works, the author does not know the exact rule, so it feels fragile: a small indentation change moves the block out of the list, or turns it into plain text. Single-line components are easy:

```markdown
- <CompA ... />
  - some text <CompB ... /> some more text
```

Multi-line sources are the hard part, and different tools disagree about them:

````markdown
- aaa
   - ```
a code block
```
````

The goal is one writing style that:

1. is pleasant to read in source: the block looks like part of the list item;
2. is parsed the same way by this project's pipeline and by common Markdown renderers;
3. keeps the [degradation-compatible style](doc_page_impl.md#graceful-degradation-stipulation): a comment marking a code block, so a normal Markdown renderer shows a readable block nested in the list;
4. lets the component follow the item's text, and lets text continue after the block within the same item.

## How Markdown decides what belongs to a list item

CommonMark, which GFM, remark (this project), markdown-it, and marked all follow, decides by columns:

```text
- parent item
  - as shown in this image<!--renderComp=Image-->
    ```yaml
    src: dog.png
    ```
    there is a dog.
^ ^ ^
| | └ text column of the nested item
| └ text column of the parent item
└ list marker
```

- **Text column.** The column where the item's text starts after the marker: 2 for `- `, 3 for `1. `, 4 for `10. `. A line belongs to the item when it is indented to at least this column. Only a paragraph's continuation line may be less indented ("lazy continuation"); a fence line may not.
- **Fenced block.** A fence may start at the text column (up to 3 more spaces are tolerated). It ends exactly at a closing fence line that contains only backticks. Lines inside keep their extra indentation.
- **Interrupting text.** A fence, and an HTML comment on its own line, may start directly below a text line without a blank line. Neither needs a blank line before or after it.
- **Comment in text.** A comment written after text on the same line is not a block; it becomes the last inline node of that paragraph.
- **Unfenced blocks.** A table or a quote has no closing line. It ends only at a blank line, so a text line directly below it is absorbed (as a table row, or as quoted text by lazy continuation).
- **Blank lines.** A blank line between blocks of an item makes the whole list "loose": text lines become separate paragraphs with paragraph spacing.

## Writing styles considered

| Style | Result | Decision |
| --- | --- | --- |
| Comment and block at the item's text column | Nested in the item in every tested renderer | Stipulated |
| Block at a smaller column, e.g. the parent's text column | The block leaves the item and lands in the parent item | Rejected |
| Block 4 or more spaces past the text column after a blank line | An indented code block that shows the fences as text | Rejected |
| Text right after the closing fence: `` ```there is a dog. `` | Not a closing fence; the code block swallows the rest of the item | Rejected |
| Comment at the end of the text line | Parsed as part of the text line; needs one extra step in the remark plugin | Accepted |
| Comment on its own line, or at the start of the item | Parsed as a comment block directly before the code block | Accepted |
| Custom container syntax (`:::`, directives) | Not portable; shown as literal text by most renderers | Rejected |
| JSX in `.mdx` | Native MDX parsing at the same text column, including multi-line JSX and children | Accepted, `.mdx` only |

The first idea for trailing text, writing it directly after the closing fence, came from the worry that text below the block might fall out of the item. It does not: text at the text column after a fenced block is a new paragraph of the same item. The fence-attached form is the one that breaks.

## Verification

Each style above was parsed by four implementations, and they agree on every case, including the rejected ones:

```text
remark / micromark   this project's pipeline (md and mdx formats)
commonmark.js        CommonMark reference; same rules as GitHub's cmark-gfm
markdown-it          VS Code preview and many editors and site generators
marked               many lightweight tools
```

`frontend/src/lib/mdx-compile-list-element.test.js` keeps the project-pipeline cases as tests: code block, `Image`, `FileTree`, `DiagramMermaid`, `StockTable`, `BlockSimple`, `MultiLang`, and an inline `Tag`, in unordered, ordered, third-level, and loose lists; the rejected styles; and JSX in `.mdx`.

## Stipulation

1. Indent the marker comment, both fence lines, and every line of the block to the text column of the list item.
2. Place the comment at the start of the item, at the end of a text line, or on its own line below the text. In every case it marks the block on the next lines.
3. Continue the item's text on its own line after the closing fence, at the text column. Never write text after the closing fence.
4. Prefer fenced blocks. Wrap a table in a fence; after an unfenced table or quote, leave a blank line before more text.
5. Blank lines are optional. Leave them out for a compact list; any blank line makes the whole list loose.
6. In `.mdx`, write JSX at the text column. HTML comments are not allowed in MDX.

## Implementation

`remarkCommentComp` (`frontend/src/lib/remark-comment-comp.js`) needs no list-specific logic: it visits comment nodes anywhere in the tree, including inside list items. Three general rules make the stipulated style work:

```text
remarkCommentComp
  1. paragraph ending with a marker comment, followed by a block
       -> move the comment out of the paragraph, directly before the block
          (the paragraph is removed if nothing is left)
  2. marker comment followed by a block           -> DocComp, placement commentBlock
     marker comment followed by inline code       -> inline DocComp, placement commentInline
  3. raw text of an unfenced block (e.g. a table) -> list indentation removed from its lines
```

After step 1, "text then comment" and "comment on its own line" are the same tree, so the component sees identical input in both styles. The marked block keeps its position among the item's children, so text before and after it stays in the same item. Fenced code already has the list indentation removed by the parser; step 3 does the same for blocks whose raw text is cut from the source.

The build-time attachment finders (`frontend/plugin/doc-attachment.ts`) read YAML blocks of `Image`, `ImageGrid`, and `FileDownload` from the raw document text. They accept an indented closing fence, so attachments of components inside list items are collected as well.

### Inline components

A marker comment directly followed by inline code marks that inline code. The component renders inside the text line, and its raw text is the code. A normal Markdown renderer shows just the code:

```markdown
- start with the documents tagged <!--renderComp=Tag-->`guide`
```

A registered component opts in by declaring placement `commentInline`; the tag mention (`Tag`, see [Tag system](doc_page_impl_tag.md#tags-mentioned-in-text)) is the first. A marker comment followed by anything else inside text is ignored.

## Items written by the page

In edit mode the page writes lists itself: the text of one item is edited alone, and items are created, moved, deleted and re-leveled one by one ([Structural edit: lists](doc_page_impl_edit_structure.md#lists)). The author types the text of an item from the left edge, without a marker and without thinking of columns; the page puts every line where the parser reads it as part of that item. It does so by the stipulation above, applied mechanically (`frontend/src/lib/doc-edit-list.js`).

<!--renderComp=DiagramText-->
````text
what the author types           what is written, for the item "2." under "- a"
as the text of the item
                                - a
see the block:                    2. see the block:
```js                                ```js
const a = 1;                         const a = 1;
  indented();                          indented();
```                                  ```
and after                            and after
                                     - a sub-item of it
                                  ↑  ↑
                                  │  text column of the item
                                  │  = marker column + width of "2." + its spaces
                                  marker column = text column of the item above
````

1. **The first line follows the marker; every other line stands at the text column of the item.** A line keeps the indentation it has beyond that column (the line inside the code block above), and a blank line stays empty. Nothing can fall out of the item, because nothing is written left of its text column.
2. **Everything an item holds is kept relative to its text column**, not as written lines. When the item goes to another depth, or its marker gets wider (`9.` becoming `10.`), all its lines are shifted together, with the nested lists and the fenced blocks under it. A component block of an item therefore moves with the item and stays its component.
3. **An item is written like the list it joins**: the marker of its new siblings, the spaces after it, their indentation. A numbered list is counted again from its first number; a list numbered all the same (`1.` `1.`) stays so.
4. **No blank line is added or removed**, since a blank line makes a list loose: an item put into a loose list is parted like the others, and a level change leaves the blank lines above an item where they are.
5. **What is tidied.** A lazily indented continuation line (a text line left of its item's text column) is written at the text column; a tab at the start of a typed line becomes four spaces.
6. **An item without a text** is written as its marker alone. Where Markdown would not read that as an item (the first sub-item right under a line of text, [below](#what-markdown-would-read-otherwise)), the page writes an empty comment as its text, `<!---->` in a `.md` document and `{/**/}` in an `.mdx` one: it renders nothing, and reading the list the page takes it for no text again. The author never sees it in the editor of the item, and it goes when the item gets a text.
7. **A text whose line breaks are kept** is written as a fenced block of language `text`, the whole own text of the item (Shift + Enter in the editor of an item, [The keys of an item](doc_page_impl_edit_structure.md#the-keys-of-an-item)). The opening fence follows the marker, so the item is a code block and nothing else; the page edits the lines inside and writes the fences itself, longer than any run of backquotes a line starts with. A text is written so while it holds a line break, and as a plain line when it is down to one (`itemTextWrite`). Such a block is drawn in the view `plain` by default, its lines standing like lines of text ([Fenced code blocks](doc_page_impl_mdx_code.md#the-views-of-a-code-block)).

8. **No kind of thing has to be the whole text of an item.** An item holds text and blocks in any order: text, a code block on lines of its own, more text, another block. The page writes every block on lines of its own at the text column, and text before and after it on the lines around it, never on the line of a fence (rule 3 of the [stipulation](#stipulation)); two texts that meet at a block are joined that way ([The keys of an item](doc_page_impl_edit_structure.md#the-keys-of-an-item)), and the code blocks of an item are typed as chips of its text ([Code blocks in the text of an item](doc_page_impl_edit_structure.md#code-blocks-in-the-text-of-an-item)). Drawn, a code block in the view `icon` stands in the line of the text; a code block of another view takes a line of its own (the browser breaks the line before and after it), which is a line of the item, not the item. Rule 7 is about what Shift + Enter writes in a plain item, not a limit of what an item holds: in the text of an item that holds code blocks, Shift + Enter makes the segment of text at the caret a text block of its own, among the rest.

<!--renderComp=DiagramText-->
````text
an item without a text                 an item whose line breaks are kept

- fruit                                - fruit
  - <!---->      the first sub-item      - ```text
  - apple        under a text line         two lines
-                elsewhere: the            of an address
- bread          marker alone              ```
````

### What Markdown would read otherwise

Some texts, written perfectly by these rules, are still not read as the items that were meant. The page does not try to list them all: **every result is parsed again before it is written**, with the parser that renders the page (as `md` or `mdx`), and compared with the items that were meant; a result that reads otherwise is refused with a reason ([The write of a structural edit](doc_page_impl_edit_structure.md#the-write-of-a-structural-edit)). What this catches in practice:

| Written | Read as | What the page does |
| --- | --- | --- |
| a code fence opened in the text of an item and never closed | the nested lists of the item, as code | the text is refused; the session stays open |
| `-` alone, as the first sub-item right under a line of text | a heading underline of that line | such an item is written with an empty comment as its text (rule 6) |
| any marker alone, right under a line of text | text of that line: an empty item cannot interrupt a paragraph | the same |
| a numbered list starting at another number than 1, right under a line of text | text of that line | a nested list the page creates starts at 1 |
| a list indented with tabs | columns that depend on the tab stops | the list has no item model: it is edited as a whole |

List items typed at the end of the text of an item read as sub-items, and that is accepted: they become the first sub-items of the item.

## The spacing of a list

Two measures of a list are config keys of the document ([Config system](doc_page_impl_config.md#the-default-layer)), so a doc page, a source rule or one document sets them:

| Key | Default | Measure |
| --- | --- | --- |
| `ListItemGap` | `4` px | the space between two lines of a list |
| `ListMarkerGap` | `5` px | the space between a bullet or number and the start of the text |

<!--renderComp=DiagramText-->
```text
• fruit
      ↕ ListItemGap      an item and its first sub-item
  • apple
      ↕ ListItemGap      two items
  • pear
      ↕ ListItemGap      the last sub-item and the item after it
• bread
 ↔ ListMarkerGap
```

- **One gap for every pair of lines.** The typography of the page gives a nested list a larger margin than an item, so a line would stand further from the line above it once it is indented, and a list would change its rhythm when an item changes its level. Here an item has no margin of its own, an item after an item has the gap above it, and a nested list has the gap above it and nothing below (`DocPageMdx.css`, the lists of a document). Indenting an item with Tab moves it sideways and nothing else.
- **Every item is a row.** An item without a text of its own (its marker alone, or nothing but a nested list under it) gets no line from a browser: the marker of `-` holding a list stands on the line of its first sub-item, two items in one row. `rehypeListItemTextless` (`lib/rehype-list-item.js`, in the compile of a document and of markdown inside a component) marks such an item with the class `doc-li-textless`, and the stylesheet gives it an empty first line. White space, a comment and an MDX expression that is only a comment are no text, so the empty comment of rule 6 above counts as none.
- **A loose list** (blank lines between its items) keeps the margins of its paragraphs, which are larger: the blank lines say the author wants room.
- **A code block of an item** in the view `card` (a block under the text of an item, the data of a component) has the same gap above and below it as a line. A block that is the item, in the view `plain`, has no distance of its own: its first line stands where the line of a plain item would ([The plain view keeps the rhythm of text](doc_page_impl_mdx_code.md#the-plain-view-keeps-the-rhythm-of-text)).
- **The marker is written as content** (`li::marker { content }`), so that nothing but the padding of the item stands between it and the text; a native marker keeps a space of its own after it, which no rule can make smaller. A numbered list the author gave another kind of number (`<ol type="a">`) keeps its native markers.
- **Not-prose content is left alone**, like by the typography: a list inside a component that marks its root `not-prose` keeps the look of the component.

The whole list edited as source keeps the same rhythm: the lines of its surface take the gap from the same variable ([the lines keep their rhythm](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)).

## Rendering inside list items

A block component inside a list item is rendered inside the `<li>`. In a compact list the item's text lines are not wrapped in paragraphs, so the item is `text, block, text`. Components need no list-specific code. As at the top level, a component whose inner lists, paragraphs, or figures must not take the document typography marks its root with `not-prose`.
