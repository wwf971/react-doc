# Card Diagram: Arrangers

An **arranger** arranges a diagram by a set of rules: it decides how lines run and, if it wants, where cards stand. It is a pure function from a diagram to a list of changes, kept apart from whatever asks for it. So one arranger serves three kinds of caller, and any arranger can change without them knowing.

```text
 a generator of a read-only scene ─┐
 a generator of a first layout  ──┼──► arranger ──► changes ──► the diagram
 the editor or an api, by hand  ──┘   (pure)
```

The contract is in `comp-mdx/card-diagram/DiagramArrange.js` and knows no kind of card. The arrangers are in `comp-mdx/power-platform/er-arrange/`, at the level of ER diagrams for now ([below](#moving-arrangers-up-to-the-framework)).

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
             routeById?: { id: route | null }, reportList?: [{ kind, message, connectionId? }] }
```

**Geometry is passed in**, because only the caller knows where things are. The editor and the apis pass what the canvas measured when the diagram is drawn (`diagramCanvasGeometryBuild`); a generator has nothing drawn, so the arranger's estimate is used. The estimate assumes no row wraps, so **check a generated diagram when it is drawn**, as for any diagram: `connectionOverlapListGet`. An arranger placing cards routes against where the cards will be with `diagramGeometryMovedBuild`.

**A report says what was not done**, rather than failing: `skipped` (a line it does not handle), `narrow` (lanes closer than is readable), `overlap` (no free way found). The editor shows it in the edit panel, and the api answers it.

A store command, `arrangeApply(arranger, { geometry, ...options })`, applies changes to a draft; `diagramArrangeApply` applies them to plain data. Both start from `diagramArrangeRun`.

## The arrangers of ER diagrams

| Id | Cards | Lines |
| --- | --- | --- |
| `er-lanes` | stay where they are | every right-angled line gets a new route |
| `er-columns` | move: what a line goes to stands at its right, tables stacked in columns, option sets below the first column using them; each gap as wide as the lanes crossing it need; handles turned to face each other | as `er-lanes` |

They are offered for any diagram of the series with a table on it (`isApplicable`). Curves and straight lines are left alone, and a line with a free end is reported as skipped.

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

**What to expect.** On made-up schemas from 5 to 40 tables (`ErArranger.test.js` has the small ones), `er-columns` left no overlap and no line over a card, against up to 3800 overlapping pairs with lines routed by the default. Crossings do not go away, and on a dense schema there are more visible ones, since lines no longer hide each other: it separates lines, it does not make a dense schema simple.

**What it does not do.**

- A line leaving and arriving through a top or bottom handle is skipped.
- `er-lanes` does not move anything, so cards placed in a staircase read as one column and their lines go around it, and a narrow gap gets narrow lanes (reported as `narrow`).
- A handle has one side, so where lines come to one handle from both sides, as in some cycles, the fewer go around their card.

## Adding or updating an arranger

**To update one**, change it: every generator using it gets the change the next time it runs. A diagram that had it applied keeps what it has until applied again, since by then the result is the author's data. **To keep the old behaviour available**, add a new arranger with a new id instead.

**To add one**, write a file with the contract above, add it to `er-arranger-list.js`, and it appears in the editor and the apis. Keep it pure, and do not read anything from outside `diagram`, `geometry` and `options`. Add its small cases to `ErArranger.test.js`, and run the overlap check on a drawn example.

## Moving arrangers up to the framework

A component offers what its node registry names (`arrangerList`); `CardDiagram` names none today. Nothing in the contract, the store command, the menu or the apis depends on ER diagrams, so an arranger moves up with no change to them:

1. Make it stop depending on the ER kinds. `ErLineRouter.js` already does not; `erArrangerIsApplicable`, the estimate's row heights (`ErGeometry.js`), and which cards go below (`BELOW_TYPE_LIST`) do.
2. Move the files to `comp-mdx/card-diagram/`, and add the list to `cardDiagramNodeRegistry`.

Do this when a diagram outside the ER family needs it. An arranger for another kind of diagram, such as a flow running left to right, can be written against the same contract and stay in its own series.
