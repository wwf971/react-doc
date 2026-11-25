<!-- Design of portals: the ways a doc page is shown as a whole (its documents, or an app of its own drawn by a component of a frontend object), the registry of them, the switcher, the host, the address. Parent document: doc_page_impl.md. A portal is provided by a frontend object (doc_page_impl_obj_frontend.md), declared in a type file (doc_page_impl_type.md) or in the folder of the object, and drawn by a component of the registry (doc_page_impl_mdx_comp.md). -->

# Portals: Design

A doc page holds more than documents: its frontend objects keep a small system each (the papers of a person, a reading list, a migration), with modes to work on it. Placed in a document, a mode is a block among text. A **portal** shows the same system **as an app of its own, in the whole window**: no side panel, no document around it, a layout made for the work. The documents themselves are one portal among them, the one every doc page has, so a page with portals is one thing shown several ways, switched at its top left.

<!--renderComp=DiagramText-->
```text
who provides                         the registry                          who shows
┌──────────────────────────┐        ┌───────────────────────────┐        ┌──────────────────────────┐
│ every doc page           │        │ DocPortalStore            │        │ PortalSwitcher           │
│   its documents ("doc")  │──────► │   portalList, by doc page │──────► │   top left: the portal   │
│ a frontend object        │        │   portalIdOpen, at        │        │   current, the others    │
│   portalList of its type │──────► │   isEditing               │        │ PortalHost               │
│   portal.yaml of its own │        │                           │──────► │   the component of the   │
│ code: register(portal)   │──────► │   ◄── the address         │        │   portal, in the window  │
└──────────────────────────┘        │       ?portal=…&at=…      │        │ the documents (as before)│
                                    └───────────────────────────┘        └──────────────────────────┘
```

It is native to a doc page and a workspace: nothing is built or launched for it, a portal exists because an object says so, and it is there wherever the page is, in the development server, in a static build and on a host that serves one. An app with a window and a backend of its own is another thing ([Desktop apps on react-doc](doc_page_impl_desktop.md)); a portal is the page itself in another look, and reads and writes the objects through the same apis as a block does.

## The concepts

- A **portal** is one way a doc page is shown as a whole. It has a **name** in its provider (`archive`), a **label** for people, a **description**, an **icon** drawn at any size, and a **component** that draws it.
- The **documents** are the portal every doc page has: its side panel and its documents, as the page always was. Its name is `doc`, and no declaration makes it.
- A **provider** is who a portal belongs to: a doc page (for its documents), or a **frontend object**, which provides the apps. One object may provide several portals, and several objects may provide a portal of the same name: each is a portal of its own.
- A **portal id** names one portal on the page: its provider and its name, `frontend:w5j7ozoijzl/library`, `docPage:example/doc`.
- The **component of a portal** is a component of the registry that says it can draw one (`expose.portal`). The same component may draw the portals of many objects, and a component may also be a mode or anything else: being able to draw a portal is one more thing it exposes.
- The **place** inside a portal is where the reader is in the app, in the app's own words (`/example/cv/general`). The page keeps it in the address beside the portal, so a place of an app is a link.
- The **registry** is the list of the portals of the page, built from what registers them; the **switcher** lists it, the **host** draws the one that is open.

## Who is the truth of what

| what | its truth | read by |
| --- | --- | --- |
| which portals a type gives its objects | `portalList` of the type, in a type file | the type registry, with the configuration of the page |
| what one object adds, adjusts or leaves out | `portal.yaml` in the folder of the object | the development server, sent with the declarations of the objects |
| which portals the page has | nothing kept: the registry is worked out from the two above, the doc pages and what code registered | `DocPortalStore.portalList` |
| which portal is shown, and the place inside it | the address of the page (`?portal=…&at=…`); in a page embedded without an address, the store | the store, at start and on every step of the history |
| what a portal shows | the objects, through their apis; the component keeps only what its look adds | the component |

## Declaring a portal

A portal is declared where the modes of an object are, by the rule of every declaration of the page (in yaml, in a file of its own): for **every object of a type** in the type file, for **one object** in its folder.

```yaml
# a type file (.doc-page/type.yaml, type.yaml of a package or beside object.yaml): every object of the type provides these
typeList:
  - id: example.reading-list
    portalList:
      - id: library                 # its name in its provider: letters, digits, "_" and "-"; "doc" is the documents'
        label: Library              # absent: the id
        description: the list as an app of its own, its shelf and the book chosen side by side
        icon: book                  # a name of the page's icon set; absent: the icon its component exposes
        color: "#7a5230"            # the ground of its icon tile; absent: a color worked out of its id
        comp: ReadingListPortal     # the component drawing it: a tag name or an id, one exposing "portal"
        param: { density: compact } # what the component starts with (data.param)
        deviceList: [browser, desktop]   # what it is made for; absent: any
```

```yaml
# .doc-page/object-frontend/{id}--{name}/portal.yaml: what this object provides
portalList:
  - { id: library, label: Short library, color: "#3b6a8c" }   # a portal of its type, adjusted: a key written here wins,
                                                               #   "param" is merged a key at a time
  - { id: room, isDisabled: true }                             # a portal of its type this object does not provide
  - { id: desk, label: Desk, comp: ReadingListDesk }           # a portal only this object has: it names its component
```

- **A type's portals are inherited** as its modes are: its own, then its ancestors' in the order of the type registry, an id declared nearer hiding the same id farther up (`portalDeclareListResolve`). A type declaring portals is below `frontend.object` without saying so.
- **The object decides last.** `portal.yaml` travels with the folder of the object, like its `type.yaml`: an object copied into another doc page provides there what it provided here. A file changed, added or removed is read again without a reload, as the other files of an object are.
- **The device words are a stipulation, not a limit**: `browser` (a window of a desktop browser), `mobile` (a phone), `desktop` (the window of a desktop app). The switcher marks a portal made for another device than the window is; nothing refuses to open it. A word of one's own is kept, and told.
- **What is wrong leaves out that portal, never the page**: an id that is none, `doc`, an id twice, a type's portal naming no component, a portal of an object that names none while its type has none of that id. The problems are those of the type file (the Frontend objects tab) and of the doc page; a portal whose component the page has not, or one that does not expose `portal`, stays listed and says so where it is opened (`portal/list` answers it as `problem`).

**Two objects, one portal.** An object provides what its type declares, so two reading lists are two libraries. They are two portals (`frontend:w5j7ozoijzl/library`, `frontend:w5j7pn0lh5o/library`), each drawing its own object, and the switcher tells them apart by the object: where two portals of a doc page share a label, each says its provider after it (`Library · Reading list`). One that should read differently is given its own label in its `portal.yaml`.

**Registered by code.** A host, or anything running in the page, registers a whole portal with `portalStore.register({ id: '{provider}/{name}', label, comp, docPageAlias, … })` and takes it out with what that answers. It is listed like any other; what it draws is its component's own business, since no frontend object stands behind it.

## The component of a portal

```js
compDefine(ReadingListPortal, {
  placementList: ['portal'],
  expose: {
    meta: { label: 'Reading list: the portal Library', isNotInDoc: true },
    icon: ReadingListPortalIcon,                       // drawn where a declaration names no icon
    portal: { deviceList: ['browser', 'desktop'], switcherPlace: 'own' },   // or true: every default
  },
});
```

`expose.portal` is a standard name of the exposure ([What a component exposes](doc_page_impl_mdx_comp.md#what-a-component-exposes)), checked at registration: `deviceList` (what it is made for, when its declarations do not say), `switcherPlace` (below), and any key of its own. The host renders the component through the registry boundary in the placement **`portal`**, so one that throws while it draws fails alone, with the way back to the documents beside it.

```text
data.ref, data.portalId, data.param      who provides it, which portal it is, its parameters
config.portal                            the portal and the page around it (getters: the component is an observer)
  id, portal                             its id; itself as the registry lists it ({ label, description, docPageAlias, … })
  at, atSet(at, { historyMode })         the place inside it, in its own words; written into the address
                                         (a step of the history, or 'replace')
  hrefGet(at)                            the address of a place of it, for a link
  isEditing, editSet(isEditing)          its own reading and editing, as a document has (below)
  docState                               the same as an object's api takes it: handed on to what it draws
  portalList, groupList, open(id, { at })   the other portals; another one opened
  docOpen(target?)                       the documents: of its doc page, or a document named (a route, a
                                         source path, a link)
  device                                 browser | mobile | desktop: what the window is
  isSwitcherOffered                      whether the page offers the switcher (there are other portals)
config.objectFrontend                    the api of the object providing it, as a mode has it
                                         (doc_page_impl_obj_frontend.md#the-entry-component), without a block
```

- **The address is the truth of where the reader is.** A component keeps the place it shows in `at` and reads it back from there, so Back and Forward work, a place is sent as a link, and a reload opens it. What only its look adds (a width, a camera) is its own state.
- **A portal has its own reading and editing.** No document stands around it, so the portal says whether its objects are changed: `editSet(true)` is its Edit switch. `config.objectFrontend.isEditable` follows it (the object writable, and the portal editing), exactly as it follows the edit mode of a document for a block ([Reading and editing](doc_page_impl_obj_frontend.md#reading-and-editing)).
- **It draws the modes of its object, it does not rebuild them.** `ObjectFrontendMode { object, mode, param, docState, onBlockChange }` draws a mode of any frontend object where no document is ([A mode outside a document](doc_page_impl_obj_frontend.md#a-mode-outside-a-document)): a paper on its sheet inside an app is the mode that draws it in a document, cells, cards and pages included. A mode asking to switch its block is answered by the portal (`onBlockChange`), which makes of it what an app does: usually another place.
- **Everything of the page is still there**: its stores (`useDocStores`), the shared parts ([Reuse before building](../AGENTS.md#reuse-before-building-the-shared-parts-of-the-page)), the dialogs of the page over the portal (the settings panel, the command palette, a `PanelPopup` it opens). A portal brings a look, not a second page.
- **Separate folders.** The components of a portal lie in a group of their own in the component folder (`comp-mdx/…/portal/`, with its `comp.yaml`), apart from the modes; what several portals of a package share, apart from each look ([The components of a doc page](doc_page_impl_mdx_comp.md#components-of-a-doc-page)).

## The switcher

`PortalSwitcher` is the standard control of portals: a button with the icon and the name of the portal current, and under it a panel listing every portal of the page.

<!--renderComp=DiagramText-->
```text
[▣ Library ⌃⌄]
┌──────────────────────────────────────────┐
│ ⌕ Find a portal                          │   from PortalSearchCountMin portals on (8)
│ REACT DOC TEST                           │   a group per doc page; its title when there are several
│   ▤ Documents                            │   the documents of that doc page: its first
│   ▣ Library         the list as an app… ✓│   the portal current
│   ▣ Short library   the short list as…   │
│ ──────────────────────────────────────── │   a line between the portals of two doc pages
│ SECOND DOC PAGE                          │
│   ▤ Documents                            │
└──────────────────────────────────────────┘
```

- **Where it stands.** In the documents, in the place of the title of the site, at the top left of the side panel (`variant="title"`: the title of the site, as it always stood there, with a small chevron saying it opens; the documents need no icon there). In a portal of its own, where its component puts it: `switcherPlace: 'own'` says the component draws `<PortalSwitcher />` in a bar of its own (recommended: at its top left); `'floating'`, the default, has the host draw it over the app at the top left (`variant="floating"`), so a portal that says nothing has it; `'none'` has none. A portal without a switcher is still left by the address, by the command palette (`portal/open`, `portal/docOpen`) and by what its component offers (`config.portal.docOpen`).
- **A page with one portal shows none**: its title is as it always was. The switcher appears with the second portal, and `PortalSwitcherIsOn: false` takes it away for a page.
- **A row is a link** (`portalStore.hrefGet`): a click opens the portal in place, a click with a modifier in a tab of its own. ↑ ↓ move, Enter opens, Esc and a pointer going down elsewhere close.
- **The field finds by name**: every word typed, in any order, in the label, the description, the provider or the doc page (`portalSearch`). It is shown from `PortalSearchCountMin` portals on; below that the list is short enough to read.
- **Order.** By doc page, in the order the workspace has them; in a doc page the documents first, then the ranked portals (`PortalRankById`, [ranks](doc_page_impl_config.md#ranks)), then the others as provided.
- **A portal made for another device** than the window is marked with what it is made for, and opens all the same.

### The icon

`PortalIcon { portal, size }` draws the icon of a portal from one number: a line drawing on a rounded tile, the drawing 58% of the tile and its corner 26% of it, so it reads at 16px in a row and at 96px on a card. The drawing is the icon the declaration names (a name of the page's icon set), else the icon its component exposes (`expose.icon`, itself a drawing at any size, [Icons](doc_page_impl_mdx_comp.md#icons)), else a window. The tile is the color the declaration names, else a color worked out of the portal's id, so two portals differ at a glance and a portal keeps its color wherever it is listed; the documents have the quiet tile of the page itself.

## The host

While a portal of its own is open, `PortalHost` stands in the place of the documents: the whole window is the portal's, and the host adds only the floating switcher for a component that draws none.

<!--renderComp=DiagramText-->
```text
DocPageMdx
├── DocsShell
│     portalIdOpen ''     the documents: the layout with its side panel, the switcher in the place of its title
│     portalIdOpen '…'    PortalHost: the component of that portal, in the window
└── the dialogs of the page      the settings panel, the command palette, the popups: over either
```

| the portal | the host shows |
| --- | --- |
| is known, its component can draw it | the component |
| is not known yet, while the objects are still read | *Opening the portal…* |
| is not known | *No portal of this page is named …*, and **Open the documents** |
| names a component the page has not, or one not exposing `portal` | why, and **Open the documents** |

The page is never left blank, and never trapped: the note has the switcher too when there are other portals.

## The address

```text
?doc=/__doc-item/doc-0-1#setup                                   the documents, a document, a place in it
?portal=frontend:w5j7ozoijzl/library                             a portal
?portal=frontend:w5j7ozoijzl/library&at=#/book/sci-fi/dune       a place inside it, in the portal's own words
```

- **A portal's address names no document, a document's names no portal** (`portalLocationSearchBuild`, `DocStore.toBrowserHref`): each is whole, so a link is one or the other.
- **Opening a portal is a step of the history**, and so is a place inside it (`atSet`; `historyMode: 'replace'` for a change that is none, a filter typed). Back leaves the place, then the portal, then the document before it.
- **A navigation of the documents shows the documents.** A link to a document followed inside an app (in a cell of a paper, from the command palette) closes the portal and opens that document: an app never has to know about documents to be left by one.
- **What the page opens with.** The portal the address names; else, where the address names no document either, the portal of `PortalDefault`; else the documents. This is how a deployment is fronted by a portal: the address of the site opens the app, and a link to a document still opens the document.
- **A page embedded without an address** (`routeMode: 'memory'`) keeps the portal and its place in the store only.

## Config

Portals are declared by the objects, never by the config: what the config says is how the page uses them ([Config system](doc_page_impl_config.md)).

| Key | Scope | Default | Meaning |
| --- | --- | --- | --- |
| `PortalDefault` | page | not set | The portal the page opens when its address names neither a portal nor a document: a portal id. Not set: the documents. |
| `PortalSwitcherIsOn` | page | `true` | Show the switcher (at the top left of the documents, and floating over a portal that draws none) while the page has more than one portal. |
| `PortalSearchCountMin` | page | `8` | From how many portals on the switcher has its field. |
| `PortalHiddenList` | page | `[]` | Portal ids left out of the page: neither listed nor opened by the switcher. `docPage:{alias}/doc` hides the documents of a doc page. |
| `PortalRankById` | page | `{}` | The rank of the portals of a doc page in the switcher, by portal id; merged entry by entry. |

## A portal on a host

A portal is the **forward face of a doc page**: what a deployment shows to whoever uses the app, with the documents behind it. Nothing of it depends on the development server.

- **A static build has its portals**: the declarations travel with the page (the types in the configuration, the `portal.yaml` of each object in the snapshot of the assets), the registry is built in the browser, and the address works from a file or a web server alike.
- **What a portal can write on a host is what its objects can**: a partition a remote storage point holds is read and written by the page itself, signed in ([Where a partition is stored](doc_page_impl_obj_frontend.md#where-a-partition-is-stored)); a partition in the folders of the doc page is read only there. The portal asks its object (`isWritable`, `partitionWriteUnavailableReasonGet`), never the environment.
- **A deployment that is one app** sets `PortalDefault` to it and, when the documents are not for its readers, hides them with `PortalHiddenList`; the page then has one portal, no switcher, and the address of the site is the app.

## The apis

| api | |
| --- | --- |
| `portal/list` | every portal of the page (`id`, `label`, `docPageAlias`, `providerRef`, `comp`, `deviceList`, `problem`), which one is shown, the place inside it, what does not fit |
| `portal/open { id, at? }` | shows a portal: an app, or the documents of a doc page (`docPage:{alias}/doc`) |
| `portal/docOpen` | the documents again, where a portal of its own is shown |

The command palette and an agent switch portals with them ([Unified api registry](doc_page_impl_api.md)), also out of a portal that offers no switcher.

## The demonstration

The reading lists of `example_doc` provide the portal **Library** (`.doc-page/type.yaml`, `portalList` of `example.reading-list`): the smallest useful portal, which draws nothing of the list itself. It lays out two modes the type has already, the shelf and the book chosen, side by side (`ObjectFrontendMode`), keeps what is shown in its place (`find?status=want#/book/sci-fi/dune`), and has an Edit switch and a way to the documents in its bar. The page has two reading lists, so two libraries; the short list names its own in its `portal.yaml`. `example_doc/portal.md` shows them.

The package cv provides two portals over one state, in two looks (`@cv-dev/cv/doc/cv-portal.md`): a desk in Material UI and an archive room in 3D.

## Files

```text
frontend/src/lib/doc-portal.js             the pure part: ids, a declaration read, the portals of a type and of an object,
                                           the registry built, groups, the search, the address, devices
frontend/src/lib/doc-portal.test.js
frontend/plugin/doc-type-config.ts         portalList of a type (the grammar of the type files)
frontend/plugin/doc-object-frontend.ts     portal.yaml of an object's folder: read, watched, sent with the declarations
frontend/src/store/DocObjectFrontendStore.ts   portalListOfTypeGet, portalProvide: what the objects provide
frontend/src/store/DocPortalStore.ts       the registry of the page, the portal shown, its place, its editing, the
                                           address, the switcher's state, config.portal of a component
frontend/src/store/DocStore.ts             routeOfDocPageGet, compFind; the address of a document names no portal
frontend/src/DocPageMdx.jsx                the store among the stores; DocsShell: the documents or the host
comp-doc/portal/PortalSwitcher.jsx         the switcher: the button, the panel, the keys
comp-doc/portal/PortalHost.jsx             the host: the component of the portal, the notes, the floating switcher
comp-doc/portal/PortalIcon.jsx             the icon at any size
comp-doc/portal/Portal.css
comp-doc/object-frontend/ObjectFrontendMode.jsx   a mode of an object drawn where no document is
comp-doc/registry/comp-expose.js           expose.portal, compPortalGet
comp-doc/api/api-portal.js                 portal/list, portal/open, portal/docOpen
frontend/src/lib/doc-config-define.js      the keys Portal…
example_doc/.doc-page/comp-mdx/object-frontend/reading-list/portal/   the demonstration's portal Library
example_doc/portal.md                      the demonstration
```

## Future updates

What is left for later (a Portals table in the settings panel, a portal as an object of the registry, a page of launch tiles, portals of service instances) is in [TODO](doc_page_impl_TODO.md#portal).
