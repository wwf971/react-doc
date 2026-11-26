# Zoom meetings

Two cards keep a Zoom meeting: a **reservation**, a meeting at a time, and an **instance**, a meeting joined at any time by its number and passcode. Both have a title, the button **Join**, and a description if you want one.

## A reservation

`MeetingZoomReservation`: what the meeting is, when (with its zone; the day of the week is read from it), how long if written, the link joining it.

<!--renderComp=MeetingZoomReservation-->
```yaml
title: Sprint planning
time: 2026-11-25 10:00 +09
duration: 45
url: https://zoom.us/j/81234567890?pwd=example
description: Bring the board of the sprint; decisions go into the notes.
```

```yaml
title: Sprint planning                           # what the meeting is
time: 2026-11-25 10:00 +09                       # when, with its zone
duration: 45                                     # optional: how long, in minutes
url: https://zoom.us/j/81234567890?pwd=example   # optional: the link joining it
description: …                                   # optional
```

## An instance

`MeetingZoomInstance`: the meeting number and the passcode typed in the app, each copied by its button. **Join** opens the link written, or else the link of the number.

<!--renderComp=MeetingZoomInstance-->
```yaml
title: Team room
meetingId: 812 3456 7890
passcode: '402913'
description: Open every weekday from 9:00.
```

```yaml
title: Team room                 # whose or what it is
meetingId: 812 3456 7890         # the number; written in groups as the app shows it
passcode: '402913'               # quoted, so a code starting with 0 stays a text
url: https://zoom.us/j/…         # optional: the invitation link
description: …                   # optional
```

## The description

The description is a text of the [cell editing kit](../../../main/doc_page_impl_edit_cell.md): besides words and lines, it holds the tokens the page knows, typed with `/` while it is edited: a link to a document (`/link`, written `[label](target)`) or a view of an object (`/object`). Outside a doc page (a diagram of an app) it is plain text.

## Writing one

In edit mode, type `/meeting-zoom` in a paragraph: both are listed (`/meeting-zoom-reservation`, `/meeting-zoom-instance`; also `/zoom-reservation`, `/zoom-instance`). Enter puts a card to fill in its place. The insert menu of a block offers them too.

## Editing one

A click on the card opens its edit mode **Fields**, where everything is done on the card itself ([Editability](../../../main/doc_page_impl_edit.md#editability-everything-a-reader-sees-is-edited-where-it-stands)):

| To | Do |
| --- | --- |
| change a value | click it and type; Enter keeps it (in the description Enter breaks the line and Ctrl/⌘ + Enter keeps it), Escape gives it up |
| add a value not written yet (a time, a length, a meeting ID, a passcode, a link, a description) | the **+** in the bottom right corner of the card (there while the card is edited, faint until the pointer is on it), then the value: it stands in its place at once, its field open; given up empty, it goes again |
| remove a value | keep it empty, or right-click it: **Delete** |
| change the link | click **Join**: the link is typed in a field under it (Join opens nothing while the card is edited) |

Nothing moves as the mode opens: the +, the field of the link and the menu float. *Save* in the floating bar writes the block, *Cancel* leaves it as it was. A time is kept as the card shows it (`2026-11-25T10:00+09:00` becomes `2026-11-25 10:00 +09`), a number in its groups.

## In a card diagram

A card of a diagram can hold one component of the page ([A component in a card](../../cloud-dev-vis/doc/card-diagram-usage.md#a-component-in-a-card)): a reservation beside the room it is held in, a line between them. Double-click the canvas in the editor and type `meeting-zoom`. In a diagram the cards are drawn at the size of the cards around them. While the diagram is edited, the card is edited as in a document, on the card (the mode *Fields* kept open in place, `isInPlace`): a click on a value types it, the **+** adds a missing one, a right click removes one, **Join** types the link; each value is written as a step of the diagram's history. The edit card of the card repeats the values (`expose.dataFields`) as a second way; it is not where they are added.
