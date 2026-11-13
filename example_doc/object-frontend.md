---
title: Frontend Objects
description: Objects the page keeps itself, in assets, drawn in the modes their types declare; a small system of its own in each object
---

A **frontend object** is an object of the [object registry](object-registry.md) whose data the page keeps itself, in the asset service layer: think of it as a service that runs in the page, hosting objects as free as their types make them. Each object has an **entry asset** that says what it is (its name, its type, its assets, its metadata) and any number of **assets of its own**, each declaring the object it belongs to. A doc page lists its objects, and declares their **types**, in `.doc-page/type.yaml`. The design is `main/doc_page_impl_obj_frontend.md`.

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

Without a `mode`, the block draws the type's default mode, here the shelf. Its last column, the remark of a book, is a cell typed in place while the page is edited ([Cells, and things inside an object](#cells-and-things-inside-an-object)). Its status filter is a parameter of the block: the buttons write it into this document (`param: { status: reading }`), through the api the mode is given (`paramSet`), in reading mode as in edit mode; in edit mode, a click on a status moves the book on (`want` → `reading` → `read`) and writes the book's asset; in reading mode the status only reads, as a block of a frontend object shows no control that changes data while its document is read (`main/doc_page_impl_obj_frontend.md`, Reading and editing). Opening a book switches the block for as long as the page is open, without writing the document (`{ isSaved: false }`).

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

A path may also leave the order of some of its folders free, with an **unordered group** (`{…}`), and give alternatives with a **choice** (`[…]`): a book about mathematics and music is under both topics, neither inside the other, so *Gödel, Escher, Bach* has a third path, `/topic/{mathematics/music/}gödel-escher-bach`, standing for `/topic/mathematics/music/…` and `/topic/music/mathematics/…`; `topic` stays first and the title last. A `/` ends every segment but the last, so it goes after each member inside the group, saying that the path goes on after it; a group ending a path has none, its members separated by commas (`/topic/{mathematics, music}`) (`main/doc_page_impl_obj_frontend_asset_path.md`, Order-free segments). Type `/topic/` in **find** below: both topics are folders.

The folders (`/book`, `/book/sci-fi`, `/author`) are implied by the paths and hold nothing themselves. Wherever a mode, a block or a caller names one asset, it writes an **asset reference**: a path (`/book/sci-fi/dune`), the key (`book-1`), `name:Dune`, or `id:` and the asset's object id. The book above is named by its path; a note names its book by the key, which never changes, since a path is an index the list may rearrange.

The mode **find** uses the two pieces the layer ships for components of modes: a search by words in any order, as the object search reads them (`dune`, `herbert`, `kind:note`, `path:/author/`), and a path typed with completion, folder by folder (type `/`, then `a`, Tab, …). Choosing a book opens it; a note opens its book.

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7ozoijzl
mode: find
```

A reference by any of the paths a pattern stands for names the book:

<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7ozoijzl
mode: book
param:
  book: /topic/music/mathematics/gödel-escher-bach
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

## Cells, and things inside an object

Two texts of a reading list are **cells** of the cell edit layer (`main/doc_page_impl_edit_cell.md`): the **remark** of a book, a cell of the shelf's table at the top of this page, and the text of a **note**. Such a text is words with **tokens** in it, and each token is drawn by the layer it belongs to:

```text
{{/book/sci-fi/the-left-hand-of-darkness}}
    the list's own token: another book of this list; a click opens it in the block
[Frontend Objects](~example:example/object-frontend.md)
    a link: resolved and followed by the navigation layer
{{@frontend:w5j7pn0lh5o}}
    a view of an object of the registry, drawn by the view of its types
{{@frontend:w5j7ozoijzl#/book/sci-fi/dune}}
    something inside an object, named by an inner path
```

Switch the page to **Edit** and click a remark: the cell is typed where it stands, and nothing of the table moves. Type `/` for the actions of its tokens: `/book` (the list's own, also entered by typing `{{`), `/link`, and `/object`, which walks to an object a step per choice: a **type**, then an **object** of it, then **what is inside it**. The last step is answered by the object: a reading list completes the paths of its books and notes, a profile of the package cv the query paths of its values. Enter saves, Escape leaves the text as it was.

**Something inside an object** is named from anywhere by the object's reference, `#`, and an inner path: for a reading list, a path of one of its assets. In a line of text it is written as an inline object view, as here: <!--renderComp=ObjectView-->`frontend:w5j7ozoijzl#/book/sci-fi/dune`. In the block context it is drawn by the mode its type declares for one thing (`pathParam` of the mode `book`), given the path:

<!--renderComp=ObjectView-->
```yaml
object: frontend:w5j7ozoijzl#/author/ursula-k-le-guin/the-left-hand-of-darkness
context: block
```

A path nothing is at says so where it stands: <!--renderComp=ObjectView-->`frontend:w5j7ozoijzl#/book/sci-fi/solaris`.

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

On disk an object is a folder of its own, named `{id}--{name}` (ASCII only), holding `object.yaml` and its asset items in `item/`; the asset store reads `item/` as one of its folders, and each asset declares the object in its `owner`.

```text
example_doc/.doc-page/
├── type.yaml                              the types the reading lists share
└── object-frontend/
    └── w5j7ozoijzl--Reading list/         the folder of the object: copied elsewhere, the object is there
        ├── object.yaml                    id, entry
        └── item/                          its asset items
            ├── w5j7ozokr1x/               its entry: name, type, metadata
            ├── example/                   the partition of the demonstration, tracked
            │   ├── item-list.yaml         the records of its books and notes: key, kind, name, paths
            │   ├── book/w5j7pmxa7fw/      book-1: folders of any depth, here one per kind
            │   └── note/…
            ├── playground/                what Add a book adds while trying the page, kept out of git
            └── packed/                    a partition held by the storage point file-pack
                ├── partition.yaml         which storage point holds it, and whose partition it is
                ├── item-list.yaml         the records of its books, as in every partition
                └── item-0001.pack         its books, merged into one pack file
```

The folder is where the items lie, not what makes them belong: the object says that, in its item lists, each recording the assets lying in its folder and below. Its type splits them into two **partitions** (`partitionList` in `.doc-page/type.yaml`): `example/`, the books above, tracked by git, and `playground/`, kept out of git with its own list. **Add a book** says where the book goes and adds it to the playground unless another partition is chosen, so trying the page leaves the demonstration as committed; a note goes where its book is. The package cv keeps the real data of a person the same way (`main/doc_page_impl_obj_frontend.md`, Partitions). A third partition, `packed/`, is **held by another storage point**: its type declares `storagePoint: file-pack`, so its two books (The Dispossessed, The Timeless Way of Building) are not folders of yaml files but chunks of `item-0001.pack`, which a search of the disk does not read. The shelf above lists them among the others, and every mode reads and writes them the same way: where a partition is stored changes nothing for a mode, which may still ask (`service.partitionList[i].storage`). The tab **Frontend objects** shows the storage point of each partition and moves a whole partition to another one (**Storage…**); the tab **Asset service** lists the storage points (`main/doc_page_impl_asset_storage.md`). The type `example.reading-list` declares what it holds (`assetKindList` in `.doc-page/type.yaml`): a book goes to `item/book/`, and something of another kind is refused. A file moved into `item/` by hand shows in the tab **Frontend objects** as of unknown source, not as a book, until it is adopted there or moved out. Where a book lies on disk and its paths above (`/book/sci-fi/dune`) do not depend on each other. An item of the store moves with **move…** in its asset panel; into an object, that goes through the object.
