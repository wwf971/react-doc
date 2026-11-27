# oa: office automation

Components for the affairs of daily life and of an office, each a block of a document, and each one a card of a [card diagram](../../cloud-dev-vis/doc/card-diagram-usage.md#a-component-in-a-card) can hold. They describe things one way, set down in the [Standards of oa](./standards.md): what a thing is (an event and its special types), when (a time at its granularity, read as a conservative range), what state it is in (the history of its changes), who and where.

| Component | What it is | Typed after `/` |
| --- | --- | --- |
| [EventGeneral](./event.md) | an event: what, when, who, where, and its status kept as a history of changes | `/event` |
| [MeetingZoomReservation](./meeting-zoom.md#a-reservation) | a Zoom meeting at a time, an event of a special type: what, when, who, the link joining it, its status | `/meeting-zoom-reservation`, `/zoom-reservation` |
| [MeetingZoomInstance](./meeting-zoom.md#an-instance) | a Zoom meeting joined by its number and passcode, at any time or at one; an event of a special type, with its status | `/meeting-zoom-instance`, `/zoom-instance` |
| [CourseOnlineReservation](./course-online.md) | a class of an online course at a time, an event of a special type: the course, when, who gives it, its link, its status | `/course-online-reservation`, `/online-course` |
| [TimetableWeek](./timetable-week.md) | seven days of hours holding the cards at a time, each where its time is | `/timetable-week`, `/timetable` |

The cards at a time keep their time one way, at the granularity it is known (a day, an evening, early November), chosen in a picker (a calendar, the times of a day, the parts of a day, a month, a year) and shown in a format of the reader's choosing, with the preferences of the package (12 or 24 hours, the first day of a week, the parts of a day, a month, a year): [Times](./time.md). The events (an event, and its special types) keep their status as the history of its changes, each at a moment with its zone: [Events](./event.md#its-status).

## How a card is made

Every card shares one look and one way of being edited (`comp-mdx/oa-card/`): `OaCard.jsx` draws a tile with the mark of the kind, the title with **Join**, the lines of the kind, the description; `OaCardEdit.jsx` is the edit mode **Fields**, every value created, changed and removed on the card itself ([Editability](../../../main/doc_page_impl_edit.md#editability-everything-a-reader-sees-is-edited-where-it-stands)); `oa-card-data.js` reads and writes the data of a **kind** (its fields, in yaml) and offers it to the page (`expose.dataFields`, `expose.timeItem`); `oa-card-define.js` registers a card. A new card is a kind (its fields), a component drawing its lines, and one `oaCardDefine` call; a component that should be found in the slash menu says the word typed for it (`meta.slashName`, [Components in the slash menu](../../../main/doc_page_impl_edit_slash.md#components-in-the-slash-menu)).

- **One face.** Everything a card says is in the sans-serif of the page: the title, a time, a meeting number, a passcode, a link being typed. Figures that should line up are tabular digits (`font-variant-numeric: tabular-nums`), never a monospace face, which belongs to code alone ([Typography](../../../AGENTS.md#typography)).
- **Sized in em.** A card takes `--doc-card-font-size` when a card of a diagram holds it (`font-size: var(--doc-card-font-size, 0.875em)`), so in a diagram it is as large as the cards around it.
- **Nothing moves** as a card enters its edit mode, **and nothing covers its words**: the **+** of the values not written yet, the group of a value open (beside the card), the picker of a time, the field of a link and every menu float outside or under what they belong to.
- **Chosen, not typed**: a time is set in its picker, the people are entries of their own, each removed from its group. How a card is designed for the canvas, and what the first version of these cards did wrong: [Designing for card diagrams](../../../main/diagram-design-design.md).

The timetable (`comp-mdx/timetable/`) is a component holding others: it keeps the blocks of the cards in its data and draws each with its own component ([A component holding others](../../../main/doc_page_impl_mdx_comp.md#a-component-holding-others)).
