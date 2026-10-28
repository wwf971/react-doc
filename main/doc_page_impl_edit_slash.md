<!-- Design of the slash mode of the default editors. Parent document: doc_page_impl_edit.md. -->

# Slash Mode of the Default Editors: Design

While the source of a paragraph or a list is edited ([In-place editing](doc_page_impl_edit.md)), the author can type `/` to ask the page for help instead of typing everything by hand. A menu opens under the `/` and lists **slash actions**. Typing narrows the menu. An action that needs a **parameter** keeps the menu open while the parameter is typed: `/link guide` lists the documents that match "guide", and choosing one writes `[Guide](./guide.md)` in place of what was typed. The slash text is ordinary text of the surface the whole time. Nothing else on the page changes, and the menu floats ([the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)).

```text
see /             the menu lists every action             /link   Link    a link to a document …
see /li           narrowed to the actions matching "li"   /link   Link
see /link ␣       the param mode of /link                 ▤ Getting started   ~example/guide/start.md
see /link setup   the documents matching "setup"          ▤ Setup             ~sub:sub-doc/setup.md
  Enter           the chosen document replaces the slash text:
see [Setup](./setup.md)
```

The work is split in two:

- **The slash mode** is central. It decides when a slash text starts and ends, lists actions, moves the highlight, takes keys and clicks, and applies what an action answers.
- **Each action** decides only what its parameter means. It lists the items for the parameter typed so far and answers what choosing one does, using a small set of standard **effects**.

The actions come from a **registry**. It is built the same way as the component registry.

```text
DocPageMdx (start)
  ├─ compById         = package registry.js  + doc pages' components + host config.compById
  └─ slashActionById  = package slash-registry.js               + host config.slashActionById
                         └─ 'nav/link': the navigation layer's /link (comp-doc/link/link-slash.js)

DocSlashStore                       one per page: the registry, the switch, the one open slash mode
  ▲ start / update / end / keys       ▼ state
use-edit-slash.js  ◄── surface ──►  EditSlashMenu (portal)
  (binding of EditSourceSurface)       renders actions, or the items of an action
  ▼ choose -> effect
the slash text replaced through the browser's editing (the surface reports it as typed)
```

## The state machine

The slash mode has one central state, held by `DocSlashStore.slash`, for the one surface where it is open:

```text
idle
  │  "/" typed at the start of a line or after a space (not in "and/or", not in a url)
  ▼
action mode            the slash text is "/" + a query without spaces
  │                    menu: the actions whose name, alias or label match the query
  │  Enter / Tab / click on an action with a parameter    -> the text becomes "/name ␣"
  │  "/name" typed, then a space                          -> the same
  │  Enter / Tab / click on an action without a parameter -> run(context) -> effect
  ▼
param mode             the slash text is "/name " + the parameter
  │                    menu: what the action's itemListGet(param) answers
  │  Enter / Tab / click on an item -> itemChoose(item, param) -> effect
  │  a key the action takes (keyHandle)                    -> effect
  ▼
effect   replace(text)   the slash text is replaced by text; back to idle
         paramSet(text)  the parameter is rewritten; the param mode stays
         cancel()        back to idle; the text stays as typed

back to idle, the text kept as typed:
  Escape (only the slash mode closes; the block stays in edit mode)
  two spaces in a row        a space after an unknown name
  the caret leaves the slash text (another line, before the "/", a click elsewhere)
  the surface loses focus    the switch turned off
```

**The mode follows from the text.** The store keeps only where the `/` was typed: the line, and the column on that line. After every input and every move of the caret, it reads the text from the `/` to the caret and parses it again (`slashTextParse`, `lib/doc-slash.js`). The text decides the mode:

- `/li` is the action mode with the query `li`.
- `/link ␣a.md` is the param mode of `link`.
- `/lin ␣x` has ended, because no action is named `lin`.

Typing, deleting, pasting and undoing therefore all lead to the right state without the slash mode tracking them one by one. Deleting the space after `/link` goes back to the action mode. Deleting the `/` ends the slash mode. A slash mode that has ended starts again only when a new `/` is typed, so moving the caret back into old text never reopens it.

**Why two spaces end it.** A parameter may contain one space (`/link getting started`), so a single space cannot mean "stop". Two spaces in a row never belong to a parameter, so they say that the author went back to writing. Escape does the same from the keyboard without typing anything. The first Escape closes the menu only; a second Escape cancels the block's edit session as usual.

## Keys and pointer

While a slash mode is open, the surface offers every key to the binding first (`useEditSlash().keyDown`). The surface's own keys (Escape cancels the session, the arrows shift focus to the neighbor block, Tab indents) apply only to keys the binding did not take.

| key / pointer | menu with items | menu without items |
| --- | --- | --- |
| ArrowDown / ArrowUp | move the highlight (wraps) | the caret moves; the slash mode ends when it leaves the line |
| Enter / Tab | choose the highlighted item | a line break / the surface's Tab; the slash mode ends |
| Escape | close the slash mode only | the same |
| pointer over an item | highlight it | |
| pointer down on an item | choose it, before the surface could lose focus | |
| a key the action takes (`keyHandle`) | the action's effect | the same |

A click on the menu does not take the focus from the surface (the menu prevents the pointer down), and the menu carries the edit layer's popup class `doc-edit-popup`. A click on it is therefore not a click outside the block ([use-edit-outside-pointer.js](doc_page_impl_edit.md#floating-controls)), and the session stays open.

## The action interface

An action is defined with `slashActionDefine` (`comp-doc/slash/slash-define.js`). An action with a parameter hands the param mode a few callbacks. The slash mode calls them; the action never sees the surface, the caret or the keys it did not ask for:

```text
slashActionDefine({
  name: 'link', aliasList: ['ln'],             typed after "/"; one word each
  label, description, icon,                    how the menu shows it
  run(context) -> effect                       an action without a parameter
  param: {                                     an action with a parameter
    placeholder                                shown while the parameter is empty
    itemListGet(param, context) -> items       the items for the parameter so far: { id, label, detail?, kind?, … }
    itemChoose(item, param, context) -> effect Enter, Tab, or a click on an item
    keyHandle(event, { param, item, context }) -> effect | undefined    optional: keys of its own
    ItemRender({ item, isActive, param })      optional: draws one item (default: icon by kind, label, detail)
    emptyText                                  the line shown when there is no item
  },
})

context = { sourcePath, docPageAlias, source }  the document edited, its doc page, the source service object
effect  = slashEffect.replace(text) | slashEffect.paramSet(text) | slashEffect.cancel()
```

Callbacks rather than a component of its own keep the parameter logic pure and testable (`/link` is `lib/doc-link-complete.js` plus four lines of definition), while the menu stays one component with one keyboard behavior. `itemListGet` is called inside an observer, so an action may read MobX stores, and its list follows them (a document added to the source appears in the list while the author types). An action whose callback throws lists nothing, and a warning names it (`[doc-slash]`), so a broken action never breaks the editor. The effects are the whole vocabulary of what an action can do to the text. A later need (insert a block, open a dialog) is one more effect type, applied in one place (`slashEffectApplyGet`, `DocSlashStore.effectApply`).

## The slash action registry

The registry mirrors the [component registry](doc_page_impl.md#component-registry) part for part, so a reader who knows one knows the other:

| | component registry | slash action registry |
| --- | --- | --- |
| a definition | `compDefine(Comp, options)` | `slashActionDefine(options)` |
| the package's | `comp-doc/registry/registry.js` `compById` | `comp-doc/slash/slash-registry.js` `slashActionById` |
| the doc pages' | `data.compMountList` (`comp.yaml`) | none yet |
| the host's | `config.compById` | `config.slashActionById` (an id mapped to `null` removes one) |
| built at start, rebuilt on change | `compByIdBuild` in `DocPageMdx` | `slashActionByIdPageBuild` in `DocPageMdx` |
| held by | `DocStore.compById` | `DocSlashStore.slashActionById` |
| looked up by | a tag name → id (`compIdResolve`) | a typed name or alias → action (`DocSlashStore.actionGet`) |

Ids are `{layer}/{name}`, such as `nav/link`. An action is defined by the service layer it belongs to, beside that layer's other code, and is listed in `slash-registry.js`; the slash mode knows no action by name. When two actions declare one name, the later in the registry wins (the host's over the package's), with a warning.

| id | name | provided by | does |
| --- | --- | --- | --- |
| `nav/link` | `/link`, `/ln` | navigation ([Writing a link](doc_page_impl_nav.md#writing-a-link)) | a Markdown link to a document of the workspace |

## Which blocks offer it

The slash mode is a feature of the default edit mode, the source surface (`EditSourceSurface`). A component decides whether its blocks offer it with `meta.isEditSlashEnabled` (default `false`; [Metadata](doc_page_impl_mdx_comp.md#metadata-meta)). `DocEditBlockEditor` reads it when it opens a block in the `source` mode:

- **A component block** in `source`: its component decides.
- **Any other block**: the default editor of its kind decides. `Paragraph` and `List` declare it; `Heading` and `BlockSource` (code, table, quote, math, …) do not. In those, a `/` is usually content.
- **The frontmatter and the whole document**: never.

When the block offers it, the editor receives `config.edit.slash = { store, context }` ([the editor contract](doc_page_impl_edit.md#the-editor-contract)). `TextBlockEdit` hands it to its surface and shows the switch in its bar. A custom editor built on `EditSourceSurface` does the same by passing `slash={config.edit.slash}`.

### On and off

The switch in the editor bar (`EditSlashToggle`, `[/ Slash]`, highlighted when on) turns the slash mode on and off for the whole page. Off, typing `/` is plain text. The choice is kept in the browser (`localStorage`, `doc-page-edit-slash`), and it is on by default. The button keeps its width in both states, so the bar does not move.

## The surface binding

`useEditSlash(elementRef, slash, { textBeforeCaretGet })` (`comp-doc/slash/use-edit-slash.js`) is the one place between the surface and the store:

```text
surface onInput  -> textReport (the draft, as before) -> inputAfter
                      open here:   slashUpdate(line of the caret, caret rect)
                      else:        "/" typed at a word start? -> slashStart(line, column, context)
selectionchange, scroll (while open)  -> slashUpdate, or slashEnd when the surface lost focus
surface onKeyDown -> keyDown first (see Keys and pointer)
choice -> SlashApply { textNew, isEnded, lengthOld }
            -> select the lengthOld characters before the caret, execCommand('insertText', textNew)
```

The text is written through the browser's own editing command, as a paste is. The surface then reports the new text through its ordinary input event, so the session draft, the line mode of a list surface and the slash state all follow without a special path, and the browser's undo takes the replacement back. The slash text is always on one line, before the caret. It is usually inside the text node of the caret; otherwise the selection is extended character by character.

## The menu

`EditSlashMenu` renders the state and nothing else. It is a `.doc-popover` in `document.body`, at a fixed position under the line of the caret and aligned with the `/`. It goes above the line when the window has no room below. It uses the compact scale of the edit layer's floating controls and has one fixed width, so it does not change width while the author types.

```text
action mode                                   param mode
┌───────────────────────────────────────┐    ┌───────────────────────────────────────┐
│ ⧉ /link  Link   a link to a document… │    │ ⧉ Link   a document name or title, … │ ◄ the action, its hint while empty
│ ↑ ↓ Enter choose · Esc or two spaces  │    │ ▢ guide              ~example/guide   │ ◄ folders first in a path
└───────────────────────────────────────┘    │ ▤ Getting started  ~example/guide/st… │
                                             │ ↑ ↓ Enter choose · Esc or two spaces  │
                                             └───────────────────────────────────────┘
```

In the action mode, a query that matches no action shows no menu, because the author is probably writing text that starts with `/`. In the param mode, an empty list shows the action's `emptyText`, so the author knows the parameter is being read.

## Files

| file | role |
| --- | --- |
| `frontend/src/lib/doc-slash.js` | the grammar: trigger, slash text, mode parsing, action matching, effects |
| `frontend/src/store/DocSlashStore.ts` | the registry, the switch, the open slash mode, choosing and effects |
| `comp-doc/slash/slash-define.js` | `slashActionDefine`, building the registry by layers, the name index |
| `comp-doc/slash/slash-registry.js` | the package's actions by id |
| `comp-doc/slash/use-edit-slash.js` | the binding of a surface: caret, keys, writing the text |
| `comp-doc/slash/EditSlashMenu.jsx`, `EditSlashToggle.jsx`, `EditSlash.css` | the menu and the switch |
| `comp-doc/link/link-slash.js`, `frontend/src/lib/doc-link-complete.js` | `/link`: the action, its items and the link it writes |
| `frontend/src/lib/doc-slash.test.js`, `doc-link-complete.test.js` | the state machine, the store, and `/link` |
