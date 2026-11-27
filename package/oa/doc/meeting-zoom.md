# Zoom meetings

Two cards keep a Zoom meeting: a **reservation**, a meeting at a time, and an **instance**, a meeting joined by its number and passcode, at any time or at one. Both are [events](./event.md#special-types-of-event) of special types: a title, a time (at any [granularity](./time.md#granularity)), who joins it, the button **Join**, a description, and a status kept as the history of its changes.

## A reservation

`MeetingZoomReservation`: what the meeting is, when (a span with its zone: [Times](./time.md)), who joins it, the link joining it, and its status. It is an [event](./event.md#special-types-of-event) whose place is the link; its status is kept as the history of its changes ([Its status](./event.md#its-status)). Its length is read from its time and shown beside it.

<!--renderComp=MeetingZoomReservation-->
```yaml
title: Sprint planning
time: 2026-11-25 10:00~10:45 +09
people: [Sato, Tanaka]
url: https://zoom.us/j/81234567890?pwd=example
description: Bring the board of the sprint; decisions go into the notes.
statusHistory:
  - { status: planned, time: 20261118_10000000+09 }
  - { status: confirmed, time: 20261121_16450000+09 }
```

```yaml
title: Sprint planning                           # what the meeting is
time: 2026-11-25 10:00~10:45 +09                 # when: a start, an end, its zone (doc/time.md)
people: [Sato, Tanaka]                           # optional: who joins it
url: https://zoom.us/j/81234567890?pwd=example   # optional: the link joining it
description: …                                   # optional
statusHistory: [...]                             # optional: the changes of its status (doc/event.md#its-status)
timeFormat: short                                # optional: how its time is written (doc/time.md#formats)
timeClock: 12h                                   # optional: 12 or 24 hours, else the package's preference
```

An older reservation wrote its length apart (`duration: 45`, in minutes): it is read as the end of its time, and written so at its next change.

## An instance

`MeetingZoomInstance`: the meeting number and the passcode typed in the app, each copied by its button. **Join** opens the link written, or else the link of the number. A time is optional: a room open every weekday has none, a meeting held on Saturday evening has `2026-11-28 evening`; with a time, a [weekly timetable](./timetable-week.md) takes it.

<!--renderComp=MeetingZoomInstance-->
```yaml
title: Team room
meetingId: 812 3456 7890
passcode: '402913'
description: Open every weekday from 9:00.
```

<!--renderComp=MeetingZoomInstance-->
```yaml
title: Study group
time: 2026-11-28 evening +09
people: [Sato, Tanaka]
meetingId: 812 3456 7890
passcode: '402913'
statusHistory:
  - { status: confirmed, time: 20261126_21000000+09 }
```

```yaml
title: Team room                 # whose or what it is
time: 2026-11-28 evening +09     # optional: when it is held, at any granularity
people: [Sato, Tanaka]           # optional: who joins it
meetingId: 812 3456 7890         # the number; written in groups as the app shows it
passcode: '402913'               # quoted, so a code starting with 0 stays a text
url: https://zoom.us/j/…         # optional: the invitation link
description: …                   # optional
statusHistory: [...]             # optional: the changes of its status
```

## The description

The description is a text of the [cell editing kit](../../../main/doc_page_impl_edit_cell.md): besides words and lines, it holds the tokens the page knows, typed with `/` while it is edited: a link to a document (`/link`, written `[label](target)`) or a view of an object (`/object`). Outside a doc page (a diagram of an app) it is plain text.

## Writing one

In edit mode, type `/meeting-zoom` in a paragraph: both are listed (`/meeting-zoom-reservation`, `/meeting-zoom-instance`; also `/zoom-reservation`, `/zoom-instance`). Enter puts a card to fill in its place. The insert menu of a block offers them too.

## Editing one

A click on the card opens its edit mode **Fields**, where everything is done on the card itself ([Editability](../../../main/doc_page_impl_edit.md#editability-everything-a-reader-sees-is-edited-where-it-stands)):

| To | Do |
| --- | --- |
| change a text | click it and type; Enter keeps it (in the description Enter breaks the line and Ctrl/⌘ + Enter keeps it), Escape gives it up. A drag in it selects its words; it never moves the card |
| change the time | click it: the picker opens under it, a calendar, the times of a day, the parts of a day, a month, a year ([Choosing a time](./time.md#choosing-a-time)) |
| change how the time is written | right-click the time: its format and its clock, or the package's |
| change the people | each person is an entry of their own: click one to type it; beside the card, its group adds one before or after it, or deletes it |
| add a value not written yet (a time, people, a meeting ID, a passcode, a link, a description, a status) | the **+**: in a block of a document, in the bar of the block; on a card of a diagram, over the card's top edge (the whole time on the card selected, on another while the pointer is on it); then the value: it stands in its place at once, its control open; given up empty, it goes again |
| remove a value | while it is open, **Delete** in its group beside the card; or right-click it: **Delete**; or keep it empty |
| change the link | click **Join**: the link is typed in a field under it (Join opens nothing while the card is edited) |

Nothing moves as the mode opens, and nothing covers the words of the card: the group of a value open stands outside the card at its left edge, level with the value; the +, the picker, the field of the link and the menus float outside or under what they belong to ([Designing for card diagrams](../../../main/diagram-design-design.md)). *Save* in the floating bar writes the block, *Cancel* leaves it as it was. A time is kept in one form whatever was typed (`2026-11-25T10:00+09:00` becomes `2026-11-25 10:00 +09`), a number in its groups.

## In a card diagram

A card of a diagram can hold one component of the page ([A component in a card](../../cloud-dev-vis/doc/card-diagram-usage.md#a-component-in-a-card)): a reservation beside the room it is held in, a line between them. Double-click the canvas in the editor and type `meeting-zoom`. In a diagram the cards are drawn at the size of the cards around them. While the diagram is edited, the card is edited as in a document, on the card (the mode *Fields* kept open in place, `isInPlace`): a click on a value types it, the **+** adds a missing one, a right click removes one, **Join** types the link; each value is written as a step of the diagram's history. The edit card of the card repeats the values (`expose.dataFields`) as a second way, and holds the format of the time (**Time format**, **Clock**); it is not where values are added. A reservation dragged onto a [weekly timetable](./timetable-week.md#in-a-card-diagram) goes into it.
