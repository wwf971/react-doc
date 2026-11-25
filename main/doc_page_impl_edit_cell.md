<!-- Design of the cell editing kit: the small values a component lets the author type in place (a cell of a table, a field of a mode of a frontend object), their tokens (a link, a view of an object, a value of the component's own data), the styles of their words (bold, a color, a size) and how they are drawn and typed. Parent document: doc_page_impl_edit.md. It is built on the slash mode (doc_page_impl_edit_slash.md), and its token kinds come from the navigation layer (doc_page_impl_nav.md), the object service layer (doc_page_impl_obj.md) and the components owning the cells, usually modes of frontend objects (doc_page_impl_obj_frontend.md). -->

# Cell Editing Kit: Design

A **cell** is one small value a component draws and lets the author type in place: a cell of a table, a field of a form, a line of a card. Most cells belong to a mode of a [frontend object](doc_page_impl_obj_frontend.md): the remark of a book of a reading list, a cell of a CV. A document is edited block by block by the [edit layer](doc_page_impl_edit.md); a cell is one level below a block, and the **cell editing kit** is what every component uses for it: the registry of token kinds, `useCell` for a cell, and the components drawing and typing it (`CellValue`, `CellEdit`, `CellField`), so that all cells of a page are typed the same way and can hold the same things. It is a kit, not a layer of its own: a component picks up what it needs, and the layers of the page (navigation, objects) bring their token kinds to it.

A cell holds **text with tokens in it**. A token is something more than words that the author typed out: a link, a view of an object, a value the component reads from its own data. Each token is drawn by the layer it belongs to, and typed with the [slash mode](doc_page_impl_edit_slash.md). The words between the tokens may be drawn in **styles** (bold, a color, a size), set on the words selected:

```text
the text kept in the data (one string)
  [[read first|b]], then {{/book/sci-fi/dune}} · [Guide](~example:root/guide.md) · {{@frontend:w5j7pn0lh5o}}
  └ styled words ┘       └── the cell's own ──┘   └───────── a link ──────────┘   └──── an object ─────┘

read      read first, then Dune · Guide ↗ · ▢ Short list     words in their styles, every token drawn by its kind
edited    in the cell itself: words in their styles, tokens written out. "/" lists /book /link /object,
          "{{" opens a token, words selected have the bar of their styles under them
```

The kit stands between three parties that know nothing of each other:

```text
token kinds (what a token is)                 the cell editing kit                  the component (owns the cell)
  nav/link      navigation layer        ──►   DocCellStore                    ◄──   useCell({ tokenList, context })
  object/view   object service layer            the registry of kinds               its own kinds, over its own data
  its own       the component                   a cell: its kinds, its slash   ──►  CellValue   draws a text
                                                the open field                      CellEdit    types one
slash mode (how a token is typed)       ◄──   the slash of a cell:                  CellField   both, with saving
  DocSlashStore, EditSlashMenu                  the actions of its kinds
style kinds (how words are drawn)       ──►   the styles of a cell: read, drawn,
  text/b, text/color, …  the package            set on a selection, typed in
  its own       the component
```

## The concepts

- A **cell** is a value typed in place, with what it needs to be drawn and typed: the token kinds it accepts and the context its own kinds read. A component asks for one cell per sort of value it draws, not per value.
- A **cell text** is the string kept in the data: plain text, with tokens, and with styled segments. Line breaks and spaces are kept as typed; nothing else of the text is interpreted (it is not Markdown).
- A **token** is a piece of a cell text that a token kind recognizes.
- A **token kind** says three things of its tokens: how one is **written**, how it is **drawn**, how it is **typed**. A kind belongs to the layer or the component that knows what the token means.
- A **styled segment** is a stretch of words drawn in one style: `[[words|b,color=#c0392b]]`. A **style** is a set of keys (`b`, `color=…`), and a **style kind** says what one key draws and how the author chooses it ([Styles](#styles)).
- The **bare text** of a cell text is the text without the markup of its segments: its words and its tokens as written. Every offset of the kit counts in it (the start of a token, a selection), so the markup is seen by nothing but the functions reading and writing it.
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
- **The plain text of a cell** (`cell.textGet(text)`) replaces every token by the text its kind says (the value a query reads, the label of a link, the name of an object), and holds no markup of a style. A consumer that needs text uses it: a title, a comparison, pages measured and printed.

### Styles

Words are drawn in a style by writing them as a **styled segment**, where they stand:

```text
[[words|spec]]   words   what is read. a backslash before one of \ [ ] | writes that character
                 spec    how the words are drawn, written as the parameters of a brace token are:
                         key=value separated by commas, a key alone being true
                           [[強み|b]]   [[注意|b,color=#c0392b]]   [[小さく|size=85%,font=serif]]
[[words|]]       no style: the words as they are. how words that would read as a segment are kept
                 (the kit writes it, nobody types it)
```

It mirrors a token: `{{body|param}}` is something more than words, and how it is drawn here; `[[words|param]]` is words, and how they are drawn here. Only a text that says a spec after the `|` is a segment (`[[Page|Some Label]]` and `[[x]]` stay words), and a key no style kind of the cell knows is kept as written and draws nothing, so a text styled by a component is not damaged where that component is not.

**Kept as a string, worked on as segments.** The text stays one string in the owner's data: every owner keeps and saves a string already, a text without styles is unchanged, and a text can be read, compared and written by hand (in a yaml, in the raw mode of a cell). What the kit works on is the **model** of the text, a list of segments covering it in order (`lib/doc-cell-style.js`):

```text
text      {{name/jp/first}} は [[強み|b,color=#c0392b]] です
segList   [{ text: '{{name/jp/first}} は ', style: {} },
           { text: '強み', style: { b: true, color: '#c0392b' } },
           { text: ' です', style: {} }]
bare      {{name/jp/first}} は 強み です
```

Setting a style, typing, cutting and joining are changes of the segments; the string is read into them (`cellStyleSegListRead`) and written from them (`cellStyleTextWrite`), in one place. Two rules keep the model simple, and the writer holds them (`cellStyleSegListNormalize`):

- **A segment is flat, and neighbours of one style are one segment.** A style over a part of a segment of another style cuts it: the part reached has both, the rest keeps its own (`cellStyleRangeChange`). Taking a style away joins what it had cut.
- **A segment holds no token and no line break.** A token is never drawn in a style: words styled around tokens are a segment on each side of each token, each with the style. A line break ends a segment and the next line starts another, so a text cut into its lines (the lines of a block of a CV) is lines that each read alone.

A token whose text is itself kept with styles (a value of a profile, typed in a cell of its own) is drawn in them where the token is drawn, and its plain text holds no markup.

| a text as kept, by the offsets of its bare text | |
| --- | --- |
| `cell.parse(text)` | its parts: words (`style` on those of a segment), tokens |
| `cell.bareGet(text)`, `cellStyleTextBareGet` | its bare text |
| `cellTextRangeReplace(text, start, end, replacement)` | a part replaced (a token written again, words made a token), its styles kept whole |
| `cellTextSlice(text, start, end)`, `cellTextConcat(…)` | a part of it as a text of its own; texts joined |

A package's data modules and their node tests import these without the page, as `@wwf971/react-doc/cell-text`.

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
    Render({ token, cell, contextVersion })   a component, inline; absent: its text. contextVersion: another
                                          number after the context of the cell changed (#using-it-in-a-component)
    textGet(token, cell) -> string        its plain text
  how it is typed:
    slashAction                           a slash action, or (cell) => one
    isTriggerDirect                       a brace kind: its opening text enters the action at once (default true)
  how one token is shown and changed where it is:
    Card({ token, cell, tokenSet, close, widthSet, where })   optional: its card (#the-card-of-a-token), drawn
                                          beside a token selected where it is drawn (where 'value') and
                                          under a token marked in the typed text (where 'surface')
    cardPlaceList                         where the card is offered: ['value', 'surface'] (default both)
})
token = { kind, name, raw, body, param, data, start, end }
cell  = { tokenList, context, contextVersionGet(), contextTouch(), sourcePath, owner, source, object, slash,
          isStyled, styleList, styleCssGet(style), parse(text), tokenParse(bare text), bareGet(text), textGet(text) }
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

**The kit knows no kind by name.** A layer added later (tags, a formula) brings a kind the same way; nothing of the kit changes.

## Style kinds

A style kind is one thing that can be said of how words are drawn. It is one key of a spec, defined with `cellStyleDefine` (`comp-doc/cell/cell-style-define.js`):

```text
cellStyleDefine({
  name: 'b',                              the key it is written with, one word
  label, description,
  type: 'flag' | 'value',                 a key alone, on or off (b) | a key with a value (color=#c0392b)
  css: { fontWeight: 700 }                a flag: the css its words are drawn with
       (value) => ({ color: value })      a value: that css, or undefined for a value that is none of its
  how it is chosen:
    Icon, shortcut: 'b'                   a flag: its button in the bar, the key toggling it with Ctrl/⌘
    optionList: [{ value, label, swatch }]   a value: what the bar offers (swatch: a color drawn as a tile)
    valueCheck(value) -> '' | why not     a value: one may be typed by hand, and is checked
})
```

The kinds are a registry beside the token kinds, built the same way: the package's (`comp-doc/cell/cell-style-registry.js` `cellStyleById`), the host's over them (`config.cellStyleById`, an id mapped to `null` removing one), held by `DocCellStore.cellStyleById`. A cell accepts all of them or those it names (`styleIdList`), and brings its own (`styleList`): **a look a component names** for its cells (`[[(a classic)|aside]]`: a flag without an icon, offered under "Styles" in the bar), which is how a style of any css is added without a key per property.

| id | written | drawn |
| --- | --- | --- |
| `text/b` `text/i` `text/u` `text/s` | `b` `i` `u` `s` | bold, italic, a line under the words, a line through them |
| `text/color` `text/bg` | `color=#c0392b` `bg=#fff3bf` | the color of the words, the color under them (a highlight) |
| `text/size` | `size=120%` `size=10.5pt` | their size, of the text around them or of its own |
| `text/font` | `font=serif` `font=Noto Serif JP` | their font: `sans`, `serif`, `mono`, or a family by its name |

**A cell says whether its words take styles** (`useCell({ isStyled })`, true by default). A value that is no prose (a key, a path, a value of a config) says no: its text is words and tokens only, and `[[a|b]]` in it is those characters.

## Drawing and typing

```text
CellValue { cell, text }          the text drawn: words as they are, every token by its kind, the words
                                  of a styled segment in an element of their own (span.doc-cell-seg).
                                  no other element: the type and box of where it stands
CellEdit  { cell, text, ... }     the text typed: tokens written out, words in their styles, in
                                  EditSourceSurface kind "plain" (never an <input>), with the slash of the cell
```

**The slash of a cell** is built by the kit from its kinds (`DocCellStore.slashBuild`):

- **Its actions are the actions of its kinds**, the owner's first, and nothing else: the page's other actions are not offered in a cell.
- **`/` starts the slash mode wherever no word goes on after it**, whatever stands before it, as in a document ([The state machine](doc_page_impl_edit_slash.md#the-state-machine)). A cell is often text without spaces between its words (`{{birth/month}}月`), where a rule asking for a space before the `/` would never hold.
- **The opening text of a brace kind enters its action at once** (a direct trigger): `{{` lists what the owner's kind completes, `{{@` what `/object` lists. The author who knows what a token looks like types it and is completed; the author who does not types `/` and reads the menu. Both end with the same text.
- **Its context** is the owner's own, read live, with the page's services added: `{ ...the owner's, cell, sourcePath, docPageAlias, source, object }`. So an action of the page (`/link`, `/object`) and an action of the owner read what they need from one object.

**One page, one menu, one switch.** The slash mode of a cell is the page's (`DocSlashStore`): the same menu, keys and effects as in a paragraph, and `EditSlashToggle` turns it off for cells too.

**Nothing moves** when a cell opens ([the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule), rule 9): the surface stands in the box of the value, in its type, at least as wide as the value was read (`CellField` measures it on the click: `field.widthRead`), and never at a width of its own, so a short value (two letters on a label) is not widened by opening it; only typing changes its size; a token drawn inside a line never makes the line taller (a chip of the registry is drawn in the scale of the line in a cell); what exists only while editing floats.

### Typing styled text

A cell accepting styles is typed **with its styles drawn**: its surface shows the bare text, the words of a segment standing in an element drawn in their style, and tokens written out as before. The markup is nowhere in what is typed, so the caret never stands in it, and every offset of the surface is an offset of the bare text.

```text
the text as kept     {{name}} は [[強み|b]] です
the surface          {{name}} は <span data-cell-style="b">強み</span> です      (CellStyleSurface)
                       │ the browser types (an input method composes as in any text)
                       ▼ after every change
the model            read back from the surface: what was typed takes its style, no style stays
(segments)           under a token or a line break, neighbours of one style join
                       │ written again only where the surface shows another shape
                       ▼
onTextChange         the text as kept
```

The surface is the codec of the `EditSourceSurface` (`codec: { write, read, insert }`, `comp-doc/cell/cell-style-surface.js`): the edit layer's surface writes and reads its text through it, and nothing else of the surface changes (the slash mode, the keys, the caret placing).

**The caret between two segments has a side.** A caret stands between two characters; where two styles meet it is with one of them, and what is typed there takes that one's style:

```text
abc|DEF          a caret between plain abc and bold DEF
  typed there    goes on in the style the caret came from: abc after →, DEF after ←
                 (a click, Home, End: with the word before it; at the start of a line or after a
                 token, where no word is before it: with the word after it)
  → or ←         first changes its side without moving it, then moves: one press more leaves a
                 segment, also at the end of the text, where → leaves the last style
  a ground       the styled segment the caret is with has a faint ground (the browser's highlight
                 registry, as the mark of a token): it says whether what is typed goes into it
```

- **A style for what is typed next.** At a caret, a style set from the keys (Ctrl/⌘ + B, I, U, Shift + X) is of the next characters typed, whatever stands around; it is forgotten when the caret moves away.
- **A line break keeps the style being typed.** The segment is cut at it (a segment holds no line break), and the next line goes on in the style.
- **A token typed inside a segment cuts it** the moment it is one (`}}` typed, a slash action chosen): the token has no style, the words on each side keep theirs.
- **Undo is the surface's own** (Ctrl/⌘ + Z, Shift + Z, Y): a style set and a segment cut are no steps of the browser's undo, so the surface keeps its steps, characters typed one after another being one.

#### The style bar

Words selected in the typed text have **their bar** under them (`CellStyleBar.jsx`): a floating button group of the edit layer (`EditButtonGroup`) with the style kinds of the cell.

```text
[ B  I  U  S | A  ▨  AA  T | Styles | Tx | [ ] ]
  flags: pressed while every word selected has it; a click sets or takes it
  values (color, highlight, size, font): their values listed under the bar, None first, one typed
    by hand where the kind checks it; the button shows the value chosen (a line in the color)
  Styles: the looks the component names for its cells
  Tx: no style at all
  [ ]: the text as it is kept (the raw mode)
```

- **A style set over a selection is set on its words.** A segment reached in part is cut, the part having both styles; tokens in the selection are passed over, the words between them getting the style each on its own; a selection of tokens only offers nothing.
- **The bar takes no focus**, so the selection stays in the text and several styles are set one after another; a value typed by hand takes the focus, and the words it acts on stay known.
- It is a popup of the edit layer (`doc-edit-popup`): a pointer in it is not a click outside the cell, nor outside the card of a token it was opened from.

**The raw mode** shows the text as it is kept, its markup written out, in every cell typed on the page (`DocCellStore.isStyleRaw`, the last button of the bar): for looking into a text, or for writing a segment by hand. The surface is then plain text as a cell without styles has it, and what the component is told (`onTextChange`, a selection) stays the same: the text as kept, offsets of the bare text.

### The card of a token

A token is more than its words: the value it reads, the object it names, how large a badge is drawn. **Its card** shows that and changes it, and the kind alone decides what it holds and what may be done there (read only, a value typed in place, a parameter chosen): the kit only places it, opens and closes it, and hands it `tokenSet`. A card is offered in two places, `where` telling it which:

| where | the token | the card |
| --- | --- | --- |
| `value` | drawn, in a value that can be edited, **selected** by a click | to its right ([below](#a-token-selected-where-it-is-drawn)) |
| `surface` | written out in the text being typed, **marked** | under it ([below](#a-token-marked-in-the-typed-text)) |

**A card may close itself** (`close()`, which it is handed): the kind decides when its work is done, a value saved in place for instance. The token stays where it is, unmarked, and a click on it opens the card again; in the typed text the caret goes back after the token. A card the kind leaves open is closed by Escape, its close button or a click elsewhere.

**A card may ask to be wide** (`widthSet('wide')`, `widthSet('normal')` to go back): it is then as wide as the place the token is typed in, its left edge at the place's (a token in a block of text: as wide as the block, so a text in the card breaks into the lines it will have there), within the window; twice the usual width where the frame knows no place (a token selected where it is drawn). What is wide is the kind's to say, from what it shows (a value that is a text), never from the name of a path. **Under a token, a card stands in the page**, not over the window: it is as tall as it is, may go past the bottom of the window, and the page scrolls to the rest of it, as to anything else below. It stands in the box scrolling the page, over the edges of anything inside that clips (a panel that scrolls of its own, a table that scrolls sideways), and follows its token when such a box scrolls (`cardHostGet` of `CellTokenCard.jsx`). Beside a token (`where: 'value'`) it stays inside the window, what does not fit scrolling inside it.

`cardPlaceList` of the kind says where it offers it: a badge in both (a size is chosen on the sheet as well as while typing), a value of the owner's data or a view of an object only in the typed text, so that a click on it where it is drawn still does what it did (opening the cell, opening the object).

**A token naming an object, or something inside one, has the card of that object.** The kind `object/view` draws `{{@reference}}` by the [object view registry](doc_page_impl_obj.md#object-views) in the context `inline`, and its card is the same registry in the context `panel`: whatever view the object's types expose for `panel` is drawn there, a fallback card when none does. So the card of a token is registered where the thing is understood: a component exposing a view (`expose.objectView: { typeList, contextList: ['panel'] }`) is the card of every token naming an object of those types, on every page. A frontend object gives the things inside it a type of its own (`typeId` of `objectInner.resolve`) and a `panel` view of that type, which reaches the object through `useObjectFrontendInner(ref)` ([Things inside an object](doc_page_impl_obj_frontend.md#things-inside-an-object-inner-paths)): a value of a profile is then typed where a cell names it. An owner's own kind naming such a thing (a query of a CV) may draw the same view as its card, so a value is changed alike wherever it is named.

#### A token selected where it is drawn

Typing changes a text; some tokens are better changed **where they are drawn**: a badge given another size, an image replaced, a token taken out. A kind offering its card in `value` is selectable there, and the kit does the rest:

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
- **A change made from the card keeps the card open.** A token is the same element while only how it is written changes (its parameters, typed in the card or chosen there), so the card stays where it is and the author goes on: a size typed, then a caption.
- **The card is a popup of the edit layer** (`doc-edit-popup`), floating, so a click in it is not a click outside what is being edited, and its top edge does not move while its content changes ([the edit card](doc_page_impl_mdx_comp_block.md#should-interaction-patterns-of-a-canvas)).

#### A token marked in the typed text

While a cell is typed, its tokens are written out (`{{address/jp/postal}}`), and its text is typed as any text. A token is also **one thing** there: it can be marked, taken out whole, and shown by its card, without the text stopping being text:

```text
the text typed (CellEdit)              〒{{address/jp/postal}} 東京都…
  a click on the words of a token      marks it: a ground under its words (a highlight, nothing of the
                                       text changes), the caret at its edge nearer the click, its card
                                       under it when its kind offers one in the surface
  the caret coming to its edge from    marks it too: ← onto the place after its last "}" from after it,
  outside                              → onto the place before its first "{" from before it
marked
  Backspace, Delete                    take the whole token out (as a typed delete: Undo brings it back)
  a click on its words                 unmarks it: the caret where the click was, inside its words,
                                       which are typed as any text (a query changed by hand)
  ← → onward, a character typed,       unmark it, and do what they do: the caret moves (into the words,
  Escape, a click elsewhere            or away), the character is typed at the edge; Escape only unmarks
  in its card                          the token written again (tokenSet), or what it names changed by
                                       the kind's own write (a value of a profile, for every paper)
```

- **A cell opened by a click on a token marks it at once**, and so does a cell whose whole text is one token: the most common cell (one value of a profile) opens with that value's card under it, and a second click on the token reaches its words.
- **The mark is drawn by the browser's highlight registry** (`::highlight(doc-cell-token-mark)`), so the surface stays plain text: no element is added to what is typed, the caret moves and the text reads back as before. One token is marked on the page.
- **`tokenSet` from a card in the surface writes the typed text**, not the owner's data: the draft changes as if typed, and the owner saves it with the rest. A card that changes what the token names (a value kept elsewhere) writes that itself, at once, and says where it is kept.
- **The card stands under the token**, its left edge at the token's (above it when the window has no room under it), floating: it is a popup of the edit layer, so a click in it does not leave the cell, and the cell keeps its place (rule 9).

### A selection made a token

`CellEdit` reports what is selected in the text (`onSelectionChange({ start, end, text, isPlain })`, offsets of the bare text, the last selection inside the surface staying known after the focus moved to a control beside it). `isPlain` says the selection is words only, no token in it in part or whole (`cellRangeRead`). A component uses it to let the author **turn words into a token of its own**: the words are kept in its data under a name, and replaced in the text by the token naming them (`cellTextRangeReplace`, the surface shown again with `textVersion`). The Japanese-style CV does this: words selected in a cell are kept in the profile at a path the author types, and the cell says `{{path}}` in their place.

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

- **`useCell`** (`comp-doc/cell/use-cell.js`) answers the cell: `tokenList` its own kinds, `context` what they read, `config` the config of the component (the document it is drawn in, and for a mode the object), `tokenIdList` the kinds of the page it accepts; `isStyled` whether its words take styles (the default), `styleList` its own style kinds, `styleIdList` those of the page it accepts ([Style kinds](#style-kinds)). The context is copied into the cell on every render, so a kind drawing a token and an action listing while the author types read the component's data as it is now. **A token drawn already is drawn again when the context changed**: the context is one object for the life of the cell, and the props of a token stay the same, so nothing else would tell a token, kept by a memo, that the badge it draws has another caption. The cell therefore counts the changes (`cell.contextVersionGet()`, an observable; `useCell` bumps it with `cell.contextTouch()` after a render in which a value handed in is not the one of the last render, before the paint), `CellValue` reads the count where it draws a token and hands it to the kind's `Render` as `contextVersion`. A component whose tokens are costly to draw hands in the same object for what did not change.
- **The owner decides when a cell is editable.** For a mode of a frontend object that is `service.isEditable`: the object can be written and the document is in edit mode ([Reading and editing](doc_page_impl_obj_frontend.md#reading-and-editing)). In reading mode a cell is drawn and its links and views work.
- **The owner keeps the text.** The kit never writes data: `onCommit` hands the text to the component, which writes it through its own api. The text is the text as kept, styles and all: a component working on it itself (cutting it into lines, replacing a part) does so by the offsets of its bare text (`cellTextSlice`, `cellTextRangeReplace`), never by cutting the string.
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

## What the kit does not do

- It does not store, validate or version the text: the owner's data does.
- It is not a rich text editor: a cell text is one string, whose words have styles and nothing more (no paragraph, list or table of its own: what a line is, a block of a CV reads from how the line starts). A token is typed as text and drawn only when the cell is read; what a token offers beyond its text is in its card.
- It lays nothing out on pages. A component paginating its content ([Pagination](doc_page_impl_pagination.md)) draws its pieces with `CellValue` as it draws its block (the cell reaching them through its own context), so a page shows a token as the block does; a piece cut between the lines of its text is drawn from its plain text, the text those lines were measured in.
- It does not replace the edit layer for documents: an object whose content is a document (a card of a zettelkasten) registers it with the source, and it is edited block by block with every component of the page ([Documents of an object](doc_page_impl_obj_frontend.md#documents-of-an-object)). There, `/link` and `/object` come from the page's slash registry, and `/object` writes the inline form of a document.

## Files

| file | role |
| --- | --- |
| `frontend/src/lib/doc-cell.js` | the grammar: parsing a text against kinds, the plain text, the link pattern, the kinds of a cell, its direct triggers; a text as kept changed and cut by bare offsets |
| `frontend/src/lib/doc-cell-style.js` | styled segments: a text read into segments and written from them, a style set over a range, the sides of a caret, offsets of the text as kept |
| `frontend/src/lib/doc-cell-text.js` | the two above without the page, as `@wwf971/react-doc/cell-text` |
| `frontend/src/store/DocCellStore.ts` | the registries of token and style kinds, a cell (its kinds, its slash, its context, its styles), the open field, the raw switch |
| `comp-doc/cell/cell-define.js` | `cellTokenDefine`, building the registry by layers |
| `comp-doc/cell/cell-registry.js` | the package's kinds by id |
| `comp-doc/cell/use-cell.js` | `useCell`: the cell of a component |
| `comp-doc/cell/CellValue.jsx`, `CellEdit.jsx`, `CellField.jsx`, `Cell.css` | drawing (a token selected), typing (a token marked, the selection reported), the field |
| `comp-doc/cell/CellTokenCard.jsx`, `cell-surface.js` | the card of a token, beside or under it; the offsets of the typed text as ranges of its surface, the mark |
| `comp-doc/cell/cell-style-define.js`, `cell-style-registry.js` | `cellStyleDefine`, the registry built by layers, the css of a style; the package's style kinds |
| `comp-doc/cell/cell-style-surface.js`, `CellStyleBar.jsx` | the surface typed with its styles drawn (the model kept in step, the sides of the caret, undo, the raw mode); the bar of the words selected |
| `comp-doc/link/link-cell.jsx` | `nav/link`: the link in a cell |
| `comp-doc/object/object-cell.jsx`, `object-slash.js` | `object/view`: the object view in a cell, its card (the view of the context `panel`); `/object` |
| `frontend/src/lib/doc-object-complete.js` | the walk of `/object`: a type, an object, inside it |
| `frontend/src/lib/doc-cell.test.js`, `doc-cell-style.test.js`, `doc-object-complete.test.js` | the grammar, the styles, the store, the walk |
| `example_doc/.doc-page/comp-mdx/object-frontend/reading-list/ReadingList.jsx` | the demonstration: the remark of a book, the text of a note, the list's own token kind and its own look |

## Future updates

What the kit leaves for later (kinds declared by a doc page, a search by words across objects in `/object`, several fields opened together as one ready piece) is in [TODO](doc_page_impl_TODO.md#edit-cell).
