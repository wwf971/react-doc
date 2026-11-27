# Designing for card diagrams

Read this before designing an **MDX component, an edit mode, or a card kind that may be drawn in a viewport of a card diagram**: a component held by a card (`card-comp`), a node holding others, a card opened from a holder (the entries of a timetable), and the apps drawing the same framework (zatelier-drawboard, db-migration-tool). Almost every component of a package ends up in one of these, so in practice: read it before designing any component that is edited.

It states what good design is here, why, which shared part gives it, and, for each point, **a counter-example**. The counter-examples are real: they are the first oa cards (the Zoom meeting cards, `package/oa/comp-mdx/oa-card/`), built by an agent (Claude) in 2026-11 and rejected by the user. They are kept so the same mistakes are not made again. The positive reference is the cards of cloud-dev-vis (`TableCard`, `CardCell`, `CardToolbar` in `package/cloud-dev-vis/comp-mdx/card-diagram/`), which were designed for the canvas from the start.

The rules of editing everywhere still apply and come first: [Editability](./doc_page_impl_edit.md#editability-everything-a-reader-sees-is-edited-where-it-stands), the [no-jitter rule](./doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule), [Typography](../AGENTS.md#typography), [Reuse before building](../AGENTS.md#reuse-before-building-the-shared-parts-of-the-page). This document is about what a canvas adds to them.

## What is different on a canvas

A component designed for a page of text meets these on a canvas, and each one breaks something that worked in a document:

| On a canvas | What it breaks |
| --- | --- |
| **A drag on a card moves the card.** | Selecting words in a field, dragging a slider, drawing a range. |
| **A card's box cuts what is beyond it** (the body of a card holding a component has `overflow: hidden`). | A toolbar or a popover positioned outside the card with CSS: it is cut, and the canvas under it takes the click. |
| **The canvas is zoomed.** The card's text is small (0.64rem) and shrinks further when zoomed out. | Controls sized like the content: unreadable when zoomed out, huge relative to the card when zoomed in. |
| **Many cards are seen at once, close to each other.** | Controls drawn on every card at once; anything floating above or below a card lands on its neighbour. |
| **A canvas inside a card.** React Flow reads the handles of a node from everything inside it. | A diagram drawn live in a card would give the card the handles of its own cards: a component drawing a canvas of React Flow declares `meta.isFlowCanvas` and is held as a tile, its canvas in a dialog. |
| **Several hosts draw the same component**: a block of a document (a session, a bar with Save), a card of a diagram (in place, written at once), a card in a popover of a holder, an app with no document store. | Something that works in the host it was tried in and not in another. |

## Principles

### 1. A drag means one thing at each place

On the words of a value being typed, a drag **selects words**; on a control (a button, a picker), it does nothing; anywhere else on the card, it **moves the card**. React Flow reads this from the classes `nodrag nopan` on the element under the pointer: put them on every field while it is open, on every popover and toolbar of the card, and on every control.

*Reference:* `TableCard` read marks every row `nodrag nopan`, so a drag in a row selects its text while a drag on the title line pans the canvas; edited, every cell is a control marked `nodrag nopan` (`CardCell`).

> **Counter-example.** The first Zoom card's fields had no `nodrag`: selecting the words of a field being typed moved the whole card across the canvas. Text could not be selected at all.

### 2. A structured value is chosen, not typed

A value with a structure (a time, a date, a range, a choice, a number with a unit, a reference to something) is **chosen with a control made for it**: a calendar, the times of a day in steps, the lengths most often used, the parts of a day, a menu of the choices. A wrong value is then impossible by construction, rather than typed and reported. Typing may be offered as a shortcut **beside** the control, never as the only way.

*Parts:* `DateView` (calendar: one day, a range, several days) and `SegmentedControl` of react-comp-misc, `ValueMenu` of cloud-dev-vis (a searchable menu of values), chips for a few choices. *Reference:* `CardCell` draws an enum as a `ValueMenu`; the oa time picker (`package/oa/comp-mdx/time/OaTimePicker.jsx`).

> **Counter-example.** The first oa cards took a time as free text with a clever parser (`fri 14`, `1125 1000 1045`, no colon, no tilde). The user had to know the grammar; a typed weekday that did not match the date was refused with an error message; a text that could not be read was answered with "Read as no time: the value goes" — the value was dropped. The week of a timetable was typed as a date as well. A parser is no substitute for a picker: the user called it a poor design, and it was.

### 3. Every entry is a thing of its own

A list of values (people, tags, steps) is drawn as **one item per entry** (a chip, a row), and each entry is changed, inserted beside and removed **on itself**. A list is never one text with separators to type.

*Reference:* the rows of a `TableCard`: a focused row has its `CardToolbar` (a grip, insert before / after, move, remove).

> **Counter-example.** People were typed as one text, `Sato, Tanaka`, kept as a list behind the scenes. Removing one person meant retyping the line; inserting one in the middle had no control at all.

### 4. Removing is seen where the value is

What removes a value is **in the group of the value while it is open** (a Delete button beside it), not only in a right-click menu. The right-click menu is a second way, for those who know it.

> **Counter-example.** A value of the first Zoom card could be removed only by emptying it or from its right-click menu. The user looked for a way to remove an entry and found none.

### 5. What floats never covers the words of the card

Everything that exists only for editing floats, so nothing moves (the no-jitter rule). But floating **over the card's own words** hides what the author is working on. Place it outside:

| What floats | Where |
| --- | --- |
| The group of one value open (Delete, insert before / after) | **outside the card, at its left edge, level with the value**: `AnchoredPopover` with `placement="beside"` and `besideRef` the card |
| What is for the card as a whole (its `+` adding a value) | **in the row over the card's top edge** that the card holding the component gives (`DocEditBlockFloatContext`: after the card's own group, on one line, so the two never overlap); where no host gives one, over the card's top edge at its right end (`placement="over-end"`); in a block of a document, in the bar of the block (`EditFloatingPanel` `head`) |
| A picker, a field of a value with no place of its own (a link behind Join) | under the thing it belongs to, in the top layer (`AnchoredPopover`) |
| A menu | where it was opened; it may cover the card while open (it is gone after one choice) |

*Reference:* the group of a card holding a component (`.doc-card-comp-over`: the component chooser and the edit modes over the card's top edge, at the size of the screen).

> **Counter-example.** The first oa card put its `+` in its bottom-right corner, over the card: at the size of the screen on a zoomed-out canvas it covered "1 h" of one card and Join of another. The group of a value open was then put over the end of the value, where it covered the line above it. Then it was put outside the card with CSS, where the card's box cut it and the canvas under it took every click.

### 6. A frame is drawn inside the box it marks

What marks a value (hovered, open, selected) is drawn **inside its own box**: a tint of the background, an inset line (`box-shadow: inset`). It takes no room and never reaches the value above or below. Never an `outline` outside the box in a card this tight, never a dashed frame per value at rest.

> **Counter-example.** The fields of the first oa card were framed by the cell kit's outline outside their box: the dashed frame of a hovered line and the solid frame of an open one crossed each other and the title. The user called it very ugly; it was the most visible sign that the card had never been looked at on a canvas.

### 7. The canvas shows the controls of the card being worked with

A canvas holding many cards does not draw every card's controls at once. What is for a card as a whole is shown **the whole time on the card selected** (a host holding several gives `config.edit.isSelected`), and on another card **while it is worked with** (the pointer on it, a value of it open). It is never shown *only* on hover: a control seen only on hover is not found ([Editability](./doc_page_impl_edit.md#editability-everything-a-reader-sees-is-edited-where-it-stands)). A card alone (in a block, in a popover of a holder) shows it the whole time.

> **Counter-example.** The first oa cards drew a faint `+` on every card of the canvas at once. Five cards, five buttons at the size of the screen, each over its card. The first fix made it hover-only, which the rules of editing had already rejected.

### 8. Controls at the size of the screen, content at the size of the card

The content of a card is sized in `em` from `--doc-card-font-size` (the size of the cards around it), so it scales with the canvas. A control (a toolbar, a picker, a menu) is at the size of the screen whatever the zoom: in the top layer (`AnchoredPopover`, `DocMenu`), or scaled by `calc(1 / var(--doc-vis-zoom, 1))` when it stays in the card's DOM.

### 9. Nothing moves when editing starts

The card read and the card edited are **one layout**: a value open keeps the box of the value as read; a value added takes room only once it is set; a button standing for a value (the time) has the box of the text it replaces. *Reference:* `TableCard` keeps one grid for reading and editing, and `CardCell` keeps the height of the read view.

### 10. One face

Every value is in the sans-serif of the page, figures in tabular digits; monospace is for code alone ([Typography](../AGENTS.md#typography)).

> **Counter-example.** The first Zoom card drew its meeting number, passcode and times in a monospace face. The user asked why.

### 11. It works in every host, and was looked at in every host

The same component is drawn in a block of a document (a session: a draft, Save and Cancel in the bar), a card of a diagram (in place: each change written at once; selected or not; zoomed out), a card in a popover of a holder (a timetable's entry), and an app with no document store. A design is done when it was **looked at** in each, the way the user looks at it: selected, with the pointer elsewhere, zoomed out, at the narrowest width, every control for adding seen.

> **Counter-example.** The value toolbars of the first oa cards appeared in a diagram and never in a block of a document: whether a field was open was read in a function the card's `Render` called, where nothing observed it, and in the diagram something else happened to draw the card again. It looked finished because it was tried in one host only. (Read observable state in the observer that draws with it: `OaCardEdit` reads the key of the open field through a `computed`.)

## Why the first oa cards were poor

Not for want of rules: Editability, the no-jitter rule and Typography were all written before them. The causes were in the way of working, and they are the ones to watch for:

- **The data model got the care, the interaction did not.** Time granularity, ranges, a parser with no colon were designed elaborately; how a person picks a time on a small card on a canvas was not designed at all.
- **The canvas was treated as a page.** The card was built as a block of a document and then dropped into a diagram, where dragging, clipping, zoom and neighbours each broke something.
- **Function was verified, not looks.** Tests and scripted checks said the values were saved; nobody looked at the card the way the user does until the user did.
- **Rules were followed to the letter.** "A `+` seen the whole time" was met by a `+` over every card; "nothing moves" by floating everything over the words.
- **The reference was not studied.** The cards of cloud-dev-vis already solved most of this (rows with `nodrag`, a toolbar per focused row, menus for choices, one layout for reading and editing) and were not read first.

## Checklist

Before calling a component that a card diagram may hold done:

- [ ] A drag in a field being typed selects words; a drag elsewhere on the card moves it (`nodrag nopan` on fields open, controls, popovers).
- [ ] No structured value is only typed: times, dates, ranges and choices have a picker or a menu.
- [ ] Every entry of a list is an item with its own insert and remove.
- [ ] A value open shows how to remove it, beside it.
- [ ] Nothing floating covers the words of the card: the group of a value outside the left edge, the card's `+` in the row over its top edge, pickers under their value.
- [ ] Frames are inset; nothing is drawn outside a value's box but the floating groups.
- [ ] On a canvas of several cards, the controls of the card selected are seen the whole time, others' while worked with; none on every card at once.
- [ ] Controls keep the size of the screen at 50% and 200% zoom.
- [ ] Entering edit mode moves nothing.
- [ ] Every value is in the page's sans-serif.
- [ ] Looked at, with screenshots, in a block of a document, a card of a diagram (selected and not, zoomed out), a popover of a holder, and an app host.
