---
title: Using the Card Diagram Framework
description: How to draw with card diagrams, by hand or from data, and what to check before calling a diagram done.
---

This is the document to read when you want to **draw** with the framework, by hand or from a generator. It says what there is, how to choose, and what makes a diagram good. To change the framework itself, read [card-diagram.md](card-diagram.md) instead.

A diagram is node cards joined by connection lines on a canvas, written as YAML. The same format is used by all of these:

| You want | Use | Read |
| --- | --- | --- |
| one diagram | `CardDiagram` (generic cards), `DiagramER` (with Power Platform cards) | [Data diagrams](comp-diagram-er.md) |
| a diagram moving between named states | `CardDiagramAnimation`, `DiagramERAnimation` | [Card Diagram Animation](comp-card-diagram-animation.md) |
| many diagrams in one viewport, switched by path, one inside a card of another | `CardDiagramSwitch`, `DiagramERSwitch` | [Card Diagram Views](comp-card-diagram-switch.md) |
| to shape a line by hand | anchors and handles on any of them | [Connection Lines](card-diagram-connection-line.md) |
| to try something out | [the playground](card-diagram.playground.md), a document git ignores, under **Playground** in the side panel (a fresh clone has none: the item creates it) | [Playground documents](../../../main/doc_page_impl_test.md#playground-documents) |

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

The cards of the base series are `table` (any fields and rows), `operator`, `card-note`, `card-brief`, `card-three-dots` and `color-block`; a series adds its own, and the views add `view-embed` and `view-stack`. The grammar of cards, handles and lines is in [Data diagrams](comp-diagram-er.md).

## Moving and switching

**To move a diagram between states**, wrap it: `CardDiagramAnimation` takes `diagram` and a `stateList`. Each state names what it hides, shows and changes, and the wrapper plays between them. The reader clicks a state or presses Play. A diagram can be animated without being changed, and cards can be shared by several animations (`nodeDefineById`).

**To show many diagrams in one viewport**, give each a path: `CardDiagramSwitch` takes `viewList: [{ path, label, diagram }]`, and a path bar goes between them. A card of the kind `view-embed` shows another view inside it and zooms into it on a click, and a `view-stack` is a scrolling list of views. Views may be written in the document or generated from data: whatever has views is a [provider](card-diagram-flexible-switch.md#the-concepts).

Routes of lines work the same in all of them, also in a view embedded in a card.

## Background color blocks

`color-block` is a lightly colored rectangle with a list of labels, at its bottom or, with `labelSide: top`, at its top. Use it for locations, swimlanes, groups of outputs, and other backgrounds behind the cards.

```yaml
id: source-area
renderer: { type: color-block }
position: { x: -20, y: -40 }
size: { width: 240, height: 400 }
data:
  tone: blue
  itemList:
    - { id: database, icon: database, text: Source database }
    - { id: name, text: PW }
handles: []
```

`itemList` may be empty, for a block with no label. Each item has a unique `id` and `text`, `icon`, or both; `level: 1` or `2` makes it a title, larger and on a line of its own. `columnList: [{ id, x, width, text?, icon? }]` with `columnTop` draws columns inside the block, in its own pixels, for what reads as columns without a block in the block. Icons are the names of `CARD_ICON_BY_NAME` (`database`, `server`, `file`, `archive`, `cloud` ...). Tones are `blue`, `teal`, `green`, `amber`, `red`, `violet` and `slate` (the default).

A block has no handles and does not own or move what lies on it. It is always drawn behind the lines and the cards, whatever the order in the data. While reading, the pointer passes through it; while editing it is selected and moved like a card. Leave room for its labels when placing cards on it.

`card-three-dots` (`data: { direction?: vertical | horizontal, text?, tone? }`) stands for what is left out of a long series of cards. A table card takes `data.badge`, a short word before its name.

## Drawing conventions

What a diagram should look like, whoever draws it:

- **A list wraps.** Do not lay out many cards in one row, or fitting the whole diagram makes them small. A list on a canvas breaks into lines at a small count (four or so), and a generator breaks them itself. A chain that must read in one direction may turn downward rather than run on. Stacking by a meaning (rows by rank, columns by depth) is better still.
- **A margin around what is held.** A card holding other cards keeps a margin inside its border, so nothing inside touches it. [An embedded view](card-diagram-flexible-switch.md#one-canvas-no-canvas-inside-a-canvas) has this by default.
- **One table can be seen several ways.** A table card can declare views, plain, by column or by row, with a menu to switch between them ([Table Card Views](comp-diagram-er.md#table-card-views)).
- **A long table is cut down to what matters here.** `rowDisplay` picks the rows of a table card, in any order, with a row break for what is left out ([Table Card Views](comp-diagram-er.md#table-card-views)).
- **What is long scrolls.** In a card of many sections, prefer a [scrolling stack](card-diagram-flexible-switch.md#a-scrolling-stack) to shrinking all of them to fit.
- **No lines on top of each other.** This is the one most often broken: [next section](#no-lines-on-top-of-each-other).
- **A view generated from data gets its layout from an arranger.** [Below](#a-view-generated-from-data-gets-its-layout-from-an-arranger).

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

1. **Look.** Take a picture of the diagram and look at it, zoomed in enough to see the gaps between cards. Do this for each view.
2. **Ask for what the eye misses.** `connectionOverlapListGet` ([the apis](card-diagram-connection-line.md#the-apis)) lists the right-angled lines of each canvas on the page that break these rules, each pair with the `length` it shares and a `kind`: `stretch` for a shared length beyond the final segments, `whole` for two lines between the same endpoints where one has nothing of its own. An empty list is necessary and not sufficient: it does not look at curves or at lines over cards, and a diagram can be free of overlaps and still hard to read.
3. **Separate them**, by the means that fits, the simplest first:
   - **Move a card or a node handle**, if it was standing in the way. Two lines leaving one side can leave at different offsets.
   - **Give one line an anchor** to put it in a lane of its own: in the editor, double-click the line and drag the anchor; through the [apis](card-diagram-connection-line.md#the-apis), `connectionAnchorAdd`. The [playground](../../../main/doc_page_impl_test.md#playground-documents) has a diagram to practice on.
   - **Apply an [arranger](card-diagram-arrange.md)**, which gives every line a lane of its own at once: **Arrange** in the edit panel, the api `diagramArrangerApply`, or from a generator, where it runs again on other data. It replaces the anchors of the lines, so apply it first and adjust by hand after.
4. **Look again.** A new lane may have made a new crossing or covered a label.

Two patterns come up again and again when doing it by hand. Lines fanning out from one card to cards on one side each take their own level, the one leaving farthest out the highest, so that they do not cross each other (`along: 0.5` with a `y` offset). Lines crossing the gap between two columns take one vertical lane each (`along: 1` with an `x` offset into the gap), and of those going to one card, the one coming from farthest turns nearest the card.

### A view generated from data gets its layout from an arranger

**When you write logic that generates a view from data, consider an [arranger](card-diagram-arrange.md) for its layout.** Such a view is usually not editable, because the next update of the data would rebuild it and lose any edit. So hand-placed cards and anchors are not available to it, yet it should still be well laid out, and it has to stay that way on data nobody has seen yet.

An arranger fits this: its rules run on whatever the data is now, every time the view is built, and the generator only says what the cards and lines are.

```text
 data ──► generator: the cards and lines ──► arranger: where they go ──► the view
```

- **Apply an arranger, rather than computing positions and routes inside the generator.** Layout logic inside one generator serves only that view, while an arranger can be improved in one place and reused by other views.
- **If no arranger fits, consider writing one** before tuning the generator case by case ([Adding or updating an arranger](card-diagram-arrange.md#adding-or-updating-an-arranger)).
- **Still look at the result.** An arranger works from estimated sizes when nothing is drawn yet, so check a generated view [as any other](#no-lines-on-top-of-each-other), on real data.

A diagram people edit by hand can use the same arrangers, as a first layout or re-applied when asked. There, the result becomes the author's data.

### A matter of taste: show how it happens, then what came of it

These are not rules a validator could check; they are what has been seen to read well and badly on real diagrams.

| Better | Worse | Why |
| --- | --- | --- |
| a **process**: what goes in, what happens to it step by step, what comes out, each step a card joined by lines | a **pile of tables**, section after section | a reader looks at a report to understand what was done. Tables say what the numbers are and leave the reader to work out what they mean |
| the figures **on the step they belong to**: a batch card saying `49 succeeded / 1 failed`, in red | the same figure in a row of a table | it answers "where did that happen", and the one thing wrong stands out in the picture |
| a **short card of totals that opens the table** | the table itself, large, in the overview | the table is still there for whoever needs it: it is a view of its own, a click away. A detail is switched to, not stacked |
| **one concrete case worked through**: one row, what its source holds, what is expected, what the target has | only the rule, or only the totals | a rule becomes clear on an example |
| a **small vocabulary of shapes** that mean the same across diagrams: the table with its brackets, a card per batch, a red card for what was set aside | a new look per section | the second diagram is read with what was learned on the first |

The first thing to draw for any report is therefore the diagram someone would sketch to explain it on a whiteboard, with the actual figures written on it. Tables come last. In the [migration](power-platform-migration.md#views), the run report and the verification report are drawn this way.

## Before calling a diagram done

| | Check |
| --- | --- |
| ☐ | It was looked at: a picture of every view, at a zoom where the gaps can be seen |
| ☐ | [No two lines share a stretch, beyond the final segment into a common endpoint](#no-lines-on-top-of-each-other), and `connectionOverlapListGet` agrees |
| ☐ | No line runs over a card or a label it has nothing to do with |
| ☐ | Lists wrap, what is held has a margin, what is long scrolls |
| ☐ | A view generated from data gets its layout from [an arranger](#a-view-generated-from-data-gets-its-layout-from-an-arranger), or has a reason not to |
| ☐ | A process before tables, and figures on the steps they belong to |
