# Card Diagram: Arrangers

An **arranger** arranges a diagram by a set of rules: it decides how lines run and, if it wants, where cards stand. It is a pure function from a diagram to a list of changes, kept apart from whatever asks for it. So one arranger serves three kinds of caller, and any arranger can change without them knowing.

```text
 a generator of a read-only scene ─┐
 a generator of a first layout  ──┼──► arranger ──► changes ──► the diagram
 the editor or an api, by hand  ──┘   (pure)
```

The contract is in `comp-mdx/card-diagram/DiagramArrange.js` and knows no kind of card. The base series has two arrangers, [the outline](#the-outline-arranger) and [the rows](#the-rows-arranger); the arrangers of ER diagrams are in `comp-mdx/power-platform/er-arrange/` ([below](#moving-arrangers-up-to-the-framework)).

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
changes    { positionById?, handleSideList?: [{ nodeId, handleId, side }],
             routeById?: { id: route | null }, labelPositionById?: { id: part of its line },
             reportList?: [{ kind, message, connectionId? }] }
```

**Geometry is passed in**, because only the caller knows where things are. The editor and the apis pass what the canvas measured when the diagram is drawn (`diagramCanvasGeometryBuild`); a generator has nothing drawn, so the arranger's estimate is used. An estimate that knows no kind (`diagramGeometryEstimateBuild`, `DiagramArrangeOutline.js`) takes the written size of a node, else the default of its kind, and asks the kind where an anchor is in that rectangle (`contract.anchorRectEstimate`, when the caller passes the registry); it is exact for cards whose sizes are written, as [icon nodes](card-diagram-impl.md#icon-nodes) are. The estimate models the sizes a card draws, wrapped rows and titles included, by the width of their words, but it stays an estimate, so **check a generated diagram when it is drawn**, as for any diagram: `connectionOverlapListGet`. An arranger placing cards routes against where the cards will be with `diagramGeometryMovedBuild`.

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

## The arrangers of ER diagrams

| Id | Cards | Lines |
| --- | --- | --- |
| `er-lanes` | stay where they are | every right-angled line gets a new route |
| `er-spread` | keep their columns and rows; a gap too narrow for its lanes grows, moving what stands right of it | as `er-lanes` |
| `er-columns` | move: what a line goes to stands at its right, tables stacked in columns, option sets below the first column using them; each gap as wide as the lanes crossing it need; handles turned to face each other | as `er-lanes` |

They are offered for any diagram of the series with a table on it (`isApplicable`). Curves and straight lines keep their routes, and a line with a free end is reported as skipped. All of them [place the labels](#labels), of curves too.

**Which one.** `er-columns` for a diagram of tables with no layout of its own to keep. `er-spread` for a diagram put together from parts that already mean something, as two arranged ER diagrams with lines between them: placing every card anew would lose what the parts say, and `er-lanes` alone would squeeze the new lines into gaps sized for the old ones. A line that should be routed like this has to be right-angled; a curve goes straight through whatever lies between its ends.

### How the ER rules route

From the rectangles alone, in `ErLineRouter.js`, which knows nothing of tables:

```text
 column   cards whose widths overlap: read off the rectangles, so placed-by-hand cards work too
 gap      the free space beside a column
 lane     a vertical track in a gap, for one line
 track    a horizontal stretch across columns, between their cards
 level    a horizontal stretch just above or below a card with a handle on top or bottom
```

A line between two neighbouring columns has one lane, a line further than that has a lane beside each end and a track between them, and a line to a handle on top of a card has a lane and a level. A gap's lanes stand in an order that keeps lines of one kind from crossing each other: of lines going to one card, the one coming from farthest turns nearest the card. The anchors follow the target (`along: 1`).

Lines are placed one after another and each is **checked against those already placed**, by the same rule as [the overlap check](card-diagram-usage.md#no-lines-on-top-of-each-other): the preferred place first, then others. So what no order can foresee, such as two rows at one height in different columns, is found and avoided.

**What to expect.** On made-up schemas from 5 to 40 tables (`ErArranger.test.js` has the small ones), `er-columns` left no overlap and no line over a card, against up to 3800 overlapping pairs with lines routed by the default. On two made-up ER diagrams side by side, with a line per table across them (`er-spread`, 5 to 40 tables a side, with one or three lookups a table), no line stood over a card and no label over a card or another label. Overlaps stayed at zero up to 40 tables a side with one lookup a table, and at one pair at 20 tables with three; at 40 tables with three, 6 pairs overlapped among 274 lines, some of them for a long way. It does less well where several lines arrive at one table, each on a handle of its own at one place: with tables of the target chosen at random, so that some got several lines, the check counted from 1 pair at 5 tables to about 140 at 40. Crossings do not go away, and on a dense schema there are more visible ones, since lines no longer hide each other: it separates lines, it does not make a dense schema simple.

**What it does not do.**

- A line leaving and arriving through a top or bottom handle is skipped.
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

## Adding or updating an arranger

**To update one**, change it: every generator using it gets the change the next time it runs. A diagram that had it applied keeps what it has until applied again, since by then the result is the author's data. **To keep the old behaviour available**, add a new arranger with a new id instead.

**To add one**, write a file with the contract above, add it to `er-arranger-list.js`, and it appears in the editor and the apis. Keep it pure, and do not read anything from outside `diagram`, `geometry` and `options`. Add its small cases to `ErArranger.test.js`, and run the overlap check on a drawn example.

## Moving arrangers up to the framework

A component offers what its node registry names (`arrangerList`); `CardDiagram` names the outline. Nothing in the contract, the store command, the menu or the apis depends on ER diagrams, so an arranger of ER diagrams moves up with no change to them:

1. Make it stop depending on the ER kinds. `ErLineRouter.js` already does not; `erArrangerIsApplicable`, the estimate's row heights (`ErGeometry.js`), and which cards go below (`BELOW_TYPE_LIST`) do.
2. Move the files to `comp-mdx/card-diagram/`, and add the list to `cardDiagramNodeRegistry`.

Do this when a diagram outside the ER family needs it. An arranger for another kind of diagram, such as a flow running left to right, can be written against the same contract and stay in its own series.
