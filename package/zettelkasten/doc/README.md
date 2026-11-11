# zettelkasten

A package for keeping a **zettelkasten** as a frontend object: small linked knowledge cards in a hierarchy, question cards that refer to them option by option, and the notes of a reader. It brings the type `zettelkasten.box` (`type.yaml`) and its modes; a doc page imports it by name (`packageList: [{ name: zettelkasten }]`) and holds only the data. It needs the package `cloud-dev-vis`, whose switching viewport draws the map.

```text
the object (a folder of a doc page)                 the package
  item/content/zettel/…    one card per item   ──►  ZettelData.js     the model: hierarchy, links both ways, questions per card
  item/content/question/…  one question per item    ZettelScenes.js   a scene per card, generated (flow, links, question)
  item/note/…              notes, progress          ZettelExplorer    the map beside the card being read
        │  kinds declared isDoc                     ZettelReader      the card: its text rendered as a document of the page
        ▼
  the source layer of the page: ~${frontend.id:{id}}/card/rag-chunking.md
```

## A card is a document

A card, a question and a note are Markdown items, registered with the source of the page by the object ([Documents of an object](../../../main/doc_page_impl_obj_frontend.md#documents-of-an-object)). So the text of a card is compiled and rendered by the document pipeline (links, components, anchors, math), and a card names another as a document names a document:

```markdown
[Chunking strategies](rag-chunking.md)            another card of the box, by its file name {key}.md
[Semantic chunking](rag-chunking.md#semantic)     a place: an Anchor id, or a heading
[Q15 · B](q015.md#option-b)                       an option of a question
[the guide](~docs/guide.md?nav=page)              a document of the page, the classic navigation
```

From outside the box a card is `~${frontend.id:{id}}/card/{key}.md`, or by the name of the object (`${frontend.name:…}`, `${frontend:…}`). The document path is the type's own choice (`docPath: "card/{key}"`, `question/{key}`, `note/{key}`): it does not follow the hierarchy, so a card filed below another keeps its path.

Where a link leads ([Routing a navigation](../../../main/doc_page_impl_nav.md#routing-a-navigation)): followed inside an explorer or card block, that block shows the card at the place named; followed anywhere else, the **home document** of the box opens in the popup and goes to the card. The home document is the item `/page/home` (kind `page`, `metadata.docHome: home` of the object), holding an explorer block; the import makes it. `?nav=popup` on a link opens the card alone.

What a card is beside its text is its frontmatter:

```yaml
# a knowledge card (kind zettel)
level: topic                 # root | hub | topic | fact: the hierarchy, with parent
parent: guardrail            # the key of the card above (a hub hangs below the root)
title: Contextual grounding check
summary: one or two sentences that stand alone; shown on the cards of the map
questionList:                # the questions it helps to answer, per option where it applies
  - { ref: q002, option: F, text: "why" }
sourceList: [{ title, url }]
flow:                        # optional: a process drawn as a scene (steps in ranks, a step naming a card opens it)
  stepList: [{ id, title, text?, zettel?, tone? }]
  edgeList: [{ from, to, label? }]

# a question (kind question): its text is the analysis, a section per option with the anchor option-a …
number: 2
hub: guardrail
stem: …
optionList: [{ id, text, verdict: correct | wrong, zettelList }]
answer: ADF                  # the answer of the card; answerDump: what the source of the questions says
answerConfidence: high | medium | low
clueList: [{ text, implies }]
zettelList: [keys]

# a note (kind note): target: the key of the card, place?: an anchor of it, timeCreate
```

The key of a card is the key of its asset, and its file name. The asset paths (`/zettel/{hub}/{topic}`, `/question/q001`) are an index for browsing; the hierarchy is `parent`.

## The modes

| mode | component | shows |
| --- | --- | --- |
| `explorer` (default) | `ZettelExplorer` | the left side (the map, or an outline, the questions, the notes) beside the card being read. `param`: `zettel` (the card shown first), `height`, `layout` (`split`, `map`, `card`), `panel`, `isPractice` |
| `card` | `ZettelCard` | one card in the flow of the document; `param.zettel` |

Beside the modes, two components for other blocks: `ZettelDiagram` and `ZettelNode` ([Cards on a card diagram](#cards-on-a-card-diagram)). The usage of all of them, with a live example box, is in [Zettelkasten](../comp-mdx/zettelkasten/comp-zettelkasten.md).

**The map** is the switching viewport of `cloud-dev-vis`: every card is a scene whose path is the keys from the root down (`/map/rag/rag-chunking`, a question at `/map/rag/question/q015`), so the path bar is the hierarchy. A card with a `flow` shows it first (laid out by the arranger `zettel-flow`, `ZettelArrange.js`); the view **Links** shows a card among its parent, the cards pointing at it, the cards it points at, what lies below it and the questions using it. A question scene joins each option to the cards it is about. A card keeps one node id in every scene, so a switch moves shared cards.

**Reading and editing** follow the document of the block. Reading changes nothing of the content. While the document is edited, the text of a card and of its notes is the edit body of the page's edit layer: edited block by block, with the toolbar, the insert menu and the editors every document has ([Documents that are not files](../../../main/doc_page_impl_edit.md#documents-that-are-not-files)); a note is added on the card or one of its places, then written as a document. How a question went (right, missed, to review) is the reader's own record and is kept in either mode. **Practice** hides the answers until asked.

**Making and removing cards.** While the document is edited, the foot of a card (*This card*) has **New card below** (its title asked in place; the card is made one level down, an area below the root, a topic below an area, a fact below a topic, and opened) and **Remove card** (asked once; a card with cards or questions below it, and the root, are not removed). Both are writes of the object through the mode api (`ZettelStore.cardNewRun`, `cardRemoveRun`). They stand at the foot because the toolbar the edit layer floats over a block being edited covers what is right above the text.

## Cards on a card diagram

A box is the one place its cards are kept, and other blocks use them by reference: the source path of a card (`~${frontend.name:{box}}/card/{key}.md`) is how anything outside the box names one, a link and a diagram alike. No second grammar is needed.

```text
ZettelNode      a registered node renderer (placement visualizationNode), for any card diagram:
                  renderer: { component: ZettelNode }
                  data: { zettel: "~${frontend.name:Tea}/card/green-tea.md" }
                reads the title and the summary from the card; a click follows the path as a link
                does (the home document of the box in the popup); while the diagram is edited the
                click is the editor's
ZettelDiagram   CardDiagram (its format, its visual editor, its apis) given two things for its
                create panel, the panel a double-click on the empty canvas opens while it is edited
                (cloud-dev-vis card-diagram-impl.md#sources-of-the-create-panel):
                  createSourceList   "Cards": the cards of the boxes of the page whose title has the
                                     words typed; choosing one adds a ZettelNode there
                  createActionList   "New card": a state asking for a title (with several boxes,
                                     the box first), which makes the card in its box and adds its node
                box=… on the marker narrows both to one box, by its id or its name
```

Both read and write through the stores of the page (`DocObjectFrontendStore`: the boxes are the frontend objects whose type is `zettelkasten.box` or has the explorer among its modes), never through a mode api, since a diagram is a block of any document, outside the instances of the box. Removing a node from a diagram does not remove the card from its box.

## Partitions

`content` (tracked): the cards and the questions. `note` (kept out of git, `**/.doc-page/object-frontend/*/item/note/` in the `.gitignore` of the doc page): the notes and the progress item.

## Importing cards

`comp-mdx/zettelkasten/zettel-import.mjs` puts cards written as yaml files into a box through the asset api of a running development server, creating the object when there is none; run again, it writes only what changed. In the yaml a text links a card as `[[key#place|label]]` and marks a paragraph with ` ^id`; the import writes the document form.

```sh
node comp-mdx/zettelkasten/zettel-import.mjs --server http://localhost:45190 --content <dir> --questions <questions.json>
```

## Files

```text
type.yaml                        zettelkasten.box: kinds (isDoc), partitions, modes
comp-mdx/zettelkasten/
  ZettelDoc.js                   a card as a document: frontmatter, sections and anchors, links to cards
  ZettelData.js                  the model of a box, pure
  ZettelArrange.js               the arranger of a flow (the contract of cloud-dev-vis)
  ZettelScenes.js                the provider of scenes
  ZettelStore.js                 the state of one block; adding and removing notes, the progress, through the mode api
  ZettelExplorer.jsx, ZettelReader.jsx, ZettelPanel.jsx, Zettelkasten.css
  ZettelDiagram.jsx              ZettelNode and ZettelDiagram: cards on a card diagram
  comp-zettelkasten.md           for authors, with the example box of the package (.doc-page/object-frontend/)
  zettel-import.mjs
```
