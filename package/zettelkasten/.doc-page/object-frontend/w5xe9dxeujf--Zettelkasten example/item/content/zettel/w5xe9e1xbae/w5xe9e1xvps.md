---
level: topic
parent: link
title: A link to a place in a card
summary: A link may point at one section or one sentence of another card, so the reader lands on the words that matter.
sourceList:
  - title: Zettelkasten (Wikipedia)
    url: https://en.wikipedia.org/wiki/Zettelkasten
---

<!--renderComp=Anchor,id=how-->

## How it is written

A card is a Markdown document, and a link to it is a Markdown link: the file name of the card, then the place as a fragment.

```markdown
[one idea](card-atomic.md)             the card
[the rule](card-atomic.md#rule)        a section
[as a whole](card-atomic.md#whole)     a sentence marked with an anchor
```

Try it: [the sentence about linking a card as a whole](card-atomic.md#whole).
