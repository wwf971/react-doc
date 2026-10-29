---
title: Data Diagrams
description: DiagramER draws nodes and connections on a canvas; DiagramDataverseEntity shows one Dataverse table card; both are edited visually in place or in the block popup
language: en
---

Two components share one data model and one card renderer. `DiagramER` draws **nodes** and the **connections** between their **handles** on a pannable, zoomable canvas. `DiagramDataverseEntity` shows a single Dataverse table card in the flow of the document, without a canvas. Both read YAML, both open in the block popup, and both are edited visually in place: cells, rows, columns, handles, connections and node positions.

<!--renderComp=DiagramText-->
```text
diagram
├─ nodes          what is drawn, and where
│  ├─ renderer    table, dataverse-table, dataverse-choice, operator, power-automate,
│  │              business-rule, or a registered component
│  ├─ data        the content the renderer understands (rows, fields, columns, labels ...)
│  ├─ position    { x, y }, or auto for the grid layout
│  └─ handles     named connection points on an anchor (row/<id>, column/<id>, header, body),
│                 each with an attachPolicy: multiple (default) or single
├─ connections    lines between two ends; an end is a handle { nodeId, handleId }
│                 or a free point { position: { x, y } }
├─ defaults       the layout policy and shared line settings
└─ viewport       canvas size, camera, zoom limits, minimap
```

<!--renderComp=Anchor,id=diagram-er-dataverse-->
## Dataverse ER Diagram

A `dataverse-table` node lists its columns as Key, Column, Logical name, and Type. A `dataverse-choice` node draws a global choice with a dashed border and a purple header; a connection to it attaches to its header. A handle is declared on an anchor (`column/<columnId>`), so it stays on its row when rows are reordered or renamed. Hover a column name to read its description. `isPositionLocked` keeps a node in place: the *Order* table below cannot be dragged even in edit mode.

### Syntax

````markdown
<!--renderComp=DiagramER,title=Orders-->
```yaml
version: 1
viewport:
  size: { height: 520 }
nodes:
  - id: account
    renderer: { type: dataverse-table }
    position: { x: 0, y: 40 }
    data:
      name: Account
      nameLogical: account
      columns:
        - { id: accountid, name: Account, nameLogical: accountid, type: Unique identifier, key: PK, isRequired: true }
        - { id: name, name: Account Name, nameLogical: name, type: Text, isRequired: true }
        - { id: revenue, name: Annual Revenue, nameLogical: revenue, type: Currency }
    handles:
      - { id: accountid-out, direction: out, anchor: { target: column/accountid, side: right } }
  # ... salesorder (locked), salesorderdetail, product, and a dataverse-choice node
connections:
  - id: order-customer
    source: { nodeId: account, handleId: accountid-out }
    target: { nodeId: salesorder, handleId: customerid-in }
    label: { text: customer }
```
````

### Display example

<!--renderComp=DiagramER,title=Orders-->
```yaml
version: 1
viewport:
  size: { height: 520 }
nodes:
  - id: account
    renderer: { type: dataverse-table }
    position: { x: 0, y: 40 }
    data:
      name: Account
      nameLogical: account
      description: A company the organization does business with.
      columns:
        - { id: accountid, name: Account, nameLogical: accountid, type: Unique identifier, key: PK, isRequired: true }
        - { id: name, name: Account Name, nameLogical: name, type: Text, isRequired: true }
        - { id: revenue, name: Annual Revenue, nameLogical: revenue, type: Currency, description: Reported yearly revenue }
    handles:
      - { id: accountid-out, direction: out, anchor: { target: column/accountid, side: right } }
  - id: salesorder
    renderer: { type: dataverse-table }
    position: { x: 520, y: 0 }
    isPositionLocked: true
    data:
      name: Order
      nameLogical: salesorder
      columns:
        - { id: salesorderid, name: Order, nameLogical: salesorderid, type: Unique identifier, key: PK, isRequired: true }
        - { id: customerid, name: Customer, nameLogical: customerid, type: Customer, key: FK, isRequired: true }
        - { id: statuscode, name: Status Reason, nameLogical: statuscode, type: Choice }
        - { id: totalamount, name: Total Amount, nameLogical: totalamount, type: Currency }
    handles:
      - { id: customerid-in, direction: in, anchor: { target: column/customerid, side: left } }
      - { id: salesorderid-out, direction: out, anchor: { target: column/salesorderid, side: right } }
      - { id: statuscode-out, direction: out, anchor: { target: column/statuscode, side: left } }
  - id: salesorderdetail
    renderer: { type: dataverse-table }
    position: { x: 1040, y: 40 }
    data:
      name: Order Product
      nameLogical: salesorderdetail
      columns:
        - { id: salesorderdetailid, name: Order Product, nameLogical: salesorderdetailid, type: Unique identifier, key: PK, isRequired: true }
        - { id: salesorderid, name: Order, nameLogical: salesorderid, type: Lookup, key: FK, isRequired: true }
        - { id: productid, name: Existing Product, nameLogical: productid, type: Lookup, key: FK }
        - { id: quantity, name: Quantity, nameLogical: quantity, type: Decimal Number }
    handles:
      - { id: salesorderid-in, direction: in, anchor: { target: column/salesorderid, side: left } }
      - { id: productid-in, direction: in, anchor: { target: column/productid, side: left } }
  - id: product
    renderer: { type: dataverse-table }
    position: { x: 520, y: 330 }
    data:
      name: Product
      nameLogical: product
      columns:
        - { id: productid, name: Product, nameLogical: productid, type: Unique identifier, key: PK, isRequired: true }
        - { id: name, name: Name, nameLogical: name, type: Text, isRequired: true }
    handles:
      - { id: productid-out, direction: out, anchor: { target: column/productid, side: right } }
  - id: orderstatus
    renderer: { type: dataverse-choice }
    position: { x: 0, y: 330 }
    data:
      name: Order Status
      nameLogical: salesorder_statuscode
      columns:
        - { id: active, name: Active, nameLogical: "1", type: Option }
        - { id: fulfilled, name: Fulfilled, nameLogical: "100001", type: Option }
        - { id: invoiced, name: Invoiced, nameLogical: "100003", type: Option }
    handles:
      - { id: header-in, direction: in, anchor: { target: header, side: right } }
connections:
  - id: order-customer
    source: { nodeId: account, handleId: accountid-out }
    target: { nodeId: salesorder, handleId: customerid-in }
    label: { text: customer }
  - id: detail-order
    source: { nodeId: salesorder, handleId: salesorderid-out }
    target: { nodeId: salesorderdetail, handleId: salesorderid-in }
    label: { text: lines }
  - id: detail-product
    source: { nodeId: product, handleId: productid-out }
    target: { nodeId: salesorderdetail, handleId: productid-in }
  - id: order-status
    source: { nodeId: salesorder, handleId: statuscode-out }
    target: { nodeId: orderstatus, handleId: header-in }
    style: { strokeDasharray: "5 4" }
```

<!--renderComp=Anchor,id=diagram-er-flow-->
## Operators, Custom Nodes, and Line Styles

A node is not necessarily a table. `operator` is a built-in step node; `renderer: { component: MigrationStep }` draws a node with a registered component that declares the `visualizationNode` placement and lists its anchors (`input`, `output`). Lines take a `renderer.type` (`smoothstep` by default, `bezier`, `straight`, `step`, or `polyline` with waypoints), and a `style`, `label`, markers, and `isAnimated`. `defaults.connection` sets these for every line; a line overrides them one property at a time.

<!--renderComp=DiagramER,title=Customer migration-->
```yaml
version: 1
defaults:
  connection:
    renderer: { type: bezier }
    style: { stroke: "#0f766e", strokeWidth: 1.5 }
viewport:
  size: { height: 440 }
nodes:
  - id: legacy
    renderer: { type: dataverse-table }
    position: { x: 0, y: 30 }
    size: { width: 360 }
    data:
      name: Legacy customer
      nameLogical: tbl_customer
      columns:
        - { id: mail, name: MAIL_ADDR, nameLogical: mail_addr, type: String }
        - { id: tel, name: TEL_NO, nameLogical: tel_no, type: String }
    handles:
      - { id: mail-out, direction: out, anchor: { target: column/mail, side: right } }
      - { id: tel-out, direction: out, anchor: { target: column/tel, side: right } }
  - id: normalize
    renderer: { component: MigrationStep }
    position: { x: 460, y: 0 }
    data:
      label: Normalize email
      operation: trim(lower(x))
      note: Empty strings become null.
    handles:
      - { id: in, direction: in, anchor: { target: input, side: left } }
      - { id: out, direction: out, anchor: { target: output, side: right } }
  - id: phone
    renderer: { type: operator }
    position: { x: 460, y: 190 }
    data:
      label: Format phone number
      description: E.164, country code from the account address.
    handles:
      - { id: in, direction: in, anchor: { side: left } }
      - { id: out, direction: out, anchor: { side: right } }
  - id: contact
    renderer: { type: dataverse-table }
    position: { x: 820, y: 30 }
    size: { width: 380 }
    data:
      name: Contact
      nameLogical: contact
      columns:
        - { id: email, name: Email, nameLogical: emailaddress1, type: Text }
        - { id: phone, name: Business Phone, nameLogical: telephone1, type: Text }
    handles:
      - { id: email-in, direction: in, anchor: { target: column/email, side: left } }
      - { id: phone-in, direction: in, anchor: { target: column/phone, side: left } }
connections:
  - id: mail-normalize
    source: { nodeId: legacy, handleId: mail-out }
    target: { nodeId: normalize, handleId: in }
  - id: normalize-email
    source: { nodeId: normalize, handleId: out }
    target: { nodeId: contact, handleId: email-in }
    label: { text: emailaddress1 }
    isAnimated: true
  - id: tel-phone
    source: { nodeId: legacy, handleId: tel-out }
    target: { nodeId: phone, handleId: in }
    renderer: { type: step }
    style: { stroke: "#b45309", strokeDasharray: "6 4" }
  - id: phone-contact
    source: { nodeId: phone, handleId: out }
    target: { nodeId: contact, handleId: phone-in }
    renderer: { type: smoothstep }
    style: { stroke: "#b45309" }
    markerStart: arrow
```

- A registered node component receives `config.visualization` with `nodeId`, `size`, and `anchorRef(anchorId)`; it attaches each declared anchor, and the diagram draws the handles over them. It only draws: moving, connecting, and saving belong to the diagram.
- An unknown node type, a component without the `visualizationNode` placement, or a handle on a missing anchor is reported with the node's ID, instead of silently drawing something else.

<!--renderComp=Anchor,id=diagram-er-table-->
## Generic Tables, Attach Policies, and Free Ends

The `table` node is the card every other card is a variant of: a title, an optional subtitle and description, the **fields** of the card (its columns, authored in `data.fields`) and its **rows** (`data.rows`, one value per field). Handles sit on rows (`row/<id>`); the title line takes handles only when `isHeaderHandleEnabled` is set. A handle's `attachPolicy` says how many connections it accepts: `multiple` (the default) or `single`. Either end of a connection may be **free**, a point on the canvas instead of a handle, drawn as a small ring; a free end is kept exactly where it was left.

<!--renderComp=DiagramER,title=Parts and tolerances-->
```yaml
version: 1
viewport:
  size: { height: 380 }
nodes:
  - id: bracket
    renderer: { type: table }
    position: { x: 0, y: 20 }
    data:
      name: Bracket
      nameLogical: BRK-120
      isHeaderHandleEnabled: true
      fields:
        - { id: dimension, label: Dimension }
        - { id: value, label: Value }
        - { id: tolerance, label: Tolerance }
      rows:
        - { id: width, dimension: Width, value: 120 mm, tolerance: ±0.2 }
        - { id: height, dimension: Height, value: 40 mm, tolerance: ±0.2 }
        - { id: hole, dimension: Hole, value: Ø 8 mm, tolerance: H7 }
    handles:
      - { id: hole-out, direction: out, anchor: { target: row/hole, side: right }, attachPolicy: single }
      - { id: title-in, direction: in, anchor: { target: header, side: left } }
  - id: pin
    renderer: { type: table }
    position: { x: 560, y: 60 }
    data:
      name: Pin
      fields:
        - { id: property, label: Property }
        - { id: value, label: Value }
      rows:
        - { id: diameter, property: Diameter, value: 8 mm g6 }
        - { id: material, property: Material, value: Steel }
    handles:
      - { id: diameter-in, direction: in, anchor: { target: row/diameter, side: left } }
connections:
  - id: fit
    source: { nodeId: bracket, handleId: hole-out }
    target: { nodeId: pin, handleId: diameter-in }
    label: { text: clearance fit }
  - id: assembly
    source: { position: { x: -160, y: 36 } }
    target: { nodeId: bracket, handleId: title-in }
    label: { text: assembly A-3 }
    style: { strokeDasharray: "4 3" }
```

<!--renderComp=Anchor,id=diagram-er-layout-->
## Automatic Layout and Viewport

A node without `position` is placed on a grid, in declaration order, around the nodes that have one. `defaults.layout` sets the number of columns and the gaps. `viewport` sets the canvas size, the zoom limits, and the minimap; `view: auto` fits the diagram after its nodes are measured. Panning, zooming, and dragging while reading never change the document.

<!--renderComp=DiagramER,title=Automatic grid-->
```yaml
version: 1
defaults:
  layout: { type: grid, columns: 3, gap: { x: 60, y: 50 } }
viewport:
  size: { height: 420 }
  zoom: { min: 0.3, max: 1.6 }
  isMiniMapVisible: true
nodes:
  - id: team
    renderer: { type: dataverse-table }
    data:
      name: Team
      nameLogical: team
      columns:
        - { id: teamid, name: Team, type: Unique identifier, key: PK }
        - { id: name, name: Team Name, type: Text }
  - id: systemuser
    renderer: { type: dataverse-table }
    data:
      name: User
      nameLogical: systemuser
      columns:
        - { id: systemuserid, name: User, type: Unique identifier, key: PK }
        - { id: fullname, name: Full Name, type: Text }
  - id: businessunit
    renderer: { type: dataverse-table }
    data:
      name: Business Unit
      nameLogical: businessunit
      columns:
        - { id: businessunitid, name: Business Unit, type: Unique identifier, key: PK }
        - { id: name, name: Name, type: Text }
  - id: role
    renderer: { type: dataverse-table }
    data:
      name: Security Role
      nameLogical: role
      columns:
        - { id: roleid, name: Role, type: Unique identifier, key: PK }
        - { id: name, name: Name, type: Text }
```

<!--renderComp=Anchor,id=diagram-dataverse-entity-->
## Dataverse Table Card

`DiagramDataverseEntity` shows one `dataverse-table` node outside a canvas: the same card, without dragging, zooming, or connection lines. The text stays selectable. Handles declared on the node are kept and can be edited, so the card can later be moved into a diagram unchanged.

### Syntax

````markdown
<!--renderComp=DiagramDataverseEntity-->
```yaml
version: 1
node:
  id: lead
  renderer: { type: dataverse-table }
  data:
    name: Lead
    nameLogical: lead
    columns:
      - { id: leadid, name: Lead, nameLogical: leadid, type: Unique identifier, key: PK, isRequired: true }
      - { id: subject, name: Topic, nameLogical: subject, type: Text, isRequired: true }
```
````

### Display example

<!--renderComp=DiagramDataverseEntity-->
```yaml
version: 1
node:
  id: lead
  renderer: { type: dataverse-table }
  data:
    name: Lead
    nameLogical: lead
    description: A prospect that has not been qualified yet.
    columns:
      - { id: leadid, name: Lead, nameLogical: leadid, type: Unique identifier, key: PK, isRequired: true }
      - { id: subject, name: Topic, nameLogical: subject, type: Text, isRequired: true }
      - { id: companyname, name: Company Name, nameLogical: companyname, type: Text }
      - { id: parentaccountid, name: Parent Account, nameLogical: parentaccountid, type: Lookup, key: FK, description: The account the lead was qualified into }
      - { id: leadqualitycode, name: Rating, nameLogical: leadqualitycode, type: Choice }
```

<!--renderComp=Anchor,id=diagram-er-view-->
## Reading a Diagram

These are the rules of a diagram while the document is read (and of a block in edit mode whose session is not open). They are the general principle of every block-like component with a canvas ([Block-like components](../../main/doc_page_impl_mdx_comp_block.md)):

- **The reader moves the camera, never the content.** Dragging on empty canvas or on the title line of a card pans; the mouse wheel zooms around the pointer; the controls at the bottom left zoom and fit. A node cannot be dragged: its position is part of the document, and the document is changed only in edit mode.
- **Text stays text.** Dragging across the rows of a card selects their text, as in any paragraph; a column description is the tooltip of its name.
- **The wheel over a card is the wheel over the canvas.** Scrolling with the pointer on a card zooms the diagram exactly as scrolling on empty canvas does, and never scrolls the page behind it. The page scrolls only when the pointer is outside the diagram.
- **Nothing the reader does is written.** Pan, zoom, and the camera are remembered for the block while the page is open and are dropped with it.
- **The popup.** The button at the top right of the block opens the diagram (or the card) in the block popup, where it fills the dialog, can be maximized to the window, and switches between **View** and **Edit** in the dialog's header. The canvas keeps its camera and the editor its draft across opening, maximizing and closing.

<!--renderComp=Anchor,id=diagram-er-edit-->
## Visual Editing

In edit mode, both components open in the **Visual** mode from the block's Edit button, from the mode menu, or from **Edit** in the popup; a click on the canvas pans or selects, it never enters the editor. The built-in **Source** mode stays available from the mode menu. Every change is a draft of the same YAML, with its comments kept; Save or a click outside the block writes it once, and Cancel discards it.

### Entering and leaving

- **Entering moves nothing.** The block keeps its height, its place, and the camera of the canvas; the page does not scroll. The only things that appear are the floating bar above the block and, later, the edit card beside what is selected.
- **The floating bar** shows whether there are unsaved changes, **+** (add a node or a connection at the center of the canvas), **Save to** for an asset-backed block, and **Save** / **Cancel**. Ctrl/⌘ + Enter saves.
- **Escape steps out one level at a time:** the cell being typed (restoring it), then the create panel, then the selection. It never ends the session, so a stray key cannot discard the draft.
- **A failed change is refused with its reason** in the edit card (or the bar), and the draft stays as it was: a handle that takes one connection and has it, both ends of a line on the same handle, a locked node without a position.

### Selection and the edit card

One thing is selected at a time, and the **edit card** opens beside it with the settings of that thing. The card is the host's property editor with tabs; a tab without a subject is greyed out, and the author may switch to any enabled tab.

| What is selected | How | Tabs enabled |
| --- | --- | --- |
| A card (node) | a click on its title line, or on an operator | **Table** (name, subtitle, description, title handles, position, add row / column, remove node) |
| A row of a card | a click in the row; the Row tab | Table, **Row** (its values, its handles, insert above / below, move up / down, remove) |
| A column of a card | a click on a column header | Table, **Column** (its label; insert left / right, move left / right, remove; fixed for Dataverse and resource cards) |
| A cell | a click in the cell, once typing ends | Table, Row, Column, **Cell** (the value) |
| A connection, from a card | a click on a handle of the card, which rotates through the connections attached to it, and back to none | the tabs of the card and **Line** |
| A connection, by itself | a click anywhere near the line, or on its label | **Line** only |

- Selecting a connection is the same kind of state as selecting a card. A click on a line selects it where the pointer is, within a few pixels of the path, and the line is drawn with a halo; its label is part of it.
- The edit card is **hidden while something is being typed or dragged**: while a cell is being edited, while a node, a line end or a new line is being dragged, and while the create panel is open. It comes back, with the same tab, when the gesture ends.
- A click on empty canvas, Escape, or the card's close button clears the selection.

### Cards: cells, rows and columns

- **Click a cell to type in it.** Enter or a click elsewhere ends the cell, Escape restores it. Key and Type of a Dataverse column open a menu; Type has a search over the Dataverse column types. The card does not change size when a cell starts or ends editing.
- The **Cell** tab offers the same value as a field, so a value can also be typed in the edit card.
- **Rows** can be inserted at any index (above or below the selected row, or appended from the Table tab), moved up and down, and removed. A new row is selected at once. Removing a row removes its handles; connections on them are detached (their ends stay where the handles were).
- **Columns** of a generic `table` can be inserted left or right of the selected column, moved, relabeled and removed (the values of the removed column are dropped from every row; a table keeps at least one column). The columns of a Dataverse card and of a resource card are fixed: the Column tab says so.
- The title line edits the name and the subtitle in place; the description and the head fields of a resource card are in the Table tab.

### Handles

- **Adding a handle:** point at a row and press the **+** that appears at its left or right edge, or switch the left / right handle on in the Row tab. A new handle takes connections in both directions and any number of them.
- **Title-line handles** are off by default. They exist for a choice card and a resource card, and for a generic table whose **Title handles** setting is on; a Dataverse table has none.
- **Removing a handle** (Row tab, or Title handles) that connections use moves those connections to the handle on the other side of the same row when there is one. Otherwise the connections are detached: each end becomes a free end a little away from where the handle was. Nothing is deleted silently.
- **Attach policy:** a handle accepts many lines (the default) or one (**Right accepts: One line** in the Row tab). A handle that takes one line and has it refuses another end dropped on it, and a drag from it moves its line instead of starting a new one.
- A handle with connections is drawn filled; the handle of the selected connection is ringed. A handle does not know which end of a line it holds: the direction of a line is shown by its arrows.

### Connections

- **Drawing a line:** drag from a handle. A dashed line follows the pointer, green over a handle that will take it and red over one that will not. Releasing on a valid handle (of any card, the same one included, but never the same handle) creates the connection and selects it; releasing anywhere else creates nothing.
- **Direction:** the new line runs out of the handle that can send and into the handle that can receive, whichever end the drag started from; a handle declared `both` does either.
- **Dragging from a handle whose connection is selected** (after a click on the handle chose it) does not start a new line: it detaches that end of the selected line and carries it with the pointer, drawn from the line's other end. The same happens when dragging from a handle that takes one line and has it.
- **Moving an end:** drag the end of a line where it meets a handle, or drag the ring of a free end. Dropping it on a handle that takes it attaches it there; dropping it anywhere else leaves it as a free end at that point. A free end is part of the saved data (`position`), so it is still there after a reload.
- **Line settings** (the Line tab): label, line type (smooth step, step, curve, straight, polyline), color, thickness, dash (solid, dashed, dotted), the arrow at each end, animation, and **Remove connection**. The two ends are listed as read-only text.

### Creating nodes and connections

- **Double-click empty canvas**, or press **+** in the floating bar, to open the create panel at that point: a search field over what can be added (a generic table, a Dataverse table, a Dataverse choice, an operator, a Power Automate step, a business rule, and a connection with two free ends). Type to filter, ArrowUp / ArrowDown to move, Enter to take the highlighted entry, Escape or a click outside to close.
- The new node appears at the panel's position, with an explicit position, and is selected with its edit card open. A new connection appears with both ends free and selected; drag its ends onto handles.
- **Removing a node** (Table tab) keeps the connections on it: their ends become free ends where the handles were. Remove the lines from their Line tab when they are not wanted.

### Positions

- Dragging a card in edit mode moves it, and the position is written to the draft when the card has an explicit position. The Table tab's **Remember** keeps the current canvas position as the node's `position` (off: the node returns to the automatic layout); **Locked** keeps the position and prevents dragging in either mode. A locked node cannot be dragged, in reading or in editing.
- The camera is kept when the block saves.

### Data in the asset service layer

The examples above are inline: a save rewrites the block. The two blocks below are references into the [asset service layer](../asset-store.md). Their Visual mode edits the referenced object, at its head version and while it is not locked, and a save writes a version of the object without touching the document. **Save to → Inline YAML** writes the draft into the block in place of the reference instead, and leaves the object as it was.

<!--renderComp=DiagramER,title=Support cases-->
```asset
store: local
name: support case diagram
```

<!--renderComp=DiagramDataverseEntity-->
```asset
store: local
name: contact table
```

<!--renderComp=Anchor,id=diagram-er-legacy-->
## Earlier Grammar

Diagrams written with `tables` and `relationships`, and cards written with `entity`, are still read: they are converted in memory, keeping table positions, choice cards (`kind: choice`), and relationship labels. Reading never rewrites the document; the first save from the Visual mode writes the `version: 1` form.

<!--renderComp=DiagramER,title=Orders (earlier grammar),height=380-->
```yaml
tables:
  - id: customer
    name: customer
    nameLogical: Customer
    columns:
      - { id: id, name: id, type: uuid, key: PK }
      - { id: name, name: name, type: text }
  - id: order
    name: order
    nameLogical: Order
    columns:
      - { id: id, name: id, type: uuid, key: PK }
      - { id: customerId, name: customer_id, type: uuid, key: FK }
relationships:
  - id: orderCustomer
    label: places
    source: { tableId: customer, columnId: id }
    target: { tableId: order, columnId: customerId }
```
