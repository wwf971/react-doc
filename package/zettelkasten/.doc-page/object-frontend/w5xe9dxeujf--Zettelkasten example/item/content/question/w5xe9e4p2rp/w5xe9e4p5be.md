---
kind: question
number: 1
hub: card
title: Is this one card or two
summary: A card whose honest title is a topic holds several ideas and should be split.
stem: |-
  A note titled "Caching" has two paragraphs: one on when a cache entry expires, one on how a cache key is built. Links from other notes usually refer to only one of the two paragraphs.
  What is the best change?
answer: B
answerDump: B
answerConfidence: high
voteList: []
clueList:
  - text: links from other notes usually refer to only one of the two paragraphs
    implies: the card is not linked as a whole
  - text: titled Caching
    implies: a topic, not a statement
zettelList:
  - card-atomic
  - structure-hub
  - link-place
sourceList: []
optionList:
  - id: A
    text: Write a longer summary that covers both paragraphs.
    verdict: wrong
    zettelList:
      - card
  - id: B
    text: Split it into two cards, one per idea, and link them to each other.
    verdict: correct
    zettelList:
      - card-atomic
  - id: C
    text: Turn the note into a hub card and keep both paragraphs in it.
    verdict: wrong
    zettelList:
      - structure-hub
  - id: D
    text: Keep the note and make every link point at a paragraph.
    verdict: wrong
    zettelList:
      - link-place
---

<!--renderComp=Anchor,id=explanation-->

## How to get there

The sign is in how the card is linked: other cards want one half of it. That breaks the rule that [a card is linked as a whole](card-atomic.md#rule). Splitting gives two cards that each take a statement for a title; the topic "Caching" survives as a [Hub cards](structure-hub.md) above them.

## Why each option

<!--renderComp=Anchor,id=option-a-->

### Option A: wrong

A longer summary does not change what a link to the card means.

<!--renderComp=Anchor,id=option-b-->

### Option B: correct

Two cards, each one idea, linked to each other: every link then means the whole card ([One card, one idea](card-atomic.md)).

<!--renderComp=Anchor,id=option-c-->

### Option C: wrong

A hub gathers cards; it does not hold their text ([Hub cards](structure-hub.md)). The two ideas would still be one unlinkable block.

<!--renderComp=Anchor,id=option-d-->

### Option D: wrong

Links to a place help a reader land ([A link to a place in a card](link-place.md)), but the card stays two ideas that change for different reasons.
