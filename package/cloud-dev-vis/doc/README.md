# cloud-dev-vis

A package of document components for drawing cloud architecture and the design of cloud resources. A workspace imports it by naming its folder (`packageList` of the workspace file); every doc page of that workspace can then write its components. What a package is, and the rules its folder follows, is in [Packages](../../../main/doc_page_impl_package.md).

Its main system draws **node cards** joined by **connection lines** on a React Flow canvas: one YAML data format, one look of cards and lines, one visual editor. The components are grouped in **series**, one folder each under `comp-mdx/`:

```text
cloud-dev-vis/
├── doc-package.yaml        name, description, packageDependList
├── package.json            marks the .js files as ES modules for node (tests); not an npm package
├── doc/
│   ├── README.md           this document
│   ├── card-diagram.md     the base series: data format, canvas, cards, editor, node registries
│   └── power-platform.md   the Power Platform series
└── comp-mdx/
    ├── card-diagram/       the base series       CardDiagram
    └── power-platform/     Power Platform        DiagramER, DiagramPowerAutomate, DiagramBusinessRule,
                                                  DiagramDataverseEntity
```

## Core concepts

- **Node and connection.** A diagram is nodes (what is drawn, where) and connections between named handles on them. The YAML is the source of truth; React Flow objects are derived from it and never saved ([Core Model](card-diagram.md#core-model)).
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

More in [Node Registries](card-diagram.md#node-registries).

## Where to read next

| To ... | Read |
| --- | --- |
| understand the data format, the canvas, the editor, or add a generic card | [card-diagram.md](card-diagram.md) |
| change a Power Platform card or component | [power-platform.md](power-platform.md) |
| write diagrams in a document | [Data diagrams](../../../example_doc/mdx-usage/comp-diagram-er.md), [Power Platform diagrams](../../../example_doc/mdx-usage/comp-powerplatform.md) |
| add a series for another platform | [Node Registries](card-diagram.md#node-registries): a folder with its kinds, its registry, its components and a `comp.yaml` |

## Implementation

| Place | Role |
| --- | --- |
| `comp-mdx/card-diagram/node-registry.js` | `nodeRegistryBuild`, `nodeRegistrySearch`: the registry mechanism |
| `comp-mdx/card-diagram/card-diagram-node-registry.js` | the generic kinds (`table`, `operator`) and the registry of `CardDiagram` |
| `comp-mdx/card-diagram/CardDiagram.jsx`, `CardStandalone.jsx` | the canvas and the standalone card, and their factories `cardDiagramCompCreate`, `cardStandaloneCompCreate` |
| `comp-mdx/card-diagram/DiagramERData.js`, `DiagramERStore.js`, `DiagramEdit*.js`, `DiagramRender.jsx` | normalization, the canvas model, the editor's draft and path, the node and edge components (their names keep the `DiagramER` prefix of the series they started in) |
| `comp-mdx/card-diagram/TableCard*.js(x)`, `ResourceNodeCard.jsx`, `OperatorCard.jsx` | the generic cards and their schemas |
| `comp-mdx/card-diagram/card-diagram-comp.js` | the exposure shared by every diagram component, and the definition of `CardDiagram` |
| `comp-mdx/power-platform/power-platform-node-registry.js` | the Power Platform kinds and its two registries |
| `comp-mdx/power-platform/power-platform-comp.js` | the four components of the series |
| `comp-mdx/*/comp.yaml` | the manifests: tag names, modules, and the build-time dependency extractor (`dependencyCollect`) |
