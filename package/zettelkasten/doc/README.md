# zettelkasten

A package for keeping a **zettelkasten** as a frontend object: small linked notes, the **zettels**, joined by connections, question zettels that refer to them option by option, and the notes of a reader. It brings the type `zettelkasten.box` (`type.yaml`) and its modes; a doc page imports it by name (`packageList: [{ name: zettelkasten }]`) and holds only the data. It needs the package `cloud-dev-vis`, whose switching viewport draws the connections.

<!--renderComp=DiagramText-->
```text
the object (a folder of a doc page)        the package
  item/content/zettel/…    a zettel each     ZettelData.js    zettels, connections
  item/content/question/…  a question each   ZettelScenes.js  the connection view
  item/note/…              notes, progress   ZettelCard.jsx   a zettel: a card
        │  kinds declared isDoc              ZettelExplorer   the zettel on a desk
        ▼
  the source layer of the page: ~${frontend.id:{id}}/card/rag-chunking.md
```

## A zettel is a card

What a reader sees of a zettel is a card: wider than tall (or near square), with a **title bar**, and a body that scrolls when the zettel says more than fits. **Expand** in the title bar shows all of it, the card as tall as what it shows. The right part of the title bar switches what the body shows, its **view**:

<!--renderComp=DiagramText-->
```text
┌─ ← →  ▢ Contextual grounding check  topic ─── [Text│Connections│Flow] ⇕ … ┐
│ Guardrails › Topics                                                        │
│ ┃ Checks that an answer is grounded in the source and relevant to …       │
│ ## Thresholds                                                        ▓     │
│ …                                                                    ▓     │
└────────────────────────────────────────────────────────────────────────────┘
  ← →  the way back and forth      ⇕  expand        …  what changes it (edit mode)
```

| View | Shows |
| --- | --- |
| **Text** | the text of the zettel: where it is (the zettels holding it), its summary, its document, a strip of its connections by place (each opens the connection view at that place), its sources, its notes. A question shows its stem and options to choose among, then its answer and analysis |
| **Connections** | the zettels connected to it, in a viewport whose edge is the frame of the zettel itself ([The connection view](#the-connection-view)) |
| **Flow** | the process the zettel describes, when it has one (`flow` in its frontmatter): steps in ranks, a step naming a zettel drawn as that zettel |

Every zettel drawn anywhere is the same card, smaller: a title bar with its icon and title, a few lines of its summary. That is how it stands in the connection view, in a flow, and on any card diagram ([Zettels on a card diagram](#zettels-on-a-card-diagram)).

### Its text is a document

A zettel, a question and a note are Markdown items, registered with the source of the page by the object ([Documents of an object](../../../main/doc_page_impl_obj_frontend.md#documents-of-an-object)). So the text of a zettel is compiled and rendered by the document pipeline (links, components, anchors, math), edited block by block by the edit layer, and a zettel names another as a document names a document:

```markdown
[Chunking strategies](rag-chunking.md)            another zettel of the box, by its file name {key}.md
[Semantic chunking](rag-chunking.md#semantic)     a place: an Anchor id, or a heading
[Q15 · B](q015.md#option-b)                       an option of a question
[the guide](~docs/guide.md?nav=page)              a document of the page, the classic navigation
```

From outside the box a zettel is `~${frontend.id:{id}}/card/{key}.md`, or by the name of the object (`${frontend.name:…}`, `${frontend:…}`). The document path is the type's own choice (`docPath: "card/{key}"`, `question/{key}`, `note/{key}`), independent of what holds the zettel, so a zettel given another container keeps its path. A link followed inside a zettel opens the zettel it names, with its text, at the place named; followed anywhere else, the **home document** of the box opens in the popup and goes there ([Routing a navigation](../../../main/doc_page_impl_nav.md#routing-a-navigation)). The home document is the item `/page/home` (kind `page`, `metadata.docHome: home` of the object), holding an explorer block.

## Connections

A **connection** joins two zettels. It is one record of the model (`ZettelData.js`), read from both ends.

| Kind | Means | Written |
| --- | --- | --- |
| **contain** | the first holds the second | on the held zettel, `parent: key` or a list of keys (a question: `hub`); or on the holder, `connectionList: [{ type: contain, to }]` |
| **link** | the first points at the second; without direction (`isDirected: false`), the two are only related | a Markdown link in the text; or `connectionList: [{ to, label?, isDirected? }]` |
| **group** | several connections of one zettel aligned together: a **list**, an **array** (each indexed from 0) or a **map** (each with a key) | `connectionList: [{ group, form, itemList }]`; the options of a question are a map, its other needed zettels a list |

A link written in `connectionList` may have a **label**, of three kinds: words, another zettel (`{ zettel: key }`: the zettel that explains the relation, opened from the line), or an object of the page (`{ object: frontend:…#… }`, any reference of the object registry, opened where its provider says).

```yaml
parent: [structure, link]          # held by two zettels
connectionList:
  - { to: card-atomic, label: needs }                        # a link with words
  - { to: card-own-words, isDirected: false, label: { zettel: card } }
  - { to: link-place, label: { object: "doc:~zettelkasten/doc/README.md" } }
  - group: Gathers                                           # a map: a key per member
    form: map
    itemList: [{ key: idea, to: card-atomic }, { key: wording, to: card-own-words }]
  - { type: contain, group: Areas, form: array, itemList: [card, link, structure] }
```

**Containment has no cycles.** A zettel may be held by several, but never by one it holds, nor by itself. The model reads every containment in order and leaves out one that would close a cycle, with a word in what does not fit; a write is refused before it is made (`zettelContainCycleFind`, whose answer the dialog shows as the chain that is already there). A zettel nothing holds hangs below the root, and the root is held by nothing. The first container is the one a chain of titles goes through; an ordered group of contain (`type: contain` with a `form`) orders what a zettel holds, and several such groups (an area split into its themes) keep their order one after the other, what no group names coming last.

## The connection view

The view **Connections** turns the body of the zettel into a viewport (the switching viewport of `cloud-dev-vis`), whose edge is the frame of the zettel. The zettel itself is the card in the middle, and everything connected to it stands around it, each place in a frame named in its corner (`zettel-frame`), laid out by the arranger `zettel-connection` (`ZettelArrange.js`):

<!--renderComp=DiagramText-->
```text
              ┌ Contained by ─────────────┐   above, in a grid
              │ [▢ Hub]  [▢ Area]         │
              └────────────┬──────────────┘
 ┌ Back links ┐       ┌────▼─────┐        ┌ Forward links ┐
 │ [▢ …]      ├──────►│ ▢ itself │───────►│ [▢ …]         │
 │ [▢ …]      │ needs └────┬─────┘        ├ Steps  array ─┤
 ├ Questions ─┤            │              │ 0 [▢ …]       │
 │ B [▢ Q15]  ├────────────┘              │ 1 [▢ …]       │
 └────────────┘ ┌ Contains ▼──────────────┴───────────────┐
                │ [▢ …] [▢ …] [▢ …] [▢ …]                 │   below, a grid;
                │ [▢ Q3] [▢ Q8]                           │   its questions on
                └─────────────────────────────────────────┘   rows of their own
```

- **Each zettel stands in one place**, the first that applies (contained by, contains, the questions, the groups, back links, forward links). A group keeps all its members, since its order and keys are what it says; a member of a group of a key in several places carries every key (`A B D` for a zettel three options are about), each toned by the verdict once the answer is shown.
- **What it holds in several groups** (several groups of contain, or one and the rest) stands group by group below it: each group starts its own rows, in a frame of its own inside the frame of *Contains*, named by the group with its form (what no group names: *Other*). A member of an array carries its index, of a map its key.
- **A long place is cut**: a side shows five, and a card *N more* that opens that place alone. A side shown alone shows everything. A place of more than four (a grid: twelve) shows its zettels as their title bars alone.
- **What to see** is chosen in the strip over the viewport: contained by, contains, back links, forward links (with the groups), questions, each with how many it holds.
- **The camera** fits what matters first: everything but the long end of what the zettel holds, which the reader pans to, or sees whole once the zettel is expanded.

Every zettel keeps one node id in every scene (`z:{key}`), so the scenes are switched rather than replaced: a click on a zettel brings it to the middle (shared zettels move, the others fade), as does a filter, and going between the connections and the flow. A click on the zettel in the middle reads it. The scenes are generated from the model (`ZettelScenes.js`): `/z/{key}`, `/z/{key}/f-{places}` with only some places, `/z/{key}/flow`.

**Opening the view** is one motion (`ZettelMotion.js`): the text fades, the frame of the zettel shrinks onto its own card in the middle, the frame of the card stays where it was as the edge of the viewport, and what is connected comes out of the middle to its place, the lines last. Back to the text, the same in reverse. The scene is drawn under the text before the motion starts, so the motion only moves what is on the screen; a reader preferring less motion sees the end at once.

## The modes

| mode | component | shows |
| --- | --- | --- |
| `explorer` (default) | `ZettelExplorer` | a zettel lying on a desk: over it a bar to find a zettel (`q12` finds question 12), to open a side panel beside it (the outline, the questions, the notes), and **Practice** (questions hide their answers until asked). `param`: `zettel` (the zettel shown first), `view` (`text`, `link`, `flow`), `height`, or `aspect` (its width over its height, 1.55 by default), `panel`, `isPractice` |
| `card` | `ZettelCard` | one zettel in the flow of the document, with its views and its way back. It is the mode showing one thing of the box (`pathParam: zettel` in `type.yaml`): a reference to a zettel from elsewhere, `frontend:{id}#card-atomic`, is drawn by it in the block context |

The usage of both, with the example box of the package, is in [Zettelkasten](../comp-mdx/zettelkasten/comp-zettelkasten.md). What a block keeps while it is on the page (the zettel shown, the view, the places shown, the way back, the side panel, the answers chosen) is its store, `ZettelStore.js`, kept across the popup and edit mode; nothing of it is saved.

## Reading and editing

Reading changes nothing of the content. While the document is edited, the text of a zettel and of its notes is the edit body of the page's edit layer, edited block by block like any document ([Documents that are not files](../../../main/doc_page_impl_edit.md#documents-that-are-not-files)); what is typed into it is the page's (`/link`, `/object`). The menu at the right of the title bar (…) changes the zettel as a whole, each in a dialog over it:

| Item | Does |
| --- | --- |
| **Connect to a zettel** | a link (directed or not, labelled by words, a zettel or an object), a containment either way; the other zettel found by words. A containment that would close a cycle is said and refused. Under it, the connections the zettel writes itself, each taken away by its button. Written into the frontmatter of the zettel (`ZettelConnect.js`) |
| **New zettel inside this one** | a zettel held by this one, one level down (an area below the root, a topic below an area, a fact below a topic), opened once made |
| **Remove this zettel** | deleted softly, as every item of an object is; one holding others is not removed |

A note is added at the foot of the text, on the whole zettel or one of its places. How a question went (right, missed, to review) is the reader's own record, kept in either mode.

## Zettels on a card diagram

A box is the one place its zettels are kept, and other blocks use them by reference: the source path of a zettel (`~${frontend.name:{box}}/card/{key}.md`) is how anything outside the box names one, a link and a diagram alike.

```text
ZettelNode      a registered node renderer (placement visualizationNode), for any card diagram:
                  renderer: { component: ZettelNode }
                  data: { zettel: "~${frontend.name:Tea}/card/green-tea.md" }
                the zettel as its small card; a click follows the path as a link does (the home
                document of the box in the popup); while the diagram is edited the click is the editor's
ZettelDiagram   CardDiagram given two things for its create panel (a double-click on the empty
                canvas while it is edited, cloud-dev-vis card-diagram-impl.md#sources-of-the-create-panel):
                  createSourceList   "Cards": the zettels of the boxes of the page by words
                  createActionList   "New card": a title asked (with several boxes, the box first)
                box=… on the marker narrows both to one box, by its id or its name
```

Both read and write through the stores of the page (`DocObjectFrontendStore`: the boxes are the frontend objects whose type is `zettelkasten.box` or has the explorer among its modes), never through a mode api, since a diagram is a block of any document, outside the instances of the box. Removing a node from a diagram does not remove the zettel from its box.

## Partitions

`content` (tracked): the zettels and the questions. `note` (kept out of git, `**/.doc-page/object-frontend/*/item/note/` in the `.gitignore` of the doc page): the notes and the progress item. The progress is a kind internal to the box (react-doc: `main/doc_page_impl_type.md#kinds-of-data-items`): registered nowhere, its shape (`statusByQuestion`, each `right`, `wrong` or `review`) a schema checked on every write.

## Importing zettels

`comp-mdx/zettelkasten/zettel-import.mjs` puts zettels written as yaml files into a box through the asset api of a running development server, creating the object when there is none; run again, it writes only what changed. In the yaml a text links a zettel as `[[key#place|label]]` and marks a paragraph with ` ^id`; the import writes the document form.

```sh
node comp-mdx/zettelkasten/zettel-import.mjs --server http://localhost:45190 --content <dir> --questions <questions.json>
```

## Files

```text
type.yaml                        zettelkasten.box: kinds (isDoc), partitions, modes
comp-mdx/zettelkasten/
  ZettelDoc.js                   a zettel as a document: frontmatter, sections and anchors, links to zettels
  ZettelData.js                  the model of a box, pure: zettels, connections, groups, no cycle of containment
  ZettelConnect.js               a connection written into, or taken out of, a frontmatter
  ZettelArrange.js               the arrangers: the connection view, a flow (the contract of cloud-dev-vis)
  ZettelScenes.js                the provider of the scenes: the connection view by places, the flow
  ZettelKinds.jsx                the kinds zettel-card and zettel-frame, and the small card of a zettel
  ZettelMotion.js                the zettel turning into its connections and back
  ZettelCard.jsx                 a zettel: the card, its title bar, its views, its dialogs
  ZettelReader.jsx               the text of a zettel
  ZettelExplorer.jsx             the modes explorer (the desk) and card; the model of an object
  ZettelPanel.jsx                the side panels: outline, questions, notes
  ZettelStore.js                 the state of one block; the writes, through the mode api
  ZettelDiagram.jsx              ZettelNode and ZettelDiagram: zettels on a card diagram
  Zettelkasten.css
  comp-zettelkasten.md           for authors, with the example box of the package (.doc-page/object-frontend/)
  zettel-import.mjs
```
