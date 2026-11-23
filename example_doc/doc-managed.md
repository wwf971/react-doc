---
title: Managed Documents
description: Documents the page keeps itself under virtual roots, read and edited like files, moved in and out with their references
---

Most documents of a doc page are files of its folder: the folders they lie in are their paths. A **managed document** is kept by the page instead, in a **virtual root**: one folder of `.doc-page/doc-managed/` where its documents lie flat, each named by its id, and the path a document has in the root is written in its record. Everything else is as for a file. A managed document has a source path (`~notes/guide/what-is-managed.md`), is linked by it, placed in a side panel, searched, compiled and edited in place, and its writes are undone like any other.

This doc page has two virtual roots, mirrored as items below this one in the side panel:

- [**Notes**](~notes/guide/what-is-managed.md) (`~example:notes`), in the plain form: [a document kept as its text](~notes/guide/what-is-managed.md) and [one kept as its blocks](~notes/guide/kept-as-blocks.md).
- [**Archive**](~archive/2026/old-note.md) (`~example:archive`), in the pack form: one binary file per document.

In the side panel, a folder with a cog marks a virtual root and its folders, and a file in a box a managed document, in a tint of their own. The same glyphs mark them where a path is chosen (the folder of the move dialog, the location of a new document).

## On disk

<!--renderComp=DiagramText-->
```text
example_doc/.doc-page/doc-managed/          the virtual roots of the doc page
├── {rootId}--notes/                        one root; the folder IS the root
│   ├── root.yaml                           alias notes, name, mode, storage
│   ├── {docId}--what-is-managed.doc.yaml   the record: path guide/...md,
│   ├── {docId}--what-is-managed.md           mode, times, hash; the text
│   ├── {docId}--kept-as-blocks.doc.yaml    a document of mode block:
│   └── {docId}--kept-as-blocks.block.yaml    its blocks and list items
└── {rootId}--archive/                      storage: pack
    ├── root.yaml
    └── {docId}--old-note.rdoc              record + deflated content, binary
```

A document's files are named by its id first and the name of its file after, so a person looking at the folder still sees what each is; folders inside the root exist only in the paths of the records (and in `dirList` of `root.yaml` for one holding nothing yet). Copying a root folder into the `.doc-page/doc-managed/` of another doc page moves the root with its documents.

## Two modes, two forms

| | what the root keeps of a document |
| --- | --- |
| mode `text` | its text, as written |
| mode `block` | its root-level blocks and the items of its lists, each with an id; the text is built from them, and a write is read back into them, keeping the ids of what stayed |
| form `plain` | a record (yaml) and the content beside it: a Markdown file, or the blocks in yaml. What git reads, the default on a local disk |
| form `pack` | one binary file: a header, the record, the content deflated. The form a deployment on a cloud keeps, one object per document |

Every reader sees a text whatever the mode and the form, so a block-mode document in the pack form is drawn, linked and edited exactly as a file is. The mode of a root is the mode of its new documents; a document's own mode, and the form of a whole root, are changed in the settings panel.

## Moving a document in and out

Making a document managed is a move: from a folder of files to a virtual root. Leaving is the move back, and so is a rename. Every move goes through one mechanism of the backlink layer, which spells anew what refers to the document, so nothing breaks: links in other documents, links written in the moved document itself, the side panels and the home document naming it (`main/doc_page_impl_nav_backlink.md`, Relocation).

**Try it** (on the development server): switch **Edit** on, right-click the item of a document in the side panel, choose **Move document…**, open the folder tree and choose `~example:notes`. The dialog lists what the move would change before anything is written: the document becoming managed, each reference spelled anew, each side panel rebound, and what is left as it is. **Move** writes it all; the side panel follows at once. **Rename document…** is the same with the folder fixed.

The settings panel has a tab of its own, **Managed documents**: the virtual roots of every doc page, a new root, the name, mode and form of a root, the mode of a document, the blocks of a document of mode block with their ids, and **Make a document managed** (the move dialog, with a root as the target). The apis `source/move`, `source/movePlan`, `source/managedRootList` and `source/managedRootCreate` do the same for an agent.

The design is `main/doc_page_impl_doc_managed.md`; where the folders lie, `main/doc_page_impl_dir.md` (Managed documents).
