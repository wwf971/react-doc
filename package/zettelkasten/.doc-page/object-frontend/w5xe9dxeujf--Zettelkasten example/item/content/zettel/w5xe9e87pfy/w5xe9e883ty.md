---
level: root
title: The zettelkasten method
label: Method
summary: A box of small notes, each saying one thing, joined by links. This example box explains the method with the method.
sourceList:
  - title: Zettelkasten (Wikipedia)
    url: https://en.wikipedia.org/wiki/Zettelkasten
flow:
  title: From reading to a linked card
  stepList:
    - id: read
      title: Read or think
      text: something worth keeping
      tone: slate
    - id: write
      title: Write one card
      text: one idea, your own words
      zettel: card-atomic
      tone: blue
    - id: link
      title: Link it
      text: to what it explains or contradicts
      zettel: link
      tone: teal
    - id: place
      title: Place it
      text: below a card that leads to it
      zettel: structure
      tone: violet
    - id: use
      title: Use it
      text: answer a question from the box
      tone: green
connectionList:
  - type: contain
    group: Areas
    form: array
    itemList:
      - card
      - link
      - structure
  - group: Start here
    form: list
    itemList:
      - card-atomic
      - link-backlink
---

<!--renderComp=Anchor,id=idea-->

## The idea

A zettelkasten ("slip box") keeps knowledge as many small **cards** instead of a few long documents. A card is worth little alone; its value is in the [links](link.md) to other cards and in the [Structure](structure.md) that lets you enter the box from the top.

Start with [Cards](card.md), follow a link, and come back with the arrows of the bar.

<!--renderComp=Anchor,id=try-->

## Try it here

- Click a link in this text: the zettel shows the one it names, and the arrows of its title bar come back.
- Switch the zettel to **Connections**, at the right of its title bar: what holds it stands above, what it holds below, its links on the sides. A click on a zettel there brings it to the middle; a click on the one in the middle reads it.
- Open **Questions** above the zettel to test yourself: [Q1](q001.md).
- Switch the document to **Edit** to change this text block by block; the menu of the title bar then connects this zettel to another, makes one inside it, or removes it.
