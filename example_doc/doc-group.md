# Document Group Model

## Overview

- A doc-group is a collaborative workspace that owns many docs.
- A doc can belong to at most one doc-group.
- Initial scope keeps structure simple: no nested group tree in frontend. Group list is flat.
- Group-level permissions decide who can edit docs inside the group.

## Group Data

- `groupId`: object-storage `objectId`.
- `name`: editable group name.
- `docIds`: ordered list of doc ids in this group.
- `createdAt`, `updatedAt`.

## Group Operations

- Create group
  - create group object
  - append `groupId` into global group index
- Rename group
  - update group name
- Delete group
  - remove all owned docs and related resources
  - remove `groupId` from global group index
- Reorder docs in group
  - update `docIds` order only

## Group Meta Object

- One global index object keeps all group ids.
- Space metadata key: `reactDocGroupMetaObjectId`.
- Data field in that object: `docGroupIdList`.
