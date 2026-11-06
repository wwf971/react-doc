---
title: Card Diagram Views
description: CardDiagramSwitch shows many card diagrams in one viewport, by path, moving smoothly between them.
language: en
---

One viewport, many diagrams. `CardDiagramSwitch` holds **views**, each a [card diagram](comp-diagram-er.md) with a **path**. The path bar above the viewport shows where you are: click a segment to go there, or the chevron before it to see the views beside it. A view can show another view inside a card; clicking the card zooms into it. At any view you can pan and zoom, and copy or download what you see as PNG or SVG. `DiagramERSwitch` is the same block with every card of the [Power Platform](comp-powerplatform.md) series.

The design is in [card-diagram-flexible-switch.md](card-diagram-flexible-switch.md).

## An overview with a card to zoom into

Click the card **Detail** (or the segment of the path bar, after that). The line's label and the note below it open views too.

<!--renderComp=CardDiagramSwitch,height=520,title=An overview-->
```yaml
version: 1
viewList:
  - path: /overview
    label: Overview
    diagram:
      defaults:
        connection: { renderer: { type: smoothstep } }
      nodes:
        - id: source
          renderer: { type: card-note }
          position: { x: 0, y: 130 }
          size: { width: 200, height: auto }
          data: { title: Source, text: Reads the rows, tone: blue }
          handles: [{ id: out, direction: out, anchor: { side: right } }]
        - id: note
          renderer: { type: card-brief }
          position: { x: 0, y: 240 }
          size: { width: 200, height: auto }
          link: /overview/moved
          data: { title: Open a view with nodes in common, icon: arrow-right-left, tone: teal }
        - id: detail
          renderer: { type: view-embed }
          position: { x: 360, y: 0 }
          size: { width: 480, height: 360 }
          data: { view: /overview/detail, title: Detail, subtitle: another view, inside a card, icon: table, tone: green }
          handles: [{ id: in, direction: in, anchor: { side: left } }]
      connections:
        - id: source-detail
          source: { nodeId: source, handleId: out }
          target: { nodeId: detail, handleId: in }
          label: { text: open it }
          link: /overview/detail
  - path: /overview/detail
    label: Detail
    diagram:
      defaults:
        connection: { renderer: { type: smoothstep } }
      nodes:
        - id: orders
          renderer: { type: table }
          position: { x: 0, y: 0 }
          size: { width: 300, height: auto }
          data:
            name: orders
            fields: [{ id: name, label: Column }, { id: type, label: Type }]
            rows:
              - { id: id, name: id, type: uuid }
              - { id: customer, name: customer, type: lookup }
          handles: [{ id: customer, direction: out, anchor: { target: row/customer, side: right } }]
        - id: customers
          renderer: { type: table }
          position: { x: 440, y: 40 }
          size: { width: 300, height: auto }
          data:
            name: customers
            fields: [{ id: name, label: Column }, { id: type, label: Type }]
            rows:
              - { id: id, name: id, type: uuid }
          handles: [{ id: id, direction: in, anchor: { target: row/id, side: left } }]
      connections:
        - { id: lookup, source: { nodeId: orders, handleId: customer }, target: { nodeId: customers, handleId: id } }
  - path: /overview/moved
    label: Moved
    diagram:
      nodes:
        - id: source
          renderer: { type: card-note }
          position: { x: 300, y: 0 }
          size: { width: 320, height: auto }
          data: { title: Source, text: Reads the rows, tone: blue }
        - id: note
          renderer: { type: card-brief }
          position: { x: 300, y: 120 }
          size: { width: 320, height: auto }
          link: /overview
          data: { title: Back to the overview, icon: arrow-right-left, tone: teal }
```

## The document

| Key | Meaning |
| --- | --- |
| `viewList` | the views: `path`, `label`, `description`, `diagram`, optionally `box` or `tabs` |
| `root` | the view shown first; the first of the list by default |
| `title`, `height` | the block; `data.height` of the marker wins, as `data.path` names another first view |
| `defaults` | what every `diagram` starts with |
| `transition` | `secondPortal`, `secondMorph`, `secondCamera`, `secondScroll`: how long a step lasts |

A diagram is the [usual format](comp-diagram-er.md), with one more field on a node and on a connection: **`link`**, the path a click on it opens (`/path#item` also scrolls to an item of a stack there). On a connection, the label becomes the button.

Two conventions keep a view readable, in a generator as by hand: a list of cards **wraps** instead of running on in one row, and what is long **scrolls** in a stack instead of shrinking ([Drawing conventions](card-diagram.md#drawing-conventions)).

## Showing a view inside a card

```yaml
- id: detail
  renderer: { type: view-embed }
  position: { x: 360, y: 0 }
  size: { width: 480, height: 360 }           # a numeric size: the view fits inside it
  data:
    view: /overview/detail                     # the path of the view
    box: focus                                 # optional: a region of it (below), or { x, y, width, height }
    title: Detail                              # optional; the label of the view by default
    subtitle: another view
    icon: table
    tone: green                                # blue, teal, green, amber, red, violet, slate
    statList: [12 rows]
    isChromeHidden: false                      # true: only the view, no title line
    padding: 0.03                              # the margin inside the card, a part of its size; this is the default
  handles: [{ id: in, direction: in, anchor: { side: left } }]
```

A box written or named shows that part alone; what lies outside it stays out, until a click opens the view. A view keeps a margin inside its card by default, so nothing of it touches the border of the card, also for a view inside a view inside a view. The nodes of a view keep their ids when several views show them: a switch between two views with nodes in common moves those nodes instead of replacing them.

## A scrolling stack of views

A card fits a whole view inside it, so a tall one gets small. A `view-stack` holds **views and cards one under another in a scrolling area**, each as wide as the area: nothing shrinks to make everything visible. Scroll it with the wheel, which zooms the canvas again once there is nothing left to scroll; click a section to open its view. The cards on the left scroll it from outside, by a link naming an item: `/list#part`.

### The stack as the outer container

When an overview card is a scrolling report, put a `view-stack` directly in the overview. Do not wrap it in a `view-embed` that contains another stack. Use the same node ID and content in its dedicated view, changing only its position, size, handles, and overview link. Switching between these views then moves and resizes the stack itself.

```yaml
id: report:run
renderer: { type: view-stack }
size: { width: 560, height: 420 }
link: /overview/run
data:
  focusPath: /overview/run
  isFrameVisibleFocused: true
  titleBar: Run report
  itemList: []
```

`focusPath` identifies the stack's dedicated view. Elsewhere it has embedded presentation; in that view it has focused presentation, including static masks and measurements. The overview title and its focus icon open that path. Custom title controls keep their own actions. Scrollbar dragging remains available in the overview; the wheel scrolls the stack in its focused view.

Copies with the same node ID and `focusPath` share a saved scroll position. Their geometry remains separate, so overview and focused sizes may differ. A copy with less scrollable content clamps its displayed position without overwriting the saved position. Without `focusPath`, the existing per-view scroll behavior is unchanged.

`isFrameVisibleFocused` defaults to `true`. Setting it to `false` hides the focused stack's border and background, not its scrolling behavior or items. Title visibility is controlled separately below. The three migration plan/report containers explicitly keep their frames and titles in both presentations.

### The stack title bar

The title bar stays above the scrolling items. Simple text can be written as `data.titleBar: Verification report`. To control its visibility independently in the two presentations:

```yaml
data:
  titleBar:
    text: Verification report
    isVisibleEmbedded: false
    isVisibleFocused: true
  itemList: []
```

**Focused** means the stack belongs to the view drawn directly on the canvas, not keyboard focus. **Embedded** means its view is drawn inside another view's card or stack item. Both visibility flags default to `true`; setting both to `false` hides the title everywhere. A title bar wraps long text and takes space from the scrolling body without changing the outer node's size.

For mixed content, use `itemList` instead of `text`:

```yaml
data:
  titleBar:
    isVisibleEmbedded: false
    isVisibleFocused: true
    itemList:
      - { id: name, type: text, text: Verification report }
      - id: status
        type: component
        comp: ReportStatus
        data: { count: 299 }
  itemList: []
```

Each title item needs a unique nonempty `id`. Text is plain text, not HTML. `ReportStatus` is an example component name: register your component with `placementList: ['visualizationTitle']`. Component items use the standard registry boundary and receive `{ data, config, onEvent }`; no function or import path is stored in the diagram. `config.visualization` supplies `nodeId`, `titleItemId`, `anchorRef`, and `presentation: { path, isEmbedded, isFocused }`. Components should fit their available width and use `onEvent` for the normal page event routing. Their controls neither drag the canvas nor trigger the surrounding view's click navigation.

Omitting `titleBar` preserves the existing `title`, `subtitle`, `icon`, `statList`, and `isChromeHidden` behavior. An explicit `titleBar` takes precedence over those legacy chrome settings; if its `text` and `itemList` are both omitted, it uses `data.title` as text. The title's `itemList` is separate from the stack's scrolling `data.itemList`.

<!--renderComp=CardDiagramSwitch,height=520,title=A stack-->
```yaml
version: 1
viewList:
  - path: /list
    label: Sections
    diagram:
      nodes:
        - id: go-first
          renderer: { type: card-brief }
          position: { x: 0, y: 0 }
          size: { width: 180, height: auto }
          link: /list#first
          data: { title: To the first, icon: arrow-right-left, tone: teal }
        - id: go-third
          renderer: { type: card-brief }
          position: { x: 0, y: 70 }
          size: { width: 180, height: auto }
          link: /list#part
          data: { title: To the last, icon: arrow-right-left, tone: teal }
        - id: stack
          renderer: { type: view-stack }
          position: { x: 230, y: 0 }
          size: { width: 620, height: 460 }
          data:
            title: Sections
            icon: layers
            tone: blue
            statList: [4 items]
            itemList:
              - { id: first, view: /list/first, title: A wide table, icon: table, tone: teal }
              - { id: figures, node: { renderer: { type: card-note }, data: { title: A card, text: An item may be a card too, tone: amber } } }
              - { id: second, view: /list/second, title: Two cards, icon: layers, tone: violet }
              - { id: part, view: /list/first, box: { x: 0, y: 0, width: 620, height: 110 }, title: A part of the first, icon: table, tone: green }
  - path: /list/first
    label: The first
    diagram:
      nodes:
        - id: table
          renderer: { type: table }
          position: { x: 0, y: 0 }
          size: { width: 620, height: auto }
          data:
            name: orders
            fields: [{ id: name, label: Column }, { id: type, label: Type }]
            rows:
              - { id: a, name: id, type: uuid }
              - { id: b, name: customer, type: lookup }
              - { id: c, name: total, type: currency }
              - { id: d, name: status, type: choice }
              - { id: e, name: note, type: text }
  - path: /list/second
    label: The second
    diagram:
      nodes:
        - { id: a, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 260, height: auto }, data: { title: One, text: A card, tone: blue } }
        - { id: b, renderer: { type: card-note }, position: { x: 320, y: 0 }, size: { width: 260, height: auto }, data: { title: Two, text: Another card, tone: green } }
```

| Key of an item | Meaning |
| --- | --- |
| `id` | unique in the stack; `/path#id` scrolls to it |
| `view`, or `node` | a view, as wide as the item; or a card written as a node of a diagram |
| `box`, `padding` | a region of the view; the margin around it |
| `link` | what a click opens; the view of the item by default |
| `title`, `subtitle`, `icon`, `tone` | its title line, with its number among the titled items; without a title, no line |

The stack itself takes `title`, `subtitle`, `icon`, `tone`, `statList` and `isChromeHidden`, and a numeric `size`. A state of an [animation over views](#under-the-animation-layer) may name an `item` too.

## The bounding box

The **box** of a view is the part shown by default, and shown when the view is embedded. Without one, it is everything drawn. The button at the right of the path bar shows it as a red frame, to drag and resize; a view without one gets one around what it draws. In a block with inline data the box is written into the block; the red frame never appears in a picture.

Write it as `box: { x, y, width, height }` of the view, or as a node, which is also how a view has **regions** for its embeddings to name:

```yaml
- { id: whole, renderer: { type: view-box }, position: { x: 0, y: 0 }, size: { width: 900, height: 600 } }
- { id: focus, renderer: { type: view-box }, position: { x: 100, y: 80 }, size: { width: 300, height: 200 }, data: { name: Orders only } }
```

The first node is the default box; `data.box: focus` of an embedding shows the other one. In a diagram being edited visually, the bounding box is in the panel of new nodes, and resized by its corners.

## Tabs

A view can arrange nodes of another view in tabs. Each tab has a path of its own, below the path of the view:

```yaml
- path: /overview/tabs
  label: In tabs
  tabs:
    of: /overview                                # the view whose nodes are arranged
    id: reports                                  # the id of the header node
    position: { x: 0, y: 500 }
    size: { width: 1200, height: 700 }           # of the member shown; no height: its own
    memberList:
      - { id: plan, label: Plan, tone: violet }
      - { id: run, label: Run, tone: amber }
```

A line to a member not shown goes to its tab; a line between two members not shown runs between their tabs, dashed.

<!--renderComp=CardDiagramSwitch,height=500,path=/report/tabs,title=Reports in tabs-->
```yaml
version: 1
defaults:
  connection: { renderer: { type: smoothstep }, markerEnd: arrowClosed }
viewList:
  - path: /report
    label: Three reports
    diagram:
      nodes:
        - id: tool
          renderer: { type: card-brief }
          position: { x: 310, y: 0 }
          size: { width: 280, height: auto }
          data: { title: The tool, icon: workflow, tone: violet }
          handles: [{ id: out, direction: out, anchor: { side: bottom } }]
        - id: plan
          renderer: { type: card-note }
          position: { x: 0, y: 140 }
          size: { width: 280, height: auto }
          data: { title: Plan, text: What is to be done, tone: violet }
          handles: [{ id: in, direction: in, anchor: { side: top } }, { id: out, direction: out, anchor: { side: right } }]
        - id: run
          renderer: { type: card-note }
          position: { x: 310, y: 140 }
          size: { width: 280, height: auto }
          data: { title: Run, text: What was done, tone: amber }
          handles: [{ id: in, direction: in, anchor: { side: top } }, { id: side, direction: in, anchor: { side: left } }, { id: out, direction: out, anchor: { side: right } }]
        - id: verify
          renderer: { type: card-note }
          position: { x: 620, y: 140 }
          size: { width: 280, height: auto }
          data: { title: Verify, text: What was found, tone: green }
          handles: [{ id: in, direction: in, anchor: { side: top } }, { id: side, direction: in, anchor: { side: left } }]
      connections:
        - { id: tool-plan, source: { nodeId: tool, handleId: out }, target: { nodeId: plan, handleId: in } }
        - { id: tool-run, source: { nodeId: tool, handleId: out }, target: { nodeId: run, handleId: in } }
        - { id: tool-verify, source: { nodeId: tool, handleId: out }, target: { nodeId: verify, handleId: in } }
        - { id: plan-run, source: { nodeId: plan, handleId: out }, target: { nodeId: run, handleId: side } }
        - { id: run-verify, source: { nodeId: run, handleId: out }, target: { nodeId: verify, handleId: side } }
  - path: /report/tabs
    label: In tabs
    tabs:
      of: /report
      id: reports
      position: { x: 0, y: 140 }
      size: { width: 900 }
      memberList:
        - { id: plan, label: Plan, tone: violet }
        - { id: run, label: Run, tone: amber }
        - { id: verify, label: Verify, tone: green }
```

## Under the animation layer

A switching viewport can move between **states** under the clock of the [animation](comp-card-diagram-animation.md): a state names a view, and a transition plays the way between two views. A component generating its views passes them to `SwitchAnimation` with this part of the document:

```yaml
stateList:
  - { id: overview, name: Overview, view: /overview, description: All of it }
  - { id: detail, name: Detail, view: /overview/detail, box: focus }
transitionList:                                  # absent: the states run as a chain
  - { from: overview, to: detail, name: Open, second: 1.2 }
```

## Reading and editing

Reading writes nothing but the box the reader adjusted. The source of a block is edited as a yaml text. A diagram with a red bounding box is edited visually in a `CardDiagram` or a `DiagramER` block.
