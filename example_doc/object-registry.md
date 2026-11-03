---
title: Objects and Types
description: One registry of objects for the documents and the services, each object drawn by the view of its Types, in a document, a list, a group or a card diagram
---

The documents and the services of a page each keep things a reader may want to see somewhere else: a document and its sections, the links between documents, an asset, a service instance and its config, a todo of the [todo list](service-kernel.md), a database of the sqlite infra service. The **object registry** lets any of them offer those things as **objects**, and lets anyone else find them, draw them and work with them without knowing who keeps them. Each object has **Types** (`core.task`, `doc.document`, `service.config`), and a component that can draw a Type draws every object of it, whoever provides it.

The registry is a place to find objects, never where they live: the doc page source answers for the documents, the link index for the links, the service instance for its todos. What the registry answers may be stale or incomplete, and it says so. The design is `main/doc_page_impl_obj.md`.

## One object, by its reference

An object is named by a **reference**, `{namespace}:{local}`: the namespace says which provider answers for it, the local part is that provider's own. `ObjectView` draws one, in a context (`icon`, `inline`, `card` or `block`), and chooses the view itself:

````md
<!--renderComp=ObjectView-->
```yaml
object: service.w55j3ztn3rq:todo/1
context: card
```
````

<!--renderComp=ObjectView-->
```yaml
object: service.w55j3ztn3rq:todo/1
context: card
```

That is a todo of the instance `example todos`. Its Type `todo-list.todo` extends `core.task`, and the template `todo-list` carries a card for any `core.task` in its module (`TodoCard`, declared in `expose.compList` of its script): the page loads it from a running instance of the template and draws the todo with it. Check it off in place: the card asks the registry for the change `{ isDone }` that `core.task` promises, the registry hands it to the instance, which checks it and answers, and every place showing the todo follows. The dashboard of [the todo list](service-kernel.md) shows the same change, since it is the same todo.

The same `ObjectView`, with other references:

<!--renderComp=ObjectView-->
```yaml
object: doc:~example:example/service-kernel.md
context: card
```

<!--renderComp=ObjectView-->
```yaml
object: doc:~example:example/service-kernel.md#dependencies
context: card
```

<!--renderComp=ObjectView-->
```yaml
object: service.w55ipsq7ihu:database/w55j3ztn3rq
context: card
```

A document of this doc page (its card counts the links that reach it, from the navigation layer's link index), a section of it (named by the fragment navigation uses; the document is compiled to find it), and the database the sqlite infra service keeps for the todo list. Nobody wrote a view for a database: it is drawn by the **fallback view**, which every object has, from what its descriptor says.

## The config of an instance

Every service instance offers its config as an object of the built-in Type `service.config`, provided by the kernel of the backend for every instance, app or infra, without a line in its script. The view of `core.config` draws it as a form; Save sends the changed values to the kernel, which checks them against the instance's script, writes its `service.yaml`, and restarts it:

<!--renderComp=ObjectView-->
```yaml
object: serviceConfig:w55j3ztn3rq
context: block
```

## Objects of a Type

`ObjectList` asks the registry for the objects of some Types, and of their subtypes: the registry asks every provider that has some, the page's and the backend's, and draws each object with the view of its own Types. Every task the page and the services know:

<!--renderComp=ObjectList-->
```yaml
type: core.task
context: card
layout: grid
```

The documents whose title says *service*, as chips: the text is matched by every provider and checked again by the registry. The notes of `note-db` are documents too (`note-db.note` extends `core.document`), so a list of `core.document` without a text lists them beside the documents of the workspace:

<!--renderComp=ObjectList-->
```yaml
type: core.document
text: service
context: icon
```

The line under a list says how complete it is: how many providers answered, and which did not (the backend is down, an instance did not answer in time, a provider only lists what this page compiled). A list is never more certain than its providers.

## Searching for an object

`ObjectSearch` searches every provider of the page and of the services by words in any order: a name, the host of an object (the service instance or the doc page providing it, by its name or its id), its id, its Type. `type:`, `in:`, `id:` and `ns:` restrict a word to one of them. A host with too many objects is counted and not listed, with a way to load its first ones; a word its host matches is met by all its objects, so `todos check` searches the todos of `example todos` only. Try `todos`, `type:task version`, `in:example kernel`, `w55j3 config`:

<!--renderComp=ObjectSearch-->
```yaml
context: card
```

The same search is the api `object/search` of the command palette and of callers outside the page, and the create panel of a card diagram: double-click its canvas in edit mode and type, and the objects found are offered below the node kinds, added as nodes drawn by `ObjectView` (the design is `main/doc_page_impl_obj_search.md`).

## A group written in this document

`ObjectGroup` is a group whose truth is this document: its members are the references the block lists. One object may be listed twice, each entry with a note of its own; a reference that no provider knows is still listed, as missing:

<!--renderComp=ObjectGroup,id=release-checklist-->
```yaml
label: Release checklist
context: card
memberList:
  - doc:~example:example/service-kernel.md
  - { ref: service.w55j3ztn3rq:todo/2, note: build the dashboards first }
  - { ref: service.w55j3ztn3rq:todo/2, key: again, note: the same todo, listed twice }
  - serviceConfig:w55j3ztn3rq
  - service.w4veemd7i36:note/1
  - doc:~example:example/no-such-document.md
```

The block has an id, so the group is an object itself, `doc:~example:example/object-registry.md#release-checklist`, of the Type `doc.group` (a `core.group` and a `doc.block`). Named by that reference anywhere, it is drawn by the view of collections, which knows nothing of documents: it asks the registry for the members (`core.member` relations from the group, provided by the doc page source from the block above):

<!--renderComp=ObjectView-->
```yaml
object: doc:~example:example/object-registry.md#release-checklist
context: card
```

The todo list of the service is a collection as well, provided by the instance (`todo-list.list`, its members the todos), and the same view draws it:

<!--renderComp=ObjectView-->
```yaml
object: service.w55j3ztn3rq:list
context: block
```

## In a card diagram

A node of a card diagram drawn by `ObjectView` is a card of any object, whatever its Type: the diagram knows nothing of documents, services or databases. The lines are the diagram's own, written in its data. In edit mode a double-click on the canvas opens the create panel, whose text also searches the objects (this diagram narrows it to tasks, documents and configs with its option `objectSearch`):

<!--renderComp=CardDiagram,title=Objects of the todo list-->
```yaml
version: 1
objectSearch: { typeList: [core.task, core.document, core.config] }
viewport:
  size: { height: 560 }
nodes:
  - id: doc
    renderer: { component: ObjectView }
    position: { x: 0, y: 0 }
    data: { object: "doc:~example:example/service-kernel.md" }
    handles:
      - { id: out, direction: out, anchor: { side: right } }
  - id: instance
    renderer: { component: ObjectView }
    position: { x: 320, y: 0 }
    data: { object: "service:w55j3ztn3rq" }
    handles:
      - { id: in, direction: in, anchor: { side: left } }
      - { id: out, direction: out, anchor: { side: bottom } }
      - { id: config, direction: out, anchor: { side: right } }
  - id: config
    renderer: { component: ObjectView }
    position: { x: 640, y: 0 }
    data: { object: "serviceConfig:w55j3ztn3rq", context: card }
    handles:
      - { id: in, direction: in, anchor: { side: left } }
  - id: database
    renderer: { component: ObjectView }
    position: { x: 320, y: 210 }
    data: { object: "service.w55ipsq7ihu:database/w55j3ztn3rq" }
    handles:
      - { id: in, direction: in, anchor: { side: top } }
      - { id: out, direction: out, anchor: { side: bottom } }
  - id: todo
    renderer: { component: ObjectView }
    position: { x: 320, y: 420 }
    data: { object: "service.w55j3ztn3rq:todo/1" }
    handles:
      - { id: in, direction: in, anchor: { side: top } }
connections:
  - { id: doc-instance, source: { nodeId: doc, handleId: out }, target: { nodeId: instance, handleId: in } }
  - { id: instance-config, source: { nodeId: instance, handleId: config }, target: { nodeId: config, handleId: in } }
  - { id: instance-database, source: { nodeId: instance, handleId: out }, target: { nodeId: database, handleId: in } }
  - { id: database-todo, source: { nodeId: database, handleId: out }, target: { nodeId: todo, handleId: in } }
```

## When a provider is away

Stop the service backend and reload: the objects of the services are drawn from nothing, marked `unavailable`, and the lists say the backend did not answer, while the documents are drawn as before; start it again and they come back. Rename the heading **Dependencies** of [the kernel's document](service-kernel.md) in another editor: the card of that section above is now `missing`, since the document is its truth and the registry never had a copy of it. Neither is an error of the registry: it answers what it knows, with when and from whom.
