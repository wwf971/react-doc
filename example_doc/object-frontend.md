---
title: Frontend Objects
description: Objects the page keeps itself, in assets, drawn in the modes their types declare; a small system of its own in each object
---

A **frontend object** is an object of the [object registry](object-registry.md) whose data the page keeps itself, in the asset service layer: think of it as a service that runs in the page, hosting objects as free as their types make them. Each object has an **entry asset** that says what it is (its name, its type, its assets, its metadata) and any number of **assets of its own**, each declaring the object it belongs to. A doc page lists its objects, and declares their **types**, in `.doc-page/object-frontend.yaml`. The design is `main/doc_page_impl_obj_frontend.md`.

The objects below are reading lists: a type of this doc page, `example.reading-list`. One reading list holds two kinds of data, each piece one asset: **books** (a title, an author, a genre, a status) and **notes** (a text, naming the book it is about). Its type declares the ways to work with it, its **modes**: a shelf, cards, a form adding a book, one book with its notes, a search, some numbers.

## The entry component

A document places an object with one block, `ObjectFrontend`, naming the object, the mode and the parameters of that mode; it renders what the mode names, and nothing around it:

````md
<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7ozoijzl
```
````

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7ozoijzl
```

Without a `mode`, the block draws the type's default mode, here the shelf. Its status filter is a parameter of the block: the buttons write it into this document (`param: { status: reading }`), through the api the mode is given (`paramSet`), in reading mode as in edit mode; a click on a status moves the book on (`want` → `reading` → `read`) and writes the book's asset. Opening a book switches the block for as long as the page is open, without writing the document (`{ isSaved: false }`).

## One object, several modes

Two modes may share a component and differ by their parameters only: `shelf` and `cards` are both `ReadingList`, with `layout: table` and `layout: cards`. A block chooses a mode and adds parameters of its own over the mode's:

````md
<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7ozoijzl
mode: cards
param:
  status: want
```
````

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7ozoijzl
mode: cards
param:
  status: want
```

Nothing ties the modes to one way of seeing the same data: a mode may be a form that registers new data, a view of one asset, a summary of all of them. The type says what each one is; the page only renders the component it names.

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7ozoijzl
mode: add
```

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7ozoijzl
mode: book
param:
  book: /book/sci-fi/dune
```

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7ozoijzl
mode: stats
```

## Naming and finding the assets

Each asset of a reading list has a **name** (a book its title) and **paths**, as many as the list wants, read the way an operating system reads a path: a book is filed by its genre and by its author, a note under its book, the kind always first, the pattern the layer recommends:

```text
/book/sci-fi/dune                 /author/frank-herbert/dune          /note/dune/1
/book/non-fiction/a-pattern-language   /author/christopher-alexander/a-pattern-language
```

The folders (`/book`, `/book/sci-fi`, `/author`) are implied by the paths and hold nothing themselves. Wherever a mode, a block or a caller names one asset, it writes an **asset reference**: a path (`/book/sci-fi/dune`), the key (`book-1`), `name:Dune`, or `id:` and the asset's object id. The book above is named by its path; a note names its book by the key, which never changes, since a path is an index the list may rearrange.

The mode **find** uses the two pieces the layer ships for components of modes: a search by words in any order, as the object search reads them (`dune`, `herbert`, `kind:note`, `path:/author/`), and a path typed with completion, folder by folder (type `/`, then `a`, Tab, …). Choosing a book opens it; a note opens its book.

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7ozoijzl
mode: find
```

A reference that names nothing, or an asset its list names and the store has lost, is said where it is used, never an empty block:

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7ozoijzl
mode: book
param:
  book: /book/sci-fi/solaris
```

The names and paths of the assets are edited in the **Frontend objects** tab too, where a search finds an asset of the chosen object, and the registry's apis offer them to agents (`relation/query { fromRef, text }`, `relation/update { fromRef, key, data: { name, pathList } }`).

## Types and inheritance

Every type of a frontend object extends `frontend.object`, which brings one mode to all of them, `overview`: the object as its entry describes it, its assets, its metadata and the buttons of its modes.

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7ozoijzl
mode: overview
```

A type may extend another type of a doc page and inherits its modes; a mode declared again with the same id replaces the inherited one. `example.reading-list-short` extends the reading list and declares only its own `shelf`, as cards; `add`, `book`, `stats` and `overview` come from its ancestors:

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7pn0lh5o
```

## In the object registry

A frontend object is an object like any other: `frontend:{id}`, of its type, with its assets as members. `ObjectView`, lists, searches and card diagrams find and draw it, by the view of `frontend.object`:

<!--renderComp=ObjectList-->
```yaml
type: frontend.object
context: card
layout: grid
```

## Creating and managing objects

- **From a document**, in edit mode: the insert menu's **Frontend Object** asks for the object first, a search of the registry limited to frontend objects, or creates one of a type with the **New** buttons, and writes the block for it. The block's edit mode chooses the object, the mode and the parameters.
- **In the settings panel**, the tab **Frontend objects** lists the objects of every doc page with their assets, creates one in a doc page of a type, renames it (its folder follows), removes an asset, attaches an asset that declares the object but is not listed, deletes an object with its assets or keeping them, and lists the types the doc pages declare and the problems of their files.

On disk an object is a folder of its doc page's asset folder, named like an asset object, `{id}--{name}`, holding its entry and its other assets; the asset store reads objects inside such group folders at any depth, and each asset declares its object in its own `object.yaml` (`owner: { ref: frontend:{id} }`, `role: entry` for the entry):

```text
example_doc/.doc-page/
├── object-frontend.yaml                   the types, and objectList [{ id, entry }]
└── asset/
    └── w5j7ozoijzl--Reading list/         the group folder of the object
        ├── w5j7ozokr1x/                   its entry: name, type, assetList, metadata
        ├── w5j7pmxa7fw/                   book-1
        └── …                              the other books and the notes
```
