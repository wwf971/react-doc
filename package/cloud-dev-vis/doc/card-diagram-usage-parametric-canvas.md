---
title: Drawing on a Card Diagram
description: The parametric canvas of a card diagram, for authors - draw with tools, place things by rules that a number changes, shapes, text, patterns, colors.
language: en
---

A card diagram can be drawn on, as a canvas: a **tool bar** over it while it is edited, shapes and words beside the cards, and **groups placed by rules**, so a layout is rearranged by changing a number instead of dragging every card again. It is the parametric canvas, a feature layer of the [card diagram framework](card-diagram.md); this page says how to use it. How it is built is in [Card Diagram Parametric Canvas: Design](card-diagram-parametric-canvas.md).

## Turning it on

A diagram offers the drawing layer while it is edited when its viewport names it:

```yaml
viewport:
  featureList: [ parametric-canvas ]
```

What it draws (shapes, text, the groups of the section `parametric`) is data of the diagram and is drawn wherever the diagram is read, whether or not the viewport names the layer. A diagram generated from data again at every change does not name it: what is drawn by hand would be lost the next time. A diagram made partly from data may.

## An example

Press **Edit**, then: drag *In stock?* to the side, only its gap changes and *Ship it* follows; click the name **Order flow** on the canvas and change the gap of the row in the panel; double-click the empty canvas and type a few words, then Enter.

<!--renderComp=CardDiagram,title=Drawing with groups-->
```yaml
version: 1
viewport:
  size: { height: 380 }
  featureList: [ parametric-canvas ]
nodes:
  - id: title
    renderer: { type: text }
    data: { text: Handling an order, textSize: l, weight: bold }
    handles: []
  - id: start
    renderer: { type: shape }
    size: { width: 120, height: 64 }
    style: { fill: green }
    data: { shape: ellipse, text: Order in }
    handles:
      - { id: in, direction: in, anchor: { side: left } }
      - { id: out, direction: out, anchor: { side: right } }
  - id: check
    renderer: { type: shape }
    size: { width: 140, height: 96 }
    style: { fill: amber, stroke: amber }
    data: { shape: diamond, text: In stock? }
    handles:
      - { id: in, direction: in, anchor: { side: left } }
      - { id: out, direction: out, anchor: { side: right } }
  - id: ship
    renderer: { type: shape }
    size: { width: 140, height: 64 }
    style: { fill: blue }
    data: { shape: rounded, text: Ship it }
    handles:
      - { id: in, direction: in, anchor: { side: left } }
      - { id: out, direction: out, anchor: { side: right } }
  - id: remark
    renderer: { type: text }
    data: { text: "every step 60 apart: one number", textSize: s, tone: slate }
    handles: []
connections:
  - { id: start-check, source: { nodeId: start, handleId: out }, target: { nodeId: check, handleId: in } }
  - { id: check-ship, source: { nodeId: check, handleId: out }, target: { nodeId: ship, handleId: in } }
parametric:
  groupList:
    - id: flow
      name: Order flow
      root: { x: 0, y: 0 }
      memberList:
        - { id: title, node: title }
        - id: steps
          layout: { type: array, direction: row, gap: 60, align: 0.5 }
          parent: title
          constraint: { type: beside, side: bottom, gap: 24, align: 0 }
        - { id: start, node: start, parent: steps }
        - { id: check, node: check, parent: steps }
        - { id: ship, node: ship, parent: steps }
        - id: remark
          node: remark
          parent: start
          constraint: { type: beside, side: bottom, gap: 14, align: 0 }
```

## Drawing

| To | Do |
| --- | --- |
| add something | click a tool on the bar, then the canvas. A tool placing by a box (a shape, a color block) is dragged out to its size; its chevron lists the other ways it can be placed, and its parameters |
| add words, or anything by name | double-click the empty canvas. Words typed are a **text** there (Enter); `/` names what to add, `/note`, `/shape-diamond`, `/table`, in the slash menu of the page |
| change what is selected | its edit card: beside it, or docked in the panel under the canvas (the head of the panel switches it) |
| resize what is selected | drag a resize handle on the frame of the selection: a corner keeps the ratio (Shift: any shape), an edge changes one side; a card as high as its content changes its width. The other way round with the setting `DiagramResizeCorner: free` |
| type words where they stand | click them: the words of a shape, a text, a label of a color block |
| move, reorder, remove, put under another | right-click a card, a line or an item of the tree of the panel (its tab **Structure**) |
| find something in a large drawing | the tree of the panel: its search, and a long level shown a page at a time, with a filter of its own |
| color a node | its edit card, **Style**: a tone, none, or a color of your own ([The style of a node](card-diagram-impl.md#the-style-of-a-node)) |

Escape or a right-click lets an armed tool go; Ctrl/⌘ + Z takes back any step.

## Groups placed by rules

A **parametric group** has one free place, its **origin** (the round mark with its name). Everything in it is a **member** following one or more parents, the origin or other members, by a **constraint**:

| Constraint | Written | The member stands |
| --- | --- | --- |
| offset (the default) | `{ type: offset, x, y, point?, pointParent? }` | a point of its own at an offset from a point of its parent |
| beside | `{ type: beside, side, gap, align?, shift? }` | on a side of its parent, its edge at a gap from the facing edge |
| between | `{ type: between, t, x?, y?, point?, pointA?, pointB? }`, with `parentList: [a, b]` | a part of the way between a point of each of its two parents |

A drag on the canvas changes the constraint, not a position: drop a member and its gap, its offset or its place in a row is written. A member put under another parent, given another constraint, or taken out of its group stays where it stands. A **point** is a point of a box: `center`, `top`, `bottom-left` …, `{ side: top, offset: 0.667 }` or `{ x: 0.2, y: 0.9 }`. It is not a handle where lines attach: those belong to the lines, and a constraint does not follow them ([Points, handles and anchors](card-diagram-parametric-canvas.md#points-handles-and-anchors)).

## Layouts and patterns

A **layout member** places nothing itself and arranges what is put under it; a child of a layout has no constraint of its own.

| Layout | Written | Arranges |
| --- | --- | --- |
| array | `{ type: array, direction: row \| column, gap, align }` | its children one after another; a drop reorders them |
| repeat | `{ type: repeat, count, direction, gap }` | its one child spawned `count` times |
| grid | `{ type: grid, columns, gapX, gapY }` | its children in rows of `columns`, each column as wide as its widest |

A layout is drawn with a dashed frame and its name (a row named *Stages*, say), also when the diagram is read; its edit card turns that off (**Framed when read**, `isFramedWhenRead: false`), and the frame then shows only while the diagram is edited, faded. A pattern is not framed when read unless its card turns it on.

A **pattern** is a layout whose children fill named **slots**: what each slot is to the others is fixed, only its parameters change. A tool of **Patterns** makes it whole, its slots filled; a member put under a pattern takes a free slot, and a pattern whose slots are all filled says so.

| Pattern | Slots | Parameters |
| --- | --- | --- |
| Captioned (`caption`) | `subject`, `caption` | `side` of the caption, `gap`, `align` |
| Badged (`badge`) | `subject`, `badge` | `corner`, `inset` |

<!--renderComp=CardDiagram,title=A grid and two patterns-->
```yaml
version: 1
viewport:
  size: { height: 330 }
  featureList: [ parametric-canvas ]
nodes:
  - { id: s1, renderer: { type: card-brief }, data: { title: orders, icon: database, tone: blue }, handles: [] }
  - { id: s2, renderer: { type: card-brief }, data: { title: customers, icon: database, tone: blue }, handles: [] }
  - { id: s3, renderer: { type: card-brief }, data: { title: products, icon: database, tone: blue }, handles: [] }
  - { id: s4, renderer: { type: card-brief }, data: { title: invoices, icon: database, tone: teal }, handles: [] }
  - { id: s5, renderer: { type: card-brief }, data: { title: payments, icon: database, tone: teal }, handles: [] }
  - id: box
    renderer: { type: shape }
    size: { width: 150, height: 80 }
    style: { fill: violet }
    data: { shape: rounded, text: The report }
    handles: []
  - { id: box-caption, renderer: { type: text }, data: { text: once a day, textSize: s, tone: violet }, handles: [] }
  - id: tagged
    renderer: { type: shape }
    size: { width: 150, height: 80 }
    data: { shape: rect, text: A new table }
    handles: []
  - { id: tag, renderer: { type: text }, style: { fill: amber }, data: { text: New, textSize: s, weight: bold }, handles: [] }
parametric:
  groupList:
    - id: tables
      name: Tables
      root: { x: 0, y: 0 }
      memberList:
        - { id: grid, layout: { type: grid, columns: 3, gapX: 16, gapY: 12 } }
        - { id: s1, node: s1, parent: grid }
        - { id: s2, node: s2, parent: grid }
        - { id: s3, node: s3, parent: grid }
        - { id: s4, node: s4, parent: grid }
        - { id: s5, node: s5, parent: grid }
        - id: report
          layout: { type: caption, side: bottom, gap: 6, align: 0.5 }
          parent: s4
          constraint: { type: beside, side: bottom, gap: 36, align: 0 }
        - { id: box, node: box, parent: report, slot: subject }
        - { id: box-caption, node: box-caption, parent: report, slot: caption }
        - id: badged
          layout: { type: badge, corner: top-right, inset: 4 }
          parent: box
          constraint: { type: beside, side: right, gap: 60, align: 0 }
        - { id: tagged, node: tagged, parent: badged, slot: subject }
        - { id: tag, node: tag, parent: badged, slot: badge }
```

## Shapes and text

Two kinds come with the layer, in every diagram whose series has it:

| Kind | Data | Notes |
| --- | --- | --- |
| `shape` | `shape: rect \| rounded \| ellipse \| diamond \| triangle \| hexagon \| parallelogram`, `text`, `textSize: s \| m \| l`, `strokeWidth`, `isDashed` | drawn to the size of its node; its fill and its edge are its style |
| `text` | `text`, `textSize: s \| m \| l \| xl`, `weight: bold`, `align`, `tone` | as wide as its words, or, with `size: { width }`, wrapped at that width (its height following); `style: { fill }` puts a color behind them (a badge) |

Their words hold icons as the rest of the framework's texts do: `/icon` where they are typed, `{{icon:database}}` written.

A text's box is chosen in its edit card, **Size** › **Box**: *Fits the words* (the default: the box follows the words, Shift + Enter breaks a line, nothing to resize) or *A width, the words wrap* (its width set there or by the handles on its sides, its height following the words). Switching keeps the box it has, so nothing moves.

## In a block of scenes

A [block of scenes](card-diagram-usage-flexible-switch.md) offers the layer for every scene it edits when the document names it at its top, `featureList: [ parametric-canvas ]`; a scene of its own may name it in its viewport instead. A scene a provider makes and lets be edited in place offers it with `edit.featureList` ([A scene edited in place](card-diagram-flexible-switch.md#a-scene-edited-in-place)).

## For an agent

What the bar, the panel and the edit card do is an api of every diagram component whose series has the layer (the command palette lists none of them; call them through the api of the page):

| Api | Does |
| --- | --- |
| `parametricGroupListGet` | the groups, each member with what it places, follows and how, a summary and its box; the constraint and layout types, the tools |
| `parametricGroupAdd` | a group with its origin at a place, taking in free nodes |
| `parametricMemberAdd`, `parametricMemberRemove` | a free node into a group; a member out of it |
| `parametricMemberParentSet` | a member under another parent, where it stands |
| `parametricMemberSet` | another constraint type, or a parameter of its constraint or its layout |
| `parametricToolPlace` | what a tool makes (or a `create` of its own) at a place, into a group or free |

Each is a command of the editor: on the draft of a session that is open, undone like any step, else written into the block.
