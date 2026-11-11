---
title: Zettelkasten
description: A box of linked cards kept as a frontend object: reading it, editing it, making and removing cards, and putting cards on a card diagram.
language: en
---

A zettelkasten is one frontend object of the type `zettelkasten.box`. Its cards are Markdown items of the object; this package draws them. The box on this page is a small example about the method itself, kept in the package (`.doc-page/object-frontend/`), so everything below can be tried. The design is in [the root document](../../doc/README.md).

## The explorer

The left side is the map of the cards, the right side the card being read. A click on a card of the map opens it; so does a link in a text. The arrows of the bar go back and forth, and the field finds a card by words (`q1` finds question 1).

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5xe9dxeujf
mode: explorer
param:
  height: 640
```

A block is written like this; `param.zettel` names the card shown first, `param.layout` is `split`, `map` or `card`, and `param.isPractice: true` hides the answers of questions until asked.

````md
<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5xe9dxeujf     # the box
mode: explorer
param: { zettel: link, height: 640 }
```
````

## One card

The mode `card` shows one card in the flow of a document. Its links work in place.

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5xe9dxeujf
mode: card
param:
  zettel: card-atomic
```

## Editing

Switch the document to **Edit** (the button at the top of the page). The blocks above then change what they offer; nothing of a box is written while the document is read.

| To | Do |
| --- | --- |
| change the text of a card | click a paragraph, a list or a heading of the card: it is edited in place, block by block, as a document of the page is (Ctrl/⌘ + Enter saves, Escape leaves); the toolbar over a block inserts, moves and deletes blocks |
| make a card | **New card below** under *This card* at the foot of a card, type its title, **Create**: the card is made one level below the card shown (an area below the root, a topic below an area, a fact below a topic) and opened |
| remove a card | **Remove card** in the same place, then **Remove**. A card with cards or questions below it is not removed; the root never is. Links to a removed card show as missing |
| take a note | **Add a note** at the foot of a card, on the whole card or one of its sections; then write it as a document. A note lies in the partition `note`, which git keeps out |
| link a card | in the text of a card, a Markdown link to the file name of the other card: `[one idea](card-atomic.md)`, `[the rule](card-atomic.md#rule)` |

How a question went (**Got it**, **Missed**, **Review later**) is the reader's own record and is kept in reading mode too.

## Cards from other documents

A card is a document of the page, so any document links to one. From outside the box a link opens the home document of the box in a popup, at the card named.

- by the name of the box: [One card, one idea](<~${frontend.name:Zettelkasten example}/card/card-atomic.md>)
- by its id, at a place: [the rule](~${frontend.id:w5xe9dxeujf}/card/card-atomic.md#rule)
- by the file name alone: [Backlinks](link-backlink.md)

## Cards on a card diagram

`ZettelDiagram` is a card diagram (the framework of the package `cloud-dev-vis`) that knows the boxes of the page. A node `renderer: { component: ZettelNode }` is a card, named by its source path in `data.zettel`; its title and summary are read from the card, and a click opens it. Everything else is an ordinary diagram: other cards, lines, the visual editor.

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
