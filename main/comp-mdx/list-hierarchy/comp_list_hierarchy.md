# ListHierarchy

`ListHierarchy` renders recursive groups with custom block-level leaf rows. It shares data normalization, initial expansion, sizing, and bulk expansion logic with `TableHierarchy`, but does not render a comparison-cell grid.

## Grammar

````markdown
<!--renderComp=ListHierarchy-->
```yaml
title: Operations
rowComponent: BadgeRow
isExpandedDefault: false
heightMode: fixed
height: 32rem
rows:
  - label: Group
    isExpanded: true
    children:
      - label: Read
        data:
          badges: [Tool A, Tool B]
      - label: Write
        component: DetailRow
        data:
          value: 42
```
````

- Groups contain `label` and `children`. `isExpanded` overrides the table-wide `isExpandedDefault` (default `true`). Set it on each nested group that should start expanded.
- Leaves contain `label` and either custom `data` or comparison `cells`. A group cannot also contain leaf data or cells.
- `rowComponent` is the default leaf renderer; a leaf's `component` overrides it. Every leaf needs a renderer through one of these properties.
- `columns` is optional for custom-row data. If using `cells`, declare columns exactly as in `TableHierarchy`; every leaf must supply every column.
- `heightMode`, `height`, and selectable labels behave like `TableHierarchy`. Group layouts always use a divider and a small hierarchy indent, regardless of `groupDisplay`.

A stationary click on a group name or comment toggles after release if no text is selected. Selection gestures and clicks on links or other controls do not toggle. Labels can use the registered `TextInfoCell` renderer to put an explanation in an info-icon tooltip instead of a second line; see `TableHierarchy` for its cell mapping.

Register row components with `placementList: ['hierarchyRow']`. Each receives `{ data, config, onEvent }`, where `data` contains the authored leaf data plus `row` (the normalized node) and `columns` (the normalized column definitions). The component owns the complete leaf-row layout, including its label and content. It can use `row.labelCell` for a registered custom name or `row.label` for a plain name.

## Supported Tools

`ListSupportedToolsRow` is the capability-specific renderer used by the Power Platform tools document. It consumes the same `columns` and `cells` as the full comparison table:

```yaml
rowComponent: ListSupportedToolsRow
columns:
  - id: toolA
    label: Tool A
  - id: toolB
    label: Tool B
rows:
  - label: Read
    cells:
      toolA: yes
      toolB:
        status: partial
        note: Requires an adapter
```

By default, only `yes` and `partial` appear as badges. Optional `context.toolDisplayById` selects a mode by column ID: `all` displays every status, `supported` displays only `yes`/`partial`, and `hidden` omits that tool. An omitted ID defaults to `supported`. No tool ID is special-cased in the components.

```yaml
headerRight:
  component: ListToolsControls
context:
  toolDisplayById:
    toolA: all
    toolB: supported
```

`ListToolsControls` is a custom `hierarchyHeader` renderer, not part of the generic hierarchy layout. It builds one button per column and cycles `all` → `supported` → `hidden` → `all`, sharing updates through the generic `contextChange` event. Eye, filter, and crossed-eye icons distinguish the modes; tooltips and accessible labels report the current and next mode. See `TableHierarchy` for the reusable header slot and shared-context contract.

Partial support uses an amber warning badge, non-support a red cross badge, unconfirmed support a neutral question-mark badge, and not-applicable a neutral dash badge. Tooltips contain the status, description, and note. Badges sort by `yes`, `partial`, `no`, `unknown`, then `na`; within each status they retain authored column order. Unknown status IDs render an error rather than silently hiding a tool. If all tools are hidden, the row shows `表示対象なし` rather than suggesting none are supported.