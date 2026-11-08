---
title: Card Diagram Scenes
description: CardDiagramSwitch shows many card diagrams in one viewport, by path, moving smoothly between them.
language: en
---

One viewport, many diagrams. `CardDiagramSwitch` holds **scenes**, each a [card diagram](comp-diagram-er.md) with a **path**. The path bar above the viewport shows where you are: click a segment to go there, or the chevron before it to see the scenes beside it. A scene can show another scene inside a card; clicking the card zooms into it. At any scene you can pan and zoom, and copy or download what you see as PNG or SVG. `DiagramERSwitch` is the same block with every card of the [Power Platform](comp-powerplatform.md) series.

The design is in [card-diagram-flexible-switch.md](card-diagram-flexible-switch.md).

## An overview with a card to zoom into

Click the card **Detail** (or the segment of the path bar, after that). The line's label and the note below it open scenes too.

<!--renderComp=CardDiagramSwitch,height=520,title=An overview-->
```yaml
version: 1
sceneList:
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
          renderer: { type: scene-link }
          position: { x: 0, y: 240 }
          link: /overview/moved
          data: { title: Open a scene with nodes in common, icon: arrow-right-left, tone: teal }
        - id: detail
          renderer: { type: scene-embed }
          position: { x: 360, y: 0 }
          size: { width: 480, height: 360 }
          data: { scene: /overview/detail, title: Detail, subtitle: another scene, inside a card, icon: table, tone: green }
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
          renderer: { type: scene-link }
          position: { x: 300, y: 120 }
          link: /overview
          data: { title: Back to the overview, icon: arrow-right-left, tone: teal }
```

## The document

| Key | Meaning |
| --- | --- |
| `sceneList` | the scenes: `path`, `label`, `description`, `diagram`, or [`viewList`](#views-of-a-scene) for more than one view of it, optionally `box`, `tabs`, `labelItemList` for [more than words in the menu](card-diagram-flexible-switch.md#the-path-bar), `title` (and a view's `title`) for the heading over the scene when it is focused, its `label` without one, or `isTitleHidden: true` for none ([The title of a scene](card-diagram-flexible-switch.md#the-title-of-a-scene)) |
| `root` | the scene shown first; the first of the list by default |
| `title`, `height` | the block; `data.height` of the marker wins, as `data.path` names another first scene |
| `defaults` | what every `diagram` starts with |
| `transition` | `secondPortal`, `secondMorph`, `secondCamera`, `secondScroll`: how long a step lasts |

A diagram is the [usual format](comp-diagram-er.md), with one more field on a node and on a connection, and on a cell of a [matrix](card-diagram-impl.md#node-registries): **`link`**, the path a click on it opens (`/path#item` also scrolls to an item of a stack there). On a connection, the label becomes the button.

Two conventions keep a scene readable, in a generator as by hand: a list of cards **wraps** instead of running on in one row, and what is long **scrolls** in a stack instead of shrinking ([Drawing conventions](card-diagram-usage.md#drawing-conventions)).

## A link to a scene

A node whose job is to open another scene is a **`scene-link`**: a pill with an icon and words, as wide as its words. Write no width.

```yaml
- id: to-mapping
  renderer: { type: scene-link }
  position: { x: 0, y: 240 }
  link: /overview/mapping
  data: { title: Schema mapping, icon: arrow-right-left, tone: teal, statList: [7 tables] }
```

`title` says where it goes, `statList` gives small words under it, and `icon` and `tone` are as on any card. Any other card can have `link` too, when it shows something and a click opens more of it, as a table opens its own scene.

## Showing a scene inside a card

```yaml
- id: detail
  renderer: { type: scene-embed }
  position: { x: 360, y: 0 }
  size: { width: 480, height: 360 }           # a numeric size: the scene fits inside it
  data:
    scene: /overview/detail                     # the path of the scene
    box: focus                                 # optional: a region of it (below), or { x, y, width, height }
    title: Detail                              # optional; the label of the scene by default
    subtitle: another scene
    icon: table
    tone: green                                # blue, teal, green, amber, red, violet, slate
    statList: [12 rows]
    isChromeHidden: false                      # true: only the scene, no title line
    padding: 0.03                              # the margin inside the card, a part of its size; this is the default
  handles: [{ id: in, direction: in, anchor: { side: left } }]
```

A box written or named shows that part alone; what lies outside it stays out, until a click opens the scene. A scene keeps a margin inside its card by default, so nothing of it touches the border of the card, also for a scene inside a scene inside a scene. The nodes of a scene keep their ids when several scenes show them: a switch between two scenes with nodes in common moves those nodes instead of replacing them.

## Views of a scene

A scene can have more than one view and shows one at a time, as [a table card](comp-diagram-er.md#table-card-views) does. Which one depends on how the scene is presented: focused on the canvas, or embedded, and if embedded, in which scene.

Below, **Orders** shows its cards in this overview, and its matrix while the pointer rests on it. Click the card to focus it: it opens at its detail view. Open **the summary** to see the same scene in another card, as a cylinder with no frame around it. The menu in a title line or the path bar switches between views.

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

| Key of a scene | Meaning |
| --- | --- |
| `viewList` | `[{ id, label?, description?, diagram, box?, isAvailableEmbedded?, isAvailableFocused?, isFrameHiddenEmbedded? }]`, in place of the `diagram` of the scene. A scene without one has one view, its diagram |
| `viewDefault` | the view shown: an id, or the rules below; the first available view without one |
| `viewHover` | the view shown while a pointer rests on a card embedding the scene: an id, or the rules below. None without one |
| `isViewSwitcherHidden`, `isViewSwitcherHiddenEmbedded`, `isViewSwitcherHiddenFocused` | no menu: anywhere, in what embeds it, in the path bar |
| `viewSwitcherLayout` | `menu` (the default) or `tabs`: [views as tabs](#views-as-tabs) where a stack item embeds the scene |
| `isViewSearchable` | with tabs, a field finding a view by the words of its label, description or id |

**The rules** are read in order and the first match wins. A view not available in that presentation is passed over.

```yaml
viewDefault:
  - { when: { embedder: /overview/summary }, view: matrix }     # embedded directly in this scene
  - { when: { embedder: [/reports/*, /plan] }, view: brief }    # below /reports, or in /plan
  - { when: { isEmbedded: true }, view: cards }                 # embedded anywhere else
  - { view: detail }                                            # otherwise: focused
```

`when` takes `isEmbedded`, `isFocused` and `embedder`. The embedder is the scene **directly** holding this one, which need not be its parent among the paths. In code, `viewDefault` may also be a function of the [presentation](card-diagram-flexible-switch.md#presentation-context).

**What is shown**, first to last: a view the reader chose there, what the embedding asks for (`view` on a `scene-embed` or an item of a stack), `viewDefault`, the first available. What the reader chose lasts while the block is on the page, separately for focused and for each scene embedding it.

**A hover view** replaces what a `scene-embed` shows while a pointer rests on it. A card may ask for another with `viewHover` in its data, or for none with `viewHover: false`. It is a preview of opening the card: a click zooms in through the hover view, and on the way back it stays on the card until the camera has left. A view the reader chose on a card stands, with no hover over it. Nothing happens on a touch screen, a card inside an embedded scene, or an item of a stack, whose height follows its view and would jump.

**A view alone in its card** (`isFrameHiddenEmbedded: true`) has no frame, title line or margin: a card showing it is just that view, filling the card. A line still ends at the side of the card, where a handle is, so **draw the view at the size of the card** and it reaches what the line arrives at; a `card-database` does, its wall being at the side and its curve at the top and the bottom. The title line keeps its room, so a card going between this view and a framed one moves nothing, and the frame fades in.

**A path can name a view**, wherever a path is written: `link: /overview/orders@matrix`, `data.path`, a state of an animation. A path naming no view opens the view chosen for focusing it.

```yaml
- id: orders
  renderer: { type: scene-embed }
  data: { scene: /overview/orders, view: matrix, title: Orders }    # this card asks for a view
```

### Views as tabs

Many things of one kind, each a diagram of its own (the mappings of a project, the tables of a database), are best one scene whose views they are, offered as tabs:

```yaml
- path: /plan/mapping
  label: Schema mapping
  viewSwitcherLayout: tabs
  isViewSearchable: true
  viewList:
    - { id: account, label: Account → Customer, description: account → customer, diagram: { ... } }
    - { id: order, label: Order → Order, description: salesorder → order, diagram: { ... } }
```

Embedded in a [stack](#a-scrolling-stack-of-scenes), the item shows a row under its title: the search field, then one tab per view in one line, moved sideways by the wheel or a drag, never with a scrollbar. A search keeps the tabs whose label, description or id hold every word typed, whatever the case; Enter shows the first, Escape empties the field. A tab shows its view at once, in the item, as the menu does; the item is as tall as the tallest view, so nothing below it moves. Focused (in the path bar) and on a `scene-embed` card the views keep the menu. Unlike [Tabs](#tabs), which arrange nodes of one diagram and make each tab a scene of its own, these switch in place and need no path per tab (the path may still name one: `/plan/mapping@order`).

The frame around the stack below is a `color-block` with `fill: none`, drawn `around` the stack ([Around other nodes](card-diagram-impl.md#around-other-nodes)), not at numbers of its own.

<!--renderComp=CardDiagramSwitch,height=520,title=Views as tabs-->
```yaml
version: 1
sceneList:
  - path: /plan
    label: Plan
    diagram:
      nodes:
        - id: frame
          renderer: { type: color-block }
          around: { nodeIdList: [stack], padding: { top: 52, right: 24, bottom: 24, left: 24 } }
          data: { tone: slate, fill: none, labelSide: top, itemList: [{ id: label, icon: archive, text: Outputs }] }
          handles: []
        - id: stack
          renderer: { type: scene-stack }
          position: { x: 0, y: 0 }
          size: { width: 620, height: 420 }
          data:
            title: Plan
            icon: layers
            tone: violet
            itemList:
              - { id: mapping, scene: /plan/mapping, title: Schema mapping, icon: arrow-right-left, tone: teal }
  - path: /plan/mapping
    label: Schema mapping
    viewSwitcherLayout: tabs
    isViewSearchable: true
    viewList:
      - id: account
        label: Account → Customer
        description: account → customer
        diagram:
          nodes:
            - { id: s, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: account, text: 4 columns, tone: blue }, handles: [{ id: out, direction: out, anchor: { side: right } }] }
            - { id: t, renderer: { type: card-note }, position: { x: 320, y: 0 }, size: { width: 180, height: auto }, data: { title: customer, text: 4 columns, tone: green }, handles: [{ id: in, direction: in, anchor: { side: left } }] }
          connections: [{ id: st, source: { nodeId: s, handleId: out }, target: { nodeId: t, handleId: in }, label: { text: copy } }]
      - id: order
        label: Order → Order
        description: salesorder → order
        diagram:
          nodes:
            - { id: s, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: salesorder, text: 9 columns, tone: blue }, handles: [{ id: out, direction: out, anchor: { side: right } }] }
            - { id: t, renderer: { type: card-note }, position: { x: 320, y: 120 }, size: { width: 180, height: auto }, data: { title: order, text: 8 columns, tone: green }, handles: [{ id: in, direction: in, anchor: { side: left } }] }
          connections: [{ id: st, source: { nodeId: s, handleId: out }, target: { nodeId: t, handleId: in }, label: { text: GUID } }]
      - id: product
        label: Product → Item
        description: product → item
        diagram:
          nodes:
            - { id: s, renderer: { type: card-note }, position: { x: 0, y: 0 }, size: { width: 180, height: auto }, data: { title: product, text: 6 columns, tone: blue }, handles: [{ id: out, direction: out, anchor: { side: right } }] }
            - { id: t, renderer: { type: card-note }, position: { x: 320, y: 0 }, size: { width: 180, height: auto }, data: { title: item, text: 5 columns, tone: green }, handles: [{ id: in, direction: in, anchor: { side: left } }] }
          connections: [{ id: st, source: { nodeId: s, handleId: out }, target: { nodeId: t, handleId: in }, label: { text: copy } }]
```

## A scrolling stack of scenes

A card fits a whole scene inside it, so a tall one gets small. A `scene-stack` holds **scenes and cards one under another in a scrolling area**, each as wide as the area: nothing shrinks to make everything visible. Scroll it with the wheel, which zooms the canvas again once there is nothing left to scroll; click a section to open its scene. The cards on the left scroll it from outside, by a link naming an item: `/list#part`.

### The stack as the outer container

When an overview card is a scrolling report, put a `scene-stack` directly in the overview. Do not wrap it in a `scene-embed` that contains another stack. Use the same node ID and content in its dedicated scene, changing only its position, size, handles, and overview link. Switching between these scenes then moves and resizes the stack itself.

```yaml
id: report:run
renderer: { type: scene-stack }
size: { width: 560, height: 420 }
link: /overview/run
data:
  focusPath: /overview/run
  isFrameVisibleFocused: true
  titleBar: Run report
  itemList: []
```

`focusPath` identifies the stack's dedicated scene. Elsewhere it has embedded presentation; in that scene it has focused presentation, including static masks and measurements. The overview title and its focus icon open that path. Custom title controls keep their own actions. Scrollbar dragging remains available in the overview; the wheel scrolls the stack in its focused scene.

Copies with the same node ID and `focusPath` share a saved scroll position. Their geometry remains separate, so overview and focused sizes may differ. A copy with less scrollable content clamps its displayed position without overwriting the saved position. Without `focusPath`, the existing per-scene scroll behavior is unchanged.

`isFrameVisibleFocused` defaults to `true`. Setting it to `false` hides the focused stack's border and background, not its scrolling behavior or items. Title visibility is controlled separately below. The three migration plan/report containers explicitly keep their frames and titles in both presentations.

### The height of a stack

A stack scrolls inside the height of its node, or takes the height of its items, with no scrollbar. Which one follows the presentation, like the frame and the title:

```yaml
id: report:run
renderer: { type: scene-stack }
size: { width: 560, height: 420 }   # the height it scrolls in, kept for when it is switched back
data:
  focusPath: /overview/run
  isHeightFullEmbedded: true
  isHeightFullFocused: false
  itemList: []
```

Both flags default to `false`. A stack showing a title bar has a button at its right end to switch; in a program, `store.stackHeightFullSet({ path, nodeId, isFull })` and `store.stackHeightIsFull({ path, nodeId })`, `path` defaulting to the current scene. A switch holds for the presentation the stack has in that scene while the block lives, and the other presentation keeps its own. At full height a scene opens fitted to the whole stack, so a tall one starts small, and the reader zooms in; a position to scroll to has no effect there. Switching on the canvas moves nothing but the bottom edge of the stack: the camera stays, the button stays under the pointer, and the items keep their width and scale, so what grows past the canvas is reached by panning. `height: auto` in `size` is another way to write a stack always at full height until switched. Which height applies is decided per scene: a stack without `focusPath` is focused in its own scene wherever that scene is shown, so only `isHeightFullFocused` applies to it.

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

**Focused** means the stack belongs to the scene drawn directly on the canvas, not keyboard focus. **Embedded** means its scene is drawn inside another scene's card or stack item. Both visibility flags default to `true`; setting both to `false` hides the title everywhere. A title bar wraps long text and takes space from the scrolling body without changing the outer node's size.

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

Each title item needs a unique nonempty `id`. Text is plain text, not HTML. `ReportStatus` is an example component name: register your component with `placementList: ['visualizationTitle']`. Component items use the standard registry boundary and receive `{ data, config, onEvent }`; no function or import path is stored in the diagram. `config.visualization` supplies `nodeId`, `titleItemId`, `anchorRef`, and `presentation: { path, isEmbedded, isFocused }`. Components should fit their available width and use `onEvent` for the normal page event routing. Their controls neither drag the canvas nor trigger the surrounding scene's click navigation.

Omitting `titleBar` preserves the existing `title`, `subtitle`, `icon`, `statList`, and `isChromeHidden` behavior. An explicit `titleBar` takes precedence over those legacy chrome settings; if its `text` and `itemList` are both omitted, it uses `data.title` as text. The title's `itemList` is separate from the stack's scrolling `data.itemList`.

<!--renderComp=CardDiagramSwitch,height=520,title=A stack-->
```yaml
version: 1
sceneList:
  - path: /list
    label: Sections
    diagram:
      nodes:
        - id: go-first
          renderer: { type: scene-link }
          position: { x: 0, y: 0 }
          link: /list#first
          data: { title: To the first, icon: arrow-right-left, tone: teal }
        - id: go-third
          renderer: { type: scene-link }
          position: { x: 0, y: 70 }
          link: /list#part
          data: { title: To the last, icon: arrow-right-left, tone: teal }
        - id: stack
          renderer: { type: scene-stack }
          position: { x: 230, y: 0 }
          size: { width: 620, height: 460 }
          data:
            title: Sections
            icon: layers
            tone: blue
            statList: [4 items]
            itemList:
              - { id: first, scene: /list/first, title: A wide table, icon: table, tone: teal }
              - { id: figures, node: { renderer: { type: card-note }, data: { title: A card, text: An item may be a card too, tone: amber } } }
              - { id: second, scene: /list/second, title: Two cards, icon: layers, tone: violet }
              - { id: part, scene: /list/first, box: { x: 0, y: 0, width: 620, height: 110 }, title: A part of the first, icon: table, tone: green }
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
| `scene`, or `node` | a scene, as wide as the item; or a card written as a node of a diagram |
| `box`, `padding` | a region of the scene; the margin around it |
| `link` | what a click opens; the scene of the item by default |
| `title`, `subtitle`, `icon`, `tone` | its title line, with its number among the titled items; without a title, no line |

The stack itself takes `title`, `subtitle`, `icon`, `tone`, `statList` and `isChromeHidden`, and a numeric `size`. A state of an [animation over scenes](#under-the-animation-layer) may name an `item` too.

## The bounding box

The **box** of a scene is the part shown by default, and shown when the scene is embedded. Without one, it is everything drawn. The button at the right of the path bar shows it as a red frame, to drag and resize; a scene without one gets one around what it draws. In a block with inline data the box is written into the block; the red frame never appears in a picture.

Write it as `box: { x, y, width, height }` of the scene, or as a node, which is also how a scene has **regions** for its embeddings to name:

```yaml
- { id: whole, renderer: { type: scene-box }, position: { x: 0, y: 0 }, size: { width: 900, height: 600 } }
- { id: focus, renderer: { type: scene-box }, position: { x: 100, y: 80 }, size: { width: 300, height: 200 }, data: { name: Orders only } }
```

The first node is the default box; `data.box: focus` of an embedding shows the other one. In a diagram being edited visually, the bounding box is in the panel of new nodes, and resized by its corners.

## Tabs

A scene can arrange nodes of another scene in tabs. Each tab has a path of its own, below the path of the scene:

```yaml
- path: /overview/tabs
  label: In tabs
  tabs:
    of: /overview                                # the scene whose nodes are arranged
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
sceneList:
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

A switching viewport can move between **states** under the clock of the [animation](comp-card-diagram-animation.md): a state names a scene, and a transition plays the way between two scenes. A component generating its scenes passes them to `SwitchAnimation` with this part of the document:

```yaml
stateList:
  - { id: overview, name: Overview, scene: /overview, description: All of it }
  - { id: detail, name: Detail, scene: /overview/detail, box: focus }
  - { id: matrix, name: Matrix, scene: /overview/orders, view: matrix }   # a view of a scene with views
transitionList:                                  # absent: the states run as a chain
  - { from: overview, to: detail, name: Open, second: 1.2 }
```

## Reading and editing

Reading writes nothing but the box the reader adjusted. The source of a block is edited as a yaml text. A diagram with a red bounding box is edited visually in a `CardDiagram` or a `DiagramER` block.
