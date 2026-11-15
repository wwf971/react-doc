---
title: AWS Diagrams
description: DiagramAws, DiagramAwsSwitch, DiagramAwsArchitecture and DiagramAwsResource draw the resources of a system on AWS as cards or simple marks, and the lines between them
language: en
---

`DiagramAws` is a [card diagram](../power-platform/comp-diagram-er.md) whose cards are the resources of AWS: the same `version: 1` graph of **nodes**, **handles** and **connections**, the same canvas, the same Visual and Source modes, the generic cards of the framework beside them (a page, a script, a note). `DiagramAwsSwitch` holds [many scenes in one viewport](../card-diagram-switch/comp-card-diagram-switch.md), written by hand; `DiagramAwsArchitecture` draws the same kind of scenes from a description of a system, from its groups down to the detail of one resource; `DiagramAwsResource` is one card outside a canvas. They are design documents: nothing is read from AWS or deployed. The design of the series is in [aws.md](../../doc/aws.md).

## Which card for which resource

| Resource | `renderer.type` | Data, besides `name` and `description` | A line attaches to |
| --- | --- | --- | --- |
| an http api of API Gateway | `aws-http-api` | `authorizer`, `cors`, `throttle`; `properties`: its route groups | the card (`body`), its title (`header`), a property (`property/{id}`), its footer |
| a function of Lambda | `aws-lambda` | `runtime`, `memory`, `timeout`, `role`; `properties`: its environment, by name | the same |
| a bucket of S3 | `aws-s3-bucket` | `access`, `versioning`; `properties`: key prefixes, lifecycle rules | the same |
| a user pool of Cognito | `aws-cognito-user-pool` | `mfa`; `properties`: app clients, groups | the same |
| a role of IAM | `aws-iam-role` | `assumedBy`; `properties`: what it allows, by service | the same |
| a table of DynamoDB, or a kind of its rows | `aws-dynamodb-table` | `nameLogical` (the table), `pk`, `sk`; `attributes`: `{ id, key: PK \| SK \| GSI PK \| GSI SK, name, type, holds }` | the card, its title, an attribute (`attribute/{id}`, left or right), its footer |
| the routes of one group | `aws-route-group` | `nameLogical`; `routes`: `{ id, method, path, auth: token \| none }` | the card, its title, a route (`route/{id}`, left or right), its footer |
| a log group of CloudWatch | `aws-log-group` | `retention` | the card |

Each card is in the accent of its family (network, compute, database, storage, security, management). Write names as the deployment scripts write them, `{prefix}--{name}`, never the prefix of one deployment.

## A system, as cards

A system is read downward, in the order a request passes it: a new card from the panel (double-click the canvas) has its in handle on top and its out handle at the bottom. A line leaving the bottom of a card leaves its **footer**, the strip under its rows, so it is never read as leaving the last row ([the footer of a card](../../doc/card-diagram-usage.md#lines-out-of-the-bottom-of-a-card-the-footer)). This is the starting text of a new block, laid out by **Layers, top to bottom**:

<!--renderComp=DiagramAws,title=A small system-->
```yaml
version: 1
nodes:
  - id: page
    renderer: { type: card-note }
    size: { width: 200, height: auto }
    data: { title: The page, text: a browser, tone: slate }
    handles: [ { id: out, direction: out, anchor: { target: body, side: bottom } } ]
    position: { x: 228, y: 0 }
  - id: api
    renderer: { type: aws-http-api }
    size: { width: 300, height: auto }
    data:
      name: "{prefix}--api"
      authorizer: "jwt: the user pool"
      cors: any origin
      throttle: 20 / s
      properties: [ { id: items, name: items, value: "create, get, update" } ]
    handles:
      - { id: in, direction: in, anchor: { target: body, side: top } }
      - { id: out, direction: out, anchor: { target: body, side: bottom } }
    position: { x: 178, y: 102 }
  - id: function
    renderer: { type: aws-lambda }
    size: { width: 300, height: auto }
    data:
      name: "{prefix}--api"
      runtime: python3.12
      memory: 512 MB
      timeout: 29 s
      role: "{prefix}--api-role"
      properties: [ { id: table, name: TABLE_DATA, value: the table } ]
    handles:
      - { id: in, direction: in, anchor: { target: body, side: top } }
      - { id: rows, direction: out, anchor: { target: body, side: bottom, offset: 0.333 } }
      - { id: objects, direction: out, anchor: { target: body, side: bottom, offset: 0.667 } }
    position: { x: 178, y: 396 }
  - id: table
    renderer: { type: aws-dynamodb-table }
    size: { width: 300, height: auto }
    data:
      name: items
      nameLogical: "{prefix}--data"
      pk: pk (S)
      sk: sk (S)
      description: billed per request
      attributes:
        - { id: pk, key: PK, name: pk, type: S, holds: the owner }
        - { id: sk, key: SK, name: sk, type: S, holds: the item }
    handles: [ { id: in, direction: in, anchor: { target: body, side: top } } ]
    position: { x: 0, y: 722 }
  - id: bucket
    renderer: { type: aws-s3-bucket }
    size: { width: 300, height: auto }
    data:
      name: "{prefix}--data"
      access: private
      versioning: off
      properties: [ { id: data, name: data/, value: large bytes } ]
    handles: [ { id: in, direction: in, anchor: { target: body, side: top } } ]
    position: { x: 356, y: 722 }
connections:
  - id: request
    source: { nodeId: page, handleId: out }
    target: { nodeId: api, handleId: in }
    label: { text: https + token, position: 0.5 }
    route: { anchorList: [ { id: a1, along: 1, x: 0, y: -32 } ] }
  - id: call
    source: { nodeId: api, handleId: out }
    target: { nodeId: function, handleId: in }
    label: { text: invoke, position: 0.5 }
    route: { anchorList: [ { id: a1, along: 1, x: 0, y: -32 } ] }
  - id: rows
    source: { nodeId: function, handleId: rows }
    target: { nodeId: table, handleId: in }
    label: { text: rows, position: 0.5 }
    route: { anchorList: [ { id: a1, along: 1, x: 0, y: -42.7 } ] }
  - id: objects
    source: { nodeId: function, handleId: objects }
    target: { nodeId: bucket, handleId: in }
    label: { text: objects, position: 0.5 }
    route: { anchorList: [ { id: a1, along: 1, x: 0, y: -21.3 } ] }
viewport:
  size: { height: 720 }
```

In the editor, **Arrange** (the bar's lines button) offers the arrangers of the series, at any time, each one step of the history: **Layers, top to bottom** places the cards in layers by their lines and routes every line; **Route the lines, cards in rows** keeps the cards where they are and only routes. Applied to a diagram drawn by hand, the result is the author's data, to be adjusted after. A scene generated from data applies the same arranger in code every time it is built ([card-diagram-arrange.md](../../doc/card-diagram-arrange.md#the-layer-arrangers)).

## Detailed and simple

The same system at a glance: every card a **simple mark**, a tile with the icon of its service, its name and its service under it. The icons are the official ones of AWS where they were fetched on the machine ([The official icons](../../doc/aws.md#the-official-icons)), else the icons of the page in the accent of the family. One line of the data does it, `defaults: { node: { display: simple } }`; `display` on a node says it for that node alone. In the editor, **Drawn as** in the tab of a card switches one, the shapes button of the bar every one. The handles and the lines stay; a line leaving downward starts under the words of the mark ([When a node changes its look](../../doc/card-diagram-usage.md#when-a-node-changes-its-look-its-lines-stay-attached)). Marks are smaller than cards, so this one was laid out again by the arranger, from the same data without the widths of the cards:

<!--renderComp=DiagramAws,title=The same system at a glance-->
```yaml
version: 1
viewport:
  size: { height: 560 }
nodes:
  - id: page
    renderer: { type: card-note }
    data: { title: The page, text: a browser, tone: slate }
    handles: [ { id: out, direction: out, anchor: { target: body, side: bottom } } ]
    position: { x: 75, y: 0 }
  - id: api
    renderer: { type: aws-http-api }
    data:
      name: "{prefix}--api"
      authorizer: "jwt: the user pool"
      cors: any origin
      throttle: 20 / s
      properties: [ { id: items, name: items, value: "create, get, update" } ]
    handles:
      - { id: in, direction: in, anchor: { target: body, side: top } }
      - { id: out, direction: out, anchor: { target: body, side: bottom } }
    position: { x: 94, y: 102 }
  - id: function
    renderer: { type: aws-lambda }
    data:
      name: "{prefix}--api"
      runtime: python3.12
      memory: 512 MB
      timeout: 29 s
      role: "{prefix}--api-role"
      properties: [ { id: table, name: TABLE_DATA, value: the table } ]
    handles:
      - { id: in, direction: in, anchor: { target: body, side: top } }
      - { id: rows, direction: out, anchor: { target: body, side: bottom, offset: 0.333 } }
      - { id: objects, direction: out, anchor: { target: body, side: bottom, offset: 0.667 } }
    position: { x: 94, y: 264 }
  - id: table
    renderer: { type: aws-dynamodb-table }
    data:
      name: items
      nameLogical: "{prefix}--data"
      pk: pk (S)
      sk: sk (S)
      description: billed per request
      attributes:
        - { id: pk, key: PK, name: pk, type: S, holds: the owner }
        - { id: sk, key: SK, name: sk, type: S, holds: the item }
    handles: [ { id: in, direction: in, anchor: { target: body, side: top } } ]
    position: { x: 0, y: 426 }
  - id: bucket
    renderer: { type: aws-s3-bucket }
    data:
      name: "{prefix}--data"
      access: private
      versioning: off
      properties: [ { id: data, name: data/, value: large bytes } ]
    handles: [ { id: in, direction: in, anchor: { target: body, side: top } } ]
    position: { x: 188, y: 426 }
connections:
  - id: request
    source: { nodeId: page, handleId: out }
    target: { nodeId: api, handleId: in }
    label: { text: https + token, position: 0.5 }
    route: { anchorList: [ { id: a1, along: 1, x: 0, y: -32 } ] }
  - id: call
    source: { nodeId: api, handleId: out }
    target: { nodeId: function, handleId: in }
    label: { text: invoke, position: 0.5 }
    route: { anchorList: [ { id: a1, along: 1, x: 0, y: -32 } ] }
  - id: rows
    source: { nodeId: function, handleId: rows }
    target: { nodeId: table, handleId: in }
    label: { text: rows, position: 0.5 }
    route: { anchorList: [ { id: a1, along: 1, x: 0, y: -42.7 } ] }
  - id: objects
    source: { nodeId: function, handleId: objects }
    target: { nodeId: bucket, handleId: in }
    label: { text: objects, position: 0.5 }
    route: { anchorList: [ { id: a1, along: 1, x: 0, y: -21.3 } ] }
defaults:
  node: { display: simple }
```

## Rows: a table, its kinds of rows, the routes of a group

A DynamoDB table with a single table design is drawn as the kinds of its rows, one card each, with the patterns of its keys; a line leaves the attribute that names another row. A group of routes marks the one answered without a token:

<!--renderComp=DiagramAws,title=Rows and routes-->
```yaml
version: 1
nodes:
  - id: space
    renderer: { type: aws-dynamodb-table }
    size: { width: 340, height: auto }
    data:
      name: space
      nameLogical: a row of {prefix}--data
      pk: u#{userId}
      sk: s#{key}
      attributes:
        - { id: spaceId, name: spaceId, type: S, holds: the start of every key it holds }
        - { id: key, name: key, type: S, holds: the key a storage point names }
    handles: [ { id: spaceId, direction: out, anchor: { target: attribute/spaceId, side: right } } ]
    position: { x: 0, y: 0 }
  - id: partition
    renderer: { type: aws-dynamodb-table }
    size: { width: 340, height: auto }
    data:
      name: partition
      nameLogical: a row of {prefix}--data
      pk: s#{spaceId}
      sk: p#{partitionId}
      attributes:
        - { id: revision, name: revision, type: N, holds: one more with every write }
        - { id: ownerRef, name: ownerRef, type: S, holds: "frontend:{id}" }
    handles: [ { id: in, direction: in, anchor: { target: body, side: left } } ]
    position: { x: 480, y: 30 }
  - id: routes
    renderer: { type: aws-route-group }
    position: { x: 0, y: 290 }
    size: { width: 340, height: auto }
    data:
      name: The service and the account
      nameLogical: 2 routes
      routes:
        - { id: status, method: GET, path: /status, auth: none }
        - { id: account, method: GET, path: /account, auth: token }
    handles: []
connections:
  - id: space-partition
    source: { nodeId: space, handleId: spaceId }
    target: { nodeId: partition, handleId: in }
    label: { text: "s#{spaceId}", position: 0.65 }
    route: { anchorList: [ { id: a1, along: 1, x: -70, y: 0 } ] }
viewport:
  size: { height: 500 }
```

## Two levels in one viewport

`DiagramAwsSwitch` takes a `sceneList` ([Card Diagram Scenes](../card-diagram-switch/comp-card-diagram-switch.md)). Here one scene has two views with the same ids: the overview, drawn simple, and the resources as cards. Switch the view after the path: each card moves into its mark and back.

<!--renderComp=DiagramAwsSwitch,height=560,title=A system in two views-->
```yaml
version: 1
height: 620
sceneList:
  - path: /system
    label: System
    title: A small system on AWS
    viewList:
      - id: overview
        label: Overview
        diagram:
          version: 1
          nodes:
            - id: page
              renderer: { type: card-note }
              data: { title: The page, text: a browser, tone: slate }
              handles: [ { id: out, direction: out, anchor: { target: body, side: bottom } } ]
              position: { x: 75, y: 0 }
            - id: api
              renderer: { type: aws-http-api }
              data:
                name: "{prefix}--api"
                authorizer: "jwt: the user pool"
                cors: any origin
                throttle: 20 / s
                properties: [ { id: items, name: items, value: "create, get, update" } ]
              handles:
                - { id: in, direction: in, anchor: { target: body, side: top } }
                - { id: out, direction: out, anchor: { target: body, side: bottom } }
              position: { x: 94, y: 102 }
            - id: function
              renderer: { type: aws-lambda }
              data:
                name: "{prefix}--api"
                runtime: python3.12
                memory: 512 MB
                timeout: 29 s
                role: "{prefix}--api-role"
                properties: [ { id: table, name: TABLE_DATA, value: the table } ]
              handles:
                - { id: in, direction: in, anchor: { target: body, side: top } }
                - { id: rows, direction: out, anchor: { target: body, side: bottom, offset: 0.333 } }
                - { id: objects, direction: out, anchor: { target: body, side: bottom, offset: 0.667 } }
              position: { x: 94, y: 264 }
            - id: table
              renderer: { type: aws-dynamodb-table }
              data:
                name: items
                nameLogical: "{prefix}--data"
                pk: pk (S)
                sk: sk (S)
                description: billed per request
                attributes:
                  - { id: pk, key: PK, name: pk, type: S, holds: the owner }
                  - { id: sk, key: SK, name: sk, type: S, holds: the item }
              handles: [ { id: in, direction: in, anchor: { target: body, side: top } } ]
              position: { x: 0, y: 426 }
            - id: bucket
              renderer: { type: aws-s3-bucket }
              data:
                name: "{prefix}--data"
                access: private
                versioning: off
                properties: [ { id: data, name: data/, value: large bytes } ]
              handles: [ { id: in, direction: in, anchor: { target: body, side: top } } ]
              position: { x: 188, y: 426 }
          connections:
            - id: request
              source: { nodeId: page, handleId: out }
              target: { nodeId: api, handleId: in }
              label: { text: https + token, position: 0.5 }
              route: { anchorList: [ { id: a1, along: 1, x: 0, y: -32 } ] }
            - id: call
              source: { nodeId: api, handleId: out }
              target: { nodeId: function, handleId: in }
              label: { text: invoke, position: 0.5 }
              route: { anchorList: [ { id: a1, along: 1, x: 0, y: -32 } ] }
            - id: rows
              source: { nodeId: function, handleId: rows }
              target: { nodeId: table, handleId: in }
              label: { text: rows, position: 0.5 }
              route: { anchorList: [ { id: a1, along: 1, x: 0, y: -42.7 } ] }
            - id: objects
              source: { nodeId: function, handleId: objects }
              target: { nodeId: bucket, handleId: in }
              label: { text: objects, position: 0.5 }
              route: { anchorList: [ { id: a1, along: 1, x: 0, y: -21.3 } ] }
          defaults: { node: { display: simple } }
      - id: resources
        label: Resources
        diagram:
          version: 1
          nodes:
            - id: page
              renderer: { type: card-note }
              size: { width: 200, height: auto }
              data: { title: The page, text: a browser, tone: slate }
              handles: [ { id: out, direction: out, anchor: { target: body, side: bottom } } ]
              position: { x: 228, y: 0 }
            - id: api
              renderer: { type: aws-http-api }
              size: { width: 300, height: auto }
              data:
                name: "{prefix}--api"
                authorizer: "jwt: the user pool"
                cors: any origin
                throttle: 20 / s
                properties: [ { id: items, name: items, value: "create, get, update" } ]
              handles:
                - { id: in, direction: in, anchor: { target: body, side: top } }
                - { id: out, direction: out, anchor: { target: body, side: bottom } }
              position: { x: 178, y: 102 }
            - id: function
              renderer: { type: aws-lambda }
              size: { width: 300, height: auto }
              data:
                name: "{prefix}--api"
                runtime: python3.12
                memory: 512 MB
                timeout: 29 s
                role: "{prefix}--api-role"
                properties: [ { id: table, name: TABLE_DATA, value: the table } ]
              handles:
                - { id: in, direction: in, anchor: { target: body, side: top } }
                - { id: rows, direction: out, anchor: { target: body, side: bottom, offset: 0.333 } }
                - { id: objects, direction: out, anchor: { target: body, side: bottom, offset: 0.667 } }
              position: { x: 178, y: 396 }
            - id: table
              renderer: { type: aws-dynamodb-table }
              size: { width: 300, height: auto }
              data:
                name: items
                nameLogical: "{prefix}--data"
                pk: pk (S)
                sk: sk (S)
                description: billed per request
                attributes:
                  - { id: pk, key: PK, name: pk, type: S, holds: the owner }
                  - { id: sk, key: SK, name: sk, type: S, holds: the item }
              handles: [ { id: in, direction: in, anchor: { target: body, side: top } } ]
              position: { x: 0, y: 722 }
            - id: bucket
              renderer: { type: aws-s3-bucket }
              size: { width: 300, height: auto }
              data:
                name: "{prefix}--data"
                access: private
                versioning: off
                properties: [ { id: data, name: data/, value: large bytes } ]
              handles: [ { id: in, direction: in, anchor: { target: body, side: top } } ]
              position: { x: 356, y: 722 }
          connections:
            - id: request
              source: { nodeId: page, handleId: out }
              target: { nodeId: api, handleId: in }
              label: { text: https + token, position: 0.5 }
              route: { anchorList: [ { id: a1, along: 1, x: 0, y: -32 } ] }
            - id: call
              source: { nodeId: api, handleId: out }
              target: { nodeId: function, handleId: in }
              label: { text: invoke, position: 0.5 }
              route: { anchorList: [ { id: a1, along: 1, x: 0, y: -32 } ] }
            - id: rows
              source: { nodeId: function, handleId: rows }
              target: { nodeId: table, handleId: in }
              label: { text: rows, position: 0.5 }
              route: { anchorList: [ { id: a1, along: 1, x: 0, y: -42.7 } ] }
            - id: objects
              source: { nodeId: function, handleId: objects }
              target: { nodeId: bucket, handleId: in }
              label: { text: objects, position: 0.5 }
              route: { anchorList: [ { id: a1, along: 1, x: 0, y: -21.3 } ] }
    viewDefault: overview
```

## A system of groups, from a description

A larger system is read in its groups first: a frame per group (a service, a module of the system), each showing what it holds as simple marks, the lines between the frames being what passes between the groups. A click on a frame zooms into it: the group's resources as cards, the menu after the path switching to its overview or to one of its flows, the steps of one request on the same cards. A card with more inside (an api's routes, a table's kinds of rows) opens a scene of its own, and a mark of another group opens that group.

`DiagramAwsArchitecture` draws all of it from a **description** of the system, not from diagrams: every scene is generated from it and laid out by the layer arrangers, with the same ids everywhere, so nothing is placed by hand and a change of the system is a change of a few lines of data. A deployment script can write the description from the plan it makes the resources from, as the storage service of `aws-utils` does ([Storage Service Architecture](~aws-utils:aws-utils/doc/storage-architecture.md)).

```text
version: 1, title?, height?, depthMax?
clientList   [{ id, title, text?, tone? }]                 outside every group: a page, a console, a script
groupList    [{ id, label, project?, tone?, icon?,
               resourceList: [{ id, kind, name, data?, isEdge?, detail? }],
               relationList: [{ from, to, label? }],      an end: a resource of the group, group.resource, a client
               flowList: [{ id, label, title?, stepList: [{ from, to, label? }], note? }] }]
detail       { routeGroupList }  |  { rowKindList, linkList? }  |  { partList, linkList? }
```

<!--renderComp=DiagramAwsArchitecture,title=A small shop-->
```yaml
version: 1
title: A small shop on AWS
clientList:
  - { id: browser, title: The shop page, text: a browser, tone: slate }
  - { id: staff, title: The staff console, text: "a browser, signed in as staff", tone: slate }
groupList:
  - id: catalog
    label: Catalog
    project: catalog/
    tone: blue
    icon: table
    resourceList:
      - id: api
        kind: aws-http-api
        name: "{prefix}--catalog-api"
        data: { authorizer: none for reading, cors: any origin, throttle: 100 / s }
        detail:
          routeGroupList:
            - id: read
              name: Reading
              routes:
                - { method: GET, path: /product/list, auth: none }
                - { method: GET, path: /product/get, auth: none }
            - id: write
              name: Writing
              routes: [ { method: POST, path: /product/set }, { method: POST, path: /product/remove } ]
      - id: function
        kind: aws-lambda
        name: "{prefix}--catalog"
        data: { runtime: python3.12, memory: 256 MB, timeout: 10 s }
      - id: table
        kind: aws-dynamodb-table
        name: products
        data:
          nameLogical: "{prefix}--catalog"
          pk: p#{productId}
          sk: product
          attributes: [ { id: price, name: price, type: N, holds: in cents } ]
      - id: images
        kind: aws-s3-bucket
        name: "{prefix}--images"
        data: { access: public read, versioning: off }
    relationList:
      - { from: browser, to: api, label: products }
      - { from: staff, to: api, label: edit products }
      - { from: api, to: function }
      - { from: function, to: table, label: rows }
      - { from: browser, to: images, label: images }
  - id: orders
    label: Orders
    project: orders/
    tone: amber
    icon: list-checks
    resourceList:
      - id: api
        kind: aws-http-api
        name: "{prefix}--order-api"
        data: { authorizer: "jwt: the user pool", cors: any origin, throttle: 20 / s }
      - id: function
        kind: aws-lambda
        name: "{prefix}--order"
        data: { runtime: python3.12, memory: 512 MB, timeout: 29 s, role: "{prefix}--order-role" }
      - id: table
        kind: aws-dynamodb-table
        name: orders
        data:
          nameLogical: "{prefix}--order"
          pk: u#{userId}
          sk: o#{orderId}
          attributes: [ { id: status, name: status, type: S, holds: "placed, paid, sent" } ]
        detail:
          rowKindList:
            - id: order
              name: order
              pk: u#{userId}
              sk: o#{orderId}
              column: 0
              attributes:
                - { name: orderId, type: S, holds: its id }
                - { name: status, type: S, holds: "placed, paid, sent" }
            - id: line
              name: line
              pk: o#{orderId}
              sk: l#{productId}
              column: 1
              attributes: [ { name: productId, type: S, holds: a product of the catalog }, { name: count, type: N } ]
          linkList: [ { from: order.orderId, to: line, label: "o#{orderId}" } ]
      - id: logs
        kind: aws-log-group
        name: /aws/lambda/{prefix}--order
        data: { retention: 30 days }
    relationList:
      - { from: browser, to: api, label: place an order }
      - { from: api, to: auth.pool, label: checks the token }
      - { from: api, to: function }
      - { from: function, to: table, label: rows }
      - { from: function, to: catalog.table, label: prices }
      - { from: function, to: logs }
    flowList:
      - id: place
        label: Placing an order
        stepList:
          - { from: browser, to: api, label: POST /order/place }
          - { from: api, to: auth.pool, label: the token }
          - { from: api, to: function, label: the request }
          - { from: function, to: catalog.table, label: the prices }
          - { from: function, to: table, label: the order and its lines }
        note: { title: One write, text: the order and its lines in one transaction }
  - id: auth
    label: Sign-in
    project: auth/
    tone: red
    icon: shield
    resourceList:
      - id: pool
        kind: aws-cognito-user-pool
        name: "{prefix}--users"
        data: { mfa: "optional: TOTP" }
      - id: staff-group
        kind: aws-iam-role
        name: "{prefix}--staff"
        data: { assumedBy: the staff group of the pool }
    relationList:
      - { from: browser, to: pool, label: sign in }
      - { from: staff, to: pool, label: sign in }
      - { from: pool, to: staff-group, label: staff }
height: 640
```

## One card outside a canvas

<!--renderComp=DiagramAwsResource,title=One function-->
```yaml
version: 1
node:
  id: function
  renderer: { type: aws-lambda }
  size: { width: 300, height: auto }
  data:
    name: "{prefix}--api"
    runtime: python3.12
    memory: 512 MB
    timeout: 29 s
    role: "{prefix}--api-role"
    properties: [ { id: table, name: TABLE_DATA, value: the table } ]
  handles: []
```
