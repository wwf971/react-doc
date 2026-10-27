# Data Visualization: Design

This document defines a shared data format for diagrams made of nodes and connections. `DiagramER` renders this format. Asset-backed Dataverse cards support the first visual editing slice: cells, table/row settings, and row handles. Other visual diagram operations remain planned; the source editor remains available.

For the surrounding system, see [component registration](../../doc_page_impl_mdx_comp.md), [document editing](../../doc_page_impl_edit.md#component-edit-mode), and [asset storage](../../doc_page_impl_asset.md). A standalone [Dataverse entity card](../diagram-db-tabe/comp_db_table.md) can share a node's content renderer without using a canvas.

## Core Model

```text
diagram
	nodes          what appears on the canvas, and where
		renderer     which component draws this node
		data         the content that component understands
		handles      named connection points on the node or its parts
	connections    lines between two named handles
	defaults       shared layout and line settings
  viewport       canvas size, view, pan range, zoom limits, and minimap

example:  [source table: email] --> [normalize text] --> [target table: email]
```

A **node** is a visual object, not necessarily a table. Its renderer owns its content; the diagram owns movement, resizing, handles, and connections. A **handle** is a connection point with a stable identity. An **anchor** is the part of the rendered node that a handle follows, such as a table row. A **connection** names handles, not screen coordinates.

The authored YAML is the source of truth. During editing, a draft of that same model is the source of truth. React Flow nodes, edges, DOM measurements, selection, and hover state are derived runtime data; they are not another saved copy of the model.

## Example

This diagram connects a source column to an operator and then to a target column. `dataverse-table` is an internal renderer; `migration/NormalizeText` names a component in the unified registry.

```yaml
version: 1
defaults:
  layout:
    type: grid
    columns: 2
    gap: { x: 110, y: 60 }
  connection:
    renderer: { type: smoothstep }
    style: { stroke: "#64748b", strokeWidth: 1.5 }
    markerEnd: arrowClosed
viewport:
  size: { width: auto, height: 620 }
  view: { x: 0, y: 0, zoom: 0.8 }
  range: auto
  zoom: { min: 0.15, max: 2.5 }
  isMiniMapVisible: false
nodes:
  - id: source
    renderer: { type: dataverse-table }
    position: { x: 40, y: 60 }
    size: { width: 410, height: auto }
    data:
      name: Source customer
      columns:
        - { id: email, name: Email, type: Text }
    handles:
      - id: email-out
        direction: out
        anchor: { target: "column/email", side: right }
  - id: normalize
    renderer: { component: migration/NormalizeText }
    position: { x: 560, y: 80 }
    size: { width: 220, height: auto }
    data:
      label: Normalize email
      operation: trimLowercase
    handles:
      - id: input
        direction: in
        anchor: { target: body, side: left }
      - id: output
        direction: out
        anchor: { target: body, side: right }
  - id: target
    renderer: { type: dataverse-table }
    position: { x: 900, y: 60 }
    size: { width: 410, height: auto }
    data:
      name: Target customer
      columns:
        - { id: email, name: Email, type: Text }
    handles:
      - id: email-in
        direction: in
        anchor: { target: "column/email", side: left }
connections:
  - id: source-normalize
    source: { nodeId: source, handleId: email-out }
    target: { nodeId: normalize, handleId: input }
  - id: normalize-target
    source: { nodeId: normalize, handleId: output }
    target: { nodeId: target, handleId: email-in }
    renderer: { type: bezier }
    label: { text: Normalized email, position: 0.5 }
    style: { stroke: "#15803d", strokeWidth: 2 }
```

An operator describes a step in the diagram. Rendering or editing it does not execute an ETL job or modify a database.

## Nodes and Renderers

| Node field | Meaning |
| --- | --- |
| `id` | Stable ID, unique among nodes in this diagram. |
| `renderer` | Exactly one of `{ type }` for an internal renderer or `{ component }` for a registry component. Required; there is no implicit table type. |
| `data` | Renderer-specific content, such as columns, choice options, or operator settings. Defaults to an empty mapping. |
| `position` | `{ x, y }` in diagram coordinates, or `auto`. Omission means `auto`. |
| `isPositionLocked` | Optional boolean. A locked node requires an explicit position and cannot be dragged until unlocked. |
| `size` | Optional `width` and `height`, each a positive number or `auto`. Omitted dimensions mean `auto`. |
| `handles` | Explicit handle declarations. Omission means no handles, not inferred relationships. |

IDs do not have to describe the content: short opaque IDs are valid. Renaming a label or a database logical name must not change an ID. Column and option IDs are likewise stable within their node.

### Internal and Registered Renderers

Internal renderers `dataverse-table`, `dataverse-choice`, and `operator` live in a visualization-owned catalog. They need not appear in the unified component registry. `dataverse-choice` uses a purple header and dashed border while remaining a peer of `dataverse-table`, rather than a special case of the graph's basic node type. Styling belongs to that renderer, not to a column's `type: Choice` text.

`renderer.component` resolves through the existing component-name/ID rules and renders through `RegisteredComp`, using a new placement named `visualizationNode`. The registered definition must explicitly allow that placement. An unknown internal type, missing component, or incompatible placement produces an error naming the node; it must not silently become a table or load code from an arbitrary path.

Both catalogs provide the same node contract. The unified registry already preserves non-standard exposure metadata, so the visualization reads `expose.visualizationNode` from the resolved definition without inventing a second public registration system.

```javascript
compDefine(NormalizeText, {
	placementList: ['visualizationNode'],
	expose: {
		visualizationNode: {
			anchorListGet: (data) => [
				{ id: 'body', label: 'Operator', sideList: ['left', 'right'] },
			],
			sizeDefault: { width: 220, height: 100 },
		},
	},
})
```

`anchorListGet(data)` is a pure function that lists valid anchors before rendering. A Dataverse card exposes `body` on all four sides and `column/<columnId>` anchors on the left and right; another component may expose `input/<fieldId>` or only `body`. The diagram validates the returned IDs and sides. Optional `dataNormalize(data)` validates and normalizes renderer-specific content. The internal catalog exposes the same metadata. `sizeDefault` supplies a preferred automatic width and an initial height estimate; `sizeMin` can restrict authored numeric dimensions.

The renderer receives the normal `{ data, config, onEvent }` interface, with node context in `config.visualization`: `nodeId`, resolved `size`, `isEdit`, and `anchorRef(anchorId)`. It attaches that ref to the DOM element for each declared anchor. The diagram wrapper supplies the `body` anchor and draws the handles over the measured anchors. Node renderers do not create independent React Flow handles or save diagram files themselves.

Nested components inherit the document's source/asset services. Their source and asset dependencies must also be delegated to the existing dependency collectors, so a custom node's image or linked file is retained in a deployment build.

## Handles and Anchors

```yaml
id: customer-out
direction: out
anchor:
  target: column/customer
  side: right
  offset: 0.5
```

| Handle field | Meaning |
| --- | --- |
| `id` | Stable ID, unique within its node. It does not encode side or row order. |
| `direction` | `in`, `out`, or `both`. Required. |
| `anchor.target` | Anchor ID exposed by the renderer. Defaults to `body`. |
| `anchor.side` | `left`, `right`, `top`, or `bottom`, restricted by the anchor's `sideList`. Required. |
| `anchor.offset` | Position along that side, from 0 to 1; default 0.5. Left/right run top to bottom; top/bottom run left to right. |

A row handle stays attached to that row when its order, text, or height changes. Persist its anchor and offset, not its measured page coordinates. A renderer must attach every declared non-body anchor; a missing anchor is an actionable error, not a connection to the node's origin.

```text
select a table row
	-> show the row's supported sides
	-> add a handle with a new ID
	-> drag from that handle to a compatible handle
	-> create a connection referencing both IDs

move an existing handle from right to left
	-> change anchor.side
	-> keep the handle ID and all connections
```

An anchor may hold multiple handles. The planned visual editor flags exact overlapping handles for the author to move using offsets; the renderer must not silently change their saved positions. New-node templates may suggest handles, but these suggestions become explicit declarations once accepted. Re-rendering must not regenerate them or undo the user's edits.

The React Flow adapter derives runtime source/target handles from `direction`. A `both` handle uses separate runtime source and target IDs mapped back to the same authored ID. Side and position are not part of those IDs. After row reordering, resizing, or an anchor change, the adapter remeasures anchors and calls React Flow's `updateNodeInternals`.

Connection creation and reconnection use the same validation: the source allows `out`, the target allows `in`, and both handles exist. `both` allows either role. The core does not impose database type matching, acyclicity, or cardinality; a diagram-specific validator may add those rules. Deleting a connected handle, row, or node requires either reassignment or confirmation to delete the affected connections in the same edit. No dangling references are silently discarded.

## Position and Size

### Explicit or Automatic

Both authored examples preserve explicit node positions: the FB diagram's `visit` is at `{ x: 560, y: 40 }`; the property sample's customer is at `{ x: 40, y: 60 }`.

The compatibility adapter in [DiagramERData.js](DiagramERData.js) preserves this legacy fallback, which is application code rather than a React Flow layout engine:

```text
for table at zero-based index i:
	x = (i % 2) * 520
	y = floor(i / 2) * 440
```

React Flow draws nodes at the supplied coordinates. `fitView` changes the camera to show them; it does not arrange the nodes.

The new schema uses one rule: missing `position` or `position: auto` requests layout; `{ x, y }` preserves exact finite coordinates, including negative coordinates. A partial mapping such as `{ x: 40 }`, or any other string, is an error. Positions name the node's top-left corner in diagram coordinates, independent of browser scrolling and viewport zoom.

### Default Layout

`defaults.layout` selects the diagram's automatic layout policy. Its default is `grid`, with two columns and gaps of 110 horizontally and 60 vertically. These defaults live in the visualization, not in the underlying canvas library.

```text
resolve renderer and node size
	-> measure content whose size is auto
	-> reserve every explicitly positioned node's rectangle
	-> place auto nodes in declaration order
			 scan grid cells left to right, then down
			 skip cells that overlap reserved or already placed rectangles
	-> measure anchors and draw connections
```

The grid begins at `{ x: 0, y: 0 }`. Cell width and height are the maximum resolved automatic-node width and height, plus the configured gaps. Renderer size estimates allow the first render; content measurements complete the layout. Repeat layout only when automatic geometry changes, not on every React render or camera movement. Explicit nodes never move implicitly, even if they overlap.

Reader dragging changes temporary positions only. Later measurements preserve those positions, and reloading the source restores the authored layout. In the planned visual edit mode, dragging writes a numeric `position` into the draft. **Arrange automatic nodes** leaves explicit nodes alone; **Arrange all nodes** explicitly replaces every position. A later `layered` policy can use an established layout engine such as ELK for ETL graphs while honoring the same fixed-node contract.

### Dimensions and Viewport

Numeric dimensions are outer node sizes in diagram units. `auto` width uses the renderer's preferred width; `auto` height follows its content. Runtime measurements are not automatically serialized. The node wrapper enforces numeric dimensions; overflowing content scrolls within it, and handles follow their anchor elements when scrolled. Handles outside the visible node are hidden until their anchors return into view. A renderer can declare minimum dimensions through `sizeMin`; incompatible authored sizes produce a validation error rather than silent coercion. Resizing and resize-axis controls belong to the planned edit mode.

`viewport` groups all canvas settings. It is separate from node geometry:

| Field | Meaning and default |
| --- | --- |
| `size.width` | Positive CSS pixels or `auto` (default), filling the document width. Numeric widths are capped by available document width. |
| `size.height` | Positive CSS pixels, default 620. `auto` uses the same 620-pixel canvas fallback; canvas content does not determine document height. |
| `view` | `auto` (default), or `{ x, y, zoom }`. Translation is in canvas-local pixels, not diagram coordinates. |
| `range` | `auto` (default, unrestricted), or `{ x: [min, max], y: [min, max] }` camera-translation bounds. Pan/zoom completion and initial fitting clamp to these bounds; these are not world-coordinate extents. |
| `zoom` | `{ min: 0.15, max: 2.5 }`, requiring `0 < min <= max`. Saved view values must satisfy the range and zoom limits. |
| `isMiniMapVisible` | Boolean, default false. Enables a pannable, zoomable overview at the bottom right. |

An automatic view fits the diagram after layout and measurement. An explicit view is restored without an automatic `fitView` overriding it. Ordinary reader panning and zooming do not rewrite the document. Inline and expanded canvases keep separate temporary cameras. In the planned edit mode, **Remember current view** copies the active canvas camera into the shared edit draft.

## Connections

Connections have their own IDs and refer to `{ nodeId, handleId }` at each end. A table-column connection and an operator connection use exactly the same grammar. Multiple connections may share a handle; each remains independently selectable and editable.

| Connection field | Meaning |
| --- | --- |
| `id`, `source`, `target` | Required identity and endpoints. Connection IDs are unique within the diagram. |
| `renderer` | Internal line renderer `{ type }` or registered `{ component }`. |
| `label` | `{ text, position }`, where position is a fraction along the path, default 0.5. Omission means no label. |
| `style` | Validated presentation fields: `stroke`, positive `strokeWidth`, and optional `strokeDasharray`. |
| `markerStart`, `markerEnd` | `none`, `arrow`, or `arrowClosed`. Defaults: no start marker and a closed end arrow. |
| `isAnimated` | Boolean, default false. |
| `route` | Optional renderer-specific routing data, such as manual waypoints. |
| `data` | Optional custom-renderer content, separate from the standard fields. |

Effective values come from built-in defaults, then `defaults.connection`, then the connection itself. Merge `style` and `label` by property. Replace `renderer` and `route` as whole values, so a custom component never inherits a competing internal `type`. An explicit empty label text hides an inherited label; `route: null` clears inherited routing. Identity and endpoints cannot be specified in defaults.

Internal renderer types are `straight`, `bezier`, `step`, `smoothstep`, and `polyline`. `smoothstep` is the default. The first four use React Flow path helpers and reroute from the current endpoints. `polyline` is the manual-route renderer:

```yaml
renderer: { type: polyline }
route:
  waypoints:
    - { x: 510, y: 180 }
    - { x: 510, y: 320 }
```

Waypoints are absolute diagram coordinates. Moving a node updates the line's endpoints but leaves those authored intermediate points in place. A route reset removes them. Automatic path segments are derived geometry, not editable points pretending to be saved waypoints. A renderer that does not accept waypoints rejects them; changing line type asks before discarding incompatible route data.

A custom edge uses the unified registry's `visualizationEdge` placement and `expose.visualizationEdge` metadata. Optional `routeValidate(route)` throws for unsupported routing data; without it, non-null route data is rejected. `data` is passed as component content. `config.visualization` supplies `connectionId`, the resolved `connection`, `source` and `target` with `{ x, y, side }`, resolved `markerStart`/`markerEnd`, `isEdit: false`, and React Flow's `BaseEdge`. The renderer returns SVG content inside the edge group and can use `BaseEdge` for a wide interaction path. It cannot bypass endpoint validation or write files itself. Selection, reconnection, and field-edit controls belong to the planned edit mode.

## Power Platform Resource Nodes

`DiagramPowerAutomate` and `DiagramBusinessRule` use the same renderer and
version-1 graph as `DiagramER`, with different insertion starters. A diagram
may mix their nodes with Dataverse tables, choices, operators, and registered
renderers. These are design models, not executable workflow definitions.

| Renderer type | Node data |
| --- | --- |
| `power-automate` | `name`, `kind` (`trigger`, `action`, `condition`, `scope`, `loop`, `terminate`), `connector`, `operation`, `expression`, `description`, `properties` |
| `business-rule` | `name`, `kind` (`condition`, `action`), `table`, `scope` (`Entity`, `All Forms`, `Specific Form`), `action`, `expression`, `description`, `properties` |

Business-rule actions are `setValue`, `setRequired`, `setVisibility`,
`setEnabled`, `showError`, or `recommendation`; the empty action is accepted
for a condition. Property rows are `{ id, name, value, description? }`, all
text. Quote numeric/boolean-looking values. Unknown authored data is retained;
invalid enum values and duplicate property IDs are rejected. Anchors are
`header`, `body`, and `property/<id>`; handles and connections use the existing
direction, side, endpoint, and label rules. No runtime execution order is
inferred from card placement: label branches and run-after conditions explicitly.

Files for each resource share a prefix: `PowerAutomateNode*` and
`BusinessRuleNode*` contain its renderer, fields/validation, and starter source.
`ResourceNodeCard` shares the table-card visual language and text/menu controls.
The YAML draft remains in `DataverseEditStore`, including node/property
addition/removal and connection endpoint/label changes. Connected nodes and
properties cannot be removed until their connections are removed or reassigned.
Use Source mode for custom handles, line styles, and other graph fields not
exposed in the visual controls. See [Power Platform diagrams](../../../../example_doc/mdx-usage/comp-powerplatform.md)
for complete examples and design-specific caveats.

## Card Editing

`visual` edits inline YAML and, with `meta.isEditAssetAccepted: true`, writable, unlocked asset data at its head version. The flag opts the component's own modes into asset editing; it does not restrict inline editing or display. Older or locked asset versions cannot be visually edited. Both diagram and fixed-card views share the editor, alongside source editing. The former `isEditAssetOnly` flag is no longer used.

| State | Responsibility |
| --- | --- |
| YAML draft | Preserves authored data and comments, without serializing React Flow objects. |
| `focus: { nodeId, rowId }` | Semantic selection independent of a mode or DOM instance; a null row selects the table. |
| Active cell | Field identity and original value; Enter/blur ends cell entry, Escape restores that cell. |
| `isDirty` | Compares draft with initial content and accounts for save-target conversion. |
| `saveTarget` | `asset` uses the object's save policy; `inline` replaces the document reference without updating the object. |
| Session status | The document editor owns editing/submitting/error states; failed saves retain the draft for retry. |

DOM anchors and nearby panel position belong to the view, not semantic focus. Fixed-set cells use the host's Menu, never HTML select. Accepted changes report `editDraftChange` to the in-memory session, not a storage API. Save and non-canceling exits persist the latest draft; Cancel discards it. Clean/reverted drafts do not write. Controls are disabled while submitting.

Escape first restores the active cell, then clears the row or table selection. It never saves or cancels the block session, even when nothing is selected. Use Save (or Ctrl/Command + Enter) to submit and Cancel to discard. For an asset-backed block, **Save to > Inline YAML** replaces the reference with the draft without writing the asset; the default **Asset object** target follows the object's save policy and leaves the document unchanged.

Row handles support none, left, right, or both. Moving a side preserves IDs and connections. Removing a connected handle is refused. Fixed cards retain handle configuration for reuse in diagrams without drawing connections. Dataverse cards expose `header`; choice references use its left edge at offset 0.5. Resource nodes and connections can be added through the floating toolbar; connection labels and endpoints are edited through its Connections menu. Drag-to-connect, node resizing, and creation of other renderer types remain source-editing operations.

The table settings panel's **Use current position** captures the current canvas coordinates in `position`. While selected, dragging updates those coordinates in the draft. Clearing it returns the node to `auto`; temporary movement is not saved. The adjacent lock captures the position and sets `isPositionLocked`, preventing dragging in both edit and read views. Unlocking retains the remembered coordinates and permits dragging again. These changes follow the same Save/Cancel behavior as cell edits.

The camera is transient state scoped to the document block. Save preserves zoom and pan across the edit-to-read remount without rewriting `viewport.view`; an explicitly changed viewport configuration still takes precedence. Type menus show common choices with a searchable, height-limited result list, using the shared contenteditable control rather than native inputs.

## Further Visual Editing (Planned)

One `visual` edit mode will support WYSIWYG-style editing beside the document system's existing `source` mode. It will reuse the same node renderers as read mode. Inline controls edit labels or fields; floating controls edit node size, handle anchors, and connection appearance. Entering edit mode preserves the diagram box and camera, following the document editor's no-jitter rule. The following commands and save behavior describe that future mode, not current reader interactions.

```text
drag / resize / edit content / connect / reconnect
	-> a command validates and updates the authored draft
	-> regenerate only the affected runtime geometry
	-> serialize the draft as YAML
	-> report editDraftChange { raw }
	-> document editor handles save, cancel, conflicts, and errors
```

The diagram store owns commands such as `nodeMove`, `nodeResize`, `nodeDataChange`, `handleAdd`, `handleMove`, `connectionAdd`, `connectionReconnect`, and `connectionUpdate`. Nested node/edge events reach this store first, with their owning ID supplied by the wrapper; they do not start independent document edit sessions. Only the outer diagram reports the block's draft through `onEvent`.

Undo/redo records semantic commands. One continuous drag or resize is one undo step, although its latest draft is reported during the gesture. Any throttled draft update must flush before Save or leaving the session. Cancel restores content, handles, positions, and connections together. A failed save retains the draft. Read mode may allow temporary movement for exploration, but never persists it; entering edit mode starts from authored data, not uncommitted reading interactions.

Serialization preserves stable IDs, declaration order, and renderer-specific data. Use the YAML document API to update relevant fields while retaining comments where possible. Never serialize the normalized React Flow objects: they contain derived handles, measurements, functions, and transient interaction state. Invalid input remains available in the source editor with an error identifying the field; it must not be replaced by an empty diagram.

For a diagram stored as an asset, use the existing asset edit route and save mode. Do not add a second layout file with an independent save lifecycle: content and geometry belong to the same authored object and should save or cancel together.

## React Flow Boundary

```text
YAML / edit draft
	-> validate nodes, renderer capabilities, handles, and connections
	-> resolve automatic positions and dimensions
	-> generic node wrapper -> internal renderer or RegisteredComp
	-> measure declared anchors -> React Flow handles
	-> connection adapter -> built-in path or registered edge renderer

React Flow interactions
	-> map runtime IDs back to authored IDs
	-> validated diagram commands
```

React Flow supplies canvas interaction and path utilities. The diagram supplies the domain-neutral schema, automatic layout policy, validation, and serialization. Table rows and choice options belong to node renderers, not to the graph adapter. Reusable entity content can therefore appear both inside a node and in `DiagramDataverseEntity` without forcing a static card to support canvas interaction.

## Existing ER Data

The legacy grammar is identified by `tables` and `relationships` without the new `version`. New data declares `version: 1` and `nodes`/`connections`; mixed grammars or unknown versions fail explicitly. A compatibility adapter converts legacy content in memory:

| Legacy data | Generic model |
| --- | --- |
| Ordinary table | Node with `renderer: { type: dataverse-table }`; content under `data`. |
| Table with `kind: choice` | Node with `renderer: { type: dataverse-choice }`; preserve its existing labels, pseudo-columns, and purple visual convention. |
| `table.position` | Node-owned position; absent coordinates use the legacy two-column fallback to preserve the initial view. |
| Relationship endpoint | An explicit handle anchored to `column/<columnId>`, then an endpoint naming that handle. |
| Relationship label and appearance | Connection label and explicit legacy `smoothstep` defaults. |

The choice renderer's compatibility input accepts the existing pseudo-column structure; new choice-specific content can expose different anchors through the same contract. Migration does not invent or fetch database option values.

Materialize the legacy left/right heuristic once during conversion, then use stable handle IDs that do not encode the side. Preserve shared handles for identical node/column/role/side endpoints. Retain the resolved legacy positions so moving one node later does not trigger a new migration layout. The component marker and title remain outside graph data. Move a legacy block's `height` into `viewport.size.height`; legacy blocks may still supply that property as a fallback.

Reading a document never rewrites it. Keep the existing component tag as a compatible entry point; a more general visualization tag may use the same engine without imposing an ER-specific schema.

## Fixed Dataverse View

`DiagramDataverseEntity` renders one `dataverse-table` node without React Flow, handles, dragging, panning, or zooming:

```yaml
version: 1
node:
  id: customer
  renderer: { type: dataverse-table }
  size: { width: 410, height: auto }
  data:
    name: Customer
    nameLogical: customer
    columns:
      - { id: email, name: Email, nameLogical: email, type: Text }
```

Both views use the same field normalization, card markup, styles, required markers, descriptions, and stable column IDs. The fixed view has no separate table model or rendering implementation. Its outer wrapper only constrains size and scrolling. Existing `entity: ...` inputs remain readable through the compatibility adapter.

## Design Checks

- A source table, custom registry operator, and target table connect through the same handle model.
- Moving a row handle between left and right preserves every attached connection and its ID.
- Reordering rows or changing their height keeps handles attached to the intended row.
- Automatic nodes avoid explicit nodes; reopening preserves saved numeric coordinates and dimensions.
- A saved camera is restored without a fit operation replacing it.
- Connection defaults and per-line overrides survive save/reload, including custom rendering and manual routes.
- Save, Cancel, undo/redo, and failed writes keep graph content and geometry consistent.
- Legacy FB and property diagrams retain their tables, choice cards, connections, and initial positions through conversion.
