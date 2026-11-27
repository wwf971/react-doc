# Times

Every card of oa that is at a time (an [event](./event.md), a [Zoom meeting](./meeting-zoom.md), a class of an [online course](./course-online.md)) keeps its time the same way, so that what collects times (the [weekly timetable](./timetable-week.md), a timeline later) reads them all alike. A time is said **as finely as it is known** (its granularity), and every time refers to a **range**, read conservatively: from the first moment it may mean to the last.

<!--renderComp=DiagramText-->
```text
typed (loosely)        kept in the data              shown (a format)           refers to
1125 1000 1045    ──►  2026-11-25 10:00~10:45 +09 ──► Wed 2026-11-25 10:00–10:45  10:00 – 10:45
1128 evening           2026-11-28 evening +09         Sat 2026-11-28 evening     17:00 – 22:00
11/28 3d               2026-11-28~11-30 +09           Sat 2026-11-28 – Mon 11-30 3 whole days
11月上旬                2026-11 early +09              2026-11 early              11-01 – 11-10
2026 spring            2026 spring +09                2026 spring                03-01 – 05-31
```

## Granularity

| Granularity | Kept as | Its parts (built in) | Refers to |
| --- | --- | --- | --- |
| a year | `year 2026 +09` | `2026 spring`, `2026 q3` | the whole year, or the days of its part |
| a month | `2026-11 +09` | `2026-11 early`, `mid`, `late` | the whole month, or the days of its part (`late`: to the last day) |
| a day, or several | `2026-11-28 +09`, `2026-11-28~11-30 +09` | `2026-11-28 evening`, `morning`, `noon`, `afternoon`, `night`, `daytime` | the whole days, or the hours of its part |
| a time of day | `2026-11-28 19:00~21:00 +09`, `2026-11-28 19:00 +09` | | exactly that |
| every week | `Mon +09`, `Mon evening +09`, `Mon 10:00~10:45 +09` | the parts of a day | the same, every week |

A time is always kept with its zone and shown with it. What the card shows beside a time not said exactly is its length (`3 days`); the range it refers to is on hover (`17:00–22:00`), and under the field while it is typed.

**A conservative range.** A part is placed so that what anyone may mean by its word is inside: an evening is 17:00 to 22:00, a night 19:00 to 05:00 the next morning, `late` the 21st to the last day of the month, a winter December 1 to the end of February of the next year (February 29 when there is one). Whatever collects times places one by its range and never misses it: the weekly timetable draws an evening as a box from 17:00 to 22:00 with a dashed edge, a day in its row of whole days, and refuses a month (a week cannot hold it). A part the page does not know (a time written with a page's own part, read where that part is not registered) refers to the whole of its unit.

## Parts of a day, a month, a year

The parts are not code: they are the package preference `TimePeriodMap`, a name and its place in its unit, and `TimePeriodWordMap`, other words typed for them. A doc page (or the workspace, a document, the reader in the settings panel: **Component** › **oa (package)**) adds its own, changes one, or takes one away (`null`), and keeps all the others: the maps are merged entry by entry across the levels of the config ([Package-level config](../../../main/doc_page_impl_config.md#package-level-config)).

```yaml
config:
  packageConfig:
    oa:
      TimePeriodMap:
        lunch: day 11:30~14:00        # a part of a day: its hours (an end before the start: the next day)
        payday: month 25~25           # a part of a month: its days (no end: to the last day)
        fy: year 04-01~03-31          # a part of a year: its days (an end before the start: the next year)
        q4: null                      # taken away
      TimePeriodWordMap:
        昼休み: lunch                  # another word typed for it; the time is kept with its name
```

| Built in | Place |
| --- | --- |
| `morning`, `noon`, `afternoon`, `evening`, `night`, `daytime` | `day 05:00~12:00`, `day 11:00~14:00`, `day 12:00~18:00`, `day 17:00~22:00`, `day 19:00~05:00`, `day 08:00~18:00` |
| `early`, `mid`, `late` | `month 1~10`, `month 11~20`, `month 21~` |
| `spring`, `summer`, `autumn`, `winter` | `year 03-01~05-31`, `year 06-01~08-31`, `year 09-01~11-30`, `year 12-01~02-29` |
| `q1` … `q4` | the quarters |
| other words | 朝, 午前中 (morning), 昼, midday (noon), 午後 (afternoon), 夕方 (evening), 夜 (night), 日中 (daytime), 上旬, 中旬, 下旬, 春, 夏, 秋, fall, 冬 |

A name is one word (letters of any script, then letters, digits, `_`, `-`); a place that cannot be read is left out, and the settings panel says so. A part's unit decides what it is typed with: a part of a day with a day (or alone: of the day the time had), a part of a month with a month, a part of a year with a year.

## Choosing a time

Click the time of a card while it is edited (or **Choose a time** where it has none): the **picker** opens under it (`comp-mdx/time/OaTimePicker.jsx`). A time is chosen there, never only typed: what is chosen is always a time, so nothing can be refused or lost.

| Granularity (the switch at its top) | Chosen with |
| --- | --- |
| **Time of day** | the day on the calendar (its weeks from the first day of the week of the [preferences](#preferences)); the start and the end among the times of the day, every 5 minutes (a menu with a search: type `19` to find 19:00), or a length (15 min … 2 h) |
| **Part of a day** | the day on the calendar; the part among the parts of the page, each with the range it refers to (morning 06:00–12:00, evening 17:00–22:00, …) |
| **Days** | a range on the calendar: a click on the first day, a click on the last |
| **Month** | the year stepped, the month in a grid of twelve; a part of it (early, mid, late, …) or the whole month |
| **Year** | the year stepped; a part of it (spring, …, q4) or the whole year |

**Every week** (under the calendar) keeps a time of day or a part of a day on the day of the week of the day chosen, with no date. The zone is chosen beside it (whole hours, and the half hours in use). The line at the foot says the time as the card will write it; **Save** keeps it (as does a click outside the picker), **Cancel** or Escape leaves the time as it was, **Remove** takes it away.

### Typing it, as a short way

The line at the bottom of the picker reads a time typed, for those who know the way: Enter puts what it is read as into the picker (the calendar, the times, the part), to be seen before it is kept; Enter again (or Save) keeps it. No colon and no tilde are needed: digits are read as the parts of a time, in order. A text that cannot be read is said under the line and nothing changes: the picker stays where it was.

| Typed | Read as |
| --- | --- |
| `1125 1000 1045` | November 25 (this year, or the year the time had), 10:00 to 10:45 |
| `1000 1045`, `10 1045`, `10-11` | a time of day, on the day the time had (today for a new one) |
| `930 45m`, `930 1h30`, `2pm 3:30pm` | a start and a length; 12 hours |
| `1100` | the start moved to 11:00, the length kept |
| `1128 evening`, `sat night`, `11月28日夕方` | a part of a day |
| `evening` | the same day, its evening |
| `11/28`, `20261128` | another day, what it had of a day kept (its time of day, its part) |
| `11/28 all day`, `11/28 終日` | the whole day |
| `11/28~11/30`, `11/28 3d`, `1128 week` | several days; `week`: the week of the day, from its first day ([preferences](#preferences)) |
| `2026-11`, `nov`, `11月` | a month |
| `11月上旬`, `nov late`, `2026-11 early` | a part of a month |
| `2026 spring`, `year 2026`, `2026年` | a year, a part of it (four digits alone are a time of day: `2026` is 20:26) |
| `fri 14`, `mon evening` | that day of the week of the day the time had; with no day to keep, every week |
| `… +0530`, `… utc` | in that zone; without one, the zone the time had, else the browser's |
| what a card shows | the same time: every format reads back |

A time written by hand in the yaml of a block and that cannot be read is kept as written, and the card shows it with a mark saying why (hover it).

## Formats

A card writes its time in a **layout** and a **clock**. Its own (`timeFormat`, `timeClock` in its data: the right-click menu of its time while it is edited, or its edit card in a card diagram), else the [preferences](#preferences) of the package.

| `timeFormat` | a time of day | a part of a day | several days | a part of a month |
| --- | --- | --- | --- | --- |
| `full` (the default) | Wed 2026-11-25 10:00–10:45 +09 | Sat 2026-11-28 evening +09 | Sat 2026-11-28 – Mon 11-30 +09 | 2026-11 early +09 |
| `short` | Wed 11-25 10:00–10:45 +09 | Sat 11-28 evening +09 | Sat 11-28 – Mon 11-30 +09 | 2026-11 early +09 |
| `long` | Wednesday, November 25, 2026, 10:00–10:45 +09 | Saturday, November 28, 2026, evening +09 | Saturday, November 28 – Monday, November 30, 2026 +09 | early November 2026 +09 |
| `clock` | 10:00–10:45 +09 | evening +09 | (as full) | (as full) |

With `timeClock: 12h` a time of day is written 10:00–10:45 AM.

<!--renderComp=MeetingZoomReservation-->
```yaml
title: Design review
time: 2026-11-26 13:30~14:15 +09
timeFormat: long
timeClock: 12h
```

<!--renderComp=EventGeneral-->
```yaml
title: Year-end party
time: 2026-12 late +09
place: to be decided
```

<!--renderComp=EventGeneral-->
```yaml
title: Off-site
time: 2026-11-28~11-30 +09
people: [Team A]
```

## Kept in one form

Whatever was typed and however it is shown, the data holds one form, which a person can read and a program can parse:

```yaml
time: 2026-11-25 10:00~10:45 +09   # a time of day: a start, an end
time: 2026-11-25 23:00~01:00 +09   # ends on the next day
time: 2026-11-28 evening +09       # a part of a day
time: 2026-11-28~11-30 +09         # several days (2026-12-30~2027-01-02 across a year)
time: 2026-11 early +09            # a part of a month
time: year 2026 +09                # a year
time: Mon evening +09              # every Monday evening
```

## Preferences

The package has preferences of its own, a [package-level config](../../../main/doc_page_impl_config.md#package-level-config) group named `oa`, set in any config declaration of the page:

```yaml
config:
  packageConfig:
    oa:
      TimeClock: 12h          # 24h (default) or 12h
      TimeFormat: short       # full (default), short, long, clock: a card naming none
      TimeWeekStart: sunday   # monday (default) ... sunday: the first column of a timetable, what "week" covers
      TimePeriodMap: {...}    # the parts (above)
      TimePeriodWordMap: {...}
```

Every component of the package that writes a time is handed them (`config.packageConfig`); another package reads them through the config service (`packageConfigGet('oa', docPath)`). An app drawing the cards without a doc page gets the defaults.

## A card at a time

A component tells whoever collects times when its block is through one exposure, `expose.timeItem`, the same for every card of the package (`oaTimeItemOf`, `comp-mdx/oa-card/oa-card-data.js`):

```js
timeItem: {
  spanGet(data)        // its span (comp-mdx/time/oa-time.js), or null: { granularity, date, dateEnd, weekday, period, start, end, zone }
  spanSet(data, span)  // its yaml with another span: what a timetable writes when the card is moved
  titleGet(data)       // what it is called in a list of times
}
```

Whoever reads a span reads its range with `oaTimeRangeOf(span, periods)` and the page's parts (`oaTimePeriodsOf(preference)`, `comp-mdx/time/oa-config.js`), never its fields one by one: a range is the one meaning of a time at any granularity. A component of another package is at a time the same way: it exposes `timeItem` with spans of `oa-time.js`, and the timetable takes it. The design of the module is in `comp-mdx/time/oa-time.js` (the span, its granularity, the parts, the range, the stored form, the parser, the formats) and `comp-mdx/time/oa-config.js` (the preferences). The standards behind it: [Standards of oa](./standards.md).
