# Card Diagram: Arrangers

An **arranger** arranges a diagram by a set of rules: it decides how lines run and, if it wants, where cards stand. It is a pure function from a diagram to a list of changes, kept apart from whatever asks for it. So one arranger serves three kinds of caller, and any arranger can change without them knowing.

```text
 a generator of a read-only scene ─┐
 a generator of a first layout  ──┼──► arranger ──► changes ──► the diagram
 the editor or an api, by hand  ──┘   (pure)
```

The contract is in `comp-mdx/card-diagram/DiagramArrange.js` and knows no kind of card. The base series has [the outline](#the-outline-arranger), [the rows](#the-rows-arranger), [the layer arrangers](#the-layer-arrangers) for a system read downward, and [the blocks](#the-blocks-arranger) for blocks of cards stood in columns; these and the arrangers of ER diagrams (`comp-mdx/power-platform/er-arrange/`) route their lines with [the lane router](#the-lane-router) of the base series.

## Using one

**A scene generated from data, not editable.** Build the nodes and lines, without caring where they go, and apply it every time:

```js
import { diagramArrangeApply } from '../card-diagram/DiagramArrange.js';
import { erArrangerColumns } from '../power-platform/er-arrange/er-arranger-list.js';

const { diagram, reportList } = diagramArrangeApply({ nodes, connections }, erArrangerColumns, { origin: { x: 0, y: 0 } });
```

**A first layout that people then edit.** The same call, once, and write the result into the data. After that the anchors and positions are ordinary data: the author changes them like any others, and nothing applies the arranger again unless asked. There is deliberately no field in the YAML that applies an arranger on load, since it would undo what the author did.

**By hand, again and again.** In edit mode, **Arrange** in the edit panel lists the arrangers of the component. An api does the same:

| Api | |
| --- | --- |
| `diagramArrangerListGet` | the arrangers of the component, and whether each applies to this diagram |
| `diagramArrangerApply { arrangerId, connectionIdList }` | applies one; with `connectionIdList`, only those lines change, and the others are kept clear of. Answers `reportList` |

Applying it in the editor is one step of the history, so one undo puts every card and anchor back. When the arranged cards no longer fit the canvas, use the fit button of the canvas: the camera is not part of what an arranger changes.

## What an arranger may do

**It owns the routes it answers.** The whole route of a line is replaced: its anchors are removed and created anew, whoever made them, and its end handles go too. This is what makes an arranger simple and its result predictable, and it is why applying one by hand is a thing to do on purpose, with undo behind it. Marking some anchors as out of its reach is [on the TODO list](../../../main/doc_page_impl_TODO.md#route-fixed-anchor).

It cannot change a locked card (`isPositionLocked`), or a line outside `connectionIdList`: `diagramArrangeRun` takes those out of whatever it answers.

## The contract

```text
arranger    { id, label, description,
             arrange(diagram, geometry, options) -> changes,
             geometryEstimate?(diagram, options) -> geometry,    for a caller with nothing drawn
             isApplicable?(diagram) -> boolean }                 may it be offered for this diagram

diagram    the authored data; never changed in place
geometry   { rectOf(nodeId) -> { x, y, width, height, isBackground } | null,
             endOf(connection, role) -> { x, y, side } | null }
changes    { positionById?, handleSideList?: [{ nodeId, handleId, side, offset? }],
             routeById?: { id: route | null }, labelPositionById?: { id: part of its line },
             reportList?: [{ kind, message, connectionId? }] }
```

**Geometry is passed in**, because only the caller knows where things are. The editor and the apis pass what the canvas measured when the diagram is drawn (`diagramCanvasGeometryBuild`), and the registry of the component (`options.registry`); a generator has nothing drawn, so the arranger's estimate is used. An estimate that knows no kind (`diagramGeometryEstimateBuild`, `DiagramArrangeOutline.js`) takes the written size of a node, else what its kind estimates for its content (`contract.sizeEstimate`: the table cards by their rows, the note card by its text), else the default of its kind, and asks the kind where an anchor is in that rectangle (`contract.anchorRectEstimate`, when the caller passes the registry); a handle on a node as a whole stands where its kind draws it (`contract.anchorBodyDrawn`: on the shape of [a mark](card-diagram-impl.md#marks)), on the outline of that anchor (`contract.anchorOutlineOf`). It is exact for cards whose sizes are written, as [icon nodes](card-diagram-impl.md#icon-nodes) are. The estimate models the sizes a card draws, wrapped rows and titles included, by the width of their words, but it stays an estimate, so **check a generated diagram when it is drawn**, as for any diagram: `connectionOverlapListGet`. A generator that cannot leave it to an estimate makes its first layout with the heights measured on the drawn diagram, written for the run and taken away again (the storage scenes of `aws-utils` were made so). An arranger placing cards routes against where the cards will be with `diagramGeometryMovedBuild`: an end whose handle keeps its side moves with its card; one turned to another side is placed by the arranger (`endChangedOf`).

**Handles turned and set apart.** An arranger placing cards may turn a handle to face the other end of its lines (`side`), and set handles that would meet on one side apart along it (`offset`): two lines leaving one point share a stretch, which [the rule of lines](card-diagram-usage.md#no-lines-on-top-of-each-other) allows only for one handle.

**A report says what was not done**, rather than failing: `skipped` (a line it does not handle), `narrow` (lanes closer than is readable), `overlap` (no free way found), `label` (no place for a label clear of the cards). The editor shows it in the edit panel, and the api answers it.

A store command, `arrangeApply(arranger, { geometry, ...options })`, applies changes to a draft; `diagramArrangeApply` applies them to plain data. Both start from `diagramArrangeRun`.

## The outline arranger

`outline` (`DiagramArrangeOutline.js`, offered by `CardDiagram`) is for a graph read downward in a narrow place: its nodes stand one under another, each on a row of its own, indented by a level the caller gives, and its lines run straight, vertical or horizontal, beside the rows. It uses height, not width.

```text
 ◯ above                 a line from the bottom (or top) of a node to the side of another turns
 │                       once, under (or over) the node it leaves. the lines leaving one handle
 ◯ above                 downward share that first stretch, a trunk, which is the stretch the
 └──◉ the one            rule of lines allows them to share: it ends at their common endpoint
      ├──◯ below
      └──◯ below         a line between two handles on the same side goes out into the margin
 ┌─────◯ another         on that side, along a lane of its own, and back in: the shortest
 └─────◯ that it uses    nearest the rows, so lines of one handle nest without crossing
```

| Option | |
| --- | --- |
| `levelById` | the indent of a row, 0 when absent; `indent` px each (22) |
| `gapBeforeById` | room over a row, to set groups apart; `rowGap` between any two rows (8) |
| `origin` | the top left of the first row |
| `laneGap` | between two lanes of a margin, and between the rows and the first (10) |
| `isPlaced: false` | keeps the nodes where they are, and routes only |
| `registry` | for the estimate |

The order of the rows is the order of the nodes. What it cannot route it reports as `skipped`: a line whose target is not on the way of a line leaving that side of its source, a curve, a free end. It knows no kind of card, so the structure (which node is above, below, beside which) is entirely the caller's: a caller lists the nodes in order, gives the levels, and chooses the side of each handle.

## The rows arranger

`rows` (`DiagramArrangeRows.js`) is for a graph read downward that is wider than an outline: its nodes stand each on a row of its own, **in the column its caller gives**, as the steps of a plan do (a step under the one whose rows it takes, what is computed for it a column to the right). Where the outline indents, it sets columns apart, and it leaves no line running along a node.

```text
 ◯ a ┄┄┄┄┄┄┄┄┄┄┄┐              a line from the side of a node to the top of one in another column, and one
 │              ▼              from the bottom of a node to the side of one in another column, turn once
 ◯ b            ◯ c            when the way down is free (a to c, d to e)
 ├───────┐      │
 ◯ f     │      ◯ d            a line that would run through nodes goes out on a level of the gap under the
 │       │      │              node it leaves, down a track of a channel, and in (b to g): the tracks of a
 ◯ e ────│──────┘              channel stand a lane apart, the shortest line nearest the column it goes to
 │       │
 ◯ h     └──◯ g
```

```text
 channel   the room left of a column (the margin left of the first; one more right of the last). A column
           stands as far from the one at its left as the tracks of the channel between them need
 track     a vertical stretch in a channel, kept for one line, next to the column the line goes to
 level     a horizontal stretch in the gap between two rows, where a line turns towards its channel (under
           the node it leaves) or towards its node (over the node it reaches). A gap is as high as its
           levels need
```

| A line | Runs |
| --- | --- |
| from the bottom of a node to the top of one in its column | straight down; past nodes of that column, by the channel left of the column |
| from the bottom of a node to the side of another | down its column and into that side, when the node stands on that side and no node of the column is in the way; else by the channel on that side of its target (`left`: left of the column of the target; `right`: right of it) |
| from the side of a node to the top of another | along its row and down, when the way down is free; else by a channel and the level over its target |
| between the sides of two nodes | by the channel on that side of its target, when its source faces it |

Lines sharing a handle share only the stretch at that handle, as [the rule of lines](card-diagram-usage.md#no-lines-on-top-of-each-other) has it: each has a level and a track of its own, the nearer its other end the higher its level and the nearer its track, so lines leaving one node do not cross each other. A line going straight down keeps an anchor half way: left to itself between two rows close to each other, it is drawn going down, back up and down again.

| Option | |
| --- | --- |
| `columnById` | the column of a node, 0 when absent |
| `gapBeforeById` | room over a row, to set groups apart; `rowGap` between any two rows (10) |
| `columnGap` | between two columns at least (24) |
| `laneGap`, `levelStep` | between two tracks of a channel (12), two levels of a gap (6) |
| `origin` | the top left of the first row of the first column |
| `isPlaced: false` | keeps the nodes where they are: their columns are read off their rectangles and their rows off their heights, and only the lines are routed. A channel or a gap too small for its lines is reported as `narrow` |
| `registry` | for the estimate |

The order of the rows is the order of the nodes. What it cannot route it reports as `skipped`: a line leaving a node upward or reaching one from below, a line to a node above its source, a side handle facing away from where the line has to go, a curve, a free end. **Where an end is at the end of the words of a node** (a handle on the right of the anchor `text` of an icon node), where that is is known for sure only when the node is drawn, so the corners of such a line are kept by its other end: the line then turns where it should whatever the words measure. It knows no kind of card, so the structure is entirely the caller's: the caller lists the nodes in order, gives the columns, and chooses the side of each handle. It is not in the list the editor offers (`arrangerList`), since it needs its columns from a caller.

## The layer arrangers

For a system read downward, in the order a request passes it (`DiagramArrangeLayers.js`, offered by `CardDiagram` and the AWS series). They know no kind of card, and route with [the lane router](#the-lane-router) turned a quarter: the diagram is read with x for y (the top of a card for its left), routed as columns, and the routes turned back.

```text
 ┌──────┐               layers      what a line goes to stands under what it comes from: one layer under the
 │ page │                           deepest card a line comes from; a card no line reaches, in the first. A
 └──┬───┘                           cycle is cut where it was entered
 ┌──┴───┐               order       the cards of a layer side by side, in the order they stand when they were
 │ api  │                           placed apart (an author's order is kept), else under the middle of the
 └──┬───┘                           cards their lines come from; each layer centered on the widest
┌───┴──────┐            handles     a handle on a card as a whole (body; on a mark, drawn on its shape) is turned
▼          ▼                        to face the other ends of its lines, and handles meeting on one side are
table    bucket                     set apart along it; a handle on a part (a row, the title line) keeps its side
```

| Id | Cards | Lines |
| --- | --- | --- |
| `layers` (**Layers, top to bottom**) | placed in layers, each gap as high as the lanes crossing it need; a locked card stays | every right-angled line in a lane of its own, measured with sharp corners (`measureType: step`), so two lines meeting in a bend are seen; labels placed |
| `lanes-down` (**Route the lines, cards in rows**) | stay where they are, read as rows | as `layers`, between the rows |
| `lanes-across` (**Route the lines, cards in columns**) | stay where they are, read as columns | as `er-lanes`, for any diagram |

`layers` is what a generator applies to a scene it makes, and what an author applies to a diagram drawn by hand, as often as wanted; `lanes-down` is for cards an author placed and wants to keep, as the resources of the storage service (`aws-utils`, `doc/storage-architecture.md`), with cards at the edge of the rows on purpose. A line between the sides of two cards of one row is not routed by either (reported `skipped`): it is left to its line type, which draws it straight when the sides face each other.

## The blocks arranger

`blocks` (**Blocks in columns**, `DiagramArrangeBlocks.js`, offered by `CardDiagram`) stands blocks of any height in columns of one width, the way a page of documentation stands its sections: **each block, in its order, goes where the columns it takes are lowest so far, and the gap between two columns is the gap between two blocks of a column**. **The lines between cards of two blocks get lanes in the gaps between the columns, each gap as wide as its lanes need.** A landing page made of blocks (the resources of an app by kind, each block headed by its kind and listing them; the groups of what hangs together) is laid out by it.

```text
 ┌ A ────┐  ┌ B ────┐  ┌ C ────┐       A, B, C first, a column each; D to the lowest column (A's);
 │       │  │       │  │       │       E, two columns wide, where its two columns are lowest together
 └───────┘  │       │  │       │
 ┌ D ────┐  │       │  └───────┘
 │       │  └───────┘
 └───────┘  ┌ E ───────────────┐
            └──────────────────┘
```

- **A block is a background card** (a color block: its contract says `isBackground`), or one the caller names (`blockIdList`). **A card belongs to the smallest block its rectangle stands in, and moves with it**, its place in the block kept: a caller writes each block with its cards anywhere (one under another is simplest) and the arranger stands them.
- **A block is one column wide, or as many as its width takes** (`columnWidth`, else the narrowest block's width; a block of two columns is two columns and the gap between them wide, a block a little wider takes one more, so none stands over the next column). A caller wanting the columns of the cards of its blocks to line up makes each block whole columns wide.
- **How many columns**: given (`columnCount`), else as many as make the whole nearest a shape (`aspect`, width over height, 1.8 by default), never fewer than the widest block takes nor more than every block side by side.
- **A block may be given its column** (`columnById`): stacked there in its order, the others going where it is lowest; the landing page of a tool whose columns are the steps something goes through, or the order a piece of work goes through its kinds.
- **The lines between cards of two blocks** (right-angled ones; `connectionIdList` names the only lines it may route, `[]` none): **a line leaves its card at the side facing the other block, both ends on the right when the two blocks share a column, runs along a lane of the gap it leaves into, across the columns between on a track clear of the blocks, and into the other card** ([the lane router](#the-lane-router), the blocks being what a line keeps clear of). The handle of an end is turned to that side, so a caller gives a card a handle per side it may be left from (of a row of a list: the anchor `text` on the right, so a line starts after the words however short they are, the mark on the left), or one a line. **A line turns `laneMargin` from a block at least** (40 px, whatever it meets: a row at the height of another's line is no exception), its lanes 12 px apart between: **each gap is as wide as its lanes need so**, never narrower than `gapColumn` (else `gap`). A line between two cards of one block is the block's own: its layout routes it (in the block, before the blocks are stood: a route follows its target, so it moves with the block), and the arranger leaves it alone.

| Option | |
| --- | --- |
| `origin` | the top left of the first column |
| `gap` | between two columns and between two blocks of a column (32) |
| `gapColumn` | between two columns at least, when it is another (gap) |
| `columnWidth` | the width of one column; else the narrowest block's |
| `columnCount`, `aspect` | the columns; else from the shape aimed at (1.8) |
| `columnById` | `{ blockId: column }`: a block that must stand in a column |
| `blockIdList` | the blocks, in their order; else every background card |
| `connectionIdList` | the lines that may be routed; else every right-angled line between cards of two blocks |
| `laneMargin` | px from a block to the nearest lane of a gap: where a line turns (40) |
| `registry` | for the estimate |

It is offered for a diagram with two color blocks or more (`isApplicable`).

## The scatter arranger

`scatter` (**Scatter by the lines**, `DiagramArrangeScatter.js`, offered by `CardDiagram` and the series of Power Platform) is for a graph with no order of its own: what looks up what among many tables, what talks to what. **What a line joins stands near, a card joined to many stands among them, what is joined to nothing stands apart**, so the lines are short on the whole. It is the layout of the relationships of a database ([the migration](power-platform-migration.md#one-database-alone)), where the order of a flow would leave hundreds of lines crossing a column.

```text
  1. each group of cards joined by lines apart, the largest first; a card joined to one other alone
     (a leaf) waits for it; in a group of more than 400, a hub (joined to more than a tenth of
     it, and to 40 at least: the table every table looks up) waits too
  2. a first place: a spiral, in the order a walk from the most joined card meets them
  3. forces, a bounded number of steps: a line pulls its two ends together (a hub less by each of
     its lines, so it stays among them); every card pushes every other away, the far ones by the
     groups of a quadtree (Barnes and Hut: about n log n a step); a little pull to the middle;
     each step moves less than the one before
  4. a hub at the middle of what it joins, a leaf beside what it hangs on (the leaves of one card
     fanned around it, in rings when they are many)
  5. no two cards on one place, by placement:
     grid  the group scaled to the room its cards need, then each card, the most joined first,
           takes the free cell of a grid nearest to where it stands (ring by ring around it; a
           ring found full is not searched again for the next card wanting the same cell)
     free  the group made as dense everywhere, in pixels (each card keeps its direction from the
           middle and its rank by distance from it, at the radius where as many stand nearer in
           a disk `spread` times the room the cards take); then each card, the most joined
           first, moves the least it must not to overlap one placed before (rings of places
           around it, a step half its height down or up and a quarter of its width aside)
  6. the groups packed in rows, what stands alone in a grid of its own (free: in rows, each at its
     own width), last
```

- **Grid or free.** `grid` (the default of the arranger) lines the cards up in rows and columns, each in a cell as large as the largest: what an editor arranges and goes on moving. `free` leaves each where its lines put it, at its own size, with air around: a graph to be read, where a grid would only add rows of empty cells and the look of a table. Without the evening out, the forces leave a crowded core (what is joined to much) and a sparse rim; one scale cannot make room in the core without sending the rim far off. The relationships of a database are placed free.
- **Why hubs wait**: pulled by its hundreds of lines, a hub drags everything to one heap, and the lines that mean something (the other lookups) are lost in it. Left out, the rest is placed by what else joins it, and the hub stands where its lines are shortest on the whole. A generator may draw the lines of a hub fainter (`diagramScatterHubSetOf(count, linkList)` says which they are), as the relationships of a database do.
- **Deterministic**: no randomness; the same graph is placed the same way. **What it computed is kept** for the graphs met last (16, in memory, by the cards with their sizes, the lines and the options): a scene built again from the same data, another canvas opened and this one again, costs nothing. It is not written anywhere: a graph of two thousand cards and five thousand lines is placed in about a quarter of a second (free: about a third), which a reader opening a view takes better than a stale layout of data that changed (six thousand things with their option sets: about half a second).
- **The handles**: one on the left or the right of its card turns to the side most of its lines go to; one on the top or the bottom stays. **Routes are removed**: a scattered graph is read best with straight lines (`renderer: { type: straight }`), from the side of a card facing the other.
- **Its core is a function** (`diagramScatterLayout(itemList, linkList, { gap, stepCount, placement, spread })` → the top left of each thing): what a generator calls for things that are not nodes, the items of a `card-graph` ([Many things in a graph](card-diagram-usage.md#many-things-in-a-graph)). `diagramScatterSideOf(rect, point)` is the side of a box facing a point.

| Option | |
| --- | --- |
| `origin` | the top left of what it places |
| `gap` | between two cards (28) |
| `stepCount` | the steps of the forces; else by the size of the graph (40 to 160) |
| `placement` | `grid` (default) or `free` |
| `spread` | free: the room of a group, times the room its cards take with their gaps (2.5); more air, longer lines |
| `registry` | for the estimate |

## The arrangers of ER diagrams

| Id | Cards | Lines |
| --- | --- | --- |
| `er-lanes` | stay where they are | every right-angled line gets a new route |
| `er-spread` | keep their columns and rows; a gap too narrow for its lanes grows, moving what stands right of it | as `er-lanes` |
| `er-columns` | move: what a line goes to stands at its right, tables stacked in columns, option sets below the first column using them; each gap as wide as the lanes crossing it need; handles turned to face each other | as `er-lanes` |

They are offered for any diagram of the series with a table on it (`isApplicable`). Curves and straight lines keep their routes, and a line with a free end is reported as skipped. All of them [place the labels](#labels), of curves too.

**Which one.** `er-columns` for a diagram of tables with no layout of its own to keep. `er-spread` for a diagram put together from parts that already mean something, as two arranged ER diagrams with lines between them: placing every card anew would lose what the parts say, and `er-lanes` alone would squeeze the new lines into gaps sized for the old ones. A line that should be routed like this has to be right-angled; a curve goes straight through whatever lies between its ends.

They route with [the lane router](#the-lane-router).

**What to expect.** On made-up schemas from 5 to 40 tables (`ErArranger.test.js` has the small ones), `er-columns` left no overlap and no line over a card, against up to 3800 overlapping pairs with lines routed by the default. On two made-up ER diagrams side by side, with a line per table across them (`er-spread`, 5 to 40 tables a side, with one or three lookups a table), no line stood over a card and no label over a card or another label. Overlaps stayed at zero up to 40 tables a side with one lookup a table, and at one pair at 20 tables with three; at 40 tables with three, 6 pairs overlapped among 274 lines, some of them for a long way. It does less well where several lines arrive at one table, each on a handle of its own at one place: with tables of the target chosen at random, so that some got several lines, the check counted from 1 pair at 5 tables to about 140 at 40. Crossings do not go away, and on a dense schema there are more visible ones, since lines no longer hide each other: it separates lines, it does not make a dense schema simple.

## The lane router

The routes of the right-angled lines of cards standing in columns, from the rectangles alone, in `DiagramArrangeRouter.js` (`diagramLinesRoute`), which knows nothing of tables; `diagramLineSceneGet` reads what it needs off a diagram and a geometry, and `diagramLabelsPlace` places the labels afterwards:

```text
 column   cards whose widths overlap: read off the rectangles, so placed-by-hand cards work too
 gap      the free space beside a column
 lane     a vertical track in a gap, for one line
 track    a horizontal stretch across columns, between their cards
 level    a horizontal stretch just above or below a card with a handle on top or bottom
```

A line between two neighbouring columns has one lane, a line further than that has a lane beside each end and a track between them, and a line to a handle on top of a card has a lane and a level. A gap's lanes stand in an order that keeps lines of one kind from crossing each other: of lines going to one card, the one coming from farthest turns nearest the card. The anchors follow the target (`along: 1`).

The lanes of a gap share it evenly with its two edges. **With `laneMargin`, no lane stands nearer the sides of its gap than that**, so a line turns clear of the card or block it leaves, not against it: the lanes stand evenly between the two margins, and a place is kept at each margin for a line that must turn before or after all the others (two rows at one height; without a margin that place is halfway to the card). A side of the gap is then the farther of its column and of the ends of the lines leaving that column into it: an end can stand past its card (the anchor `text` of an icon node is 12 px after the words, `TEXT_ANCHOR_GAP`, past the node when they fill it), and a lane behind where its line starts would make the line turn back. A gap too narrow for its margins and lanes 12 px apart is shared evenly. The arrangers `lanes-across`, `lanes-down` and `blocks` take the option; a caller sizing its gaps counts `2 × laneMargin + 12 × (lanes + 1)` (`diagramLaneWidthOf`: the lanes and the two kept places), and the room an end stands past its card. `lanes-across` and `lanes-down` also take `labelBand` ([a band of labels](#labels)): a side of a gap is then also past the band of the labels of the lines leaving its column there.

Lines are placed one after another and each is **checked against those already placed**, by the same rule as [the overlap check](card-diagram-usage.md#no-lines-on-top-of-each-other): the preferred place first, then others. So what no order can foresee, such as two rows at one height in different columns, is found and avoided. A candidate is measured as its line type draws it, or, with `measureType: 'step'`, with sharp corners: a rounded corner shortens the runs it joins, and two lines meeting in a bend would pass as apart.

**What it does not do.**

- A line leaving and arriving through a top or bottom handle is skipped (in a diagram read downward, the layer arrangers turn it into one between sides).
- `er-lanes` does not move anything, so cards placed in a staircase read as one column and their lines go around it, and a narrow gap gets narrow lanes (reported as `narrow`). `er-spread` also keeps the rows, so it cannot make room between rows: a line finds a way between the cards as they stand, or around them.
- A handle has one side, so where lines come to one handle from both sides, as in some cycles, the fewer go around their card.

## Labels

An arranger may answer where the label of a line goes (`labelPositionById`), as a part of the line's length, the same number as `label.position`. `labelPositionListPlace` in `comp-mdx/card-diagram/DiagramLabelPlace.js` works it out from rectangles and paths alone, for any arranger and any line type:

```text
each label tries places along its line, about one per 16 px, and the place the author wrote
a place costs what it would cover:   a card              most of all
                                     another label       next
                                     near a card, other lines, a bend of its own line   a little
                                     leaving the place written                          least
the labels are placed shortest line first, having the fewest places, then each again knowing
where the others went, until nothing moves (at most 4 rounds)
```

So with nothing in the way a label stays where it was written. The size of a label is estimated from its words, since nothing is drawn yet. A label with no place clear of the cards is reported as `label` and stands where it covers least. It moves only labels of lines in scope (`connectionIdList`); applied by hand, a move is part of the same undo step.

**A band of labels.** Placed one by one, the labels of lines leaving the rows of a table scatter along their lines, each dodging the others, though they read best one under another ([usage](card-diagram-usage.md)). With `labelBand` the lane router keeps a band beside each column, on the side its lines leave into a gap, where the labels of those lines stand **one under another at the middle of the band**, and **no lane enters it**: each line runs straight through the band, its label on that run, then turns in a lane after it. Such a label is answered as a distance along its line from its source (`labelDistanceById`, written as `label.distance`, read instead of `label.position`), so it stands at the same x whatever the line does after the band, and the placer neither moves it nor lets the other labels cover it. `labelBand: true` makes each band as wide as the widest label of the lines leaving there and 16 px more (`labelBandWidthOf`); a number makes every band that wide. A gap too narrow for its bands and its lanes 12 px apart keeps no band (reported as `narrow`), its labels placed as ever. A caller sizes such a gap for both: `labelBandWidthOf` of each side, and `diagramLaneWidthOf` for the lanes. Arranged again without a band, a label written with a distance starts from there and is given a position, the distance dropped. db-migration-tool draws the rules of a check action so: the words of each rule beside the column of the source, as one more column of its rows.

## Adding or updating an arranger

**To update one**, change it: every generator using it gets the change the next time it runs. A diagram that had it applied keeps what it has until applied again, since by then the result is the author's data. **To keep the old behaviour available**, add a new arranger with a new id instead.

**To add one**, write a file with the contract above, add it to the `arrangerList` of the registries that should offer it (`er-arranger-list.js` for the ER diagrams), and it appears in the editor and the apis. Keep it pure, and do not read anything from outside `diagram`, `geometry` and `options`. Add its small cases beside it (`ErArranger.test.js`, `DiagramArrangeLayers.test.js`), and run the overlap check on a drawn example.

## Moving arrangers up to the framework

A component offers what its node registry names (`arrangerList`): `CardDiagram` the outline and the layer arrangers, the AWS series the layer arrangers, the Power Platform series the ER ones. Nothing in the contract, the store command, the menu or the apis depends on ER diagrams. The lane router went up first, when the layer arrangers needed it; an ER arranger moves up the same way, with no change to the rest:

1. Make it stop depending on the ER kinds: `erArrangerIsApplicable`, the estimate's row heights (`ErGeometry.js`), and which cards go below (`BELOW_TYPE_LIST`) still do.
2. Move the files to `comp-mdx/card-diagram/`, and add it to the registries that should offer it.

An arranger for another kind of diagram can be written against the same contract and stay in its own series.
