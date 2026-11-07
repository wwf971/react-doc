<!-- Design of testing on the page: playground documents. Parent document: doc_page_impl.md. -->

# Testing on the Page: Design

What the page offers for trying its features out. Today this is one thing, the **playground document**. Automated tests are next to the code they test, and are not described here.

## Playground documents

A **playground** is a document for trying things out: press every button, save, break it, start over. A playground belongs to one checkout and not to the project, so what is done in it is never committed, and a fresh clone has none. It is a document git ignores and a tracked template it starts from; how the two are named and kept out of git, and why a build leaves the document out, is part of the folder conventions ([Playground documents](doc_page_impl_dir.md#playground-documents), among the [local content kept out of git](doc_page_impl_dir.md#local-content-kept-out-of-git)).

Everything about a playground on the page follows from the document being able to be missing.

```text
                    create from the template
   no document  ───────────────────────────────►  the document
   (a fresh clone)                                 editable, saved like any other
   error page       ◄───────────────────────────   a bar above it says what it is
                        delete                      │  ▲
                                                    └──┘ reset: back to the template
```

### Declaring one

A doc page lists its playgrounds in `.doc-page/playground.yaml`, read when it exists. The entry may name another file (`playground: { file }`) or none (`playground: false`), like the other files of the metadata folder ([the doc page folder](doc_page_impl_dir.md#keyboard-maps-and-declared-apis)).

```yaml
playgroundList:
  - id: card-diagram
    title: The card diagram playground
    description: Connection lines, animation and view switching, to try and to break.   # optional
    doc: ~cloud-dev-vis/doc/card-diagram.playground.md    # where the document lives when it exists
    template: ./playground/card-diagram.md                # relative to this file, normally in .doc-page/playground/
```

The side panel names the document like any other, with an `id` so that its route stays one and the same whether the file exists or not:

```yaml
- id: card-diagram-playground
  text: Playground
  doc: ~cloud-dev-vis/doc/card-diagram.playground.md
```

The document must be named `*.playground.md` or `*.playground.mdx`, which is what git ignores ([the rule of the `.gitignore`](doc_page_impl_dir.md#playground-documents)); a doc page declaring another name gets a problem reported (`[doc-playground]`), with the item skipped.

### What each place shows

| Where | The document does not exist | The document exists |
| --- | --- | --- |
| **the side panel item** | stays where it is, and opens the error page | opens the document |
| **the menu of the item** (right click, or the `···` button) | **Create playground** | **Reset playground…**, **Delete playground…** |
| **the page** | the error page below | the document with a bar above it: `playground`, a line saying git does not track it, **Reset**, **Delete** |
| **a link** to the document | the red treatment of a [broken link](doc_page_impl_nav.md), which for a playground still opens the error page, where it can be created | a normal link |
| **the palette and agents** | `playground/reset` creates it | `playground/reset`, `playground/delete` ([the apis](#the-apis)) |

The item of a playground has its menu at any time, not only in edit mode, with only these entries while reading; in edit mode they come first, above the usual ones.

### A side panel item whose document is missing

This behavior is not special to playgrounds. **Any** side panel item bound to a document that does not exist **stays in the tree** ([Selecting documents](doc_page_impl_side_panel.md#selecting-documents)): a missing file makes no item disappear and no neighbour move. Clicking it opens an **error page**, titled "Document source not found", which says what was asked for. The page tells the two cases apart:

- **An item of a playground.** The page says that this is a playground that does not exist in this checkout, why (git ignores it, so a clone has none), and offers **Create from its template**. This is the normal state after a clone, so it reads as an explanation with a next step.
- **Any other item.** The page names the source configured for the item and asks to check the path and the source rules. This is a mistake to be fixed, with nothing to offer.

Nothing reloads in either direction. When the file appears or goes, the source is reported to the page as data ([what the page receives](doc_page_impl_side_panel.md#what-the-page-receives)): the item keeps its place and route, and an open page turns from one into the other where it stands.

### Reset and delete

**Reset** (also Create) writes the template over the document. **Delete** removes the document, which puts the checkout back as after a clone. The bar asks first, and asking only changes its text, so nothing below it moves; a reset or delete chosen from the menu opens the document, whose bar asks. Whatever was there is not erased: it goes to a hidden backup beside the file, like [every document deleted from the page](doc_page_impl_source.md#creating-and-deleting-files), which git ignores too.

**Removing a playground altogether** is removing the places that name it: its item in the side panel, its entry in `playground.yaml`, the template, and the file if it exists. None depends on the others to load: an item whose playground is gone is an ordinary missing document, and a playground with no item is reachable by its apis.

### Writing into a package

A package treated as a doc page is read-only wherever it is not served alone ([A package as a doc page](doc_page_impl_package.md#a-package-as-a-doc-page)), and there its playground is the **one exception**, for the one file: a package is where its features are best tried. `readOnlyReasonGet`, the function every write of the server asks, answers no reason for the document of a declared playground, and `DocSourceStore.pathReadOnlyReasonGet` says the same to the controls of the page. So the document can be edited and saved, block by block, while every other write into the package is still refused with `-4`.

Since a playground in a package writes only into its own document, its blocks keep their data inline. An asset written from it would go into the read-only asset folder, and is refused like any other.

### A built page

A static build has no playground at all: the document and its item are left out ([Playground documents](doc_page_impl_dir.md#playground-documents)).

### The apis

| Id | Does | Available when |
| --- | --- | --- |
| `playground/listGet` | every playground, with whether its document exists | |
| `playground/reset { id? }` | creates or resets it | the development server serves the page |
| `playground/delete { id? }` | deletes it | the same |

`id` is `{doc page}/{id}`. Without it, the playground of the current document, or the only one there is.

The server's route is `POST {source endpoint}/playground { id, action: reset | delete }`.

### Adding one

1. Write the template, normally `.doc-page/playground/{name}.md`. It is an ordinary document, and it is what a clone will see, so it says how to use what it shows.
2. Add it to `.doc-page/playground.yaml`, with a document named `*.playground.md`.
3. Add its item to the side panel, with an `id`.
4. Check the rule of the `.gitignore` of the repository ([Playground documents](doc_page_impl_dir.md#playground-documents)).

A frontend object tried out without touching its example data does the same with a folder: its partition `playground/`, ignored by git ([Partitions](doc_page_impl_obj_frontend.md#partitions)).

When a feature is worth trying out by hand, add it to the template of the playground of its area. The document of a checkout does not follow its template: **Reset** picks up what changed.

## Implementation

| Place | Role |
| --- | --- |
| `frontend/plugin/doc-playground.ts` | reads `playground.yaml`, checks it, `playgroundApply` (reset, delete) |
| `frontend/plugin/doc-source.ts` | `configDoc.playgroundList`, the route, the exception in `readOnlyReasonGet`, `playgroundLeaveOut` of a build |
| `frontend/src/store/DocSourceStore.ts` | `playgroundList`, `playgroundOfReference`, `playgroundChange`, the question the bar is asking |
| `comp-doc/playground/DocPlayground.jsx` | the error page's part and the bar, used by `DocPageView.jsx` |
| `comp-doc/side-panel/SidePanelItemContextMenu.jsx`, `DocSidePanelStore.ts` | the entries of the menu (`sidePanelItemPlaygroundRequest`) |
| `comp-doc/api/api-playground.js` | the apis |
| `frontend/plugin/doc-playground.test.js` | the config, reset and delete, the rule of the `.gitignore` |
