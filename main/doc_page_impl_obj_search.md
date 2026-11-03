<!-- Design of the search of the object service layer: the grammar, the moderation (plan, preflight count, bounded fetch), the api, the ui, the card diagram's use of it. Parent document: doc_page_impl_obj.md. -->

# Objects and Types: Search

A reader, an author, an agent or a component often knows an object only by some of what it is called: "the todos of the example", "the config of that service", "the section about dependencies". The search of the [object service layer](doc_page_impl_obj.md) finds objects from such words, across every provider of the page and of the backend, without knowing who keeps them, and without making any provider hand over everything it has.

```text
"todos version"  ─► parse ─► tokens   todos, version
                    plan      per provider, from what is known of it alone (no request):
                                example todos (service:w55j3ztn3rq)   host matches "todos"  ─► its objects must match "version"
                                example notes                         host does not         ─► its objects must match both
                                kernel, doc-source, asset ...         idem
                    preflight one request to the backend: how many objects would each provider answer (count)
                    fetch     page providers: from the page's memory, matched here
                              backend providers: those few enough (≤ fetchMax), or narrowed enough by the word they
                              filter by themselves; the others are counted only: "3,412 objects, not listed [Load the first 50]"
                    match     every token, in some field of the object; scored; whole references resolved directly
                ─► result   objects (descriptor, score, path), and one summary per provider (fetched, counted, unavailable)
```

## The grammar

A search text is **words, split by spaces, in any order**; every word must match, each in some field of the object. Quoted words (`"buy milk"`) are one word. A word may be narrowed to one field by a key:

| written | matches | example |
| --- | --- | --- |
| `word` | any field: the object's name, its id (its reference and the provider's own id), its host, its Types, its description and summary | `milk`, `todo/3`, `w55j3`, `task` |
| `type:word` | its Types: the id or label of a Type of it, or of an ancestor | `type:task`, `type:doc.section` |
| `in:word` | its host: the service instance or layer providing it (its name, its provider id, its service id, its template name, its namespaces), and the doc page of a document | `in:todos`, `in:w55j3`, `in:note-db`, `in:example` |
| `id:word` | its reference only | `id:todo/3` |
| `ns:word` | its namespace only | `ns:doc`, `ns:service.w55j3ztn3rq` |
| a whole reference | the object itself, resolved at once, whatever the rest says | `doc:~example:example/service-kernel.md#dependencies` |

The **path** of an object, shown beside it in the results and matched by its words, is where it is: the host, then its own id there (`example todos › todo/3`, `the service runtime kernel › serviceConfig:w55j3ztn3rq`; for a document its source path, `~example:example/service-kernel.md#dependencies`). The descriptor holds everything a word is matched against (doc_page_impl_obj.md#references-and-descriptors), so a provider gives nothing more to be searchable.

## Moderation: plan, preflight, bounded fetch

A search must never make a provider list everything it has because a word happened to name it: a host named in the text may hold thousands of objects, some of them remote. So a search goes in three steps, and stops where it knows enough:

1. **The plan**, per provider, from what is known of the provider alone, before any request: its label, its id, its service id and template, its namespaces, its Types (with their ancestors). A word that matches its host is **met by all its objects** (so `todos milk` means "milk" among the objects of a host called like todos); `in:` and `ns:` words that do not match exclude it, a `type:` word matching none of its Types excludes it, as do the Types and providers a consumer restricts the search to. What remains are the words its objects must still match, and the longest plain one is the **word pushed** to the provider, which it may filter by itself (the `text` of its query).
2. **The preflight count.** The providers of the backend that remain are asked, in one request (`POST /object/count`), how many objects of the Types asked for they have, without listing any. A provider counts when it has the capability `count` (an instance's `objectCount` api, a cheap `COUNT` of its database; the kernel counts its own); one that cannot answers `unknown`.
3. **The bounded fetch**, per provider, never more than `fetchMax` (50 by default; 20 in a card diagram's create panel):

| what the preflight said | what is fetched |
| --- | --- |
| at most `fetchMax` | all of them, matched here (a word matching an id is found as well as one matching a name) |
| more, and a word is pushed | the count of what the word leaves (a second preflight, per pushed word); fetched with that word when it is at most `fetchMax`, else **counted only** |
| more, and no word is left (the text only named the host or a Type) | **counted only** |
| not known (no count), and a word is left | the first `fetchMax` its own filter by the word gives, marked truncated when there are more |
| not known, no word left | **counted only** |
| the provider is loaded on purpose (`providerIdExpandList`) | its first `fetchMax`, filtered by the pushed word if any |

A provider **counted only** is in the result as a summary with its count (or that it is not known) and `isExpandable`: the ui says "big list: 3,412 objects, not listed: narrow the search, or load the first 50", and the reader either types one more word or loads it on purpose. The page's own providers (the doc page source, the asset store) answer from the page's memory and are listed whole (up to 500) and matched on the page. A provider the plan excluded is not asked at all; one that does not answer is a summary `unavailable` or `failed`, the others answer as usual.

**Correctness and cost.** A word pushed to a provider is matched by it against what it chose (todo-list: the title; the kernel: the label, the description and the reference); a word that matches only an id is therefore found among the objects of a provider that is small enough to be listed whole, or by `id:` or the whole reference, which is resolved directly. The result says which providers were listed in full (`isComplete` is true only when all of them were); it is never more certain than its providers.

## The result

```text
search({ text, typeList, providerIdList, registryList: [page, backend], filter, fetchMax, limit, providerIdExpandList })
  -> tokenList        the words as parsed
     objectList       [{ descriptor, score, matchList: [{ token, field }], path, hostLabel, isRefHit }]   best first
     providerList     [{ providerId, label, registry, status: fetched | counted | unavailable | failed,
                         count, countKind: exact | atLeast | unknown, matchCount, isTruncated, isExpandable, message }]
     isComplete       every provider asked was listed in full
```

The score adds, per word, where it matched: the start of the name (8), the name (5), the id (3), the host (2), a Type or the description (1); a whole reference resolved is first. The descriptors found are kept as what the registry knows of them, so an object chosen from the results is drawn at once.

**Filters**, to make a search smaller before it starts: `typeList` (objects of these Types and their subtypes; a provider of none of them is not asked), `providerIdList` (only these providers: `doc-source`, `kernel`, `service:{serviceId}`, …), `registryList` (`page`, `backend`), `filter` (what the providers filter by themselves, their `queryFilterList`: `isDone` of todo-list, `kind` and `status` of the kernel, `docPageAlias` of the doc page source), the keys of the grammar, and `fetchMax`. An empty text with a Type is a listing of that Type, moderated the same way; an empty text without one is no search.

## Where it is

The search is part of the object service layer and kept like the rest of it: `DocObjectSearchStore` (`store/DocObjectSearchStore.ts`, owned by `DocObjectStore` as `searchStore`) holds the **sessions** of the search uis, one per key: the text, the filters, the providers loaded on purpose, the result, the highlighted row, the object chosen. A ui renders its session and calls its methods (`textSet`, `typeListSet`, `registryListSet`, `providerExpand`, `indexActiveMove`, `refChosenSet`); it keeps nothing of its own, so the search a block shows survives the block being drawn again. A session searches a moment after the typing stops, and only its latest answer is kept. The pure part (the grammar, the plan, the match, the path) is `lib/doc-object-search.js`.

| entry | for |
| --- | --- |
| `objectStore.searchStore.search(spec)`, `config.object.search(spec)` | one search, from code or a component |
| `config.object.searchSessionGet(key, { typeList, fetchMax })` | a session for a ui of a component (the card diagram's create panel) |
| the api `object/search` (`text`, `typeList`, `providerIdList`, `fetchMax`, `providerIdExpandList`) | the command palette, a hotkey, a caller outside the page (an agent), through the [unified api registry](doc_page_impl_api.md); beside it `object/resolve`, `object/read`, `object/open` |
| `POST /object/count` of the backend | the preflight: `{ typeList, text, filter, providerIdList }` → `{ providerList: [{ providerId, count, countKind, status }] }` |

## The ui

`ObjectSearchPanel` (`comp-doc/object/ObjectSearchPanel.jsx`) is the search as a panel, in the look of the insert menu's search (the shared classes `.doc-search-*` of `src/css/search.css`, which the insert menu uses too):

```text
[🔍 todos version                                        ]
[All][Documents][Places][Tasks][Collections][Configs][Services]   [Everywhere][This page][Services]
 ☑ create a version of the todos   Todo   example todos › todo/3
 ⚙ example todos · config          Service config   the service runtime kernel › serviceConfig:w55j3ztn3rq
big list: 3412 objects, not listed: too many to list   [Load the first 50]
```

ArrowDown / ArrowUp move in the results, Enter chooses the highlighted one, Escape clears the text, then closes (`onClose`). A row shows the icon of the object's Type, its name, its Type, its status when not found, and its path, the words of the search marked. The panel is a part other components embed (`sessionKey`, `typeList`, `onChoose(hit)`); `ObjectSearch` is the panel as a block of a document, which draws the object chosen below it by the view of its Types:

````md
<!--renderComp=ObjectSearch-->
```yaml
typeList: []        # optional: the Types it starts filtered by
context: card       # how the chosen object is drawn
```
````

## In a card diagram

The create panel of a card diagram (a double-click on the canvas in edit mode, `DiagramCreatePanel` of the package cloud-dev-vis) lists the kinds of its node registry and, below them, the objects its text finds, through `config.object.searchSessionGet` (fetchMax 20): one keyboard list for both. Choosing an object adds a node `renderer: { component: ObjectView }`, `data: { object }`, with an `in` handle on the left and an `out` handle on the right, by the generic command `DiagramEditStore.nodeComponentAdd(compName, data, position, idPrefix)` (the engine knows the component by its name only, and the change goes through `changeApply`, so it is undone like any other). A host counted only is a line of the panel with its count and **Load the first 20**. A diagram narrows the search with its option:

```yaml
objectSearch: { typeList: [core.task, core.document], isEnabled: true }   # isEnabled false: no objects in the panel
```

The search runs only once something is typed, so opening the panel costs nothing. Searching objects from the panel of a line (its two ends) is [TODO](doc_page_impl_TODO.md#object-search-line).

## Files

```text
frontend/src/lib/doc-object-search.js       the grammar, the provider and object fields, the plan, the match, the path
frontend/src/lib/doc-object-search.test.js  the grammar, the plan, the match, moderation against a large provider
frontend/src/store/DocObjectSearchStore.ts  search (plan, preflight, bounded fetch, results), the sessions
comp-doc/object/ObjectSearchPanel.jsx       the panel and its result row (ObjectSearchResultRow), textHighlight
comp-doc/object/ObjectSearch.jsx            the panel as a block of a document
comp-doc/api/api-object.js                  object/search, object/resolve, object/read, object/open
frontend/src/css/search.css                 .doc-search-*: the field and the result rows, shared with the insert menu
service-backend/service_object.py           ObjectRegistry.count, the providers' count
service-backend/server.py                   POST /object/count
../package/cloud-dev-vis/comp-mdx/card-diagram/DiagramCreatePanel.jsx   the objects in the create panel
../package/cloud-dev-vis/comp-mdx/card-diagram/DiagramEditStore.js      nodeComponentAdd
```
