---
title: Portals
description: A doc page shown as an app of its own in the whole window, beside its documents, and switched at the top left
---

A **portal** is one way this page is shown as a whole. The documents you are reading, with their side panel, are one portal, the one every doc page has. A frontend object may provide more: an app of its own, in the whole window, drawn by a component and reading the same data as its blocks do. The design is `main/doc_page_impl_portal.md`.

Look at the **top left** of the page: where the title of the site stood there is now a control with its icon and two small arrows. It lists every portal of the workspace, a group per doc page with a line between two groups.

<!--renderComp=DiagramText-->
```text
[▤ React Doc Test ⌃⌄]
┌──────────────────────────────────────────┐
│ REACT DOC TEST                           │
│   ▤ Documents                           ✓│   what you are reading
│   ▣ Library         the list as an app…  │   provided by the object "Reading list"
│   ▣ Short library   the short list as…   │   provided by the object "Short list"
│ ──────────────────────────────────────── │
│ SECOND DOC PAGE                          │
│   ▤ Documents                            │
└──────────────────────────────────────────┘
```

## The portal of the demonstration: Library

The type `example.reading-list` declares one portal for its objects (`.doc-page/type.yaml`):

```yaml
typeList:
  - id: example.reading-list
    portalList:
      - id: library
        label: Library
        description: the list as an app of its own, its shelf and the book chosen side by side
        color: "#7a5230"
        comp: ReadingListPortal
        deviceList: [browser, desktop]
```

Every reading list provides it, and this page has two ([Frontend Objects](object-frontend.md)), so the switcher lists two libraries. They are two portals, each drawing its own list. The short list names its own differently in the `portal.yaml` of its folder:

```yaml
# .doc-page/object-frontend/w5j7pn0lh5o--Short list/portal.yaml
portalList:
  - id: library
    label: Short library
    description: the short list as an app of its own
    color: "#3b6a8c"
```

Open **Library** from the switcher. What you get is the smallest useful portal (`.doc-page/comp-mdx/object-frontend/reading-list/portal/ReadingListPortal.jsx`): it draws nothing of the list itself, it lays out two modes the type has already.

- **Its bar** holds the standard switcher at its top left, the name of the list, **Edit** (the portal's own edit mode: no document stands around it to say so) and **Documents**, the way back here.
- **The left pane** is the mode *shelf* of the list; its filter and its **Find** and **Add a book** switch that pane.
- **The right pane** is the mode *book*: a click on a title opens the book there.
- **The address** says where you are: `?portal=frontend:w5j7ozoijzl/library&at=#/book/sci-fi/dune`. Back and Forward walk the places you were at, and the address of a book is a link to it.

## From a document, from the palette, by an agent

A portal is opened by its address, which is a link like any other: `?portal=frontend:w5j7ozoijzl/library&at=#/book/sci-fi/dune` after the address of this page opens the library at Dune. The command palette (⇧⌘P) lists **Open a portal** and **Open the documents**, and an agent asks the same apis:

```text
portal/list                          every portal, which one is shown, what does not fit
portal/open { id, at? }              an app, or the documents of a doc page (docPage:{alias}/doc)
portal/docOpen                       the documents again
```

## What a deployment does with it

Which portals exist is said by the objects; how a page uses them is config (`main/doc_page_impl_portal.md`, Config): `PortalDefault` names the portal the address of the site opens, `PortalHiddenList` leaves some out (the documents among them, for a site that is one app), `PortalRankById` orders them, `PortalSwitcherIsOn: false` takes the switcher away.
