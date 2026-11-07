# cloud-dev-vis

A package of document components for drawing cloud architecture and the design of cloud resources. A workspace or a doc page imports it by its folder or its name (`packageList`); every doc page of that workspace can then write its components. What a package is, and the rules its folder follows, is in [Packages](../../../main/doc_page_impl_package.md).

Its main system draws **node cards** joined by **connection lines** on a React Flow canvas: one YAML data format, one look of cards and lines, one visual editor. The components are grouped in **series**, one folder each under `comp-mdx/`:

```text
cloud-dev-vis/
├── doc-package.yaml        name, description, packageDependList
├── package.json            marks the .js files as ES modules for node (tests); not an npm package
├── doc/
│   ├── README.md               this document
│   ├── card-diagram-usage.md   drawing with the framework: what to choose, the conventions, the checks
│   ├── card-diagram.md         changing the framework: the standards, the checklists (read before changing anything)
│   ├── card-diagram-connection-line.md  shaping a line by anchors and handles: design, implementation, usage
│   ├── card-diagram-arrange.md          arrangers, which lay out a diagram by rules: for a generator, a first layout, or by hand
│   ├── card-diagram-impl.md    the base series, design and implementation: data format, canvas, cards,
│   │                           editor, history, node registries
│   ├── power-platform.md       the Power Platform series, design
│   ├── card-diagram-animation.md  the animation of a card diagram, design
│   ├── card-diagram-flexible-switch.md  many scenes in one viewport, design
│   ├── power-platform-migration.md  a database migration as data: its items, scenes and editors
│   ├── comp-diagram-er.md      for authors: DiagramER, CardDiagram, DiagramDataverseEntity, reading and editing
│   ├── comp-powerplatform.md   for authors: DiagramPowerAutomate, DiagramBusinessRule
│   ├── comp-card-diagram-animation.md  for authors: CardDiagramAnimation, DiagramERAnimation
│   └── comp-card-diagram-switch.md  for authors: CardDiagramSwitch, DiagramERSwitch
├── .doc-page/              makes the package a doc page: entry, source rules, side panel, assets of its
│                           demonstrations, the template of its playground
└── comp-mdx/
    ├── card-diagram/       the base series       CardDiagram
    ├── card-diagram-animation/  animation        CardDiagramAnimation
    ├── card-diagram-switch/  scenes by path       CardDiagramSwitch
    ├── demo/               what its documents demonstrate with: MigrationStep
    └── power-platform/     Power Platform        DiagramER, DiagramPowerAutomate, DiagramBusinessRule,
                                                  DiagramDataverseEntity, DiagramERSwitch;
                                                  migration/: the modes of a migration as a frontend object
```

The documents written for authors are the usage documents of the components, with live examples. The package is a doc page as well ([A package as a doc page](../../../main/doc_page_impl_package.md#a-package-as-a-doc-page)): `react-doc dev package/cloud-dev-vis` shows them alone, and the workspace of the project lists it beside its demonstration. Read so it is read-only, also its assets, except its playground.

## Core concepts

- **Node and connection.** A diagram is nodes (what is drawn, where) and connections between named handles on them. The YAML is the source of truth; React Flow objects are derived from it and never saved ([Core Model](card-diagram-impl.md#core-model)).
- **Draft and history.** While a block is edited, a draft of the same YAML is the truth, changed only through the store's one method, which validates every change and records it, so every command can be undone and redone within the session; the selection is not recorded, and nothing of the history is saved ([History](card-diagram-impl.md#history)).
- **Node kind.** Everything the engine knows about one node type (`renderer: { type: ... }`): how to check its data, which anchors it offers, the rows and fields the editor works with, the card that draws it, and how the create panel makes a new one.
- **Node registry.** The list of kinds one diagram component can draw and create. It is fixed per component type, in code.
- **Series.** A folder of components sharing one registry. The **base series** (`card-diagram`) holds the engine and the generic kinds; every other series is a list of kinds plus the components bound to them.

```text
base series (card-diagram)                         a platform series (power-platform, later aws ...)
  engine: canvas, stores, editor, create panel  <-   its kinds: contract, schema, card, create entry
  generic cards: table, resource card, operator <-   uses them for its own cards
  node registry mechanism                       <-   builds its registry, binds it to its components
  CardDiagram = engine + { table, operator }         DiagramER = engine + { table, operator, dataverse-..., ... }
```

## The design pattern

1. **The engine knows no platform.** Nothing in `card-diagram/` imports a platform series. Everything specific to a node type comes from the registry the component is given; adding a series adds a folder and changes nothing in the base.
2. **One registry per component type.** Each series builds its own registry and binds it to its components (`cardDiagramCompCreate`, `cardStandaloneCompCreate`). A diagram only offers, and only reads, the kinds of its registry, so a Power Platform diagram never offers the cards of another platform, and a node of the wrong series is an error that names the types the diagram knows. Combining registries by configuration is left for later; a combination today is a registry written in code (the Power Platform registry includes the generic kinds of the base series this way).
3. **New cards are schemas over the generic cards.** The table card has any number of fields and rows; the resource card has head fields and property rows. A platform card is a schema on one of them plus, at most, a small variant (an icon, an accent color, a badge).
4. **Registered components stay open to every diagram.** A node drawn by a component of the page (`renderer: { component }`) is not a kind of any registry; it is resolved through the component registry of the page, in every diagram.
5. **One place for every change of the draft.** A command of the editor, of the base or of a series, changes the draft through `DiagramEditStore.changeApply` and nowhere else: validation, the message of a refusal, the path's redirects and the history of undo / redo all hang on that one place, so a series gets them without writing them.

More in [Node Registries](card-diagram-impl.md#node-registries) and [History](card-diagram-impl.md#history).

## Where to read next

| To ... | Read |
| --- | --- |
| **draw diagrams** (by hand or from a generator) | [card-diagram-usage.md](card-diagram-usage.md), which points to the rest |
| try something out | the **Playground** of the side panel: a document git ignores ([Playground documents](../../../main/doc_page_impl_test.md#playground-documents)) |
| shape a connection line, or keep lines off each other | [card-diagram-connection-line.md](card-diagram-connection-line.md) |
| lay out a diagram by rules, or write an arranger | [card-diagram-arrange.md](card-diagram-arrange.md) |
| change anything of the framework, add a kind, a series or a command | the guidance [card-diagram.md](card-diagram.md) first: the standards and the checklist of that kind of change |
| understand the data format, the canvas, the editor, the history, or add a generic card | [card-diagram-impl.md](card-diagram-impl.md) |
| change a Power Platform card or component | [power-platform.md](power-platform.md) |
| write diagrams in a document | [Data diagrams](comp-diagram-er.md), [Power Platform diagrams](comp-powerplatform.md) |
| make a diagram move between named states | for authors [Card Diagram Animation](comp-card-diagram-animation.md); the design [card-diagram-animation.md](card-diagram-animation.md) |
| show many diagrams in one viewport, by path, with smooth switching | for authors [Card Diagram Scenes](comp-card-diagram-switch.md); the design [card-diagram-flexible-switch.md](card-diagram-flexible-switch.md) |
| keep a database migration as data and draw it | [power-platform-migration.md](power-platform-migration.md) |
| add a series for another platform | [Adding a series](card-diagram.md#adding-a-series), then [Node Registries](card-diagram-impl.md#node-registries): a folder with its kinds, its registry, its components and a `comp.yaml` |

## Implementation

| Place | Role |
| --- | --- |
| `comp-mdx/card-diagram/node-registry.js` | `nodeRegistryBuild`, `nodeRegistrySearch`: the registry mechanism |
| `comp-mdx/card-diagram/card-diagram-node-registry.js`, `CompactCard.jsx` | the generic kinds (`table`, `operator`, `card-note`, `card-brief`, `card-database`, `card-matrix`, `scene-box`) and the registry of `CardDiagram` |
| `comp-mdx/card-diagram-animation/` | the animation: [card-diagram-animation.md](card-diagram-animation.md#implementation) |
| `comp-mdx/card-diagram-switch/` | scenes by path: [card-diagram-flexible-switch.md](card-diagram-flexible-switch.md#implementation) |
| `comp-mdx/power-platform/migration/` | a migration as data: [power-platform-migration.md](power-platform-migration.md#implementation) |
| `comp-mdx/demo/migration-step/` | a registered node renderer the documents demonstrate |
| `comp-mdx/card-diagram/CardDiagram.jsx`, `CardStandalone.jsx` | the canvas and the standalone card, and their factories `cardDiagramCompCreate`, `cardStandaloneCompCreate` |
| `comp-mdx/card-diagram/DiagramERData.js`, `DiagramERStore.js`, `DiagramEdit*.js`, `DiagramRender.jsx` | normalization, the canvas model, the editor's draft and path, the node and edge components (their names keep the `DiagramER` prefix of the series they started in) |
| `comp-mdx/card-diagram/DiagramRoute.js`, `DiagramRouteControls.jsx`, `DiagramApiList.js`, `DiagramCanvasRegistry.js` | the route of a line, its controls, and the apis of a diagram: [card-diagram-connection-line.md](card-diagram-connection-line.md#implementation) |
| `comp-mdx/card-diagram/DiagramArrange.js`, `comp-mdx/power-platform/er-arrange/` | the contract of an arranger, and the arrangers of ER diagrams: [card-diagram-arrange.md](card-diagram-arrange.md) |
| `comp-mdx/card-diagram/DiagramEditHistory.js` | `EditHistory`: the history of a draft (steps, typing groups, undo, redo), generic over the state its owner records; `DiagramEditStore` records in it from `changeApply` and `DiagramVisualEdit` offers it in the bar and on the keys |
| `comp-mdx/card-diagram/TableCard*.js(x)`, `ResourceNodeCard.jsx`, `OperatorCard.jsx` | the generic cards and their schemas |
| `comp-mdx/card-diagram/card-diagram-comp.js` | the exposure shared by every diagram component, and the definition of `CardDiagram` |
| `comp-mdx/power-platform/power-platform-node-registry.js` | the Power Platform kinds and its two registries |
| `comp-mdx/power-platform/power-platform-comp.js` | the four components of the series |
| `comp-mdx/*/comp.yaml` | the manifests: tag names, modules, and the build-time dependency extractor (`dependencyCollect`) |
