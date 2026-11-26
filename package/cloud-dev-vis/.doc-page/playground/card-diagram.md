---
title: Card diagram playground
description: Everything of the card diagram framework in one place, to try out and to break.
---

Press **Edit** on a diagram and change whatever you like, then save: the document is yours and git ignores it. The bar above sets it back to this template. How the lines work is in [Connection lines](card-diagram-connection-line.md), and how to draw well is in [Using the card diagram framework](card-diagram-usage.md).

## Right-angled lines

The default line. Click a line, then:

- **double-click it** to add an anchor where you clicked, and drag the anchor;
- click an anchor to see its two handles, and drag a handle: it snaps between the two directions facing its neighbour;
- press **Delete** to remove the anchor, and double-click a handle to set it back to auto;
- drag the handle at either end to change the way the line leaves or arrives;
- then move a card and watch where the anchors go.

The line below has an anchor already: its lane stays beside the middle while the cards move.

<!--renderComp=CardDiagram,title=Right-angled lines-->
```yaml
version: 1
viewport:
  size: { height: 440 }
nodes:
  - id: left
    renderer: { type: table }
    position: { x: 0, y: 0 }
    size: { width: 220, height: auto }
    data:
      name: Left
      fields: [{ id: name, label: Name }]
      rows:
        - { id: a, name: Row a }
        - { id: b, name: Row b }
    handles:
      - { id: a-out, direction: out, anchor: { target: row/a, side: right } }
      - { id: b-out, direction: out, anchor: { target: row/b, side: right } }
  - id: right
    renderer: { type: table }
    position: { x: 560, y: 160 }
    size: { width: 220, height: auto }
    data:
      name: Right
      fields: [{ id: name, label: Name }]
      rows:
        - { id: c, name: Row c }
        - { id: d, name: Row d }
    handles:
      - { id: c-in, direction: in, anchor: { target: row/c, side: left } }
      - { id: d-in, direction: in, anchor: { target: row/d, side: left } }
connections:
  - id: with-anchor
    source: { nodeId: left, handleId: a-out }
    target: { nodeId: right, handleId: c-in }
    label: { text: one anchor }
    route:
      anchorList:
        - { id: a1, along: 0.5, x: -50, y: 0 }
  - id: plain
    source: { nodeId: left, handleId: b-out }
    target: { nodeId: right, handleId: d-in }
    label: { text: no anchor }
```

## Curves

Set a line's type to **Curve** in its edit card, or try the two below. Double-click a curve to add an anchor: the curve keeps its shape. Drag a handle to bend it. Coupled handles stay on one straight line; **Alt + drag** decouples them, and the **Coupled** switch in the anchor's card couples them again. Drag the hollow handle at either end to give that end a handle of its own.

<!--renderComp=CardDiagram,title=Curves-->
```yaml
version: 1
viewport:
  size: { height: 440 }
defaults:
  connection:
    renderer: { type: bezier }
nodes:
  - id: start
    renderer: { type: card-note }
    position: { x: 0, y: 40 }
    size: { width: 180, height: auto }
    data: { title: Start, text: Where the lines leave, tone: blue }
    handles:
      - { id: out, direction: out, anchor: { side: right } }
      - { id: down, direction: out, anchor: { side: bottom } }
  - id: end
    renderer: { type: card-note }
    position: { x: 620, y: 200 }
    size: { width: 180, height: auto }
    data: { title: End, text: Where they arrive, tone: green }
    handles:
      - { id: in, direction: in, anchor: { side: left } }
      - { id: bottom, direction: in, anchor: { side: bottom } }
connections:
  - id: shaped
    source: { nodeId: start, handleId: out }
    target: { nodeId: end, handleId: in }
    label: { text: an anchor with coupled handles }
    route:
      anchorList:
        - { id: a1, along: 0.5, x: 0, y: -40, handleIn: { x: -90, y: 0 }, handleOut: { x: 90, y: 0 } }
  - id: plain-curve
    source: { nodeId: start, handleId: down }
    target: { nodeId: end, handleId: bottom }
    label: { text: no anchor }
```

## Lines on top of each other

Two of these lines run together: a reader cannot tell where each goes. Find the shared stretch and add an anchor to one of the lines to give it a lane of its own, then look again. This is what automatic layout tends to produce ([the check](card-diagram-usage.md#no-lines-on-top-of-each-other)).

<!--renderComp=CardDiagram,title=Overlapping lines to untangle-->
```yaml
version: 1
viewport:
  size: { height: 460 }
nodes:
  - id: tool
    renderer: { type: card-note }
    position: { x: 300, y: 0 }
    size: { width: 240, height: auto }
    data: { title: Tool, text: Writes three reports, tone: violet }
    handles:
      - { id: a, direction: out, anchor: { side: bottom, offset: 0.25 } }
      - { id: b, direction: out, anchor: { side: bottom, offset: 0.5 } }
      - { id: c, direction: out, anchor: { side: bottom, offset: 0.75 } }
  - id: one
    renderer: { type: card-note }
    position: { x: 0, y: 260 }
    size: { width: 180, height: auto }
    data: { title: Report one, tone: blue }
    handles: [{ id: in, direction: in, anchor: { side: top } }]
  - id: two
    renderer: { type: card-note }
    position: { x: 240, y: 260 }
    size: { width: 180, height: auto }
    data: { title: Report two, tone: amber }
    handles: [{ id: in, direction: in, anchor: { side: top } }]
  - id: three
    renderer: { type: card-note }
    position: { x: 600, y: 260 }
    size: { width: 180, height: auto }
    data: { title: Report three, tone: green }
    handles: [{ id: in, direction: in, anchor: { side: top } }]
connections:
  - { id: to-one, source: { nodeId: tool, handleId: a }, target: { nodeId: one, handleId: in } }
  - { id: to-two, source: { nodeId: tool, handleId: b }, target: { nodeId: two, handleId: in } }
  - { id: to-three, source: { nodeId: tool, handleId: c }, target: { nodeId: three, handleId: in } }
```

## Moving between states

Lines keep their routes in an animation: the anchors move with the cards. Press Play, or click a state.

<!--renderComp=CardDiagramAnimation,height=420,title=A card moving-->
```yaml
version: 1
diagram:
  nodes:
    - id: from
      renderer: { type: card-note }
      position: { x: 0, y: 0 }
      size: { width: 170, height: auto }
      data: { title: From, tone: blue }
      handles: [{ id: out, direction: out, anchor: { side: right } }]
    - id: to
      renderer: { type: card-note }
      position: { x: 420, y: 160 }
      size: { width: 170, height: auto }
      data: { title: To, tone: green }
      handles: [{ id: in, direction: in, anchor: { side: left } }]
  connections:
    - id: line
      source: { nodeId: from, handleId: out }
      target: { nodeId: to, handleId: in }
      route:
        anchorList:
          - { id: a1, along: 0.5, x: 40, y: 0 }
stateList:
  - id: first
    name: First
    description: The two cards apart
  - id: second
    name: Second
    description: The right card moved up
    target:
      to: { y: -280 }
```

## Switching scenes

A card opens a scene of its own; lines keep their routes in a scene shown inside a card too.

<!--renderComp=CardDiagramSwitch,height=480,title=Scenes by path-->
```yaml
version: 1
sceneList:
  - path: /overview
    label: Overview
    diagram:
      nodes:
        - id: note
          renderer: { type: card-note }
          position: { x: 0, y: 100 }
          size: { width: 180, height: auto }
          data: { title: Start here, text: The card on the right holds a scene, tone: blue }
          handles: [{ id: out, direction: out, anchor: { side: right } }]
        - id: detail
          renderer: { type: scene-embed }
          position: { x: 340, y: 0 }
          size: { width: 460, height: 320 }
          data: { scene: /overview/detail, title: Detail, icon: table, tone: green }
          handles: [{ id: in, direction: in, anchor: { side: left } }]
      connections:
        - { id: into, source: { nodeId: note, handleId: out }, target: { nodeId: detail, handleId: in }, label: { text: open it }, link: /overview/detail }
  - path: /overview/detail
    label: Detail
    diagram:
      nodes:
        - id: a
          renderer: { type: card-note }
          position: { x: 0, y: 0 }
          size: { width: 160, height: auto }
          data: { title: A, tone: amber }
          handles: [{ id: out, direction: out, anchor: { side: bottom } }]
        - id: b
          renderer: { type: card-note }
          position: { x: 300, y: 120 }
          size: { width: 160, height: auto }
          data: { title: B, tone: teal }
          handles: [{ id: in, direction: in, anchor: { side: top } }]
      connections:
        - id: routed
          source: { nodeId: a, handleId: out }
          target: { nodeId: b, handleId: in }
          route:
            anchorList:
              - { id: a1, along: 0.5, x: 0, y: -24 }
```

## Views of a scene

One scene, shown differently by how it is presented: the cards in the overview and the matrix while the pointer rests there, a cylinder alone in the summary with a line arriving at it, the detail when focused. Use the menus in the title lines and the path bar; a menu's choice lasts while the block is on the page.

<!--renderComp=CardDiagramSwitch,height=520,title=A scene with views-->
```yaml
version: 1
title: A scene with views
height: 520
sceneList:
  - path: /overview
    label: Overview
    diagram:
      nodes:
        - id: orders
          renderer: { type: scene-embed }
          position: { x: 0, y: 0 }
          size: { width: 560, height: 340 }
          data: { scene: /overview/orders, title: Orders, icon: table, tone: blue }
        - id: other
          renderer: { type: scene-link }
          position: { x: 620, y: 140 }
          link: /overview/summary
          data: { title: Open the summary, icon: arrow-right-left, tone: teal, statList: [The same scene in another card] }
  - path: /overview/summary
    label: Summary
    diagram:
      nodes:
        - id: note
          renderer: { type: card-note }
          position: { x: 0, y: 100 }
          size: { width: 180, height: auto }
          data: { title: A line arrives, text: At the wall of the cylinder, tone: teal }
          handles: [{ id: out, direction: out, anchor: { side: right } }]
        - id: orders
          renderer: { type: scene-embed }
          position: { x: 300, y: 0 }
          size: { width: 320, height: 260 }
          data: { scene: /overview/orders, viewHover: false, title: Orders, icon: table, tone: green }
          handles: [{ id: in, direction: in, anchor: { side: left } }]
      connections:
        - { id: into, source: { nodeId: note, handleId: out }, target: { nodeId: orders, handleId: in } }
  - path: /overview/orders
    label: Orders
    viewDefault:
      - { when: { embedder: /overview/summary }, view: icon }
      - { when: { isEmbedded: true }, view: cards }
      - { view: detail }
    viewHover: matrix
    viewList:
      - id: icon
        label: Icon
        isFrameHiddenEmbedded: true
        isAvailableFocused: false
        diagram:
          nodes:
            - { id: icon, renderer: { type: card-database }, position: { x: 0, y: 0 }, size: { width: 320, height: 260 }, data: { title: Orders, tone: green } }
      - id: cards
        label: Cards
        diagram:
          nodes:
            - { id: order, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 160, height: auto }, data: { title: Order, tone: blue } }
            - { id: customer, renderer: { type: card-note }, position: { x: 240, y: 0 }, size: { width: 160, height: auto }, data: { title: Customer, tone: amber } }
      - id: matrix
        label: Matrix
        diagram:
          nodes:
            - id: matrix
              renderer: { type: card-matrix }
              position: { x: 0, y: 0 }
              size: { width: 320, height: auto }
              data:
                title: Who refers to whom
                rowAxisLabel: From
                columnAxisLabel: To
                rowHeadWidth: 200
                cellSize: 40
                isDiagonalMarked: true
                rowList: [{ id: order, label: Order }, { id: customer, label: Customer }, { id: item, label: Item }]
                columnList: [{ id: order, label: Order }, { id: customer, label: Customer }, { id: item, label: Item }]
                cellList: [{ row: order, column: customer, title: An order has a customer }, { row: item, column: order, title: An item belongs to an order }]
      - id: detail
        label: Detail
        isAvailableEmbedded: false
        diagram:
          nodes:
            - { id: order, renderer: { type: card-note }, position: { x: 0, y: 160 }, size: { width: 200, height: auto }, data: { title: Order, text: Moves when you switch, tone: blue } }
            - { id: customer, renderer: { type: card-note }, position: { x: 320, y: 0 }, size: { width: 200, height: auto }, data: { title: Customer, text: Moves too, tone: amber } }
            - { id: item, renderer: { type: card-note }, position: { x: 320, y: 320 }, size: { width: 200, height: auto }, data: { title: Item, text: Only in this view, tone: green } }
```

## A block of many scenes

Edit it, Visual: the panel under the canvas lists the scenes as a tree, thirty under one scene, shown a page at a time with a filter of their own. Click one to edit it, right-click it for what can be done, drag it onto the canvas for a link to it.

<!--renderComp=CardDiagramSwitch,height=420,title=Many scenes-->
```yaml
version: 1
sceneList:
  - path: /catalog
    label: Catalog
    diagram:
      nodes:
        - { id: first, renderer: { type: scene-link }, position: { x: 0, y: 0 }, link: /catalog/item-01, data: { title: The first item } }
  - { path: /catalog/item-01, label: Item 1, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 1 } }] } }
  - { path: /catalog/item-02, label: Item 2, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 2 } }] } }
  - { path: /catalog/item-03, label: Item 3, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 3 } }] } }
  - { path: /catalog/item-04, label: Item 4, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 4 } }] } }
  - { path: /catalog/item-05, label: Item 5, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 5 } }] } }
  - { path: /catalog/item-06, label: Item 6, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 6 } }] } }
  - { path: /catalog/item-07, label: Item 7, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 7 } }] } }
  - { path: /catalog/item-08, label: Item 8, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 8 } }] } }
  - { path: /catalog/item-09, label: Item 9, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 9 } }] } }
  - { path: /catalog/item-10, label: Item 10, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 10 } }] } }
  - { path: /catalog/item-11, label: Item 11, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 11 } }] } }
  - { path: /catalog/item-12, label: Item 12, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 12 } }] } }
  - { path: /catalog/item-13, label: Item 13, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 13 } }] } }
  - { path: /catalog/item-14, label: Item 14, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 14 } }] } }
  - { path: /catalog/item-15, label: Item 15, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 15 } }] } }
  - { path: /catalog/item-16, label: Item 16, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 16 } }] } }
  - { path: /catalog/item-17, label: Item 17, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 17 } }] } }
  - { path: /catalog/item-18, label: Item 18, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 18 } }] } }
  - { path: /catalog/item-19, label: Item 19, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 19 } }] } }
  - { path: /catalog/item-20, label: Item 20, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 20 } }] } }
  - { path: /catalog/item-21, label: Item 21, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 21 } }] } }
  - { path: /catalog/item-22, label: Item 22, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 22 } }] } }
  - { path: /catalog/item-23, label: Item 23, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 23 } }] } }
  - { path: /catalog/item-24, label: Item 24, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 24 } }] } }
  - { path: /catalog/item-25, label: Item 25, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 25 } }] } }
  - { path: /catalog/item-26, label: Item 26, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 26 } }] } }
  - { path: /catalog/item-27, label: Item 27, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 27 } }] } }
  - { path: /catalog/item-28, label: Item 28, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 28 } }] } }
  - { path: /catalog/item-29, label: Item 29, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 29 } }] } }
  - { path: /catalog/item-30, label: Item 30, diagram: { nodes: [{ id: n, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: Item 30 } }] } }
```

## Arrangers

This diagram is an ER diagram with its cards and lines left in a mess. Open it for editing and use **Arrange** in the edit panel: *Route the lines* keeps the cards where they are and replaces the anchors of every line; *Place the cards in columns and route the lines* also moves the cards. Either is one undo step. Move a card and apply it again.

<!--renderComp=DiagramER,title=A diagram to arrange-->
```yaml
version: 1
nodes:
  - id: comment
    renderer: { type: dataverse-table }
    position: { x: 0, y: 0 }
    size: { width: 410, height: auto }
    data:
      name: Comment
      nameLogical: comment
      columns:
        - { id: id, name: Comment, nameLogical: commentid, type: Unique identifier, key: PK }
        - { id: post, name: Post, nameLogical: postid, type: Lookup, key: FK }
        - { id: author, name: Author, nameLogical: authorid, type: Lookup, key: FK }
    handles:
      - { id: post, direction: out, anchor: { target: column/post, side: right } }
      - { id: author, direction: out, anchor: { target: column/author, side: right } }
  - id: post
    renderer: { type: dataverse-table }
    position: { x: 40, y: 240 }
    size: { width: 410, height: auto }
    data:
      name: Post
      nameLogical: post
      columns:
        - { id: id, name: Post, nameLogical: postid, type: Unique identifier, key: PK }
        - { id: author, name: Author, nameLogical: authorid, type: Lookup, key: FK }
        - { id: editor, name: Editor, nameLogical: editorid, type: Lookup, key: FK }
    handles:
      - { id: pk, direction: in, anchor: { target: column/id, side: right } }
      - { id: author, direction: out, anchor: { target: column/author, side: right } }
      - { id: editor, direction: out, anchor: { target: column/editor, side: right } }
  - id: user
    renderer: { type: dataverse-table }
    position: { x: 760, y: 110 }
    size: { width: 410, height: auto }
    data:
      name: User
      nameLogical: user
      columns:
        - { id: id, name: User, nameLogical: userid, type: Unique identifier, key: PK }
        - { id: name, name: Name, nameLogical: name, type: Text }
    handles:
      - { id: pk, direction: in, anchor: { target: column/id, side: left } }
connections:
  - { id: comment-post, source: { nodeId: comment, handleId: post }, target: { nodeId: post, handleId: pk } }
  - { id: comment-author, source: { nodeId: comment, handleId: author }, target: { nodeId: user, handleId: pk } }
  - { id: post-author, source: { nodeId: post, handleId: author }, target: { nodeId: user, handleId: pk } }
  - { id: post-editor, source: { nodeId: post, handleId: editor }, target: { nodeId: user, handleId: pk } }
```

## Cutting a table down

`rowDisplay` picks the rows of a table card, in any order, with a row break for what is left out. Open it for editing and use **Display** on the card's tab, or click a row and use its toolbar.

<!--renderComp=DiagramER,title=A table cut down-->
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
        - { id: status, name: Status, nameLogical: statuscode, type: Choice, tone: green }
        - { id: modifiedon, name: Modified on, nameLogical: modifiedon, type: Date and Time }
      rowDisplay: [accountid, { break: 2 columns }, status, '...']
    handles: []
connections: []
```

## Rows behind a row break

A row break can hold rows. Click one to open it, and the bar over its rows to close it. Below, the first is closed at first and the second open.

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

## One table, several views

A card can declare views, each of a view mode, with a menu at the right of its title line to switch between them. Lines stay attached in every view. In edit mode, open the card's tab: **Views** adds, changes and removes them.

<!--renderComp=DiagramER,title=A table with views-->
```yaml
version: 1
viewport:
  size: { height: 340 }
nodes:
  - id: account
    renderer: { type: dataverse-table }
    position: { x: 0, y: 0 }
    size: { width: 440, height: auto }
    data:
      name: Account
      nameLogical: account
      columns:
        - { id: accountid, name: Account, nameLogical: accountid, type: Unique identifier, key: PK }
        - { id: name, name: Name, nameLogical: name, type: Text }
        - { id: phone, name: Phone, nameLogical: telephone1, type: Text }
        - { id: status, name: Status, nameLogical: statuscode, type: Choice }
      rows:
        - { id: r1, accountid: A-001, name: Contoso, phone: 03-1111, status: Active }
        - { id: r2, accountid: A-002, name: Fabrikam, phone: 03-2222, status: Closed }
      viewList:
        - { id: schema, label: Schema, mode: plain }
        - { id: short, label: Schema (short), mode: plain, rowDisplay: [accountid, { break: 2 columns }, status] }
        - { id: one, label: One record, mode: column, valueRowId: r1 }
        - { id: records, label: Records, mode: row, fieldDisplay: [accountid, name, status] }
      viewDefault: short
    handles:
      - { id: status, direction: out, anchor: { target: column/status, side: right } }
  - id: note
    renderer: { type: card-note }
    position: { x: 600, y: 60 }
    size: { width: 180, height: auto }
    data: { title: Stays attached, tone: teal }
    handles: [{ id: in, direction: in, anchor: { side: left } }]
connections:
  - { id: status-note, source: { nodeId: account, handleId: status }, target: { nodeId: note, handleId: in } }
```

## A parametric canvas

A viewport that names `parametric-canvas` in `viewport.featureList` offers the drawing layer while it is edited: a **tool bar** over the canvas, and a **panel** under it with the structure of the scene. Press **Edit**, then:

- drag **Step**: only its gap to *Source* changes, and *Target* follows it;
- drag the round mark named *Pipeline* (the origin of the group): the whole group moves;
- drag a stage of the row over another: the row orders them, at one gap;
- click the name *Stages* on the dashed frame, and change its gap in the panel;
- pick a tool, then click the canvas: with something of the group selected it goes into the group;
- pick **Cards**, **Color block**, and drag a box out around some cards: it takes that size. The chevron of a tool shows the other ways it can be placed (**Next to** puts a note beside a card, following it);
- pick **Shapes**, **Diamond**, and drag it out; type its words where they stand, and choose its fill under **Style** in its edit card;
- pick **Patterns**, **Captioned**, and click the canvas: a shape and its caption, which follows it wherever it goes;
- double-click the empty canvas and type a few words, then Enter: they are a text there; or type `/` and the name of a tool (`/shape-ellipse`);
- right-click a card, or an item of the tree, for what can be done with it.

<!--renderComp=CardDiagram,title=A parametric canvas-->
```yaml
version: 1
viewport:
  size: { height: 520 }
  featureList: [parametric-canvas]
nodes:
  - id: source
    renderer: { type: card-note }
    data: { title: Source, text: where it starts, tone: blue }
    handles:
      - { id: in, direction: in, anchor: { side: left } }
      - { id: out, direction: out, anchor: { side: right } }
  - id: step
    renderer: { type: card-note }
    data: { title: Step, text: what is done to it, tone: teal }
    handles:
      - { id: in, direction: in, anchor: { side: left } }
      - { id: out, direction: out, anchor: { side: right } }
  - id: target
    renderer: { type: card-note }
    data: { title: Target, text: where it ends, tone: green }
    handles:
      - { id: in, direction: in, anchor: { side: left } }
      - { id: out, direction: out, anchor: { side: right } }
  - id: remark
    renderer: { type: card-label }
    data: { title: halfway between the two ends, icon: link, tone: slate }
    handles: []
  - id: stage-a
    renderer: { type: card-brief }
    data: { title: Extract, icon: database, tone: blue }
    handles: []
  - id: stage-b
    renderer: { type: card-brief }
    data: { title: Transform, icon: workflow, tone: teal }
    handles: []
  - id: stage-c
    renderer: { type: card-brief }
    data: { title: Load, icon: send, tone: green }
    handles: []
  - id: tick
    renderer: { type: card-label }
    data: { title: run, icon: play, tone: amber }
    handles: []
  - id: aside
    renderer: { type: card-note }
    position: { x: 640, y: 300 }
    data: { title: A free element, text: its place is its own, tone: slate }
    handles: []
connections:
  - id: source-step
    source: { nodeId: source, handleId: out }
    target: { nodeId: step, handleId: in }
  - id: step-target
    source: { nodeId: step, handleId: out }
    target: { nodeId: target, handleId: in }
parametric:
  groupList:
    - id: pipeline
      name: Pipeline
      root: { x: 60, y: 110 }
      memberList:
        - { id: source, node: source }
        - id: step
          node: step
          parent: source
          constraint: { type: beside, side: right, gap: 70 }
        - id: target
          node: target
          parent: step
          constraint: { type: beside, side: right, gap: 70 }
        - id: remark
          node: remark
          parentList: [source, target]
          constraint: { type: between, t: 0.5, y: -70 }
        - id: stages
          name: Stages
          layout: { type: array, direction: row, gap: 24 }
          parent: source
          constraint: { type: offset, x: 0, y: 70, point: top-left, pointParent: bottom-left }
        - { id: stage-a, node: stage-a, parent: stages }
        - { id: stage-b, node: stage-b, parent: stages }
        - { id: stage-c, node: stage-c, parent: stages }
        - id: runs
          name: Runs
          layout: { type: repeat, count: 5, direction: row, gap: 12 }
          parent: stage-a
          constraint: { type: beside, side: bottom, gap: 50, align: 0 }
        - { id: tick, node: tick, parent: runs }
```

## Reference points and a locator

Two groups. In **Points**, each shape hangs on a **reference point** of the one before: *Round* by its west point on the *Outlet* that *Parent* declares, *Hex* by its first corner 30, 30 from the point of *Round* at 135 degrees. In **Blocks**, a **locator** carries three blocks between its vertical lines. Press **Edit**, then:

- click *Round*: the diamonds mark the reference points its constraint measures by, the ringed one its default; change **Its reference point** in its card (a round thing offers directions and an angle);
- click *Parent*, then **Edit reference points** in its card: its points are listed and named on the canvas; add one, move it along an edge, make it the default (nothing moves);
- click the name *Columns* (or a chevron) to focus the locator, then drag a chevron: nothing moves until you drop it; drop it on **Drop here to cancel** to give up; hold Shift to move the following lines too;
- press the **+** after the last chevron for another line, click a chevron for its name and its removal;
- change **Shown when not focused** of the locator, then click the empty canvas.

<!--renderComp=CardDiagram,title=Reference points and a locator-->
```yaml
version: 1
viewport:
  size: { height: 560 }
  featureList: [parametric-canvas]
nodes:
  - { id: box, renderer: { type: shape }, size: { width: 160, height: 90 }, data: { shape: rect, text: Parent }, handles: [] }
  - { id: round, renderer: { type: shape }, size: { width: 110, height: 110 }, data: { shape: ellipse, text: Round }, handles: [] }
  - { id: hex, renderer: { type: shape }, size: { width: 120, height: 90 }, data: { shape: hexagon, text: Hex }, handles: [] }
  - { id: block-a, renderer: { type: shape }, size: { width: 100, height: 60 }, data: { shape: rect, text: xxx }, style: { fill: blue }, handles: [] }
  - { id: block-b, renderer: { type: shape }, size: { width: 100, height: 60 }, data: { shape: rect, text: yyy }, style: { fill: teal }, handles: [] }
  - { id: block-c, renderer: { type: shape }, size: { width: 100, height: 60 }, data: { shape: rect, text: zzzzzz }, style: { fill: amber }, handles: [] }
  - { id: caption, renderer: { type: text }, data: { text: its top on the line Split, textSize: s, tone: slate }, handles: [] }
parametric:
  groupList:
    - id: points
      name: Points
      root: { x: 40, y: 60 }
      memberList:
        - id: box
          node: box
          referencePointList:
            - { id: outlet, name: Outlet, point: { side: right, index: 2, count: 3 } }
        - { id: round, node: round, parent: box, constraint: { type: offset, x: 90, y: 0, point: { direction: west }, pointParent: outlet } }
        - { id: hex, node: hex, parent: round, constraint: { type: offset, x: 30, y: 30, point: { vertex: 1 }, pointParent: { angle: 135 } } }
    - id: blocks
      name: Blocks
      root: { x: 70, y: 360 }
      memberList:
        - id: cols
          name: Columns
          layout: { type: locator, xList: [0, 120, { id: split, at: 240, name: Split }, 480], yList: [0, 80] }
        - { id: a, node: block-a, parent: cols, constraint: { type: locate, lineX: ['1', '2'], lineY: ['1', '2'] } }
        - { id: b, node: block-b, parent: cols, constraint: { type: locate, lineX: ['2', split], lineY: ['1', '2'] } }
        - { id: c, node: block-c, parent: cols, constraint: { type: locate, lineX: [split, '4'], lineY: ['1', '2'] } }
        - { id: t, node: caption, parent: cols, constraint: { type: locate, lineX: split, y: 96, point: top } }
```

## Over and under

The shape lies on the line and on the block. Press **Edit**, right-click the shape and choose **Send backward**: it goes under the line and stays over the block; **Send to back** puts it under the block too. Ctrl/⌘ + `]` and `[` do the same for what is selected, and the section **Depth** of the edit card shows the number the moves write. The diamond is written with `depth: 5`, the line under it with none.

<!--renderComp=CardDiagram,title=Over and under-->
```yaml
version: 1
viewport:
  size: { height: 340 }
nodes:
  - id: block
    renderer: { type: color-block }
    position: { x: 0, y: 0 }
    size: { width: 560, height: 240 }
    data: { tone: blue, itemList: [{ id: label, text: A block behind }] }
    style: { fill: blue }
  - id: from
    renderer: { type: card-note }
    position: { x: 30, y: 70 }
    size: { width: 140, height: auto }
    data: { title: From, tone: amber }
    handles: [{ id: out, direction: out, anchor: { side: right } }]
  - id: to
    renderer: { type: card-note }
    position: { x: 390, y: 70 }
    size: { width: 140, height: auto }
    data: { title: To, tone: teal }
    handles: [{ id: in, direction: in, anchor: { side: left } }]
  - id: shape
    renderer: { type: shape }
    position: { x: 220, y: 30 }
    size: { width: 120, height: 110 }
    data: { shape: rect, text: Shape }
    style: { fill: amber }
  - id: top
    renderer: { type: shape }
    position: { x: 300, y: 110 }
    size: { width: 100, height: 70 }
    depth: 5
    data: { shape: diamond, text: depth 5 }
    style: { fill: violet }
connections:
  - id: line
    source: { nodeId: from, handleId: out }
    target: { nodeId: to, handleId: in }
    style: { stroke: "#dc2626", strokeWidth: 3 }
```

## Add your own

Everything above is ordinary content: copy a block, or add one from the insert menu in edit mode.

## A label with settings, a column of the diagram's own

A `card-label` carries the settings its data declares: press **Edit**, click the label, and the edit card beside it shows them. The table has a column the diagram adds to its kind (`fieldExtraList`), a choice whose values and words differ from row to row, written in the color of its value: click its cell and choose.

<!--renderComp=DiagramER,title=A label with settings-->
```yaml
version: 1
viewport:
  size: { height: 380 }
nodes:
  - id: settings
    renderer: { type: card-label }
    position: { x: 0, y: 0 }
    data:
      title: Settings
      icon: settings
      tone: teal
      propertyList:
        - { id: name, label: Name }
        - { id: batch, label: Rows per batch, placeholder: 'as the plan says: 100' }
        - { id: way, label: Rows found by, kind: enum, values: [id, key], valueLabels: { id: the same id, key: a key } }
        - { id: isOn, label: Runs with the plan, kind: bool }
        - { id: from, label: Rules, isReadOnly: true }
      name: Members
      way: id
      isOn: true
      from: written in the action
  - id: member
    renderer: { type: dataverse-table }
    position: { x: 0, y: 56 }
    size: { width: 540, height: auto }
    data:
      name: Member
      nameLogical: new_member
      fieldExtraList:
        - id: compare
          label: Compared as
          kind: enum
          values: ['', ignore, same, lookup, kept]
          valueLabels: { '': No rule, ignore: Not compared, same: same value, lookup: same record, kept: as written }
          valuesKey: compareValueList
          valueLabelsKey: compareLabels
          valueTones: { same: teal, lookup: violet, kept: blue, ignore: slate }
          width: 9rem
      rowPropertyExtraList:
        - { id: reason, label: Why it is not compared, isMultiline: true }
      columns:
        - { id: name, name: Name, nameLogical: new_name, type: Text, compare: same, compareValueList: ['', ignore, same] }
        - { id: owner, name: Owner, nameLogical: ownerid, type: Lookup, key: FK, compare: lookup, compareValueList: ['', ignore, same, lookup] }
        - { id: phone, name: Phone, nameLogical: new_phone, type: Text, compare: kept, compareValueList: ['', ignore, same, kept], compareLabels: { kept: digits only } }
        - { id: created, name: Created on, nameLogical: createdon, type: Date and Time, compare: ignore, reason: written by the platform, compareValueList: ['', ignore, same] }
    handles: []
connections: []
```

