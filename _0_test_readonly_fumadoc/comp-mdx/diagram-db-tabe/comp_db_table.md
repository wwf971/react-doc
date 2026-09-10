# Dataverse Entity Table

## Purpose

`DiagramDataverseEntity` renders a Dataverse entity's column definitions as a static table within a document. It uses the same visual language as an ER diagram table, but does not use React Flow, connectors, panning, zooming, or dragging. Displayed text remains normal selectable and copyable DOM text.

## Input

The component follows the common `{ data, config, onEvent }` interface. In comment-block usage, it receives YAML through `data.raw`.

```yaml
entity:
  id: entity-example
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

- `entity.id`, `entity.name`, and `entity.nameLogical` are required.
- `entity.columns` must contain at least one item.
- Each column requires `id`, `name`, `nameLogical`, and `type`.
- `key` identifies a key type such as `PK` or `FK`.
- `isRequired` and `description` are optional.
- A column description must be available from the corresponding column-name tooltip without increasing the table's vertical size.

## Display Requirements

- Display the entity name and logical name in the header.
- Display columns in this order: Key, Column, Logical name, Type.
- Use the same width and content-driven height as an ER diagram table node, without creating unused canvas space.
- Allow horizontal scrolling for the complete table only when its content does not fit within the document width.
- Determine the table height from its content; do not create a component-specific vertical scrolling region.
- Do not provide diagram interactions such as zooming, panning, translation, dragging, or connectors.
- When input loading or parsing fails, display a Japanese error message at the corresponding input location.
