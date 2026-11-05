# Card Diagram Flexible Switch: Design

A feature layer over the [card diagram framework](card-diagram.md): **many views in one viewport**, each with a path, switched smoothly. A reader moves between an overview, the diagram inside one of its cards, a detail of that diagram, and back; at any view they can pan, zoom and take a picture. The layer knows nodes, connections, paths and cameras, never what a diagram is about. What authors write is in [comp-card-diagram-switch.md](comp-card-diagram-switch.md); this document is the design, and what to go through before changing it.

```text
[path bar]                overview > tables > account     ←  picture  fit  box
[react-flow viewport]     one canvas, showing one view
```

## The concepts

- A **view** is a diagram of the [card diagram format](card-diagram-impl.md#core-model) with a **path** (`/overview/tables/account`) and a label. Its folders are the segments of the path bar.
- A **provider** is whatever has views. The layer asks it three things and assumes nothing else, so views may be written in a document or generated from data:

```text
provider
  root                    the first view
  viewGet(path)           { path, label, description, diagram, box? }, or null when the path names nothing
  labelGet(path)          the word of a segment of the path bar
  childListGet(path)      the views below a path: the menu of the path bar
  boxSave?(path, rect)    what a bounding box adjusted by the reader does
  transition?             { secondPortal, secondMorph, secondCamera, secondScroll }
```

- A **bounding box** is the part of a view shown by default, and shown when the view is embedded. Without one it is everything the view draws.
- An **embedded view** is a card of one view showing another view inside it.
- A **switch** is the way from the view shown to another: a list of steps, each drawn from a progress.

## One canvas, no canvas inside a canvas

A block has one React Flow canvas (`SwitchCanvas`). It holds the nodes of one view at a time, or of a morph between two.

**An embedded view is plain React.** The `view-embed` kind draws the world of the other view with `SwitchStaticView`: the same `Card` components the canvas uses, placed absolutely, their lines in one svg, under one CSS transform. It has no React Flow, no handles to measure twice, no camera of its own: its "camera" is a pure map from the box of the view to the body of the card (`switchEmbedMapBuild`). A view may embed a view that embeds another; a path already in the chain is refused where it would draw, and a depth limit stops the rest.

**A chosen box is the edge of what is shown.** A view with a bounding box, or an embedding naming a region, shows that part alone: the world is clipped to it (`switchBoxClipBuild`), and a portal opens that clip as the box grows. A view without a box has no such edge, since its lines may run outside its cards.

**An embedded view keeps a margin inside its card.** The box of the view fits the body of the card less a small margin on every side (`SWITCH_EMBED_PADDING`; `data.padding` of the embedding for another one, a part of the card's size, `0` for none), so no card of the inner view touches the border of the card holding it, at any depth. This is a [drawing convention](#drawing-conventions). The camera formula of a portal takes the margin into account, so the swap stays invisible.

`SwitchStaticView` has two more uses, both for the same reason, that it needs nothing but a React tree: the **mask** that covers the canvas while its nodes are replaced, and the off-screen **measuring host**, which draws a view once so its sizes are known before a camera or a morph needs them (`viewsMeasured`).

## The ways of switching

`switchRouteFind(from, to)` chooses the steps:

| The two views | The steps | What the reader sees |
| --- | --- | --- |
| `to` is embedded in `from` | a **portal in** | the camera goes into the card, the box grows to the viewport |
| `from` is embedded in `to` | a **portal out** | the same way back |
| they have nodes in common | a **morph** | shared nodes move and resize, the others fade |
| a view above embeds both | a portal out, then a portal in | out to the common view, in to the other |
| anything else | a morph with nothing shared | one fades out, then the other in |

The same id is the same thing: a generator keeps the id of a table in every view drawing it, and the morph follows from that.

### A portal

The body of the card and the map give a formula (`switchCameraParentOf`): for any camera of the embedded view, the camera of the parent which draws it **at exactly the same place**. So a portal is only a camera move in the parent, and the end of it is pixel for pixel the start of the child:

```text
parent's nodes on the canvas
  camera     from where it is, to the camera drawing the child at its own camera
  stylesheet the others fade; the card loses its frame and title; its clip opens, so what lay
             outside the box comes into view and the box grows to the viewport
then         the mask (the child, static, at its camera) over the canvas
             the canvas takes the child's nodes; when they are measured, the mask goes
```

A portal out is the same, in reverse, starting from the camera the reader left the child at.

### A morph

`switchMorphBuild` pairs the nodes of two views by id. A node in both keeps its React identity and moves; its handles are those of both views while the lines of the view left fade. Two nodes of one id with **different content** are two nodes: the old one, renamed `~from:{id}`, fades out while the new one fades in, both moving between the same places. A kind may say what counts as its content (`contract.morphKeyGet`), as the tabs header does, whose focus changes in place. `switchMorphFrameAt` gives the positions and sizes at a progress.

### Between two cameras

The zoom moves evenly in its logarithm and the translation follows the zoom (`switchCameraBetween`), so everything moves away from one fixed point of the screen: a zoom into a card goes straight into it.

## A frame is a function of a progress

`SwitchStore.frameApply(progress)` is the whole drawing of a step: a camera, a few node positions, one stylesheet written into a `<style>` of the block. No timer or CSS transition takes part, and no card renders per frame. A step has two possible clocks:

```text
a plain block          stepRun: requestAnimationFrame, eased
the animation layer    seek(way, progress): remotion's frame
```

A reader's motion preference (`prefers-reduced-motion`) makes the steps instant.

## Tabs

Some nodes of a view can stand in tabs: a header takes their place, the focused one stands under it at a size of its own, and the others leave (`switchTabsApply`). The difficulty is the lines, and they are **rewired, never dropped**:

| A line whose | goes |
| --- | --- |
| ends are both visible | as it was |
| one end left | to the tab of the member that left, on the side facing the other end |
| two ends left | between the two tabs, dashed and without a label |

Each tab is a view of its own, one path per focus (`/overview/tabs/run`), so a tab click is an ordinary switch: a morph in which the header stays, the member fades into the other, and each rewired line fades to its new place.

## A scrolling stack

A `view-embed` fits a whole view in a card, so a tall view gets small. A **stack** (`view-stack`) holds items vertically in a scrolling area, each **as wide as the area and as tall as that makes it** (`switchStackItemLayout`): nothing shrinks to make everything visible, and the reader scrolls. An item is a view (`view`, with its own `box` and `padding`) or a card (`node`), with a title line of its own. A small view does not grow past a limit (`SWITCH_STACK_ITEM_SCALE_MAX`) and stands centered.

```text
data: { title?, subtitle?, icon?, tone?, statList?, isChromeHidden?, itemList: [{ id, view | node, box?, padding?, link?, title?, subtitle?, icon?, tone? }] }
```

A stack is a kind of plain React like the embedded view, so it may stand on the canvas or inside an embedded view. A line may end on an item (the anchor `item/{id}`).

**The wheel** follows [the rule of every canvas](card-diagram.md#the-wheel-over-a-canvas). In its own view a stack takes the wheel while it can still scroll, and the end of that gesture stops there; a stack with nothing left to scroll, a stack embedded in a card, and a pinch all leave the wheel to the canvas, which zooms. An embedded stack still scrolls by its scrollbar.

**The scroll position is one, the store's.** A stack may be drawn several times at once (on the canvas, embedded in another view, over the canvas as the mask), so its position is kept by the view and the node (`stackKey`), every drawing follows it, and a switch never moves it. Programs set it the same way:

```text
store.scrollTo({ path?, nodeId?, itemId | top, isInstant? })    gliding, or at once; an item already in view stays where it is
store.pathSet('/overview/plan#batch')                           a path may name an item: arrive, then scroll to it
param.path of a block, link of a node or a line                 the same form
item of a state of an animation                                 a way ending with a scroll, drawn by the frame
```

**A switch into an item.** A view in an item opens by a portal like any embedded view, with `scroll` as a step of its own before it, bringing the item into view. The scroll area clips what is inside it, so the view cannot open in place: its static drawing stands over the canvas (the mask), moved by the same formula and clipped from the part of the item in view to the whole viewport (`switchMaskClipBuild`), while everything else fades. The way back starts from there, and the stack is where it was left.

**A picture** is made from a copy of the html, which has no scroll position: while it is made, the area holds its place by a transform (`switchScrollFreeze`).

## The bounding box

A `view-box` node (a kind of the [base series](card-diagram-impl.md#node-registries)) is a red frame. It is the one form of a box inside the layer; a `box` in a view's description becomes such a node when the view is read.

- The first one is the **default box** of the view: what its camera fits, and what an embedding shows. More of them are **regions**, which an embedding or a state of an animation names by id, as they may name a rect (`data: { view, box }`).
- It is drawn in the visual editor, where it is created from the panel and resized like any change of the draft (`nodeResize`, undone like any step); and in a reading viewport while the box button of the path bar is on, where dropping or resizing it calls `provider.boxSave`.
- It never appears in a picture: its class is one of those the capture skips, whatever the state of the block.
- Switching the box button on in a view without a box places one around what the view draws.

## The path bar

`SwitchPathBar` stands left aligned over the viewport: one button per segment, whose click switches to it; the chevron before a segment lists the views beside it, the last chevron the views below. A back button walks the views visited. At the right: the picture menu (copy or download, PNG or SVG, of the view as it stands now, through the capture of the [animation](card-diagram-animation.md#pictures)), the camera back to the default of the view, the bounding box.

A reader's camera is remembered per path while the block lives, and is where a return to the path arrives; the fit button forgets it.

## Under the animation layer

The layer can be played by the [animation](card-diagram-animation.md): a state names a view (and optionally a region of it), and a transition plays the way between two views. `SwitchAnimation` draws the same control area (`AnimationControl`, which reads the interface `SwitchAnimationStore` implements) over the path bar and the canvas; the canvas is the composition of remotion's `Player`; each segment of the plan writes its frame into `SwitchStore.seek`. Seeking gives the same picture as playing, because of [the rule above](#a-frame-is-a-function-of-a-progress).

```text
stateList       [{ id, name, description?, view, box?, item? }]
transitionList  [{ from, to, name?, second? }]; absent, a chain
```

The tracks of an animation of one diagram (rings, tokens, a target's properties) are not part of this form: a state is a place, not a scene ([TODO](../../../main/doc_page_impl_TODO.md#switch-animation-scene)).

## Drawing conventions

What every view follows, beside [those of the framework](card-diagram.md#drawing-conventions):

- **A margin inside what embeds.** A card or an item showing a view keeps a margin around it. Nothing of the inner view touches the border of what holds it, also for an embedding inside an embedding. Write `padding: 0` only where the inner view has no border of its own to touch it.
- **What is long scrolls, it does not shrink.** Sections of different heights belong in a stack rather than in a grid of cards fitted to one size.

## Adding to it

| Change | Where | Check |
| --- | --- | --- |
| a new way of switching | `switchRouteFind`, a step type in `SwitchStore.stepEnter` / `frameApply` / `stepExit` | a pure function of a progress; `routeTimelineGet` knows its duration without measuring; a test in `SwitchData.test.js` |
| a node that opens a view | `link: {path}` on any node or connection of a diagram | no kind needed; the canvas answers the click, the label of a line becomes a button |
| another source of views | a provider | the views are ordinary diagrams; ids stay the same across views where a morph is wanted |
| a new kind | [Adding a kind](card-diagram.md#adding-a-kind); `morphKeyGet` if part of its data changes in place | it draws without React Flow as well as with it: a card reads `SwitchContext` for `isStatic` before doing anything needing the canvas |

The rules that must hold:

- **The layer knows no series and no domain**, and no language: every word of a view comes from its provider.
- **One canvas.** A second React Flow in a block is the thing this design exists to avoid.
- **A frame is a function of a step and a progress.** Nothing moves by a timer of its own; nothing renders a card per frame.
- **A swap is never seen.** Nodes are replaced only under the mask, or in a morph.
- **A view that cannot be drawn says why**, naming the node or the line, and the path bar still works.

## Implementation

| Place | Role |
| --- | --- |
| `comp-mdx/card-diagram-switch/SwitchData.js` | pure: paths, the document, tabs, cameras, the route, a morph, the stylesheets of a frame |
| `SwitchStore.js` | the state of a viewport: its views, the nodes on the canvas, the transition, the box, both clocks |
| `SwitchCanvas.jsx` | the canvas, the lines with html labels, the mask, the measuring host |
| `SwitchStatic.jsx` | a view without React Flow; `SwitchContext` |
| `SwitchNodeKinds.jsx` | `view-embed`, `view-stack`, `view-tabs`, `switchRegistryBuild` |
| `SwitchPathBar.jsx` | the path bar |
| `SwitchAnimation.jsx`, `SwitchAnimationStore.js` | under the animation layer |
| `CardDiagramSwitch.jsx` | `SwitchViewport`, the block of a document, `cardDiagramSwitchCompCreate`, the hooks a generator of views uses |
| `card-diagram-switch-comp.js`, `SwitchSource.js`, `comp.yaml` | the registration, the starting text, the build-time dependencies |
| `comp-mdx/card-diagram/ViewBoxCard.jsx` | the bounding box, in the base series |
| `comp-mdx/power-platform/power-platform-comp.js` | `DiagramERSwitch` |
