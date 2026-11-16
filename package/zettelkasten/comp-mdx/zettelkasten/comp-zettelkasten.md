---
title: Zettelkasten
description: A box of linked zettels kept as a frontend object: a zettel is a card with its text, its connections and its flow; connecting zettels, making and removing them, and putting them on a card diagram.
language: en
---

A zettelkasten is one frontend object of the type `zettelkasten.box`. Its zettels are Markdown items of the object; this package draws each as a card. The box on this page is a small example about the method itself, kept in the package (`.doc-page/object-frontend/`), so everything below can be tried. The design is in [the root document](../../doc/README.md).

## The explorer

A zettel lies on a desk. Its title bar has the way back and forth on the left; on the right, how it is shown (**Text**, **Connections**, and **Flow** for a zettel describing a process) and **Expand**, which shows all of it. Above it, find a zettel by words (`q1` finds question 1), open a side panel (the outline, the questions, your notes), or **Practice**.

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5xe9dxeujf
mode: explorer
param:
  height: 640
```

Try **Connections**: the zettel shrinks onto its own card in the middle, what holds it stands above, what it holds below, the zettels pointing at it on the left and those it points at on the right, each place in a frame. The strip over it chooses which places are shown. A click on a zettel there brings it to the middle; a click on the one in the middle reads it.

A block is written like this; `param.zettel` names the zettel shown first (its key, or any reference to it within the box: a path, `name:…`), `param.view` how it is shown first (`text`, `link`, `flow`), `param.height` its height, or `param.aspect` its width over its height (1.55 by default) when no height is written, `param.panel` a side panel open (`outline`, `question`, `note`), and `param.isPractice: true` hides the answers of questions until asked.

````md
<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5xe9dxeujf     # the box
mode: explorer
param: { zettel: link, view: link, height: 640 }
```
````

## One zettel

The mode `card` shows one zettel in the flow of a document, the same card without the desk. Its links and its views work in place; this one starts with its connections (`view: link`).

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5xe9dxeujf
mode: card
param:
  zettel: structure-hub
  view: link
  height: 460
```

## Connections

A zettel connects to others in its frontmatter, beside the links of its text. What holds it is `parent` (one key or a list); everything else is a `connectionList`:

```yaml
parent: [structure, link]                 # held by two zettels; never by one it holds
connectionList:
  - to: card-atomic                       # a link: an arrow to the other zettel
    label: needs                          # words on the line
  - to: card-own-words
    isDirected: false                     # a line without an arrow: related
    label: { zettel: card }               # a zettel as the label, opened from the line
  - to: link-place
    label: { object: "frontend:w5xe9dxeujf" }   # an object of the page as the label
  - type: contain                         # this zettel holds another
    to: card-own-words
  - group: Gathers                        # several connections aligned together
    form: map                             # list (no index) | array (0, 1, …) | map (a key each)
    itemList:
      - { key: idea, to: card-atomic }
      - { key: wording, to: card-own-words }
  - type: contain                         # what it holds, in this order, with their index
    group: Areas
    form: array
    itemList: [card, link, structure]
```

In the example box: **Hub cards** is held by two zettels and gathers three in a map; **Written in your own words** goes together with **One card, one idea** (no arrow); **Backlinks** points at **Hub cards** by the zettel **Links**; **A link to a place in a card** points at **One card, one idea** with a document of this page as the label; the root holds its areas as an array and lists where to start. The options of a question are a map from each letter to the zettels it is about.

## Editing

Switch the document to **Edit** (the button at the top of the page). The blocks above then change what they offer; nothing of a box is written while the document is read.

| To | Do |
| --- | --- |
| change the text of a zettel | click a paragraph, a list or a heading of its text: it is edited in place, block by block, as a document of the page is (Ctrl/⌘ + Enter saves, Escape leaves); the toolbar over a block inserts, moves and deletes blocks |
| connect it | the menu at the right of the title bar (…), **Connect to a zettel**: points at, contains or contained by; the other zettel found by words; for a link, its direction and its label. A containment that would close a cycle is said and cannot be made. Below, the connections the zettel writes itself, each with a button taking it away |
| make a zettel | the same menu, **New zettel inside this one**: a title, **Create**; it is held by this one, one level down, and opened |
| remove a zettel | the same menu, **Remove this zettel**, then **Remove**. One holding others is not removed; the root never is. Links to a removed zettel show as missing |
| take a note | **Add a note** at the foot of the text of a zettel, on the whole zettel or one of its sections; then write it as a document. A note lies in the partition `note`, which git keeps out |
| link a zettel in a text | a Markdown link to the file name of the other zettel: `[one idea](card-atomic.md)`, `[the rule](card-atomic.md#rule)` |

How a question went (**Got it**, **Missed**, **Review later**) is the reader's own record and is kept in reading mode too.

## Zettels from other documents

A zettel is a document of the page, so any document links to one. From outside the box a link opens the home document of the box in a popup, at the zettel named.

- by the name of the box: [One card, one idea](<~${frontend.name:Zettelkasten example}/card/card-atomic.md>)
- by its id, at a place: [the rule](~${frontend.id:w5xe9dxeujf}/card/card-atomic.md#rule)
- by the file name alone: [Backlinks](link-backlink.md)

## Zettels on a card diagram

`ZettelDiagram` is a card diagram (the framework of the package `cloud-dev-vis`) that knows the boxes of the page. A node `renderer: { component: ZettelNode }` is a zettel, drawn as its small card, named by its source path in `data.zettel`; its title and summary are read from the zettel, and a click opens it. Everything else is an ordinary diagram: other cards, lines, the visual editor.

<!--renderComp=ZettelDiagram,title=Why a box and not a pile,box=Zettelkasten example-->
```yaml
version: 1
defaults:
  connection: { renderer: { type: smoothstep }, markerEnd: arrowClosed }
viewport:
  size: { height: 380 }
nodes:
  - id: atomic
    renderer: { component: ZettelNode }
    position: { x: 0, y: 0 }
    data: { zettel: "~${frontend.name:Zettelkasten example}/card/card-atomic.md" }
    handles: [{ id: out, direction: out, anchor: { side: right } }]
  - id: words
    renderer: { component: ZettelNode }
    position: { x: 0, y: 130 }
    data: { zettel: "~${frontend.name:Zettelkasten example}/card/card-own-words.md" }
    handles: [{ id: out, direction: out, anchor: { side: right } }]
  - id: pile
    renderer: { type: card-note }
    position: { x: 330, y: 70 }
    size: { width: 190, height: auto }
    data: { title: Cards worth linking, text: small enough to be pointed at as a whole, tone: amber }
    handles: [{ id: in, direction: in, anchor: { side: left } }, { id: out, direction: out, anchor: { side: right } }]
  - id: backlink
    renderer: { component: ZettelNode }
    position: { x: 610, y: 0 }
    data: { zettel: "~${frontend.name:Zettelkasten example}/card/link-backlink.md" }
    handles: [{ id: in, direction: in, anchor: { side: left } }]
  - id: hub
    renderer: { component: ZettelNode }
    position: { x: 610, y: 130 }
    data: { zettel: "~${frontend.name:Zettelkasten example}/card/structure-hub.md" }
    handles: [{ id: in, direction: in, anchor: { side: left } }]
connections:
  - { id: atomic-pile, source: { nodeId: atomic, handleId: out }, target: { nodeId: pile, handleId: in } }
  - { id: words-pile, source: { nodeId: words, handleId: out }, target: { nodeId: pile, handleId: in } }
  - { id: pile-backlink, source: { nodeId: pile, handleId: out }, target: { nodeId: backlink, handleId: in }, label: { text: found by } }
  - { id: pile-hub, source: { nodeId: pile, handleId: out }, target: { nodeId: hub, handleId: in }, label: { text: gathered by } }
```

**Adding and removing cards on the diagram.** Enter the block's visual edit mode (its **Edit** button while the document is edited), then **double-click the empty canvas**. The panel that opens is the create panel of the card diagram framework, with two things of the box in it:

| In the panel | Does |
| --- | --- |
| **Cards**, above the kinds | the cards of the box whose title has the words typed; choosing one places it where you double-clicked |
| **New card**, under *Actions* | asks for a title, makes the card in the box (a topic below its root), and places it. With several boxes on the page it asks which one first |

A selected node is removed from the diagram with the delete button of its edit card or the Delete key; that takes the card off the diagram, not out of the box (remove it in the explorer). `box=` on the marker narrows the panel to one box, by its id or name; without it every zettelkasten of the page is offered.

````md
<!--renderComp=ZettelDiagram,box=Zettelkasten example-->
```yaml
version: 1
nodes:
  - id: atomic
    renderer: { component: ZettelNode }
    position: { x: 0, y: 0 }
    data: { zettel: "~${frontend.name:Zettelkasten example}/card/card-atomic.md" }
```
````

`ZettelNode` works in any card diagram of a page that imports this package (`CardDiagram`, `DiagramER`); only the create panel entries need `ZettelDiagram`.
