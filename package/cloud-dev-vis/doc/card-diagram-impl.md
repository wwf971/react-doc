# Card Diagram: Design and Implementation

The base series of the package ([README](README.md)), in `comp-mdx/card-diagram/`. It defines a shared data format for diagrams made of nodes and connections, the canvas that draws it (React Flow), the generic cards, the visual editor of the format with the history of its draft, and the **node registry**: the list of node kinds a diagram component can draw and create, through which every other series plugs its own cards into the same engine. `CardDiagram` is the diagram of this series; the Power Platform series makes `DiagramER` and its siblings from the same engine with another registry ([Power Platform](power-platform.md)). This document is the introduction to the design and the implementation; the standards and checklists for building on the engine (a kind, a series, a command of the editor) are in [card-diagram.md](card-diagram.md) beside it.

The editor (`DiagramVisualEdit`, [Card Editing](#card-editing)) edits cells, rows, columns, handles, connections and positions in place, with an edit card beside the selection, and every change can be undone and redone within the session ([History](#history)); the source editor remains available. What every block-like component of the page must do, which the diagrams follow, is in [Block-like MDX components](../../../main/doc_page_impl_mdx_comp_block.md). For the surrounding system, see [component registration](../../../main/doc_page_impl_mdx_comp.md), [document editing](../../../main/doc_page_impl_edit.md#component-edit-mode), and [asset storage](../../../main/doc_page_impl_asset.md).

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

A **node** is a visual object, not necessarily a table. Its kind (from the node registry of the component) or a registered component owns its content; the diagram owns movement, resizing, handles, and connections. A **handle** is a connection point with a stable identity. An **anchor** is the part of the rendered node that a handle follows, such as a table row. A **connection** names handles, not screen coordinates.

The authored YAML is the source of truth. During editing, a draft of that same model is the source of truth. React Flow nodes, edges, DOM measurements, selection, and hover state are derived runtime data; they are not another saved copy of the model.

## Node Registries

Which node types a diagram understands is not global: it is the **node registry** of its component type, fixed in code (`node-registry.js`). A registry is a list of **node kinds**; a kind is everything the engine needs to know about one `renderer.type`:

```text
node kind
  type        the renderer type authored in renderer: { type }
  contract    normalize its data, list its anchors, default size     (the diagram trusts these)
  schema      rows, fields and properties of the card                (the editor works from these)
  Card        the component drawing it
  create      label, icon, keywords, a starting node                 (an entry of the create panel)

registry = nodeRegistryBuild({ id, kindList, cardLegacyConvert? })
  -> kindByType, createEntryList (the kinds with a create entry, then a connection)
```

```text
CardDiagram            registry card-diagram      table, operator
DiagramER              registry power-platform    table, operator, dataverse-table, dataverse-choice,
DiagramPowerAutomate     (one registry for the      power-automate, business-rule
DiagramBusinessRule       three: one diagram may mix them)
                        plus operator-abandon, operator-text, operator-mapping
DiagramDataverseEntity registry dataverse-entity  dataverse-table   (a standalone card)
```

The design rules:

- **One registry per component type.** A series builds its registry from its own kinds and, usually, the generic kinds of this series (`cardDiagramNodeKindList`), and binds it to its components with `cardDiagramCompCreate(registry, name)` (a canvas) or `cardStandaloneCompCreate(registry, name, title)` (one card). A diagram therefore never offers the cards of an unrelated series: an AWS diagram does not create Power Platform cards. Importing kinds from another registry by configuration is left for later; today a combination is a registry written in code.
- **The registry decides reading as well as creating.** A node whose type its registry does not know is an error naming the types it does know, never a guess: a `dataverse-table` node in a `CardDiagram` does not render as a Dataverse card.
- **The engine knows no series.** The canvas, the stores, the edit card and the path read every kind-specific fact (contract, schema, card, create entry) from the registry they are given (`DiagramERStore`, `DiagramEditStore` and the render context hold it). Adding a series adds a folder; it does not change this one.
- **Registered components stay open to every diagram.** A node drawn by a component of the page (`renderer: { component }`, placement `visualizationNode`) is not a kind: it is resolved through the component registry, in any diagram ([Internal and Registered Renderers](#internal-and-registered-renderers)).

A new card-like kind is usually a schema over one of the generic cards of this series, plus the small variant drawing it, as the Dataverse and resource cards are ([The Table Card](#the-table-card)).

## Example

This diagram connects a source column to an operator and then to a target column. `dataverse-table` is a kind of the Power Platform registry (the diagram is a `DiagramER`); `migration/NormalizeText` names a component in the unified registry.

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

Internal renderers are the kinds of the node registry of the component ([Node Registries](#node-registries)): `table` and `operator` here, `dataverse-table`, `dataverse-choice`, `power-automate` and `business-rule` in the Power Platform series. They need not appear in the unified component registry. Styling belongs to the kind's card, not to a value of the data (a Dataverse choice draws its own header, not a column's `type: Choice` text).

`renderer.component` resolves through the existing component-name/ID rules and renders through `RegisteredComp`, using a new placement named `visualizationNode`. The registered definition must explicitly allow that placement. An unknown internal type, missing component, or incompatible placement produces an error naming the node; it must not silently become a table or load code from an arbitrary path.

A kind and a registered component provide the same node contract. The unified registry already preserves non-standard exposure metadata, so the visualization reads `expose.visualizationNode` from the resolved definition without inventing a second public registration system.

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

`anchorListGet(data)` is a pure function that lists valid anchors before rendering. A Dataverse card exposes `body` on all four sides and `column/<columnId>` anchors on the left and right; another component may expose `input/<fieldId>` or only `body`. The diagram validates the returned IDs and sides. Optional `dataNormalize(data)` validates and normalizes renderer-specific content. A kind's `contract` has the same fields. `sizeDefault` supplies a preferred automatic width and an initial height estimate; `sizeMin` can restrict authored numeric dimensions.

The renderer receives the normal `{ data, config, onEvent }` interface, with node context in `config.visualization`: `nodeId`, resolved `size`, `isEdit`, and `anchorRef(anchorId)`. It attaches that ref to the DOM element for each declared anchor. The diagram wrapper supplies the `body` anchor and draws the handles over the measured anchors. Node renderers do not create independent React Flow handles or save diagram files themselves.

**Any object as a node.** The page's `ObjectView` is such a registered renderer: a node `renderer: { component: ObjectView }` with `data: { object: '{reference}', context?: card }` is a card of any object of the [object registry](../../../main/doc_page_impl_obj.md#object-views) (a document, a section, a service instance, its config, a todo, a database), drawn by the view of the object's types, or the fallback view of every object. It exposes one `body` anchor on every side and a `sizeDefault`; the diagram knows no type and the engine nothing of objects, so a series adds no kind for them. The lines are the diagram's own data as for every node. In edit mode the create panel offers, below the kinds of the registry, the objects its text finds through the page's [object search](../../../main/doc_page_impl_obj_search.md#in-a-card-diagram) (`config.object.searchSessionGet`; the diagram's option `objectSearch: { typeList, isEnabled }` narrows it), and adds the one chosen with the generic command `nodeComponentAdd(compName, data, position, idPrefix)`: a node of a registered component, with an `in` and an `out` handle on its body, through `changeApply` like every change.

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
| `attachPolicy` | `multiple` (default) or `single`: how many connections the handle accepts. Validation rejects a second connection on a `single` handle, and the editor refuses to drop one there. |

A row handle stays attached to that row when its order, text, or height changes. Persist its anchor and offset, not its measured page coordinates. A renderer must attach every declared non-body anchor; a missing anchor is an actionable error, not a connection to the node's origin.

Which anchors a card offers is the decision of its kind, and the title line is **not** one of them by default: a generic `table` offers `row/<id>` and `header` only when its data sets `isHeaderHandleEnabled`; a resource card offers `header` and `property/<id>`; the Power Platform kinds are in [Power Platform](power-platform.md#anchors). A handle on `header` of a type that does not offer it is a validation error.

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

Connection creation and reconnection use the same validation: the source allows `out`, the target allows `in`, both handles exist, both ends are not the same handle, and a `single` handle has room. `both` allows either role. The core does not impose database type matching, acyclicity, or cardinality; a diagram-specific validator may add those rules. Deleting a connected handle, row, or node never leaves a reference to something gone and never discards a connection silently: the connections are moved to the handle on the other side of the same anchor when one exists, and otherwise **detached**, each end becoming a free end ([Connections](#connections)) placed a little away from where the handle was.

## Position and Size

### Explicit or Automatic

Both authored examples preserve explicit node positions: the FB diagram's `visit` is at `{ x: 560, y: 40 }`; the property sample's customer is at `{ x: 40, y: 60 }`.

The compatibility adapter in [DiagramERData.js](../comp-mdx/card-diagram/DiagramERData.js) preserves this legacy fallback, which is application code rather than a React Flow layout engine:

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
| `id`, `source`, `target` | Required identity and endpoints. Connection IDs are unique within the diagram. An endpoint is a handle `{ nodeId, handleId }` or a **free end** `{ position: { x, y } }` in diagram coordinates; either end may be free, and a free end is drawn as a small ring exactly where it was left. |
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

## The Table Card

`TableCard` (`TableCard.jsx`) is the one card renderer: a title line (name and a subtitle), an optional description, head fields, a header of the card's **fields** and its **rows**, one cell per field, without any limit on their number. What a node type shows in it is the **schema** of its kind (`TableCardSchema.js`, `cardSchemaGet(node, registry)`): where the rows live (`columns`, `properties`, `rows`), the anchor prefix of a row, the fields (fixed for the Dataverse and resource cards, authored in `data.fields` for the generic `table`), the properties of the Table and Row tabs, how a new row starts, and whether rows and the title line take handles. This series has two generic cards on it: the `table` kind itself (fields authored in `data.fields`), and the **resource card** (`ResourceNodeCard.jsx`, `resourceCardSchemaBuild`): head fields under the title and property rows of name and value, with an accent color, which a series uses for the resources of its platform (a flow step, a business rule, a cloud service). The Dataverse card of the Power Platform series is the table card with a fixed schema and small render hooks (a badge, a key cell, a required star, a tooltip); a new card-like kind is a schema and, at most, a variant like these.

The read and edit layouts of a card are one grid: without an editor a cell is text, with one it is a control in the same box, so a cell starting or ending editing moves nothing. Every row and the description are `nodrag nopan`, so a drag in them selects text and a drag on the title line pans the canvas (reading) or moves the node (editing); no part of a card is `nowheel`, so the wheel over a card zooms the canvas like the wheel over empty canvas and never scrolls the page.

## Card Editing

`visual` edits inline YAML and, with `meta.isEditAssetAccepted: true`, writable, unlocked asset data at its head version. Every diagram and standalone card shares the editor (`DiagramVisualEdit.jsx`) and its store (`DiagramEditStore.js`), alongside source editing. The editor renders the same view as reading and hands it an `editor` object; the store holds the draft and the selection; the canvas interactions are translated into store commands by the editor.

| State | Responsibility |
| --- | --- |
| YAML draft | Preserves authored data and comments, without serializing React Flow objects. Every command changes the YAML document through `changeApply`, which validates the result with `diagramNormalize`, keeps the previous draft with a message when it is invalid, and records the step in the history. |
| `history` | The states the draft went through in this session ([below](#history)): what undo puts back and redo repeats. Kept with the session in the browser, never saved. |
| `path` | Where the author is in the principal of the edit card ([below](#the-path-of-the-edit-card)): a card with one of its rows, fields, cells, properties or lines, or a line by itself; `[]` for nothing. The one state the edit card and the highlights of the canvas are drawn from; `selection` (`{ nodeId, rowId, fieldId, connectionId, propId }` or `{ connectionId }`) and `cardTab` are computed from it for the cards. Not a step of the history. |
| `cell` | The cell being typed, with the value it had, so Escape restores it. |
| `interaction` | A gesture in progress (`connect`, `detach`, `reconnect`, `nodeDrag`): the edit card is hidden while it lasts. |
| `create` | The create panel, at a canvas position. |
| `isDirty`, `saveTarget` | As before: the draft compared with the initial text; `asset` or `inline`. |

### The path of the edit card

The path (`DiagramEditPath.js`) is a list of segments: a root (`node(id)` or `connection(id)`), then a collection of the card (`rows`, `fields`, `lines`) or a property (`prop(id)`), then an item of the collection (`row`, `field`, `line`, named by `id`, `index` or `name`), and under a row a `field` for the cell. `pathResolve(path, store)` turns a path into its **display** (`principal`, `nodeId`, `connectionId`, `rowId`, `fieldId`, `propId`, `tab`, `view: detail | list`) and its canonical form, following redirects: an item that does not exist goes to its collection, a collection a card does not have goes to the card, a root that is gone goes to nothing, and the store's `redirectRuleList` (`(display, path, store) => path | null`, a hook for hosts) is applied after the built-in redirects, with a hop limit so a wrong rule ends at the root. A collection may be spelled with the card's own word for it (`columns` for the rows of a Dataverse table, the fields of a generic table), and `pathParse` / `pathFormat` give the text form (`node(id=customer) > rows > index=1`). `tabPathGet(display, tab)` is where a tab leads: the subject the display has for it, or its list; `selectionPathBuild` is the path of a click on the canvas.

The store keeps the path canonical: `pathSet` resolves what it is given, and every successful `changeApply` re-resolves (`pathNormalize`), so the display is always of things in the draft. Commands that create focus their result; commands that remove go to the list the thing was in. `cardTabSet`, `select`, `selectConnection`, `handleClick` (the rotation through the connections of a handle, ending on the card's `lines` list) and `pathUp` (Escape) are all `pathSet` in other words.

**The edit card** (`DiagramEditCard.jsx`) is a popup of the edit layer beside the **principal** of the path (the node on the canvas or the standalone card, the middle of a line), never beside the row or cell within it (`editor.anchorRectGet`). Its top edge is computed from the principal's rectangle alone and its height is capped by the room below, so the card grows and shrinks downward and never moves while the author works in it. Its content is data (`DiagramEditCardModel.js`: the tabs with the path each leads to, the segments of the path bar, and the view: the detail of one thing as sections of properties and actions, or the list of a collection as items) rendered by the host's `PropEditor` (`config.components.PropEditor`, with a plain form when the host injects none) under the card's own tabs and the host's `PathBar` (the shared `.doc-path` look): the card's tab (its properties, title handles, position, add row / column, remove node), the rows (the list with a drag handle and a remove button before each item; a row's values and properties, its handles and their attach policies, insert / move / remove), the fields (the list; a field's label; insert / move / remove for an authored field list, greyed out with the reason for fixed fields), the cell (the value), the lines (the list of the connections at the card's handles; a line's label, line type, color, thickness, dash, markers, animation, the two ends, remove). A disabled tab, action or button keeps its reason as its title.

**On the card** (`TableCard.jsx`) every part takes the focus (a head field and the description focus a `prop`, a field header a field, a row a row, a cell starts typing), and a focused row or field shows a `CardToolbar` (the shared `.doc-button-group`): a grip that drags the item among its siblings with the pointer (the drop place drawn on the card), insert before / after, move, remove; what the schema does not allow is disabled with `reasonFieldListFixed` as its title.

**Rows, columns, handles.** Rows are inserted at an index, moved and removed (`rowInsert`, `rowMove`, `rowRemove`); columns of a generic table likewise (`columnInsert`, `columnMove`, `columnRemove`, `columnLabelSet`), the values of a removed column dropped from every row. A handle is added or removed per side of an anchor (`handleSideSet`; the **+** at the row edges adds one), with the reroute-or-detach rule above; `handleAttachPolicySet` sets its policy.

**Connections.** A click on a handle rotates the selection through the connections attached to it and back to none (`handleClick`), keeping the card selected. A drag from a handle starts a new line (`connect` interaction) unless a connection at that handle is selected, or the handle takes one line and has it: then the drag detaches that end and carries it (`detach`), drawn by the custom connection line from the line's other end. React Flow's edge anchors move an end (`reconnect`); a free end is a hidden point node whose dot can also be dragged, snapping to the nearest handle within reach on drop. Every drop goes through one validation (`endpointAttachReasonGet`: direction, same handle, attach policy), and a drop that is refused or lands on nothing leaves the end free where it was dropped (`connectionEndpointSet`). A new line is oriented so that it leaves a handle that can send and enters one that can receive (`connectionOrient`). `connectionSet` changes the presentation fields; `connectionRemove` deletes.

**Creating.** A double-click on empty canvas (or the bar's **+**) opens the create panel (`DiagramCreatePanel.jsx`), a searched list of the create entries of the node registry of the component (`nodeRegistrySearch`): its kinds that have a create entry, and a connection with two free ends. The chosen node gets the panel's position and is selected.

**Removing a node** detaches its connections (free ends where its handles were) and deletes the node; nothing is refused for being connected.

Escape first restores the active cell, then closes the create panel, then drops the last segment of the path. It never saves or cancels the block session. Save (or Ctrl/Command + Enter) submits and Cancel discards. For an asset-backed block, **Save to > Inline YAML** replaces the reference with the draft without writing the asset; the default **Asset object** target follows the object's save policy and leaves the document unchanged.

The card tab's **Remember** captures the current canvas coordinates in `position`; while remembered, dragging updates those coordinates in the draft (read a frame after the drop, when the last position change has reached the canvas store). Clearing it returns the node to `auto`. **Locked** captures the position and sets `isPositionLocked`, preventing dragging in both edit and read views. The camera is transient state scoped to the document block, kept across the edit-to-read remount without rewriting `viewport.view`.

### History

The history (`DiagramEditHistory.js`, `EditHistory`) is part of the engine, so every diagram and standalone card of every series has undo and redo, for every command the engine has and every command a series adds, without the series doing anything for it. It is recorded at the one place every change of the draft passes, `changeApply`: the state of the draft before the change (the YAML document, which is never changed in place once it became the draft, so an older one can be the draft again; the value; the text) and the state after it. `undo()` puts the previous state back, `redo()` the next; a draft put back is exactly what it was, comments and layout of the initial text included.

```text
a command  ->  changeApply(change, { groupKey })
                 clone the document, apply, validate (a refusal changes nothing)
                 record { stateBefore, stateAfter, groupKey } in the history
                 re-resolve the path
undo / redo    ->  the state before / after put back, the cell dropped, the path re-resolved
```

- **A step is one command**, except typing: the keystrokes in one cell (`fieldSet`, every keystroke reaches the draft through the field's input event), in a text field of the edit card (a label, a column label), and the drags of a color picker or a width field pass a `groupKey` (`field:node/row/field`, `column:node/field`, `connection:id/field`) and stay one step until the group is closed: by the cell ending (`cellEnd`, `cellCancel`), by the path moving elsewhere (`pathSet`), by a step of another key, by an undo. A value picked from a menu or a checkbox, and every other command, is a step of its own. A change that changes nothing is not a step, and a grouped step that ends where it started (a cell typed and restored with Escape) is dropped, so an undo always undoes something.
- **The selection is not in the history.** The path, the cell being typed, a gesture, the create panel, the save target and the camera are the state of the editor, not of the draft: changing them is never a step, and an undo re-resolves the path against the restored draft (`pathNormalize`, with the redirects of the path) instead of restoring a path. Undoing an insertion whose row is focused goes to the list of rows; undoing a removal leaves the path where it is.
- **Not during a gesture.** While `interaction` is set (a line being drawn, an end being moved, a node being dragged) undo and redo refuse, since the end of the gesture would write into the restored draft.
- **In the browser, with the session.** The history starts empty when the session opens with the data as saved (a new `DiagramEditStore` per session, also when the block's data comes from an asset object), lives in the store while the session lasts (the popup moves the editor and keeps it), and is dropped with the store when a save or a cancel closes the session. Nothing of it is written with the data, inline or into the asset object; a failed save keeps the session and the history. `historyClear()` exists for a host that keeps a session open across a write of its own.
- **The canvas follows the draft.** `DiagramERStore.sourceLoad(text, isDraft)` keeps the place of every node across a draft reload, unless the draft now gives the node another authored position (remembered, cleared, locked, moved, or undone): then the node goes where the draft says, and the position a drag left in `positionsTemporary` is forgotten. An undone move therefore moves the node back on the canvas.
- **The keys and the bar.** The bar of the editor has **Undo** and **Redo** beside the dirty mark, greyed out when there is nothing to undo or redo; Ctrl/⌘ + Z undoes and Ctrl/⌘ + Shift + Z or Ctrl/⌘ + Y redoes, handled by the editor root first (`DiagramVisualEdit` `keyDown`, like Escape and Ctrl/⌘ + Enter) and stopped there, so no keyboard map of the page takes them. In a text being typed (a cell, a field of the edit card, the search of the create panel) the keys stay the browser's: the typing it takes back reaches the draft through the field's input event, inside the same step. A button of the bar returns the focus to the editor root after acting, so the next key reaches the editor (the bar is portaled).

What this history is not: the document-level undo of the page's edit layer (a write to the file taken back), which is listed in the project's [TODO](../../../main/doc_page_impl_TODO.md#edit-undo); this one is within a session, on the draft, and never reaches the file.

The rules as an author sees them are in [Data diagrams](comp-diagram-er.md#diagram-er-view) (Reading a diagram, Visual editing).

## React Flow Boundary

```text
YAML / edit draft
	-> validate nodes, renderer capabilities, handles, and connections
	-> resolve automatic positions and dimensions
	-> generic node wrapper -> internal renderer or RegisteredComp
	-> measure declared anchors -> React Flow handles
	-> connection adapter -> built-in path or registered edge renderer

React Flow interactions (edit mode)
	-> onConnect / onConnectEnd / onReconnect / onNodeDragStop, the handle clicks
	-> the editor maps runtime ids back to authored ids and free ends to point nodes
	-> validated store commands on the YAML draft
	-> the draft is parsed again into nodes and edges (positions kept)
```

A free end is a hidden point node (`~end:<role>:<connectionId>`, type `visualizationPoint`) with one handle at its origin; the edge ends on it, and the edge draws the ring. Authored node ids may not start with `~`.

The node and edge objects handed to React Flow are plain and keep their identity while nothing about them changed: `DiagramERStore.nodeList` / `edgeList` are shallow observables of plain objects (the graph they are built from is a plain reference too), `applyNodeChanges` copies only the node a change names, and the canvas decorates each object once per flag set (`draggable`, `className`, `hidden`). A drag therefore re-renders the dragged node alone, frame by frame, and the card inside it is not rendered again (its `node`, `anchorRef` and `visualization` props keep their identity). A deep clone of the whole list per frame (`toJS`), which re-created every node object and made every card re-measure its anchors, is what made dragging sluggish.

React Flow supplies canvas interaction and path utilities. The diagram supplies the domain-neutral schema, automatic layout policy, validation, and serialization. Table rows and choice options belong to node renderers, not to the graph adapter. Reusable card content can therefore appear both inside a node and in a standalone card without forcing a static card to support canvas interaction.

## Existing ER Data

The legacy grammar is identified by `tables` and `relationships` without the new `version`. It is the ER grammar of Dataverse tables: its tables become Dataverse kinds, so it reads only in a component whose registry has them (`DiagramER`). New data declares `version: 1` and `nodes`/`connections`; mixed grammars or unknown versions fail explicitly. A compatibility adapter converts legacy content in memory:

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

## Standalone Cards

A standalone card (`CardStandalone.jsx`, `cardStandaloneCompCreate`) renders one node of its registry without React Flow, handles, dragging, panning, or zooming, with `{ version: 1, node }`. The node must be of a kind of the registry that is a card (one with a schema). Data without `version` is the older form of a series, converted by the registry's `cardLegacyConvert` when it has one, and refused otherwise. The card is the same component, with the same normalization, markup, styles and stable row ids, as inside a diagram; the outer wrapper only constrains size and scrolling. `DiagramDataverseEntity` is the standalone card of the Power Platform series ([Power Platform](power-platform.md#the-standalone-dataverse-card)).

## Design Checks

- A diagram creates and reads only the kinds of its registry; a node of another series is an error naming the known types.

- A source table, custom registry operator, and target table connect through the same handle model.
- Moving a row handle between left and right preserves every attached connection and its ID.
- Reordering rows or changing their height keeps handles attached to the intended row.
- Automatic nodes avoid explicit nodes; reopening preserves saved numeric coordinates and dimensions.
- A saved camera is restored without a fit operation replacing it.
- Connection defaults and per-line overrides survive save/reload, including custom rendering and manual routes.
- Save, Cancel, undo/redo, and failed writes keep graph content and geometry consistent: an undo puts the draft back exactly (rows, handles, connections, positions, the comments of the initial text), the canvas shows the restored positions, the path points at nothing that is gone, and nothing of the history is in what is saved.
- A new session starts with an empty history; a save ends the session and its history; a selection never becomes a step.
- Legacy FB and property diagrams retain their tables, choice cards, connections, and initial positions through conversion.
