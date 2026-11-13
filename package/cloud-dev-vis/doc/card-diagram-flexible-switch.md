# Card Diagram Flexible Switch: Design

A feature layer over the [card diagram framework](card-diagram.md): **many scenes in one viewport**, each with a path, switched smoothly. A reader moves between an overview, the diagram inside one of its cards, a detail of that diagram, and back; at any scene they can pan, zoom and take a picture. The layer knows nodes, connections, paths and cameras, never what a diagram is about. What authors write is in [comp-card-diagram-switch.md](../comp-mdx/card-diagram-switch/comp-card-diagram-switch.md); this document is the design, and what to go through before changing it.

```text
[path bar]                overview > tables > account     ←  picture  fit  box
[react-flow viewport]     one canvas, showing one scene
```

## The concepts

- A **scene** is a diagram of the [card diagram format](card-diagram-impl.md#core-model) with a **path** (`/overview/tables/account`) and a label. Its folders are the segments of the path bar.
- A **view** is one way a scene is drawn. A scene has one or more and shows one at a time, as [a table card has views](../comp-mdx/power-platform/comp-diagram-er.md#table-card-views); [the views of a scene](#the-views-of-a-scene) are below. A scene with a single diagram has one view and needs no declaration.
- A **provider** is whatever has scenes. The layer asks it three things and assumes nothing else, so scenes may be written in a document or generated from data:

```text
provider
  root                    the first scene
  sceneGet(path)          { path, label, description, diagram, box? }, or { path, label, description, viewList, viewDefault?,
                          isViewSwitcherHidden?, ... }, or null when the path names nothing. a path here never names a view
  labelGet(path)          the word of a segment of the path bar
  childListGet(path)      the scenes below a path, the menu of the path bar: [{ path, label, description?, labelItemList? }]
  boxSave?(path, rect)    what a bounding box adjusted by the reader does
  linkOpen?(link)         a link of a node the provider answers itself (true: taken): one that is not
                          a scene, since it leaves the viewport for a page of whoever hosts it
  signature?              what the scenes are made of (the text of the document, the data they are generated
                          from): a provider built again with the same one is the same, nothing is read again
  transition?             { secondPortal, secondMorph, secondCamera, secondScroll }
```

- A **diagram a provider builds in code** may give one object to many of its parts (one style to every line, one renderer to every node), however many they are: the scene is loaded with each written out where it stands.
- A **bounding box** is the part of a scene shown by default, and shown when the scene is embedded. Without one it is everything the scene draws.
- An **embedded scene** is a card of one scene showing another scene inside it.
- A **switch** is the way from the scene shown to another: a list of steps, each drawn from a progress.

The [animation layer](card-diagram-animation.md) has its own word *scene*, what the targets look like at a state of one diagram (`AnimationData.js`). It has nothing to do with these: everything named scene in this document has a path.

## One canvas, no canvas inside a canvas

A block has one React Flow canvas (`SwitchCanvas`). It holds the nodes of one scene at a time, or of a morph between two.

**An embedded scene is plain React.** The `scene-embed` kind draws the world of the other scene with `SwitchStaticScene`: the same `Card` components the canvas uses, placed absolutely, their lines in one svg, under one CSS transform. It has no React Flow, no handles to measure twice, no camera of its own: its "camera" is a pure map from the box of the scene to the body of the card (`switchEmbedMapBuild`). A scene may embed a scene that embeds another; a path already in the chain is refused where it would draw, and a depth limit stops the rest.

**A chosen box is the edge of what is shown.** A scene with a bounding box, or an embedding naming a region, shows that part alone: the world is clipped to it (`switchBoxClipBuild`), and a portal opens that clip as the box grows. A scene without a box has no such edge, since its lines may run outside its cards.

**An embedded scene keeps a margin inside its card.** The box of the scene fits the body of the card less a small margin on every side (`SWITCH_EMBED_PADDING`; `data.padding` of the embedding for another one, a part of the card's size, `0` for none), so no card of the inner scene touches the border of the card holding it, at any depth. This is a [drawing convention](#drawing-conventions). The camera formula of a portal takes the margin into account, so the swap stays invisible.

`SwitchStaticScene` has two more uses, both for the same reason, that it needs nothing but a React tree: the **mask** that covers the canvas while its nodes are replaced, and the off-screen **measuring host**, which draws a scene once so its sizes are known before a camera or a morph needs them (`scenesMeasured`).

### Presentation context

`SwitchContext.presentation` is `{ path, view, isEmbedded, isFocused, pathEmbedder, depth, depthMax }`: the owning scene's path, the view drawn, and how that scene is being presented. Focused means directly on the canvas, not keyboard focus. `pathEmbedder` is the scene directly holding this one when embedded, else null. It is not the parent in the tree of paths: a scene may embed one that lies anywhere. The canvas provides focused presentation for `store.pathFlow`. `SceneEmbedCard` and `SceneStackItem` explicitly pass `isEmbedded` and `pathEmbedder` when drawing their child with `SwitchStaticScene`; nested scenes stay embedded, each with its own embedder. A static root used for a transition mask or off-screen measurement defaults to focused presentation, matching the canvas it represents.

**Depth.** `depth` is how deep the scene is drawn inside cards: 0 on the canvas (and for a static root standing for it, the mask, the measuring host), one more inside each card or stack item. `depthMax` is the deepest a scene is drawn in this block: the block's `depthMax` (`SwitchStore.depthRenderMax`, from the document or the parameters of a generator, 3 by default). Whatever draws a scene inside it asks `switchPresentationChildIsDrawn(presentation)` first: a `scene-embed` past the limit draws its card with a note (the scene opens on a click), a stack item its frame, and `SwitchStaticScene` draws nothing deeper than `depthMax` whoever asks. A card may read both, as it reads whether it is embedded, to draw less when it is deep. A stack placed by `focusPath` keeps the depth of the scene it stands in, since it is drawn there directly.

Do not infer presentation from `isStatic`: that flag describes the rendering technique and still controls static pointer/wheel behavior. Cards can read the presentation from `SwitchContext`; registered title components receive it through `config.visualization.presentation` as well.

A direct `scene-stack` may declare `data.focusPath`. `switchStackPresentationBuild` derives the stack's presentation from that path: the same stack node is embedded in an overview (the embedder being that overview) and focused in its dedicated scene, without an enclosing `scene-embed`. Its node ID and data stay the same, so the switch is a morph, not a portal that removes an outer card. `isFrameVisibleFocused` defaults to true and controls only the focused frame's decoration; it never replaces or removes the scrolling stack.

## The views of a scene

What an author writes is in [Views of a scene](../comp-mdx/card-diagram-switch/comp-card-diagram-switch.md#views-of-a-scene). A view has a diagram and a box of its own; the rest of a scene (its path, its label, its place in the tree) is shared.

**A view is drawn as a scene is.** A path may name a view (`/overview/er@matrix`), read by `switchPathViewRead`. Everything keyed by a path, the entries of the store, cameras, measurements, a step of a switch, the mask, is keyed by that full form, so nothing downstream of `SwitchStore.entryGet` knows views exist. Providers, labels and the tree of paths use the scene alone. A path written without a view resolves when it is read (`pathResolved`), so a key is never ambiguous.

**Which view is shown** is one function, `switchViewResolve(desc, presentation, wantedList)`, of a description, a presentation, and what is wanted in order:

| Presented | Wanted, first to last | Then |
| --- | --- | --- |
| focused (`pathFocusedOf`) | the view the path names, the reader's choice for focusing it | `viewDefault`, the first available |
| embedded (`embedPathOf`) | the reader's choice for that embedder, the view the embedding asks for | `viewDefault`, the first available |

Only views available in that presentation count, so nobody can show one a scene keeps from it. A scene keeping all of them from a presentation still has all of them there, since something has to be drawn. The reader's choice (`store.viewSet({ path, view, pathEmbedder })`) lasts while the block lives, one per scene and presentation, and only the embedding it was made in follows it.

**A hover view** (`viewHover`, read like `viewDefault` by `switchViewHoverResolve`; `viewHover` of a card goes first, `false` for none) replaces what a `scene-embed` on the canvas shows while a pointer rests on it, unless the reader chose a view on that card. Both views stand in the card as layers, each with its own map and clip, and the pointer only changes which is seen (a short fade of opacity, which is not a step of a switch, so it does not fall under [the rule of frames](#a-frame-is-a-function-of-a-progress)). So a hover costs nothing to draw and has nothing to measure. The pointer is the card's own state; the store does not know it, so a route does not depend on where the pointer is.

**A view alone in its card** (`isFrameHiddenEmbedded`) takes away the frame, the title line and the margin, for as long as it is what the card shows. It is a layer of the card rather than of its body, mapped to the whole card with no margin (`switchEmbedCardRectOf`), and `embedPlaceGet` gives a portal the same map, so that swap stays invisible too. The title line keeps its room, only unseen, so the body and the other layers do not move. Handles stay on the card: a line arriving at the side ends there, and the view reaches it by being drawn at the size of the card, so the layer needs no knowledge of lines, and no line is rerouted when the frame comes and goes.

**Default views differ between presentations, and a portal must not show that.** The end of a portal is exactly what the card shows, so a portal always goes to the view on the card; a morph then goes on to the view asked for, and on the way out they run in the opposite order. A card with a hover view always opens through it (`embedListOf`), since that is a preview of opening. The store holds that view on the card for the whole way (`embedHeld`), whatever the pointer does, and lets go when the way ends, so on the way out the card returns to its view at rest only after the camera has left. A stack item has no hover view: its height follows its view. See [the ways of switching](#the-ways-of-switching). Two views of one scene are a morph directly, never out and back in through what embeds them. A generator keeps node ids across views where something should move rather than fade, as it does across scenes.

**Views as tabs** (`viewSwitcherLayout: tabs`, `SwitchViewTabs`): where a stack item embeds the scene, the switcher is a row of its own under the item's title, a search field (`isViewSearchable`, `switchViewSearch`) and a strip of tabs on one line, moved sideways by the wheel or a drag without a scrollbar (`ScrollHorizontal` of the page; the wheel only in the stack's own scene, where the stack takes it), so a search or a choice never changes the row's height. The item's body is as tall as its tallest view (each view is measured once, `scenesMeasured`, and `switchStackItemLayout` is taken of each), so choosing a tab moves nothing below. The row is drawn in a static copy too, inert, so a mask or a picture has the same geometry. Elsewhere the views keep the menu.

**The switcher** (`SwitchViewSwitcher`) is the control of a table card. It stands in the path bar for the scene focused, and in the title line of a card or a stack item embedding it, for that embedding, not in a card inside another embedded scene, which takes no pointer. With one view available it shows words alone. Switching a view on a card draws the other view at once: a card has no steps of its own.

## The ways of switching

`switchRouteFind(from, to)` chooses the steps:

| The two scenes | The steps | What the reader sees |
| --- | --- | --- |
| `to` is embedded in `from` | a **portal in** | the camera goes into the card, the box grows to the viewport |
| `from` is embedded in `to` | a **portal out** | the same way back |
| they have nodes in common | a **morph** | shared nodes move and resize, the others fade |
| a scene above embeds both | a portal out, then a portal in | out to the common scene, in to the other |
| two views of one scene | a morph | as above |
| anything else | a morph with nothing shared | one fades out, then the other in |

A portal goes to the view on the card. When that is not the view asked for, a morph follows, and on the way out it comes first (`switchRouteFind`).

The same id is the same thing: a generator keeps the id of a table in every scene drawing it, and the morph follows from that.

### A portal

The body of the card and the map give a formula (`switchCameraParentOf`): for any camera of the embedded scene, the camera of the parent which draws it **at exactly the same place**. So a portal is only a camera move in the parent, and the end of it is pixel for pixel the start of the child:

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

`switchMorphBuild` pairs the nodes of two scenes by id. A node in both keeps its React identity and moves; its handles are those of both scenes while the lines of the scene left fade. Two nodes of one id with **different content** are two nodes: the old one, renamed `~from:{id}`, fades out while the new one fades in, both moving between the same places. A kind may say what counts as its content (`contract.morphKeyGet`), as the tabs header does, whose focus changes in place. `switchMorphFrameAt` gives the positions and sizes at a progress.

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

Some nodes of a scene can stand in tabs: a header takes their place, the focused one stands under it at a size of its own, and the others leave (`switchTabsApply`). The difficulty is the lines, and they are **rewired, never dropped**:

| A line whose | goes |
| --- | --- |
| ends are both visible | as it was |
| one end left | to the tab of the member that left, on the side facing the other end |
| two ends left | between the two tabs, dashed and without a label |

Each tab is a scene of its own, one path per focus (`/overview/tabs/run`), so a tab click is an ordinary switch: a morph in which the header stays, the member fades into the other, and each rewired line fades to its new place.

## A scrolling stack

A `scene-embed` fits a whole scene in a card, so a tall scene gets small. A **stack** (`scene-stack`) holds items vertically in a scrolling area, each **as wide as the area and as tall as that makes it** (`switchStackItemLayout`): nothing shrinks to make everything visible, and the reader scrolls. An item is a scene (`scene`, with its own `box` and `padding`) or a card (`node`), with a title line of its own. A small scene does not grow past a limit (`SWITCH_STACK_ITEM_SCALE_MAX`) and stands centered.

```text
data: { titleBar?, title?, subtitle?, icon?, tone?, statList?, isChromeHidden?, itemList: [{ id, scene | node, box?, padding?, link?, title?, subtitle?, icon?, tone? }] }
```

A stack is a kind of plain React like the embedded scene, so it may stand on the canvas or inside an embedded scene. A line may end on an item (the anchor `item/{id}`).

**The height of a stack** is the height of its node, in which it scrolls, or that of its items (`isHeightFullEmbedded`, `isHeightFullFocused`; `switchStackHeightIsFull`). The store turns a stack at full height into a node of `height: auto` when it reads a scene (`entrySourceLoad`), so the rest of the layer knows no other case: it is measured as any card of that height, its scroll position reads 0 whatever another copy keeps (`stackFullKeySet`), and the camera follows its height as its items are drawn, until the reader moves it. What is chosen later (`stackHeightFullSet`, its button) is kept per presentation and goes first; the scenes drawing that copy are read again. A switch on the canvas must not jitter: the current camera is kept as the reader's own, so nothing refits it, the nodes keep what React Flow measured (`flowRefresh`; a node it has not measured is hidden for some frames), and a stack at full height keeps the room of the scrollbar (`scrollbar-gutter`), or its items would change scale.

**The stack's title bar** is outside the scrolling frame. `titleBar` is text, or `{ text | itemList, isVisibleEmbedded?, isVisibleFocused? }`; its visibility follows presentation, not static rendering. Both flags default to true. Absence preserves legacy chrome. `SceneStackTitleBar` renders text or registered `visualizationTitle` components, with stable per-node/item instance IDs and normal component event routing. It wraps content at a minimum height of 34 px; resizing the scrolling frame updates its measured geometry. The authoring contract and examples are in [The stack title bar](../comp-mdx/card-diagram-switch/comp-card-diagram-switch.md#the-stack-title-bar). `switchDependenciesCollect` visits title components even when hidden and descends into stack item nodes, so their declared dependencies survive a build.

**The wheel** follows [the rule of every canvas](card-diagram.md#the-wheel-over-a-canvas). In its own scene a stack takes the wheel while it can still scroll, and the end of that gesture stops there; a stack with nothing left to scroll, a stack embedded in a card, and a pinch all leave the wheel to the canvas, which zooms. An embedded stack still scrolls by its scrollbar.

**The scroll position is one, the store's.** A stack may be drawn several times at once (on the canvas, embedded in another scene, over the canvas as the mask). `stackKey` identifies each scene and node for geometry. An optional `focusPath` aliases only the saved scroll state to that path and node ID, allowing overview and focused copies to share it without mixing their measurements. `stackScrollGet` resolves this alias; registered copies follow writes. Native scroll anchoring is disabled, transition-generated scroll events are ignored, and a copy clamped by its smaller scroll range does not overwrite the saved position. Programs set it the same way:

```text
store.scrollTo({ path?, nodeId?, itemId | top, isInstant? })    gliding, or at once; an item already in view stays where it is
store.pathSet('/overview/plan#batch')                           a path may name an item: arrive, then scroll to it
param.path of a block, link of a node or a line                 the same form
item of a state of an animation                                 a way ending with a scroll, drawn by the frame
```

**A switch into an item.** A scene in an item opens by a portal like any embedded scene, with `scroll` as a step of its own before it, bringing the item into view. The scroll area clips what is inside it, so the scene cannot open in place: its static drawing stands over the canvas (the mask), moved by the same formula and clipped from the part of the item in view to the whole viewport (`switchMaskClipBuild`), while everything else fades. The way back starts from there, and the stack is where it was left.

**A picture** is made from a copy of the html, which has no scroll position: while it is made, the area holds its place by a transform (`switchScrollFreeze`).

## The title of a scene

Embedded, a scene is named by what holds it: the title line of a card or of a stack item. Focused, nothing does, and the path bar only says where it is, in short words. So a scene focused has a **title**: a node of its world (`~title`, of the kind `scene-title`), a heading in the style of a section of the page, standing above the box of the scene at its left. It zooms and pans with the cards, as one of them.

- **What it says**: `store.titleOf(path)`, the `title` of the view shown, else of the scene, else its `label`; none with `isTitleHidden` (a scene whose content starts with its own title, a report's stack with its title bar). A provider gives a title that stands alone, the kind with the name ("Schema mapping — Account → Customer"), since the short words of the path bar are not beside it in a picture or at a glance.
- **Where and how large** (`titleRectOf`): above the box by a gap, at its left, or centered over it by its width as drawn where the component's config says so (`SceneTitleAlign: center`, `switchConfigDefineList`, which every component drawing a viewport declares, so a doc page sets it in its config under `compConfig`). Its size grows with a scene wider than a base width (`titleScaleOf`), so it keeps its weight beside what it names; its width is guessed from its words until it is measured.
- **Its height is its line.** Its node is `SWITCH_TITLE_HEIGHT * scale` high, and the card sets its margin (none), font size and line height inline from the same constant (`SceneTitleCard`), so the heading rules of a page, which reach an `h2` by its name, cannot make it taller than its node; it is also `not-prose`, as every node is ([the box of a node](card-diagram-impl.md#numeric-dimensions-and-the-box-of-a-node)).
- **Only where the scene is focused.** The layer adds it to the nodes of the canvas (`flowListOf`, so a morph between two views moves it as any card) and to a static root drawn as the canvas draws it (the mask, the measuring host); it is not in the scene's own graph, so an embedded copy, the box of the scene and everything an embedding derives from the box stay as they were. The camera of a scene focused fits its box and its title (`sceneBoxFocusedGet`, through `cameraDefaultGet`); a portal ends on that camera as on any other. It takes no pointer.

## Search in scenes

[Search](card-diagram-impl.md#search) is the framework's; the layer gives it the scene shown and what lies inside its cards. `SwitchStore.searchRun(request)` searches `pathCurrent` with its [title](#the-title-of-a-scene), a node the layer draws and not one of the scene's graph, added to what is searched where it is drawn (`scene-title` answers by its words alone, as a whole); a scene inside a card has no title drawn, its card names it; `scene-embed`, `scene-stack` (its items: their words, their cards, their scenes) and `scene-tabs` answer through `contract.searchMatch`, asking for a scene inside through `helper.childSearch`, which the store answers with the view that card shows (`embedPathOf`), searched in turn. The bar offers the depth (0 is the scene shown alone), starting at the depth drawn; a search may go deeper than what is drawn, and then marks the card holding what it found.

What is found inside a scene drawn in a card is marked there too (`SwitchStaticScene` gives its path to the marks), and the cards holding the current item are marked current. Bringing it into view scrolls a stack of the scene shown to the item holding it, then moves the camera.

## The bounding box

A `scene-box` node (a kind of the [base series](card-diagram-impl.md#node-registries)) is a red frame. It is the one form of a box inside the layer; a `box` in a scene's description becomes such a node when the scene is read.

- The first one is the **default box** of the scene: what its camera fits, and what an embedding shows. More of them are **regions**, which an embedding or a state of an animation names by id, as they may name a rect (`data: { scene, box }`).
- It is drawn in the visual editor, where it is created from the panel and resized like any change of the draft (`nodeResize`, undone like any step); and in a reading viewport while the box button of the path bar is on, where dropping or resizing it calls `provider.boxSave`.
- It never appears in a picture: its class is one of those the capture skips, whatever the state of the block.
- Switching the box button on in a scene without a box places one around what the scene draws.

## The path bar

`SwitchPathBar` stands left aligned over the viewport: one button per segment, whose click switches to it; the chevron before a segment lists the scenes beside it, the last chevron the scenes below. Three buttons stand before the path. Back and forward walk the scenes visited, as in a browser: a new way forgets what lay forward (`store.back`, `store.forward`). Up goes one level up the path, to the nearest folder that is a scene (`store.up`), and is itself a step that back can undo. **A path wider than its place does not wrap and has no scrollbar**: it is a strip moved by the wheel over it or by a drag (`ScrollHorizontal`, its offset in `store.pathScroll`, kept with the block), the page not scrolling meanwhile; a switch brings the segment of the scene shown into sight with what follows it (the view switcher, the chevron of the scenes below), and every segment says its full label in its title. At the right: the picture menu (copy or download, PNG or SVG, of the scene as it stands now, through the capture of the [animation](card-diagram-animation.md#pictures)), the camera back to the default of the scene, the bounding box. The buttons are those of a panel's header (`.doc-button-icon.is-panel` of the page's shared styles) and the bar has the header's sides, so in the block popup the ones at the right stand right under its maximize and close buttons; nothing is reserved beside them.

**An item of a menu** shows its `label` (the simple mode). When it has a `labelItemList` (the complex mode), it shows that instead, a list of things of different types, and `label` stays what the segment of the path bar and a screen reader say:

| Type | Shows |
| --- | --- |
| `{ type: text, text }` | words |
| `{ type: icon, icon }` | an icon, by the name a card uses (`database`, `list-checks`, ...) |
| `{ type: custom, comp, data? }` | a component, given `{ data }`: a React component from a provider in code, or from YAML the name of a registered component with the placement `visualizationNode` |

```yaml
sceneList:
  - path: /overview/source
    label: Source
    labelItemList: [{ type: icon, icon: database }, { type: text, text: Source }]
```

After the last segment stands [the switcher](#the-views-of-a-scene) of a scene with views.

A reader's camera is remembered per path, and so per view, while the block lives, and is where a return to the path arrives; the fit button forgets it. The block lives longer than a mount of it: `useSwitchStore` keeps the store in the block's component state ([stores kept across mounts](../../../main/doc_page_impl_mdx_comp_state.md#stores-kept-across-mounts)), so when the document enters or leaves edit mode the block comes back at the scene, the view and the camera the reader left, with its cards measured, and paints them in its first frame (a new canvas starts from `cameraLive`, the camera the last one had). A provider built again on the new mount is taken as it is (`providerAdopt`) when its `signature` is the one of the provider the store holds; a provider without a signature, or with another, reads the scenes anew (`providerSet`). The animation over it (`SwitchAnimationStore`) is kept with it.

## Under the animation layer

The layer can be played by the [animation](card-diagram-animation.md): a state names a scene (and optionally a region of it), and a transition plays the way between two scenes. `SwitchAnimation` draws the same control area (`AnimationControl`, which reads the interface `SwitchAnimationStore` implements) over the path bar and the canvas; the canvas is the composition of remotion's `Player`; each segment of the plan writes its frame into `SwitchStore.seek`. Seeking gives the same picture as playing, because of [the rule above](#a-frame-is-a-function-of-a-progress).

```text
stateList       [{ id, name, description?, scene, view?, box?, item? }]
transitionList  [{ from, to, name?, second? }]; absent, a chain
```

The tracks of an animation of one diagram (rings, tokens, a target's properties) are not part of this form: a state here says where the block is, not what the targets look like there ([TODO](../../../main/doc_page_impl_TODO.md#switch-animation-scene)).

## Drawing conventions

What every scene follows, beside [those of the framework](card-diagram-usage.md#drawing-conventions):

- **A margin inside what embeds.** A card or an item showing a scene keeps a margin around it. Nothing of the inner scene touches the border of what holds it, also for an embedding inside an embedding. Write `padding: 0` only where the inner scene has no border of its own to touch it.
- **What is long scrolls, it does not shrink.** Sections of different heights belong in a stack rather than in a grid of cards fitted to one size.

## Adding to it

| Change | Where | Check |
| --- | --- | --- |
| a new way of switching | `switchRouteFind`, a step type in `SwitchStore.stepEnter` / `frameApply` / `stepExit` | a pure function of a progress; `routeTimelineGet` knows its duration without measuring; a test in `SwitchData.test.js` |
| a node that opens a scene | `scene-link` when opening is all it does ([convention](card-diagram-usage.md#drawing-conventions)); `link: {path}` on any other node or connection of a diagram | no kind needed; the canvas answers the click, the label of a line becomes a button. A part of a card opens one with the attribute `data-switch-link`, as the headers and cells of a `card-matrix` do, so the card need not know this layer |
| another condition on the default view | `switchViewRuleMatch`, `switchViewListCheck` | it reads the presentation and nothing else; for what a rule cannot say, a provider's `viewDefault` may be a function |
| another source of scenes | a provider | the scenes are ordinary diagrams; ids stay the same across scenes where a morph is wanted |
| a new kind | [Adding a kind](card-diagram.md#adding-a-kind); `morphKeyGet` if part of its data changes in place | it draws without React Flow as well as with it: a card reads `SwitchContext` for `isStatic` before doing anything needing the canvas |

The rules that must hold:

- **The layer knows no series and no domain**, and no language: every word of a scene comes from its provider.
- **One canvas.** A second React Flow in a block is the thing this design exists to avoid.
- **A frame is a function of a step and a progress.** Nothing moves by a timer of its own; nothing renders a card per frame.
- **A swap is never seen.** Nodes are replaced only under the mask, or in a morph.
- **A scene that cannot be drawn says why**, naming the node or the line, and the path bar still works.

## Implementation

| Place | Role |
| --- | --- |
| `SwitchNodeKinds.jsx` also | `scene-link`, the standard link: `CardBrief` in a pill as wide as its words (`contract.isWidthFit`, a width of `max-content` on the canvas and in a static scene) |
| `comp-mdx/card-diagram-switch/SwitchData.js` | pure: paths, the views of a scene, the document, tabs, cameras, the route, a morph, the stylesheets of a frame |
| `SwitchStore.js` | the state of a viewport: its scenes, the nodes on the canvas, the transition, the box, both clocks |
| `SwitchCanvas.jsx` | the canvas, the lines with html labels (the pointer on a line or on its label, or a keyboard on its button, marks both, the whole line with a band in its color: `switchEdgeHoverStyleBuild`. The state is each line's own, so a hover renders that line alone), the mask, the measuring host |
| `SwitchStatic.jsx` | a scene without React Flow; `SwitchContext` |
| `SwitchNodeKinds.jsx` | `scene-embed`, `scene-stack`, `scene-tabs`, `switchRegistryBuild` |
| `SwitchPathBar.jsx` | the path bar |
| `SwitchViewSwitcher.jsx` | the menu of the views of a scene |
| `SwitchAnimation.jsx`, `SwitchAnimationStore.js` | under the animation layer |
| `CardDiagramSwitch.jsx` | `SwitchViewport`, the block of a document, `cardDiagramSwitchCompCreate`, the hooks a generator of scenes uses |
| `card-diagram-switch-comp.js`, `SwitchSource.js`, `comp.yaml` | the registration, the starting text, the build-time dependencies |
| `comp-mdx/card-diagram/SceneBoxCard.jsx` | the bounding box, in the base series |
| `comp-mdx/power-platform/power-platform-comp.js` | `DiagramERSwitch` |
