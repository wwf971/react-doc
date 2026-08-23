# DocumentBasic Model

## Overview

- Current product supports only one doc subtype: `DocumentBasic`.
- `DocumentBasic` is a linear list of components.
- Current component set has one type: `TextBasic`.
- Order in document is explicit and stable by `compIds`.

## Frontend Hierarchy

```
store
  -> DocumentShell (provider + toolbar)
  -> DocumentBody (component list)
  -> TextBasic (single editable text component)
```

Hierarchy of persisted entities:

```
doc-group -> doc -> comp -> resource
```

## DocumentBasic Data

- `docId`: object-storage `objectId`.
- `docType`: fixed string `DocumentBasic`.
- `name`: doc title.
- `metadata`:
  - `compIds`: ordered component id list.
  - `revisionHint`: optional server revision marker for diagnostics.
- `compDataById`: map `compId -> component data`.

## TextBasic Data

- `compId`: object-storage `objectId`.
- `compType`: fixed string `TextBasic`.
- `text`: current string.
- `caret`:
  - `start`: integer
  - `end`: integer
  - `direction`: `forward | backward | none`
- `lock`:
  - `isLocked`: boolean
  - `ownerClientId`: current occupier client id
  - `ownerUserId`: current occupier user id
  - `expiresAt`: optional lock expiry timestamp
- `updatedAt`: last update time.

## Collaboration Rules

- Only lock owner can send edit requests for a `TextBasic`.
- Non-owner users still receive all text and caret updates through websocket.
- UI for non-owner is read-only and always shows latest remote text.
- Caret of the occupier is visible to other users for live follow mode.

## Resource Rules

- Resource is optional for `TextBasic` now.
- Keep resource entity in model because future text components may reference attachments.
