# A Database Migration as Data: Design

The migration components of the [Power Platform series](power-platform.md), in `comp-mdx/power-platform/migration/`: what a migration between two Dataverse databases holds as **data items**, the [scenes](card-diagram-flexible-switch.md) generated from them, and the editors of each kind of item. They are the **modes** of a [frontend object](../../../main/doc_page_impl_obj_frontend.md): a doc page declares a type naming them, lists one object, and places blocks of it. Nothing here knows a project or a language: every word on screen comes from the items.

```text
type.yaml of the object's folder  a type whose modes are the components below; one object
        │
assets of the object             the data items, one asset per item, each with a path
        │  migrationModelBuild
the model                        tables, option sets, mappings, plan, reports, and what does not fit together
        │  migrationProviderBuild                    │  migrationEditAdapterByKind
scenes by path (the switching layer)                 an item <-> the draft of a card or a diagram (the visual editor)
```

## Data items

The first folder of a path is the **category**: `/example` holds small, sanitized data that illustrations are drawn from; `/real` holds the data of the project. Both hold the same kinds, and no component reads a category by name except for what a block chooses (`param.category`).

| Kind | Path | Holds |
| --- | --- | --- |
| `system` | `/{category}/system` | the two databases, the tool and its steps, `labels`: every word of the scenes |
| `schema-table` | `/{category}/schema/{db}/table/{logical}` | `db`, `logical`, `name`, `columnList`, `isMaster?`: a master table, marked in every scene |
| `schema-choice` | `/{category}/schema/{db}/choice/{logical}` | `db`, `logical`, `name`, `optionList: [{ value, label }]`, `isGlobal?` (`false`: [only one column uses it](#option-sets)) |
| `mapping-table` | `/{category}/mapping/table/{source}--{target}` | `source`, `target` (keys of tables), `columnKeyList` (keys of its column mappings), `label?`, `match?`: the id of the [pattern](#finding-a-row-in-the-target) that finds its rows in the target (the first pattern when absent), `isTableLevel?`: mapped as a whole table, with no column mappings: one line between the tables |
| `mapping-column` | `/{category}/mapping/column/{source}--{target}/{id}` | `table`, `source`, `target` (column ids; `null` target: abandoned, `null` source: a default), `kind`, `label`, `stepList` |
| `mapping-choice` | `/{category}/mapping/choice/{source}--{target}` | `source`, `target` (keys of option sets), `label`, `optionList: [{ from, to }]` (`null`: not carried over) |
| `plan` | `/{category}/plan` | `orderNote`, `batchList`: `{ table, file, range, rowCount }`, or `{ table, isOmitted: true, count, rowCount }` for the many batches a drawing leaves out |
| `plan-post` | `/{category}/plan-post` | [what is done after the migration](#after-the-migration): `intro`, `master`, `audit` |
| `report-run` | `/{category}/report/run` | `stat`, `batchList`, `dlqList`, `flow`: the words of its steps (`send`, `retry`, `dlq`: `{ title, tag, text }`) |
| `report-verify` | `/{category}/report/verify` | `stat`, `checkList`, `exceptionList`, `flow` (`set`, `compare`, `exception`), `sample`: one row worked through (`{ key, note, rowList: [{ column, source, expected, actual, result, isProblem? }] }`), `matchIntro`, `matchList`: [the patterns of finding a row](#finding-a-row-in-the-target) |
| `layout` | `/{category}/layout` | `sceneByPath: { path: { box } }`, written by the viewer |

**A column** is `{ id, name, logical, type, key?, isRequired?, description?, lookup?: key of a table, choice?: key of an option set }`. **A step** of a column mapping is `{ op: text, name, description }`, `{ op: mapping, name, rows: [{ key, value }] }`, `{ op: choice, mapping: key of a mapping-choice }` or `{ op: abandon }`.

An item names another by its **key**, which never changes, not by its path, as [the frontend object layer recommends](../../../main/doc_page_impl_obj_frontend.md#the-entry-asset). What does not fit together (a lookup naming a table not found) is listed under the viewer and leaves the rest drawn. Any item may say `isUnverified: true`; the viewer says how many are.

## Scenes

| Path | Scene |
| --- | --- |
| `/overview` | the databases (their ER diagrams, embedded), the tool, the three reports (embedded) |
| `/overview/tabs/{plan,run,verify}` | the same, the reports in tabs |
| `/overview/{db}/{choice}` | one option set, with each table using it, cut down to its key and those columns, which point to it |
| `/overview/{db}` | the database, in [three views](#the-views-of-a-database): a cylinder on its card; the ER diagram, arranged by `er-columns` ([Arrangers](card-diagram-arrange.md)): tables by their lookups, option sets below, lines from each column; and its lookup matrix |
| `/overview/{db}/{table}` | one table, what it refers to, what refers to it |
| `/overview/{db}/{table}/{refer}` | one lookup, opened from a cell of the matrix: the table looking up, cut down to its key and the columns that do, the table looked up, and a [link](comp-card-diagram-switch.md#a-link-to-a-scene) from each column to its column mapping, where it has one (in the target database, what the column comes from) |
| `/overview/mapping` | both ER diagrams, each arranged by `er-columns`, then together by `er-spread` ([Arrangers](card-diagram-arrange.md)): a right-angled line per mapping of tables and of option sets, in a track clear of the cards, whose label opens it and is placed clear of them |
| `/overview/mapping/{pair}` | two tables; a line per column mapping, whose label opens it. The lines of abandoned columns go through `er-lanes` ([Arrangers](card-diagram-arrange.md)), a lane each |
| `/overview/mapping/{pair}/{column}` | one column through its operators, the rest of the tables [behind row breaks](comp-diagram-er.md#rows-behind-a-row-break) a reader can open |
| `/overview/choice`, `/overview/choice/{pair}` | the mappings of option sets; value to value |
| `/overview/plan`, `/overview/run`, `/overview/verify`, `/overview/post` | a report: its sections in a [stack](card-diagram-flexible-switch.md#a-scrolling-stack), at full height both in the overview and on its own |
| `/overview/post/master`, `/overview/post/audit` | [after the migration](#after-the-migration): the references to master tables, the system columns |
| `/overview/plan/order` | the order of loading, as its ranks |
| `/overview/run/flow` | how the rows were sent: each table with its rows bracketed into batches, a card per batch with its result, send, retry, dead letters, the tables of the target with the rows that reached them (found through the table mappings; the database itself when a table has no mapping yet), the report |
| `/overview/verify/flow` | how the result was checked: the same batches as the reference, the set compared, the values compared with what is read back from the tables of the target, the checks, the exceptions |
| `/overview/verify/match`, `/overview/verify/match/{id}` | how a row of the source is found in the target: the patterns one under another, or one alone |
| `/overview/verify/sample` | one row worked through, column by column |
| `/overview/plan/batch`, `/overview/run/{batch,dlq}`, `/overview/verify/{check,exception}` | the tables, each a scene of its own |

**A report shows how it went, then what came of it** ([a matter of taste](card-diagram-usage.md#a-matter-of-taste-show-how-it-happens-then-what-came-of-it)). The run report and the verification report start with their process, a diagram with the actual figures on it, and hold short cards of totals; the tables are scenes of their own which those cards, and the steps of the diagram, open.

**The order of loading is computed, not written** (`migrationRankBuild`), from the lookups of the target, where the rows are loaded: a table can load once what it looks up has loaded, so its rank is one past the highest rank it looks up, and a table looking up nothing has rank 1. The scene draws how that comes about: the tables as labels, one line per pair of tables where one looks up the other (however many columns do), in bands by rank, wrapping as [a list on a canvas should](card-diagram.md#drawing-conventions). A lookup closing a cycle cannot be honored by an order: it is drawn dashed with a word from the data, to be filled in by a later pass.

### The views of a database

`/overview/{db}` has three [views](card-diagram-flexible-switch.md#the-views-of-a-scene), built from the same items:

| View | Shows | Where |
| --- | --- | --- |
| `icon` | a [`card-database`](card-diagram-impl.md#node-registries) with the name of the database | the default embedded, as in the overview: alone in its card, at the size of the card, so the line from the tool ends on its wall; never focused |
| `diagram` | the ER diagram | the default focused, and the hover view of the card, so a click opens what the pointer already shows |
| `matrix` | a [`card-matrix`](card-diagram-impl.md#node-registries): the tables as rows and columns in one order, a dot where the table of a row looks up the table of a column, with the number of its columns beside it when more than one; a mark opens that lookup, a header that table | focused only, since it cannot be read at the size of a card |

The words are in `labels` of the `system` item: `viewDiagram`, `viewLookupMatrix`, `lookupFrom`, `lookupTo`, and `columnMapping` for the links. A bounding box is kept per view, under `{path}@{view}` in the layout item.

### Finding a row in the target

A row can be checked only once its counterpart in the target is found, and how differs by table, so the report says it as **patterns**. The scene opens with a title saying what this is about (`matchIntro`), and each pattern is a lane under a title of its own, in the columns of the flows, seen by dashed dividers rather than blocks inside the block: one row of the source, what the migration server does with its key and what comes of it (one column of cards), the row found in the target.

```text
matchList: [{ id, title, icon?,
  source, target: { table: key of a table, rowList: [{ column: id of a column, value, isKey?, label? }] },
  stepList: [{ id, title, tag?, text?, from: column of the source, to: column of the target }],
  result?: { title, tag?, text } }]
```

The migration project has three, none of them known to the scenes:

| Pattern | When | How |
| --- | --- | --- |
| The same GUID | a table loaded with the GUIDs of the source | the row is read by the GUID |
| Certain columns | a table whose rows are not created by the migration, so their GUIDs differ: users, by `domainname` | the column is compared, with its form made the same (`DOMAIN\user` and a UPN), which gives a table of GUIDs from source to target |
| The ids of both sides | the intersect table of an N:N relationship, which has nothing to compare but those ids | each id is carried over the way its own table's rows are, and the row holding both is looked for |

The tables under a pattern come from `match` of the table mappings. A line never leaves its lane: a lane reads as one pattern, so where one pattern uses what another gives (an intersect table needs the table of GUIDs of the users), its step says so in words. A pattern shown alone keeps its node ids, so an animation can move through them.

### After the migration

Some columns cannot get their value when the rows are loaded. `plan-post` describes the run that sets them, on a server of its own, as a report beside the others (`/overview/post`); without the item there is no such report.

- **References to master tables** (`master`). A master table (`isMaster`) is loaded as a whole table, without its GUIDs (`isTableLevel`, no column mappings), so a lookup of it cannot be carried over: it stays empty at the load. Afterwards a table of GUIDs is made from another column, and the lookups are set. The columns concerned are found from the schemas (`migrationMasterReferListOf`). `{ title, text?, source, target, referSource, referTarget, stepList: [{ id: map | find | write, title, tag?, text? }] }`, where the four tables are `{ table, label?, rowList: [{ column, value, isKey?, tone?, label? }] }`.
- **System columns** (`audit`). The system sets who and when at creation, so the load cannot give the values of the source; a script writes them afterwards. `{ title, text?, source, targetRun, targetPost, stepRun, stepPost }`.

Every scene is a pure function of the model. A table keeps its node id (`table:{db}:{logical}`) in every scene drawing it, which is what lets a switch move it.


### Option sets

An option set is an item of its own, whether or not it is shared. Most are **global**, used by any number of columns. One with `isGlobal: false` belongs to one column (the model says so if more use it), and is drawn with its table rather than on its own:

| Scene | A global option set | One with `isGlobal: false` |
| --- | --- | --- |
| the ER diagram, `/overview/mapping` | a card below the tables, with a line from each column | not drawn |
| `/overview/{db}/{table}` | a card beside the table | the same |
| `/overview/mapping/{pair}` | not drawn | a card under each table, a line from its column, and a line between the two opening the mapping of their values |
| `/overview/mapping/{pair}/{column}` | as an operator | the same operator, and a card under each table |
| `/overview/{db}/{choice}`, the mappings of `/overview/choice` | yes | yes |

A table and an option set of one database share the namespace of `/overview/{db}/{logical}`: the model reports it when they have the same logical name, and the table is what is shown.

## Components

| Component | Mode of | `param` |
| --- | --- | --- |
| `MigrationExplorer` | the scenes | `category`, `path` (the scene first shown; `#item` scrolls a stack to an item), `height` |
| `MigrationTour` | the scenes under the animation layer | `category`, `height`, `stateList`, `transitionList`, `fps` |
| `MigrationItemList` | every item by category and kind | `category` |
| `MigrationSchemaTableEdit`, `MigrationSchemaChoiceEdit`, `MigrationMappingTableEdit`, `MigrationMappingColumnEdit`, `MigrationMappingChoiceEdit` | editing one item | `category`, `item` (a path, a key, `name:…`) |

```yaml
# type.yaml beside the object.yaml of the object
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

**Entering moves nothing.** The bar of the editor stands over the line of the path, where the Edit and New buttons are; they keep their room, unseen, so the line keeps its height and the card its place. A cell keeps the words as they stand when reading, in the same place with the same wrapping: an empty one stays empty and shows its menu when pointed at.

| Item | The draft | What a change means |
| --- | --- | --- |
| a table | a `dataverse-table` card | cells and rows as on any card; the detail of a column adds **Lookup to** and **Option set**, chosen among the items |
| an option set | a `dataverse-choice` card | an option's value is its logical name |
| a mapping of option sets | an `operator-mapping` card | key to value; an empty value is not carried over |
| a mapping of tables | a diagram of the two tables and Abandon, a handle on every column | a line drawn is a new column mapping; a line removed removes it; a line to Abandon abandons the column; its label is the label of the row |
| a column mapping | a diagram of the two tables and its operators | the chain from a source column to a target column is its `stepList`; a second way out of an operator is refused |

**New** creates a table, an option set, or a mapping of a pair; its key and path come from the logical names. The writes go through the object's api (`assetCreate`, `assetWrite`, `assetRemove`): what is new first, then the lists naming it, then what left. A refused save keeps the session open with the reason.

## Implementation

| Place | Role |
| --- | --- |
| `migration/MigrationData.js` | the kinds, the paths, the model |
| `migration/MigrationScenes.js` | the provider: every scene |
| `migration/MigrationEditData.js` | the adapters, a new item |
| `migration/MigrationExplorer.jsx` | reading the items; `MigrationExplorer`, `MigrationTour` |
| `migration/MigrationEdit.jsx` | the host of an editor; `MigrationItemList` |
| `migration/migration-comp.js`, `Migration.css` | the registration, the style |
| `migration/MigrationData.test.js` | every scene of the tree is a valid diagram; items through their drafts |
