# Object Storage Based Data Model

All durable data for `react-doc` is stored in `storage-obj`.

## Core Rules

- No app-local durable ids.
- Every durable id is object-storage `objectId`.
- Server API resolves one target space and scopes all reads and writes to that space.
- Updates are versioned through object-storage update APIs.

## Object Types

Objects are stored by `(dataType, type)`.

- Document
  - `dataType=json`, `type=21`
  - data fields: `docType`, `name`, `metadata`, `compDataById`

- Component (reserved for split storage mode)
  - `dataType=json`, `type=22`
  - not used in first milestone, but reserved for future large-doc optimization

- Resource Meta
  - `dataType=json`, `type=23`
  - fields: `kind` (`bytes` or `text`), `contentObjectId`, timestamps

- Resource Content Text
  - `dataType=text`, `type=24`

- Resource Content Bytes
  - `dataType=bytes`, `type=25`

- Doc Group
  - `dataType=json`, `type=26`
  - fields: `groupId`, `name`, `docIds`, timestamps

- Doc Group Meta
  - `dataType=json`, `type=27`
  - field: `docGroupIdList`

- Document Lock State (optional dedicated object)
  - `dataType=json`, `type=28`
  - map of `compId -> lock info`, for lock recovery and diagnostics

## Delete Strategy

- Deleting a doc removes doc object.
- Server also removes unreferenced resources for that doc.
- Deleting a group removes owned docs, then removes the group.
