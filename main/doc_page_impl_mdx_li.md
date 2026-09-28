<!-- Design of components as list elements. Parent document: doc_page_impl.md -->

# Components in Lists: Design

A component should be usable as an element of a list item at any depth, in ordered and unordered lists. Components that span several source lines, or that render as a rectangular block (a code block, an image, a diagram), are the important case. This document explains why that is hard in Markdown, which writing styles were considered, and the stipulated style. The user-facing version with live examples is the example document `example_doc/comp-custom-list-el.md`.

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

## Rendering inside list items

A block component inside a list item is rendered inside the `<li>`. In a compact list the item's text lines are not wrapped in paragraphs, so the item is `text, block, text`. Components need no list-specific code. As at the top level, a component whose inner lists, paragraphs, or figures must not take the document typography marks its root with `not-prose`.
