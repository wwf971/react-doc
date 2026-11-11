---
title: Data Diagrams
description: DiagramER draws nodes and connections on a canvas; CardDiagram is the same canvas with generic cards only; DiagramDataverseEntity shows one Dataverse table card; all are edited visually in place or in the block popup
language: en
---

Two components share one data model and one card renderer. `DiagramER` draws **nodes** and the **connections** between their **handles** on a pannable, zoomable canvas. `DiagramDataverseEntity` shows a single Dataverse table card in the flow of the document, without a canvas. Both read YAML, both open in the block popup, and both are edited visually in place: cells, rows, columns, handles, connections and node positions.

These components are not part of the doc page package: they come from the package **cloud-dev-vis** (`package/cloud-dev-vis/` of the project), which a workspace or a doc page imports (`packageList`). Each diagram component has a fixed **node registry**: the node types it can draw and offers to create. `DiagramER` (and `DiagramPowerAutomate`, `DiagramBusinessRule`) use the registry of the Power Platform series; [`CardDiagram`](#card-diagram) uses the one of the base series, generic tables and operators only.

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
        - {
            id: accountid,
            name: Account,
            nameLogical: accountid,
            type: Unique identifier,
            key: PK,
            isRequired: true
          }
        - {
            id: name,
            name: Account Name,
            nameLogical: name,
            type: Text,
            isRequired: true
          }
        - {
            id: revenue,
            name: Annual Revenue,
            nameLogical: revenue,
            type: Currency,
            description: Reported yearly revenue
          }
    handles:
      - {
          id: accountid-out,
          direction: out,
          anchor: { target: column/accountid, side: right }
        }
  - id: salesorder
    renderer: { type: dataverse-table }
    position: { x: 520, y: 0 }
    isPositionLocked: true
    data:
      name: Order
      nameLogical: salesorder
      columns:
        - {
            id: salesorderid,
            name: Order,
            nameLogical: salesorderid,
            type: Unique identifier,
            key: PK,
            isRequired: true
          }
        - {
            id: customerid,
            name: Customer,
            nameLogical: customerid,
            type: Customer,
            key: FK,
            isRequired: true
          }
        - {
            id: statuscode,
            name: Status Reason,
            nameLogical: statuscode,
            type: Choice
          }
        - {
            id: totalamount,
            name: Total Amount,
            nameLogical: totalamount,
            type: Currency
          }
    handles:
      - {
          id: customerid-in,
          direction: in,
          anchor: { target: column/customerid, side: left }
        }
      - {
          id: salesorderid-out,
          direction: out,
          anchor: { target: column/salesorderid, side: right }
        }
      - {
          id: statuscode-out,
          direction: out,
          anchor: { target: column/statuscode, side: left }
        }
  - id: salesorderdetail
    renderer: { type: dataverse-table }
    position: { x: 1040, y: 40 }
    data:
      name: Order Product
      nameLogical: salesorderdetail
      columns:
        - {
            id: salesorderdetailid,
            name: Order Product,
            nameLogical: salesorderdetailid,
            type: Unique identifier,
            key: PK,
            isRequired: true
          }
        - {
            id: salesorderid,
            name: Order,
            nameLogical: salesorderid,
            type: Lookup,
            key: FK,
            isRequired: true
          }
        - {
            id: productid,
            name: Existing Product,
            nameLogical: productid,
            type: Lookup,
            key: FK
          }
        - { id: quantity, name: Quantity, nameLogical: quantity, type: Decimal Number }
    handles:
      - {
          id: salesorderid-in,
          direction: in,
          anchor: { target: column/salesorderid, side: left }
        }
      - {
          id: productid-in,
          direction: in,
          anchor: { target: column/productid, side: left }
        }
  - id: product
    renderer: { type: dataverse-table }
    position:
      x: 806
      y: 521
    data:
      name: Product
      nameLogical: product
      columns:
        - {
            id: productid,
            name: Product,
            nameLogical: productid,
            type: Unique identifier,
            key: PK,
            isRequired: true
          }
        - { id: name, name: Name, nameLogical: name, type: Text, isRequired: true }
    handles:
      - {
          id: productid-out,
          direction: out,
          anchor: { target: column/productid, side: right }
        }
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

A node is not necessarily a table. `operator` is a built-in step node; `renderer: { component: MigrationStep }` draws a node with a registered component that declares the `visualizationNode` placement and lists its anchors (`input`, `output`). Lines take a `renderer.type` (`smoothstep` by default, `bezier`, `straight`, `step`, or `polyline` with waypoints), and a `style`, `label`, markers, and `isAnimated`. `defaults.connection` sets these for every line; a line overrides them one property at a time. A right-angled line or a curve can be shaped by anchors and handles ([Connection Lines](../../doc/card-diagram-connection-line.md)), which is also how lines are kept off each other ([the check](../../doc/card-diagram-usage.md#no-lines-on-top-of-each-other)).

A node can also be **any object** of the page's object registry: `renderer: { component: ObjectView }` with `data: { object: doc:~example:example/service-kernel.md }` draws a card of that document, and the same with a service instance, its config, a todo or a database, each by the view of its own types (`example_doc/object-registry.md`, [Objects and Types](../../../../main/doc_page_impl_obj.md#object-views)). It has one anchor, `body`, on every side. In edit mode, a double-click on the canvas and a few typed words also list the objects found by the page's object search, below the node kinds; choosing one adds such a node. `objectSearch: { typeList: [core.task] }` in the diagram's data narrows what is offered, `objectSearch: { isEnabled: false }` offers none.

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

<!--renderComp=Anchor,id=card-diagram-->
## Card Diagram: Generic Cards Only

`CardDiagram` is the canvas of the base series of cloud-dev-vis, on which the other diagram components are built. Its node registry holds two kinds: the generic `table` (any number of fields and rows) and the `operator`. Its create panel offers only those and a connection, and a node of another series is refused with the types it knows: a `dataverse-table` node in a `CardDiagram` is an error, not a Dataverse card. The grammar is the one of `DiagramER`.

<!--renderComp=CardDiagram,title=Normalize email-->
```yaml
version: 1
viewport:
  size: { height: 360 }
nodes:
  - id: source
    renderer: { type: table }
    position: { x: 0, y: 40 }
    data:
      name: Source
      fields: [{ id: name, label: Name }, { id: value, label: Value }]
      rows:
        - { id: email, name: Email, value: text }
        - { id: phone, name: Phone, value: text }
    handles:
      - { id: email-out, direction: out, anchor: { target: row/email, side: right } }
  - id: normalize
    renderer: { type: operator }
    position: { x: 440, y: 70 }
    data: { label: Normalize, description: Trim and lower-case }
    handles:
      - { id: in, direction: in, anchor: { side: left } }
      - { id: out, direction: out, anchor: { side: right } }
  - id: target
    renderer: { type: table }
    position: { x: 760, y: 40 }
    data:
      name: Target
      fields: [{ id: name, label: Name }, { id: value, label: Value }]
      rows:
        - { id: email, name: Email, value: "text, lower case" }
    handles:
      - { id: email-in, direction: in, anchor: { target: row/email, side: left } }
connections:
  - { id: source-normalize, source: { nodeId: source, handleId: email-out }, target: { nodeId: normalize, handleId: in } }
  - { id: normalize-target, source: { nodeId: normalize, handleId: out }, target: { nodeId: target, handleId: email-in } }
```

### A graph of things: icon nodes

A `card-icon` is a thing among many: a small round mark with its name beside it (`title`, `text`, `icon`, `tone`), a dot for its state (`statusTone`), larger and filled for the one the graph is about (`isFocus`), dashed for one that is not there yet (`isGhost`). A line ends on its mark with `anchor: { target: icon }`, and a handle with `isMarkerHidden` draws no square there. A `card-caption` is a few small words over a group. The example is laid out by the **Outline** arranger (in edit mode: **Arrange**): the nodes one under another, indented by level, the lines leaving the bottom of a node turning once into the side of the next, so a graph fits a narrow place and grows downward.

<!--renderComp=CardDiagram,title=Around a plan-->
```yaml
version: 1
viewport:
  size: { height: 380 }
defaults:
  connection: { renderer: { type: smoothstep }, markerEnd: none, style: { stroke: '#94a3b8', strokeWidth: 1.25 } }
nodes:
  - id: project
    renderer: { type: card-icon }
    position: { x: 20, y: 20 }
    size: { width: 220, height: 34 }
    data: { title: 'Migration', icon: 'folder' }
    handles:
      - { id: 'down', direction: 'out', anchor: { target: 'icon', side: 'bottom' }, isMarkerHidden: true }
  - id: plans
    renderer: { type: card-icon }
    position: { x: 20, y: 60 }
    size: { width: 220, height: 34 }
    data: { title: 'Plans', icon: 'list-checks' }
    handles:
      - { id: 'up', direction: 'in', anchor: { target: 'icon', side: 'top' }, isMarkerHidden: true }
      - { id: 'down', direction: 'out', anchor: { target: 'icon', side: 'bottom' }, isMarkerHidden: true }
  - id: plan
    renderer: { type: card-icon }
    position: { x: 42, y: 100 }
    size: { width: 220, height: 40 }
    data: { title: 'Rehearsal 2', text: '7 tables', icon: 'list-checks', tone: 'blue', isFocus: true, statusTone: 'green' }
    handles:
      - { id: 'in', direction: 'in', anchor: { target: 'icon', side: 'left' }, isMarkerHidden: true }
      - { id: 'down', direction: 'out', anchor: { target: 'icon', side: 'bottom' }, isMarkerHidden: true }
  - id: run-1
    renderer: { type: card-icon }
    position: { x: 64, y: 146 }
    size: { width: 220, height: 34 }
    data: { title: 'First run', text: '18 of 18 steps', icon: 'play', tone: 'green', statusTone: 'green' }
    handles:
      - { id: 'in', direction: 'in', anchor: { target: 'icon', side: 'left' }, isMarkerHidden: true }
  - id: run-2
    renderer: { type: card-icon }
    position: { x: 64, y: 186 }
    size: { width: 220, height: 34 }
    data: { title: 'Second run', text: '10 of 18 steps', icon: 'play', tone: 'green', statusTone: 'amber' }
    handles:
      - { id: 'in', direction: 'in', anchor: { target: 'icon', side: 'left' }, isMarkerHidden: true }
  - id: new
    renderer: { type: card-icon }
    position: { x: 64, y: 226 }
    size: { width: 220, height: 34 }
    data: { title: 'New execution', icon: 'plus', isGhost: true }
    handles:
      - { id: 'in', direction: 'in', anchor: { target: 'icon', side: 'left' }, isMarkerHidden: true }
  - id: uses
    renderer: { type: card-caption }
    position: { x: 64, y: 276 }
    size: { width: 220, height: 16 }
    data: { text: 'Uses' }
    handles: []
  - id: source
    renderer: { type: card-icon }
    position: { x: 64, y: 298 }
    size: { width: 220, height: 34 }
    data: { title: 'PW', text: 'source', icon: 'database', tone: 'blue' }
    handles:
      - { id: 'in', direction: 'in', anchor: { target: 'icon', side: 'left' }, isMarkerHidden: true }
  - id: target
    renderer: { type: card-icon }
    position: { x: 64, y: 338 }
    size: { width: 220, height: 34 }
    data: { title: 'Connect', text: 'target', icon: 'database', tone: 'blue' }
    handles:
      - { id: 'in', direction: 'in', anchor: { target: 'icon', side: 'left' }, isMarkerHidden: true }
connections:
  - { id: 'project-plans', source: { nodeId: 'project', handleId: 'down' }, target: { nodeId: 'plans', handleId: 'up' } }
  - { id: 'plans-plan', source: { nodeId: 'plans', handleId: 'down' }, target: { nodeId: 'plan', handleId: 'in' }, route: { anchorList: [{ id: 'a1', along: 1, x: -9, y: 0 }] } }
  - { id: 'plan-run-1', source: { nodeId: 'plan', handleId: 'down' }, target: { nodeId: 'run-1', handleId: 'in' }, route: { anchorList: [{ id: 'a1', along: 1, x: -6, y: 0 }] } }
  - { id: 'plan-run-2', source: { nodeId: 'plan', handleId: 'down' }, target: { nodeId: 'run-2', handleId: 'in' }, route: { anchorList: [{ id: 'a1', along: 1, x: -6, y: 0 }] } }
  - { id: 'plan-new', source: { nodeId: 'plan', handleId: 'down' }, target: { nodeId: 'new', handleId: 'in' }, route: { anchorList: [{ id: 'a1', along: 1, x: -6, y: 0 }] } }
  - { id: 'plan-source', source: { nodeId: 'plan', handleId: 'down' }, target: { nodeId: 'source', handleId: 'in' }, style: { strokeDasharray: '3 3' }, route: { anchorList: [{ id: 'a1', along: 1, x: -6, y: 0 }] } }
  - { id: 'plan-target', source: { nodeId: 'plan', handleId: 'down' }, target: { nodeId: 'target', handleId: 'in' }, style: { strokeDasharray: '3 3' }, route: { anchorList: [{ id: 'a1', along: 1, x: -6, y: 0 }] } }
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
## Table Card Views

A table card has one or more **views**, and shows one at a time. Each view belongs to a **view mode**, and has the parameters of that mode, so one card can have several views of one mode.

| View mode | A visual row is | Parameters, all optional |
| --- | --- | --- |
| `plain` | a row of the card, as the data has it: a column of a Dataverse table, an option of a choice, a record of a generic table | `rowDisplay` |
| `column` | a column of the table, with the value of one record beside it if `valueRowId` names one | `rowDisplay` (of columns), `valueRowId`, `labelColumn`, `labelValue`, `columnTemplate` |
| `row` | a record of the table | `rowDisplay` (of records), `fieldDisplay` (the columns, in order), `columnTemplate` |

A table's columns are its `fields`, or a Dataverse card's `columns`. Its records are its `rows`: `{ id, <column id>: value }`. A Dataverse card needs `rows` written for its `row` views. `column` and `row` views are offered on generic and Dataverse tables; choice and resource cards have `plain` only.

```yaml
data:
  name: Account
  columns: [...]
  rows:
    - { id: r1, accountid: A-001, name: Contoso, status: Active }
  viewList:
    - { id: schema, label: Schema, mode: plain, rowDisplay: [accountid, '...', status] }
    - { id: one, label: One record, mode: column, valueRowId: r1 }
    - { id: records, label: Records, mode: row, fieldDisplay: [accountid, name] }
  viewDefault: one
```

- **Without `viewList`**, the card has one view, `plain`, and needs no declaration. Its parameters are the card's own: `rowDisplay` directly in `data`. This is what most cards are.
- **With a `viewList`**, those are the views. `plain` is there only if it is one of them, which is worth doing when the plain view should be offered, or be the default, among others.
- **The default view** is `viewDefault`, else the first declared.
- **The switcher** is a menu at the right of the title line. It shows when views are declared. With only one view, it shows the name of the view and cannot be clicked. `isViewSwitcherHidden: true` hides it, and `false` shows it on a card with no declared views too.
- **What a reader picks is not saved.** It lasts while the card is on the page.
- **A line stays attached in every view.** If a view does not draw the row a handle is on, the handle stands in the middle of that side of the card.

### Choosing rows

`rowDisplay` lists what a view draws from top to bottom:

```yaml
rowDisplay: [accountid, '...', status, { break: 12 columns }, modifiedon]
```

| Entry | Draws |
| --- | --- |
| a row id | that row. Rows can be left out, and can come in another order |
| `'...'` | a **row break**: the mark an axis has where part of it is cut away |
| `{ break: text }` | a row break saying what was cut |
| `{ break?: text, rowList: [ids], isExpanded? }` | a row break with **rows behind it**, which a reader can open and close |

Quote `'...'` so that it stays plain text in YAML.

<!--renderComp=DiagramER,title=A long table cut down to what matters here-->
```yaml
version: 1
viewport:
  size: { height: 300 }
nodes:
  - id: account
    renderer: { type: dataverse-table }
    position: { x: 0, y: 0 }
    data:
      name: Account
      nameLogical: account
      columns:
        - { id: accountid, name: Account, nameLogical: accountid, type: Unique identifier, key: PK }
        - { id: name, name: Name, nameLogical: name, type: Text }
        - { id: phone, name: Phone, nameLogical: telephone1, type: Text }
        - { id: fax, name: Fax, nameLogical: fax, type: Text }
        - { id: status, name: Status, nameLogical: statuscode, type: Choice, tone: green }
        - { id: createdon, name: Created on, nameLogical: createdon, type: Date and Time }
        - { id: modifiedon, name: Modified on, nameLogical: modifiedon, type: Date and Time }
      rowDisplay: [accountid, { break: 3 columns }, status, '...']
    handles: []
connections: []
```

### Rows behind a row break

A row break can simply be there, or it can hold rows. With `rowList`, the rows named are not drawn at first, and the reader can open them: a click anywhere on the row break, or on the button at its right, whose icon says which way it goes. Open, the row break is a bar over its rows with a button that closes them, and a line down their side shows where they end.

<!--renderComp=DiagramER,title=Rows a reader can open-->
```yaml
version: 1
viewport:
  size: { height: 360 }
nodes:
  - id: account
    renderer: { type: dataverse-table }
    position: { x: 0, y: 0 }
    data:
      name: Account
      nameLogical: account
      columns:
        - { id: accountid, name: Account, nameLogical: accountid, type: Unique identifier, key: PK }
        - { id: name, name: Name, nameLogical: name, type: Text }
        - { id: phone, name: Phone, nameLogical: telephone1, type: Text }
        - { id: fax, name: Fax, nameLogical: fax, type: Text }
        - { id: status, name: Status, nameLogical: statuscode, type: Choice, tone: green }
        - { id: createdon, name: Created on, nameLogical: createdon, type: Date and Time }
        - { id: modifiedon, name: Modified on, nameLogical: modifiedon, type: Date and Time }
      rowDisplay:
        - accountid
        - { break: 3 columns, rowList: [name, phone, fax] }
        - status
        - { break: 2 columns, rowList: [createdon, modifiedon], isExpanded: true }
    handles: []
connections: []
```

- **Closed at first.** `isExpanded: true` opens it at first. What a reader does is not saved: it lasts while the card is on the page, as the view they picked does.
- **Every row is named once**, as a row of the list or behind one row break. A row behind a row break counts as shown, not left out.
- **Which to use.** A plain mark says something is cut and there is nothing more to see here, as when the rows do not matter in this diagram. Rows behind it say the reader may want them. In a generator, `cardRowDisplayKeepBuild(rowIdList, keepIdList, { isFoldable: true })` makes them.
- **A line stays attached.** A line to a row behind a closed row break ends on the row break, and on its row when opened, so nothing is left dangling either way.
- **A card embedded in another scene** takes no pointer and shows its row breaks as they are at first.

### Rows left out

- **The rows stay in the data.** `rowDisplay` only says what is drawn when reading. In edit mode the card draws the same, followed by the rows left out, dimmed, so that they can still be edited.
- **A handle belongs on a row that is drawn.** On a card with one view, the editor will not leave out a row with a handle, and in the source one is reported on the card as a missing anchor.

### In the edit card

The card's tab has a **Display** section: the default view, the view switcher, the rows shown of the view on the card (all or chosen), and how the card looks (column names hidden, title color; on a generic table also compact, and column widths).

- **Views** lists them: drag to reorder, remove, **Add view**. The first view added keeps the plain view the card had. Opening a view shows it on the card, with its label, its mode, and the parameters of that mode. Changing the mode drops what the view had chosen, since another mode chooses among other rows.
- **Choose rows and row breaks** opens the list of what the view on the card shows: drag to reorder, drag a row left out up to show it, remove to leave one out, **Insert row break** to add one, click a row break for its text, the rows behind it (their ids, separated by commas) and whether it is open at first.
- **On the card**, in a plain view, a row has **Shown** and **Insert row break below** in its tab, and the same on its toolbar. With a chosen list the order on the card is set in that list, so the row's own move buttons are off. A view of another mode only reads: its data is edited in the tabs of the card, and a Dataverse card's records in the source.

Each change is one undo step, and which view the editor shows is not a step and is not saved. The apis are `nodeViewListSet`, `nodeRowDisplaySet`, `nodeRowBreakInsert` and `nodeRowBreakFoldSet`. In the editor a click on a row break edits it, and its button opens and closes it.

- **A row of its own for what is left out** (`isEllipsis: true` in the data) is still there for a table that never had those rows, or when a line must leave from that place: batches of a split table, for example. It draws `⋮`.

For generated diagrams, `cardRowDisplayKeepBuild(rowIdList, keepIdList, { textOf })` in `TableCardData.js` builds the list from the rows to keep, with a row break for each run left out.

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

These are the rules of a diagram while the document is read (and of a block in edit mode whose session is not open). They are the general principle of every block-like component with a canvas ([Block-like components](../../../../main/doc_page_impl_mdx_comp_block.md)):

- **The reader moves the camera, never the content.** Dragging on empty canvas or on the title line of a card pans; the mouse wheel zooms around the pointer; the controls at the bottom left zoom and fit. A node cannot be dragged: its position is part of the document, and the document is changed only in edit mode.
- **Text stays text.** Dragging across the rows of a card selects their text, as in any paragraph; a column description is the tooltip of its name.
- **The wheel over a card is the wheel over the canvas.** Scrolling with the pointer on a card zooms the diagram exactly as scrolling on empty canvas does, and never scrolls the page behind it. The page scrolls only when the pointer is outside the diagram.
- **Nothing the reader does is written.** Pan, zoom, and the camera are remembered for the block while the page is open and are dropped with it.
- **The popup.** The button at the top right of the block opens the diagram (or the card) in the block popup, where it fills the dialog, can be maximized to the window, and switches between **View** and **Edit** in the dialog's header. The canvas keeps its camera and the editor its draft across opening, maximizing and closing.

<!--renderComp=Anchor,id=diagram-er-edit-->
## Visual Editing

In edit mode, both components open in the **Visual** mode from the block's Edit button, from the mode menu, or from **Edit** in the popup; a click on the canvas pans or focuses, it never enters the editor. The built-in **Source** mode stays available from the mode menu. Every change is a draft of the same YAML, with its comments kept; Save or a click outside the block writes it once, and Cancel discards it.

### Entering and leaving

- **Entering moves nothing.** The block keeps its height, its place, and the camera of the canvas; the page does not scroll. The only things that appear are the floating bar above the block and, later, the edit card beside what is focused.
- **The floating bar** shows whether there are unsaved changes, **Undo** / **Redo**, **+** (add a node or a connection at the center of the canvas), **Save to** for an asset-backed block, and **Save** / **Cancel**. Ctrl/⌘ + Enter saves.
- **Every change can be taken back.** Undo (Ctrl/⌘ + Z, or the bar) puts the draft back one step, Redo (Ctrl/⌘ + Shift + Z, Ctrl/⌘ + Y, or the bar) repeats it. A step is one thing done: a row inserted, a line drawn, a node dropped, a value picked; typing in one cell is one step, however many keys, and a cell restored with Escape leaves no step. What is focused is not a step: undo never moves the selection, and after an undo the edit card shows the nearest thing that still exists. While a cell is being typed, Ctrl/⌘ + Z takes back the typing in that cell, as in any text field; end the cell (Enter or a click elsewhere) to undo the diagram. The steps belong to this edit session: they begin when the block enters edit mode, end with Save or Cancel, and are never written into the document or the asset item; a new session starts with none.
- **Escape steps out one level at a time:** the cell being typed (restoring it), then the create panel, then one segment of the edit card's path (a cell to its column, a column to the list of columns, the list to the card, the card to nothing). It never ends the session, so a stray key cannot discard the draft.
- **A failed change is refused with its reason** in the edit card (or the bar), and the draft stays as it was: a handle that takes one connection and has it, both ends of a line on the same handle, a locked node without a position.

### Everything answers a click

In edit mode, every part of a card or a line answers a click with a visible focus, whether or not it can be changed: a reader who clicks and sees nothing happen assumes the editor is broken. The focus is drawn the same way everywhere (a tinted row with a bar at its left, a ringed handle, a haloed line), and the edit card follows it.

| A click on | Focuses | The edit card opens |
| --- | --- | --- |
| the title line of a card, or an operator | the card | the card's tab (Table, Flow step, Business rule ...) |
| the description line, or a head field of a resource card (Step, Table, Scope ...) | that property of the card | the card's tab; the property is edited in place or there |
| a row of a card (a Dataverse column, an option, a property, a row) | the row, with its toolbar | the row's detail |
| a cell | the cell, and starts typing in it (Enter or a click elsewhere ends it, Escape restores it) | the cell, once typing ends |
| a field header (Key, Column, Logical name, Type; the authored columns of a generic table) | the field, with its toolbar | the field's detail, which says when the fields of the card are fixed |
| a handle | the next line attached to the handle, then the list of the card's lines | the line's detail, then the list |
| a line, its label, or the ring of a free end | the line by itself | the line's detail |
| empty canvas | nothing | closes |

A button that the card does not support is greyed out, never missing, and its tooltip says why (*The fields of a Dataverse table card are fixed: Key, Column, Logical name and Type.*, *Already first.*, *A standalone card has no lines.*).

### The edit card and its path

The edit card stands **beside the principal** of what is focused: the whole card (not the row or the cell within it), or the line. Its top edge is computed from the principal alone, so it does not move while the author works in it: the card grows and shrinks downward as its content changes (a handle switched on adds a row of settings; a tab changes the view), and what does not fit scrolls inside it. Nothing the author does in the card moves the card.

Inside, from top to bottom: the name of the principal, the **tabs**, the **path bar**, and the view of the active tab. The path is the one state the card is drawn from:

```text
Customer                            the card: name, description, title handles, position
Customer › Columns                  the list of its columns (the rows of the card)
Customer › Columns › Name           one column: values, handles, insert / move / remove
Customer › Columns › Name › Type    one cell: its value
Customer › Fields                   the fields of the card (Key, Column, Logical name, Type)
Customer › Fields › Type            one field
Customer › Lines                    the lines at the card's handles
Customer › Lines › places           one of them
places                              a line selected by itself
```

The words are the card's own: the rows of a Dataverse table are its *Columns*, of a choice its *Options*, of a flow step or a business rule its *Properties*, of a generic table its *Rows*; the fields of a generic table are its *Columns*, of every other card its *Fields*.

- **What is shown is read off the path.** The last segment names the view: a collection (*Columns*, *Fields*, *Lines*) is a **list**, one item is its **detail**, the card alone is the card's tab. The tab that is lit is the collection the path is in; the canvas highlights the item the path ends in (and only that: a highlight can never be stale, since there is no second copy of the focus). The tabs lead into the path: **Columns** goes to the focused column when there is one, else to the list; **Cell** is enabled only when the path holds a column and a field; **Lines** goes to the focused line or the list. A tab without a place is greyed out with the reason.
- **The path changes with what the author does.** A click on the canvas focuses that thing (the table above). A click on a **segment of the path bar** cuts the path there: *Customer › Columns* from the cell path shows the list. A click on an **item of a list** opens its detail and focuses it on the card. **Escape** drops the last segment.
- **The path changes with the data.** Inserting a column, a field, a node or a line focuses the new thing. Removing one goes to its list (*Customer › Columns* after a column is removed, *Customer › Lines* after a line is removed from the card). A subject that disappears for another reason (a handle removed, and with it the line selected through the card) sends the path to the nearest place that still exists: its list, the card, or nothing when the card itself is gone. Nothing in the path is ever left pointing at something gone.
- **One place, several spellings.** A column may be named by its id, by its index, or by its name: all route to the same display, and the path the editor keeps is the canonical one. This is what a host hooks into to redirect a path (a rule that answers *go there instead* for a display), for views the editor does not have yet.

### Cards: cells, rows and columns

- **Click a cell to type in it.** Enter or a click elsewhere ends the cell, Escape restores it. Key and Type of a Dataverse column open a menu; Type has a search over the Dataverse column types. The card does not change size when a cell starts or ends editing.
- The **Cell** detail offers the same value as a field, so a value can also be typed in the edit card.
- **A focused row shows its toolbar** at the left of the card: a grip to drag the row to another place (the drop place is drawn as a line while dragging), insert above, insert below, move up, move down, remove. The **list of the rows** in the edit card offers the same with the grip and the remove button before every row, and **Add** at its end; the row's detail has the same actions as buttons. A new row starts with example values and is focused at once. Removing a row removes its handles; connections on them are detached (their ends stay where the handles were).
- **A focused field shows its toolbar** above its header: insert left, insert right, move left, move right, remove, and a grip. For a generic `table` the fields are authored and all of these work (a table keeps at least one column; the values of a removed column are dropped from every row). For a Dataverse card and a resource card the fields are fixed: the field is still focused and listed, its buttons are greyed out, and their tooltip and the field's detail say so.
- The title line edits the name and the subtitle in place; the description and the head fields of a resource card are edited in place too, and in the card's tab.

### Handles

- **Adding a handle:** point at a row and press the **+** that appears at its left or right edge, or switch the left / right handle on in the row's detail. A new handle takes connections in both directions and any number of them.
- **Title-line handles** are off by default. They exist for a choice card and a resource card, and for a generic table whose **Title handles** setting is on; a Dataverse table has none.
- **Removing a handle** (the row's detail, or Title handles) that connections use moves those connections to the handle on the other side of the same row when there is one. Otherwise the connections are detached: each end becomes a free end a little away from where the handle was. Nothing is deleted silently.
- **Attach policy:** a handle accepts many lines (the default) or one (**Right accepts: One line** in the row's detail). A handle that takes one line and has it refuses another end dropped on it, and a drag from it moves its line instead of starting a new one.
- A handle with connections is drawn filled; the handle of the focused connection is ringed. A handle does not know which end of a line it holds: the direction of a line is shown by its arrows.

### Connections

- **Drawing a line:** drag from a handle. A dashed line follows the pointer, green over a handle that will take it and red over one that will not. Releasing on a valid handle (of any card, the same one included, but never the same handle) creates the connection and focuses it; releasing anywhere else creates nothing.
- **Direction:** the new line runs out of the handle that can send and into the handle that can receive, whichever end the drag started from; a handle declared `both` does either.
- **Dragging from a handle whose connection is focused** (after a click on the handle chose it) does not start a new line: it detaches that end of the focused line and carries it with the pointer, drawn from the line's other end. The same happens when dragging from a handle that takes one line and has it.
- **Moving an end:** drag the end of a line where it meets a handle, or drag the ring of a free end. Dropping it on a handle that takes it attaches it there; dropping it anywhere else leaves it as a free end at that point. A free end is part of the saved data (`position`), so it is still there after a reload.
- **Line settings** (the line's detail): label, line type (right-angled, right-angled with sharp corners, curve, straight, polyline), color, thickness, dash (solid, dashed, dotted), the arrow at each end, animation, its route, and **Remove line**. The two ends are listed as read-only text. The **Lines** list of a card names every line at its handles, with its ends, and removes one with the button before it.
- **Shaping a line:** with the line focused, double-click it to add an anchor, drag the anchor to move it, and drag a handle to change how the line runs there. Delete removes the selected anchor. What each does, in right-angled lines and curves, is in [Connection Lines](../../doc/card-diagram-connection-line.md#in-the-editor).
- The edit card is **hidden while something is being typed or dragged**: while a cell is being edited, while a node, a line end or a new line is being dragged, and while the create panel is open. It comes back, at the same path, when the gesture ends.

### Creating nodes and connections

- **Double-click empty canvas**, or press **+** in the floating bar, to open the create panel at that point: a search field over what the node registry of the component can add, and a connection with two free ends. In `DiagramER` these are a generic table, an operator, a Dataverse table, a Dataverse choice, a Power Automate step and a business rule; in `CardDiagram`, a generic table and an operator. Type to filter, ArrowUp / ArrowDown to move, Enter to take the highlighted entry, Escape or a click outside to close.
- The new node appears at the panel's position, with an explicit position, and is focused with its edit card open. A new connection appears with both ends free and focused; drag its ends onto handles.
- **Removing a node** (the card's tab) keeps the connections on it: their ends become free ends where the handles were. Remove the lines from their detail, or from the **Lines** list of a card, when they are not wanted.

### Arranging

**Arrange** in the edit panel lists the arrangers of ER diagrams: *Route the lines* keeps the cards where they are, and *Place the cards in columns and route the lines* also moves them. Both remove the anchors of the right-angled lines and create new ones, and either is one undo step. The rules are in [Arrangers](../../doc/card-diagram-arrange.md).

### Positions

- Dragging a card in edit mode moves it, and the position is written to the draft when the card has an explicit position. The card's tab has **Remember**, which keeps the current canvas position as the node's `position` (off: the node returns to the automatic layout); **Locked** keeps the position and prevents dragging in either mode. A locked node cannot be dragged, in reading or in editing.
- The camera is kept when the block saves.

### Data in the asset service layer

The examples above are inline: a save rewrites the block. The two blocks below are references into the [asset service layer](~example/asset-store.md). Their Visual mode edits the referenced object, at its head version and while it is not locked, and a save writes a version of the object without touching the document. **Save to → Inline YAML** writes the draft into the block in place of the reference instead, and leaves the object as it was.

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
