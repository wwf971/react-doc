# Power Platform: Design

The Power Platform series of the package ([README](README.md)), in `comp-mdx/power-platform/`: design diagrams of Dataverse tables and global choices, Power Automate flows and Dataverse business rules, drawn with the engine of the base series ([Card Diagram](card-diagram.md)). The series adds node kinds and binds them to its components; it changes nothing in the engine.

```text
power-platform-node-registry.js
  kinds       dataverse-table, dataverse-choice    DataverseCard (the table card, fixed fields)
              power-automate, business-rule        the resource card, with an icon and an accent
              + table, operator                    the generic kinds of the base series
  registries  powerPlatformNodeRegistry            DiagramER, DiagramPowerAutomate, DiagramBusinessRule
              dataverseEntityNodeRegistry          DiagramDataverseEntity (dataverse-table alone)
power-platform-comp.js                             the four components (compDefine), named in comp.yaml
```

`DiagramER`, `DiagramPowerAutomate` and `DiagramBusinessRule` are one diagram component (`cardDiagramCompCreate(powerPlatformNodeRegistry)`) exposed three times with another label, icon and starting text, so that a diagram started as a flow may still hold a table. Their components are mounted from the package under the ids `cloud-dev-vis/{tagName}`.

## Dataverse Tables and Choices

A `dataverse-table` card lists its columns with the fixed fields Key, Column, Logical name and Type (`dataverseTableSchema`, `DataverseCardSchema.js`); a required column is starred and its description is the tooltip of its name. A `dataverse-choice` card is a global choice: a purple header and a dashed border, its options as rows, and it is referenced as a whole. The ER grammar written before `version: 1` (`tables`, `relationships`) converts to these two kinds ([Existing ER Data](card-diagram.md#existing-er-data)).

### Anchors

A `dataverse-table` offers `body` and `column/<id>` (left and right); a `dataverse-choice` adds `header`, and its rows take no handles; a resource card offers `header` and `property/<id>` on every side. The title line of a table is not an anchor.

## Power Platform Resource Nodes

`DiagramPowerAutomate` and `DiagramBusinessRule` are the same diagram as `DiagramER`, on the same registry, with different starting text. A diagram may mix their nodes with Dataverse tables, choices, operators, and registered renderers. These are design models, not executable workflow definitions.

| Renderer type | Node data |
| --- | --- |
| `power-automate` | `name`, `kind` (`trigger`, `action`, `condition`, `scope`, `loop`, `terminate`), `connector`, `operation`, `expression`, `description`, `properties` |
| `business-rule` | `name`, `kind` (`condition`, `action`), `table`, `scope` (`Entity`, `All Forms`, `Specific Form`), `action`, `expression`, `description`, `properties` |

Business-rule actions are `setValue`, `setRequired`, `setVisibility`,
`setEnabled`, `showError`, or `recommendation`; the empty action is accepted
for a condition. Property rows are `{ id, name, value, description? }`, all
text. Quote numeric/boolean-looking values. Unknown authored data is retained;
invalid enum values and duplicate property IDs are rejected. Anchors are
`header`, `body`, and `property/<id>`; handles and connections use the existing
direction, side, endpoint, and label rules. No runtime execution order is
inferred from card placement: label branches and run-after conditions explicitly.

Files for each resource share a prefix: `PowerAutomateNode*` and `BusinessRuleNode*` contain its card (the resource card of the base series with an icon and an accent color), its fields and validation, and its starting text. The kinds themselves (contract, schema, card, create entry) are declared in `power-platform-node-registry.js`. See [Power Platform diagrams](../../../example_doc/mdx-usage/comp-powerplatform.md) for complete examples and design-specific caveats.

## The Standalone Dataverse Card

`DiagramDataverseEntity` is the standalone card of the series (`cardStandaloneCompCreate(dataverseEntityNodeRegistry)`, [Standalone Cards](card-diagram.md#standalone-cards)): one `dataverse-table` node in the flow of the document, without React Flow, connectors, panning, zooming, or dragging. Displayed text remains normal selectable and copyable DOM text.

### Input

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
- Legacy `entity: ...` input remains readable: the registry's `cardLegacyConvert` (`dataverseCardLegacyConvert`) turns it into `{ version: 1, node }`.
- Inline and asset-backed cards share the visual editor of the diagrams (`DiagramVisualEdit`, [card-diagram.md](card-diagram.md#card-editing)): cells typed in place, rows inserted / moved / removed from the toolbar of a focused row or the lists of the edit card, row handles added and removed from the row's detail or the row edges; the edit card stands beside the whole card and is driven by its path ([comp-diagram-er.md](../../../example_doc/mdx-usage/comp-diagram-er.md#diagram-er-edit)). Drafts save on Save or normal exit, to the asset or inline YAML; Cancel discards them.

### Display Requirements

- Display the entity name and logical name in the header.
- Display columns in this order: Key, Column, Logical name, Type.
- Use the same width and content-driven height as an ER diagram table node, without creating unused canvas space.
- Allow horizontal scrolling for the complete table only when its content does not fit within the document width.
- `height: auto` follows the content. An explicit numeric height constrains the wrapper and enables scrolling.
- Do not provide diagram interactions such as zooming, panning, translation, dragging, or connectors.
- When input loading or parsing fails, display the error with its reason in place of the card.
- Both modes render inside `BlockPopupSurface`: the card opens in the block popup and is edited there; the surface's outer box (`.doc-vis-card-shell`) carries the block's margins ([Block-like components](../../../main/doc_page_impl_mdx_comp_block.md)).
