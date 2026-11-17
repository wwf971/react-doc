# app-config

A package for keeping **the settings of an app** as **config layers** of a frontend object, stacked into the **final config**. It brings the type `app-config.config` (`type.yaml`) and its mode (`comp-mdx/app-config/`); a doc page imports it by name (`packageList: [{ name: app-config }]`) and holds only the data. The rules of the stack are a pure module (`AppConfigData.js`) and a file of cases (`app-config-case.json`), so a doc page, a desktop app with a backend of its own and a test stack alike.

<!--renderComp=DiagramText-->
```text
config object (app-config.config)                   the package
  item/shared/  partition shared, tracked by git     AppConfigData.js    the stack: declarations,
    declare.{app}   the keys of an app                                   layers, problems, writes
    shared.team     a layer                          app-config-case.json  the contract of the stack
  item/local/   partition local, out of git          AppConfigView       the mode: the final config,
    local.main      a layer (the default target)                         the layers, their changes
        │
        ▼
  final = declared defaults ◀ layers in stack order          a later layer wins, key by key
```

## What it is for, and what it is not

The config of a **page** (whether tags appear beside the path bar, the width of the side panel) is react-doc's own config system, with its own layers: the defaults of the package, the doc pages, the workspace, the reader's browser (`main/doc_page_impl_config.md`). That system is about the page and the workspace.

This package is about **an app's own semantics**: what an app built on react-doc does and shows (whether its example data is shown, the defaults of what it makes). Such an app is often not a doc page at all (a desktop app with an Electron shell and a backend), but it keeps its data as frontend objects (`main/doc_page_impl_desktop.md`), and its config is one more object of the same kind: versioned, split by partitions, readable in a doc page, written by the app itself or by the mode of this package.

## Layers

A **layer** is one item of kind `config-layer` (`app-config.config.config-layer` in react-doc's registry, its shape a schema in `type.yaml`, as is that of `config-declare`: a layer a backend of its own writes is checked when the page reads it), in yaml:

```yaml
label: Team                 # for people
order: 10                   # within its partition: an earlier order is lower in the stack
isDisabled: false           # a disabled layer gives nothing, and is not checked
value:                      # a nested mapping: example.isHidden is value.example.isHidden
  example:
    isHidden: true
  plan:
    rangeCount: 32
```

Its record key is `{partition}.{name}` and its path `/layer/{partition}/{name}` (`appConfigLayerKeyBuild`, `appConfigLayerPathBuild`). Only a value read as a mapping is a layer's value; anything else is said and read as an empty layer (`appConfigLayerParse`).

## Partitions

The partitions of the object say **where a layer comes from and who sees it** ([Partitions](../../../main/doc_page_impl_obj_frontend.md#partitions)), and they are a level of the stack:

| partition | | |
| --- | --- | --- |
| `shared` | tracked by git | what everyone working on the workspace shares: the team's defaults |
| `local` | kept out of git, **the default** | what this checkout or this machine sets over them |

**A partition holds any number of layers.** An app may give a subtype more partitions (one bound to a remote storage point, holding an organization's layers the same on every machine: [Where a partition is stored](../../../main/doc_page_impl_obj_frontend.md#where-a-partition-is-stored)); the rules do not change.

**The simple case is one layer**, `local.main`, made by the first change. With no layer at all the config is its defaults; with no object at all, too: an app reads its defaults until a person sets something.

The repository keeps `local` out: `**/.doc-page/object-frontend/*/item/local/` in its `.gitignore` (react-doc's has it).

## The stack

`appConfigStack({ declareList, layerList, partitionOrder, partitionDeclaredList })`:

1. **The declared keys** are those of every `config-declare` item, merged: a key declared twice keeps its first declaration (`appConfigDeclareListMerge`).
2. **The partitions are ranked**: `partitionOrder` (the metadata of the object's entry) when the object gives one, then the partitions it does not name in the order the type declares them, then any other alphabetically; without `partitionOrder`, the declared order, then the rest alphabetically (`appConfigPartitionOrderBuild`).
3. **The layers are sorted** by the rank of their partition, then `order`, then key: `layerOrder` lists every layer so, the disabled ones too.
4. **Every declared key starts at its default**, then each enabled layer, from the bottom, sets what it holds: the value at the dotted key, unless it is absent or `null` (not set). A value is checked by its type (`appConfigValueCheck`); one with a problem is not taken, so the layer below keeps the key.
5. **What a layer holds that no key takes** is a problem of that layer: a path that is neither a declared key nor on the way to one (`stale`, the topmost such path, not walked into), or a value where the declared keys below need a mapping (`type`).

The answer: `value` (`{ dottedKey: final value }` for every declared key), `sourceByKey` (`{ layer, partition }` where a layer gave the value, `{ isDefault: true }` for a default), `layerOrder`, `problemList` (`{ layer, partition, key, kind, message }`: in stack order; within a layer, what its value holds that no key takes in the order of the mapping, then the declared keys in their order), and, for a view, `layerList` (sorted, with `rank`) and `declareList` (merged).

**With no declaration at all** the stack is untyped: every leaf of every enabled layer is taken as it is, by its dotted path, and nothing is a problem. An app always declares; the untyped stack is for an object read without its app.

## Declarations

An app declares its keys once, in its own code, and **writes the declaration into the object** as a `config-declare` item (key `declare.{app}`, partition `shared`), so the object explains itself to a doc page that has never seen the app:

```yaml
app: example
keyList:
  - { key: example.isHidden, type: boolean, default: false, label: Hide the example, description: … }
  - { key: view.theme, type: enum, default: auto, valueList: [auto, light, dark] }
  - { key: plan.rangeCount, type: number, default: 16, min: 1, max: 256 }
  - { key: view.title, type: string, default: My app }
  - { key: reactDoc.pathList, type: string-list, default: [] }
```

| type | a value | a problem |
| --- | --- | --- |
| `boolean` | `true`, `false` | anything else: `type` |
| `number` | a finite number | not a number: `type`; outside `min` / `max`: `range` |
| `string` | a text | `type` |
| `enum` | one of `valueList` | not a plain value: `type`; another one: `enum` |
| `string-list` | a list of texts | `type` |

The app is the truth of what it declares: it checks what it reads against its own declaration, and writes the item again when the declaration changes (a version per change). A declaration item that cannot be read is said; an entry without a key, or of a type not listed, is left out and said (`appConfigDeclareParse`).

## Writes

**A write names a layer**; a write naming none goes to the top-most enabled layer of the default partition (`appConfigLayerWriteTarget`), and when there is none, the writer makes `local.main` (label `Local`, order 0) with the value in it. A layer is written whole, its other keys as they were: `appConfigValueSet(layerValue, dottedKey, value)` answers a new mapping, `null` removing the key and the mappings it leaves empty. A value set in a layer **above** the one written into still wins: the mode says so beside the value.

A doc page writes through the mode's api (`config.objectFrontend.assetWrite`, `assetCreate`), so a write is a version of the layer with its note. An app with a backend of its own writes the same files itself, in the format of the asset layer (`main/doc_page_impl_desktop.md`).

## The mode

`AppConfigView` is the component of both modes of the type, chosen by `param.section`:

| mode | shows |
| --- | --- |
| `final` (default) | every declared key: label, key, description, final value, where it came from (the layer, or *default*); what the layers hold that is not used; the layers in short |
| `layers` | the layers in stack order, each with every value it sets |

In reading mode it only shows ([Reading and editing](../../../main/doc_page_impl_obj_frontend.md#reading-and-editing)). While the document is edited, and enabled when the object can be written:

- **writes into**: the layer a change goes to, the default target first; without one, the line says the first change makes `local.main` and where it goes;
- a value changed where it stands: a boolean a switch, an `enum` of a few values a group of buttons, anything else a cell of the [cell edit layer](../../../main/doc_page_impl_edit_cell.md), read by its type when it is saved (`appConfigValueFromText`: a text that is not a value of its key keeps the cell open, saying why); × removes it from the layer written into;
- in `layers`: a layer made in a partition (its label, its order, and the line saying where it goes and whether git keeps it: `item/local/layer, kept out of git`), and a layer disabled or enabled.

A mode never writes into a partition without saying so; a partition that cannot be written now (`partitionWriteUnavailableReasonGet`) says why.

## The cases

`app-config-case.json` is **the contract of the stack**: `{ caseList: [{ name, input: { declareList, layerList, partitionOrder, partitionDeclaredList }, expect: { value, sourceByKey, layerOrder, problemList: [{ layer, key, kind }] } }] }`. `AppConfigData.test.js` runs every case (`node --test package/app-config/comp-mdx/app-config/AppConfigData.test.js`): `value`, `sourceByKey` and `layerOrder` compared whole, `problemList` in order on layer, key and kind. **Another implementation runs the same file**: the Python mirror of db-migration-tool reads it from the checkout of react-doc. A change of the rules is a change of the cases first, then of every implementation.

## Files

| file | |
| --- | --- |
| `type.yaml` | the type `app-config.config`: its partitions, its kinds, its modes |
| `comp-mdx/app-config/AppConfigData.js` | the stack and what a writer needs, pure (it reads yaml for a layer's text) |
| `comp-mdx/app-config/app-config-case.json`, `AppConfigData.test.js` | the cases, the tests |
| `comp-mdx/app-config/AppConfigView.jsx`, `AppConfig.css` | the mode |
| `comp-mdx/app-config/comp-app-config.md` | for authors: the block, the items |

The demonstration is in the doc page `example_doc` (`app-config.md`): a config object with a declaration and two layers in `shared`.
