# SwitchView

`SwitchView` embeds multiple registered block components as selectable views. Each component must accept YAML input. It uses the existing component registry, not another MDX compilation step.

## Grammar

````markdown
<!--renderComp=SwitchView-->
```yaml
label: Comparison views
viewDefault: table
views:
  - id: table
    label: Table
    icon: table
    component: TableHierarchy
    props: {}
    data: &comparison
      title: Comparison
      rowComponent: MetricRow
      groupDisplay: row
      heightMode: fixed
      height: 32rem
      columns:
        - id: metric
          label: Metric
      rows:
        - label: Model A
          cells:
            metric: 42
  - id: list
    label: List
    icon: list
    component: ListHierarchy
    props: {}
    data: *comparison
```
````

- `views` is a non-empty list. Each entry requires `label`, `component`, and `data`.
- `id` must be unique; if omitted, it defaults to `view-0`, `view-1`, and so on.
- `viewDefault` selects an entry by ID and defaults to the first view.
- `label` names the view selector for assistive technology.
- `icon` accepts `table`, `list`, or `grid`; other values use the generic panels icon.
- `props` is an optional mapping passed as authored component properties. Use `props.config` for authored component configuration.
- `data` accepts a YAML mapping, list, or a string containing YAML. It is supplied as structured data and serialized into `data.raw` as JSON, which is valid YAML 1.2.

YAML anchors can share data between entries. Define an anchor on a complete `data` mapping and reference it in another entry as above, or define anchors on `columns` and `rows` and reference each from both views. `TableHierarchy` ignores the list-specific `rowComponent` setting.

Components resolve through `compRegistry` and must allow placement `commentBlock` (or have no placement restriction). Register `MetricRow` separately with placement `hierarchyRow` for the list example. Unknown and disallowed components use the registry's normal error display. Markdown-only block components are outside this YAML-only contract.

## Interaction

The selector is an accessible tab list. Left/right arrows cycle views; Home/End select the first/last view. View labels remain visible beside their icons and wrap when needed. Views mount on first selection, then stay mounted while hidden, preserving their individual expansion and scroll states. Changing authored data resets the selected view and child state.

`SwitchView` does not add a decorative panel around child panels. Each child owns its height and scrolling. Use the same fixed height in each child's data to keep switching from shifting the surrounding document.

## Renderer Integration

No mirrored `react-doc` runtime changes are required. The host registry registers `SwitchView` and the host Vite configuration supplies `switchViewDependenciesCollect` through the existing `sourceDependencyCollectByCompId` hook. That collector forwards every view, including inactive views, to the nested component's dependency collector during source pruning. As with directly authored components, a custom component that references documents or assets must provide its own collector where required.