# Card Diagram Animation: Design

A wrapper of the [card diagram framework](card-diagram.md) that makes a diagram move between named states, inside the page, as a block of a document. It is general purpose: it knows nodes, rows, connections and a camera, never what a diagram is about. What authors write is in [comp-card-diagram-animation.md](comp-card-diagram-animation.md); this document is the design, and what to go through before changing it.

```text
[control area]           the states as a graph, the transitions as lines, Play
[react-flow viewport]    the diagram at a state, or between two
```

## The model: states for the reader, frames for the machine

A **state** is what a reader names and clicks: a brief name, a description shown as a tooltip, and what the diagram looks like there. A **transition** is a line between two states, and is what plays. States are designed for the reader's mental model and do not correspond to remotion sequences: one transition usually holds several tracks, and playing from one state to another may run several transitions.

```text
document                 what is written: a diagram, states, transitions
  scene of each state    what each target looks like there: { node/x: { opacity }, row/x/y: { fill }, ... }
  compiled transition    frameCount, when each target changes, the tokens
plan                     the transitions between two states, end to end: the one timeline of the Player
frame                    remotion's clock
  scene at the frame     written as one stylesheet, the camera moved, the tokens placed
```

The most complete model is a state machine, and that is the one the data has. A chain is a state machine whose transitions run through the list once: `transitionList` absent means exactly that, and the control area draws it as `state 1 --> state 2 --> state 3`.

**Remotion is the clock and the timeline, not the renderer.** `@remotion/player`'s `Player` holds the frame, plays and pauses at a rate; `Sequence` scopes a transition and a token to their own frames; `interpolate`, `interpolateColors`, `spring` and `Easing` compute the values. There is no remotion project, no studio and no video: the composition is rendered in the page, and the output of a state is a picture of the viewport ([Pictures](#pictures)).

## How a frame reaches the canvas

The composition is one React Flow canvas of the framework (the same `DiagramNode`, `DiagramEdge` and cards as `CardDiagram`), drawn from one `DiagramERStore`:

```text
<Player component={AnimationComposition} durationInFrames={plan.frameTotal} compositionWidth={box.width} ...>
  <ReactFlow>                                         never reads the frame, so no card renders per frame
    <Sequence from={segment.frameStart} ...>          one per transition of the plan
      <AnimationSegment>                              useCurrentFrame(): counts from its own start
        <style>{scene as css}</style>                 opacity, rings, fills, drawn length of a line
        setViewport(camera at the frame)
        <Sequence from={token.frameStart}><AnimationToken/></Sequence>
    <AnimationRest/>                                  resting on a state: its scene, its camera
```

- **A scene is a stylesheet**, scoped to the block, written by `animationSceneStyleBuild`. It reaches any card however it is drawn (a kind, a registered component), and a card that mounts late without timing problems, and it keeps standard 10 of the framework: objects keep their identity, nothing renders a card again per frame. A card only has to mark its rows (`data-row-id`, which `TableCard` does).
- **A node that moves** (`x`, `y` of a state) goes through the positions React Flow is given (`AnimationStore.nodeListFlow`), so its lines follow; only moved nodes change identity.
- **A line** is drawn part way with `stroke-dasharray` over its measured length, a **token** placed with `getPointAtLength` on the path as drawn, inside the viewport (`ViewportPortal`), so both follow any routing the framework draws.
- **The composition has the size of the box**, measured, so remotion scales nothing and React Flow measures true pixels (a scaled composition is what would break its handles).
- **The camera** is resolved per state once sizes are known (`fit` of named nodes, `all`, `visible`, or written `{ x, y, zoom }`), and glides: the center and the logarithm of the zoom move evenly. While resting, the reader pans and zooms freely; the view is applied again only when the state changes. A fit stops at a zoom of 1.15 unless `maxZoom` says otherwise, so a few cards stay compact instead of filling the box.

## The states of a block

`AnimationStore` holds what the block reads and does. The history and the draft of an edit session do not exist here: a block writes nothing.

| State | Meaning |
| --- | --- |
| `stateIdCurrent` | the state shown, or the state the playing segment left from |
| `stateIdTarget` | where Play goes, picked with a shift-click; `''` onward |
| `plan` | the segments of the timeline; none while resting (a timeline of one frame) |
| `frame`, `isPlaying` | as the Player reports them |

Playing never changes the document. When the timeline runs out (`ended`), the viewport rests on the state reached; its last frame already equals that state, so nothing jumps.

## The state shown first

**By convention the last state of `stateList` is the most complete one**, and a block starts there when the page loads: a reader who never presses Play still sees the whole picture, and a screenshot or a printed page holds everything. So write the states in the order they build up, and let the last add up to all of it. `initial` names another state where the last is not the one to show, as in a state machine whose last state written is only one of its branches.

From a state with no way on, Play starts over from the first state (a chain plays to its end, a state machine takes the first transition), so the start at the end costs nothing.

## The control area

`AnimationControl` draws the states as buttons and each transition as a line (`animationIsLinear`, overridable with `control.layout`): one row for a chain; for a state machine a small graph, layers by distance from the first state, a forward line curved between two layers and a line back under the states (`animationControlGraphBuild`). The progress is a stroke along the same path as the line, straight or curved alike: a dash from its start, as long as the progress (`pathLength` 1), so it grows from almost nothing at 0% to the whole line at 100%. A line still waiting its turn shows none. The dash is in the coordinates of the line, so this stroke cannot have `non-scaling-stroke`, which would measure it in screen pixels. The head of a line in the row is drawn beside it, not as a marker: the row stretches the line, and the head keeps its shape; a line and its head share one opaque color. A row wider than the block scrolls, and the state shown stays in it, moving only the row. The tooltip is an `AnchoredPopover`, so no overflow clips it.

## Pictures

One button of the block's toolbar (`BlockPopupSurface actionList`, an action with a `menuItemList`) opens a menu: copy as PNG, copy as SVG, download PNG, download SVG; another copies the YAML. What came of it is a hint floating over the middle of the viewport, taking no room, so nothing moves: making the picture, copied, the download started, or the reason it failed, which stays longer. A download can only be reported as handed to the browser, which does not say whether the file was saved. The clipboard is written within the click, with the picture as a promise, since a browser may refuse a write made after waiting for it; it exists only on https and localhost, so a page on plain http copies an SVG as text and refuses a PNG with that reason. A picture not ready after 30 seconds fails. `AnimationCapture.js` uses `html-to-image` on the canvas as it stands, at a state or in the middle of a transition. Controls, the minimap, the dot background and everything a state hides stay out. An SVG is the html of the cards in a `foreignObject` with the lines as svg: sharp at any size in browsers and tools reading `foreignObject`, but not plain vector shapes. The clipboard takes `image/svg+xml` where the browser allows it, the text of the file otherwise.

## Reuse: cards in several animations

Animations are many and small, each about one aspect, and share their cards:

- **A kind or a registered component** is the same in every diagram. `DiagramERAnimation` is the animation of the Power Platform registry; a series makes its own with `cardDiagramAnimationCompCreate(registry, name)`. A registered component (`ObjectView` included) works as in any diagram, so a card can be a view of an object.
- **`nodeDefineById`** writes a card once in a document, placed by `use` with its own position and data over it.
- **Several scenes sharing their cards** are a component of the doc page putting a shared yaml file and a scene's file together, and handing the text to the animation through `RegisteredComp` (see `.doc-page/comp-mdx/migration-animation/` of a doc page doing so).

## Adding to it

| Change | Where | Check |
| --- | --- | --- |
| a new property of a target | `PROP_DEFAULT_BY_KIND`, `animationSceneStyleBuild` | interpolated by kind: a color goes in `PROP_COLOR_SET`; a test in `AnimationData.test.js`; the table of [comp-card-diagram-animation.md](comp-card-diagram-animation.md#targets-and-properties) |
| a new kind of track | `trackNormalize`, `animationTransitionCompile`, a component in a `Sequence` | deterministic from the frame alone: seeking to a frame gives the same picture |
| a new card | a kind of a registry, not here | [Adding a kind](card-diagram.md#adding-a-kind); rows marked `data-row-id` |

The rules that must hold:

- **The animation layer knows no series and no domain.** A migration, a cloud, a process are data.
- **Everything is a function of the frame.** No timers, no CSS transition or animation on what a track moves: seeking gives the same picture, and a picture taken anywhere is what the reader sees.
- **Nothing renders a card per frame.** A new effect that needs per-frame data goes in the stylesheet or in its own element under a `Sequence`.
- **A refused document says why**, naming the state, transition or target; it shows the message in the block and never a half-drawn diagram.

## Implementation

| Place | Role |
| --- | --- |
| `comp-mdx/card-diagram-animation/AnimationData.js` | pure: the document, targets, scenes, compiled transitions, plans, the control graph, a scene as css |
| `AnimationStore.js` | the state of a block, the canvas store of its diagram |
| `AnimationCanvas.jsx` | the Player, the composition, the segments, tokens, the camera |
| `AnimationControl.jsx` | the control area |
| `AnimationCapture.js` | pictures of the viewport |
| `CardDiagramAnimation.jsx` | the block, `cardDiagramAnimationCompCreate`, `CardDiagramAnimation` |
| `card-diagram-animation-comp.js`, `AnimationSource.js`, `comp.yaml` | the registration, the starting text and the build-time dependencies |
| `comp-mdx/power-platform/power-platform-comp.js` | `DiagramERAnimation` |
