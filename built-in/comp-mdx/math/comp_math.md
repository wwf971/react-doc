# Math

The built-in component math: formulas of LaTeX in a document, `$…$` in a line and `$$` on a row of their own, drawn by KaTeX. In edit mode a formula is typed in place: it stays drawn where the document draws it, and its source is typed in a field **below it**, floating over the page, so opening, typing and closing move nothing.

Everything of math is in this folder. The edit layer knows no formula: it offers kinds of atoms, things a component writes inside a text that the editor types as chips ([Atoms of a kind](../../../main/doc_page_impl_edit_structure.md#atoms-of-a-kind)), and math registers one.

## Grammar

The Markdown of math (`remark-math`): a formula in a line between single dollars, a formula on a row between lines of `$$`.

````markdown
Energy is $E = mc^2$, a share is $\frac{a}{a + b}$.

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

- an item with a formula on a row among its text
  $$
  \int_0^1 x \, dx = \frac{1}{2}
  $$
  and the text after it
````

- A formula **on a row** is set apart and centered: the text before it ends a line, the text after it starts one. In the text of a list item it is lines of the item, not a block of its own.
- What is math is what the parser says it is: never a `$` in code, an escaped `\$`, or a `$` that opens nothing. An inline formula is one line with no space next to its dollars.

## Rendering

KaTeX draws every formula. The compile of a document parses math with `remark-math` and draws it with `rehype-katex` (`main/frontend/src/lib/mdx-compile.js`, and `markdown-render.js` for a `.md` text drawn alone); the stylesheet of KaTeX is imported by the stylesheet of the page (`main/frontend/src/style.css`). `katex`, `remark-math` and `rehype-katex` are direct dependencies of the package.

KaTeX is bundled and draws synchronously: nothing is fetched, a formula is drawn with the text around it, and a page built into one html file carries it. In edit mode the component draws a formula itself with the same options (`mathRender`), so a formula is the same box in reading and in edit mode.

The fonts of KaTeX are files of its package, named by its stylesheet, and the development server must be allowed to serve them: `vite.config.ts` allows the folder `katex` resolves to, wherever it is installed. In a workspace that hoists its packages (pnpm `nodeLinker: hoisted`) that folder is outside every other folder the server allows, and the fonts were refused: every formula was drawn in the serif of the system, its spacing measured for KaTeX's own.

## Copying a formula

A formula on a row of its own (a block of math, a formula on a row of a paragraph or an item, in a document or a popup) has a copy control while the pointer is over it, in reading mode and on a block not being edited in edit mode. It floats right after the end of the formula as drawn, its middle at the formula's middle, not at the corner of the row: the row is as wide as the text, the formula is what is copied. A formula being typed has its field instead, and a formula in the line has no control.

<!--renderComp=DiagramText-->
```text
                 ∞
                 Σ  1/n²  =  π²/6  [⧉|▾]      ⧉  the LaTeX, at once
                n=1                ┌──────────────────────────────┐
                                   │ COPY                         │
                                   │ ⧉ LaTeX  the source, as typed │
                                   │ ▣ Image  PNG, as drawn here   │
                                   │ ◇ SVG    paths, by MathJax    │
                                   │ DOWNLOAD                     │
                                   │ ↓ Image  formula.png          │
                                   │ ↓ SVG    formula.svg          │
                                   └──────────────────────────────┘
```

| form | what is copied |
| --- | --- |
| LaTeX | the source, without its `$$` (read from the MathML KaTeX draws beside the formula, `annotation[encoding="application/x-tex"]`: nothing of the document is asked for) |
| Image | a PNG of the formula as the page draws it (KaTeX, its fonts in the image: `html-to-image`), black on a transparent ground, at twice the pixels of the screen at least, a little room around it |
| SVG | an SVG of paths drawn from the same source by MathJax (`mathjax-full`, version 3, its TeX font in the package: nothing is fetched), as text: `width` and `height` in `ex`, drawn in `currentColor` |

The image and the SVG are also **downloaded as files**, from the group Download of the same menu: `formula.png`, the image as copied, and `formula.svg`, the SVG as copied with the declaration of an XML file before it, so it opens alone (`currentColor` is black there). The browser saves them as any download (`mathDownload`).

- **One control for the page.** The control is a layer of the page ([Page layers](../../../main/doc_page_impl.md#page-layers)), drawn over it (position fixed) for the formula under the pointer: no formula gets an element of its own, so nothing of a formula, and nothing around it, changes. It follows the formula when the page scrolls, and goes a moment after the pointer leaves the formula and the control.
- **A click is the copy.** The button copies the LaTeX; the arrow beside it opens the forms (the menu of the page): Copy and Download. The button says how it went a moment: ✓, or ✗ with the reason as its title. The clipboard is written inside the click, its content a promise, as a browser asks.
- **MathJax only for the SVG.** KaTeX draws HTML only; an SVG of paths is MathJax's. It is loaded when a formula is first copied as SVG (`math-svg.js`, a module imported then), and bundled by the development server when it starts (`optimizeDeps`), so the page is not reloaded in the middle of a copy. Its drawing is MathJax's, very near KaTeX's: the same TeX fonts. The image is KaTeX's own drawing, so it is the formula as seen.
- **The image is drawn out of sight.** The copy of the formula the image is made of stands in a host of its own, fixed, of no size, clipped ([Isolate temporary rendering DOM](../../../main/doc_page_impl.md#isolate-temporary-rendering-dom)).

## Editing

### A formula among a text

In a paragraph and in the text of a list item each formula is **a chip of the text**, one character of what the editor types, as a code block among the text of an item is. The chip is the formula as the document draws it: an inline one in the line, the spaces around it the text's own; one on a row as wide as the text, with the margins KaTeX gives its display. Entering the paragraph or the item moves no formula and no line.

- **A click on a formula opens its field**, also the click that enters the paragraph or the item, and so does Enter on a chip selected (Shift + ← / → over it). A hairline frame marks the formula while its source is typed. An empty formula shows its place with the word `formula`; one that KaTeX cannot read is drawn as far as it goes, its faulty part in red, the chip underlined.
- **The caret is the text's.** ← and → move over a chip in one step; Backspace beside it selects it, and again deletes it (Undo brings it back). Beside a formula on a row the caret is drawn as tall as the row.
- **A right click deletes it**, as every thing drawn as one unit is ([Deleting a thing](../../../main/doc_page_impl_edit_structure.md#deleting-a-thing)): on a formula of a paragraph or an item not being edited the menu of the block is headed by `Delete Formula…`, asked first, then written; on the chip of a text being typed the menu is `Delete Formula` alone, a typed delete Undo brings back. A formula in the line takes a space next to it along. The kind names the element KaTeX draws a formula as (`elementSelector: '.katex'`), which tells the menu which formula of the block was clicked.
- **Saved,** each formula is written back where it stands. In the text of an item a formula on a row is lines of the item, the text before and after on the lines around it; **in a paragraph a formula on a row is a block of its own**: the paragraph is saved as the text before it, the block of math and the text after it, blank lines between them. A formula left empty is not written; a text not typed is written back as it was.

### The field below

The source is typed in a field under the formula (`MathSourceField`): a box over the page like the popovers of the page, the source in the code font, as wide as a formula on a row (an inline one: a fixed width). It follows the formula when the formula grows or the page scrolls. The formula is drawn again at each key; while KaTeX cannot read it, KaTeX's message is the line under the source.

**A formula on a row keeps its room while its source is typed**, as a block being edited keeps the height it had ([the geometry lock](../../../main/doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule), rule 4): nothing after it moves at any key. Drawn taller, it extends down over the lines after it, its frame around it, above them on the page background; drawn shorter, its row keeps its height, the formula at its top. When the field closes the row takes the room the formula needs, as a block saved does. A block of math is held so by the lock of its block, and paints the page background over the block after it.

<!--renderComp=DiagramText-->
```text
Energy is ┌E = mc²+½┐ here.          the formula, in its place, framed
          └─────────┘
          ┌──────────────────────────────────┐
          │ E = mc^2 + \frac{1}{2}▏          │   its source
          ├──────────────────────────────────┤
          │ Undefined control sequence: \fra │   only while something is wrong
          └──────────────────────────────────┘
```

| key | a formula among a text | a block of math |
| --- | --- | --- |
| Enter | in the line: done, the caret after it. on a row: a line break | a line break |
| Ctrl/⌘ + Enter | done, the caret after it | the block saved |
| Escape | the field closed, the caret after it | the edit canceled, as Escape cancels every block |
| ← at the start; ↑ on the first line (on a row: at the start) | the caret before the formula | on to the block before (saved) |
| → at the end; ↓ on the last line (on a row: at the end) | the caret after the formula | on to the block after (saved) |
| ↑ on the first line, ↓ on the last, the caret not at that end | on a row: the caret to the start / the end of the source (in the line: as above) | the caret to the start / the end of the source |
| Backspace in an empty source | the formula taken out | the block taken out |
| a click elsewhere | the field closed; an empty formula taken out | as for every block: the block saved |

The field is a plain source of LaTeX, not a palette of symbols: the formula drawn above it is its preview.

### A block of math

A block of the document that is `$$` lines is edited by the registered component `MathBlock`: the formula drawn where the document draws it, in a hairline frame, the field open below it at once, and the floating bar above it with the label and Save / Cancel, as for every block. A click on the formula puts the caret back in the field. The draft is the whole block, `$$` lines included, so any way of leaving saves it. A block emptied and left, or Backspace in its empty source, takes the block out; a right click on it while it is not being edited opens the menu of the block (`Delete Blocks…`).

### Adding a formula

`/math` (or `/latex`) in a paragraph or the text of a list item puts an empty formula at the caret and opens its field. Where it stands is an optional parameter of the action ([An optional parameter](../../../main/doc_page_impl_edit_slash.md#the-action-interface)): Enter puts it in the line; Tab lists `In the line` (the default) and `On a row`, both also on the row of the action for a pointer. In a surface that types no chips (the source of a whole list) the source of a formula is typed instead.

<!--renderComp=DiagramText-->
```text
/math        ∑ /math  Formula  LaTeX, in the line…  [In the line] On a row
  Enter      an empty formula in the line, its field open below it
  Tab        In the line  default  among the words: $…$
             On a row              set apart, on lines of its own: $$
```

### A block of math as data

A card of a card diagram holds a block of math as it holds any block of a document ([A component in a card](../../../package/cloud-dev-vis/doc/card-diagram-impl.md#a-component-in-a-card)): `{ comp: MathBlock, lang: latex, raw: the formula }`. `MathBlock` can stand as a block (placement `commentBlock`) besides being the editor of `$$` lines, and says how it starts and how its native form is read (`math-block-expose.js`):

| | |
| --- | --- |
| a new block | `$$` lines (`sourceDefaultCreate`: `{ text }`): the insert menu of a document writes them, **Math** among its components, so a document keeps its native form |
| its native form read | `$$` lines and nothing else are the data of a block of it, the formula (`expose.blockTextRead`: `mathBlockTextRead`); a card takes `$$` lines so, from the insert menu and from a slash action |
| drawn | the formula by KaTeX, centred, on a light surface with a thin edge as the cards around it (`MathFormula.jsx`); its copy control after it, never over it |
| edited | its mode **Formula**, kept open in place by a card (`isInPlace`): a click types its LaTeX in the field below it, out of the flow; Ctrl/⌘ + Enter or a click elsewhere keeps it (one change), Escape gives it up; while it is open a drag on it selects nothing of the canvas (`nodrag nopan`). In a session of a block (a marker block of it in a document), the same, with the bar of the block |
| made in a card | in the create panel, the words `math`, `formula`, `latex` find **Math**; `/card-comp/math` makes one: `/math` answers a block of math where a block alone is taken (`context.isBlockOnly`), a formula among the words everywhere else |

A block of `$$` lines of a document is still drawn by the document and edited by the edit layer (above): the mode **Formula** is for a block held as data. An app with no documents registers the same component for its cards alone (`math-formula-comp.js`: `mathFormulaDefine`, no document renderer; zatelier-drawboard does).

## Registration

| what | id | where |
| --- | --- | --- |
| the atom kind `math` (chips of a text, their field) | `text/math` | `main/comp-doc/edit/atom-kind-registry.js` |
| the editor of a block of math, and a block of math held as data | `common/MathBlock` (tag `MathBlock`), the default editor of the block kind `math`; placements `edit` and `commentBlock` | `math-block-comp.js` (`mathBlockDefine`), in `main/comp-doc/registry/registry.js`; `DocEditBlockEditor` |
| the action `/math` | `text/math` | `main/comp-doc/slash/slash-registry.js` |
| the copy control of a formula on a row | `math/copy` (a layer of the page) | `main/comp-doc/registry/page-layer-registry.js` |

## Implementation

| file | role |
| --- | --- |
| `MathData.js` | where math is in a text (`mathSpanListGet`), how a formula is written (`mathSourceBuild`), KaTeX drawing it and what is wrong with it (`mathRender`, `mathErrorGet`) |
| `math-atom.js` | the atom kind `math` (`atomKindDefine`) |
| `MathSourceField.jsx`, `.css` | the field below a formula, its keys |
| `MathBlock.jsx`, `MathBlockEdit.jsx` | the editor of a block of math; a block held as data handed to `MathFormula.jsx` |
| `MathFormula.jsx` | a block of math held as data: the formula drawn (`MathFormula`), its mode Formula (`MathFormulaEdit`) |
| `math-block-expose.js` | what `MathBlock` tells the page: its start, its native form read, its mode |
| `math-block-comp.js`, `math-formula-comp.js` | its definition for the page, and for an app with no documents |
| `math-slash.js` | `/math`; a block of math where a block alone is taken |
| `math.css` | the look of a formula while a text is edited, and of a block of math held as data |
| `MathCopyLayer.jsx`, `.css` | the copy control of a formula on a row: where it floats, its forms |
| `math-copy.js` | the copies and the files: the source of a drawn formula (`mathSourceOf`), the clipboard written (`mathCopy`), a file saved (`mathDownload`), the image (`html-to-image`) |
| `math-svg.js` | a formula as an SVG of paths (MathJax), loaded when one is copied so |
| `main/frontend/src/lib/doc-edit-atom-kind.test.js` | a formula typed in a paragraph and an item, on a row, a block of math taken out |
