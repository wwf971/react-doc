# Power Platform: Design

The Power Platform series of the package ([README](README.md)), in `comp-mdx/power-platform/`: design diagrams of Dataverse tables and global choices, Power Automate flows and Dataverse business rules, drawn with the engine of the base series ([Card Diagram](card-diagram-impl.md)). The series adds node kinds and binds them to its components; it changes nothing in the engine.

```text
power-platform-node-registry.js
  kinds       dataverse-table, dataverse-choice    DataverseCard (the table card, fixed fields)
              power-automate, business-rule        the resource card, with an icon and an accent
              operator-abandon, operator-text, operator-mapping  compact mapping operations
              + table, operator                    the generic kinds of the base series
  registries  powerPlatformNodeRegistry            DiagramER, DiagramPowerAutomate, DiagramBusinessRule
              dataverseEntityNodeRegistry          DiagramDataverseEntity (dataverse-table alone)
power-platform-comp.js                             the four components (compDefine), named in comp.yaml
```

`DiagramER`, `DiagramPowerAutomate` and `DiagramBusinessRule` are one diagram component (`cardDiagramCompCreate(powerPlatformNodeRegistry)`) exposed three times with another label, icon and starting text, so that a diagram started as a flow may still hold a table. Their components are mounted from the package under the ids `cloud-dev-vis/{tagName}`.

A database migration between two Dataverse databases is built on the series as data: [power-platform-migration.md](power-platform-migration.md).

## Dataverse Tables and Choices

A `dataverse-table` card lists its columns with the fixed fields Key, Column, Logical name and Type (`dataverseTableSchema`, `DataverseCardSchema.js`); a required column is starred and its description is the tooltip of its name. A `dataverse-choice` card is a global choice: a purple header and a dashed border, its options as rows, and it is referenced as a whole. The ER grammar written before `version: 1` (`tables`, `relationships`) converts to these two kinds ([Existing ER Data](card-diagram-impl.md#existing-er-data)).

### Anchors

A `dataverse-table` offers `body` and `column/<id>` (left and right); a `dataverse-choice` adds `header`, and its rows take no handles; a resource card offers `header` and `property/<id>` on every side. The title line of a table is not an anchor of its own, though a line to the table as a whole [is drawn there](card-diagram-impl.md#handles-and-anchors).

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

Files for each resource share a prefix: `PowerAutomateNode*` and `BusinessRuleNode*` contain its card (the resource card of the base series with an icon and an accent color), its fields and validation, and its starting text. The kinds themselves (contract, schema, card, create entry) are declared in `power-platform-node-registry.js`. See [Power Platform diagrams](comp-powerplatform.md) for complete examples and design-specific caveats.

## Mapping Operators

The Power Platform registry adds three compact operators, implemented in files named `OperatorXxx` beside the other kinds. They are available from the create panel of `DiagramER`, `DiagramPowerAutomate` and `DiagramBusinessRule`; the generic `CardDiagram` and standalone `DiagramDataverseEntity` registries are unchanged.

| Renderer type | Content | Default width | Initial handles |
| --- | --- | --- | --- |
| `operator-abandon` | Editable `name` label, defaulting to Abandon | 96 | Left input, right input |
| `operator-text` | Editable `name` header and `description` text | 200 | Left input, right output |
| `operator-mapping` | Editable `name` header and `rows: [{ id, key, value }]` | 240 | Left input, right output |

These are declarative mapping steps, not executable operations. Abandon is a sink: either side accepts an incoming field to discard. The other operators transform or translate a value between tables. Headers use 12px text at the default root font size, smaller than the Dataverse card's 14.4px, with reduced padding and row heights. Width and height still follow the shared node-sizing contract.

Every operator exposes a `body` anchor on the left and right only. A mapping also exposes `row/<id>` anchors on those sides; its title does not take handles. The create panel supplies explicit starting handles, while authored YAML must declare its own handles as usual. Connections still belong to the shared engine, not the cards.

```yaml
nodes:
  - id: discard
    renderer: { type: operator-abandon }
    data: { name: Abandon }
    handles:
      - { id: left, direction: in, anchor: { target: body, side: left } }
      - { id: right, direction: in, anchor: { target: body, side: right } }
  - id: normalize
    renderer: { type: operator-text }
    data: { name: Normalize email, description: Trim and lowercase. }
    handles:
      - { id: left, direction: in, anchor: { target: body, side: left } }
      - { id: right, direction: out, anchor: { target: body, side: right } }
  - id: status
    renderer: { type: operator-mapping }
    data:
      name: Status mapping
      rows:
        - { id: active, key: A, value: Active }
        - { id: inactive, key: I, value: Inactive }
    handles:
      - { id: left, direction: in, anchor: { target: body, side: left } }
      - { id: right, direction: out, anchor: { target: body, side: right } }
```

The mapping is a fixed-column schema over the shared `TableCard`: exactly **Key** and **Value**, in that order. Do not author `data.fields`; it is rejected rather than silently changing the schema. Column insertion, deletion, reordering and renaming are unavailable. Entry IDs remain stable while either cell is edited; rows can be inserted, reordered or removed using the normal card controls. Duplicate row IDs are rejected. Empty row lists are valid. Row removal follows the engine's existing connection-detachment rules.

The Abandon label, text and key/value cells use the existing `CardCell` and injected `EditableValueComp`, so edits participate in the diagram draft, cell cancellation and block Save/Cancel. Abandon nodes with no authored `data.name` still display Abandon; editing writes the label to `data.name`, which must be text. Cancel preserves the original data, including a missing name. There is no independent write path and no raw input/textarea control. The mapping schema and normalizer enforce the column limit even outside the UI.

The focused regression file is `comp-mdx/power-platform/OperatorNodes.test.js`. From `main/frontend`, run:

```sh
node --import ./src/lib/node-test-register.js --test ../../package/cloud-dev-vis/comp-mdx/power-platform/OperatorNodes.test.js ../../package/cloud-dev-vis/comp-mdx/card-diagram/DiagramERData.test.js ../../package/cloud-dev-vis/comp-mdx/card-diagram/DiagramEditStore.test.js
```

## The Standalone Dataverse Card

`DiagramDataverseEntity` is the standalone card of the series (`cardStandaloneCompCreate(dataverseEntityNodeRegistry)`, [Standalone Cards](card-diagram-impl.md#standalone-cards)): one `dataverse-table` node in the flow of the document, without React Flow, connectors, panning, zooming, or dragging. Displayed text remains normal selectable and copyable DOM text.

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
- Inline and asset-backed cards share the visual editor of the diagrams (`DiagramVisualEdit`, [card-diagram-impl.md](card-diagram-impl.md#card-editing)): cells typed in place, rows inserted / moved / removed from the toolbar of a focused row or the lists of the edit card, row handles added and removed from the row's detail or the row edges; the edit card stands beside the whole card and is driven by its path ([comp-diagram-er.md](comp-diagram-er.md#diagram-er-edit)). Drafts save on Save or normal exit, to the asset or inline YAML; Cancel discards them.

### Display Requirements

- Display the entity name and logical name in the header.
- Display columns in this order: Key, Column, Logical name, Type.
- Use the same width and content-driven height as an ER diagram table node, without creating unused canvas space.
- Allow horizontal scrolling for the complete table only when its content does not fit within the document width.
- `height: auto` follows the content. An explicit numeric height constrains the wrapper and enables scrolling.
- Do not provide diagram interactions such as zooming, panning, translation, dragging, or connectors.
- When input loading or parsing fails, display the error with its reason in place of the card.
- Both modes render inside `BlockPopupSurface`: the card opens in the block popup and is edited there; the surface's outer box (`.doc-vis-card-shell`) carries the block's margins ([Block-like components](../../../main/doc_page_impl_mdx_comp_block.md)).
