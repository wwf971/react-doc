<!-- Design of the MDX block (a document embedded in a block of another one) and of a document shown in a popup, read and edited there. Parent document: doc_page_impl.md. Its sibling the fenced code block: doc_page_impl_mdx_code.md; the inline popup of a link: doc_page_impl_nav.md#routing-a-navigation. -->

# MDX Blocks and Documents in a Popup: Design

An **MDX block** is a document of its own written inside another one, in the fence of a block. It is for text that belongs where it stands but is not to be read in the flow: the notes of a step, the details behind a list item, a longer answer kept out of the way. Like a code block in the icon view it is a tile in the line. A click opens the document in a popup over the page, where it reads as any document and, in edit mode, is edited as any document: its blocks entered by a click, its toolbars, its list items, its slash mode.

The popup is the one other place a document is shown and edited. The inline popup of a link (`[the guide](./guide.md?nav=popup)`) is drawn the same way, so the document a link opens is edited there in edit mode too.

<!--renderComp=DiagramText-->
````text
the source                                the page

- the steps                               • the steps ╭──────╮
  <!--renderComp=Mdx,title=Notes-->                   │  ▤   │
  ```md                                               │Notes │
  # Notes                                             ╰──────╯
                                                        │ a click
  Done **twice**, once a week.            ╭─ Notes ─────▼──────────────╮
  ```                                     │ Notes                      │
                                          │ Done twice, once a week.   │
                                          ╰────────────────────────────╯
````

## Core concepts

- **The MDX block** is the registered component `Mdx` (`common/Mdx`) on a fence of language `md`: a marker comment and the fence, the fence holding the document. Its views are `icon` (the default) and `card`.
- **The embedded document** is the text of the fence, read as a document. Its **host** is the document the block is written in.
- **The path of an embedded document** names it as the host and the line of its block: `~example/guide.md::embed@12` (`embedPathBuild`, `lib/doc-edit-embed.js`). It is a path of the edit layer, not of the source service: nothing is stored under it.
- **A document in a popup** (`DocPopupBody`) is what a popup shows of a document: rendered in reading mode, its edit body in edit mode.

## The source of a block

````text
<!--renderComp=Mdx,view=icon,title=Notes-->
```md
the document
```
````

| key | values | meaning |
| --- | --- | --- |
| `view` | `icon` (default), `card` | a tile in the line, or the document drawn in place in a quiet frame |
| `title` | text | what the tile and the popup say; else the tile says `mdx` and the popup `MDX block` |

The block is written as any component block with its data in a fence ([MDX components](doc_page_impl_mdx_comp.md)); the fence is the one a code block has, so a block whose document holds fences of its own takes a longer fence (` ```` `). In reading mode the document is rendered by the renderer of the page (`MdxRenderer`, handed by `dataBuild`), without expressions: it is text, as a code block is.

## The views

The **icon view** is the tile of a code block in the icon view, the same element and look (`.doc-code-icon`), with a document glyph. It stands in the line as that tile does, aligned by the same config (`CodeBlockIconAlign`, [The icon view](doc_page_impl_mdx_code.md#the-icon-view)). A click on it opens the popup, in reading mode and in edit mode alike.

The **card view** draws the document in place, in a quiet frame. In reading mode it is text of the page. In edit mode the frame is a control: a click opens the popup, since the document is not edited in the frame.

## The popup

<!--renderComp=DiagramText-->
```text
Notes                              [Copy] [👁 View | ✎ Edit] [⤢] [×]   View
[Notes          ]                  [Copy] [👁 View | ✎ Edit] [⤢] [×]   Edit
 the title: a field in Edit, written on the marker when it is left
```

The header is the header of the dialog of a code block ([Editing the lines](doc_page_impl_mdx_code.md#editing-the-lines)), less what only lines have (a language, the asset store):

- **The title** is what the marker says (`title=`), else `MDX block`. In Edit it is a field in its place (`EditValueInline`): Enter, or a click elsewhere, writes it on the marker of the block (`DocEditStore.mdxEmbedTitleSet`, `codeMarkerPropsSet`), and the tile says it at once; emptied, the block has no title. A marker cannot hold everything a title might: a comma separates its props, and a run of dashes could end the comment, so a comma becomes a space and dashes one dash (`markerValueNormalize`).
- **Copy** copies the text of the document, in Markdown.
- **View | Edit.** View shows the document rendered, Edit its edit body. The popup opens in Edit when the page is being edited and the host can be written, else in View. Edit in reading mode puts the page in edit mode, as its own switch would, since a document is edited only there; it is greyed out, with the reason, where the host cannot be written.

**The popup is the page's**, not the block's (`DocEmbedPopup`, its state `DocEmbedPopupStore`, one per page), for the reason the [block popup](doc_page_impl_popup.md#why-the-page-owns-it) is: the block is drawn by its host, which the page draws again on every write, and every edit made in the popup is a write of the host. A popup the block drew would be drawn anew twice for each edit (for the text just written, then for the compiled one), the caret and the open session in it lost. So the block only asks for the popup (`open`, with its title, its text, its line and the renderer of the page) and, while it is open, hands it what it says after each write (`update`); the page draws it, a `PanelPopup` (`panelId` `docMdxEmbed`), moved and enlarged as other panels. One popup at a time: an MDX block inside the document of the popup opens in its place.

## Editing the document

In edit mode the popup shows the **edit body of the embedded document**: `DocPopupBody` renders `DocEditBody` for its path, the body the page itself is edited in. Everything that works on a page works there, with nothing written twice: a click enters a block, its toolbar inserts, moves and deletes, a list is edited item by item, `/` opens the slash mode, a right click opens the menu of the selection.

What differs is where the text goes. An embedded document is not a file, so the edit layer does what the source service would:

<!--renderComp=DiagramText-->
```text
docEditEnsure(embedded path)               DocEditStore.embedEnsure
  the host read (docEditEnsure of the host)
  the fence at the line of the path found   codeFenceLocate
  its text accepted as the document         sourceAccept, a hash of its own
operationApply(embedded path, operation)   DocEditStore.embedOperationApply
  the operation applied to the text here    lib/doc-line-operation.ts
  the host still holds the text it was      else: a conflict, read again
  made on?
  the new text written into the fence       codeFenceTextChangeRaw
  its text accepted again                   the compiled body follows
```

- **One write of the host.** Every operation on the embedded document is one change of its host, the replacement of the lines of the block (or of the item holding it), and one history record of the host ([History records](doc_page_impl_edit.md#history-records)).
- **The same operations.** The line operations are the ones the backend applies to a file (`lineOperationApply`, `lineOperationListApply`), shared between the browser and the backend from `lib/doc-line-operation.ts`; `plugin/doc-edit-lines.ts` re-exports them beside the hash of a file.
- **A conflict is a conflict.** When the host no longer holds the text the operation was computed on (it was edited elsewhere), the operation is refused as a write of a file is, and the document is read again.
- **Written as its host is.** The embedded document is compiled in the dialect of its host (`.md` or `.mdx`), and it can be edited exactly when its host can (`docIsEditable` asks the host). It is one more kind of [document that is not a file](doc_page_impl_edit.md#documents-that-are-not-files), the one the page writes by itself: the edit api never sees its path, only the writes of its host.
- **One session.** The page holds one edit session, so entering a block in the popup leaves the one open in the page, and the reverse.
- **A write leaves no session.** The session of a document that is not the page's (in a popup, in a block of the page) is left when the page goes to another document, never because a file was written: every edit in the popup writes the host, and the edit that writes it (a split, a join, a new item) keeps its session open on the item it leads to (`DocEditStore.init`, the reaction to the page).
- **The path names the block now.** The line of the path moves with every edit above the block. The popup reads it again from the block each time it renders, so it always names the block it was opened from; an open edit of a block that moved is refused as moved, and is opened again from there.

## In the text of a list item

An MDX block among the text of a list item is a **chip of the text**, as a code block is ([Code blocks in the text of an item](doc_page_impl_edit_structure.md#code-blocks-in-the-text-of-an-item)): one character the caret steps over, selected by a first Backspace and deleted by a second. A double click on the chip opens the popup. Unlike a code block, an MDX block is a chip even when it is the whole text of its item, since its lines are never edited in the item (`isEmbed` in the table of blocks, `lib/doc-edit-item-atom.js`), and it cannot be turned into text: its document is not one line.

## Adding a block

<!--renderComp=DiagramText-->
```text
the insert menu of a block   "MDX block"         the block, its document empty
/mdx  (/embed, /doc)         in a list item      a chip at the caret
                             in a paragraph      a block between the text before
                                                 and after the caret
                             in a whole list     its lines typed at the caret
/mdx  Enter                  the view icon, the default (no view written)
/mdx  Tab, or "/mdx ␣"       the views listed: Icon (default), Card
/mdx card                    the view card, typed
```

The slash action `/mdx` (`block/mdx`, `mdx-slash.js`) answers the effect `slashEffect.block(source)`: a block at the caret, put there by the editor that knows what a block is in its text ([The action interface](doc_page_impl_edit_slash.md#the-action-interface)). The editor of a list item makes it a chip of the item's text; a paragraph is saved as the text before the caret, the block and the text after it, blank lines between them (`slashBlockTextInsert`); a surface without blocks of its own types the lines at the caret.

**Its view is an optional parameter** of the action (`slashBlockActionDefine`, [A block and its view](doc_page_impl_edit_slash.md#the-action-interface)): Enter puts the block in its default view, `icon`, and writes no view on its marker; Tab, or a space after `/mdx`, lists the views, the default first; the row of `/mdx` in the menu shows them for a pointer (`[Icon] Card`). A view chosen is written on the marker (`<!--renderComp=Mdx,view=card-->`).

## A document in a popup

`DocPopupBody` is the one component that shows a document in a popup. It is used by the popup of an MDX block and by the popup of a source link, which the inline popup of the page draws ([Routing a navigation](doc_page_impl_nav.md#routing-a-navigation)):

| | reading mode | edit mode, the document writable |
| --- | --- | --- |
| an MDX block | the document rendered | the edit body of the embedded document |
| an inline link (`?nav=popup`) | the document rendered | the edit body of the linked document |

In edit mode a click on a link edits the text it is in (entering a block, [Floating controls](doc_page_impl_edit.md#floating-controls)), so a link is followed with **Ctrl/⌘ + click**, as in a code editor: a popup link opens the popup, another link goes where it leads. The slash action `/inline` (`/popup`, `nav/inline`) writes a link to a document of the workspace with `?nav=popup`, chosen as `/link` chooses one.

A body edited in a popup is inside the popup, which is portaled to the body of the page, while React hands its events to the block the popup belongs to. Three rules keep the two apart:

- **The popup is not the block's.** The popup carries the class of a popup of the edit layer (`.doc-edit-popup`), so a click in it does not enter the block that opened it, and the pointer going down in it does not leave the session open in the page.
- **What is inside a popup is not the popup's.** A popup of the edit layer is not outside the element that opened it, but it is outside an element it holds: for a block edited in the popup, or a field of its header (the list of languages of the dialog of a code block), a pointer going down elsewhere in the same popup is a click outside (`useEditOutsidePointer`: only a popup that does not contain the element is let through).
- **The blocks in the popup are their own.** What is a control of a block is asked within that block (`targetClosestWithin(target, selector, container)`, `use-edit-outside-pointer.js`), so a block inside the popup is entered by its own click although an ancestor of it is a popup of the edit layer. The structural gestures are asked within their body the same way (`use-struct-pointer.js`).
- **A menu finds its block by its body.** The menu of the selection is anchored at the block of the body it was opened in (`.doc-edit-body[data-edit-path]`), so a right click in the popup opens it there, not in the page.

## Files

```text
built-in/comp-mdx/text/Mdx.jsx              the component: the views; asks for the popup and keeps it current
comp-doc/popup/DocEmbedPopup.jsx            the popup, drawn by the page: its header (title, Copy, View | Edit), its body
frontend/src/store/DocEmbedPopupStore.ts    the popup open, its mode, its title written
built-in/comp-mdx/text/MdxData.js           the views, the source of a new block (mdxBlockSourceBuild)
built-in/comp-mdx/text/mdx-slash.js         /mdx
built-in/comp-mdx/text/code-fence.css       the tile (shared with the icon view of a code block), the card, the popup
comp-doc/edit/DocPopupBody.jsx              a document in a popup: rendered, or its edit body in edit mode
comp-doc/registry/registry-expose.js        mdxExpose: "MDX block" in the insert menu, the source of a new block
frontend/src/lib/doc-edit-embed.js          the path of an embedded document (embedPathBuild, embedPathParse), the hash
                                            of its text; doc-edit-embed.test.js
frontend/src/lib/doc-line-operation.ts      the line operations, shared by the browser and the backend
frontend/src/store/DocEditStore.ts          embedTextGet, embedEnsure, embedOperationApply, codeFenceLocate, mdxEmbedTitleSet
frontend/src/lib/doc-edit-code.js           codeMarkerPropsSet: the props of the marker of a block written
frontend/src/lib/doc-slash.js               slashEffect.block, slashBlockTextInsert
comp-doc/link/link-slash.js                 /inline (linkSlashActionBuild({ isPopup }))
comp-doc/link/DocLink.jsx                   Ctrl/⌘ + click follows a link in a body being edited
built-in/comp-mdx/source-link/SourceLinkRenderPopup.jsx   the popup of a source link, its body a DocPopupBody
```
