# Card Diagram Flexible Switch: Design

A feature layer over the [card diagram framework](card-diagram.md): **many scenes in one viewport**, each with a path, switched smoothly. A reader moves between an overview, the diagram inside one of its cards, a detail of that diagram, and back; at any scene they can pan, zoom and take a picture. The layer knows nodes, connections, paths and cameras, never what a diagram is about. What authors write is in [card-diagram-usage-flexible-switch.md](card-diagram-usage-flexible-switch.md); this document is the design, and what to go through before changing it.

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
  linkOpen?(link)         a link of a node or of the label of a line that the provider answers itself
                          (true: taken): one that is not a scene, since it leaves the viewport for
                          a page of whoever hosts it, or acts on it (a zettel opened, an object)
  commandListGet?(path, target)   what can be done in a scene, or with a thing of it: [command], or
                          { heading?, placeholder?, list } (#commands)

a scene (or a view of it) may also say
  edit?                   { source, save(raw, { title }), isStructureFixed?, fieldIsEditable?, react?,
                          isTitleEditable?, label?, registry?, createSourceList?, createActionList? }: the
                          scene edited where it is drawn (#a-scene-edited-in-place)
  signature?              what the scenes are made of (the text of the document, the data they are generated
                          from): a provider built again with the same one is the same, nothing is read again
  transition?             { secondPortal, secondMorph, secondCamera, secondScroll }
```

- **A viewport shows one namespace**, a tree of paths, made of **sources**: the scenes of the block's own document, and **mounts**, the scenes of another source under a path ([Sources of scenes](#sources-of-scenes)). The provider a viewport asks is the one of its namespace.
- **The text of a block** is read by the `loadBuild(source, { registry, sourceRef, onEvent, config })` its component was made with (`cardDiagramSwitchCompCreate(registry, name, { loadBuild })`), which answers `{ spec: { root, title?, height?, depthMax? }, provider }`. By default the text is a document of scenes (`switchDocLoadBuild`); a component drawing scenes from data of its own reads that data instead, as `DiagramAwsArchitecture` reads the description of a system ([aws.md](aws.md#scenes-generated-from-a-description)).
- A **diagram a provider builds in code** may give one object to many of its parts (one style to every line, one renderer to every node), however many they are: the scene is loaded with each written out where it stands.
- A **bounding box** is the part of a scene shown by default, and shown when the scene is embedded. Without one it is everything the scene draws.
- An **embedded scene** is a card of one scene showing another scene inside it.
- A **switch** is the way from the scene shown to another: a list of steps, each drawn from a progress.

The [animation layer](card-diagram-animation.md) has its own word *scene*, what the targets look like at a state of one diagram (`AnimationData.js`). It has nothing to do with these: everything named scene in this document has a path.

## Sources of scenes

Where the scenes of a viewport are defined. Every path that is a scene belongs to exactly one **source**, and the viewport asks one provider, made of its sources:

<!--renderComp=DiagramText-->
```text
viewport                              a block of scenes, or a component's view
├── settings                          title, height, root, depthMax, transition: the block's
└── namespace                         one tree of paths
    ├── own scenes                    sceneList of the block's document (inline, or its asset item)
    └── mounts                        mountList: the scenes of another source under a path
        /shop  ◄── from: an asset item holding a document of scenes
                   its /overview    shows as  /shop/overview   (read-only here)
```

| Source | Defines its scenes | Edited |
| --- | --- | --- |
| a **document of scenes** (`sceneList`), the block's own text or the item of an asset-backed block | written | in the block: its text, or Visual ([Editing a block of scenes](#editing-a-block-of-scenes)) |
| a **mount** (`mountList`) of a document held in an asset item | written there | where it is held; read-only in the block that mounts it |
| a **generator**: a component's code over its data (`DiagramAwsArchitecture`, the migration explorer, a zettel) | by code | its data; a scene edited in place where its provider says so ([below](#a-scene-edited-in-place)) |

A generator is a viewport whose namespace is one source at `/`: nothing of it changes with mounts.

**A mount** (`switchMountRead`, `SwitchMount.js`) is `{ path, label?, from: { asset: { store, name | itemId, versionId? } }, sourcePath? }`: the source's `sourcePath` (`/` by default, all of it) shown at `path`. The composite provider (`switchProviderCompose`) routes a path to the source owning it and **translates both ways**: the paths of the source, the menus of the path bar, and every [reference](#references) of its diagrams (a link to `/overview/db` in the mounted document is drawn as a link to `/shop/overview/db`; one to a part not mounted names nothing, and says where it pointed). The host names mounted scenes by their viewport paths, as any other.

- **One owner per path.** An own scene below a mount, or at it when the source has a scene there, and two mounts at or below each other, are refused, naming both. An own scene above a mount is fine: `/shop` may be an own scene whose cards lead into `/shop/overview`.
- **What a source keeps.** A mounted document keeps its `defaults`; its `title`, `height`, `root`, `depthMax`, `transition` and `featureList` are its own block's and are not read here. A mounted scene is drawn with the viewport's registry; a document mounting another one is not read (one level of mounts).
- **A diagram mounted.** The item may hold one diagram of the card diagram format (`nodes`, `connections`, `defaults`, no `sceneList`) instead of a document of scenes: it is read as a document of that one scene at the root of the source, labelled by the mount (`switchMountDocOf`), so a drawing kept on its own (a scene of a drawboard) is shown in a viewport without being written twice; a reference inside it to `/` names it.
- **Loading.** A mount is read as a reference block reads its item (`DocAssetStore.refQuery`, `refLoad`; `useSwitchMounts`): the block draws its viewport once every mount is read or failed, saying so meanwhile. A mount that cannot be read (no such item, no text, not a document of scenes) is a scene at its path saying why; the rest of the namespace works. The provider's `signature` is the document's and the versions of its mounts, so an item given a new head rebuilds it and the viewport keeps its path.
- **Writing.** What a reader writes (a box adjusted) writes the source owning the scene; in a mounted scene it is refused with where the scene is held.
- **Compatible.** A document without `mountList` is read as before, with the provider of its document alone. Mounting a generator (a component exposing its `loadBuild` as a scene source, its registry joined) and the items of a frontend object are designed for later ([TODO](../../../main/doc_page_impl_TODO.md#switch-mount-generator)).

### References

A **reference** is a path written in a diagram that names a scene (`SwitchRef.js`: one walk for everything reading or rewriting them):

| Kind | Written |
| --- | --- |
| `link` | `link` of a node or a line, and a `link` anywhere in the data of a node (a cell of a matrix, a tab, an item of a stack) |
| `embed` | `data.scene` of an embedded scene (`data.view` asks for one of its views) |
| `stack` | `scene` of an item of a stack |
| `alias` | `data.focusPath` of a stack |

A reference is a path, maybe with a view (`@id`) or an item (`#id`); only text starting with `/` is one (`command:` is not). Beside them, `tabs.of` of a scene and `root` of a document name scenes. A reference may name nothing (its scene removed or moved): it says so where it is drawn, in the graph of relations, and in the card of the node holding it, and is never taken away for it.

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

What an author writes is in [Views of a scene](card-diagram-usage-flexible-switch.md#views-of-a-scene). A view has a diagram and a box of its own; the rest of a scene (its path, its label, its place in the tree) is shared.

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

`switchMorphBuild` pairs the nodes of two scenes by id. A node in both keeps its React identity and moves; its handles are those of both scenes while the lines of the scene left fade. Two nodes of one id with **different content** are two nodes: the old one, renamed `~from:{id}`, fades out while the new one fades in, both moving between the same places. A kind may say what counts as its content (`contract.morphKeyGet`), as the tabs header does, whose focus changes in place; a node of another kind is another drawing, so an overview of [marks](card-diagram-impl.md#marks) and a view of cards with the same ids morph each card into its mark. `switchMorphFrameAt` gives the positions and sizes at a progress.

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

**The stack's title bar** is outside the scrolling frame. `titleBar` is text, or `{ text | itemList, isVisibleEmbedded?, isVisibleFocused? }`; its visibility follows presentation, not static rendering. Both flags default to true. Absence preserves legacy chrome. `SceneStackTitleBar` renders text or registered `visualizationTitle` components, with stable per-node/item instance IDs and normal component event routing. It wraps content at a minimum height of 34 px; resizing the scrolling frame updates its measured geometry. The authoring contract and examples are in [The stack title bar](card-diagram-usage-flexible-switch.md#the-stack-title-bar). `switchDependenciesCollect` visits title components even when hidden and descends into stack item nodes, so their declared dependencies survive a build.

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

`SwitchPathBar` stands left aligned over the viewport. It is the bar of [a path-based view](#a-path-based-view-anywhere) (`PathNavBar`) walking the scenes, with what is the switch's own added: the switcher of views after the last segment and the buttons at the right. One button per segment, whose click switches to it; the chevron before a segment lists the scenes beside it, the last chevron the scenes below. Three buttons stand before the path. Back and forward walk the scenes visited, as in a browser: a new way forgets what lay forward (`store.back`, `store.forward`, over a `PathNavHistory`). Up goes one level up the path, to the nearest folder that is a scene (`store.up`), and is itself a step that back can undo. **A path wider than its place does not wrap and has no scrollbar**: it is a strip moved by the wheel over it or by a drag (`ScrollHorizontal`, its offset in `store.pathScroll`, kept with the block), the page not scrolling meanwhile; a switch brings the segment of the scene shown into sight with what follows it (the view switcher, the chevron of the scenes below), and every segment says its full label in its title. At the right: the buttons of the host before the viewport's own (`trailing` of `SwitchPathBar`, `barTrailing` of `SwitchViewport`: the picture menu of a block, copy or download, PNG or SVG, of the scene as it stands now, through the capture of the [animation](card-diagram-animation.md#pictures)), the commands of the scene when it has some (**+**, [below](#commands)), find, the camera back to the default of the scene, the bounding box, then **the buttons of the host at the end of the bar** (`end`, `barEnd`: what takes the viewport elsewhere, as an app opening it as large as its window). The buttons are those of a panel's header (`.doc-button-icon.is-panel` of the page's shared styles) and the bar has the header's sides, so in the block popup the ones at the right stand right under its maximize and close buttons; nothing is reserved beside them.

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

## A path-based view anywhere

The path bar and the history behind it are a **side feature of this layer**: anything else that shows one place of a tree of paths at a time uses the same two parts, so a reader walks a folder of papers as they walk scenes, and there is one bar to maintain. The switch layer is built on them itself (`SwitchPathBar`, `SwitchStore.history`); the other users are the mode Papers of the package cv (`@cv-dev/cv/doc/cv-sheet.md#the-papers`) and the mode Contents of the package map-styles (`@map-styles/doc/shikuchoson.md#the-mode-contents`).

```text
PathNav.js       the tree is a provider: { root, labelGet(path), childListGet(path), isFound?(path) }
                 (a switch provider's words, without its scenes)
                 PathNavHistory    back and forward, as a browser: visit, backTake, forwardTake
                 PathNavStore      the state of a view whose host has none: the place shown, its
                                   history, the strip of the bar, how far each place was scrolled
                 pathNavBuild(store, provider) -> nav: what the bar reads, from the data as it is now
PathNavBar.jsx   the bar: back, forward, up, the segments, the menus beside and below; slots for the
                 host (pathEnd after the path, trailing at the right), the noun of its titles, and an
                 icon for a root that has no name of its own (rootIcon: a house for the top of folders,
                 its words kept as its title)
```

- **The store knows no provider.** What a place is comes from the provider when the view is drawn (`pathNavBuild`), so the store may be kept across mounts ([stores kept across mounts](../../../main/doc_page_impl_mdx_comp_state.md#stores-kept-across-mounts)) while the data changes under it. A place that is gone (a paper removed) shows the nearest place above it that is one, else the root.
- **A root `/`** is a place of its own, the first segment of every path (the top of an object's folders); a root such as `/overview` stays the first segment as the switch layer reads it (`pathNavChain`).
- **Up** goes to the nearest folder above that is a place, and is a step back can undo, as in a block of scenes.
- **What it draws under the bar is the host's**: a table of a folder, a sheet of a paper. The bar has no height of its own to change: its path is a strip that never wraps. A table of what lies at a place is `FolderView` of react-comp-misc (with a `bodyHeight`, its head on top), as the mode Papers of the package cv and the mode Contents of map-styles draw theirs, never a table of the host's own (react-doc `AGENTS.md`, Reuse before building).

```jsx
const store = useCompStateStore(config, 'nav', () => new PathNavStore({ path: '/' }));
const nav = pathNavBuild(store, provider);            // provider: the host's tree, built from its data
<PathNavBar nav={nav} label="Path of the papers" trailing={...} />
{whatIsAt(nav.pathCurrent)}
```

## Commands

**A scene may say what can be done in it, and with each thing of it** (`provider.commandListGet(path, target)`), so that a reader does where a scene is drawn what forms do elsewhere: make something there, put things in another order, remove one. Asked when the reader asks:

| the reader | target |
| --- | --- |
| presses **+** in the bar (shown while the scene answers something), double-clicks the empty canvas, or right-clicks it | `{ kind: canvas, position }` |
| right-clicks a card | `{ kind: node, node, position }` |
| right-clicks a line, or its label | `{ kind: line, connection, position }` |

`path` is the scene's (`target.view` its view, `target.position` the point of the canvas where it was asked). The answer opens **the panel of a double-click in the visual editor** (`DiagramCreatePanel`: [card-diagram-impl.md](card-diagram-impl.md#sources-of-the-create-panel)) where the pointer was, kept inside the canvas, with no diagram being edited: no kinds of the registry, no objects, the commands alone, under `heading` (the thing they are of), the field saying `placeholder`; typing narrows them, Escape or a pointer elsewhere closes it, as does going to another scene or a new provider. Nothing answered: nothing opens, and the browser's own menu is left alone.

A command is an action of that panel, `{ id, label, description?, icon?, keywordList?, isDisabled?, reason?, start({ position, editor }) }`: its `start` does what it does and answers nothing (the panel closes), or answers **a state**, and the panel asks for what the command needs state by state, a search to choose from, several to tick, a text to type, as for any action of the panel. **What cannot be done there is shown, greyed out with why** (`isDisabled`, its `reason` in the place of its description), never hidden: a reader learns it exists and what it waits for. The editor given has no store; `editor.scene` is the scene it was asked in: `{ path, go(path), edit(path?) }`, to show another scene (what a command made), or to start the edit of a scene ([below](#a-scene-edited-in-place)).

**A click never opens what can be done with a thing.** That is a right-click; a click on a thing opens the scene behind it (`link`), or, in a scene edited in place, starts its edit there ([below](#a-scene-edited-in-place)). The one click that reaches a command is on what is drawn to make something: a node whose `link` is `command:{id}` (a dashed row *New action*) opens that command of the scene in its state, the panel asking for the first thing it needs; one that asks nothing is done at once, and nothing opens. A link `command:` alone, and one on the label of a line, open nothing.

**A command makes, orders or removes; a value is no command.** What a thing *is* (its name, a setting, how two things are joined) is changed where it is drawn, in the edit of its scene. **Which commands exist where is the provider's**: one scene makes things of its kind, another changes the order of them, a thing of a scene has its own; a provider generating its scenes from data gives them with its data and builds itself again when the data changes, the viewport staying in the scene it shows (`providerSet` keeps a path that is still there). db-migration-tool draws a check plan so (`graph/check-plan-scenes.js`).

## A scene edited in place

**A scene of a provider may be edited where it is drawn** (`edit` of its description, or of the description of its view): the visual editor of the framework ([card editing](card-diagram-impl.md#card-editing)) on a draft, over the canvas, with what writes the draft back. A component generating its scenes from data so has what a document of scenes has in its visual mode ([below](#editing-a-block-of-scenes)), one scene at a time, the data written by the provider.

```text
edit
  source                 the draft: a diagram, or its YAML. Give the diagram the scene itself draws (the
                         same nodes at the same places, every handle a line may be drawn from): the edit
                         then starts with nothing moving
  save(raw, { title })   writes the draft back: a promise (the writes of the provider's data, after which
                         it builds itself anew). title: the title typed, with isTitleEditable
  isStructureFixed?      the nodes, their rows, fields and handles are given: values and lines are edited
                         (card-diagram-impl.md#a-draft-whose-structure-is-given). A scene made from data
                         says so: its cards are not the reader's to add to
  fieldIsEditable?(node, rowId, fieldId)   which values may change; every one when absent
  react?(value, before)  after every change of the draft, what follows from it (a line from a cell, a cell
                         from a line): the draft to hold instead, written with the change as one step
  isTitleEditable?       the title of the scene is typed where it stands
  label?                 the word of the editor's bar (the kind of thing edited)
  registry?              the kinds the draft may hold, else the viewport's
  createSourceList?, createActionList?     of the panel of a double-click, while editing
  lineCardGet?(connection, editor)         the card of a line, drawn by the provider (card-diagram-impl.md#the-card-of-a-line-drawn-by-the-host)
  connectEmpty?({ from, position, connectionId?, role? }, editor)   a line let go where no handle takes it:
                         true when the provider took it (card-diagram-impl.md#a-line-let-go-where-nothing-takes-it)
  featureList?           the feature layers offered while editing (parametric-canvas: the tool bar and the
                         panel of card-diagram-parametric-canvas.md). A scene made again from data at every
                         change offers none; one only partly made from data may
```

**An edit starts from a click on the thing to change.** No mode is entered first: a click on a card, a row, a cell, a line (or its label), or the title of a scene whose draft has that thing starts the edit **with that thing focused** (`SwitchStore.sceneEditSelectOf`, `sceneEditStart(select)`): a text cell is being typed, a choice has its menu open, a row or a label has the edit card beside it. The pencil of the bar starts it with nothing focused, and ends it again.

**Nothing is seen to change place.** The editor stands over the canvas, which stays under it (`SwitchViewport`), and takes its place without a blink:

| | |
| --- | --- |
| the same picture | the draft is the diagram of the scene; the title of the scene is added to the draft as a node at its place (`SWITCH_TITLE_EDIT_ID`, of the kind `scene-title`: a `react` finds it there), and handed back apart on Save |
| the same camera | the editor opens at the camera of the canvas (`config.viewInitial`), and the canvas follows the editor's from then on (`sceneEditCameraSet`), so the scene is where it was when the edit ends |
| no blink | the editor is transparent until it has drawn at its camera (`data-ready` of its flow): until then the canvas under it is what is seen |
| no room taken | its bar (what is edited, unsaved or not, undo, redo, Save, Cancel) floats over the top of the canvas |

**An edit that changed nothing costs nothing.** It ends by itself when nothing is focused any more (Escape, a click on the empty canvas, the edit card closed: `sceneEditRest`) and when the reader goes to another scene, so looking at what a thing holds needs no Cancel. Once something changed, the path goes nowhere and the bar says so, until Save (Ctrl/⌘ + Enter) or Cancel.

**Save** hands the draft to `edit.save`: a failure is said in the bar and the draft stays. The edit ends once the canvas under it holds the scene made from what was written (`providerVersion` moved, two frames to draw it), so what was there before is never seen again; a provider set while the save runs keeps the edit (`sceneEditSave`).

db-migration-tool edits a check plan's action so (how a column is compared a choice in its row, the column it is held against its line, its settings the properties of a label, its name the title) and an option set mapping (what an option is written as a choice in its row and its line), in `graph/check-plan-scenes.js` and `graph/check-plan-scene-edit.js`.

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

## Editing a block of scenes

A block has two edit modes: its **text**, as every block has, and **Visual** (`SwitchSceneEdit.jsx`): the diagram of one scene, or of one view of a scene, in the visual editor of the framework (its history, the panel of a card, the arrangers), and under it [the panel](card-diagram-impl.md#the-panel) with the tab **Scenes**, where the block is organized.

<!--renderComp=DiagramText-->
```text
Editing  Overview › Orders  @Matrix ▾           the path of what is on the canvas; its views
[the visual editor]                             one diagram, with its own history
[Scenes | Structure]  4 scenes  ⌕  ↶ ↷  Edit card [In the panel|Beside it]
tree of the block   │ relations of the item │ its properties
```

The page is told the document, never the diagram of one scene, so its dirty mark and its Save are the block's. The **feature layers** a document names at its top (`featureList: [parametric-canvas]`) are offered for every scene it edits (their tabs join the panel: Structure), as `viewport.featureList` of one diagram offers them for itself; the registry of the layer keeps the features of the registry it is built from, so their data is read in every scene ([Features](card-diagram-impl.md#features)). A component whose scenes are generated from data offers no visual mode of its document (`cardDiagramSwitchDefineOptionsBuild({ isSceneEditable: false })`): what an author changes there is the data, as text, or wherever the data is written from, or, where its provider says so, a scene edited in place ([A scene edited in place](#a-scene-edited-in-place)), its draft written back as data.

### The scenes tab

**The tree of the block** (`SwitchSceneEditTree.js`, a [paged tree](card-diagram-impl.md#the-paged-tree)):

| Item | Key | Its children | A click |
| --- | --- | --- | --- |
| the block | `block` | the top level | focuses it |
| a scene | `scene:{path}` | its views, its tab members, then the scenes and folders below its path, in the order of the document | focuses it and opens it on the canvas (its default view, when it has views) |
| a view | `view:{path}@{id}` | | focuses it and opens it |
| a folder | `folder:{path}` | what is below it: a path with scenes below it and none of its own | focuses it |
| a mount | `mount:{path}` | the scenes its source has there, read from its provider when opened | focuses it |
| a mounted scene | `scene:{path}` | its views, what is below it | focuses it; never opened for editing (held elsewhere) |
| a tab member | `tab:{path}` | | focuses it |

A row shows its label, the last segment of its path when the label says something else, a summary (its number of children when folded, "3 views", where a mount reads from, which view is the default or the hover one) and marks (**first**: the root). The scene or view on the canvas is marked by a bar at the left of its row, apart from the focus. The keys focus without opening, so browsing hundreds of scenes loads no diagram; Enter opens.

**The relations of what is focused** (the middle part, `SwitchSceneEditGraph.js`): a tree read downward, what leads to it above (the scene its path is under, the scenes embedding, stacking or linking to it, the scene of tabs it is a member of), each line running down one lane at the left into it, and what it leads to below (the scenes below it, those it embeds, stacks, links to in any of its views, the scene it arranges). One node per other scene and side, its relations joined in its words, the line in the look of the strongest (path slate, embed and stack blue, tabs violet, link teal and dashed, a legend in a corner); at most six a side, the rest one node whose click lists them all. A reference naming nothing is a red node. A click goes there, as a click in the tree. Incoming references are those of the block's own scenes; a mounted scene's outgoing ones are read from its source.

**The properties of what is focused** (`SwitchSceneEditCard.js`): the edit card of the framework, given a small editor of the block session, so it looks and types as a node's card. With nothing focused it is the card of the scene on the canvas.

| Focused | Its card |
| --- | --- |
| the block | title, first scene, height, depth drawn; the parametric canvas offered; the seconds of a transition |
| a scene | label, title, title hidden, description; its path: segment and the scene it is under (renaming or moving it moves what is below it and rewrites every reference to them); its views: default, hover, switcher, searched; **Named by**: every reference to it, each a button opening the scene holding it with its node selected |
| a view | id (renaming it rewrites the references naming `@id`, the choices and the embedded scenes asking for it), label, title, description; shown by default, on hover, when focused, when embedded, alone in its card. A choice written as rules in the text is kept, shown read-only |
| a folder, a mount, a mounted scene, a tab | what it is; a mount: its label, segment, store, item, the part shown |

**What can be done** is a click (open), the card's values, and a right-click on a row: the panel of a right-click (action-only, searchable) with the item's commands, the same as its card's buttons:

| Item | Commands |
| --- | --- |
| the block | New scene at the top; New mount (asks the name of the asset item) |
| a scene | Edit it on the canvas; Link to it from the scene edited; Embed it in the scene edited; New scene below; New view; Make it the first scene; Move up, Move down; Remove the scene (what is below it stays); Remove it with the N scenes below |
| a view | Edit it; Link to it; Embed it; Duplicate it; Move up, Move down; Back to one diagram (the last view); Remove the view (never the last) |
| a folder | Make it a scene; New scene below |
| a mount | Remove the mount (the references to its scenes stay, naming nothing) |
| a mounted scene | Link to it; Embed it |

Creating asks nothing first: a new scene is `scene-N` below the scene it is asked for, labelled `Scene N`, with an empty diagram, focused and opened; a new view is `view-N` (its first new view turns a scene of one diagram into a scene of views, its diagram becoming the view `main`); a duplicated view keeps the ids of its nodes, so a switch between the two is a morph. A scene or view dragged from the tree onto the canvas is a link to it there; with Alt (⌥), an embedded scene.

### The block session

`SwitchSceneEditStore.js` holds the document being edited (`sourceBase`), the draft of the diagram on the canvas (`draftByKey`, from the editor's reports), the focus of the tab, the panel, and the history of the block. Every command of the panel goes through one place:

```text
docChange(change, { label, groupKey?, targetKeyOf? })
  commit the canvas      its changes since the last commit, one step of the block ("Drawing in /overview")
  change the document    on the parsed yaml (comments kept); a throw refuses it with its message
  read it                switchDocNormalize: refused when the viewport would not read it
  record                 one step of the block's history (a typed value grouped by its key)
  resolve                the focus gone: the item above it; the scene on the canvas moved: where it went
                         (targetKeyOf), gone: the nearest scene above; the editor opened again only when
                         the diagram on it changed (editToken)
  tell the page          editDraftChange with the whole document
```

**The session opens where the reader is, and gives the place back.** Entering moves nothing: a host whose viewport of scenes the editor replaces says where the reader was (`config.edit.at`: `{ path, camera }`, the camera with the `origin` of its canvas, from the store of the viewport: `pathCurrent`, `viewportApi.viewportGet()`, `viewportApi.originGet()`; `config.onSwitchStore` hands a host that store), and the session opens on that scene or view at that camera (`targetAtSet`; the first editor alone takes it); a scene shown from a mount is edited where it is held, and the session opens on the first. Where the reader is in the session is told back (`config.edit.onAt`), and the block drawn when it ends opens there (`config.at`, the `cameraInitial` of its store, which the first size of the canvas keeps: only a size changed fits the scenes again). A doc page does not use it yet: a block entering its visual edit opens on its first scene ([TODO](../../../main/doc_page_impl_TODO.md#switch-edit-at)).

**One history for the block, beside the canvas's.** The canvas keeps its own fine-grained history while a scene is open (Ctrl/⌘ + Z on the canvas, the editor's bar). What it changed becomes one step of the block's history when it is committed: before any command of the panel, before another scene is opened, before an undo of the block. The block's history is therefore linear over the whole document: its undo (the ↶ of the tab, Ctrl/⌘ + Z in the tree) puts the document back exactly, whatever was done in which scene, and when the diagram on the canvas changes with it the editor opens again on it. An undo of the canvas after a commit is a new change, committed later as a step: nothing is lost either way. The history belongs to the session and is never written.

**Renaming and moving rewrite references** (`switchDocPathMove`, `switchDocViewIdMove`): a scene moved takes what is below it, and every reference to them in every own scene, `tabs.of`, `root` and the mounts below it follow, keeping `@view` and `#item`; a path taken, or inside a mount, refuses it. **Removing keeps what depends on it** (rule 7 of the framework): the scenes below a removed scene stay, the references naming it stay and say they name nothing; removing with what is below is an action of its own, naming the count.

### The switch layer in the editor

The switch registry (`switchRegistryBuild`) lists a feature with an editing session and no data, `scene-switch` (`SwitchSceneEditFeature.js`), whose session exists only while a diagram is edited for a block session (`config.sceneEdit`), so a plain diagram never sees it:

- the edit card of a node or a line naming a scene has a section **Scene**: *Opens* (a link: a scene, or a view of one, searchable among the namespace, mounted scenes included), *Shows* and *Its view* (an embedded scene); a reference naming nothing says so; **Edit that scene**;
- the panel of a double-click offers **Link to a scene…**, **Embed a scene…** (a searchable list) and **New scene, linked from here** (a link where the panel was opened, then the new scene below the one edited, which opens); a right-click on a node or a line with a link, **Open its scene**;
- a row of the tree dropped on the canvas (`dropAccept`, `drop`) makes a link or an embedded scene there;
- something selected on the canvas lets go of the focus of the tab (`focusClear`), and the panel asks the canvas through the session (`editorAttach`: `sceneEdit.canvasApi`).

## Adding to it

| Change | Where | Check |
| --- | --- | --- |
| a new way of switching | `switchRouteFind`, a step type in `SwitchStore.stepEnter` / `frameApply` / `stepExit` | a pure function of a progress; `routeTimelineGet` knows its duration without measuring; a test in `SwitchData.test.js` |
| a node that opens a scene | `scene-link` when opening is all it does ([convention](card-diagram-usage.md#drawing-conventions)); `link: {path}` on any other node or connection of a diagram | no kind needed; the canvas answers the click, the label of a line becomes a button. A part of a card opens one with the attribute `data-switch-link`, as the headers and cells of a `card-matrix` do, so the card need not know this layer |
| another condition on the default view | `switchViewRuleMatch`, `switchViewListCheck` | it reads the presentation and nothing else; for what a rule cannot say, a provider's `viewDefault` may be a function |
| another source of scenes | a provider; for a block reading a text of its own, a `loadBuild` building it ([The concepts](#the-concepts)) | the scenes are ordinary diagrams; ids stay the same across scenes where a morph is wanted; `isSceneEditable: false` when they are generated |
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
| `SwitchPathBar.jsx` | the path bar of the scenes: `PathNavBar` with the views and the buttons of the switch |
| `PathNav.js`, `PathNavBar.jsx`, `PathNavBar.css` | [a path-based view anywhere](#a-path-based-view-anywhere): the history, the state of a view, the bar; this layer's and any other's |
| `SwitchViewSwitcher.jsx` | the menu of the views of a scene |
| `SwitchAnimation.jsx`, `SwitchAnimationStore.js` | under the animation layer |
| `CardDiagramSwitch.jsx` | `SwitchViewport`, the block of a document, `cardDiagramSwitchCompCreate` with its `loadBuild`, the hooks a generator of scenes uses |
| `SwitchSceneEdit.jsx`, `SwitchSceneEditStore.js` | the visual edit mode: the path of what is edited, the block session (the document, its commands, its history, the panel) ([Editing a block of scenes](#editing-a-block-of-scenes)) |
| `SwitchSceneEditTree.js`, `SwitchSceneEditGraph.js`, `SwitchSceneEditCard.js`, `SwitchSceneEditPanel.jsx` | the tab Scenes: the tree of a block and its references (pure), the graph of relations, the cards and commands of its items, the tab ([The scenes tab](#the-scenes-tab)) |
| `SwitchSceneEditFeature.js` | the switch layer in the editor: the section Scene of a card, links and embedded scenes placed, a row dropped ([The switch layer in the editor](#the-switch-layer-in-the-editor)) |
| `SwitchMount.js`, `SwitchRef.js` | the sources of a viewport: mounts and the composite provider; the references of a diagram, read and rewritten ([Sources of scenes](#sources-of-scenes)) |
| `SwitchSceneEditor.jsx` | a scene of a provider edited where it is drawn: the editor over the canvas, its draft, its camera ([A scene edited in place](#a-scene-edited-in-place)) |
| `card-diagram-switch-comp.js`, `SwitchSource.js`, `comp.yaml` | the registration, the starting text, the build-time dependencies |
| `comp-mdx/card-diagram/SceneBoxCard.jsx` | the bounding box, in the base series |
| `comp-mdx/power-platform/power-platform-comp.js` | `DiagramERSwitch` |
