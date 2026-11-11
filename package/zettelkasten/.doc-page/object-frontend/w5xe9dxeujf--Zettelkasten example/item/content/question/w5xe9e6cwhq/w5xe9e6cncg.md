---
kind: question
number: 2
hub: link
title: Finding where an idea is used
summary: Backlinks answer "who uses this card" without a list anyone has to keep.
stem: |-
  You want to know which cards rely on the card "One card, one idea", without maintaining a list by hand.
  Which feature gives this?
answer: A
answerDump: A
answerConfidence: high
voteList: []
clueList:
  - text: without maintaining a list by hand
    implies: derived from the links that exist
zettelList:
  - link-backlink
  - link
sourceList: []
optionList:
  - id: A
    text: The backlinks of the card.
    verdict: correct
    zettelList:
      - link-backlink
  - id: B
    text: An index card listing every card that mentions it.
    verdict: wrong
    zettelList:
      - structure-hub
  - id: C
    text: A full-text search for its title.
    verdict: wrong
    zettelList:
      - link
---

<!--renderComp=Anchor,id=explanation-->

## How to get there

Every link is written once, at its source. The other direction is computed: [Backlinks](link-backlink.md).

## Why each option

<!--renderComp=Anchor,id=option-a-->

### Option A: correct

Backlinks are derived from the links, so they are always current ([Backlinks › What they are for](link-backlink.md#what)).

<!--renderComp=Anchor,id=option-b-->

### Option B: wrong

An index card kept by hand is exactly the list the question wants to avoid ([Hub cards](structure-hub.md)).

<!--renderComp=Anchor,id=option-c-->

### Option C: wrong

A search finds words, not references: it misses links written with other words and finds mentions that are not links.
