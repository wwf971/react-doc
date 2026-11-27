# Standards of oa

How oa describes the affairs of daily life and of an office: what a thing is, when it is, what state it is in, who and where. Every card of the package follows these rules, so that whatever reads the cards (a weekly timetable, a timeline, another package, an agent) can rely on them without knowing a card by name. A new card, or a card of another package that wants to be read the same way, follows them too.

<!--renderComp=DiagramText-->
```text
 what it is        a kind, a special type of a general one      event ◄── Zoom meeting, class of a course
 when it is        a time at its granularity, its zone          2026-11-28 evening +09
                   ──► a conservative range                     2026-11-28 17:00 – 22:00 +09
 what state        the history of its changes                   planned ─► confirmed ─► done
                   each at a moment, with its zone, by whom     20261125_18300000+09, by Sato
 who, where        names as a list, a place as words            [Sato, Tanaka], Shibuya
 read by others    exposures, never the data itself             timeItem, statusItem, oaTypeList
```

## 1. What a thing is: a type, and its special types

Every card is of a **kind**: its fields, in their order, with their meaning. Kinds that are the same thing in general are **special types** of one general kind, made from it (`oaEventKindCreate`): an [event](./event.md) is what, when, who, where, a description and a status; a Zoom reservation is an event whose place is the link joining it, a class of an online course an event with a teacher. A special type keeps the general fields with **the same names and the same meaning**, adds its own, and leaves out only what it cannot have; it says what it is a special type of (`expose.oaTypeList: ['event']`). Whatever reads events reads all of them.

*Why:* a person thinks of "a meeting" and "a dinner" as events first; a timetable, a timeline, a search should too. A field named differently in each card (`when`, `time`, `date`) would make every reader learn every card.

## 2. When: as finely as it is known, never more

A time is said at its **granularity**: a year, a month, a day or several, a part of one (an evening, early November, the spring), or a time of day ([Times](./time.md#granularity)). It is said as finely as it is known and **never more finely**: a dinner "on Saturday evening" is `2026-11-28 evening`, not `2026-11-28 19:00`; a party "late December" is `2026-12 late`, not a made-up day.

- **A time always has its zone**, kept with it and shown with it (`+09`).
- **Kept in one form**, whatever was typed and however it is shown (`2026-11-28 evening +09`): a person reads it, a program parses it.
- **A time refers to a range, read conservatively**: from the first moment it may mean to the last (an evening 17:00 to 22:00, a night to 05:00 the next morning). Whatever collects times places a time by its range (`oaTimeRangeOf`), never by guessing a moment inside it, and so never misses one.
- **The words for parts are preferences, not code** (`TimePeriodMap`, `TimePeriodWordMap`): a doc page registers its own parts (a lunch break, a fiscal year) in its config, beside those of the package.

*Why:* a time stated more precisely than known is a false fact, which a timeline then draws as a fact. A range that contains the meaning keeps every collected time true: a timetable may show an evening as a band, never as 19:00.

## 3. What state: the history, never the state alone

The state of a thing (the status of an event: planned, confirmed, done) is recorded as the **history of its changes**, never as its latest value alone ([Its status](./event.md#its-status)). Every change is one entry: the new state, **the moment it was made, with its zone**, and **who made it** when known. The state a thing is in is derived: the one of its latest change. Changing a state adds a change; nothing is overwritten. The history itself is a record that can be corrected (a change's state or moment set again, a wrong change taken away), and the correction is an edit of the record, not a new change.

*Why:* "it was confirmed on the 25th, then postponed" is knowledge a single value loses. A record of changes answers when, how often and by whom, and a latest value is always computable from it, never the other way round.

## 4. Moments and times

Two kinds of time are told apart. **A time a thing is at** (its `time`) is said at its granularity, as above. **A moment something happened** (a change of state) is exact, to the hundredth of a second, in the project's form with its zone (`20261125_18300000+09`, shown `2026-11-25 18:30 +09`). A moment is recorded by the page when the thing happens; a time is said by a person.

## 5. Who and where

**Who** is a list of names, one entry per person (`people: [Sato, Tanaka]`), typed as one text (`Sato, Tanaka`); a role with its own meaning has its own field (`teacher`). **Where** is words (`place: Shibuya, Hachiko exit`); for an online event the link joining it is its place. Nobody is invented: a person not known is not written.

## 6. Values are optional, and empty means unknown

Only what a thing is (its title) is needed. Every other value is written when it is known and left out when it is not: never a placeholder, never a default that looks like a fact (`00:00`, `TBD` as a time). A value not written is added on the card when it becomes known ([Editability](../../../main/doc_page_impl_edit.md#editability-everything-a-reader-sees-is-edited-where-it-stands)).

## 7. Read through exposures

What another part of the page knows of a card it learns from what the card exposes, never from its yaml nor from its component's name:

| Exposure | Says |
| --- | --- |
| `expose.timeItem` | when it is: its span, a span set again, its title in a list of times ([A card at a time](./time.md#a-card-at-a-time)) |
| `expose.statusItem` | the states it may be in, its history, its state now ([Its status](./event.md#its-status)) |
| `expose.oaTypeList` | what it is a special type of (`event`) |
| `expose.hold` | what it holds of other cards, takes and lets go (the timetable: [A component holding others](../../../main/doc_page_impl_mdx_comp.md#a-component-holding-others)) |

A card of another package that exposes the same is read the same: a weekly timetable takes any component that exposes `timeItem`.

## 8. Preferences, not constants

What people say differently (12 or 24 hours, the first day of a week, the format of a time, the words for the parts of a day) is a preference of the package ([Preferences](./time.md#preferences)), set per doc page, document or reader, never fixed in a card. A card may name its own format; a preference is the default.

## 9. How a card looks and is edited

One face, the sans-serif of the page, for every value (figures in tabular digits, never a monospace face); sized with what holds it; everything a card says changed, added and removed on the card itself, nothing moving as it is edited ([How a card is made](./README.md#how-a-card-is-made)).
