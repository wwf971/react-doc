<!-- Design of asset paths: the grammar of the paths indexing the asset items of a frontend object, with unordered groups and choices, and the general utility over it (parse, expand, match, index, complete) that any data indexed by paths can use. Parent document: doc_page_impl_obj_frontend.md. Implemented in frontend/src/lib/doc-object-frontend-asset-path.js. -->

# Asset Paths: Design

An asset of a frontend object is found by its **paths** ([Naming and finding the assets](doc_page_impl_obj_frontend.md#naming-and-finding-the-assets)): any number of them, each indexing it one way, none of them where it lies on disk. This document is the grammar of those paths and the utility that reads them. The grammar is the frontend object's, but nothing in it knows about assets: anything that indexes small pieces of data by paths uses the same patterns and the same index, whatever stores the data. The package cv (its own repository) indexes the values of a profile with it, each value a key inside one data item rather than an item of its own (its `doc/cv-query.md`).

```text
a path pattern            /book/{sci-fi/frank-herbert/}dune         written in a record, in a key, in a reference
      │  parse, expand
      ▼
the paths it stands for   /book/sci-fi/frank-herbert/dune           concrete paths: lists of segments
                          /book/frank-herbert/sci-fi/dune
      │  index (entries of a caller, each with its patterns)
      ▼
a tree of segments        /book ─┬─ sci-fi ─── frank-herbert ── dune → book-1
                                 └─ frank-herbert ── sci-fi ─── dune → book-1
      │
      ▼
lookups                   the entry of a path, the entries below a folder, the candidates completing a typed path
```

## Two layers that do not touch: where an item lies, and its paths

| | the **place of storage** | the **paths** |
| --- | --- | --- |
| what | where the data is kept: for an asset, `groupPath` of the item, a real folder under `item/`; for a value of a CV, a key path inside its item's data | patterns of the record or of the data, virtual |
| how many | one | any number, each pattern standing for several paths |
| for | a person browsing the files, an archive, a diff | the modes, a reader typing a path, a search, a query |
| kept in | the store's layout (the asset service layer, a file) | the item list of the object, the keys of the data |
| changed by | `asset/move`, `asset/group/move`, a rewrite of the data | `asset/meta/set`, a key renamed |

Moving an asset on disk changes no key, name or path, and rewriting its paths moves no file, so a mode never reads a `groupPath` to learn what an asset is. A new asset goes to the folder of its kind (`groupPath` of `assetKindList`), the folder the write names, or the top ([Where an asset lies](doc_page_impl_obj_frontend.md#where-an-asset-lies-and-how-it-is-found)). The utility below takes entries and their patterns and never asks how they are stored: that is the decoupling point. A frontend object hands it its asset records; the package cv hands it the values of a profile, one per leaf of the yaml of each item.

## The grammar

A **path pattern** is a text standing for a finite set of **concrete paths**, each a list of segments.

**`/` ends a segment that is not the last one.** It is not a separator between segments but a mark on a segment: `book/` says that something follows `book`, `dune` without it says that the path ends there. A path is thus its segments each followed by `/`, except the last: `book/sci-fi/dune`. The same holds for a group and a choice, whose members stand where segments stand: the `/` goes after each member, inside the brackets, never after the bracket.

```text
a/b/{c/d/}{e, f}
    └─┬──┘└─┬──┘
      │     └── a group ending the path: its members end with nothing, so "," separates them
      └──────── a group the path goes on after: each member ends with "/", which also separates them
```

So whether a group or a choice ends the path is written in it, and every member agrees; nothing needs to be inferred from what follows. In EBNF:

```text
pattern       = [ "/" ] sequence                                   "/" first: from the root
sequence      = { term-open } [ term-end ]                         every term but the last goes on
term-open     = segment "/" | group-open | choice-open
term-end      = segment     | group-end  | choice-end
group-open    = "{" term-open { [ "," ] term-open } "}"           {c/d/}  {c/, d/}: followed by more
group-end     = "{" term-end  { "," term-end } "}"                {e, f}: ends the path
choice-open   = "[" alt-open { "," alt-open } "]"                 [b/, c/d/]x; [b/, ]x: b/ is optional
choice-end    = "[" alt-end  { "," alt-end } "]"                  [b, c/d]
alt-open      = { term-open }                                     may be empty: nothing
alt-end       = { term-open } term-end
segment       = segment-char { segment-char }                     trimmed; at most 80 characters
segment-char  = any character but / { } [ ] , \ and control characters
              | "\" any character                                  escaped: \/ \, \{ \[ ...
```

- **A member of a group is one term.** Several segments that keep their order inside a group are a choice of one: `{[a/b/]c/}x` is `a/b/c/x` or `c/a/b/x`; at the end, `{[a/b], c}` is `a/b/c` or `c/a/b`. Groups and choices nest freely, each with its own `/`: `{a, {b, c}}`, `{a/{b/c/}}x`.
- **An empty alternative** only stands where the path goes on: `a/[b/, ]c` is `a/b/c` or `a/c`. Where a choice ends the path, an empty alternative would leave `a/` ending with a `/`, so it is refused: write the paths whole, `[a/b, a]`.
- **Plain paths are read as an os reads them.** `//` and `./` are nothing, `../` takes back the segment before it in its own sequence (`book//sci-fi/./x/../dune/` is `/book/sci-fi/dune`), and a `/` after the last segment of the whole text is left out (`book/dune/` is `book/dune`: what an os means, and what a person typing a folder writes). Going above the root is refused, and so is `..` after a group or a choice. Spaces inside a segment are kept, around it they are not.
- **An absolute pattern** starts with `/`, which is the root, not the end of a segment: the paths of assets are absolute; the patterns of values in a CV are relative to their item.

| pattern | the paths it stands for |
| --- | --- |
| `a/b/c` | `a/b/c` |
| `a/b/{c, d}` | `a/b/c/d`, `a/b/d/c` |
| `a/b/{c/d/}x` | `a/b/c/d/x`, `a/b/d/c/x` |
| `a/b/{c/d/}{e, f}` | `a/b/c/d/e/f`, `a/b/c/d/f/e`, `a/b/d/c/e/f`, `a/b/d/c/f/e` |
| `a/b/[{c, d}, e]` | `a/b/c/d`, `a/b/d/c`, `a/b/e` |
| `a/b/[{c/d/}, e/]x` | `a/b/c/d/x`, `a/b/d/c/x`, `a/b/e/x` |
| `a/[b/, ]c` | `a/b/c`, `a/c` (an empty alternative: `b/` is optional) |
| `{[a/b/]c/}x` | `a/b/c/x`, `c/a/b/x` |
| `{a, {b, c}}` | `a/b/c`, `a/c/b`, `b/c/a`, `c/b/a` |

**What is refused**, each with what is wrong and the character it is at (`assetPathParse` answers `{ message, position }`). The first ones are what the `/` rule makes rigorous, and each message says how to write it:

| written | why |
| --- | --- |
| `a/b/{c/d}/{e/f}` | the members of a group all end with `/` or none does: `a/b/{c/d/}{e, f}` |
| `a/b[c, d]`, `a{b}` | `b` does not end with `/`, so it ends the path: `a/b/[c, d]` |
| `{c/d/}/x`, `[b/, c/]/x` | a `/` after a bracket: it goes after each member, inside: `{c/d/}x` |
| `a/{c/d/}`, `a/[b/, c/]` | the path ends inside a bracket whose members say it goes on: `a/{c, d}` |
| `{e f/}x`, `{e, f}x` | a member ending the path among members going on; a term after a group ending the path |
| `a/[b, ]` | an empty alternative where the path ends |

and also: a bracket not closed, a `}`, `]` or `,` closing nothing, an empty group `{}` or an empty member (`{e, , f}`), a choice of empty alternatives only (`[]`, `[, ]`), a group of more than 6 members, a pattern standing for more than 1024 paths, a segment over 80 characters or holding a control character.

**The canonical text** of a pattern is how it is kept (`assetPathNormalize`, `assetPathText`): a `/` after every segment that something follows, a group going on written with its members side by side (`{c/d/}`, not `{c/, d/}`), a group ending the path with `, ` between its members (`{e, f}`), `, ` between alternatives, `\` before a special character in a segment, a `/` first when absolute, and no bracket that changes nothing (a choice of one alternative in a sequence, a group of one member). Read again, the canonical text is the same pattern. A plain path is its own canonical text, so every path written before patterns existed is unchanged.

**Whether a term goes on is a matter of writing, not of the pattern.** The parsed pattern keeps segments, sequences, groups and choices; the `/` of each is printed from its place. So a piece written alone and placed before more is printed going on: a key `{jp, last}` (alone, it ends its own path) followed by `kanji` is `{jp/last/}kanji` (`assetPathConcat`). A piece that more follows by nature, such as a key of the data with keys below it, is parsed with `isFragment`, which lets it end going on (`{jp/last/}`) as the rule wants; both forms are the same pattern.

## Order-free segments: unordered groups

A path normally says *where* something is, one folder in another; but many paths only say *what* something is, by several properties, and which property comes first is arbitrary: the Japanese last name is `name/jp/last` as much as `name/last/jp`, a book of Frank Herbert filed as science fiction is under the genre and under the author in either order. An **unordered group** says exactly this, and only where it holds: `name/{jp/last/}kanji` lets `jp` and `last` come in either order, and keeps `name` first and `kanji` last; `name/{jp, last}` does the same where the group ends the path.

**Locality is the rule.** Only the members of one group commute with each other; an element outside a group keeps its place, and a group keeps its place among the elements around it. `name/{jp/last/}kanji` does not stand for `kanji/name/jp/last`, nor for `name/jp/kanji/last`. A path is thus never a set of words: a pattern without groups is exactly one ordered path, and each group widens it at one place. Several groups in a path are independent (`a/{c/d/}{e, f}` is 2 × 2 paths), and a group nests in a group or a choice when an order is free only in part (`{lang, [part/script]}`).

**Why a group and not a set of the whole path.** A set reading of a path (every word in any order, a query matching the values holding all its words) answers queries no author meant: words of different levels mix (`kanji/name` and `name/kanji` are one query, a word that belongs below another matches above it), two values can no longer be told apart by where a word is, and completion cannot say what comes *next*, since everything may. With groups, an author says where order does not matter, a reader still reads a path as a path, and the index is a tree.

**The names.** The construct is the *all group* of XML Schema (`xs:all`) and the *interleave* of RELAX NG: members required, order free. *Unordered group* is used here (`{…}`), with *choice* for the alternatives (`[…]`, `xs:choice`) and *sequence* for the plain path; *order-free* describes the segments of a group.

**The canonical path** of a pattern is the first path it stands for: members and alternatives in written order (`name/{jp/last/}kanji` → `name/jp/last/kanji`). It is the path shown for an entry when one path is wanted, and the one a write records.

**Its cost.** A group of *k* members stands for *k!* orders (a group of 6, 720), and patterns multiply; so a group holds at most 6 members and a pattern stands for at most 1024 paths. The members of a group are usually two or three properties of one level; a group of many members is a sign that the path is a set of tags, which is better kept as tags (searched, not completed).

**How the index stores it.** Patterns are expanded once into their paths (`assetPathExpand`, cached by text in `assetPathCompile`) and every path is a branch of one tree, so a lookup, the entries below a folder and completion cost a walk of the tree, whatever the patterns. `assetPathMatch` decides whether one path is (or starts) a path of a pattern without expanding it, for a check against one pattern (a group by a walk over the subsets of its members).

## The index of entries by their paths

A caller hands the index **entries**, anything it indexes (an asset record, a value), each with its patterns, in the order that counts:

```js
const index = assetPathIndexBuild(
  [{ entry: assetBook, pathList: ['/book/{sci-fi/frank-herbert/}dune'] }, { entry: assetNote, pathList: ['/note/dune/1'] }],
  { isAbsolute: true, labelOf: (asset) => asset.key, segmentNormalize: (segment) => segment },
);
assetPathIndexGet(index, '/book/frank-herbert/sci-fi/dune')    // assetBook
assetPathIndexBelowList(index, '/book')                        // [assetBook]: here and below, each once, in order
assetPathIndexComplete(index, '/book/', { isEntryWanted })      // [{ kind: 'folder', path: '/book/frank-herbert', entryCount: 1 }, ...]
assetPathIndexPathOfEntryGet(index, assetBook, ['book', 'frank-herbert'])   // its path continuing what was typed
```

- **A path names one entry.** The first entry claiming a path keeps it; a later claim of the same path is a problem (`problemList`, "the path /x is claimed by a and b: it names a"), and the later entry keeps its other paths. Patterns that overlap in one path collide at that path only.
- **The folders are implied** by the paths (`/book`, `/book/sci-fi`) and hold nothing themselves; a folder of a group's path exists in each order (`/book/sci-fi` and `/book/frank-herbert`). A path may be both a folder and the path of an entry.
- **Segments are compared as the caller says** (`segmentNormalize`): as written for assets, case-folded with a vocabulary of spellings for the values of a CV (`ja` is `jp`). The vocabulary is the caller's, not a pattern: a choice `[jp, ja]` would make every spelling a path of its own.
- **The entries below a folder** come in the order of the entries given, each once however many of its paths run through the folder: this is how a caller reads "the first value below `name/jp`" as the default of that folder.
- **Completion** lists the folder typed so far (up to the last `/`): its folders with the number of wanted entries strictly below each, then its entries, those whose segment starts with what follows the last `/` first, then those whose label starts with it, then those holding it. A text that is not absolute in an absolute index is read from `base`.

## Asset paths in a frontend object

- **A record's `pathList`** holds patterns, kept in their canonical text from the root (`objectFrontendAssetPathNormalize`): `/book/{sci-fi/frank-herbert/}dune`. Written as a list in one field (the settings tab: `/a, /b/[c, d], /e/{f, g}`), the patterns are split at the commas outside brackets (`assetPathListSplit`).
- **Every path a pattern stands for names one asset**: the writes (`asset/create`, `asset/meta/set`, `relation/update`) refuse a pattern one of whose paths another asset has, naming that path ("the path /book/frank-herbert/classic/dune (one of those /book/[frank-herbert/classic/, new/]dune stands for) is the path of Dune already"); a path written twice by hand names the first asset and is a problem of the object.
- **A reference** (`/book/frank-herbert/sci-fi/dune`) is resolved by any path of the asset; a reference written as a pattern names the asset every path it stands for names (an asset's own pattern), else it is unknown with why ([references](doc_page_impl_obj_frontend.md#naming-and-finding-the-assets)).
- **A kind's `pathPrefix`** is met when one of the paths of one pattern starts so.
- **Search** reads every path a pattern stands for, and says the path the words matched (`path:/book/frank` finds `/book/frank-herbert/sci-fi/dune`).
- **Completion** walks the folders of every path: the asset above is under `/book/sci-fi` and under `/book/frank-herbert`.

**Recommended patterns.** Which paths an asset has is up to the type (its modes write them), and a lazy type gives none. Paths are most useful when the **first folder is the kind** (`/book/…`, `/note/…`), so the kinds are the top of every listing, then folders of what the object's readers sort by (a genre, an author, a parent: `/note/<its book>/<n>`), then the asset's own segment, a name made a folder name (`objectFrontendAssetPathBuild('book', genre, title)`: lowercase, letters and digits joined by `-`). Use a group where two of those folders have no natural order (`/book/{sci-fi/frank-herbert/}dune`), and several paths where an asset is filed by different hierarchies (`/book/…` and `/author/…`). Keep a path a description of the asset, not its identity: the data names other assets by key, which never changes, never by a path, which is an index the object may rearrange.

## Using it elsewhere

The utility is pure (no store, no files, no React) and exported twice: from `@wwf971/react-doc` with the page, and as `@wwf971/react-doc/asset-path` without it, so a package's pure modules and their node tests import it alone (the page's vite resolves both; the package cv's tests resolve the second with a hook of their own). A caller decides three things:

1. **What an entry is and where it is stored**: an asset item in its folder, a key path inside one file, a row of a table. The index keeps the entry as given and returns it.
2. **Where the patterns come from**: a record's list, the keys of the data concatenated (`assetPathConcat(itemPattern, keyPattern, ...)`), a prefix taken off (`assetPathPrefixStrip(pattern, ['example', 'info'])`), several made one (`assetPathChoice`).
3. **How segments compare**, and what a lookup that finds nothing falls back on (a default below a folder, a derived value): that is the meaning of the caller's data, not of paths.

```text
assetPathParse(text, { isFragment })     { node, isAbsolute, message, position }; isFragment: it may end going on
assetPathNormalize(text, { isAbsolute }) { path, node, message }: the canonical text
assetPathText(node, { isAbsolute })      the canonical text of a node
assetPathExpand(node, { limit })         { pathList: [[segment]], message }: the canonical path first
assetPathCompile(text)                   { node, path, pathList, textList, message }, cached by text
assetPathMatch(node, segmentList, { isPrefix, segmentNormalize })   a path of it, or the start of one
assetPathConcat(...nodes), assetPathChoice(nodes), assetPathPrefixStrip(node, segmentList)
assetPathSplit(text), assetPathJoin(segmentList, { isAbsolute }), assetPathSegmentEscape(name), assetPathListSplit(text)
assetPathIndexBuild(sourceList, { segmentNormalize, labelOf, isAbsolute })
assetPathIndexGet, assetPathIndexNodeGet, assetPathIndexBelowList, assetPathIndexComplete, assetPathIndexPathOfEntryGet
```

## Files

```text
frontend/src/lib/doc-object-frontend-asset-path.js        the grammar, expansion, matching, the index, completion
frontend/src/lib/doc-object-frontend-asset-path.test.js   the grammar, locality, refusals, the index
frontend/src/lib/doc-object-frontend.js                   the asset paths of an object over it: normalize, the index of an
                                                          object's assets, references, completion, search, a list in one field
frontend/plugin/doc-object-frontend.ts                    the writes: a path of a pattern another asset has is refused
frontend/package.json, vite.config.ts                     the subpath @wwf971/react-doc/asset-path
```
