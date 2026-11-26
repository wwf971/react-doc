# Card Diagram Parametric Canvas: Design

A feature layer over the [card diagram framework](card-diagram.md), beside the [switch layer](card-diagram-flexible-switch.md) and the [animation](card-diagram-animation.md). It makes a diagram a canvas to draw on, and adds what canvas tools usually lack: **parts of the drawing are generated from parameters**. A *parametric group* places its members by rules, so a layout is rearranged by changing a number, not by dragging every node again.

<!--renderComp=DiagramText-->
```text
┌ tool bar ────────────────────────────────────────────────────────────┐
│ Group Note Label Text Shapes ▾ Cards ▾ Layouts ▾ Locators ▾ … Line   │
├ viewport ────────────────────────────────────────────────────────────┤
│  ◉ Pipeline                                                          │
│  [Source] ──► [Step] ──► [Target]        members: placed by rules    │
│  ┌ Stages ─────────────────────┐                                     │
│  │ (Extract) (Transform) (Load)│         [a free element]            │
│  └─────────────────────────────┘                                     │
├ panel ───────────────────────────────────────────────────────────────┤
│ tree of the scene  │ relations of what is selected  │ its properties │
└──────────────────────────────────────────────────────────────────────┘
```

Its editing layer (the tool bar, the panel, the marks to grab) is drawn only while a diagram is **edited**, and only in a viewport that asks for it. What it writes is data of the diagram, so a group is placed the same way wherever the diagram is read, and a layout such as a row of stages keeps its frame and its name there when it is framed when read (the default of a layout, not of a pattern: [On the canvas](#on-the-canvas)). How to use it, for authors: [Drawing on a Card Diagram](card-diagram-usage-parametric-canvas.md).

## The concepts

- A **free element** is a node or a line as the framework has always had them: its place is its own (`position`).
- A **parametric group** is a set of **members** with one **origin**, a point of the canvas. The origin is the one free place of the group; everything else follows from it.
- A **member** follows one or more **parents**: other members, or the origin. Members and their parents form a graph without circles (a tree in most cases). There are two sorts written, and one derived:

| Member | Is | Example |
| --- | --- | --- |
| object member | places one node of the diagram | a card 60 to the right of another |
| layout member | places nothing itself, arranges its children | an **array** (a row or a column at one gap), a **repeat** (one child spawned n times), a **grid** (rows of a number of columns), a **pattern** ([below](#patterns)) |
| locator | a layout member that arranges nothing: it has lines, and its children say where on them they stand | vertical lines at x 0, 120, 240: three blocks between them ([Locators](#locators)) |
| line | a connection whose two ends are on members of the group; not written, derived from the connections | an arrow between two members |

- A **constraint** says how a member follows its parent(s). It is one of a list of **constraint types**:

| Type | Parents | The member stands |
| --- | --- | --- |
| `offset` (the default) | 1 | with a reference point of its own at an offset (x, y) from a reference point of its parent |
| `beside` | 1 | on a side of its parent, an edge at a gap from the facing edge: side `top`, gap 20 is "bottom edge 20 above the top edge of the parent" |
| `between` | 2 | between a reference point of each parent, at a part of the way |
| `locate` | 1, a locator | on the lines of its locator: a reference point on a line or a crossing, or its box from one line to another ([Locators](#locators)) |

  **A member put under another one with nothing else said stands by the default constraint: its default reference point at an x, y offset from the default reference point of its parent.** The two numbers are changed in the edit card, or by dragging the member. A child of a layout member that arranges its children has no constraint: the layout places it.
- A **reference point** is a point of a member that a constraint places or measures from. Every member has a **default** one, and may declare more; each is defined by parameters, never by a place picked with the pointer ([Reference points](#reference-points)). It is never a handle where lines attach ([Reference points, handles and anchors](#reference-points-handles-and-anchors)).

- A **size binding** takes the width or the height of a member from another member.
- A **pattern** is a layout type with named **slots**: the relations between its slots are code, so they cannot be changed, only its parameters. It is how a fixed subgroup is offered ([Patterns](#patterns)).
- The **drawing kinds** are what the layer brings to draw with beside the cards: a shape and a text ([Drawing kinds](#drawing-kinds)).
- A **tool** is something that can be created: a template with parameters. The **tool bar** is a list of tools and of groups of tools, kept as data.
- A **create mode** is a way a pointer gesture says where a new thing goes and how large it is: a click, a box dragged out, a line dragged, a click beside something. A **creator** is what makes the thing of a tool. The two meet in a **placement** ([Creating](#creating)).

In a tree a member stands under its **direct parent**, the first of its parents; a line stands under the member of its end more to the left.

## Reference points, handles and anchors

Three things of a node can be grabbed or pointed at, and each has a word of its own (the framework's glossary: [The words of a node](card-diagram-impl.md#the-words-of-a-node)), and a mark of its own on the canvas:

| Word | Is | Written | Drawn as |
| --- | --- | --- | --- |
| **reference point** (this layer) | a point of a member, what a constraint places or measures from | `point`, `pointParent`, `pointA`, `pointB` of a constraint; `referencePointList`, `referencePointDefault` of a member | a diamond |
| **node handle** (the lines) | where a connection line leaves or arrives, standing on an **anchor** of the card (a part of it: its body, a row) | `handles` of the node, each with its `anchor` | a square on an edge |
| **resize handle** (the editor) | a corner or the middle of an edge of the node selected, dragged to change its box | nothing: drawn on the frame of the selection | a circle, a pill |

A reference point is never a node handle: a constraint does not follow where a line is attached (the form `{ handle: id }` written before is refused, saying the side to write). The **origin** of a group (`root`) is its one free place, a point of the canvas. The keys written before for reference points (`anchor`, `anchorParent`, `anchorA`, `anchorB`) are refused, with the key to write.

## Reference points

<!--renderComp=DiagramText-->
```text
a box                         a round thing                 a locator
◆ top-left (default)             north                      x1    x2     x3
┌───────◇ top ──────┐            ◇                          │     │      │
│                   ◇ side      ╭─╮  ◇ angle: 45        y1 ─◆─────◇──────┼─   ◆ its origin (default)
◇ left edge,        │ right,   ◇   ◇ east                   │     │      │    ◇ a crossing: x2 × y1
│ point 1 of 3      │ offset    ╰─╯                     y2 ─┼─────┼──────┼─
└───────────────────┘ 0.25       ◇ south                    │     │      │
```

**Every thing has one default reference point**, and it is what a constraint means when it names none. It is that of its **outline**, the shape of its boundary, unless the member says another:

| Outline | Is | Its default reference point | Formats an editor offers for it |
| --- | --- | --- | --- |
| `rect` | a box: most nodes, a layout member | the top left corner of its bounding box | bounding box, edge |
| `ellipse` | a round thing (the shape `ellipse`) | the top left corner of its bounding box | direction, bounding box |
| `polygon` | a shape with corners (diamond, triangle, hexagon, parallelogram) | the top left corner of its bounding box | corner, direction, bounding box |
| `lines` | a locator | its origin | lines |
| `point` | the origin of a group | itself | (nothing to choose) |

The top left corner is the default of every box, whatever is drawn in it, for one reason: it is the one point that stays where it is when the thing is resized by its right or bottom edge, so an offset from it is simply the place of the thing. A kind says the outline of its node (`contract.outlineOf(node)`, [node kinds](card-diagram-impl.md#node-registries); a box when it says nothing), so nothing is written per kind: every round thing shares the formats of round things.

**A reference point is written in a format**, a definition by parameters:

```yaml
point: center                             # bounding box: one of nine names (top-left, top, ..., bottom-right)
point: { x: 0.2, y: 0.9 }                 # bounding box: fractions of it, anywhere
point: { side: top, offset: 0.667 }       # edge: two thirds along the top edge
point: { side: left, index: 2, count: 3 } # edge: the 2nd of the points dividing the left edge in 3, from the top
point: { direction: north }               # direction: on the outline itself; north, east, south, west
point: { angle: 45 }                      # direction: 45 degrees clockwise from north
point: { vertex: 2 }                      # corner: the 2nd corner of a polygon, clockwise from the top
point: { lineX: split, lineY: top }       # lines: where two lines of a locator cross (one alone: that line)
point: inlet                              # a reference point the thing declares itself, by its id
                                          # (the key left out: its default reference point)
```

Every format reads on every outline (on the bounding box where the outline has no such thing: a direction on a box is where the ray leaves the box), so changing the shape of a thing never makes a drawing unreadable; what an editor *offers* for a thing is the formats of its outline.

**A member declares reference points of its own** beside those its outline offers, and may make one of them its default:

```yaml
- id: tank
  node: tank
  referencePointList:
    - { id: inlet, name: Inlet, point: { side: left, index: 1, count: 3 } }
    - { id: outlet, name: Outlet, point: { side: right, index: 2, count: 3 } }
  referencePointDefault: inlet            # the id of one it declares, or a definition; absent: that of its outline
- id: pump
  node: pump
  parent: tank
  constraint: { type: offset, x: 60, y: 0, point: left, pointParent: outlet }
```

A declared reference point is a parameter like any other: changing where it is moves what is measured by it. Changing *which* reference point is the default, or removing one, is a change of structure and moves nothing: what was measured by it is written again (an offset computed anew; a removed point written out as the same place of the box).

## Enabling it

Two separate things:

| | Where | Effect |
| --- | --- | --- |
| the data | the section `parametric` of a diagram, and its shapes and texts | its groups are placed, in every component whose registry has the feature: the base series, the Power Platform series and the AWS series list it, and the switch layer keeps it in the registry it builds |
| the editing layer | `viewport.featureList: [parametric-canvas]` of the diagram; `featureList` at the top of a block of scenes (every scene it edits); `edit.featureList` of a scene edited in place ([card-diagram-flexible-switch.md](card-diagram-flexible-switch.md#a-scene-edited-in-place)) | the tool bar, the panel and the commands, in the visual editor |

A viewport generated from data usually does not name the layer: its scene is made again when the data changes, and what was drawn by hand would be lost. A scene only partly made from data may. This is a convention, not a check.

## The data

One section of the diagram, owned by the feature. Nothing else of the [format](card-diagram-impl.md#core-model) changes. The node of a member keeps no `position`: it is not read.

```yaml
viewport:
  featureList: [parametric-canvas]
parametric:
  groupList:
    - id: pipeline
      name: Pipeline
      root: { x: 60, y: 110 }
      memberList:
        - { id: source, node: source }                # under the origin, at offset 0 0
        - id: step
          node: step
          parent: source
          constraint: { type: beside, side: right, gap: 70 }
        - id: remark
          node: remark
          parentList: [source, step]                  # several parents: the first is the direct one
          constraint: { type: between, t: 0.5, y: -70 }
        - id: stages
          layout: { type: array, direction: row, gap: 24 }
          isFramedWhenRead: false                     # a layout's frame and name only while edited
          parent: source
          constraint: { type: offset, y: 70, pointParent: bottom-left }
        - { id: a, node: stage-a, parent: stages }    # placed by the array, in the order written
        - id: wide
          node: banner
          size: { width: { member: stages } }         # as wide as the row
```

Reading refuses, naming the member: a node that is not there or is placed twice, a parent that is not a member, members following each other in a circle, a constraint with the wrong number of parents, a layout with too many children, a size that follows from itself, a reference point named that its thing does not declare, a line a locator has not.

## Locators

A locator is a **provider of places**: a series of x coordinates (vertical lines), a series of y coordinates (horizontal lines), or both, each of one line or more, counted from its origin. It draws nothing of the diagram; what is put under it stands on its lines and follows when a line moves. Many relations that would each need a constraint are then one locator: a row of blocks of one height, whose widths are the gaps between its vertical lines.

<!--renderComp=DiagramText-->
```text
        ⌄ x1       ⌄ x2        ⌄ split                 ⌄ x4       chevrons: where the lines are
   y1 › ┌──────────┬───────────┬───────────────────────┐
        │   xxx    │    yyy    │        zzzzzz         │          three blocks, each from one vertical
   y2 › └──────────┴───────────┴───────────────────────┘          line to the next, from y1 to y2
                               ◆ a text, its top on the line "split"
```

```yaml
- id: cols
  layout:
    type: locator
    xList: [0, 120, { id: split, at: 240, name: Split }, 480]   # a line: its place, or { id?, at, name? }
    yList: [0, 80]                       # absent: a locator of one dimension
    display: hint                        # while it is not focused: hint | light | full | hidden
  constraint: { type: offset, x: 40, y: 300 }   # where its origin stands: a member like any other
- { id: a, node: block-a, parent: cols, constraint: { type: locate, lineX: ['1', '2'], lineY: ['1', '2'] } }
- { id: b, node: block-b, parent: cols, constraint: { type: locate, lineX: ['2', split], lineY: ['1', '2'], inset: 2 } }
- { id: t, node: caption, parent: cols, constraint: { type: locate, lineX: split, y: 90, point: top } }
- { id: n, node: note, parent: cols, constraint: { type: offset, x: 0, y: -40, pointParent: { lineX: '4' } } }
```

- **A line has an id**: the one written, else its place in its list (`'1'`, `'2'`). The editor writes every line with its id, so inserting or removing a line changes no reference to another; a name is for people, and is optional.
- **`locate`** places a member on the lines of its parent, axis by axis: `lineX: id` puts its reference point (`point`, its default one when absent) on that vertical line; `lineX: [id, id]` runs its box from one line to the other, **and the lines then decide its width** (its own is not read, and its resize handles leave that axis alone); no `lineX` is the origin of the locator. `lineY` the same for the horizontal lines and the height. `x`, `y` are an offset added; `inset` makes a box between lines smaller at each end.
- **The lines are reference points of the locator** (the format `lines`), so every constraint can measure from them: an `offset` from a crossing, a `between` with a crossing at one end. A member put under a locator with nothing else said stands, like under any member, at an offset from its default reference point: its origin.
- **The locator is itself placed** like any member: under the origin of its group, or by a constraint from another member (beside a card, at an offset from a reference point), so its whole series follows that member.
- **A drop** of a member standing on lines takes the line it was dropped on (within a few units), or the gap between lines nearest to it; dropped away from every line, it keeps its line and writes how far from it it stands.
- **A line removed** leaves what stood on it where it stands: measured from the lines left, a box that ran to it keeping its size as its own.

**How it is shown.** Focused, a locator is drawn in full: its lines, each with a **chevron** on a rail (a row above the vertical lines, a column left of the horizontal ones) and its name. While it is not focused, as its `display` says:

| `display` | Not focused | When the diagram is read |
| --- | --- | --- |
| `hint` (the default) | only the chevrons, where its lines are | nothing |
| `light` | its lines, faint | its lines, faint |
| `full` | its lines and their names: for a locator the drawing is about | the same |
| `hidden` | nothing (it is reached from the tree of the panel) | nothing |

Where the chevrons stand is the locator's own (`chevronY`: the row of those of the vertical lines; `chevronX`: the column of those of the horizontal ones; beside the lines when absent), and moving them moves nothing else.

**A line is moved by dragging its chevron, and nothing is placed until it is dropped.** While the pointer moves, only a ghost of the line follows it: however many things stand on the locator, none is computed or drawn anew. Dropped, the line is written as one step and everything is placed once. Dropped on the **cancel area** (at the bottom of the viewport while the drag lasts), or with Escape, nothing is written. A line stops at its neighbours; with Shift held the lines after it move with it, so the gap before it changes and the others keep theirs. The rail is dragged the same way to move the chevrons; the **+** at its end adds a line; a click on a chevron opens its line in the edit card (its name, its place, its removal).

## The solver

`parametricSolve` (`ParametricSolve.js`) answers where every member stands, from the model and the sizes of the nodes **as drawn**:

```text
sizes    bottom-up   an object member: its node (or its size binding; or what its constraint
                     dictates: between two lines of a locator, their distance)
                     a layout member: what its layout makes of its children; a locator: as far as
                     its lines reach
places   top-down    the origin
                     a member: its constraint, from the boxes of its parents and the reference
                     points it names, each resolved on the thing it is of
                     a child of a layout that arranges: where the layout puts it
copies               a repeat: every node under it again, moved by the step of each copy
```

It runs as a **placer** of the engine ([Features](card-diagram-impl.md#features)): each time the nodes of a diagram are placed, so again with every measurement, since a card whose height follows its content changes what stands below it. A copy a repeat spawns is a node the feature derives: drawn like its source, with no handles, nobody's to edit. While words are typed in the source the copies keep what they say, their size and their place, and follow when the typing pauses or ends ([History](card-diagram-impl.md#history)); so do the tree and the graph of the panel.

## The editor

Everything the layer changes goes through `DiagramEditStore.changeApply`, so every command is validated, refused with its reason, and undone and redone like any step of the [history](card-diagram-impl.md#history).

**A drag is a change of a parameter.** Dropping a member writes its constraint: an offset, the gap and the shift of `beside`, its index in an array. While it is dragged, what follows it follows it at once. A drop that changes nothing puts it back. So is a resize: a member resized by its resize handles keeps the corner where it was put, its size written (the axes that change) and its constraint made again, as one step (`nodeResize`); a child of a layout takes the size alone, and what follows it moves with it.

**Nothing moves when the structure changes.** A member put under another parent, given another constraint type, taken out of its group, a group removed: the parameters written are those that keep everything where it stands. Removing a member keeps what followed it, under its parent.

**One selection.** A node or a line is focused by the path of the editor, as always; the feature adds how it is placed to its edit card. A group and a layout member have no node: the feature focuses them itself, exclusively with the path, with an edit card of the same component.

<a id="modes-of-a-thing"></a>**A thing selected may enter a mode of its own.** One object has several sorts of things to change (its words, its size, how it is placed, its reference points), and not all of them fit in one card. A **mode** shows one of them in the place of the settings, in the edit card and on the canvas, until it is left (**Done**, Escape step by step, or another thing selected):

| Mode | Entered from | The edit card | The canvas |
| --- | --- | --- | --- |
| reference points of a member | *Edit reference points* of its card, *Reference points…* of its right-click | its reference points listed (that of its outline, those it declares; the default marked); one added or removed; one opened: its name, its format and parameters (those of its outline), whether it is the default | every reference point of the member, with its name; a click on one opens it |
| lines of a locator | *Name, remove…* of an axis in its card, a click on a chevron | the lines of that axis listed with their places and how many things stand on each; one opened: its name, its place, its removal | the locator focused |

Its path bar leads back: the member, the list, the thing open. A mode is state of the editor, like the selection: never a step of the history, while everything changed in it is.

### On the canvas

| Drawn | Does |
| --- | --- |
| the origin of a group, a round mark with the name of the group | a click focuses the group; a drag moves the whole group. Lying on a resize handle of the member selected, it steps aside (faded, the pointer passing to the handle) |
| the box of a layout member, a dashed frame with its name | a click on the name focuses it. Faded when it is not framed when read |
| the relations of the member selected | its parents framed; the reference points its constraint measures by marked (a diamond on the parent, one on the member), a dashed line from the one to the other; its default reference point ringed. A mark only shown never takes the pointer |
| a locator | its chevrons and, as its `display` says, its lines ([Locators](#locators)); its name, a click on which focuses it |
| while a line of a locator is dragged | the ghost of the line with its place, and the cancel area at the bottom of the viewport |
| while a tool is armed, the ghost of what the gesture will make | follows the pointer; the gesture places it ([Creating](#creating)) |

**When the diagram is read** (or edited where the viewport does not offer the layer), the feature draws over the canvas the lines of a locator shown `full` or `light`, and the frame of each layout member **framed when read**, with its name, answering nothing (`feature.ReadLayer`, `ParametricReadLayer.jsx`, from the model the diagram was read with and the boxes its placer answered). A layout is framed when read unless it says otherwise (`isFramedWhenRead: false`; the edit card of a layout, *Framed when read*); a pattern is not unless it says so (`isFramedWhenRead` of its layout type, `false` for Captioned and Badged: a frame would box a caption with its subject). The origins of the groups and the relations are aids to editing and are never drawn when reading. A block of scenes (the switch layer) draws its scenes with a canvas of its own and does not draw any of this yet ([TODO](../../../main/doc_page_impl_TODO.md#parametric-read-switch)).

A right-click on a card, a line or the empty canvas opens the panel of a double-click with what can be done there: put under another member, another constraint type, take out of the group, add to a group, remove the node or the line (in red, with the icon of removing), the tools. It is the same panel as the menu of an item of the tree, and the same size: it sets its own line height, so the text around the canvas does not make its rows taller.

### The tool bar

At the top left of the viewport. What it holds is revealed step by step, so the bar stays short and nothing is out of reach:

| Level | Shows | A click |
| --- | --- | --- |
| the bar | the major tools, and groups of tools | arms the tool, in its default create mode |
| the dropdown of a group | its tools | arms that tool |
| the chevron of a tool | **Placed by**: the create modes the tool offers, its default marked; whether it stays armed; then its own parameters (its name, what it makes) | on a mode: arms the tool in that mode |
| the chevron of a mode | the parameters of the mode, and **Use by default** | |

A tool armed places what it makes with the next gesture on the canvas (Escape or a right-click lets it go): into the group of what is selected (under a layout member focused, else under the origin), or as a free element when nothing of a group is selected. A line under the bar says what the armed mode waits for.

The tool bar is data, the component config key `ParametricToolMap`: a mapping of ids to tools, the tools the package ships being its default. A change made on the bar (a parameter, a default mode) is written into the client layer of the config system (`doc_page_impl_config.md#component-level-config`).

```yaml
compConfig:
  CardDiagram:
    ParametricToolMap:
      note-blue: { label: Blue note, icon: note, rank: d, create: { what: node, kind: card-note, data: { tone: blue } } }
      frame:                                   # a color block always dragged out square, kept armed
        label: Frame
        icon: block
        rank: f
        create: { what: node, kind: color-block }
        mode: drag-box
        modeParam: { drag-box: { isSquare: true } }
        isKeptArmed: true
      label: null                              # takes away a tool a layer below gave
```

### Creating

A color block wants to be dragged out to its size, a note wants one click, a line wants two points. Nothing is written for one kind of thing: creating is split in three, and each part knows only its own.

```text
create mode   a gesture  ->  a placement      knows geometry; nothing of what is made
creator       a placement  ->  the thing      knows its sort of thing; nothing of gestures
tool          data                            what to make, its default mode, the parameters of both
```

A **placement** is the small vocabulary the two share:

| Placement | Says | Answered by the mode |
| --- | --- | --- |
| `point` | the thing held at a point by a point of its box (`hold`: its center, its top left corner) | **Click**; and every drag cut short (a press without a drag) |
| `box` | the box the thing takes | **Drag a box** (Shift: square, Alt: from its center) |
| `segment` | from one point to another | **Drag a line** (Shift: level or upright) |
| `beside` | on a side of a thing that is there, at a gap | **Next to**: the thing nearest to the pointer, on the side the pointer is at |

A **creator** says which placements it takes, in the order it prefers, and what each means for its thing:

| Creator (`create.what`) | `point` | `box` | `segment` | `beside` |
| --- | --- | --- | --- | --- |
| `node` | there, at its own size | takes the box | | on that side; under a member it follows it by a `beside` constraint |
| `layout` | there | | starts there, and runs the way of the drag (a row or a column) | on that side of a member, following it |
| `group` | its origin there | its origin at the corner, and the free elements inside join it | | |
| `connection` | a line with two free ends | | joins the handles at its two ends where they take it, else free ends | |

**The modes a tool offers follow from the two**: the modes whose placement its creator takes, in the creator's order, the first being its default unless the tool names one (`mode`). For a node, what a box may decide is read from its kind, never from its name:

| A kind whose new node | Takes from a box | Default mode |
| --- | --- | --- |
| is drawn to a size (a numeric width and height: a color block, a database) | its width and its height, not below the minimum of the kind | Drag a box |
| is as high as its content (a note, a table) | its width | Click |
| is as wide as its words (`isWidthFit`: a label) | nothing: no box is offered | Click |

A kind for which this guess is wrong says so itself (`create.sizeAxisList` of its registry entry).

While a tool is armed, a **gesture surface** lies over the canvas. It takes the pointer everywhere, so a box may start over a card (a color block is drawn around what is there); it hands the wheel on, so the canvas zooms as ever. The session keeps one record of the gesture (where the pointer is, where it went down, whether it moved, Shift and Alt); a mode is a pure function of it, and every gesture ends when the pointer goes up. During the gesture the creator answers the **ghost**: the box or the line the thing will take, a dashed outline (a box being drawn lightly filled), with a thing pointed at framed. A mode of a drag draws nothing until the drag starts: before the press a **cue** beside the pointer says what to do and that Escape or a right-click gives up, and a press without a drag places the thing at its own size only as the pointer goes up. Escape lets the tool go wherever the keyboard focus is (arming a tool from a dropdown leaves it on the page).

### The panel of a double-click

The create panel of the framework, opened by a double-click on the empty canvas (or a right-click there), is the quickest way in by the keyboard. The layer gives it two things through the hooks of the engine:

- **Words typed are a text.** The layer says what words make (`createTextGet`): a node of the kind `text` at that place, into the group of what is selected as a tool places. The panel lists the words first, highlighted, so typing and Enter is all it takes; ↓ reaches the kinds and tools the words found.
- **`/` names a tool.** The field is a text of the page with its slash mode: `/` lists every tool of the bar and every kind of the registry by name (`/shape-diamond`, `/layout-grid`, `/table`), in the slash menu of the page, and Enter places it there. The panel's own list steps aside while the menu is open.

### The panel

The layer brings the tab **Structure** to [the panel of the editor](card-diagram-impl.md#the-panel) (`ParametricPanel.jsx`, registered by its session: `panelTabGet`), which stands under the viewport (in the block popup, docked at the bottom) and folds to one line. In a block of scenes it stands beside the tab Scenes of the block ([card-diagram-flexible-switch.md](card-diagram-flexible-switch.md#the-scenes-tab)), the head switching between them.

| Part | Shows |
| --- | --- |
| tree | the groups with their members under their direct parents, the lines of a group under a member of their ends, then the free elements: a [paged tree](card-diagram-impl.md#the-paged-tree), so a group of hundreds of members or a diagram of thousands of free nodes is shown a page at a time, each long level with its pager and its filter; a search in the head; a click selects, a right-click opens what can be done |
| relations | what is selected among what it follows and what follows it, as a graph of icon nodes (a diagram without a canvas), in the small canvas of the panel: the wheel zooms around the pointer and never scrolls the page, a drag pans, a button puts it back; its camera is kept for the thing selected |
| properties | the panel's one column: the edit card of what is selected, the node or line (with the sections of the feature) or the group or layout member focused |

**Where the edit card stands is the author's choice**, the panel's (*Edit card: In the panel · Beside it*, and a button of the card itself): docked in the column, or floating beside what is selected as a card stands everywhere else in the framework; kept in the browser for every diagram. The tree and the graph of relations read what the canvas draws (`nodeShownGet`), so a word being typed reaches them when it reaches the copies.

## Drawing kinds

Beside the cards of a series, the layer brings two kinds to draw with (`ParametricShape.jsx`, their data in `ParametricShapeData.js`), kinds of every registry listing the feature (`feature.kindList`):

| Kind | Data | Drawn |
| --- | --- | --- |
| `shape` | `shape` (rect, rounded, ellipse, diamond, triangle, hexagon, parallelogram), `text`, `textSize`, `strokeWidth`, `isDashed` | its outline at the size of its node (an SVG without kept aspect; a rectangle is a box of css, so its corners keep their radius), filled and edged by the style of the node (`style.fill`, `style.stroke`), its words in the middle |
| `text` | `text`, `textSize` (s to xl), `weight`, `align`, `tone` | its box by its [size mode](card-diagram-impl.md#the-selection-and-resizing): as wide as its words (no size, the default; nothing to resize), or a width they wrap at (`size: { width }`, its height following; its width resized); the edit card switches (**Box**). `style.fill` puts a color behind them, which is how a badge is drawn |

Their colors are the [style of a node](card-diagram-impl.md#the-style-of-a-node), not a property of the kind. Their words are a cell of the cell editing kit, typed where they stand (an icon is a token among them); a text typed empty goes, a shape keeps its outline. A shape is drawn to a size, so its tool places by a box dragged out ([Creating](#creating)); the tool bar has one tool per shape under **Shapes**, and **Text**.

## Patterns

A pattern is a layout type whose `slotList` names its slots, and for each what fills it when the pattern is made whole (`slot.create`: `{ kind, data?, style?, size? }`). The layout creator makes the layout member and a node per slot, each a member under it with its `slot`, in one step of the history (`ParametricEditStore.layoutCreate`, `slotFillBuild`). A member put under a pattern takes the first slot no other member fills; a pattern whose slots are all filled refuses it, naming them. The tree and the summaries call a child of a pattern by its slot (*its caption*).

| Pattern | Slots | Parameters | Arranges |
| --- | --- | --- | --- |
| `caption` (Captioned) | subject, caption | `side`, `gap`, `align` | the caption on a side of the subject, at a gap, aligned along that side |
| `badge` (Badged) | subject, badge | `corner`, `inset` | the middle of the badge on a corner of the subject, moved inward by the inset |

The tool bar offers them under **Patterns**. A pattern of one's own is a layout type with slots in the list the feature is built from.

## For an agent

What the tool bar, the panel and the edit card do is also an api of every diagram component whose registry lists the feature (`ParametricApi.js`, joined to the apis of a diagram through `feature.apiListBuild`). Each change is a command of the session, so it is validated and undone as in the editor; it works on the draft of a session that is open, else it is written into the block as a save would.

| Api | Does |
| --- | --- |
| `parametricGroupListGet` | the groups, every member with what it places, what it follows (parents, slot), its constraint, a summary and its box (sizes as drawn when the diagram is edited on the page, else as written); the constraint and layout types, the tools |
| `parametricGroupAdd` | a group, its origin at a place, free nodes taken in where they stand |
| `parametricMemberAdd`, `parametricMemberRemove` | a free node into a group; a member out of it, what followed it kept where it stands |
| `parametricMemberParentSet` | a member under another parent, where it stands (a pattern: into a free slot) |
| `parametricMemberSet` | another constraint type, or one parameter of its constraint or of its layout |
| `parametricReferencePointSet` | the reference points of a member: one declared, changed, removed, made the default |
| `parametricLocatorLineSet` | the lines of a locator: one added, moved or named, removed |
| `parametricToolPlace` | what a tool makes, or a `create` given, at a place: into a group under a parent, or free |

## Everything is a plugin

A feature is built from lists, and the one the package ships from the lists it ships:

```js
parametricFeatureBuild({ constraintTypeList, layoutTypeList, referenceFormatList, createModeList, creatorList, kindList, toolMap, layoutUiByType })
```

| To add | Write | Contract |
| --- | --- | --- |
| a constraint type | `{ type, parentCount, read, solve, fromPlace, sizeOf?, parentReasonGet?, propertyList, propertyListGet?, summaryOf }`: it reads reference points through its context (`pointOf(key)`) and knows no format | `ParametricConstraint.js` |
| a layout type, a pattern | `{ type, childMax?, slotList?, isChildConstrained?, outlineOf?, read, arrange, indexFromPlace?, propertyList, summaryOf }`; a slot `{ id, label, create? }` | `ParametricLayout.js` |
| what a layout type shows of itself (a locator: its lines) | `layoutUiByType[type]`: `{ cardSectionListGet, modeCardGet, actionListGet, CanvasLayer, ReadLayer }` | `ParametricFeature.jsx` |
| a format of reference points | `{ id, outlineKindList, isOf, read, write, resolve, choiceListGet, keyOf, paramListGet, labelOf }` | `ParametricReferencePoint.js` |
| an outline of a node | `contract.outlineOf(node)` of its kind: `{ kind: rect | ellipse | polygon, pointList? }` | `node-registry.js` |
| a kind to draw with | a kind of the registry (`type`, `contract`, `Card`, `create`) in `kindList` | `ParametricShape.jsx` |
| a create mode | `{ id, placementKindList, paramList, hint, placementOf(gesture, param, context) }` | `ParametricCreateMode.js` |
| a creator (another sort of thing a tool makes) | `{ what, placementKindListGet, ghostOf, place, paramSectionListGet }` | `ParametricCreator.js` |
| a tool | an entry of the tool map | `ParametricTool.js` |
| the feature to a series | `featureList: [parametricCanvasFeature]` of its `nodeRegistryBuild` | [Features](card-diagram-impl.md#features) |

The engine knows nothing of the layer: it offers features generic hooks, and this is one feature. What it leaves for later (a line of a locator following another member, a reference point picked with the pointer) is in the [TODO](../../../main/doc_page_impl_TODO.md#parametric-canvas).

## Implementation

Tests: `comp-mdx/card-diagram-parametric-canvas/*.test.js`, run as in [card-diagram.md](card-diagram.md#tests-and-documents).

| Place | Role |
| --- | --- |
| `ParametricData.js` | pure: the section read and validated, the lines of a group |
| `ParametricReferencePoint.js` | pure: outlines, the formats of reference points, a reference point read, resolved, said in words |
| `ParametricConstraint.js`, `ParametricLayout.js` | pure: the constraint types, the layout types |
| `ParametricLocator.js` | pure: the locator (a layout type) and `locate` (a constraint type) |
| `ParametricLocatorLayer.jsx`, `ParametricLocatorModel.js` | a locator over the canvas (lines, chevrons, a line dragged); its edit card and its mode |
| `ParametricCreateMode.js`, `ParametricCreator.js` | the create modes (pure), the creators |
| `ParametricCatalog.js` | the catalog of a feature: its plugins, each list with its lookup |
| `ParametricSolve.js` | pure: the solver, the placer, the copies of a repeat, what the feature answers the engine |
| `ParametricEditStore.js` | the session in the visual editor: commands, focus, the tool armed, the state of the panel |
| `ParametricEditModel.js` | sections of the edit card, the card of a group or a layout, the actions of a right-click |
| `ParametricTool.js`, `ParametricToolModel.js` | the tools as data; a tool as its dropdown shows it (its modes, its parameters) |
| `ParametricShape.jsx`, `ParametricShapeData.js` | the drawing kinds: a shape, a text; their data read (pure) |
| `ParametricApi.js` | the apis of the feature, for an agent |
| `doc/card-diagram-usage-parametric-canvas.md` | the document for authors, beside `card-diagram-usage.md` |
| `ParametricFeature.jsx` | the feature: the above wired into the hooks of the engine |
| `ParametricCanvasLayer.jsx`, `ParametricToolBar.jsx`, `ParametricPanel.jsx`, `ParametricPanelGraph.js` | what is drawn: the marks over the canvas, the gesture surface and the ghost, the tool bar, the tab Structure of the panel and its graph |
| `ParametricReadLayer.jsx` | what is drawn when the diagram is read: the frames of the layouts framed when read |
