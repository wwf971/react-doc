---
title: Using the Card Diagram Framework
description: How to draw with card diagrams, by hand or from data, and what to check before calling a diagram done.
---

This is the document to read when you want to **draw** with the framework, by hand or from a generator. It says what there is, how to choose, and what makes a diagram good. To change the framework itself, read [card-diagram.md](card-diagram.md) instead.

A diagram is node cards joined by connection lines on a canvas, written as YAML. The same format is used by all of these:

| You want | Use | Read |
| --- | --- | --- |
| one diagram | `CardDiagram` (generic cards), `DiagramER` (with Power Platform cards), `DiagramAws` (with AWS cards) | [Data diagrams](../comp-mdx/power-platform/comp-diagram-er.md), [AWS diagrams](../comp-mdx/aws/comp-aws.md) |
| a diagram moving between named states | `CardDiagramAnimation`, `DiagramERAnimation` | [Card Diagram Animation](card-diagram-usage-animation.md) |
| many diagrams in one viewport, switched by path, one inside a card of another | `CardDiagramSwitch`, `DiagramERSwitch`, `DiagramAwsSwitch` | [Card Diagram Scenes](card-diagram-usage-flexible-switch.md) |
| to shape a line by hand | anchors and handles on any of them | [Connection Lines](card-diagram-connection-line.md) |
| to draw by hand with tools (shapes, words, patterns), or keep a group placed by rules that one number changes | `viewport.featureList: [parametric-canvas]` on any of them | [Drawing on a Card Diagram](card-diagram-usage-parametric-canvas.md) |
| to try something out | [the playground](card-diagram.playground.md), a document git ignores, under **Playground** in the side panel (a fresh clone has none: the item creates it) | [Playground documents](../../../main/doc_page_impl_test.md#playground-documents) |

Each feature layer has a usage document of its own beside this one, named after it: [card-diagram-usage-animation.md](card-diagram-usage-animation.md) (states), [card-diagram-usage-flexible-switch.md](card-diagram-usage-flexible-switch.md) (scenes), [card-diagram-usage-parametric-canvas.md](card-diagram-usage-parametric-canvas.md) (drawing, groups placed by rules). This document says when to reach for one; the details are there.

## The smallest diagram

```yaml
version: 1
nodes:
  - id: a
    renderer: { type: card-note }
    position: { x: 0, y: 0 }
    size: { width: 180, height: auto }
    data: { title: Start, tone: blue }
    handles: [{ id: out, direction: out, anchor: { side: right } }]
  - id: b
    renderer: { type: card-note }
    position: { x: 320, y: 60 }
    size: { width: 180, height: auto }
    data: { title: End, tone: green }
    handles: [{ id: in, direction: in, anchor: { side: left } }]
connections:
  - { id: a-b, source: { nodeId: a, handleId: out }, target: { nodeId: b, handleId: in }, label: { text: then } }
```

The grammar of cards, handles and lines is in [Data diagrams](../comp-mdx/power-platform/comp-diagram-er.md).

## Which card for what

Reach for a card that exists before drawing one of your own: each already knows its anchors, its views, its sizes and how it reads embedded. Every renderer below is a `renderer: { type }` of a node.

| To show | Use | Notes |
| --- | --- | --- |
| a table, a list of fields, anything in rows and columns | `table` | its own fields and rows; [views](../comp-mdx/power-platform/comp-diagram-er.md#table-card-views) choose rows, a row break hides some behind a mark a reader can open; `rowGroupList` brackets rows; a line can leave a row (`row/{id}`) |
| a Dataverse table, an option set | `dataverse-table`, `dataverse-choice` (`DiagramER` and the Power Platform series) | key, logical name, type; the purple convention of a choice ([Dataverse table card](../comp-mdx/power-platform/comp-diagram-er.md#dataverse-table-card)) |
| a step of a process | `operator`; in a column mapping `operator-mapping`, `operator-text`, `operator-abandon` | a label and a note; the mapping operators are the steps a column goes through |
| a short fact: a title, a line of text, a few figures | `card-note` | a tone; the default for anything that is not a table |
| an item in a list (a file, a batch, a table among many) | `card-brief` | a pill: an icon, a title, a line of figures; as wide as its words with `isWidthFit` |
| a few settings of the whole diagram, or of something with no card of its own | `card-label` | a pill as wide as its words (*Settings*); what it carries is the `propertyList` of its data, shown and changed in the edit card beside it ([labels](card-diagram-impl.md#labels)): not a card of settings |
| what a diagram says of each row of a card (how a column is compared, what an option is written as) | `fieldExtraList` of the card | a further column of the card itself, a choice or a text ([the table card](card-diagram-impl.md#the-table-card)): not a second card beside it, nor words on its lines |
| what a long series leaves out | `card-three-dots` | "298 batches" between the first and the last; a line may leave the dots, without the square of a handle (`isMarkerHidden`) |
| a database, a store | `card-database` | a cylinder with its name inside |
| a thing among many, in a graph of what relates to what | `card-icon`, with `card-caption` over a group | a small round mark with its name beside it, a dot for its state; lines end on the mark (`anchor: { target: icon }`). In a narrow place, laid out by the [outline arranger](card-diagram-arrange.md#the-outline-arranger) |
| which of a set relates to which | `card-matrix` | rows and columns with a mark where they meet; a cell may be a [link](card-diagram-usage-flexible-switch.md#a-link-to-a-scene) |
| many things to find and open (hundreds, thousands) | `card-index` | small cards of two names in a grid, in groups, each a link; one node however many ([the index](card-diagram-impl.md#node-registries)) |
| what the looks of a diagram stand for | `card-legend` | a card or a line as drawn, with words, pinned to a corner of the viewport (`pin: top-right`) so it stays while the reader moves; folds to its title line. **Use it for any legend** ([Legends](#legends)) |
| a graph of hundreds or thousands of things (what looks up what in a whole database) | `card-graph` | each thing a small square or a label and the lines between them, in one node; a search finds each thing by its names, a pointer on one lights its lines ([Many things in a graph](#many-things-in-a-graph)) |
| a flow or a rule of Power Platform | `power-automate`, `business-rule` | trigger, action, condition, scope ...; a Dataverse condition or action |
| a resource of AWS: an http api, a function, a table and the kinds of its rows, a bucket, a user pool, a role, a log group, a group of routes | `aws-http-api`, `aws-lambda`, `aws-dynamodb-table` ... (`DiagramAws`) | a resource card in the accent of its family ([AWS diagrams](../comp-mdx/aws/comp-aws.md)) |
| a place, a lane, a group, outputs | `color-block` | behind the cards; `style: { fill: none }` for a frame; `around` what it holds ([below](#background-color-blocks)) |
| the part of a scene shown first, and when embedded | `scene-box` | a red frame, drawn only while it is adjusted |
| another scene, small, opening on a click | `scene-embed` (switch layer) | with `viewHover` a preview while the pointer rests on it |
| sections one under another, each at full width | `scene-stack` (switch layer) | scenes or cards; at full height embedded or focused; views of a scene as tabs in an item |
| a way to another scene | `scene-link` (switch layer), or `link` on any card or line | a pill as wide as its words |
| some cards of one diagram in tabs | `switchTabsApply` (switch layer, `scene-tabs`) | each tab a scene of its own; lines are rewired, never dropped ([Tabs](card-diagram-usage-flexible-switch.md#tabs)) |
| something no card draws | `renderer: { component: Name }` | a registered component with the placement `visualizationNode`, listing its anchors ([Custom nodes](../comp-mdx/power-platform/comp-diagram-er.md#operators-custom-nodes-and-line-styles)); a title bar or a menu item takes components the same way (`visualizationTitle`, `labelItemList`) |

A card's background is not a property of its kind: any card that has a surface takes `style: { fill: blue }` beside its data (a tone, `none`, or a color like `#fde68a`; a color block also `stroke`, its edge), set in the edit card under **Style** ([The style of a node](card-diagram-impl.md#the-style-of-a-node)). Prefer a tone: it follows a dark page. A series (a node registry) adds its own kinds; what a diagram may use is the registry of its component, and an unknown kind is an error naming the known ones. The **blocks** of a document are in the table at the top: one diagram, an animation, scenes. A scene of the switch layer gets its title over it when focused from the layer itself ([below](#focused-and-embedded)), not from a card.

## Lines out of the bottom of a card: the footer

A card made of rows (a table, a resource card, a DynamoDB table, a group of routes: any kind with a schema) ends with its last row. A line leaving that edge would seem to leave the last row, or the last field. So a line about the card as a whole that leaves downward leaves from the card's **footer**: a strip under its rows, as wide as the card, in the muted color of its head, with the small square of each handle on it.

```text
 ┌──────────────────────────┐
 │ ▣ {prefix}--api   Lambda │   the title line: lines from the left or right
 ├──────────────────────────┤
 │ Runtime      python3.12  │
 │ Memory       512 MB      │   rows: a line about one row leaves its row
 ├──────────────────────────┤
 │      □            □      │   the footer: lines leaving the card downward
 └──────┼────────────┼──────┘
        ▼            ▼
```

**Showing it.** `data.footer` on the node: `true` shows an empty strip, a text shows the strip with a few words in it (`footer: 3 more environment variables`). Without it, the footer is shown exactly while a handle stands on it, so a card nothing leaves downward keeps its old height.

**Handles on it.** Two ways to write one, which are drawn the same:

```yaml
handles:
  # the card as a whole, at its bottom: drawn on the footer
  - { id: out, direction: out, anchor: { side: bottom } }
  # the footer itself: at its bottom, or beside the strip, under the rows
  - { id: logs, direction: out, anchor: { target: footer, side: bottom, offset: 0.75 } }
  - { id: note, direction: out, anchor: { target: footer, side: right } }
```

- **The card as a whole, at its bottom** (`side: bottom`, the target `body` left out). This is what a series writes for "out at the bottom", and every existing diagram keeps working: the handle is drawn on the footer, at its offset.
- **The footer itself** (`target: footer`) on `bottom`, `left` or `right`. Use `left` or `right` for a line that leaves the card sideways yet is about the whole card, not a row: it leaves under the rows rather than beside the last one.

**Connecting to them.** A footer handle is a handle like any other: a connection names it by the node and its id, `source: { nodeId: function, handleId: out }`. Its routes, labels and anchors work as everywhere. A line arriving from below is written the same way, with `direction: in`.

**In the editor.** The tab of a card has a **Footer** section: *Shown*, and its *Text*. *Shown* cannot be turned off while a handle stands on the footer (the note says why). Under it, **Footer handles** adds or removes a handle on each of its sides. On the card itself, with the pointer over the footer, a `+` on its bottom edge adds one. All of these are steps of the history.

**Arranged.** A [layer arranger](card-diagram-arrange.md#the-layer-arrangers) turns the handles of lines going down to the bottom. A card whose footer appears that way is counted taller by the footer, so the next layer does not move up under it.

**Drawn simple**, a node has no footer: its bottom handles stand under its name (the anchor `foot`, [below](#when-a-node-changes-its-look-its-lines-stay-attached)). Its lines leave from the same side in both displays.

A card that is not made of rows (`card-note`, `card-brief`, `card-database`) has no footer: its bottom edge already is the card. A component of your own lists the anchors it has, and gets no footer from the framework.

## Moving and switching

**To move a diagram between states**, wrap it: `CardDiagramAnimation` takes `diagram` and a `stateList`. Each state names what it hides, shows and changes, and the wrapper plays between them. The reader clicks a state or presses Play. A diagram can be animated without being changed, and cards can be shared by several animations (`nodeDefineById`).

**To show many diagrams in one viewport**, give each a path: `CardDiagramSwitch` takes `sceneList: [{ path, label, diagram }]`, and a path bar goes between them. A card of the kind `scene-embed` shows another scene inside it and zooms into it on a click, and a `scene-stack` is a scrolling list of scenes. Scenes may be written in the document or generated from data: whatever has scenes is a [provider](card-diagram-flexible-switch.md#the-concepts).

**To show one scene more than one way**, give it `viewList`: it shows one view at a time, and `viewDefault` says which, also by how the scene is presented and which scene embeds it. `viewHover` is what a card embedding it shows while a pointer rests there. A menu switches between them ([Views of a scene](card-diagram-usage-flexible-switch.md#views-of-a-scene)). This is the view of a scene; [a table card has views](../comp-mdx/power-platform/comp-diagram-er.md#table-card-views) in the same way.

**To show many of one kind in one place**, make them the views of one scene with `viewSwitcherLayout: tabs` (and `isViewSearchable: true` once there are more than a handful): where a stack embeds it, a row of tabs and a search field stands under the item's title, one tab per view, and the item keeps the height of the tallest, so choosing one moves nothing ([Views as tabs](card-diagram-usage-flexible-switch.md#views-as-tabs)). A report listing every mapping, every table, every pattern one under another grows with the data; one item with tabs stays one item.

**Reach for the switch layer early.** A diagram that does not fit, that a reader has to scroll around to read, or that mixes an overview with details is usually several scenes: an overview whose cards open the details (`scene-embed`, a click zooms in), a report as a stack of its sections, the same thing in views. Generated diagrams especially: a generator can make a scene per item for free, and a scene per item can be read at its own scale. One canvas holding everything at once is right only when everything has to be seen at once.

Routes of lines work the same in all of them, also in a scene embedded in a card.

## Detailed and simple

A node of a kind that has one can be drawn two ways: **detailed**, as the card of its kind, and **simple**, as a mark with its name under it (a circle, a rounded square, a cylinder, with the icon of the kind), for a picture of a whole system at a glance. The resource cards, the tables and the databases have one; a note, a block or a scene does not.

```yaml
defaults:
  node: { display: simple }     # every node that can be drawn simple
nodes:
  - id: bucket
    renderer: { type: aws-s3-bucket }
    display: detailed           # this one keeps its card
```

In the editor, **Drawn as** in the tab of a card switches one node, and the shapes button of the bar switches all of them; both are steps of the history. The data, the handles and the lines are the same in both displays: only how the node is drawn changes. Two levels of detail of one system are therefore two views of one scene with the same ids, an overview drawn simple and the resources as cards: switching between them moves each card into its mark ([Views of a scene](card-diagram-usage-flexible-switch.md#views-of-a-scene)). A mark is smaller than its card: let an [arranger](card-diagram-arrange.md#the-layer-arrangers) place the simple view again rather than reusing the positions of the cards. The design is in [The display of a node](card-diagram-impl.md#the-display-of-a-node).

## When a node changes its look, its lines stay attached

A node is drawn differently in many places: simple or detailed, a card embedding another scene that shows a cylinder at rest and a diagram under the pointer, a table card switched to another view, the same id in two scenes. Its handles then stand somewhere else, and the lines must still arrive naturally. These are the ways to keep them so, from the one that costs nothing to the one that moves the most:

| Method | What it does | Where it is used |
| --- | --- | --- |
| **Keep the side, move the end** | A handle keeps its id, its side and its offset in every look; each look only says on which of its parts it is drawn. So a line keeps arriving from the same direction and slides along that side, and its route, whose anchors follow the two ends (`along`), keeps its shape | the framework itself: never give a handle another side in another look |
| **One box for every look** | Every look is drawn at the size of the node, and touches its box where the handles are, the middle of a side. The ends do not move at all | the database of the [migration](power-platform-migration.md#scenes): a `scene-embed` whose view at rest is a cylinder filling the card (`isFrameHiddenEmbedded`), with its handles on the card; a node drawn simple at a size of its own, whose mark fills the box above its words |
| **Keep the middle** | A smaller look stands in the middle of the place of the larger one, so a line from above or below keeps its line | a simple mark is drawn in the middle of the width its node has; a generator placing two views places by the middle |
| **A coarser anchor for what is not drawn** | A part a look does not draw (a row of a card, on a mark) hands its handles to the part that stands for it, at the same side and offset. Handles that then meet are one end of their lines, which may share the last stretch into it ([the rule](#no-lines-on-top-of-each-other)) | a node drawn simple: every handle on its mark; a row left out by a table view: its handle on the side of the card |
| **Out of the way of the words** | A line leaving a mark downward starts under its name, not on the mark, so it crosses no words | the bottom handles of a node drawn simple (the anchor `foot`) |
| **Route each look again** | When a look moves things more than a little, its lines get their routes for that look: an arranger per view in a generator, **Arrange** after switching in the editor | the overview and the resources of [the storage service](~aws-utils:aws-utils/doc/storage-architecture.md) |

Between two views sharing ids, a switch moves each node into its new place and fades its old drawing into the new one, and the lines of both views fade between their routes: nothing more is to be done there. Whichever method is used, look at every look again, as below: a line that was clear in one may cross something in another.

## Focused and embedded

A scene of the switch layer is seen two ways, and a generator should think of both every time it makes one: **embedded**, inside a card or a stack item of another scene, small, named by that card's title line; and **focused**, on the canvas alone, at its own scale, after a click. What reads well in one does not in the other. Typical points:

- **A title.** Focused, nothing around the scene says what it is any more, and the path bar holds only short words. Give each scene, and each view, a `title` that stands alone: the kind and the name ("Schema mapping — Account → Customer", "PW — Source database"), not just the last segment of its path. The layer draws it as a heading above the scene, in its world, so it zooms with the cards, and only where the scene is focused ([The title of a scene](card-diagram-flexible-switch.md#the-title-of-a-scene)). Leave it out (`isTitleHidden`) where the content already starts with its title, as a stack with a title bar does.
- **Which view.** A view meant to be glanced at in a card (a cylinder, a summary) is rarely the one to read focused (the diagram, a matrix): `viewDefault` by presentation says which, and `isAvailableEmbedded` / `isAvailableFocused` keep a view from where it does not work ([Views of a scene](card-diagram-usage-flexible-switch.md#views-of-a-scene)).
- **How tall.** Embedded, a stack scrolls in its card or grows to its full height (`isHeightFullEmbedded`); focused, the reader zooms and scrolls freely. A frame or a label placed by numbers around something of `height: auto` is wrong in one of the two: draw it `around` what it holds.
- **How deep.** A scene inside a card inside a card is drawn smaller each level, and costs a drawing each. The presentation says how deep a scene is drawn (`depth`) and how deep the block draws (`depthMax`, 3 by default, a parameter of the block): past it a card shows a note and opens its scene on a click. A generator nesting scenes deeply lowers it, or lets a card draw less when its `depth` is high.
- **What a click does.** Embedded, a click on the card opens the scene; focused, the cards inside are what clicks reach. Controls drawn in a title line (a view switcher, tabs) work embedded only where the card takes the pointer; in a static copy they are drawn inert, at the same size, so nothing moves.

## Search

Every diagram can be searched: the magnifier (in the path bar of a block of scenes, beside the zoom buttons of a diagram of one scene) or, with the pointer over it, `mod+f` opens a bar at the top right of the viewport, as in a code editor ([Search](card-diagram-impl.md#search)). It reads the data, so rows behind a break are found, and in scenes the scenes inside cards as deep as the bar says. Nothing is to be done for the cards of the framework. A kind of your own is found by the words of its data, by its schema when it has one; it answers `contract.searchMatch` when what it shows is not the words of its data, and `contract.searchCellTextGet` when a variant draws a cell otherwise than its value ([Adding a kind](card-diagram.md#adding-a-kind)). Write the words a reader would look for into the data (a logical name beside a display name), and the search finds them.

## Background color blocks

`color-block` is a lightly colored rectangle with a list of labels, at its bottom or, with `labelSide: top`, at its top. Use it for locations, swimlanes, groups of outputs, and other backgrounds behind the cards. With `style: { fill: none }` it is a frame instead: no tint, a solid border in its tone. Use that for a container of cards that already have colors of their own (the reports of a project, the outputs of a step), where a tint behind them would compete with theirs. A frame around cards whose height is not known in advance (`height: auto`, a stack at full height) is written `around: { nodeIdList, padding }` instead of a position and a size: it is drawn around those cards as they are measured ([Around other nodes](card-diagram-impl.md#around-other-nodes)).

```yaml
id: source-area
renderer: { type: color-block }
position: { x: -20, y: -40 }
size: { width: 240, height: 400 }
data:
  tone: blue
  itemList:
    - { id: database, text: '{{icon:database}} Source database' }
    - { id: name, text: PW }
handles: []
```

`itemList` may be empty, for a block with no label. Each item has a unique `id` and a `text`; `level: 1` or `2` makes it a title, larger and on a line of its own. `columnList: [{ id, x, width, text? }]` with `columnTop` draws columns inside the block, in its own pixels (from its outer edge: the block's edge is drawn over it and takes no room, so columns up to its width end at its right edge rather than past a border), for what reads as columns without a block in the block. A text is a text of the cell edit layer: **an icon is written among its words**, `{{icon:NAME}}`, quoted in YAML since it starts with a brace; the names are those of `CARD_ICON_BY_NAME` (`database`, `server`, `file`, `archive`, `cloud` ...). Tones are `blue`, `teal`, `green`, `amber`, `red`, `violet` and `slate` (the default).

A block has no handles and does not own or move what lies on it. It is always drawn behind the lines and the cards, whatever the order in the data. While reading, the pointer passes through it; while editing it is selected and moved like a card, resized by its corners, the words of a label or a column are typed where they stand (`/icon`, or `{{icon:`, puts an icon among them; a click on an icon changes it), a label typed empty goes, the **+** at the corner of the block selected adds one, and a label under the pointer has a grip to move it among the others and a button to take it away (a block may keep no label). Its tone and the side of its labels are set in its edit card, its fill and its edge under **Style**. Leave room for its labels when placing cards on it.

`card-three-dots` (`data: { direction?: vertical | horizontal, text?, tone? }`) stands for what is left out of a long series of cards. A table card takes `data.badge`, a short word before its name.

## Legends

**When the looks of a diagram mean something, give it a `card-legend`: do not draw one of your own** (a note listing colors, a block of small cards, an html panel beside the canvas). One kind of legend keeps every diagram read the same way, and it is the one the framework pins to the viewport.

- **What it says.** `data.groupList`: groups with a title (*Kinds of table*, *Kinds of line*), each entry a `swatch` (a card in its tone and variant, as the compact cards draw it: `{ tone, variant: dashed | bar }`) or a `line` (`{ color, dash, width, opacity, isArrow }`, as the diagram's line style says), with its words. Write only the kinds the scene draws, from the same constants the scene is drawn with, so the two cannot drift apart.
- **Where it stands.** Write it with `pin: top-right` (or `top-left`, `bottom-right`, `bottom-left`) and no position: it stands in that corner of the viewport, the same size whatever the zoom, over the canvas, and goes nowhere when the reader pans ([Nodes pinned to the viewport](card-diagram-impl.md#nodes-pinned-to-the-viewport)). A pinned node takes no line, has no place in a layout or in the bounds a camera fits, and is not searched; it folds to its title line (the button on it, or `data.isFolded`). A diagram without a canvas draws it in the corner of its block. A scene embedded in a card draws no pinned node: a legend belongs to the scene focused.
- **See-through.** `data.opacity` (0.1 to 1, 1 by default) is how much of its panel stays: below 1 the diagram shows through it, its words and samples staying whole (a light blur under them keeps them read over lines). A reader turns it either way with the button beside the fold (◐): that choice is remembered for every legend, on every page, and goes before what the legend says (`cardLegendTranslucentRead`); see-through without an opacity of its own is 0.55. Write `opacity` for a legend over a busy canvas; leave it for the reader otherwise.
- **In a generator.** One small builder of the legend per family of scenes, taking the kinds present, used by every scene of the family ([the migration](power-platform-migration.md#one-database-alone): `legendNodeBuild`).

## Many things in a graph

A graph of a few dozen things is cards and lines. One of hundreds or thousands (every table of a database and what looks up what) is not: a node per thing costs a canvas too much to draw, and nobody reads a thousand cards. Draw it by how many there are, and keep every thing findable:

| how many | each thing | how |
| --- | --- | --- |
| up to about 150 | a card of its names (`card-note`) | a node each, straight lines between the sides facing each other |
| up to about 10,000 | a label of its name | one `card-graph`, `shape: label`, spread wider the more there are rather than shrunk: a label is read when zoomed in, a square never is |
| more | a small square in its tone | one `card-graph`, `shape: square`: its names show where a pointer rests and where a search finds it |

- **Place it by its lines, free.** A graph with no order of its own (no flow, no rank) is placed by the [scatter arranger](card-diagram-arrange.md#the-scatter-arranger): what a line joins stands near, a thing joined to many stands among them, what is joined to nothing apart. A graph to be read is placed `free` (no grid: each where its lines put it, at its own size, `spread` times the room it takes); `grid` is for cards an editor goes on moving. For a `card-graph` the generator calls its layout itself (`diagramScatterLayout`, the same code), since the things are not nodes.
- **Search.** Write both names of a thing into its item (`title`, `text`): the search of the canvas finds it by either, frames it, and brings the camera to it, zoomed until it is read; every square found is framed, and the one the search is on (or under the pointer) shows its names: the names of all would cover each other where matches sit side by side.
- **Say what it is.** A [legend](#legends), pinned, says the kinds of things and of lines.

## Drawing conventions

What a diagram should look like, whoever draws it:

- **A list wraps.** Do not lay out many cards in one row, or fitting the whole diagram makes them small. A list on a canvas breaks into lines at a small count (four or so), and a generator breaks them itself. A chain that must read in one direction may turn downward rather than run on. Stacking by a meaning (rows by rank, columns by depth) is better still.
- **The labels of lines side by side stand in one column.** Give lines running side by side, as the column mappings between two tables do, one label position. Do not stagger them to keep them apart: a row is taller than a label, and labels that jump left and right are harder to read down.
- **A label is in the words of the page.** The label of a line, of a static scene, of a simple card: the sans-serif of the page, 12 px for a line (`.doc-switch-edge-label`, the text of a line of React Flow, `.doc-diagram-static-label`), never a monospace font, which reads as code. The placer of labels estimates them at that size (`labelSizeEstimate`). Code stays monospace where it is code (an attribute name, a route path of an AWS card).
- **A line meets an icon node at its words.** On its right, a line ends just after the end of the words, however short they are: the anchor `text` of the `card-icon` (`anchor: { target: text, side: right }`, 12 px after the words, `TEXT_ANCHOR_GAP`), never the right edge of the node, which is often as wide as its column and would leave a stretch of nothing between the words and the line. On its left a line ends at the mark (`target: icon`). A row of a list (`isCompact`) is met the same way. An arranger estimates the anchor past the node's edge when the words fill it, so no lane stands behind where a line starts ([the lane router](card-diagram-arrange.md#the-lane-router)).
- **A line to a table as a whole ends at its title line.** It is what a table card does by itself with a handle on the left or right side of the card (`anchor: { side: left }`). A line about one row ends on that row. Do not place a handle at the middle of a table's side by other means.
- **A line leaving a card downward leaves its footer**, never the edge under the last row ([the footer](#lines-out-of-the-bottom-of-a-card-the-footer)). Writing `side: bottom` on the card is enough.
- **A link is a `scene-link`.** A node whose job is to open another scene uses the kind made for it ([A link to a scene](card-diagram-usage-flexible-switch.md#a-link-to-a-scene)), with no width written, so it is as wide as its words and every link in a scene looks the same. Do not make a link out of a `card-brief` or a `card-note`. A card that shows something may still have `link`, so a click opens more of it.
- **A margin around what is held.** A card holding other cards keeps a margin inside its border, so nothing inside touches it. [An embedded scene](card-diagram-flexible-switch.md#one-canvas-no-canvas-inside-a-canvas) has this by default.
- **One table can be seen several ways.** A table card can declare views, plain, by column or by row, with a menu to switch between them ([Table Card Views](../comp-mdx/power-platform/comp-diagram-er.md#table-card-views)).
- **A long table is cut down to what matters here.** `rowDisplay` picks the rows of a table card, in any order, with a row break for what is left out, which can hold those rows for the reader to open ([Table Card Views](../comp-mdx/power-platform/comp-diagram-er.md#rows-behind-a-row-break)).
- **What is long scrolls.** In a card of many sections, prefer a [scrolling stack](card-diagram-flexible-switch.md#a-scrolling-stack) to shrinking all of them to fit.
- **No lines on top of each other.** This is the one most often broken: [next section](#no-lines-on-top-of-each-other).
- **A scene generated from data gets its layout from an arranger.** [Below](#a-scene-generated-from-data-gets-its-layout-from-an-arranger).

### No lines on top of each other

**Check every diagram for this before it is done.** Two lines that share a stretch look like one line, and the reader can no longer tell where each goes. So no two lines share a stretch, not even a part of it, with these cases to know:

| Lines | What is allowed |
| --- | --- |
| Crossing at a right angle | Fine: they do not share a stretch. |
| With nothing in common | No shared stretch at all. |
| **Sharing one endpoint** (one node handle) | **The final segment into that endpoint may overlap, because they all arrive at one point. This is the only exception.** Before it, each line has its own way: three lines into one handle have three lanes that join only on the last segment. |
| **Sharing both endpoints** | The same exception at each end, and **they must keep some internal segment apart**. Otherwise one hides the other completely, and the reader sees one line where there are two. |

It is the common defect of automatic layout. React Flow routes every line alone, with no knowledge of the others, and bends each at the middle between its two ends. So lines leaving side by side towards places side by side bend at the same height and run together, and lines crossing the same gap between columns use the same middle. A layout that looks tidy in the data usually has this, and **it is seen only by looking at the drawn diagram**.

So work in rounds, looking and adjusting:

```text
 draw it ──► look at it ──► lines together? ──yes──► give one a route ──┐
    ▲                            │ no                                   │
    └────────────────────────────┼──────────────────────────────────────┘
                                 ▼
                               done
```

1. **Look.** Take a picture of the diagram and look at it, zoomed in enough to see the gaps between cards. Do this for each scene.
2. **Ask for what the eye misses.** `connectionOverlapListGet` ([the apis](card-diagram-connection-line.md#the-apis)) lists the right-angled lines of each canvas on the page that break these rules, each pair with the `length` it shares and a `kind`: `stretch` for a shared length beyond the final segments, `whole` for two lines between the same endpoints where one has nothing of its own. An empty list is necessary and not sufficient: it does not look at curves or at lines over cards, and a diagram can be free of overlaps and still hard to read.
3. **Separate them**, by the means that fits, the simplest first:
   - **Move a card or a node handle**, if it was standing in the way. Two lines leaving one side can leave at different offsets.
   - **Give one line an anchor** to put it in a lane of its own: in the editor, double-click the line and drag the anchor; through the [apis](card-diagram-connection-line.md#the-apis), `connectionAnchorAdd`. The [playground](../../../main/doc_page_impl_test.md#playground-documents) has a diagram to practice on.
   - **Apply an [arranger](card-diagram-arrange.md)**, which gives every line a lane of its own at once: **Arrange** in the edit panel, the api `diagramArrangerApply`, or from a generator, where it runs again on other data. It replaces the anchors of the lines, so apply it first and adjust by hand after.
4. **Look again.** A new lane may have made a new crossing or covered a label.

Two patterns come up again and again when doing it by hand. Lines fanning out from one card to cards on one side each take their own level, the one leaving farthest out the highest, so that they do not cross each other (`along: 0.5` with a `y` offset). Lines crossing the gap between two columns take one vertical lane each (`along: 1` with an `x` offset into the gap), and of those going to one card, the one coming from farthest turns nearest the card.

### A scene generated from data gets its layout from an arranger

**When you write logic that generates a scene from data, consider an [arranger](card-diagram-arrange.md) for its layout.** Such a scene is usually not editable, because the next update of the data would rebuild it and lose any edit. So hand-placed cards and anchors are not available to it, yet it should still be well laid out, and it has to stay that way on data nobody has seen yet.

An arranger fits this: its rules run on whatever the data is now, every time the scene is built, and the generator only says what the cards and lines are.

```text
 data ──► generator: the cards and lines ──► arranger: where they go ──► the scene
```

- **Apply an arranger, rather than computing positions and routes inside the generator.** Layout logic inside one generator serves only that scene, while an arranger can be improved in one place and reused by other scenes.
- **If no arranger fits, consider writing one** before tuning the generator case by case ([Adding or updating an arranger](card-diagram-arrange.md#adding-or-updating-an-arranger)).
- **Still look at the result.** An arranger works from estimated sizes when nothing is drawn yet, so check a generated scene [as any other](#no-lines-on-top-of-each-other), on real data.

A diagram people edit by hand can use the same arrangers, as a first layout or re-applied when asked: **Arrange** in the edit panel, at any time, and one undo puts everything back. There, the result becomes the author's data. So both kinds of block are laid out by the same rules: a scene derived from data gets them every time it is built, a diagram drawn by hand whenever its author asks. A system read downward (a request passing an api, a function, a table) has the [layer arrangers](card-diagram-arrange.md#the-layer-arrangers): **Layers, top to bottom** places the cards and routes the lines, the **Route the lines** ones keep the cards where the author put them.

### A matter of taste: show how it happens, then what came of it

These are not rules a validator could check; they are what has been seen to read well and badly on real diagrams.

| Better | Worse | Why |
| --- | --- | --- |
| a **process**: what goes in, what happens to it step by step, what comes out, each step a card joined by lines | a **pile of tables**, section after section | a reader looks at a report to understand what was done. Tables say what the numbers are and leave the reader to work out what they mean |
| the figures **on the step they belong to**: a batch card saying `49 succeeded / 1 failed`, in red | the same figure in a row of a table | it answers "where did that happen", and the one thing wrong stands out in the picture |
| a **short card of totals that opens the table** | the table itself, large, in the overview | the table is still there for whoever needs it: it is a scene of its own, a click away. A detail is switched to, not stacked |
| **one concrete case worked through**: one row, what its source holds, what is expected, what the target has | only the rule, or only the totals | a rule becomes clear on an example |
| a **small vocabulary of shapes** that mean the same across diagrams: the table with its brackets, a card per batch, a red card for what was set aside | a new look per section | the second diagram is read with what was learned on the first |

The first thing to draw for any report is therefore the diagram someone would sketch to explain it on a whiteboard, with the actual figures written on it. Tables come last. In the [migration](power-platform-migration.md#scenes), the run report and the verification report are drawn this way.

## Before calling a diagram done

| | Check |
| --- | --- |
| ☐ | It was looked at: a picture of every scene, at a zoom where the gaps can be seen |
| ☐ | [No two lines share a stretch, beyond the final segment into a common endpoint](#no-lines-on-top-of-each-other), and `connectionOverlapListGet` agrees |
| ☐ | No line runs over a card or a label it has nothing to do with |
| ☐ | Every line leaves the part it is about: a row from its row, the card from its title line or [its footer](#lines-out-of-the-bottom-of-a-card-the-footer) |
| ☐ | Lists wrap, what is held has a margin, what is long scrolls |
| ☐ | A scene generated from data gets its layout from [an arranger](#a-scene-generated-from-data-gets-its-layout-from-an-arranger), or has a reason not to |
| ☐ | Where looks mean something, a [`card-legend`](#legends) pinned to the viewport says what, and no legend of its own was drawn |
| ☐ | A graph of hundreds of things is [drawn by how many there are](#many-things-in-a-graph), and each thing is found by a search |
| ☐ | Every look of a node was looked at, simple and detailed, each view: [its lines stay attached](#when-a-node-changes-its-look-its-lines-stay-attached) and arrive from the same side |
| ☐ | A process before tables, and figures on the steps they belong to |
