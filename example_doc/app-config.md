---
title: App Config Layers
description: The settings of an app kept as config layers of a frontend object, stacked into the final config; each value said with the layer it came from
---

An app built on react-doc (a desktop app with a backend of its own, a doc page whose components behave by settings) keeps **what it is set to** in a **config object**: a frontend object of the type `app-config.config`, from the package `app-config`. Its items are **config layers**; the layers are stacked, a later one over an earlier one, and the stack gives the **final config**. This is the config of the app's own semantics (whether its example is shown, the defaults of what it makes), not the config of the page, which has its own layers ([Doc Page Config](doc-config.md)). The design is the root document of the package `app-config`.

<!--renderComp=DiagramText-->
```text
config object (app-config.config)
  item/shared/   tracked by git: what everyone shares
    declare.example   the keys the app declares, with types and defaults
    shared.base       order 0    view.theme light, plan.rangeCount 32
    shared.team       order 10   view.density compact, plan.rangeCount 1000 (!)
  item/local/    kept out of git: this checkout's own
    local.main        made by the first change

final = defaults ◀ shared.base ◀ shared.team ◀ local.main      a later one wins
```

## The final config

The block below shows every declared key with its final value and the layer it came from. The object of this page has two layers in the partition `shared`; the second, **Team**, sets a number outside its declared range and a key nothing declares, so it lists them under *Not used*, and the layer below it gives the value instead.

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w65e35oyhmn
```

A block names the object; the mode `final` is the default, `layers` the other (its buttons switch the block while the page is open):

````md
<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w65e35oyhmn
mode: layers
```
````

## The layers

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w65e35oyhmn
mode: layers
```

- **A partition holds any number of layers**, stacked by their `order`, then by key: Base (0) under Team (10).
- **Partitions stack in the order of the type**, `shared` then `local`, unless the object says another in its metadata (`partitionOrder`).
- **A disabled layer gives nothing** and is not checked; it stays in the list, dashed.

## Changing it

Switch the page to **Edit**. The values become controls (a switch for a yes or no, buttons for a few values, a cell for the rest), written into the layer shown beside **writes into**: by default the top layer of the partition `local`. This checkout has none yet, so **the first change makes `local.main`** in `item/local/`, which git keeps out: trying the page changes nothing that is tracked. The × beside a value removes it from that layer, so the layer below gives it again. In the mode `layers`, a layer is made in the partition chosen (the form says where it goes and whether git keeps it), and one is disabled or enabled.

An app writes its declaration into the object itself (`declare.example` here), so a doc page shows its keys with their labels; the app and the page stack the layers by the same rules, and the package carries the cases both are tested against (`app-config-case.json`).
