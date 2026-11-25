<!-- Design of the slash mode of the default editors, and of any surface a component offers it in (its own actions). Parent document: doc_page_impl_edit.md. The cells of a component (a cell of a table, a field of a mode of a frontend object) are typed with it through the cell editing kit, doc_page_impl_edit_cell.md. -->

# Slash Mode of the Default Editors: Design

While the source of a paragraph or a list is edited ([In-place editing](doc_page_impl_edit.md)), the author can type `/` to ask the page for help instead of typing everything by hand. A menu opens under the `/` and lists **slash actions**. Typing narrows the menu. An action that needs a **parameter** keeps the menu open while the parameter is typed: `/link guide` lists the documents that match "guide", and choosing one writes `[Guide](./guide.md)` in place of what was typed. The slash text is ordinary text of the surface the whole time. Nothing else on the page changes, and the menu floats ([the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)), in the top layer of the browser (`popover="manual"`), so it stands over a surface it is opened from that stands there itself ([Inline Tooltips and Dropdowns](doc_page_impl_popup.md#inline-tooltips-and-dropdowns)).

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
                         ├─ 'nav/link': the navigation layer's /link (comp-doc/link/link-slash.js)
                         └─ 'object/view': the object service layer's /object (comp-doc/object/object-slash.js)

DocSlashStore                       one per page: the registry, the switch, the one open slash mode
  ▲ start / update / end / keys       ▼ state
use-edit-slash.js  ◄── surface ──►  EditSlashMenu (portal)
  (binding of EditSourceSurface)       renders actions, or the items of an action
  ▼ choose -> effect
the slash text replaced through the browser's editing (the surface reports it as typed)
```

## The state machine

The slash mode has one central state, held by `DocSlashStore.slash`, for the one surface where it is open, with the actions that surface offers ([Beyond the document editors](#beyond-the-document-editors)):

```text
idle
  │  "/" typed at the start of a line or after a space (not in "and/or", not in a url)
  ▼
action mode            the slash text is "/" + a query without spaces
  │                    menu: the actions whose name, alias or label match the query
  │  Enter / Tab / click on an action with a parameter    -> the text becomes "/name ␣"
  │  "/name" typed, then a space                          -> the same
  │  Enter / Tab / click on an action without a parameter -> run(context) -> effect
  │  an action whose parameter is optional (run and param):
  │    Enter / click on its row     -> run(context): as it is, the default
  │    Tab, "/name" + a space       -> the text becomes "/name ␣"
  │    click on a choice of its row -> itemChoose(choice, '') -> effect
  ▼
param mode             the slash text is "/name " + the parameter
  │                    menu: what the action's itemListGet(param) answers
  │  Enter / Tab / click on an item -> itemChoose(item, param) -> effect
  │  a key the action takes (keyHandle)                    -> effect
  ▼
effect   replace(text)   the slash text is replaced by text; back to idle
         paramSet(text)  the parameter is rewritten; the param mode stays (a folder chosen: going on in it)
         actionSet(name, param)   the param mode of another action goes on with the parameter
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

**Where a `/` starts it.** Where no word goes on after it: at the end of its line, or before a space (or a chip of the text, a code block or a formula). What stands before it does not matter, so `aaa/` starts it as `see /` does, in a document as in a cell (`{{birth/month}}月`, text in Japanese). A `/` typed into a word (`and|or`) never starts it (`slashTriggerIs`; the surface tells the binding the character after the caret). A path or a url typed at the end of a line starts it for a moment and shows nothing: `//` ends it, and a name no action has (`/2`, `/readme.md`) lists no action, so no menu is drawn and Enter is the surface's.

**Direct triggers.** A surface may name texts that enter the param mode of one action at once, without `/` and a name (`triggerList: [{ text, action, endList }]`). The trigger text then stands where `/name ␣` stands:

```text
{{            the param mode of the trigger's action, the parameter empty
{{name/jp     the parameter is "name/jp"; a folder chosen rewrites it after the trigger text
{{@           a longer trigger of the surface takes over: the action of "{{@"
{{name}       ended: a character of the trigger's endList, two spaces in a row, a line break
```

The mode still follows from the text: the text from the first character of the trigger to the caret is parsed again after every input, the longest trigger first. The [cell editing kit](doc_page_impl_edit_cell.md#drawing-and-typing) uses them: the opening text of a brace token (`{{`, `{{@`) is a direct trigger of the action that completes it.

## Keys and pointer

While a slash mode is open, the surface offers every key to the binding first (`useEditSlash().keyDown`). The surface's own keys (Escape cancels the session, the arrows shift focus to the neighbor block, Tab indents) apply only to keys the binding did not take.

| key / pointer | menu with items | menu without items |
| --- | --- | --- |
| ArrowDown / ArrowUp | move the highlight (wraps) | the caret moves; the slash mode ends when it leaves the line |
| Enter / Tab | choose the highlighted item; on an action whose parameter is optional, Enter runs it as it is and Tab enters its param mode | a line break / the surface's Tab; the slash mode ends |
| Escape | close the slash mode only | the same |
| pointer over an item | highlight it | |
| pointer down on an item | choose it, before the surface could lose focus | |
| pointer down on a choice of a row | choose that item of the action's parameter at once | |
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
    hintGet(param, context) -> string          optional: what the parameter typed so far means, shown in the head of
                                               the menu (the names of what a reference being walked has reached)
    emptyText                                  the line shown when there is no item
  },
})

context = { sourcePath, docPageAlias, source, object,   the document edited, its doc page, the source service
            place, configValueGet }                       object, the object service layer (what /object lists
                                                          from); where a block put at the caret stands (undefined:
                                                          a block of the document, 'inListItem': the text of a list
                                                          item) and the config of the document (configValueGet(key))
effect  = slashEffect.replace(text, { isMarked }) | slashEffect.paramSet(text) | slashEffect.cancel()
        | slashEffect.actionSet(name, param)     another action of the surface goes on (below)
        | slashEffect.block(source)              a block at the caret (below)
        | slashEffect.atom(atomKind, { isRow, textFallback })
                                                 an atom of a kind at the caret (below)
```

**An optional parameter.** An action with both `run` and `param` runs as it is when it is chosen, and its parameter is there for the author who wants it: Enter (or a click on its row) runs it, Tab (or a space after its name) enters its param mode. The parameter says what it is (`param.label`, `view`), which the menu shows in the head of the param mode and in its foot ("Tab: choose the view"). An item of the parameter marked `isDefault` is what running without it does: the menu marks it `default`, lists it first, and says it in the foot ("Enter: Icon (default)"). A short list that does not depend on what is typed is drawn on the row of the action too (`param.isListedOnRow`), so a pointer chooses in one click what the keyboard reaches by Tab. Typing chooses as well: `/mdx card` and Enter.

<!--renderComp=DiagramText-->
```text
/mdx          ▤ /mdx  MDX block  a document of its…  [Icon] Card
              ↑↓ · Enter Icon (default) · Tab choose the view
  Enter       the block in its default view, none written
  click Card  the block in the view card
  Tab         /mdx ␣
              ▤ MDX block · view (optional)
                Icon  default  a tile in the line; a click opens…
                Card           the document drawn in place, in a…
  "ca" Enter  the block in the view card
```

**A block and its view.** The actions that put a block at the caret are defined with `slashBlockActionDefine({ name, …, viewList, viewDefaultGet(context), sourceBuild(view, context) })` (`slash-define.js`): `run` answers the block in its default view, and the parameter is the view, optional and listed on the row. The default is the view the block gets where the caret is (`viewDefaultGet`: a code block reads the config of its place, `context.place`), and choosing it writes no view, so the block goes on following that default; another view is written in the block. Any later kind of block that has views is added the same way.

**Going on after a part of the parameter.** An action whose parameter is a path chosen a part at a time (a folder, then what is in it) answers a folder chosen with `paramSet`: the parameter becomes the folder followed by `/`, the menu lists what is inside, and the author goes on choosing, never leaving the slash mode until a leaf is chosen and `replace` writes it. `/link ~example/`, a CV's `/query name/jp/` and `/object` (a type, then an object, then what is inside it) work so; the menu shows such an item with a folder icon (`kind: 'dir'`). An action whose parameter does not read as a path while it is walked (a reference holding an id) says what it has reached with `hintGet`. An item an action lists only to say something (why a list is empty, that it is still asked for) is chosen to no effect: `itemChoose` answers nothing.

**Something written, then gone on with.** `slashEffect.replace(text, { isMarked: true })` writes the text and asks the surface to **mark** it as one thing: a cell marks the token it is and opens its card ([A token marked in the typed text](doc_page_impl_edit_cell.md#a-token-marked-in-the-typed-text)), so that what an action has just named is worked on at once, a value typed for a path that was new. The surface decides what marking means (`textMark(start, end)` of the binding); one that marks nothing writes the text and no more, so an action never has to know where it runs.

**Another action going on.** `slashEffect.actionSet(name, param)` hands the parameter over to another action of the surface: the slash text becomes `/name param`, whatever it was entered with (a direct trigger too), and the slash mode stays open in that action's param mode. It is how one walk leads into another without the author leaving it: a command chosen inside a path ([below](#commands-inside-a-path)).

### Commands inside a path

A parameter walked as a path has **places**, and something may be done at a place beside choosing what is there: a new thing made under it. Such a **command** is typed where the next segment would start, as `/` and its name:

<!--renderComp=DiagramText-->
```text
{{work/sample-systems/            the place: what lies there is listed
{{work/sample-systems//           "/" where a segment would start: the commands of the place
                                    ⧄ /new   New value: a value that does not exist yet …
{{work/sample-systems//new        Enter: the action /new goes on with the place
/new work/sample-systems/         its param mode, the folders to go on under listed
/new work/sample-systems/motto    ＋ work/sample-systems/motto  a new value …
```

An empty segment is no part of any path, so `//` can mean nothing else, and a command needs no key of its own. The slash mode knows no command: the action lists them when `slashParamCommandRead(param)` answers (`{ base, query }`: the place, and what is typed of the name), as items of the kind `command` (`slashCommandItemListGet(commandList, query)`), and answers one chosen with an effect, usually `actionSet`. The package cv does so in the walk of a profile (`@cv-dev/cv/doc/cv-query.md#a-new-value-where-it-is-named`); `/new` there is also an action of its own, typed at the start.

**The kinds of an item** the default row draws an icon for: `dir` (a folder: choosing goes on inside it), `file`, `new` (something made by choosing it), `command`. An item of another kind has no icon, and an action drawing more brings its `ItemRender`.

Callbacks rather than a component of its own keep the parameter logic pure and testable (`/link` is `lib/doc-link-complete.js` plus four lines of definition), while the menu stays one component with one keyboard behavior. `itemListGet` is called inside an observer, so an action may read MobX stores, and its list follows them (a document added to the source appears in the list while the author types). An action whose callback throws lists nothing, and a warning names it (`[doc-slash]`), so a broken action never breaks the editor. The effects are the whole vocabulary of what an action can do to the text. A later need (open a dialog) is one more effect type, applied in one place (`slashEffectApplyGet`, `DocSlashStore.effectApply`).

**A block at the caret.** `slashEffect.block(source)` takes the slash text away and hands the source of a block to the editor of the surface, which knows what a block is in its text (`blockInsert` of the surface binding): the editor of a list item makes it a chip of the item's text ([Code blocks in the text of an item](doc_page_impl_edit_structure.md#code-blocks-in-the-text-of-an-item)); a paragraph is saved as the text before the caret, the block and the text after it, blank lines between them, and its session ends (`slashBlockTextInsert`); a surface with no such editor (the source of a whole list) gets the lines of the block typed at the caret. `/mdx` is such an action ([MDX blocks](doc_page_impl_mdx_embed.md#adding-a-block)).

**An atom at the caret.** `slashEffect.atom(atomKind, { isRow, textFallback })` takes the slash text away and asks the editor of the surface for an empty atom of that kind at the caret, in the line or on a row (`atomInsert` of the surface binding): in a paragraph and in the text of a list item it is a chip of the text, and the editor of its kind opens below it ([Atoms of a kind](doc_page_impl_edit_structure.md#atoms-of-a-kind)); a surface that types no atoms gets `textFallback` typed at the caret. `/math` is such an action ([Adding a formula](../built-in/comp-mdx/math/comp_math.md#adding-a-formula)).

## The slash action registry

The registry mirrors the [component registry](doc_page_impl.md#component-registry) part for part, so a reader who knows one knows the other:

| | component registry | slash action registry |
| --- | --- | --- |
| a definition | `compDefine(Comp, options)` | `slashActionDefine(options)` |
| the package's | `comp-doc/registry/registry.js` `compById` | `comp-doc/slash/slash-registry.js` `slashActionById` |
| the doc pages' | `data.compMountList` (`comp.yaml`) | a component's `meta.slashName` ([below](#components-in-the-slash-menu)) |
| the host's | `config.compById` | `config.slashActionById` (an id mapped to `null` removes one) |
| built at start, rebuilt on change | `compByIdBuild` in `DocPageMdx` | `slashActionByIdPageBuild` in `DocPageMdx` |
| held by | `DocStore.compById` | `DocSlashStore.slashActionById` |
| looked up by | a tag name → id (`compIdResolve`) | a typed name or alias → action (`DocSlashStore.actionGet`) |

Ids are `{layer}/{name}`, such as `nav/link`. The [unified api registry](doc_page_impl_api.md#the-registry) is the third registry built this way, with `apiDefine` and `config.apiById`. An action is defined by the service layer it belongs to, beside that layer's other code, and is listed in `slash-registry.js`; the slash mode knows no action by name. When two actions declare one name, the later in the registry wins (the host's over the package's), with a warning.

| id | name | provided by | does |
| --- | --- | --- | --- |
| `nav/link` | `/link`, `/ln` | navigation ([Writing a link](doc_page_impl_nav.md#writing-a-link)) | a Markdown link to a document of the workspace |
| `nav/inline` | `/inline`, `/popup` | navigation | the same link with `?nav=popup`: the document opens in the inline popup of the page, and is edited there in edit mode |
| `block/code` | `/code`, `/fence` | the code block ([Adding a block](doc_page_impl_mdx_code.md#adding-a-block)) | a fenced code block at the caret; its view an optional parameter (`card`, `plain`, `icon`; the default is the config's for the place) |
| `block/mdx` | `/mdx`, `/embed`, `/doc` | the MDX block ([Adding a block](doc_page_impl_mdx_embed.md#adding-a-block)) | an MDX block at the caret (`slashEffect.block`); its view an optional parameter (`icon`, `card`) |
| `text/math` | `/math`, `/latex` | the built-in component math ([Adding a formula](../built-in/comp-mdx/math/comp_math.md#adding-a-formula)) | an empty formula at the caret, its field open below it (`slashEffect.atom`); where it stands an optional parameter (in the line, the default; on a row) |
| `comp/{tag name}` | the component's `slashName` and `slashAliasList` (`/meeting-zoom-instance`, `/zoom-instance`) | a component of the page ([below](#components-in-the-slash-menu)) | a block of the component with its default source (`slashEffect.block`) |
| `object/view` | `/object`, `/obj`, `/o` | the object service layer ([Writing a reference](doc_page_impl_obj.md#writing-a-reference)) | a view of an object of the registry, found a type, an object, then what is inside it; in a document the inline form of `ObjectView` |

## Components in the slash menu

A component is in the slash menu when its metadata names it: `meta.slashName`, and other names in `meta.slashAliasList` ([Metadata](doc_page_impl_mdx_comp.md#metadata-meta)). Typing the name puts a block of the component at the caret, the text its default source gives (`expose.sourceDefaultCreate`, as the insert menu does), so a component offered there is offered here with no code of its own.

```javascript
compDefine(MeetingZoomInstance, { expose: {
  meta: { label: 'Zoom meeting instance', slashName: 'meeting-zoom-instance', slashAliasList: ['zoom-instance'] },
  sourceDefaultCreate: () => ({ lang: 'yaml', raw: 'title: Zoom meeting\nmeetingId: \npasscode: ' }),
} });
```

The actions are built from the components of the page, those of the packages included (`slashActionByIdCompBuild`, `comp-doc/slash/slash-comp.js`), and rebuilt when they change. They form a layer between the package's actions and the host's: a host's action of the same name wins. A component left out of documents (`isNotInDoc`) or whose data is only an asset item (`isAssetOnly`) is not offered, and one with no default source cancels the slash mode.

The create panel of a card diagram lists the same names: `/meeting-zoom-instance` there makes a card holding the component ([A component in a card](../package/cloud-dev-vis/doc/card-diagram-impl.md#a-component-in-a-card)).

## Which blocks offer it

The slash mode is a feature of the default edit mode, the source surface (`EditSourceSurface`). A component decides whether its blocks offer it with `meta.isEditSlashEnabled` (default `false`; [Metadata](doc_page_impl_mdx_comp.md#metadata-meta)). `DocEditBlockEditor` reads it when it opens a block in the `source` mode:

- **A component block** in `source`: its component decides.
- **Any other block**: the default editor of its kind decides. `Paragraph` and `List` declare it; `Heading` and `BlockSource` (code, table, quote, math, …) do not. In those, a `/` is usually content.
- **The frontmatter and the whole document**: never.

When the block offers it, the editor receives `config.edit.slash = { store, context }` ([the editor contract](doc_page_impl_edit.md#the-editor-contract)). `TextBlockEdit` hands it to its surface and shows the switch in its bar. A custom editor built on `EditSourceSurface` does the same by passing `slash={config.edit.slash}`.

### On and off

The switch in the editor bar (`EditSlashToggle`) turns the slash mode on and off for the whole page. Off, typing `/` is plain text. The choice is kept in the browser (`localStorage`, `doc-page-edit-slash`), and it is on by default.

<!--renderComp=DiagramText-->
```text
[☑ / menu]    on:  "/" at the start of a word opens the menu of actions
[☐ / menu]    off: "/" is a character like any other
```

It is drawn as a checkbox with its label, not as a button that is filled while on: a fill is the only sign of such a button, and in a grey theme a filled button reads as one that is greyed out and does nothing. A box with or without a check says its state in any theme, and its tooltip says what the menu is for. The label is the same in both states, so the bar keeps its width.

## Beyond the document editors

The slash mode is not tied to documents. Any surface built on `EditSourceSurface` offers it when it is handed a `slash`, and there are two ways to get one outside the block editors:

- **A cell** (a cell of a table, a field of a mode of a frontend object: any small value typed in place) goes through the [cell editing kit](doc_page_impl_edit_cell.md), which builds the slash of a cell from its token kinds: the component defines what its tokens are (`cellTokenDefine`), asks for a cell (`useCell`) and draws it with `CellValue`, `CellEdit` or `CellField`. **This is the way for every cell-level value**: the cells of a page are then typed alike and hold the same things (a link, a view of an object) beside the component's own.
- **Any other surface of a component** (a form's free text that holds no tokens, a search field with commands) asks for a slash itself with `useEditSlashConfig` (`comp-doc/slash/use-edit-slash-config.js`, exported by the package):

```js
const slash = useEditSlashConfig({
  actionList: [myAction],               // its own actions, slashActionDefine as any
  context: { info, dateNow },           // what its actions receive
  isPageActionIncluded: false,          // the page's registry (/link ...) too; default false
  triggerList: [],                      // direct triggers: [{ text, action, endList }]
});
<EditSourceSurface kind="plain" slash={slash} text={draft} onTextChange={draftSet} ... />
```

What holds for both:

- **Own actions.** A surface's actions are its own list, then the page's registry when `isPageActionIncluded` (an own action hides a page action of its name). They are kept with the open slash mode (`slashStart({ actionOwnList, isPageActionIncluded, triggerList })`), and every lookup of an open slash mode reads them (`DocSlashStore.actionByNameOpen`), so two surfaces of a page offer different actions with one store and one menu. An action over a component's data is defined beside the component and needs no registry: the component's own data comes in its context.
- **The same mode.** One switch for the page (`EditSlashToggle`, exported too, so a component's card shows it), one menu, the same keys, the same effects. A component only decides what its surface's keys mean when the slash mode does not take them: the menu's keys come first, and a key it took is `defaultPrevented` when it reaches the component.
- **A component's field.** `kind="plain"` gives the surface no look of its own (the block kinds have the typography of the page, the source kinds a monospace box): it takes the type and box of where it is, and the component styles it. `isFocusedInitial={false}` lets several surfaces open together (the fields of a row) with one focused, and `isTabInserted={false}` lets Tab move to the next field.
- **Its context is read when the menu lists**, not only when the slash mode starts: a component hands a context object it keeps current, so what the menu lists follows its data. A cell's context is kept current by `useCell`.

| surface | actions | provided by |
| --- | --- | --- |
| a paragraph or list of a document | the page's registry | the edit layer (`config.edit.slash`) |
| a cell of a component | the actions of the cell's token kinds: `/link`, `/object`, and the component's own | the [cell editing kit](doc_page_impl_edit_cell.md) (`useCell`) |
| a cell of a Japanese-style CV (package cv) | `/query`, `/q`, or `{{`: a value of the profile as `{{path}}`, a segment at a time, a version of it after `@`, a path nothing holds as a new value; `/new`: a value that does not exist yet; `/link`, `/object` | the package cv, as a token kind of its cells (one kind, two actions) |
| a remark or a note of a reading list (the demonstration) | `/book`, or `{{`: another book of the list; `/link`, `/object` | the demonstration's mode, as a token kind of its cells |

## The surface binding

`useEditSlash(elementRef, slash, { textBeforeCaretGet, charAfterCaretGet, blockInsert, atomInsert, textMark })` (`comp-doc/slash/use-edit-slash.js`) is the one place between the surface and the store (`charAfterCaretGet`: the character after the caret, `''` at the end of its line, for [where a `/` starts it](#the-state-machine); `blockInsert(source, offset)`: what the editor does with a block an action puts at the caret; `atomInsert(atomKind, isRow, offset)`: with an atom of a kind; `textMark(start, end)`: with a text an action asked to have marked once written, [above](#the-action-interface); `EditSourceSurface` takes it as `onSlashTextMark`):

```text
surface onInput  -> textReport (the draft, as before) -> inputAfter
                      open here:   slashUpdate(line of the caret, caret rect)
                      else:        "/" typed with no word going on after it, or the last character
                                   of one of its direct triggers? -> slashStart(line, column, context)
selectionchange, scroll (while open)  -> slashUpdate, or slashEnd when the surface lost focus
surface onKeyDown -> keyDown first (see Keys and pointer)
choice -> SlashApply { textNew, isEnded, lengthOld, isMarked? }
            -> select the lengthOld characters before the caret, execCommand('insertText', textNew)
            -> isMarked: textMark(where the text now stands)
```

The text is written through the browser's own editing command, as a paste is. The surface then reports the new text through its ordinary input event, so the session draft, the line mode of a list surface and the slash state all follow without a special path, and the browser's undo takes the replacement back. The slash text is always on one line, before the caret. It is usually inside the text node of the caret; otherwise the selection is extended character by character.

## The menu

`EditSlashMenu` renders the state and nothing else. It is a `.doc-popover` in `document.body`, at a fixed position under the line of the caret and aligned with the `/`. It goes above the line when the window has no room below. It uses the compact scale of the edit layer's floating controls and has one fixed width, so it does not change width while the author types.

```text
action mode                                   param mode
┌───────────────────────────────────────┐    ┌───────────────────────────────────────┐
│ ⧉ /link  Link   a link to a document… │    │ ⧉ Link   a document name or title, … │ ◄ the action; its placeholder while empty,
│                                       │    │                                       │   else what the action says the parameter means
│ ↑ ↓ Enter choose · Esc or two spaces  │    │ ▢ guide              ~example/guide   │ ◄ folders first in a path
└───────────────────────────────────────┘    │ ▤ Getting started  ~example/guide/st… │
                                             │ ↑ ↓ Enter choose · Esc or two spaces  │
                                             └───────────────────────────────────────┘
```

The row of an action whose parameter lists its choices on the row (`isListedOnRow`) ends with them, as small chips after the description: the default first, outlined, each one a target of its own; the description is cut first. The foot follows the highlighted row: on an action whose parameter is optional it says what Enter does and that Tab chooses the parameter; in such a param mode, that Backspace goes back to the actions.

In the action mode, a query that matches no action shows no menu, because the author is probably writing text that starts with `/`. In the param mode, an empty list shows the action's `emptyText`, so the author knows the parameter is being read. The head and the foot stay in place while a long list scrolls between them.

## Files

| file | role |
| --- | --- |
| `frontend/src/lib/doc-slash.js` | the grammar: trigger, slash text, mode parsing, action matching, effects; the commands of a place typed inside a path parameter |
| `frontend/src/store/DocSlashStore.ts` | the registry, the switch, the open slash mode, choosing and effects |
| `comp-doc/slash/slash-define.js` | `slashActionDefine`, building the registry by layers, the name index |
| `comp-doc/slash/slash-registry.js` | the package's actions by id |
| `comp-doc/slash/use-edit-slash.js` | the binding of a surface: caret, keys, writing the text |
| `comp-doc/slash/use-edit-slash-config.js` | `useEditSlashConfig`: the slash of a component's own surface, with its own actions |
| `comp-doc/slash/EditSlashMenu.jsx`, `EditSlashToggle.jsx`, `EditSlash.css` | the menu and the switch |
| `comp-doc/link/link-slash.js`, `frontend/src/lib/doc-link-complete.js` | `/link`: the action, its items and the link it writes |
| `comp-doc/slash/slash-comp.js` | the actions of the components of the page, from their `slashName` |
| `comp-doc/object/object-slash.js`, `frontend/src/lib/doc-object-complete.js` | `/object`: the action, the walk from a type to what is inside an object |
| `built-in/comp-mdx/math/math-slash.js` | `/math`: a formula in the line or on a row |
| `frontend/src/lib/doc-slash.test.js`, `doc-link-complete.test.js`, `doc-object-complete.test.js` | the state machine, the triggers, the store, `/link`, `/object` |
