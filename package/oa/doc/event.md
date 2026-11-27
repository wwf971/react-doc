# Events

`EventGeneral` keeps an event: what it is, when, who, where, a description, and its **status**. Only what it is (its title) is needed; the rest is added when known.

<!--renderComp=EventGeneral-->
```yaml
title: Team dinner
time: 2026-11-28 19:00~21:00 +09
people: [Sato, Tanaka, Suzuki]
place: Shibuya, Hachiko exit
description: Booked for eight; the menu is set.
statusHistory:
  - { status: planned, time: 20261120_09000000+09 }
  - { status: tentative, time: 20261122_12150000+09 }
  - { status: confirmed, time: 20261125_18300000+09 }
```

```yaml
title: Team dinner                  # what it is
time: 2026-11-28 19:00~21:00 +09    # optional: when, as finely as known (doc/time.md#granularity)
people: [Sato, Tanaka]              # optional: who
place: Shibuya, Hachiko exit        # optional: where
description: …                      # optional: a text with links and views of objects
statusHistory: [...]                # optional: the changes of its status (below)
timeFormat: short                   # optional: how its time is written (doc/time.md#formats)
```

Its time is said as finely as it is known: a time of day, a part of a day (`2026-11-28 evening`), several days (`2026-11-28~11-30`), a month or a part of one (`2026-12 late`), a year ([Times](./time.md#granularity)).

In edit mode, type `/event` in a paragraph, or find it in the insert menu. Everything is done on the card, as for every card of oa ([Editing one](./meeting-zoom.md#editing-one)): a click on a text types it, a click on the time opens its picker, the **+** adds a value not written yet, and a value open is deleted from its group beside the card (or its right-click menu). The people are one entry each: click one to type it, its group adds one before or after it or deletes it (a name typed with commas makes several).

## Special types of event

An event is a kind the other cards at a time are made from (`oaEventKindCreate`, `comp-mdx/oa-card/oa-card-data.js`). A [Zoom reservation](./meeting-zoom.md#a-reservation) is an event whose place is the link joining it, a [Zoom instance](./meeting-zoom.md#an-instance) one whose place is its number (its time optional); a class of an [online course](./course-online.md) is an event with a teacher and the link of the class. The rules they share: [Standards of oa](./standards.md). They share the fields of an event (what, when, who, a description, the status), so whatever reads an event reads them too, and each says what it is a special type of (`expose.oaTypeList: ['event']`).

| | title | time | people | place | its own | status |
| --- | --- | --- | --- | --- | --- | --- |
| `EventGeneral` | what it is | ✓ | ✓ | ✓ | | ✓ |
| `MeetingZoomReservation` | the meeting | ✓ | ✓ | the link (Join) | | ✓ |
| `CourseOnlineReservation` | the course | ✓ | ✓ | the link (Join) | teacher | ✓ |
| `MeetingZoomInstance` | whose room | optional | ✓ | its number (Join) | meeting ID, passcode | ✓ |

## Its status

What is kept is the **history** of the status, never the status alone: every change is one entry with the moment it was made, in its zone, and who made it when it is known (nobody is named yet). The status a card shows is the one of its latest change.

```yaml
statusHistory:                                   # in the order written, oldest first by custom
  - status: planned
    time: 20261120_09000000+09                   # the moment of the change: local time, its zone
  - status: confirmed
    time: 20261125_18300000+09
    by: Sato                                     # optional: who changed it
```

The moment is written in the project's form (`20261125_18300000+09`: the day, the time to the hundredth of a second, the zone in whole hours) and shown with its zone (`2026-11-25 18:30 +09`). The latest change is the one at the latest moment, whatever the order written.

| Status | Meaning |
| --- | --- |
| Planned | intended, nothing settled |
| Tentative | likely, not settled |
| Confirmed | settled |
| Postponed | moved to a time not known yet |
| Cancelled | will not take place |
| Done | took place |

**On the card.** The status stands beside the title. A click shows its history, the latest change first. While the card is edited:

| To | Do |
| --- | --- |
| change the status | click it, choose another: a change made now, added to the history |
| see or edit the history | click it, **History**: a change's status is clicked and chosen again, its moment clicked and typed (`1125 1830`, or as shown); a right click on a change: **Delete this change** |
| add a status to a card without one | the **+**: **Add status**, then the first status |
| remove the status and its whole history | right-click it: **Delete the status and its history** |

In a card diagram the edit card offers the status too (**Status**): a status chosen there is a change made now, as on the card. A [weekly timetable](./timetable-week.md) shows the status of each entry, a cancelled one struck through.

**For whoever reads it.** A card with a status says so through one exposure, `expose.statusItem` (`oaStatusItemOf`, `comp-mdx/status/oa-status.js`):

```js
statusItem: {
  statusListGet()      // the statuses it may be at: [{ id, label, tone }]
  historyGet(data)     // its changes: [{ status, time, by? }], as the data holds them
  statusGet(data)      // the status of its latest change, or null
}
```

The changes are facts at moments, so a timeline collecting the cards at a time ([TODO](../../../main/doc_page_impl_TODO.md#timeline-of-times)) can place them too.
