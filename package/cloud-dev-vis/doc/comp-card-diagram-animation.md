---
title: Card Diagram Animation
description: CardDiagramAnimation moves a card diagram between named states; click a state, or play between two.
language: en
---

A diagram that moves. `CardDiagramAnimation` wraps a [card diagram](comp-diagram-er.md) in a control area: the **states** are named, and the viewport goes to one when it is clicked or plays its way between two. `DiagramERAnimation` is the same with the cards of the [Power Platform series](comp-powerplatform.md). The design is in [Card Diagram Animation: Design](card-diagram-animation.md).

## A table split into batches

A chain of states is drawn as one row. Press Play, click a state, or click the line between two states to play that step. The progress runs along the line.

<!--renderComp=CardDiagramAnimation,height=460,title=A table split into batches-->
```yaml
version: 1
diagram:
  defaults:
    connection:
      renderer: { type: smoothstep }
      style: { stroke: "#64748b", strokeWidth: 1.25 }
      markerEnd: arrowClosed
  nodes:
    - id: table
      renderer: { type: table }
      position: { x: 0, y: 0 }
      size: { width: 190, height: auto }
      data:
        name: orders
        nameLogical: 12,000 rows
        isCompact: true
        isFieldHeaderHidden: true
        tone: blue
        fields: [{ id: name, label: Row }, { id: value, label: Key }]
        rows:
          - { id: r1, name: row 1, value: A0 }
          - { id: r2, name: row 2, value: A1 }
          - { id: r3, name: row 3, value: A2 }
          - { id: r4, name: row 4, value: B0 }
          - { id: r5, name: row 5, value: B1 }
          - { id: r6, name: row 6, value: B2 }
          - { id: gap, isEllipsis: true }
          - { id: rn, name: row N, value: Z9 }
        rowGroupList:
          - { id: batch-1, rowFrom: r1, rowTo: r3, tone: blue }
          - { id: batch-2, rowFrom: r4, rowTo: r6, tone: teal }
          - { id: batch-m, rowFrom: gap, rowTo: rn, tone: violet }
      handles:
        - { id: out-1, direction: out, anchor: { target: group/batch-1, side: right } }
        - { id: out-2, direction: out, anchor: { target: group/batch-2, side: right } }
        - { id: out-m, direction: out, anchor: { target: group/batch-m, side: right } }
    - id: batch-1
      renderer: { type: card-brief }
      position: { x: 280, y: -16 }
      size: { width: 150, height: auto }
      data: { title: batch 1, icon: file-spreadsheet, tone: blue, statList: [row 1 to 3000] }
      handles:
        - { id: in, direction: in, anchor: { side: left } }
        - { id: out, direction: out, anchor: { side: right } }
    - id: batch-2
      renderer: { type: card-brief }
      position: { x: 280, y: 44 }
      size: { width: 150, height: auto }
      data: { title: batch 2, icon: file-spreadsheet, tone: teal, statList: [row 3001 to 6000] }
      handles:
        - { id: in, direction: in, anchor: { side: left } }
        - { id: out, direction: out, anchor: { side: right } }
    - id: batch-m
      renderer: { type: card-brief }
      position: { x: 280, y: 104 }
      size: { width: 150, height: auto }
      data: { title: batch m, icon: file-spreadsheet, tone: violet, statList: [row 9001 to N] }
      handles:
        - { id: in, direction: in, anchor: { side: left } }
        - { id: out, direction: out, anchor: { side: right } }
    - id: worker
      renderer: { type: card-note }
      position: { x: 530, y: 26 }
      size: { width: 150, height: auto }
      data: { title: Import, tag: a batch at a time, text: Each row is written once and its result recorded, tone: amber }
      handles:
        - { id: in, direction: in, anchor: { side: left } }
        - { id: out, direction: out, anchor: { side: right } }
    - id: result
      renderer: { type: card-note }
      position: { x: 760, y: 26 }
      size: { width: 130, height: auto }
      data:
        title: Report
        tone: green
        metaList: [{ value: "12,000", label: read }, { value: "11,996", label: written }, { value: "4", label: failed }]
      handles:
        - { id: in, direction: in, anchor: { side: left } }
  connections:
    - { id: to-1, source: { nodeId: table, handleId: out-1 }, target: { nodeId: batch-1, handleId: in } }
    - { id: to-2, source: { nodeId: table, handleId: out-2 }, target: { nodeId: batch-2, handleId: in } }
    - { id: to-m, source: { nodeId: table, handleId: out-m }, target: { nodeId: batch-m, handleId: in } }
    - { id: run-1, source: { nodeId: batch-1, handleId: out }, target: { nodeId: worker, handleId: in } }
    - { id: run-2, source: { nodeId: batch-2, handleId: out }, target: { nodeId: worker, handleId: in } }
    - { id: run-m, source: { nodeId: batch-m, handleId: out }, target: { nodeId: worker, handleId: in } }
    - { id: done, source: { nodeId: worker, handleId: out }, target: { nodeId: result, handleId: in } }
stateList:
  - id: table
    name: The table
    description: One table of many rows; nothing is split yet.
    hide: ["*"]
    show: [table, row/table/*]
    view: { fit: [table], padding: 0.35 }
    caption: A table of 12,000 rows.
  - id: split
    name: Split
    description: Rows are taken together in ranges; each range is one batch.
    show: [batch-1, batch-2, batch-m, connection/to-*]
    view: { fit: [table, batch-1, batch-2, batch-m], padding: 0.15 }
    caption: Each range of rows becomes one batch.
  - id: run
    name: Import
    description: The batches are imported one after another.
    show: [worker, connection/run-*]
    view: all
    caption: The batches run one after another.
  - id: report
    name: Report
    description: What each batch did is reported.
    show: [result, connection/done]
    target:
      result: { ring: "#16a34a" }
    caption: Every row is accounted for.
transitionList:
  - from: table
    to: split
    trackList:
      - { target: camera, at: 0, second: 0.5 }
      - { target: "connection/to-*", at: 0.15, second: 0.45, stagger: 0.25 }
      - { target: [batch-1, batch-2, batch-m], at: 0.3, second: 0.35, stagger: 0.25, ease: spring }
  - from: split
    to: run
    trackList:
      - { target: camera, at: 0, second: 0.5 }
      - { target: worker, at: 0.1, second: 0.35 }
      - { target: "connection/run-*", at: 0.2, second: 0.4 }
      - { token: run-1, at: 0.6, second: 0.6, color: "#2563eb" }
      - { token: run-2, at: 1.1, second: 0.6, color: "#0d9488" }
      - { token: run-m, at: 1.6, second: 0.6, color: "#7c3aed" }
  - from: run
    to: report
    trackList:
      - { target: connection/done, at: 0, second: 0.4 }
      - { token: done, at: 0, second: 0.4, color: "#16a34a" }
      - { target: result, at: 0.3, second: 0.4, ease: spring }
```

## A state machine

States that do not form a chain are drawn as a small graph. Each line plays on its own, along its curve; shift + click a state to pick where Play goes.

<!--renderComp=CardDiagramAnimation,height=400,title=A retry loop-->
```yaml
version: 1
diagram:
  defaults:
    connection:
      renderer: { type: bezier }
      style: { stroke: "#64748b", strokeWidth: 1.25 }
      markerEnd: arrowClosed
  nodes:
    - id: queue
      renderer: { type: card-brief }
      position: { x: 0, y: 40 }
      size: { width: 140, height: auto }
      data: { title: Queue, icon: layers, tone: blue, statList: [3 waiting] }
      handles: [{ id: out, direction: out, anchor: { side: right } }]
    - id: worker
      renderer: { type: card-brief }
      position: { x: 240, y: 40 }
      size: { width: 140, height: auto }
      data: { title: Worker, icon: zap, tone: amber, statList: [one at a time] }
      handles:
        - { id: in, direction: in, anchor: { side: left } }
        - { id: ok, direction: out, anchor: { side: right } }
        - { id: fail, direction: out, anchor: { side: bottom } }
    - id: done
      renderer: { type: card-brief }
      position: { x: 480, y: 0 }
      size: { width: 140, height: auto }
      data: { title: Done, icon: check, tone: green }
      handles: [{ id: in, direction: in, anchor: { side: left } }]
    - id: dead
      renderer: { type: card-brief }
      position: { x: 480, y: 90 }
      size: { width: 140, height: auto }
      data: { title: Dead letter, icon: warning, tone: red }
      handles: [{ id: in, direction: in, anchor: { side: left } }]
  connections:
    - { id: take, source: { nodeId: queue, handleId: out }, target: { nodeId: worker, handleId: in } }
    - { id: ok, source: { nodeId: worker, handleId: ok }, target: { nodeId: done, handleId: in } }
    - { id: fail, source: { nodeId: worker, handleId: fail }, target: { nodeId: dead, handleId: in } }
control: { layout: graph }
stateList:
  - id: waiting
    name: Waiting
    description: The item is in the queue.
    target: { queue: { ring: "#2563eb" }, connection/ok: { opacity: 0.25 }, connection/fail: { opacity: 0.25 } }
  - id: running
    name: Running
    base: waiting
    description: The worker has taken the item.
    target: { queue: { ring: null }, worker: { ring: "#d97706" } }
  - id: done
    name: Done
    base: running
    description: The item succeeded.
    target: { worker: { ring: null }, done: { ring: "#16a34a" }, connection/ok: { opacity: 1 } }
  - id: failed
    name: Failed
    base: running
    description: The item failed for good.
    target: { worker: { ring: null }, dead: { ring: "#dc2626" }, connection/fail: { opacity: 1 } }
transitionList:
  - from: waiting
    to: running
    trackList: [{ token: take, at: 0, second: 0.8, color: "#2563eb" }]
  - from: running
    to: done
    trackList: [{ token: ok, at: 0, second: 0.8, color: "#16a34a" }]
  - from: running
    to: failed
    trackList: [{ token: fail, at: 0, second: 0.8, color: "#dc2626" }]
  - from: failed
    to: waiting
    name: Retry by hand
    second: 0.6
```

## The document

```yaml
version: 1
title: optional
diagram: { nodes, connections, defaults, viewport }   # a card diagram, unchanged
nodeDefineById: { card: { renderer, size, data } }    # a node says use: card, its own keys over it
fps: 30
transitionSecond: 0.8                                 # the length of a transition without tracks
initial: state-id                                     # shown when the page loads; default the last state
control: { layout: auto }                             # auto | linear | graph; positionById for a graph
stateList:
  - id: split
    name: Split                                       # shown on the state
    description: Shown as a tooltip.
    base: previous-state-id                           # what it changes over; default the state before it
    hide: [node, row/node/*, connection/*]            # a line hidden starts undrawn
    show: [...]                                       # a line shown is drawn
    target: { node-id: { ring: "#16a34a" } }          # properties, below
    view: all                                         # below; kept from its base when absent
    caption: A line over the viewport.
transitionList:                                       # absent: a chain, in the order of the list
  - from: table
    to: split
    name: optional
    second: 2                                         # default: where the tracks end
    trackList:
      - { target: camera, at: 0, second: 0.5 }
      - { target: "connection/to-*", at: 0.2, second: 0.4, stagger: 0.3, ease: easeInOut }
      - { token: connection-id, at: 0.6, second: 0.5, color: "#2563eb", size: 5, count: 3, gap: 0.2, label: optional }
```

A target no track names changes over the whole transition. `ease` is `linear`, `ease`, `easeIn`, `easeOut`, `easeInOut` or `spring`.

<!--renderComp=Anchor,id=targets-and-properties-->
### Targets and properties

| Target | Written | Properties |
| --- | --- | --- |
| a node | `node/id`, or `id` alone | `opacity`, `scale`, `x`, `y` (an offset; its lines follow), `ring` (a color) |
| a row of a card | `row/node-id/row-id` | `opacity`, `fill`, `ring` |
| a connection | `connection/id` | `opacity`, `progress` (0 to 1, how far it is drawn), `stroke`, `width` |
| the camera (a track) | `camera` | when it moves |

`*` stands for one step (`row/table/*`, `connection/to-*`); `*` alone is everything. A connection fades with its two nodes unless it says otherwise.

### The view of a state

| `view` | The camera |
| --- | --- |
| `all` (default) | every node, hidden ones too, so it stays still between states |
| `visible` | the nodes the state shows |
| `{ fit: [a, b], padding: 0.15, maxZoom: 1 }` | these nodes |
| `{ x, y, zoom }` | written |

## Reading

- A block starts at its last state, by convention the most complete, so the page shows the whole picture before anything plays; Play then runs from the first state.
- A click on a state shows it at once; shift + click picks where Play goes; a click on a line plays that transition. The speed is 0.5×, 1× or 2×.
- Resting on a state, the viewport pans and zooms like any diagram, and the state's camera comes back when the state changes. While playing it follows the animation.
- The toolbar above the block has a menu that copies or downloads the viewport as PNG or SVG, at a state or paused between two, with a hint over the viewport saying what came of it. Another button copies the YAML.

An animation is edited as its source (the block's source mode); it has no visual edit mode yet.

## Compact cards

Three looks for diagrams of many cards ([Compact cards](card-diagram-impl.md#compact-cards)), usable in every diagram of the framework:

<!--renderComp=CardDiagram,height=300-->
```yaml
version: 1
viewport: { view: auto }
nodes:
  - id: note
    renderer: { type: card-note }
    position: { x: 0, y: 0 }
    size: { width: 190, height: auto }
    data: { title: T4, tag: L, tone: amber, text: A note holds a title and a line of text., metaList: [{ value: 8h, label: runtime }, { value: 2, label: retries }] }
  - id: brief
    renderer: { type: card-brief }
    position: { x: 0, y: 110 }
    size: { width: 190, height: auto }
    data: { title: Connection pooling, icon: database, tone: teal, statList: [120 open, 3 waiting] }
  - id: table
    renderer: { type: table }
    position: { x: 260, y: 0 }
    size: { width: 240, height: auto }
    data:
      name: Interpretation
      isCompact: true
      isFieldHeaderHidden: true
      tone: blue
      columnTemplate: 1fr 1fr
      fields: [{ id: name, label: Name }, { id: value, label: Type }]
      rows:
        - { id: a, name: boundary, value: Boundary }
        - { id: b, name: payload, value: Payload }
        - { id: gap, isEllipsis: true }
        - { id: c, name: context, value: Context }
      rowGroupList:
        - { id: first, rowFrom: a, rowTo: b, tone: blue }
```
