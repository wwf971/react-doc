# A Database Migration as Data: Design

The migration components of the [Power Platform series](power-platform.md), in `comp-mdx/power-platform/migration/`: what a migration between two Dataverse databases holds as **data items**, the [views](card-diagram-flexible-switch.md) generated from them, and the editors of each kind of item. They are the **modes** of a [frontend object](../../../main/doc_page_impl_obj_frontend.md): a doc page declares a type naming them, lists one object, and places blocks of it. Nothing here knows a project or a language: every word on screen comes from the items.

```text
.doc-page/object-frontend.yaml   a type whose modes are the components below; one object
        │
assets of the object             the data items, one asset per item, each with a path
        │  migrationModelBuild
the model                        tables, option sets, mappings, plan, reports, and what does not fit together
        │  migrationProviderBuild                    │  migrationEditAdapterByKind
views by path (the switching layer)                 an item <-> the draft of a card or a diagram (the visual editor)
```

## Data items

The first folder of a path is the **category**: `/example` holds small, sanitized data that illustrations are drawn from; `/real` holds the data of the project. Both hold the same kinds, and no component reads a category by name except for what a block chooses (`param.category`).

| Kind | Path | Holds |
| --- | --- | --- |
| `system` | `/{category}/system` | the two databases, the tool and its steps, `labels`: every word of the views |
| `schema-table` | `/{category}/schema/{db}/table/{logical}` | `db`, `logical`, `name`, `columnList` |
| `schema-choice` | `/{category}/schema/{db}/choice/{logical}` | `db`, `logical`, `name`, `optionList: [{ value, label }]` |
| `mapping-table` | `/{category}/mapping/table/{source}--{target}` | `source`, `target` (keys of tables), `rowKeyList` (keys of its row mappings), `label?` |
| `mapping-row` | `/{category}/mapping/row/{source}--{target}/{id}` | `table`, `source`, `target` (column ids; `null` target: abandoned, `null` source: a default), `kind`, `label`, `stepList` |
| `mapping-choice` | `/{category}/mapping/choice/{source}--{target}` | `source`, `target` (keys of option sets), `label`, `optionList: [{ from, to }]` (`null`: not carried over) |
| `plan` | `/{category}/plan` | `orderNote`, `batchList` |
| `report-run` | `/{category}/report/run` | `stat`, `batchList`, `dlqList`, `flow`: the words of its steps (`send`, `retry`, `dlq`: `{ title, tag, text }`) |
| `report-verify` | `/{category}/report/verify` | `stat`, `checkList`, `exceptionList`, `flow` (`set`, `compare`, `exception`), `sample`: one row worked through (`{ key, note, rowList: [{ column, source, expected, actual, result, isProblem? }] }`) |
| `layout` | `/{category}/layout` | `viewByPath: { path: { box } }`, written by the viewer |

**A column** is `{ id, name, logical, type, key?, isRequired?, description?, lookup?: key of a table, choice?: key of an option set }`. **A step** of a row mapping is `{ op: text, name, description }`, `{ op: mapping, name, rows: [{ key, value }] }`, `{ op: choice, mapping: key of a mapping-choice }` or `{ op: abandon }`.

An item names another by its **key**, which never changes, not by its path, as [the frontend object layer recommends](../../../main/doc_page_impl_obj_frontend.md#the-entry-asset). What does not fit together (a lookup naming a table not found) is listed under the viewer and leaves the rest drawn. Any item may say `isUnverified: true`; the viewer says how many are.

## Views

| Path | View |
| --- | --- |
| `/overview` | the databases (their ER diagrams, embedded), the tool, the three reports (embedded) |
| `/overview/tabs/{plan,run,verify}` | the same, the reports in tabs |
| `/overview/{db}` | the ER diagram: tables by their lookups, option sets below, lines from each column |
| `/overview/{db}/{table}` | one table, what it refers to, what refers to it |
| `/overview/mapping` | both ER diagrams; a line per mapping of tables and of option sets, whose label opens it |
| `/overview/mapping/{pair}` | two tables; a line per row mapping, whose label opens it |
| `/overview/mapping/{pair}/{row}` | one column through its operators, the rest of the tables abbreviated |
| `/overview/choice`, `/overview/choice/{pair}` | the mappings of option sets; value to value |
| `/overview/plan`, `/overview/run`, `/overview/verify` | a report: its sections in a [scrolling stack](card-diagram-flexible-switch.md#a-scrolling-stack) |
| `/overview/plan/order` | the order of loading, as its ranks |
| `/overview/run/flow` | how the rows were sent: each table with its rows bracketed into batches, a card per batch with its result, send, retry, dead letters, the report |
| `/overview/verify/flow` | how the result was checked: the same batches as the reference, the set compared, the values compared with what is read back, the checks, the exceptions |
| `/overview/verify/sample` | one row worked through, column by column |
| `/overview/plan/batch`, `/overview/run/{batch,dlq}`, `/overview/verify/{check,exception}` | the tables, each a view of its own |

**A report shows how it went, then what came of it** ([a matter of taste](card-diagram.md#a-matter-of-taste-show-how-it-happens-then-what-came-of-it)). The run report and the verification report start with their process, a diagram with the actual figures on it, and hold short cards of totals; the tables are views of their own which those cards, and the steps of the diagram, open.

**The order of loading is computed, not written** (`migrationRankBuild`), from the lookups of the target, where the rows are loaded: a table can load once what it looks up has loaded, so its rank is one past the highest rank it looks up, and a table looking up nothing has rank 1. The view draws how that comes about: the tables as labels, one line per pair of tables where one looks up the other (however many columns do), in bands by rank, wrapping as [a list on a canvas should](card-diagram.md#drawing-conventions). A lookup closing a cycle cannot be honored by an order: it is drawn dashed with a word from the data, to be filled in by a later pass.

Every view is a pure function of the model. A table keeps its node id (`table:{db}:{logical}`) in every view drawing it, which is what lets a switch move it.

## Components

| Component | Mode of | `param` |
| --- | --- | --- |
| `MigrationExplorer` | the views | `category`, `path` (the view first shown; `#item` scrolls a stack to an item), `height` |
| `MigrationTour` | the views under the animation layer | `category`, `height`, `stateList`, `transitionList`, `fps` |
| `MigrationItemList` | every item by category and kind | `category` |
| `MigrationSchemaTableEdit`, `MigrationSchemaChoiceEdit`, `MigrationMappingTableEdit`, `MigrationMappingRowEdit`, `MigrationMappingChoiceEdit` | editing one item | `category`, `item` (a path, a key, `name:…`) |

```yaml
# .doc-page/object-frontend.yaml
typeList:
  - id: my.migration
    label: Migration
    modeList:
      - { id: explorer, comp: MigrationExplorer, isDefault: true }
      - { id: tour, comp: MigrationTour }
      - { id: edit-table, comp: MigrationSchemaTableEdit, category: edit }
```

## Editing

An editor shows the item as the framework's card or diagram; **Edit** opens the [visual editor](card-diagram-impl.md#card-editing) on it, with undo and redo. The item is not edited directly: an **adapter** (`MigrationEditData.js`) turns the item into the YAML of the draft, and the draft on Save into writes.

| Item | The draft | What a change means |
| --- | --- | --- |
| a table | a `dataverse-table` card | cells and rows as on any card; the detail of a column adds **Lookup to** and **Option set**, chosen among the items |
| an option set | a `dataverse-choice` card | an option's value is its logical name |
| a mapping of option sets | an `operator-mapping` card | key to value; an empty value is not carried over |
| a mapping of tables | a diagram of the two tables and Abandon, a handle on every column | a line drawn is a new row mapping; a line removed removes it; a line to Abandon abandons the column; its label is the label of the row |
| a row mapping | a diagram of the two tables and its operators | the chain from a source column to a target column is its `stepList`; a second way out of an operator is refused |

**New** creates a table, an option set, or a mapping of a pair; its key and path come from the logical names. The writes go through the object's api (`assetCreate`, `assetWrite`, `assetRemove`): what is new first, then the lists naming it, then what left. A refused save keeps the session open with the reason.

## Implementation

| Place | Role |
| --- | --- |
| `migration/MigrationData.js` | the kinds, the paths, the model |
| `migration/MigrationViews.js` | the provider: every view |
| `migration/MigrationEditData.js` | the adapters, a new item |
| `migration/MigrationExplorer.jsx` | reading the items; `MigrationExplorer`, `MigrationTour` |
| `migration/MigrationEdit.jsx` | the host of an editor; `MigrationItemList` |
| `migration/migration-comp.js`, `Migration.css` | the registration, the style |
| `migration/MigrationData.test.js` | every view of the tree is a valid diagram; items through their drafts |
