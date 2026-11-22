---
title: Undo and Redo
description: The edit history of a document, kept by the development server; undo where the author is, in the page, in a popup, in a component
---

Every change written from the page in edit mode is in the **history of its document**, and can be taken back and made again. Open this page on the local development server, switch **Edit** on, and change the blocks below; every change is written to `example_doc/mdx-doc-edit-history.md`. The design is in `main/doc_page_impl_edit_history.md`.

<!--renderComp=DiagramText-->
```text
          take back (undo)               make again (redo)

keys      Ctrl/⌘ + Z                     Ctrl/⌘ + Shift + Z, Ctrl + Y
toolbar   ↶ beside Frontmatter           ↷
popup     ↶ in its header                ↷
palette   "Undo"                         "Redo"
```

The title of a button says what it would take back ("Undo: Move block"); a button that has nothing to do is greyed out. After a step, the page shows where it took place: the blocks it changed are brought into view when they are not, and tinted for a moment. The caret and the selection are not part of the history, so a step selects nothing and puts no caret anywhere.

## Things to try

1. Click the paragraph below, type a few words, and click outside it: the block is saved. Press **Ctrl/⌘ + Z**: the words are gone again. **Ctrl/⌘ + Shift + Z** brings them back.

   A paragraph to change. Type something after this sentence.

2. Hover the paragraph above and move it down with **˅** in its toolbar, then click **↶** in the toolbar of the page: it goes back up. Inserting, deleting, moving, a split of a list item, a paste: every write is one step.
3. Click into a paragraph and type, then press **Ctrl/⌘ + Z** while you are still typing: that is the undo of the text you type, the browser's own, and the document's history is not touched. Click outside first to reach the history of the document.
4. Scroll to the end of this page, change the last paragraph, scroll back up, and press **Ctrl/⌘ + Z**: the page goes down to the paragraph and shows it.
5. Reload the page and press **Ctrl/⌘ + Z**: the history is still there. It is kept by the development server, in its memory, for every document edited while it runs; it is gone when the server stops.

- apple
- pear
- plum

## A history per document

The history an undo takes is the one of **the place you are at**: the document of the page, or the document of a popup.

- **A linked document in a popup** has its own history, the same one it has when it is the page: Ctrl/⌘ + click [the structure playground](mdx-doc-edit-structure.md?nav=popup), change a paragraph there, and undo it from its header or with the keys while you are in the popup; this page's history is not touched. Open that document itself later and its history is the same.
- **An MDX block** is a document of its own written in this one. Its popup undoes only the changes made in it, though each of them is a change of this file too; the toolbar of the page can take them back as well, its title saying "(in an MDX block)".

<!--renderComp=Mdx,title=Notes-->
```md
# Notes

Open this block, edit this line in its popup, and undo it from the header of the popup.
```

## A component with changes of its own

A component that writes its block (a pasted image, a prop changed from the page) is in the history of the document without doing anything for it. A component that keeps something outside the document keeps its own steps, and answers the undo the page delivers to its block while you are at it. The counter below keeps its count in the component state layer, not in the document: click **+1** a few times and press **Ctrl/⌘ + Z**; the count goes back one click at a time. When it has nothing left to take back, the undo goes on to the history of this document.

<!--renderComp=DemoCounter,id=counter-history,label=clicks-->
```text
A counter; a plain Markdown viewer shows this text in its place.
```

## Not in the history

- where the caret is, what is selected, which block is open, the scroll position
- a block being typed and not yet saved: its text is the editor's, and is saved (one step) when you leave the block
- the asset items of a frontend object and the data a component saves through its own api (they have their versions)
- the side panel: renaming, moving and inserting its items

Last paragraph of the page: change it for step 4.
