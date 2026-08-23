# Text Component Design (Bottom-Up)

## Scope

- This doc defines the first text component family for `react-doc`.
- The design starts from the smallest unit (`TextSegmentBasic`) and builds up to `TextBasic`.
- It follows the data-driven pattern from `react-comp-misc`:
  - render component is loyal to `data` and `config`
  - all edit attempts go upward through one `onEvent` callback
  - store layer decides accept or reject

## Id Rule

- Every id in this component family uses lower-case random alpha-numeric:
  - allowed chars: `0-9`, `a-z`
  - example regex: `^[0-9a-z]{10}$`
- Entities:
  - `compId`
  - `segmentId`
  - `caretId` (optional, for remote caret markers)

## Level 1: `TextSegmentBasic`

`TextSegmentBasic` is the minimal render/edit unit.

### Data

```ts
type TextSegmentStyle = {
  colorText?: string;
  colorBackground?: string;
  familyFont?: string;
  sizeFontPx?: number;
  styleFontItalic?: boolean;
  weightFontBold?: boolean;
  decorationUnderline?: boolean;
  decorationStrike?: boolean;
};

type TextSegmentBasic = {
  segmentId: string;
  text: string;
  style: TextSegmentStyle;
};
```

Notes:

- Empty segment is not persisted in normal flow.
- `text` can include `\n`; line breaks are plain text characters, not special nodes.
- Style is complete per segment, so render does not need style inheritance logic in first milestone.

## Level 2: `TextBasic`

`TextBasic` is a linear list of segments plus operation state.

### Data

```ts
type CaretRange = {
  offsetStart: number;
  offsetEnd: number;
  direction: 'forward' | 'backward' | 'none';
};

type TextBasicData = {
  compId: string;
  compType: 'TextBasic';
  segList: TextSegmentBasic[];
  textPlain: string;
  caretSelf: CaretRange;
  caretRemoteByClientId: Record<string, CaretRange>;
  versionLocal: number;
  updatedAt: number;
};
```

### Config

```ts
type TextBasicConfig = {
  isEditable: boolean;
  isLocked: boolean;
  lockOwnerClientId: string;
  lockOwnerUserId: string;
  lockExpireAt?: number;
  isFocused: boolean;
};
```

### Render Contract

- Render side receives only:
  - `data: TextBasicData`
  - `config: TextBasicConfig`
  - `onEvent: (eventType, eventData) => Promise<any> | any`
- Render side does not decide whether a change is committed.
- Render side can do temporary local interaction, but durable state update is always store-driven.

## Segment Operation Model

All edits are represented as operations on `segList`.

### Core operations

- `segmentSplit`
  - split one segment at one text offset
  - creates right segment with copied style and new `segmentId`
- `segmentMergeNext`
  - merge current segment and next segment when style is equal
- `segmentInsertText`
  - insert text into one segment
- `segmentDeleteRange`
  - delete range that may cross multiple segments
- `segmentStylePatch`
  - update style fields on selected range
- `segmentNormalize`
  - post-step cleanup: remove empty segments and merge adjacent same-style segments

### Merge rule

Two neighbor segments are mergeable only when:

- all style fields are equal
- both are in same `TextBasic`
- no explicit hard boundary marker exists (none in current milestone)

## Selection and Caret Mapping

- `offsetStart/offsetEnd` are absolute offsets in `textPlain`.
- Store maps absolute offsets to `segmentId + innerOffset` before applying operations.
- After operations:
  - recompute `textPlain` from `segList`
  - clamp caret into valid range
  - run `segmentNormalize`

## Suggested Events (`onEvent`)

Unified callback with event names:

- `textReplaceRange`
  - `{ compId, range: CaretRange, textInsert }`
- `stylePatchRange`
  - `{ compId, range: CaretRange, stylePatch }`
- `caretSet`
  - `{ compId, caretSelf }`
- `lockRequest`
  - `{ compId }`
- `lockRelease`
  - `{ compId }`

Store returns result object (accept/reject and optional message).

## Collaboration and Lock

- Lock owner can send mutating events (`textReplaceRange`, `stylePatchRange`).
- Non-owner users:
  - can send `caretSet` for their own remote marker only if policy allows
  - cannot mutate text while lock is active
  - still receive full text/segment updates from websocket
- Therefore, viewers see live typing and style changes from lock owner.

## Store Boundary (Important)

- `TextBasic` render component:
  - no websocket
  - no HTTP
  - no lock arbitration
- `DocStore` and `DocPersistStore`:
  - validate event
  - apply segment operations
  - synchronize to server and other clients

## Naming Convention

- Prefer entity-first names for non-boolean fields:
  - `segList`, `caretRemoteByClientId`, `lockOwnerUserId`
- Booleans keep `isXxx` form:
  - `isLocked`, `isEditable`, `isFocused`
