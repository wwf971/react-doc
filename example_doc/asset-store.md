---
title: Asset Service Layer
description: A component block takes its data from a versioned object in the asset service layer instead of carrying it inline
---

A component is usually written as a comment marker followed by a code block holding its data. The data can also live in the **asset service layer**: versioned objects, each with its own history, kept in one or more folders on disk. The document then holds a short reference in place of the data, and the component renders exactly as if the data were written inline. The component does not know the difference; the page resolves the reference before the component sees its input.

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

A component whose data comes from the store looks exactly as it would with the data written inline; while the data loads, or when the reference cannot be resolved, a short line with the component name and the object stands in its place. The store is reached from edit mode: switch **Edit** on in the toolbar (see [MDX Document In-place Editing](mdx-doc-edit-in-place.md)), hover the component, and the toolbar floating above it shows an **asset** button next to Edit. The button opens the asset panel for the object: its metadata and what happened to it, every version with its time, size and note (one table, so the columns line up), the data of any version, and, on the development server, the actions that change the object. A click on a version selects it; a click on the selected version unselects it again.

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

## Blocks that use an object

Several blocks may read one object, as the two tables above do. The block below reads the `hero image` of the first section again, at a smaller size, and carries an `Anchor` id (`hero-small`) before its marker:

<!--renderComp=Anchor,id=hero-small-->
<!--renderComp=Image,width=200,height=150-->
```asset
store: local
name: hero image
```

The asset panel lists, under **used by**, every block of the documents that references the object: its component, its place (`asset-store.md#hero-small` for this block, a document and a line for a block without an id), and whether it follows the head or is pinned to a version; the block the panel was opened from is marked `this block`. A click on a place goes there. The list is what the page last read: it follows the page's own edits and every document whose content changed, but a document changed while nothing watched may differ, so the read-again button next to the title, and the one next to each place, read the documents again and say what was confirmed or changed. The version table counts the blocks in its **uses** column: on the head row `following | pinned` (here `2|0`), on another row the blocks pinned to it (the StockTable object shows `1|0` on its head and `1` on its first version).

An object made from a block's data (**to asset**, or the insert menu of an asset-only component) records the component it is data for (`component: { name: Image }` in `object.yaml`); the panel shows it in the object section and lets it be changed. A block of another component may still read the object; its row says so.

Deleting a block whose data is an asset object asks about the object too: **Delete block only** leaves the object in the store, **Delete block and asset** marks it deleted with the block (restorable in its panel; not offered while other blocks use it). An object left behind this way, or whose blocks were removed outside the page, is an **orphan**: the **Asset service** tab of the settings panel lists the orphans, the objects no block references that are not a component's data, and the references whose data cannot be read (the error blocks at the end of this page); a click on an object opens its asset panel there. This example has one orphan, `removed banner` (declared for `Image`), and one object that is no component's data at all, `style notes`.

## Moving inline data into the store

A component block whose data is written inline can be moved into the store from its toolbar: the **to asset** button (an upload arrow, shown next to Edit for such a block) asks first, in the toolbar, like a deletion: **Move** or **Keep**. Confirmed, it creates an object in the default folder of the local store, with the block's language (and the save mode the component declares, if it declares one), and then rewrites the block as the reference to it by id. Rewriting the document is the last step, and only it makes the move happen: when it fails, the block keeps its inline data and works as before, and the message names the object that was already created. The object gets no name (a name means one object, so two Image blocks could not both be named after the component); give it one in its panel, and the folder of the object is renamed with it. It does record the component it is data for (see [Blocks that use an object](#blocks-that-use-an-object)). Try it on the block below; the document on disk changes, as with any edit, and the new object appears in the asset panel of the block.

<!--renderComp=Image-->
```yaml
src: mdx-usage/image/robot-computer.svg
alt: A robot operating a computer
caption: Inline data, ready to be moved into the asset service layer
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

## Version metadata

A version can also carry what the **writer of its data** says about that data: a free mapping in its own file, `{versionId}.metadata.yaml`, beside the data file `{versionId}.{ext}` (always yaml, whatever the data's extension). The store keeps it and never reads meaning into it. `object.yaml` stays the store's own record: the object, and for every version its place in the history (its predecessors, time, note), its size and hash, its lock and its dependencies. The metadata file is about the content: which engine wrote it, how a component shows it. A version without metadata has no such file.

The spreadsheet of [ExcelUniver](mdx-usage/comp-excel-univer.md) is an example: its version `w4r63zmf1ga` has

```yaml
engine: univer
engineVersion: 1.1.0
view:
  sheetId: sales
  range: A1:F6
```

A save in place keeps the version's metadata unless the save names new metadata; a new version starts with the metadata of the version it is made from. Deleting a version deletes its metadata file. The asset panel shows the metadata of the selected version under its dependencies.

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

Every change is written to the object's folder `{folder}/{objectId}--{name}/` (the id alone for an object without a name): the data files `{versionId}.{ext}`, the metadata files `{versionId}.metadata.yaml` of the versions that have metadata, and the object file `object.yaml`, which is backed up to `object.yaml.bak` before each rewrite. The object file holds the metadata of the object, the whole version history (each version with its size and hash), and the **events**: what happened to the object and when (`create`, `versionCreate`, `updateInPlace`, `checkout`, `versionDelete`, `metaSet`, `delete`, `restore`, `lock`, `unlock`, `dependencySet`, `versionMetadataSet`), each with its time and zone and the version it concerns; the panel shows their count and the last one, and unfolds the list. Since an in-place save leaves no new version behind, the events are where it is recorded. A change made outside the page (an editor, a git checkout) is picked up as soon as it is saved. The default folder of this example has its own `.gitignore` listing the example's files, so new versions, new objects, and backups made while trying the panel stay out of git; edits of the listed files still show, and `git restore example_doc/asset` undoes them. On a built site the objects are bundled into the page as they were at build time, and the panel shows them without the actions.

## The folders of the store

The local store is one store, but its objects may live in several folders, and the folders belong to doc pages: `example_doc/.doc-page/asset.yaml` lists this doc page's folders as source paths (`~example/asset`, `~example/asset-archive`) and names its default folder, where objects of its documents are created. The sub document in the side panel is a doc page of its own without that file, so it uses its default folder, `~sub-doc/asset` (not on disk until an object is written there). The page reads every folder at start and finds an object by its id or name in any of them. The **Asset service** tab of the settings panel (the gear in the side panel) shows one group per doc page: its folders as a list you edit in place (a path that is not a folder of a known root, or not on disk yet, gets a warning while you type), its default folder, and the number of objects in each folder. On the development server a change is written into that doc page's `asset.yaml` in place, the file created for the sub document the first time, so it holds across page loads; a removed folder's files stay on disk, its objects just leave the store.

## In edit mode

In edit mode an asset-backed component block is edited as source: the block is the reference, and that is what the editor shows, labeled `Image (asset)`. Change the `versionId` there to pin or unpin the block, or replace the fence language and write the data inline to take the block out of the store. The data itself is changed through the asset panel, since it belongs to the object and not to this document.

A component can also declare itself **asset-only**: its data is never written inline. Its block is always a reference; the insert menu creates the object first and then writes the reference block, and the component's own edit mode edits the referenced data, which a leave saves into the object (by its save mode) while the document stays as it is. [ExcelUniver](mdx-usage/comp-excel-univer.md) is one; an asset-only component whose data was written inline anyway shows an error asking for **to asset**.

## What a component knows

The component normally does not know where its data came from. A component that declares `isAssetAware` in its registry definition receives `config.assetInfo` beside its data: `{ isFromAsset: false }` for inline data, or, for data from the store, the store, object id and name, what the reference asks for (`head` or a version id) and the version read, whether it is the head, the hash of the data, the object's save mode, whether it is locked, and the version's metadata. `Image` and `ImageGrid` are asset-aware: when a paste is about to replace an image whose data is an asset, the confirmation says so and tells whether the paste adds a version or rewrites the head in place. A component that wants its data replaced reports `dataReplaceRequest` with the new text; the page then saves the asset (by its save mode) or rewrites the fenced block, whichever the data is, and the component stays the same in both cases. A component that wants to know whether another block, or something outside the page, changed the object reports `assetRefreshRequest`: the page reads the object again and answers whether the data the component reads changed.

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
