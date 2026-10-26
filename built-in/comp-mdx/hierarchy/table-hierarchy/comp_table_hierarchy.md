# TableHierarchy

`TableHierarchy` renders a table whose row dimension can contain any number of grouping levels. It is intended for capability matrices and other comparisons where a flat Markdown table would repeat parent labels.

## Grammar

The fenced YAML block has three main lists:

- `columns` defines comparison columns. Every column requires a unique `id` and a `label`.
- `rows` defines the recursive row dimension. A group row has `children`; a leaf row has `cells`. One row cannot have both.
- A leaf's `cells` mapping contains one value for every column ID.

`title` is the optional panel title, falling back to `rowHeader`. The title bar contains expand-all and collapse-all icon buttons and stays outside the scrolling content. `rowHeader` labels the grouped row columns and defaults to `項目`. Columns and rows may have an optional `description`.

````markdown
<!--renderComp=TableHierarchy-->
```yaml
title: API 対応状況
rowHeader: 操作
columns:
  - id: cli
    label: CLI
    cellComponent: TableCapabilityCell
  - id: api
    label: Web API
    cellComponent: TableCapabilityCell
rows:
  - label: テーブル行
    children:
      - label: 書き込み
        children:
          - label: 作成
            cells:
              cli: partial
              api: yes
          - label: 更新
            cells:
              cli: no
              api:
                status: yes
                note: PATCH を使用
      - label: 削除
        cells:
          cli: no
          api: yes
```
````

Rows may be nested to different depths. The component calculates row spans for group labels and lets a shallow leaf span the unused row-header columns.

## Group Layout and Expansion

`groupDisplay` selects how non-leaf rows appear:

- `column` (default): each grouping level occupies a row-header column. The label spans its currently visible descendants vertically.
- `row`: each group appears as a full-width separator row with a chevron, label, and horizontal rule. Its descendants use a small indent rather than additional columns.

Set `groupDisplay` on the table to choose the default for all groups, or on an individual group to override it. Both forms may be mixed in one table, including at different nesting levels.

Every non-leaf item has an expand/collapse button. `isExpandedDefault` on the table defaults to `true`. A group's `isExpanded` boolean overrides that initial state. Collapsing a parent hides its descendants without discarding their individual expansion state. Changing the authored table data resets interactive state to the authored defaults.

For divider-style (`row`) groups, the chevron toggles the group. Clicking the divider, item name, or comment also toggles after release when the press and release coordinates match and no text is selected. Text selection remains available; links, info icons, and other controls do not toggle their parent group. The title-bar buttons change all groups, including currently hidden descendants.

```yaml
groupDisplay: row
isExpandedDefault: true
rows:
  - label: Dataverse
    isExpanded: true
    children:
      - label: テーブル行
        isExpanded: false
        children:
          - label: 参照
            cells:
              cli: no
              api: yes
      - label: 定義
        groupDisplay: column
        children:
          - label: 参照
            cells:
              cli: partial
              api: yes
```

This fragment uses the `cli` and `api` columns from the earlier example. A collapsed group remains visible with its chevron; its hidden children do not contribute visible rows or row spans.

## Custom Header Controls

Both hierarchy views accept a `headerRight` mapping with `component`, optional `data`, and optional `config`. Register its renderer with `placementList: ['hierarchyHeader']`. It appears beside the expand/collapse controls; the hierarchy does not implement its domain-specific controls.

```yaml
headerRight:
  component: MetricControls
context:
  scale: 1
```

The header renderer receives its authored `data` plus normalized `columns`, `rows`, and the shared `context`. Custom list rows receive `data.context`; registered labels and table cells receive `config.context`. Emit `onEvent('contextChange', { context: { scale: 2 } })` to shallow-merge a patch into that instance's context. Nested values must be replaced as complete values. Other events continue to the host. Context changes do not reset expansion; changed authored data resets both. `SwitchView` preserves visited views, so context survives view switches.

## Horizontal Scrolling

When the table is wider than its panel, use the scrollbar, touch panning, or drag horizontally with the primary mouse button on non-interactive table content. A small movement threshold distinguishes dragging from clicking. Dragging does not start on controls, selectable item names, or divider-style group rows. The scroll panel is keyboard-focusable for native keyboard scrolling.

## Height and Width

- `heightMode: auto` (default) uses the natural content height.
- `heightMode: fixed` reserves exactly `height` for the entire panel, including its title bar. The body scrolls vertically when needed.
- `heightMode: max` grows naturally up to `height`, then scrolls its body.

For fixed and maximum modes, `height` defaults to `24rem`. A numeric size is interpreted as pixels; CSS lengths such as `20rem`, `320px`, or `60vh` are also accepted.

Set `density: roomy` to increase vertical cell padding; the default is `normal`. Set `cellBorders: true` to draw the internal cell grid. Both options are per table and do not affect other hierarchy instances.

`rowHeaderWidth` controls each row-name column and defaults to `10rem`. Each comparison column may specify `width`, defaulting to `9rem`. Divider-style groups do not create extra name columns. Plain item names and plain data values truncate with ellipsis and expose their full value through the native `title` tooltip. Custom cells control their own content layout and are not given the plain-text truncation class.

```yaml
heightMode: max
height: 32rem
density: roomy
cellBorders: true
rowHeaderWidth: 9rem
columns:
  - id: score
    label: Score
    width: 6rem
```

## Cells

A general cell accepts a string, number, boolean, or `null`, or a mapping with `value`. Plain values use the default text renderer. A mapping without `value` or `component` is passed as a structured `data.value`, allowing a column renderer to interpret any domain-specific shape:

```yaml
cells:
  model: Model A
  score: 95.2
  isAvailable: true
```

Every leaf must explicitly define every declared column. `null` is an intentionally empty cell; an omitted value is a configuration error.

### Registered Cell Components

`TextInfoCell` renders a compact label followed by a Lucide info icon with a native tooltip. It is a registered cell renderer, not a special hierarchy field. Use it for group or leaf names in either hierarchy view, or for ordinary table cells. The info button is keyboard-focusable and exposes its explanation in its accessible label.

```yaml
label:
  component: TextInfoCell
  value: Table settings
  data:
    tooltip: Display names and editable table properties, not data rows.
```

A column's `cellComponent` supplies a default renderer for its cells. An individual cell can override it with `{ component, data, config }`. Row `label` also accepts this component mapping; optional `value` supplies its plain-text accessible name. A component receives `data.value` plus its authored `data`, and the standard `config` and `onEvent` props.

```yaml
columns:
  - id: metric
    label: Metric
    cellComponent: MetricCell
rows:
  - label:
      component: ModelNameCell
      value: Model A
      data:
        name: Model A
    cells:
      metric:
        component: MetricChart
        value: 95.2
        data:
          points: [91, 94, 95.2]
```

Components resolve through the existing registry with placement `tableCell`. The host must register the component and include `tableCell` in its `placementList`:

```js
'project/MetricCell': compDefine(MetricCell, { placementList: ['tableCell'] })
```

Unknown or disallowed components use the registry's standard error display. The table owns cell containers and row grouping, not domain-specific data presentation.

### Capability Renderer

The Power Platform comparison uses the separate `TableCapabilityCell` renderer. Set `cellComponent: TableCapabilityCell` on its columns for shorthand status values or structured `{ status, label, note }` values. Optional `label` overrides the status text without changing its symbol; `note` adds supporting text. The generic table does not interpret these statuses:

```yaml
cells:
  cli: partial
  api:
    status: yes
    note: GET、POST、PATCH、DELETE
```

Supported status IDs are:

| ID | Display |
| --- | --- |
| `yes` | ○ 対応 |
| `partial` | △ 一部対応 |
| `no` | × 非対応 |
| `na` | — 対象外 |
| `unknown` | ? 未確認 |

Every leaf must explicitly define every declared column. This keeps an omitted value from being mistaken for `no` or `unknown`.

## Alternate Presentation

The same `columns` and `rows` can be used by [ListHierarchy](../list-hierarchy/comp_list_hierarchy.md) with a custom row renderer instead of a cell grid. Embed both components in [SwitchView](../../switch-view/comp_switch_view.md) and share the dataset through YAML anchors. Set column order once to keep tool priority consistent in the table and the list.