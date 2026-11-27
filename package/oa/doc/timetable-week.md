# Weekly timetables

`TimetableWeek` is seven days of hours holding cards at a time (an [event](./event.md), a [Zoom reservation](./meeting-zoom.md#a-reservation), an [online course](./course-online.md)), each where its own time is, at a precision of five minutes; an entry with a status shows it as a dot in its tone, a cancelled one struck through. A time said less finely is placed by the [range it refers to](./time.md#granularity): a part of a day (an evening) as a box over its hours, its edge dashed; one day or several in the row of whole days under the heads; a month or a year has no place in a week, and is refused. It holds the cards whole: each entry is a block of its component, kept in the timetable's data, and a click on an entry shows the card itself.

<!--renderComp=TimetableWeek-->
```yaml
title: Team week
week: 2026-11-23
zone: +09
entryList:
  - comp: MeetingZoomReservation
    raw: |
      title: Sprint planning
      time: 2026-11-23 10:00~11:00 +09
      url: https://zoom.us/j/81234567890
  - comp: MeetingZoomReservation
    raw: |
      title: Design review
      time: 2026-11-25 13:30~14:15 +09
  - comp: CourseOnlineReservation
    raw: |
      title: Japanese for beginners
      time: 2026-11-26 19:00~20:30 +09
      teacher: Ms. Sato
  - comp: MeetingZoomReservation
    raw: |
      title: 1:1
      time: 2026-11-25 13:45~14:15 +09
      statusHistory:
        - { status: cancelled, time: 20261124_17000000+09 }
  - comp: EventGeneral
    raw: |
      title: Off-site
      time: 2026-11-26~11-27 +09
  - comp: EventGeneral
    raw: |
      title: Board games
      time: 2026-11-29 evening +09
  - comp: EventGeneral
    raw: |
      title: Team dinner
      time: 2026-11-28 18:00~20:00 +09
      place: Shibuya
      statusHistory:
        - { status: confirmed, time: 20261125_18300000+09 }
```

```yaml
title: Team week          # optional
week: 2026-11-23          # the first day of the week it is bound to; or "every"; or absent (below)
zone: +09                 # optional: the zone it is drawn in, else its first card's
hours: 08:00~20:00        # optional: the hours shown at least (8 to 20), widened to show every card
entryList:                # the cards, as blocks: their component and their data
  - comp: MeetingZoomReservation
    raw: |
      title: Sprint planning
      time: 2026-11-23 10:00~11:00 +09
```

## Its dates

A timetable is in one of three states, shown in its head and chosen there (right-click the head while it is edited):

| `week` | State | What it takes |
| --- | --- | --- |
| `2026-11-23` | **bound** to the week starting that day | a card whose day is in that week; another is refused, saying why |
| absent | **not bound yet** | any card: the first one at a day binds the table to its week (starting on the first day of the week of the [preferences](./time.md#preferences)) |
| `every` | **every week**, never bound to dates | any card, placed by its day of the week: for planning or logging what repeats |

The week of a table is chosen in its head while it is edited: a click on it opens a calendar, with the three ways above as chips. A click on any day binds the table to the week of that day (the week chosen is shown on the calendar); a week that would leave out a card the table holds is refused, saying which.

<!--renderComp=TimetableWeek-->
```yaml
title: Every week
week: every
zone: +09
hours: 09:00~13:00
entryList:
  - comp: CourseOnlineReservation
    raw: |
      title: Piano
      time: Tue 10:00~10:45 +09
  - comp: MeetingZoomReservation
    raw: |
      title: Stand-up
      time: Fri 09:30~09:45 +09
```

## Editing one

A click on the timetable opens its edit mode **Fields**; everything is done on the table:

| To | Do |
| --- | --- |
| move a card to another day or time | drag it (five minutes at a time); its day changes with the column. A card of whole days or of a part of a day moves by whole days, keeping what it says |
| change when it ends | drag its bottom edge |
| change a value of a card | click it: its card floats over it, its values typed where they stand as on the card itself |
| add a card | click a free time: the components at a time of the page, one added there for an hour, its card open |
| remove a card | right-click it: **Delete** |
| rename the table, rebind its week | click its title, its week |

A card the table cannot place (no time of day, a day out of its week, a component the page lacks) is listed under the hours, never hidden.

## In a card diagram

A card of a diagram holds a timetable like any component, and the timetable and the cards it holds are **one node**. While the diagram is edited:

- **drag a card onto the timetable** to put it in: the timetable is framed green while it takes it, and in the warning color with the reason while it does not (*its day, 2026-12-02, is not in the week of 11-23 – 11-29*). Dropped, the card is gone from the diagram and stands in the table; its lines keep their ends where they were;
- **drag an entry out of the timetable** to take it out: it becomes a card of its own where it is let go, or goes into another timetable that takes it. What letting go there does is said beside the pointer;
- each is one step of the diagram's history: Ctrl/⌘ + Z puts it back.

<!--renderComp=CardDiagram,height=640-->
```yaml
version: 1
viewport: { view: auto }
nodes:
  - id: week
    renderer: { type: card-comp }
    position: { x: 0, y: 0 }
    size: { width: 560, height: auto }
    data:
      comp: TimetableWeek
      lang: yaml
      raw: |
        title: Team week
        week: 2026-11-23
        zone: +09
        entryList:
          - comp: MeetingZoomReservation
            raw: |
              title: Sprint planning
              time: 2026-11-23 10:00~11:00 +09
  - id: course
    renderer: { type: card-comp }
    position: { x: 620, y: 0 }
    size: { width: 240, height: auto }
    data:
      comp: CourseOnlineReservation
      lang: yaml
      raw: |
        title: Japanese for beginners
        time: 2026-11-26 19:00~20:30 +09
        teacher: Ms. Sato
  - id: review
    renderer: { type: card-comp }
    position: { x: 620, y: 150 }
    size: { width: 240, height: auto }
    data:
      comp: MeetingZoomReservation
      lang: yaml
      raw: |
        title: Design review
        time: 2026-11-25 13:30~14:15 +09
  - id: next-week
    renderer: { type: card-comp }
    position: { x: 620, y: 290 }
    size: { width: 240, height: auto }
    data:
      comp: MeetingZoomReservation
      lang: yaml
      raw: |
        title: Retrospective
        time: 2026-12-02 16:00~17:00 +09
  - id: dinner
    renderer: { type: card-comp }
    position: { x: 620, y: 420 }
    size: { width: 240, height: auto }
    data:
      comp: EventGeneral
      lang: yaml
      raw: |
        title: Team dinner
        time: 2026-11-27 19:00~21:00 +09
        people: [Sato, Tanaka]
        place: Shibuya
        statusHistory:
          - { status: planned, time: 20261120_09000000+09 }
  - id: room
    renderer: { type: card-comp }
    position: { x: 620, y: 600 }
    size: { width: 240, height: auto }
    data:
      comp: MeetingZoomInstance
      lang: yaml
      raw: |
        title: Team room
        meetingId: 812 3456 7890
```

How it works: a component holding others ([MDX components](../../../main/doc_page_impl_mdx_comp.md#a-component-holding-others)) and a node holding others ([card diagrams](../../cloud-dev-vis/doc/card-diagram-impl.md#a-node-holding-others)).
