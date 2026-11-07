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

## Switching views

A card opens a view of its own; lines keep their routes in a view shown inside a card too.

<!--renderComp=CardDiagramSwitch,height=480,title=Views by path-->
```yaml
version: 1
viewList:
  - path: /overview
    label: Overview
    diagram:
      nodes:
        - id: note
          renderer: { type: card-note }
          position: { x: 0, y: 100 }
          size: { width: 180, height: auto }
          data: { title: Start here, text: The card on the right holds a view, tone: blue }
          handles: [{ id: out, direction: out, anchor: { side: right } }]
        - id: detail
          renderer: { type: view-embed }
          position: { x: 340, y: 0 }
          size: { width: 460, height: 320 }
          data: { view: /overview/detail, title: Detail, icon: table, tone: green }
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

## Add your own

Everything above is ordinary content: copy a block, or add one from the insert menu in edit mode.
