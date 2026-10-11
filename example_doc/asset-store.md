---
title: Asset Store
description: A component block takes its data from a versioned object in the asset store instead of carrying it inline
---

A component is usually written as a comment marker followed by a code block holding its data. The data can also live in the **asset store**: versioned objects, each with its own history, kept in one or more folders on disk. The document then holds a short reference in place of the data, and the component renders exactly as if the data were written inline. The component does not know the difference; the page resolves the reference before the component sees its input.

An object is modeled after an object storage: a key with metadata, and under it versions, each a sequence of bytes. The store does not care whether the bytes are text; the page finds out when it reads them. A component block, which reads text, shows an error when the bytes of the version are not text.

## Reference form

The code block after the marker is written in the language `asset`. Its content is YAML naming the store, the object (by its name, or by its id) and, optionally, a version:

````markdown
<!--renderComp=Image-->
```asset
store: local
name: hero image
```
````

- `store`: the store the object is in. `local` is the store of this page; it is the only one for now (remote stores are a planned feature, and a reference will name them the same way)
- `name`: the name of the object, chosen by a person and unique in the store, so it names one object; the usual way to write a reference by hand
- `objectId`: the id of the object instead (an ms_48 id); what the page writes when it creates a reference itself
- `versionId`: a version id, or `head` (the default when the key is missing)

`store` is required, with one of `name` and `objectId`: a reference always says where its object is and which one it is, so the page never has to guess or create anything. A reference reading `head` follows the object's head: moving the head changes what every such reference shows. A reference with a version id is pinned to that version until the document is edited.

## The asset panel

A component whose data comes from the store looks exactly as it would with the data written inline; while the data loads, or when the reference cannot be resolved, a short line with the component name and the object stands in its place. The store is reached from edit mode: switch **Edit** on in the toolbar (see [In-place Editing](edit-in-place.md)), hover the component, and the toolbar floating above it shows an **asset** button next to Edit. The button opens the asset panel for the object: its metadata and what happened to it, every version with its time, size and note (one table, so the columns line up), the data of any version, and, on the development server, the actions that change the object. A click on a version selects it; a click on the selected version unselects it again.

The side-panel button in the header of the panel (left of the close button) opens a **preview** pane at the right: the component of the block the panel was opened from, rendered with the data as it is in the panel now. While the head text is being edited, the pane follows every keystroke and shows what a save would render as; otherwise it shows the selected version. The same button collapses the pane again.

## Image, by name, reading the head

The object below is referenced by its name. It has two versions, and the reference reads the head, which is version 2 (the office worker). Open the panel, select version 1 and **Set as head**: the image changes to the robot, here and in every document reading the head of this object.

<!--renderComp=Image-->
```asset
store: local
name: hero image
```

This object's save mode is **new version**: a save of its head text in the panel appends a version instead of rewriting the head (see [Changing the data](#changing-the-data)).

The data of each version names an image file of the source by its source path (`src: ~example/mdx-usage/image/office-worker.svg`), and each version declares that file as a **dependency** (see [Dependencies](#dependencies)); the panel lists the dependencies of the selected version under the version table.

## ImageGrid, by id, one version

The same reference form works for any component that takes a code block: here `ImageGrid` with its YAML in the store, referenced by the object's id.

<!--renderComp=ImageGrid-->
```asset
store: local
objectId: w4okcpzk7k5
```

## StockTable, pinned to a version

This table object also has two versions; the document pins the first one, so moving the head changes nothing here; the asset panel marks the pinned version with `read here`. The marker keeps its own props (`title`) as usual: a reference replaces the data block only.

<!--renderComp=StockTable,title=Warehouse B (start of month)-->
```asset
store: local
objectId: w4okcraoqic
versionId: w4okcraofnf
```

The same object, reading the head (the second version, after the delivery):

<!--renderComp=StockTable,title=Warehouse B (now)-->
```asset
store: local
objectId: w4okcraoqic
```

## Moving inline data into the store

A component block whose data is written inline can be moved into the store from its toolbar: the **to asset** button (an upload arrow, shown next to Edit for such a block) creates an object in the default folder of the local store, with the block's language, and rewrites the block as the reference to it by id. The object gets no name (a name means one object, so two Image blocks could not both be named after the component); give it one in its panel, and the folder of the object is renamed with it. Try it on the block below; the document on disk changes, as with any edit, and the new object appears in the asset panel of the block.

<!--renderComp=Image-->
```yaml
src: mdx-usage/image/robot-computer.svg
alt: A robot operating a computer
caption: Inline data, ready to be moved into the asset store
displayMode: contain
width: 320
height: 240
```

The object is created with the dependencies the component's data has: the `Image` above names `mdx-usage/image/robot-computer.svg`, so the new object's first version depends on `~example/mdx-usage/image/robot-computer.svg`.

## Dependencies

A version of an object can depend on other things: a file of the source (the image an `Image` object names) or another object of the store (a version of it, or its head). The dependencies are part of the version's metadata in `object.yaml`, as a list of typed entries:

```yaml
dependencyList:
  - type: source
    path: ~example/mdx-usage/image/office-worker.svg
  - type: asset
    objectId: w4okcpzk7k5          # the head of that object
  - type: asset
    objectId: w4okcpzk7k5
    versionId: w4okcpzk5gp         # one version of it
```

A `source` dependency is written as a source path (`~rootId/...`), so it names the file whatever document the object is read from. The page records the dependencies itself when it creates an object or saves a version from a component's data (the component declares, in its registry definition, which files its data refers to); the asset api also lets them be read and changed directly (`dependency/list`, `dependency/set|add|remove`), and asked the other way round (`dependent/list`: which versions depend on a given file or object). A build collects the source files the versions depend on, so the asset above keeps working on a built site even though no document names its image directly. The dependencies are the basis of later features, such as telling what a deletion would break.

## Binary data

The store holds bytes, so an object can be an image file or anything else. This object is a small PNG in the second folder of the store (`asset-archive`). A component block reads text, so a reference to it shows what went wrong instead of the component; the asset panel of the block still opens and shows the object: its type and size, a preview since it is an image, and a download link. **Edit head** is greyed out there, with the reason beside it: the head is not text, so there is nothing to edit in the panel.

<!--renderComp=Image-->
```asset
store: local
name: checker tile
```

Upload a file as the head of any object with **Upload file as head** in the panel; the file's bytes become the head data (in place or as a new version, by the object's save mode).

## Changing the data

On the development server the asset panel is writable:

- a click on the head text, or **Edit head**, makes the head text editable in the panel, in the same box and without anything moving, with the caret where the text was clicked. Two save buttons are offered: **Save in place** rewrites the head version (the previous file is kept as `.bak` beside it); **Save as new version** creates a version whose predecessor is the head and makes it the head. The one the object's **save mode** names is the primary button. A click anywhere outside the text and its buttons leaves editing: unchanged, it just closes; changed, it is saved by the save mode (as a new version when the head is locked). Escape cancels.
- the save mode is chosen in the object section of the panel. It is metadata of the object; an object without it (the usual case) saves in place, and **clear** removes a written mode again. It decides what an upload does.
- **Set as head** on a selected version moves the head there.
- **Delete version** removes a version that is not the head; versions that came from it are relinked to its predecessors, so the history stays connected.
- **Delete object** marks the object deleted; its files stay, and **Restore object** undoes the mark. A deletion asks first, right beside its button.
- **Lock version** protects a version: it cannot be rewritten in place or deleted (a save of a locked head makes a new version). **Lock object** protects the whole object: nothing about it changes until **Unlock object**. Locked versions are marked in their own column, and what a lock forbids is greyed out with the reason.
- the object's name is edited in its field; a name another object has is refused.

Every change is written to the object's folder `{folder}/{objectId}--{name}/` (the id alone for an object without a name): the data files `{versionId}.{ext}` and the object file `object.yaml`, which is backed up to `object.yaml.bak` before each rewrite. The object file holds the metadata, the whole version history (each version with its size and hash), and the **events**: what happened to the object and when (`create`, `versionCreate`, `updateInPlace`, `checkout`, `versionDelete`, `metaSet`, `delete`, `restore`, `lock`, `unlock`), each with its time and zone and the version it concerns; the panel shows their count and the last one, and unfolds the list. Since an in-place save leaves no new version behind, the events are where it is recorded. A change made outside the page (an editor, a git checkout) is picked up as soon as it is saved. The default folder of this example has its own `.gitignore` listing the example's files, so new versions, new objects, and backups made while trying the panel stay out of git; edits of the listed files still show, and `git restore example_doc/asset` undoes them. On a built site the objects are bundled into the page as they were at build time, and the panel shows them without the actions.

## The folders of the store

The local store is one store, but its objects may live in several folders: `example_doc/asset.yaml` lists them, relative to that file, and marks the default folder, where new objects are created. The page reads every folder at start and finds an object by its id or name in any of them. The **Asset store** tab of the settings panel (the gear in the side panel) shows the folders with the number of objects in each, and on the development server lets you set the default, remove a folder (its files stay on disk; its objects just leave the store), or add one; the change is written into `asset.yaml`, so it holds across page loads.

## In edit mode

In edit mode an asset-backed component block is edited as source: the block is the reference, and that is what the editor shows, labeled `Image (asset)`. Change the `versionId` there to pin or unpin the block, or replace the fence language and write the data inline to take the block out of the store. The data itself is changed through the asset panel, since it belongs to the object and not to this document.

## What a component knows

The component normally does not know where its data came from. A component that declares `isAssetAware` in its registry definition receives `config.assetInfo` beside its data: `{ isFromAsset: false }` for inline data, or, for data from the store, the store, object id and name, the version read, whether it is the head, the object's save mode and whether it is locked. `Image` and `ImageGrid` are asset-aware: when a paste is about to replace an image whose data is an asset, the confirmation says so and tells whether the paste adds a version or rewrites the head in place. A component that wants its data replaced reports `dataReplaceRequest` with the new text; the page then saves the asset (by its save mode) or rewrites the fenced block, whichever the data is, and the component stays the same in both cases.

## Errors

A reference that cannot be resolved shows its message in place of the component: an unknown store, an unknown object (by id or by name), an unknown version, or a block that is not a mapping with `store` and `objectId` or `name`.

<!--renderComp=Image-->
```asset
store: local
objectId: w4l00000000
```

<!--renderComp=Image-->
```asset
store: local
name: no such object
```

<!--renderComp=Image-->
```asset
objectId: w4okcncucnu
```
