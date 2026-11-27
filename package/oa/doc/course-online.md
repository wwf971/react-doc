# Online courses

`CourseOnlineReservation` keeps one class of an online course: the course, when its class is, who gives it, who else takes it, the link of the class (**Join**), a description, and its status. It is an [event](./event.md#special-types-of-event) with a teacher; its status is kept as the history of its changes ([Its status](./event.md#its-status)). Only the name of the course is needed; the rest is added when it is known.

<!--renderComp=CourseOnlineReservation-->
```yaml
title: Japanese for beginners
time: 2026-11-26 19:00~20:30 +09
teacher: Ms. Sato
url: https://meet.example.com/abc-defg
description: Lesson 7. Bring the workbook; the homework is due.
statusHistory:
  - { status: confirmed, time: 20261119_20000000+09 }
```

```yaml
title: Japanese for beginners          # the name of the course
time: 2026-11-26 19:00~20:30 +09       # optional: when the class is (doc/time.md)
teacher: Ms. Sato                      # optional: who gives it
people: [Tanaka]                       # optional: who else takes it
url: https://meet.example.com/abc-defg # optional: the link of the class
description: …                         # optional: a text with links and views of objects
statusHistory: [...]                   # optional: the changes of its status (doc/event.md#its-status)
timeFormat: short                      # optional: how its time is written (doc/time.md#formats)
```

## Writing and editing one

In edit mode, type `/course-online-reservation` (or `/course-reservation`, `/online-course`) in a paragraph, or find it in the insert menu. A click on the card opens its edit mode **Fields**, everything done on the card as for the [Zoom cards](./meeting-zoom.md#editing-one): a click on a text types it, the **+** adds a value not written yet (a time, a teacher, people, a link, a description, a status), a value open is deleted from its group beside the card (or its right-click menu), **Join** types the link.

The time is chosen in its picker (a click on it: [Choosing a time](./time.md#choosing-a-time)), shown in its format with its length, and its right-click menu chooses the format.

It is at a time, so a [weekly timetable](./timetable-week.md) takes it, and a card of a card diagram holds it as any component.
