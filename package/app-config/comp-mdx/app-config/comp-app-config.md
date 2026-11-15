---
title: App Config
description: A config object of the type app-config.config: its layers, its declaration, the block that shows the final config and changes it.
language: en
---

A **config object** keeps the settings of an app as **config layers**, stacked into the **final config**. It is a frontend object of the type `app-config.config`, which this package declares; a doc page holding one imports the package by name, and places it with the entry block `ObjectFrontend`. The design is in [the root document](../../doc/README.md); a working demonstration is the document *App Config Layers* of the doc page `example_doc`.

## The block

````md
<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:{id}     # the config object
mode: final               # optional: final (the default) or layers
```
````

| mode | shows |
| --- | --- |
| `final` | every declared key with its final value and the layer it came from, what the layers hold that is not used, the layers in short |
| `layers` | the layers in stack order, each with every value it sets |

The two buttons in its head switch the block while the page is open. Switch the document to **Edit** to change it: a value is written into the layer beside **writes into** (by default the top layer of the partition `local`, made by the first change), × removes it from that layer, and in `layers` a layer is made, disabled or enabled.

## What the object holds

```text
.doc-page/object-frontend/{id}--{name}/
  item/shared/                   tracked by git
    item-list.yaml
    declare/{itemId}/            declare.{app}      the keys the app declares
    layer/{itemId}/              shared.{name}      a layer
  item/local/                    kept out of git (the default partition)
    layer/{itemId}/              local.main         a layer
```

A layer, kind `config-layer`, key `{partition}.{name}`, path `/layer/{partition}/{name}`:

```yaml
label: Team
order: 10                 # within its partition, an earlier order is lower in the stack
isDisabled: false
value:
  view:
    theme: dark           # the key view.theme
```

A declaration, kind `config-declare`, key `declare.{app}`, written by the app:

```yaml
app: example
keyList:
  - { key: view.theme, type: enum, default: auto, valueList: [auto, light, dark], label: Theme }
```

Types: `boolean`, `number` (`min`, `max`), `string`, `enum` (`valueList`), `string-list`.

## Rules in short

- Partitions stack in the order of the type, `shared` then `local`; `partitionOrder` in the metadata of the object's entry gives another.
- Within a partition, layers stack by `order`, then key; a later layer wins, key by key.
- A value is taken only for a declared key, of its type; anything else is listed as *not used* with its layer, and the layer below gives the value.
- `null` in a layer is not set.
