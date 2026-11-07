# Card Diagram: Connection Lines

A connection line of a [card diagram](card-diagram-usage.md) can be shaped by hand: **anchor points** the line passes through, with **handles** that say how it runs at each of them, as in a vector drawing tool. This document is the design, the implementation and the guide for using them. It is the one place about them; other documents point here.

Two words are easily mixed up. In this document an **anchor handle**, or just a handle, belongs to an anchor point of a line. A **node handle** is the small rounded square on a card where lines attach. A line starts and ends on node handles; anchors and their handles are what happens in between.

```text
 ┌──────┐ node handle                     handleIn, an arrow back to where the line came from
 │ card ■───────┐                              ○
 └──────┘       │                              ┆
                ◆  an anchor point  ───────►   ◆ ┄┄┄ ● handleOut, on to where the line goes
                │
                └───────■ node handle
```

## The two layers

The **line type** comes first and decides everything below it. Only three of the five line types have anchors, and they fall into two **families**:

| Line type | Family | A handle is | Anchors |
| --- | --- | --- | --- |
| `smoothstep` (the default) | right-angled | one of four directions, or auto | yes |
| `step` (the same, sharp corners) | right-angled | one of four directions, or auto | yes |
| `bezier` | curve | a vector, or none | yes |
| `straight` | | | no |
| `polyline` | | it has its own `route.waypoints` | no |

A route belongs to its family. Between `smoothstep` and `step` it is kept, since only the corners differ. Any other change of the line type drops it (an undo brings it back): a direction means nothing to a curve and a vector means nothing to a right-angled line, and no conversion is attempted for now.

## The data

The route is part of the connection, in the YAML like everything else, saved with the diagram. A line without `route` is drawn by the helper of its line type, exactly as React Flow draws it.

```yaml
- id: a-line
  source: { nodeId: a, handleId: out }
  target: { nodeId: b, handleId: in }
  renderer: { type: smoothstep }
  route:
    anchorList:
      - { id: a1, along: 0.5, x: 30, y: 0 }                    # auto handles
      - { id: a2, along: 1, x: -40, y: 0, handleIn: y-, handleOut: x+ }
    source: { handle: y+ }                                      # the line leaves its card downward
```

```yaml
- id: a-curve
  renderer: { type: bezier }
  route:
    anchorList:
      - id: a1
        along: 0.5
        x: 0
        y: -40
        handleIn: { x: -90, y: 0 }
        handleOut: { x: 90, y: 0 }
        isCoupled: false                                        # true by default
    target: { handle: { x: -60, y: 0 } }
```

| Key | Means |
| --- | --- |
| `anchorList[].id` | names the anchor in the path of the edit card and in the apis; `a1`, `a2` ... when absent |
| `along`, `x`, `y` | where the anchor is, relative to the two ends: [below](#how-a-line-follows-its-ends). `along` defaults to 0.5, `x` and `y` to 0 |
| `handleIn`, `handleOut` | the two handles. Right-angled: `x+`, `x-`, `y+`, `y-` (`y+` is down the screen), absent or `auto` for auto. Curve: `{ x, y }` from the anchor, absent for no handle |
| `isCoupled` | a curve only: `false` when the two handles need not stay on one straight line |
| `source.handle`, `target.handle` | the one handle of an end, in the terms of the family; absent by default |

A route that does not fit its line type is refused with a message naming the place, like every other mistake in a diagram.

## How a line follows its ends

This is the question the design turns on: an anchor has to go somewhere when a card moves. An anchor keeps its place relative to the two ends of the line:

```text
place = source + along × (target − source) + (x, y)
```

The result, whichever line type it is:

- **Both ends move by the same vector** (two cards moved together, a scene translated): the whole line moves as it is, with nothing changed in its shape.
- **One end moves by d**: each anchor moves by its share of d: `along × d` when the target moved, `(1 − along) × d` when the source did. An anchor near the end that moved follows it nearly all the way, and one near the other end hardly moves.
- **Handles never change.** A vector of a curve stays the same vector and a direction stays the same direction. Nothing rotates and nothing scales, so a bend keeps its size in pixels however far the cards go.

`along` therefore says which end an anchor belongs to. `along: 1` moves rigidly with the target, which is what a lane next to a card wants; `along: 0` moves rigidly with the source; the default keeps it between them. When an anchor is dragged, its `along` is the projection of the new place on the straight line between the ends (within 0 and 1), and `x`, `y` are the rest. The edit card can set `along` directly, which changes what the anchor follows and leaves it where it is.

The offset is kept in pixels of the diagram and never as a fraction of the distance between the ends. A lane 30 pixels to the side of the middle stays 30 pixels to the side, and two ends that come close together cannot make it collapse.

## Right-angled lines

Every run is horizontal or vertical. A handle says **which way the line runs from the anchor**: `handleIn` points back to where the line came from, `handleOut` on to where it goes. So a line going straight through has opposite handles, a corner has perpendicular ones, and a hairpin has the same direction twice. The length drawn for a handle means nothing.

**A dragged handle has two places to go.** It snaps to whichever of the **two directions facing its neighbour** (the previous point for `handleIn`, the next for `handleOut`) is nearer to the pointer. The other two would point away from where the line is going and only add a detour. A neighbour exactly in line has one facing direction; the perpendicular on the pointer's side stands in as the second. The apis accept any of the four, and the line is routed whichever way a handle points, with a short stub where it points away.

**When both handles point the same way** their tips are drawn at different distances along it, the in handle nearer and the out handle farther, so either can be picked up.

**A handle can be auto, and starts so.** This is the meaning of a handle being off: the author does not care which way the line runs there. It is a constraint left out, with one rule:

> An auto handle takes the direction that gives the whole line the fewest bends.

It is decided over the whole line at once (`rightAngleResolve`, a small dynamic program over the anchors): each segment counts its bends, each anchor counts 0 straight through, 1 for a corner and 2 for a hairpin. Bends at an anchor cost a little less than bends inside a segment, so when the counts are equal the line turns at the anchor, and an anchor says where the line runs. Equal costs then keep the longer way, so one geometry always has one answer. A handle that is set is simply kept.

Both auto is the usual case and usually what is wanted: the anchor says where the line passes, and the directions follow. Setting one or both is for when they do not. The drawing shows the difference: an auto handle has a hollow tip on a dashed stem, at the direction it resolved to; a set handle has a filled tip on a solid stem. Grabbing an auto handle sets it, and double-clicking a set one makes it auto again.

Because directions follow the geometry, an auto handle may change direction as cards move. A handle that must not change is set.

## Curves

The model of a vector drawing tool. Between two consecutive points of the line runs one cubic curve, with its two controls at the handles facing each other.

- **A handle is a vector** from the anchor. A side without a handle has its control at the anchor, so the curve arrives there straight. An anchor without handles is a corner.
- **Coupled** (the default): the two handles stay on one straight line, so the curve is smooth through the anchor. Moving one turns the other to stay opposite, keeping its own length, so the two lengths are independent.
- **Decoupling:** Alt + drag a handle, or the **Coupled** switch. Each then moves alone, and the anchor can be a sharp point.
- **Coupling again:** the switch turns the in handle onto the straight line of the out handle, keeping its length (a side without a handle takes the length of the other).
- **Adding an anchor keeps the shape.** The curve is split there (de Casteljau), and the handles next to it are shortened as the split asks. An end without a handle keeps its default, which comes out the same for a split in the middle of a segment and close to it elsewhere.
- **Removing an anchor** leaves the neighbours' handles as they are.

## The two ends

An end has at most one handle, since a line has only one side there. **By default it has none**, and the line leaves or arrives perpendicular to the border of the card: for a right-angled line that is the direction of the side the node handle is on, and for a curve a control along that side with the length React Flow's own curve uses, so a route starts from the curve it replaces. A free end has no side, and takes what an auto handle takes.

Setting one overrides that: a direction, or a vector. It is what makes a line leave a right-side node handle going up, say. The tip at each end is always shown while the line is focused: hollow at the default, filled when set.

## In the editor

Everything exists in edit mode only, on the focused line, and nothing of it is drawn otherwise.

- **Anchors** are small diamonds, smaller than a node handle and of another shape. **Handle tips** are small circles on a thin stem, amber on the in side and blue on the out side, the colors of the node handles. They keep their screen size at any zoom. An anchor's handles show when the anchor is selected; the handles of the two ends show whenever the line is focused.

| To | Do |
| --- | --- |
| add an anchor | double-click the line where it should be, or **Add anchor** in the edit card |
| move an anchor | drag it (Shift: along one axis). A right-angled anchor snaps into line with its neighbours, so no small jog is left |
| select an anchor | click it: its detail opens in the edit card |
| remove an anchor | select it and press Delete, or double-click it, or **Remove anchor** |
| change a handle | drag its tip (a curve: Shift keeps it to 45°, Alt decouples) |
| clear a handle | double-click its tip: auto, or none |
| type a value | the edit card: the line's **Route** section for the ends, **Anchors** for the list, the anchor's detail for its place and handles |
| start over | **Reset route** |

A right-angled line also keeps its shape when an anchor is added. The segments the new anchor falls into are routed anew, each with its own middle, so where that would move a run, the corner next to the new anchor becomes an anchor too: the fewest that keep the shape.

A gesture draws through `routeDraft` of the store and writes one step when it ends, so an undo takes back a whole drag, and a press without a move only selects. The edit card is hidden during a drag, as for every gesture, and it stands beside the box of the two ends of the line, so it does not cover the line and does not move when the route changes.

## The apis

For agents and scripts, each diagram component exposes these ([The apis of a component](../../../main/doc_page_impl_api.md#the-apis-of-a-component)) under its own id, such as `cloud-dev-vis/CardDiagram/connectionAnchorAdd`. They take `connectionId`, and `block` and `doc` to locate the diagram like every document api does (the first diagram of the current document without them).

| Api | Does |
| --- | --- |
| `connectionRouteGet` | the line type, the route as the data keeps it, and, when the diagram is drawn, where the ends and anchors are and which way their handles point |
| `connectionLineTypeSet { lineType }` | the line type, with what that does to the route |
| `connectionAnchorAdd { x, y }` or `{ along, offsetX, offsetY, index, handleIn, handleOut, isCoupled }` | an anchor on the line nearest to a place, or at a place as the data keeps it. Answers its id |
| `connectionAnchorMove { anchorId, x, y }` or `{ anchorId, along, offsetX, offsetY }` | its place |
| `connectionAnchorRemove { anchorId }` | |
| `connectionAnchorHandleSet { anchorId, side, value, isDecouple }` | `side` is `in` or `out`. `value` is a direction or a vector; null is auto or none |
| `connectionAnchorCoupleSet { anchorId, isCoupled }` | a curve only |
| `connectionEndHandleSet { role, value }` | `role` is `source` or `target` |
| `connectionRouteSet { route }` | the whole route; null clears it |
| `connectionOverlapListGet` | for every canvas on the page, the pairs of lines breaking [the rule](card-diagram-usage.md#no-lines-on-top-of-each-other): `{ a, b, length, kind }`, `kind` being `stretch` or `whole` |

While an edit session is open on the block, a change goes into its draft: it can be undone there and is written when the author saves, and the answer says `isDraft: true`. Otherwise the block's data is changed and written at once, as a save would. Coordinates `x`, `y` need the diagram drawn on the page, because only the page knows where the ends are; `along` with an offset needs nothing. Every change goes through the store's commands, so it is validated like a change in the editor.

```sh
curl -X POST localhost:45173/__doc-api/call -H 'content-type: application/json' -d '{
  "api": "cloud-dev-vis/CardDiagram/connectionAnchorAdd",
  "params": { "connectionId": "a-line", "along": 1, "offsetX": -40, "offsetY": 0 }
}'
```

## Keeping lines apart

Routes are how lines are kept off each other. The check and the way of working are in [the usage document](card-diagram-usage.md#no-lines-on-top-of-each-other). An [arranger](card-diagram-arrange.md) does it for a whole diagram, from a generator or by hand: it removes the anchors of the lines it routes and creates new ones.

## Implementation

| Place | Role |
| --- | --- |
| `comp-mdx/card-diagram/DiagramRoute.js` | everything pure: reading a route, where an anchor is, the router of a right-angled line and the choice of auto handles, the pieces of a curve, the changes of a route (insert, move, handles, coupling), the overlap check. No React and no React Flow |
| `comp-mdx/card-diagram/DiagramERData.js` | validates a route with the connection |
| `comp-mdx/card-diagram/DiagramRender.jsx` | `connectionPathBuild`: the path of a line wherever it is drawn (the canvas, a static scene, a label), which is why animation and scene switching need nothing else. `DiagramEdge` draws the focused line from `routeDraft` during a gesture |
| `comp-mdx/card-diagram/DiagramRouteControls.jsx` | the anchors and tips over the cards, and their gestures |
| `comp-mdx/card-diagram/DiagramEditStore.js` | the commands (`connectionAnchorAdd` ...), through `changeApply`, so they have validation and undo |
| `comp-mdx/card-diagram/DiagramEditPath.js`, `DiagramEditCardModel.js` | the path segments `anchors` and `anchor`, and the card's sections |
| `comp-mdx/card-diagram/DiagramApiList.js`, `DiagramCanvasRegistry.js` | the apis, and the canvases on the page they ask where things are |
| `comp-mdx/card-diagram/DiagramRoute.test.js` | the geometry, the commands and their undo |
