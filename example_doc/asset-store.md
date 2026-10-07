---
title: Asset Store
description: A component block takes its data from a versioned text object in the asset store instead of carrying it inline
---

A component is usually written as a comment marker followed by a code block holding its data. The data can also live in the **asset store**: one folder of versioned text objects, each with its own history. The document then holds a short reference in place of the data, and the component renders exactly as if the data were written inline. The component does not know the difference; the page resolves the reference before the component sees its input.

## Reference form

The code block after the marker is written in the language `asset`. Its content is YAML naming the object and, optionally, a version:

````markdown
<!--renderComp=Image-->
```asset
objectId: w4laejhlzjh
```
````

- `objectId`: the id of the object in the asset store (an ms_48 id)
- `versionId`: a version id, or `head` (the default when the key is missing)

A reference reading `head` follows the object's head: moving the head changes what every such reference shows. A reference with a version id is pinned to that version until the document is edited.

## The frame

Above a component whose data comes from the store, the page shows one title line: the component name, the object's name, the version being read and whether it is the head, and at the right end an **asset** button. The button opens the asset panel for the object: its metadata, every version with its time and note, the text of any version, and, on the development server, the actions that change the object. The line is switched off with the page config `AssetFrameIsOn` (the gear at the top of the sidebar).

## Image, reading the head

The object below has two versions. The reference reads the head, which is version 2 (the office worker). Open the panel, select version 1 and **Set as head**: the image changes to the robot, here and in every document reading the head of this object.

<!--renderComp=Image-->
```asset
objectId: w4laejhlzjh
```

## ImageGrid, one version

The same reference form works for any component that takes a code block: here `ImageGrid` with its YAML in the store.

<!--renderComp=ImageGrid-->
```asset
objectId: w4laem6vxbe
```

## StockTable, pinned to a version

This table object also has two versions; the document pins the first one, so moving the head changes nothing here. The frame says `version … (head)` only when the pinned version happens to be the head. The marker keeps its own props (`title`) as usual: a reference replaces the data block only.

<!--renderComp=StockTable,title=Warehouse B (start of month)-->
```asset
objectId: w4laenhx59b
versionId: w4laenhwzl4
```

The same object, reading the head (the second version, after the delivery):

<!--renderComp=StockTable,title=Warehouse B (now)-->
```asset
objectId: w4laenhx59b
```

## Changing the data

On the development server the asset panel is writable:

- **Edit head** makes the head text editable in the panel. **Save in place** rewrites the head version (the previous file is kept as `.bak` beside it); **Save as new version** creates a version whose predecessor is the head and makes it the head.
- **Set as head** on a selected version moves the head there.
- **Delete version** removes a version that is not the head; versions that came from it are relinked to its predecessors, so the history stays connected.
- **Delete object** marks the object deleted; its files stay, and **Restore object** undoes the mark.
- the object's name is edited in its field.

Every change is written to `example_doc/asset/{objectId}/`: the data files `{versionId}.{ext}` and the object file `object.yaml`, which is backed up to `object.yaml.bak` before each rewrite. A change made outside the page (an editor, a git checkout) is picked up as soon as it is saved. On a built site the objects are bundled into the page as they were at build time, and the panel shows them without the actions.

## In edit mode

In edit mode an asset-backed component block is edited as source: the block is the reference, and that is what the editor shows, labeled `Image (asset)`. Change the `versionId` there to pin or unpin the block, or replace the fence language and write the data inline to take the block out of the store. The data itself is changed through the asset panel, since it belongs to the object and not to this document.

## Errors

A reference that cannot be resolved shows its message in place of the component: an unknown object, an unknown version, or a block that is not a mapping with `objectId`.

<!--renderComp=Image-->
```asset
objectId: w4l00000000
```
