<!-- Design of the command palette. Parent document: doc_page_impl_api.md, the unified api registry it lists. -->

# Command Palette: Design

The command palette is the list of what the page can do, opened by a key and searched by typing, as in VS Code (Ctrl+Shift+P) and the editors that followed it. It shows the apis of the [unified api registry](doc_page_impl_api.md) that choose to be listed, narrowed by what the reader types, asks for the parameters of the chosen one when it has any, and runs it. It adds nothing an api does not have: the palette is one caller of the registry among others, and an api offered to the palette is offered to the hotkeys and to remote callers at once.

```text
⇧⌘P / F1 / the terminal button of the side-panel header
  ▼
┌──────────────────────────────────────────────────────────────┐
│ ▣ edit                                                     6 │  ◄ the field; the count of matches
│ ✎ Edit: Edit a block        Opens a block of the …           │  ◄ greyed out: cannot run now (its reason on hover)
│ ▣ Example: Edit the in-place editing playground  Opens …     │
│ ✓ Edit: Save the block being edited  Leaves the open …       │
│ ✎ Edit: Toggle edit mode    Turns the edit mode …     ⇧⌘E    │  ◄ highlighted; the key bound to it at the right
│ ⬚ Edit: Toggle block selection mode  Selects blocks … ⇧⌘B    │
│ ↑ ↓ move · Enter run · Esc close                             │
└──────────────────────────────────────────────────────────────┘
```

## What is listed

An api is listed unless its definition says not (`apiDefine` `palette: false`): one that is not for a reader, because it answers data (`api/listGet`, `doc/blockGet`, the document apis an agent calls). An api with parameters is listed like any other and asks for them when chosen ([The parameters](#the-parameters)); its label ends with `…`, as a menu entry that opens a dialog does. `palette: { keywordList }` adds words the search matches beside the label and the id. The apis of every source are listed alike: the page's, a doc page's declared ones ("Example: Open the document model"), a component's, a running service's.

Each entry shows its category and label (`Navigation: Back`, the category being the first part of the id unless the definition names one), its description, and the key bound to it now (`DocHotkeyStore.labelByApi`, so the palette is where keys are learned). An entry whose `isAvailable` says no stays in the list, **greyed out**, with the reason as its hover title: the list does not jump as the page changes, and the reader learns why a command does nothing now. Choosing it shows the reason in the notice of the api layer instead of running.

## The search

Every word typed must appear, case-insensitively, in the category, the label, the id, the keywords or the description. The order: while nothing is typed, the apis **recently run** from the palette first (the last eight, kept in the browser, `localStorage` `doc-page-palette-recent`); then the ones whose label starts with the first word, then those whose label contains it; then by category and label. The first word is marked in the label and the category.

## The parameters

Choosing an api with parameters does not close the palette: the popover switches to its **params step**, a second dialog at the same place (`DocPaletteStore.step`), as VS Code's quick input follows a command with its question. It names the api (its icon, category, label and description) and shows one field per parameter of `paramList`, in declaration order, each with its name, its type, a `*` when required, and its description and default under the field. The field follows the type:

| type | field |
| --- | --- |
| `boolean`, or any type with `valueList` | a choice of `.doc-button-dialog` buttons, the pressed one the value; pressing it again clears it |
| `sourcePath` | the path field of the page, `SourcePathInput`, with the completion of the doc page source service layer (`pathSpec` says whether a document or a folder is meant), as a config key of that type |
| `object`, `list` | a text field holding JSON |
| `number`, `string`, `any` | a text field |

The texts are read by type when the reader presses **Enter** (`apiParamsFromText`, `lib/doc-api.js`: a number, `true` / `false`, JSON for a mapping or a list, JSON or the text for `any`; an empty field is no value), then checked as the params of any call (`apiParamsCheck`: the required ones present, the types, the `valueList`). When something does not read or check, the step stays and a line under the fields says what (`paramMessage`); the line is always there, so the form does not move when it fills. When everything checks, the palette closes and the api runs with those params. So an api whose parameters are **all optional** runs on Enter at once, with its defaults, and the step is a confirmation one key long; one with a required parameter cannot run until it is given. Enter in a path field takes the entry highlighted in its completion list when there is one, and runs otherwise; Enter on a choice button runs as well (Space, or a click, presses the button). **Escape** goes back to the list, with the query the reader typed still there; Tab moves between the fields. A hotkey bound to an api with parameters never asks: it carries its `params` in the map, and a required one missing is a -4 answer in the notice.

## Keys and pointer

| key / pointer | does |
| --- | --- |
| ArrowDown / ArrowUp | move the highlight (wraps); PageDown / PageUp move by eight |
| Enter | run the highlighted api and close, or open its params step; in the params step, run when the fields check |
| Escape | close; in the params step, back to the list |
| pointer over an item | highlight it |
| click on an item | run it and close (a pointer down on an item does not take the focus from the field) |
| pointer down outside | close (a pointer in the completion list of a path field is a choice, not outside) |

The palette is a `.doc-popover` at the top of the window, one fixed width, its list at a fixed maximum height that scrolls, so the popover never changes size while the reader types ([the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule) applied to a dialog). It is above every dialog of the page, so it opens over the settings panel or a block popup. Its field is a plain text input, the one simple case where an input is the right element; the keys bound to the palette itself (⇧⌘P toggles it) keep working while the field has the focus, since they carry modifiers ([which keys reach a hotkey](doc_page_impl_api_hotkey.md#the-listener)).

## State and rendering

`DocPaletteStore` holds the one palette of the page: `isOpen`, `query`, `itemIndexActive`, the recent ids, `itemList`, a computed value built from `DocApiStore.apiList` with the context of the moment (so an item greys out when the page changes under it) and the labels of the hotkey store, and the params step (`step`, `apiIdParams`, `paramTextByName`, `paramMessage`, `paramItemList`). `DocCommandPalette` renders the state and nothing else, portaled to the body, the list step or the params step in one popover of one width; `DocPaletteButton`, in the side-panel header beside the settings button, toggles it and names its key in its hover title. Choosing an item is `paletteStore.choose()`: an api with parameters opens the params step (`paramsOpen`), another runs; running (`paramsRun` from the step) closes the palette, calls the api with the principal `palette`, and sends the result to the notice of the api layer (`DocApiStore.resultNotice`: a failure shown, a message of a success shown). A field that leaves the focus on nothing (a path field commits on Enter) hands it back to the popover, so the keys of the palette keep working.

The apis that open and close the palette are apis like the others (`palette/open`, `palette/close`, `palette/toggle`), which is how the default keyboard map binds it (`mod+shift+p`, `f1`) and how a doc page or a reader rebinds it.

## Files

```text
frontend/src/store/DocPaletteStore.ts     the state, the item list, the recent list, choose; the params step
frontend/src/lib/doc-api.js               apiParamsFromText: the texts of the step read by type
comp-doc/api/DocCommandPalette.jsx        the popover: the list step (field, list, keys, pointer), the params step (one field per param)
comp-doc/api/DocPaletteButton.jsx         the button of the side-panel header
comp-doc/api/DocApi.css                   the look of the palette, its params step, and the notice
main/hotkey/default.yaml                  the keys that open it (the package's default map)
```
