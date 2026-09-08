# Document Index Component Design

## Purpose

`DocIndex` gathers links to documents and other collected source items into a semantic index. It does not have to reproduce the side-panel hierarchy. A document can therefore provide a task-oriented roadmap, a compact contents panel, or another link ensemble while all navigation still uses the central document navigation system.

The same semantic index can render in ordinary document content or be queried by id and hosted as a part index in the right-side local-index area. Hosted indexes can also move into a floating top-right panel without duplicating their authored data.

## Dispatch hierarchy

Index selection has two levels:

```text
DocIndex entry
  -> index type
       -> layout
```

- `type` selects the accepted semantic data format. A new type can introduce a different hierarchy or different item fields.
- `layout` selects a visual arrangement for that type without changing its data format.
- A type component owns its layout map. The root entry does not need to understand every layout supported by every type.
- Unknown types and layouts render explicit errors instead of silently falling back to an unrelated presentation.

The initial type is `title-subtopics-items`. Its normalized data contains one title, a list of subtopics, and an item list under each subtopic.

## Data flow

`DocIndexStore` is the local MobX source of truth. It parses and normalizes authored YAML through the type-specific normalizer before any layout renders. Render components only observe accepted store data; they do not parse YAML or mutate semantic state during rendering.

```text
authored YAML or direct data
  -> DocIndexStore.dataLoad()
  -> type-specific normalization
  -> DocIndex type dispatcher
  -> type component
  -> layout dispatcher
  -> layout render component
```

The common fields are:

- `type`: index data type and top-level dispatcher key.
- `layout`: visual variant understood by the selected type.
- `title`: index title, as text or a language mapping.
- `description`: optional language-aware description for layouts that support it.
- `subtopics`: ordered groups for `title-subtopics-items`.
- `subtopics[].id`: stable language-independent identity; required when the subtopic uses `component`.
- `subtopics[].title`: text or a language mapping.
- `subtopics[].items`: ordered document or inline links. A subtopic uses either `items` or `component`.
- `subtopics[].component`: optional registered component replacing the item list, with `name`, optional `data`, and optional `config`.
- `items[].id`: stable language-independent identity.
- `items[].title`: text or a language mapping.
- `items[].kind`: optional `document` or `inline-link`; the default is `document`.
- `items[].target`: document target for `document`, or collected source path for `inline-link`.
- `items[].description`: optional language-aware details for layouts that support them.

A layout may ignore optional fields, but it must not reinterpret the core fields or require authors to duplicate the same index data merely to change presentation.

## Authoring

A plain Markdown document uses a comment-marked YAML block:

````markdown
<!--renderComp=DocIndex-->
```yaml
type: title-subtopics-items
layout: horizontal-wrap
title:
  jp: ガイド索引
  en: Guide index
subtopics:
  - id: setup
    title:
      jp: 環境構築
      en: Setup
    items:
      - id: setup-guide
        title:
          jp: 環境構築ガイド
          en: Setup guide
        target: /guide/setup.md
      - id: setup-script
        kind: inline-link
        title:
          jp: 環境構築スクリプト
          en: Setup script
        target: /guide/setup.ps1
```
````

The `title-subtopics-items` type currently supports:

- `vertical-list`: items are stacked vertically. This is the default when `layout` is omitted.
- `horizontal-wrap`: items are arranged horizontally within each subtopic and wrap onto later rows when space is insufficient.

## Navigation

Every `document` item renders through `DocLink`. This preserves centralized path resolution, ambiguity handling, unavailable and broken link states, history behavior, route mode, and `DocStore.navigate()` as the navigation boundary. Layout components must not use raw internal anchors or mutate current-document state directly.

A document target must still be represented in the semantic side panel to be navigable. An `inline-link` is intentionally different: it loads its collected source without navigation and opens the same source-code popup used by compact `CodeBlock`. Therefore, its target need not be present in the side panel, but it must be present in the source manifest. Inline links use the Lucide `LogOut` icon rotated counter-clockwise by 90 degrees.

Document targets can include a fragment, such as `/guide/setup.md#environment`. `DocLink` resolves the document and submits the fragment through `DocStore.navigate()`, so document loading, scrolling, browser URL synchronization where enabled, and back/forward history remain centralized.

## Custom subtopic components

A `title-subtopics-items` subtopic can replace `items` with one registered component:

```yaml
- id: layout-map
  title: Layout map
  component:
    name: ComponentExample
    data:
      areas:
        - id: header
          label: Header
          target: /guide/layout.md#header
```

The component is resolved through the unified registry and rendered by `RegisteredComp` with placement `indexSubtopic`. It receives the standard `{ data, config, onEvent }` props. Navigation-capable components emit `navigateRequest` with a target instead of changing document state directly. Component definitions intended for this position declare `placementList: ['indexSubtopic']` or include that placement among their supported placements.

## Multilingual behavior

Visible text can be a language mapping such as `{ jp, en }`. Rendering reads the shared document language context, uses the preferred translation when available, and otherwise uses the first authored translation. The rendered element receives the language actually used.

Language choice is not duplicated in `DocIndexStore`. It remains document-level state so toolbar and floating language controls update every index instance together.

`docIndexLanguageListGet()` discovers all authored languages for document compilation. `docIndexStructuredDataGet()` contributes all translated titles and descriptions to search. Consumers register both callbacks under the author-facing `DocIndex` component name.

## Layout rules

All layouts should remain compact and suitable for navigation rather than resemble large content cards. They should:

- preserve type-defined ordering;
- use stable item and subtopic IDs as keys;
- remain usable at narrow widths;
- avoid nested rounded cards;
- use document theme variables rather than application-specific colors;
- keep long content scrollable or wrapping according to the layout contract;
- preserve the `data`, `config`, and `onEvent` component boundary for future hosts.

A part index is referenced from a semantic side-panel part by document item id plus component id. Querying returns the component's authored input and registered `componentType`; the host accepts only definitions declared with `componentType: index` and `partIndex` placement. This avoids coupling the page system to `DocIndex` or to one index data shape.

The right-side host switches between the current page TOC and the current part index. The page/part selection is global and survives navigation, while docked/floating operation state can remain specific to each part. The host supplies display state through `config` and receives `displayModeChange` through `onEvent`. When entering floating mode, the host records the docked width so the index keeps its current layout. Empty panel space can be dragged, with the per-part floating geometry stored in `DocStore`; links, controls, and text headings retain their normal interactions. Consequently, moving an index into the floating panel changes only placement state; it does not alter semantic index data or create another index store.

Hosted indexes left-align and wrap their title. Their display-mode control wraps below the title when both cannot fit on one row. A docked index can expand to the available viewport space on its right, up to its configured maximum width; item labels use hard wrapping, including breaks inside a word, when they still exceed that width. Hosted indexes do not own a vertical scrolling viewport; page scrolling handles an index taller than the document. A `DocLink` whose resolved source path equals `DocStore.docCurrentPath` receives current-link state, which index layouts render with a yellow background. When the current side-panel item is the part root, the hosted index title receives the same yellow emphasis instead.

The docked/floating control is host-only. Normal `mdx` and `commentBlock` placements do not receive `isDisplayModeControlEnabled`, so an index embedded in document content remains a plain document component.
