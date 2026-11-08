<!-- Design of pagination: laying the content of a component out on pages of a fixed size, previewing them, printing them and downloading them as a PDF. A component declares that it can be paginated in the component registry (expose.pagination); an environment (PageFlow) measures and places its pieces. Parent document: doc_page_impl_mdx_comp.md. -->

# Pagination: Design

A component is drawn as one block of any height. **Pagination** lays its content out on pages of a fixed size instead (A4 sheets), so that it can be previewed as it will be printed, printed, and downloaded as a PDF. It is a capability of the page that any component may declare, in the component registry, beside its icon and its modes ([What a component exposes](doc_page_impl_mdx_comp.md#what-a-component-exposes)); the first to declare it is the Japanese-style CV of the package cv (its own repository: `doc/cv-jp.md#pages`).

```text
a component's data ──pieceListGet(data, context)──► the flow   [basic, history, history, text]
                                                         │      each piece { type, data }
                                                         ▼
PageFlow (the environment)    measures every piece alone, at the width of a page's content
                              (a hidden box; fonts loaded, images decoded)
                                                         │      measured { height, breakList, textList }
                                                         ▼
paginationPlan (pure)         places the pieces on pages; a piece that does not fit is asked
                              where it can be cut: split(data, { space, measured }) -> { head, tail }
                                                         │      head and tail are data: measured, placed
                                                         ▼
the sheets                    one div per page, of the page's size in mm: the preview
                              ├─► Print / PDF      a document of its own, in a hidden frame
                              └─► Download PDF     the sheets as images, in a PDF built in the page
```

## The concepts

- **The environment** (`PageFlow`) takes a flow and a page, and draws the pages. It knows nothing of what it lays out.
- **A page spec** is a page in millimetres: `{ width, height, margin: { top, right, bottom, left } }` (A4 by default, `PAGE_SPEC_A4`). Its **content box**, the page less its margins, is what pieces fill.
- **The flow** of a component's data is a list of **pieces**, `{ type, data }`, in order: the sections of a CV, the paragraphs and tables of a report. The component makes it from its data (`pieceListGet(data, context)`).
- **A piece** is one box of the flow, drawn by its type's `Render({ data, layout })`. Pieces stack with nothing between them: each is a box of its own (`display: flow-root`, so no margin leaves it), and its height measured alone is the height it takes on a page. That one rule is what makes the plan exact: heights add up.
- **A piece type** says how a piece is drawn and, optionally, where it may be cut: `split(data, { space, measured, isPageTop })` answers a **head** that fits in `space` and a **tail** going on, both data, or `null`.
- **Measured** is what the environment reads of a piece drawn alone: its height, its **breaks** (elements marked `data-page-break="key"`: places it may be cut after, with their top and bottom) and its **texts** (elements marked `data-page-text="key"`: the lines of their text, each with the offset it starts at). A split decides from these, never from the live page.
- **Layout** is what the environment tells a piece about where it is: `{ pageIndex, isPageTop, fillHeight }`. `fillHeight` is the space left under a head cut by a split, when its type asks for it (`isFilledOnSplit`): a table draws its rules down to the bottom of the page with it.

## The contract

A component declares it in the registry, in `expose.pagination` of its definition ([comp-expose.js](doc_page_impl_mdx_comp.md#what-a-component-exposes) checks it when the component is defined):

```js
compDefine(CvJpSheet, {
  expose: {
    meta: { ... },
    pagination: {
      pageSpec: { width: 210, height: 297, margin: { top: 9.5, right: 10.5, bottom: 10.5, left: 10.5 } },
      pageClassName: 'doc-cv-jp-paper doc-cv-jp-page',      // the classes of a page's content box
      pieceListGet: (data, context) => [{ type: 'history', data: { ... } }, ...],
      pieceTypeById: {
        basic:   { Render: BasicPiece },                                         // never cut
        history: { Render: HistoryPiece, split: historySplit, isFilledOnSplit: true },
        text:    { Render: TextPiece, split: textSplit, isFilledOnSplit: true },
      },
    },
  },
});
```

| part | is | says |
| --- | --- | --- |
| `pieceListGet(data, context)` | required | the flow of the data. `context` is the component's own: what it needs beyond its data (a CV, its sheet resolved from the profile) |
| `pieceTypeById[type].Render({ data, layout })` | required | draws a piece; marks where it may be cut (`data-page-break`, `data-page-text`); draws `layout.fillHeight` when it asks for it |
| `pieceTypeById[type].split(data, { space, measured, isPageTop })` | optional | `{ head, tail, breakKey }` or `null`; without it the piece is never cut |
| `pieceTypeById[type].isFilledOnSplit` | optional | a head cut from it is told the space left under it (`layout.fillHeight`) |
| `pageClassName` | optional | the classes of every page's content box, and of the measuring box: what the pieces' stylesheet needs above them |
| `pageSpec` | optional | the component's page; the environment's `pageSpec` prop goes over it |

**What a piece type keeps to**, so that the plan stays exact:

1. **Data plain and resolved.** A piece's data is what it draws, already read (texts, not queries): it is keyed by its content, measured once per content, and drawn without the component's stores. A split is a cut of that data.
2. **Its margins inside its box.** A piece's own margin is part of its height. A head cut below should drop its bottom margin (the CV's `isCutBelow`), or the space under it on the page is wasted; the flag is data, so that what is measured is what is drawn.
3. **Breaks where a reader accepts a page turn.** A heading is never a break, so it stays with its first row; a part going on says so in its data (the CV's `isContinued`: no heading again, no indent of the first line), and a table repeats its head row in every part.
4. **A head measured is trusted, not predicted.** A split computes from the breaks of the whole piece; the environment measures the head before placing it, and when it is taller after all (its own bottom rule, a repeated head row) asks the split again with that much less space.

Helpers for a split (`doc-pagination.js`, exported, and pure as `@wwf971/react-doc/pagination`, so a package's split functions are tested in node): `paginationBreakLastFitting(measured, space, keepBelow)` (the last break within space, `keepBelow` px left for what the head draws under it) and `paginationTextCutGet(measured, textKey, space, keepBelow)` (the offset a text is cut at, after the last line that fits).

## How the pages are laid out

**In rounds, without timers.** The environment renders every piece not yet measured in a hidden box as wide as a page's content (with `pageClassName`), waits for its fonts and images, reads each piece's measure, and makes the plan again from all the measures it has (`paginationPlan`, a pure function). A plan that meets a split stops and asks for the head and tail to be measured; that is the next round. A CV of three pages takes three or four rounds. The sheets show the last finished plan meanwhile, so the preview does not blink while a change is laid out again.

```text
paginationPlan({ pieceList, measuredGet, typeGet, contentHeight })
  for each piece, while the page has space:
    fits                 placed; the page's space goes down by its height
    does not fit         its type's split(space): a head and a tail
                           head measured, fits   placed (fillHeight: what is left), tail first of the next page
                           head measured, taller split again with that much less space (up to 8 times)
                           not measured yet      asked for: the plan stops here this round
                         no split, or none fits: the piece starts the next page
    taller than a page, and cannot be cut: placed alone on a page, cut off, and reported
  -> { pageList, needList, problemList, isDone }
```

**Keys and measures.** A piece of the flow is keyed by its type and a hash of its data; a part of a cut one by its parent's key and where it was cut (`{key}/{breakKey}:head`). Measures are kept by key while the page spec is the same, so a change of one section measures that section again and nothing else, and the same cut is always the same piece.

**Why not measure on the page itself.** The former project (`2025/cv-dev/cv/vue-legacy`) rendered each piece into the real page, waited a few ticks and some milliseconds for it to settle, and asked it whether it overflowed; a table split was measured with the height of the table before it was split unless it waited 200 ms more. Measuring pieces alone in a box of the right width, and laying them out by arithmetic, has nothing to wait for but the fonts and images, and the plan is a function that tests run without a browser (`doc-pagination.test.js`).

## The environment: PageFlow

```jsx
<PageFlow
  ref={pageFlowRef}                         // { print(), pdfDownload(options) }
  pagination={definition.expose.pagination}  // compPaginationGet(definition)
  pieceList={pagination.pieceListGet(data, context)}
  pageSpec={{ height: 279.4, width: 215.9 }} // optional: over the component's (Letter here)
  title="サンプルの履歴書"                    // the name of the printed or downloaded file
  onStateChange={({ status, pageCount, problemList }) => ...}   // status: measuring | done
/>
```

It draws the sheets one under another, each of the page's size in millimetres with its margins as padding, a shadow and a page number under it on screen. The component around it decides where it is and what controls it has: the CV draws it in its view **Pages**, with **Print / PDF** and **Download PDF** in its bar. `compPaginationGet(definition)` reads a component's contract from its registry definition, for an environment laying out a component it did not write.

## Printing

**A document of its own.** Printing the doc page itself would print its side panel, toolbars and editor unless every one of them were hidden for print, and the former project spent most of its print work on such rules (and on what one browser kept that another hid). `pageFlowPrint` prints a document holding nothing else instead: a hidden `iframe`, into which it copies the page's stylesheets (`<style>` and `<link rel="stylesheet">`, so the pieces look as previewed), the sheets, and a stylesheet of its own for the browser's engine; it waits for those stylesheets, the fonts and the images, then prints the frame. Nothing of the page around is in it, so nothing has to be hidden, and the page around is left as it was.

```text
@page { size: 210mm 297mm; margin: 0 }          one sheet per page of the spec, no margin of the printer's
.doc-page-sheet { width: 210mm; height: 297mm; break-after: page; overflow: hidden }   the last: break-after auto
* { print-color-adjust: exact }                  backgrounds and rules as drawn
```

**Browsers differ** (`PAGINATION_PRINT_PROFILE_BY_ENGINE`, chosen from the user agent by `paginationEngineGet`):

| engine | browsers | what it does | the profile |
| --- | --- | --- | --- |
| blink | Chrome, Edge, Opera | honors `@page` size and margin 0; a sheet exactly as tall as the paper prints on one page; no margin, no header or footer; "Save as PDF" names the file after the document's title | sheet as tall as the page |
| gecko | Firefox | honors `@page` size (since 95); rounds a sheet as tall as the paper up, and then breaks a blank page after it; prints its headers and footers unless its dialog says otherwise | the sheet 0.4 mm shorter; the button's hint: Margins None, headers and footers off |
| webkit | Safari | ignores `@page` size: the paper is the dialog's | the sheet 0.4 mm shorter; the hint: the paper size in the dialog, headers and footers off |

Chrome is the reference: the print document was checked there to give exactly the pages of the preview (three A4 pages for a CV of three, no blank one). The title of the top document is set to the file's name while printing, since some browsers name the PDF after it and others after the frame's. The frame is removed after `afterprint`, or after ten minutes in a browser that never says.

## Downloading a PDF

`pageFlowPdfDownload` makes the file in the page, without a dialog: every sheet is drawn to a JPEG (`html-to-image`, at twice the css pixels: about 192 dpi), and the JPEGs become the pages of a PDF written by `pdfFromJpegListBuild` (`doc-pagination-pdf.js`: catalog, pages, one image and one drawing per page, its cross-reference table). It is the same file in every browser, whatever its print dialog does; its text is an image, not text, and it is larger (a CV of three pages: about 2 MB). **Print / PDF** keeps the text as text, and is the one to prefer where the browser prints well.

## Limits, and what may come

The environment places pieces one after another down a column, cutting them where their types say. It reserves room for layout beyond that, built on the same flow and measures ([TODO](doc_page_impl_TODO.md#pagination-layout)): floating elements placed beside or around the flow, elements fixed to a page (headers, footers, page numbers drawn on the sheet), keeping a piece with the next one, columns, and a block of a document that is a pagination environment for the blocks inside it, so that any component declaring the contract can be paginated in a document.

## Files

```text
frontend/src/lib/doc-pagination.js          the page spec, keys of pieces, the planner, helpers of a split, print profiles
                                            and the print stylesheet; pure
frontend/src/lib/doc-pagination-pdf.js      a PDF of page images; pure
frontend/src/lib/doc-pagination.test.js     the plan (fit, split, a head taller than thought, a piece taller than a page),
                                            keys, text cuts, print profiles, the PDF's cross-reference
comp-doc/pagination/PageFlow.jsx            the environment: measuring rounds, the sheets
comp-doc/pagination/page-flow-export.js     printing through a frame of its own, downloading a PDF of images
comp-doc/pagination/PageFlow.css            sheets, pieces as boxes, the measuring box
comp-doc/registry/comp-expose.js            expose.pagination checked; compPaginationGet
```
