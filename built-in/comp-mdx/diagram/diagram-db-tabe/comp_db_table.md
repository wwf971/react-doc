# Dataverse Entity Table

## Purpose

`DiagramDataverseEntity` is a fixed view of one `dataverse-table` node. It shares normalization, markup, and styles with the [diagram renderer](../diagram-er/comp_db_vis.md#fixed-dataverse-view), without React Flow, connectors, panning, zooming, or dragging. Displayed text remains normal selectable and copyable DOM text.

## Input

The component follows the common `{ data, config, onEvent }` interface. In comment-block usage, it receives YAML through `data.raw`.

```yaml
version: 1
node:
  id: entity-example
  renderer: { type: dataverse-table }
  size: { width: 410, height: auto }
  data:
    name: Display name
    nameLogical: logical_name
    description: Optional description
    columns:
      - id: primary_id
        name: Primary key
        nameLogical: logical_name_id
        type: Unique identifier
        key: PK
        isRequired: true
        description: Optional column description
```

- `node.id` and `renderer: { type: dataverse-table }` are required. Handle declarations can be retained and edited for reuse in a diagram; the fixed view does not draw connections.
- `node.data.columns` must contain at least one item; every column needs a unique non-empty string `id`.
- `name`, `nameLogical`, and `type` supply display text, following the shared Dataverse card defaults.
- `key` identifies a key type such as `PK` or `FK`.
- `isRequired` and `description` are optional.
- A column description must be available from the corresponding column-name tooltip without increasing the table's vertical size.
- Legacy `entity: ...` input remains readable through the same model's compatibility adapter.
- Inline and asset-backed cards share the visual editor of the diagrams (`DiagramVisualEdit`, [comp_db_vis.md](../diagram-er/comp_db_vis.md#card-editing)): cells typed in place, rows inserted / moved / removed, row handles added and removed from the Row tab or the row edges. Drafts save on Save or normal exit, to the asset or inline YAML; Cancel discards them.

## Display Requirements

- Display the entity name and logical name in the header.
- Display columns in this order: Key, Column, Logical name, Type.
- Use the same width and content-driven height as an ER diagram table node, without creating unused canvas space.
- Allow horizontal scrolling for the complete table only when its content does not fit within the document width.
- `height: auto` follows the content. An explicit numeric height constrains the wrapper and enables scrolling.
- Do not provide diagram interactions such as zooming, panning, translation, dragging, or connectors.
- When input loading or parsing fails, display the error with its reason in place of the card.
- Both modes render inside `BlockPopupSurface`: the card opens in the block popup and is edited there; the surface's outer box (`.doc-vis-card-shell`) carries the block's margins ([Block-like components](../../../../main/doc_page_impl_mdx_comp_block.md)).
