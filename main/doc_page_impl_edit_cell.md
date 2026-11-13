<!-- Design of the cell edit layer: the small values a component lets the author type in place (a cell of a table, a field of a mode of a frontend object), their tokens (a link, a view of an object, a value of the component's own data) and how they are drawn and typed. Parent document: doc_page_impl_edit.md. It is built on the slash mode (doc_page_impl_edit_slash.md), and its token kinds come from the navigation layer (doc_page_impl_nav.md), the object service layer (doc_page_impl_obj.md) and the components owning the cells, usually modes of frontend objects (doc_page_impl_obj_frontend.md). -->

# Cell Editing: Design

A **cell** is one small value a component draws and lets the author type in place: a cell of a table, a field of a form, a line of a card. Most cells belong to a mode of a [frontend object](doc_page_impl_obj_frontend.md): the remark of a book of a reading list, a cell of a CV. A document is edited block by block by the [edit layer](doc_page_impl_edit.md); a cell is one level below a block, and this layer is what every component uses for it, so that all cells of a page are typed the same way and can hold the same things.

A cell holds **text with tokens in it**. A token is something more than words that the author typed out: a link, a view of an object, a value the component reads from its own data. Each token is drawn by the layer it belongs to, and typed with the [slash mode](doc_page_impl_edit_slash.md):

```text
the text kept in the data (one string)
  read before {{/book/sci-fi/dune}} · [Guide](~example:root/guide.md) · {{@frontend:w5j7pn0lh5o}}
              └── the cell's own ──┘   └───────── a link ──────────┘   └──── an object ─────┘

read      read before Dune · Guide ↗ · ▢ Short list           every token drawn by its kind
edited    the text as kept, in the cell itself; "/" lists /book /link /object, "{{" opens a token
```

The layer stands between three parties that know nothing of each other:

```text
token kinds (what a token is)                 the cell edit layer                   the component (owns the cell)
  nav/link      navigation layer        ──►   DocCellStore                    ◄──   useCell({ tokenList, context })
  object/view   object service layer            the registry of kinds               its own kinds, over its own data
  its own       the component                   a cell: its kinds, its slash   ──►  CellValue   draws a text
                                                the open field                      CellEdit    types one
slash mode (how a token is typed)       ◄──   the slash of a cell:                  CellField   both, with saving
  DocSlashStore, EditSlashMenu                  the actions of its kinds
```

## The concepts

- A **cell** is a value typed in place, with what it needs to be drawn and typed: the token kinds it accepts and the context its own kinds read. A component asks for one cell per sort of value it draws, not per value.
- A **cell text** is the string kept in the data: plain text, with tokens. Line breaks and spaces are kept as typed; nothing else of the text is interpreted (it is not Markdown).
- A **token** is a piece of a cell text that a token kind recognizes.
- A **token kind** says three things of its tokens: how one is **written**, how it is **drawn**, how it is **typed**. A kind belongs to the layer or the component that knows what the token means.
- The **owner** of a cell is the component drawing it. It brings its own kinds, keeps the text in its data, and decides when the cell can be edited.

## Cell text

Two forms of token exist, and a kind uses one of them:

```text
{{body}}         a brace token. the body starts with the sigil of its kind:
                   {{@frontend:w5j7ozoijzl#/book/sci-fi/dune}}   sigil "@": an object (object/view)
                   {{name/jp/first}}                             no sigil: the cell's own kind
[label](target)  a pattern of the kind's own in the text: the Markdown link (nav/link)
```

- **A brace token without a sigil is the owner's.** One kind of a cell may take every brace token no other kind takes: a query of the profile in a CV, a book of the same list in a reading list. This is how the owner is **delegated to**: its tokens are the shortest to write, and typing `{{` asks it first.
- **A text is parsed against the kinds of its cell** (`cellTextParse`, `lib/doc-cell.js`), so the same text reads differently in two cells. What no kind of the cell takes stays text: `{{name}}` in a cell without an own kind is the eight characters.
- **A kind may refuse a body** (`read` answers `undefined`): `{{@not a reference}}` stays text.
- **A brace token may carry parameters** after a `|`: `{{/badge/aws/saa|size=l,name}}`. They are of this one token, how it is drawn in this place (`key=value` separated by commas, a key alone being true), and never part of what it names: the same badge is large in one row and small in another. `token.param` holds them, and `cellTokenTextBuild(token, { param })` writes the token again with a change.
- **The plain text of a cell** (`cell.textGet(text)`) replaces every token by the text its kind says (the value a query reads, the label of a link, the name of an object). A consumer that needs text uses it: a title, a comparison, pages measured and printed.

## Token kinds

A kind is defined with `cellTokenDefine` (`comp-doc/cell/cell-define.js`), beside the code of the layer it belongs to:

```text
cellTokenDefine({
  name: 'link',                           one word, unique among the kinds of a cell
  label, description,
  how it is written, one of:
    brace: { sigil: '@' }                 a brace token; sigil '': the kind taking the rest
    match(text) -> [{ start, end, data }] a pattern of its own
  read(body) -> data | undefined          a brace kind: what the body means, or not its token
  how it is drawn:
    Render({ token, cell })               a component, inline; absent: its text
    textGet(token, cell) -> string        its plain text
  how it is typed:
    slashAction                           a slash action, or (cell) => one
    isTriggerDirect                       a brace kind: its opening text enters the action at once (default true)
  how one token is changed where it is drawn:
    Card({ token, cell, tokenSet, close })   optional: its edit card (#a-token-selected-its-card)
})
token = { kind, name, raw, body, param, data, start, end }
cell  = { tokenList, context, sourcePath, owner, source, object, slash, parse(text), textGet(text) }
```

The kinds of the page are a registry, built like the [slash action registry](doc_page_impl_edit_slash.md#the-slash-action-registry) and the component registry:

| | slash action registry | cell token registry |
| --- | --- | --- |
| a definition | `slashActionDefine(options)` | `cellTokenDefine(options)` |
| the package's | `comp-doc/slash/slash-registry.js` | `comp-doc/cell/cell-registry.js` `cellTokenById` |
| the host's | `config.slashActionById` | `config.cellTokenById` (an id mapped to `null` removes one) |
| built at start, rebuilt on change | `slashActionByIdPageBuild` | `cellTokenByIdPageBuild` in `DocPageMdx` |
| held by | `DocSlashStore` | `DocCellStore.cellTokenById` |

| id | written | drawn | typed with | provided by |
| --- | --- | --- | --- | --- |
| `nav/link` | `[label](target)` | `DocLink`: resolved, routed, with its candidate list, popup and warning, as a link of a document | `/link` | navigation ([Writing a link](doc_page_impl_nav.md#writing-a-link)) |
| `object/view` | `{{@reference}}` | the view of the object's types in the context `inline` (`ObjectViewHost`) | `/object`, or `{{@` | the object service layer ([Writing a reference](doc_page_impl_obj.md#writing-a-reference)) |
| a component's own | usually `{{body}}`, or a sigil of its own (`{{/badge/aws/saa}}`) | the component's | its own action, or its opening text | the owner |

**Which kinds a cell accepts** (`cellTokenListResolve`): its own first, then the page's, all of them or those it names (`tokenIdList`). An own kind hides a page kind of its name, and only one kind takes the brace tokens without a sigil.

**The layer knows no kind by name.** A layer added later (tags, a formula) brings a kind the same way; nothing of this layer changes.

## Drawing and typing

```text
CellValue { cell, text }          the text drawn: words as they are, every token by its kind.
                                  no element of its own: the type and box of where it stands
CellEdit  { cell, text, ... }     the text typed: tokens written out, in EditSourceSurface kind "plain"
                                  (never an <input>), with the slash of the cell
```

**The slash of a cell** is built by the layer from its kinds (`DocCellStore.slashBuild`):

- **Its actions are the actions of its kinds**, the owner's first, and nothing else: the page's other actions are not offered in a cell.
- **`/` starts the slash mode anywhere but in a path or a url** (the loose rule, [The state machine](doc_page_impl_edit_slash.md#the-state-machine)). A cell is often text without spaces between its words (`{{birth/month}}月`), where the rule of documents, the start of a word, would never hold.
- **The opening text of a brace kind enters its action at once** (a direct trigger): `{{` lists what the owner's kind completes, `{{@` what `/object` lists. The author who knows what a token looks like types it and is completed; the author who does not types `/` and reads the menu. Both end with the same text.
- **Its context** is the owner's own, read live, with the page's services added: `{ ...the owner's, cell, sourcePath, docPageAlias, source, object }`. So an action of the page (`/link`, `/object`) and an action of the owner read what they need from one object.

**One page, one menu, one switch.** The slash mode of a cell is the page's (`DocSlashStore`): the same menu, keys and effects as in a paragraph, and `EditSlashToggle` turns it off for cells too.

**Nothing moves** when a cell opens ([the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)): the surface stands in the box of the value, in its type; a token drawn inside a line never makes the line taller (a chip of the registry is drawn in the scale of the line in a cell); what exists only while editing floats.

### A token selected: its card

Typing changes a text; some tokens are better changed **where they are drawn**: a badge given another size, an image replaced, a token taken out. A kind that has something to offer there defines a `Card`, and the layer does the rest:

```text
a value that can be edited (CellValue isEditable, or a CellField)
  a click on a token whose kind has a Card   selects it: a ring around it, nothing else moves
                                             the card opens to its right, its top edge at the token's
                                             (to its left, or under it, when the window has no room)
  in the card                                tokenSet({ param: { size: 'l' } })   the token written again
                                             tokenSet({ body })                   naming something else
                                             tokenSet(null)                       taken out of the text
  Escape, the close button, a click elsewhere   close the card
```

- **The click selects the token, not the value around it.** A cell that opens its text on a click still does, everywhere but on such a token; a token without a card is part of the text as before.
- **The card writes the text through the owner.** `tokenSet` builds the new text of the value (`cellTextRangeReplace`) and hands it to `onTextChange` of `CellValue` (for a `CellField`, its `onCommit`): the component saves it as it saves a typed text. What the card changes beyond the token, the thing the token names (the image of a badge, for every place showing it), is the kind's own write, through the context of the cell.
- **One token is selected on the page** (`DocCellStore.token: { key, start }`); `cellKey` of `CellValue` names the value it stands in. Opening a field clears it, since both would write the same text.
- **The card is a popup of the edit layer** (`doc-edit-popup`), floating, so a click in it is not a click outside what is being edited, and its top edge does not move while its content changes ([the edit card](doc_page_impl_mdx_comp_block.md#should-interaction-patterns-of-a-canvas)).

### A selection made a token

`CellEdit` reports what is selected in the text (`onSelectionChange({ start, end, text, isPlain })`, the last selection inside the surface staying known after the focus moved to a control beside it). `isPlain` says the selection is words only, no token in it in part or whole (`cellRangeRead`). A component uses it to let the author **turn words into a token of its own**: the words are kept in its data under a name, and replaced in the text by the token naming them (`cellTextRangeReplace`, the surface shown again with `textVersion`). The Japanese-style CV does this: words selected in a cell are kept in the profile at a path the author types, and the cell says `{{path}}` in their place.

### The field

`CellField` is `CellValue` and `CellEdit` with the opening, the saving and the leaving done, for a component that needs nothing more:

```text
CellField { cell, value, onCommit, isEditable, editUnavailableReason, isMultiline, as, placeholder, fieldKey }

a click               opens it, the caret where the click was (only while isEditable)
Enter                 saves; Shift+Enter breaks the line (isMultiline: Enter breaks, Ctrl/⌘ + Enter saves)
Escape                first closes the menu of the slash mode, then the field, the text as it was
a click elsewhere, Tab   saves
onCommit(text)        answers nothing, or { code, message }: another code than 0 keeps the field
                      open and shows the message under it
```

One field is open on the page at a time, and its state is the store's (`DocCellStore.field`: the key, the draft, the text it was opened on, the save in progress and why one was refused). An unchanged text is not handed to the component. A component with a behavior of its own around the text (a card under the cell, several fields open together, a floating surface) uses `CellValue` and `CellEdit` itself and keeps its own state, as the Japanese-style CV of the package cv does.

## Using it in a component

```jsx
// its own token kind, beside the component: what a brace token of its cells means
const bookToken = cellTokenDefine({
  name: 'book',
  brace: { sigil: '' },
  read: (body) => (body.startsWith('/') ? { path: body } : undefined),
  textGet: (token, cell) => cell.context.service.assetGet(token.data.path)?.name ?? token.data.path,
  Render: BookMention,                    // ({ token, cell }) => ...
  slashAction: bookSlashAction,           // slashActionDefine({ name: 'book', param: { ... } })
});

const Shelf = observer(function Shelf({ data, config }) {
  const service = config.objectFrontend;
  const cell = useCell({ tokenList: [bookToken], context: { service }, config });
  return (
    <CellField as="td" cell={cell} value={book.remark} isEditable={service.isEditable}
      onCommit={(text) => service.assetWrite(book.key, { ...book.data, remark: text })} />
  );
});
```

- **`useCell`** (`comp-doc/cell/use-cell.js`) answers the cell: `tokenList` its own kinds, `context` what they read, `config` the config of the component (the document it is drawn in, and for a mode the object), `tokenIdList` the kinds of the page it accepts. The context is copied into the cell on every render, so a kind drawing a token and an action listing while the author types read the component's data as it is now.
- **The owner decides when a cell is editable.** For a mode of a frontend object that is `service.isEditable`: the object can be written and the document is in edit mode ([Reading and editing](doc_page_impl_obj_frontend.md#reading-and-editing)). In reading mode a cell is drawn and its links and views work.
- **The owner keeps the text.** The layer never writes data: `onCommit` hands the text to the component, which writes it through its own api.
- **A link in a cell is written in the full form** (`~page:root/a.md`): a cell belongs to data, not to one document, and is drawn wherever a block shows its object ([Writing a link](doc_page_impl_nav.md#writing-a-link)).
- Outside a page (no stores) a cell still parses and draws its own kinds, without a slash mode.

## Finding something to write: the walk of `/object`

`/object` is the one way to write a reference to anything of the [object registry](doc_page_impl_obj.md), in a cell and in a paragraph alike. The author walks the registry as it is organized, a step per choice, and each step rewrites the parameter:

```text
/object ␣                           the types that have objects          a type chosen goes on
/object example.reading-list/       the objects of the type              an object chosen goes on
/object frontend:w5j7ozoijzl        the object itself, and the top of what is inside it
/object frontend:w5j7ozoijzl#/book/sci-     inside it, completed by the object
        └ a value chosen writes {{@frontend:w5j7ozoijzl#/book/sci-fi/dune}}
```

The last step is **delegated**: the registry asks the provider of the reference (`innerComplete`, [Inside an object](doc_page_impl_obj.md#inside-an-object)), and the frontend object service layer asks the type of the object ([Things inside an object](doc_page_impl_obj_frontend.md#things-inside-an-object-inner-paths)). A reading list answers with the paths of its books; a profile of the package cv with its partitions and query paths; a document with its sections. The head of the menu says what the parameter has reached (`Reading list › Short list › inside: /book/`), since the parameter itself holds ids.

## What the layer does not do

- It does not store, validate or version the text: the owner's data does.
- It is not a rich text editor: a cell text is one string, and a token is typed as text and drawn only when the cell is read. What a token offers beyond its text is in its card.
- It lays nothing out on pages. A component paginating its content ([Pagination](doc_page_impl_pagination.md)) draws its pieces with `CellValue` as it draws its block (the cell reaching them through its own context), so a page shows a token as the block does; a piece cut between the lines of its text is drawn from its plain text, the text those lines were measured in.
- It does not replace the edit layer for documents: an object whose content is a document (a card of a zettelkasten) registers it with the source, and it is edited block by block with every component of the page ([Documents of an object](doc_page_impl_obj_frontend.md#documents-of-an-object)). There, `/link` and `/object` come from the page's slash registry, and `/object` writes the inline form of a document.

## Files

| file | role |
| --- | --- |
| `frontend/src/lib/doc-cell.js` | the grammar: parsing a text against kinds, the plain text, the link pattern, the kinds of a cell, its direct triggers |
| `frontend/src/store/DocCellStore.ts` | the registry of kinds, a cell (its kinds, its slash, its context), the open field |
| `comp-doc/cell/cell-define.js` | `cellTokenDefine`, building the registry by layers |
| `comp-doc/cell/cell-registry.js` | the package's kinds by id |
| `comp-doc/cell/use-cell.js` | `useCell`: the cell of a component |
| `comp-doc/cell/CellValue.jsx`, `CellEdit.jsx`, `CellField.jsx`, `Cell.css` | drawing (a token selected, its card), typing (the selection reported), the field |
| `comp-doc/link/link-cell.jsx` | `nav/link`: the link in a cell |
| `comp-doc/object/object-cell.jsx`, `object-slash.js` | `object/view`: the object view in a cell; `/object` |
| `frontend/src/lib/doc-object-complete.js` | the walk of `/object`: a type, an object, inside it |
| `frontend/src/lib/doc-cell.test.js`, `doc-object-complete.test.js` | the grammar, the store, the walk |
| `example_doc/.doc-page/comp-mdx/object-frontend/reading-list/ReadingList.jsx` | the demonstration: the remark of a book, the text of a note, the list's own kind |

## Future updates

What the layer leaves for later (kinds declared by a doc page, a search by words across objects in `/object`, several fields opened together as one ready piece) is in [TODO](doc_page_impl_TODO.md#edit-cell).
