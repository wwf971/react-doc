# AWS: Design

The AWS series of the package ([README](README.md)), in `comp-mdx/aws/`: the resources a system on AWS is made of, as cards on the engine of the base series ([Card Diagram](card-diagram-impl.md)). It adds node kinds and binds them to its components; it changes nothing in the engine. What authors write is in [AWS diagrams](../comp-mdx/aws/comp-aws.md); its first subject is the storage service behind the storage type of `aws-utils` (its `doc/storage-architecture.md`).

```text
aws-node-registry.js
  kinds       aws-http-api, aws-lambda, aws-s3-bucket,          the resource card (head fields, property rows)
              aws-cognito-user-pool, aws-iam-role
              aws-dynamodb-table, aws-route-group               the table card, rows of fixed fields
              aws-log-group                                     a compact pill
              + the generic kinds of the base series            a browser, a note, a block, a scene
  registries  awsNodeRegistry                                   DiagramAws, DiagramAwsSwitch
              awsResourceNodeRegistry                           DiagramAwsResource (the kinds that are cards)
  arrangers   layers, lanes-down, lanes-across                  a system read downward
AwsArchitecture.js                                              a system of groups described as data: the provider
                                                                of its scenes (DiagramAwsArchitecture)
AwsIcon.js                                                      the official icons, where they were fetched
aws-comp.js                                                     the four components, named in comp.yaml
```

## The kinds

| Kind | Draws | Built on | Shows | Anchors |
| --- | --- | --- | --- | --- |
| `aws-http-api` | an http api of API Gateway | resource card | name, authorizer, CORS, throttle; its route groups as properties | `header`, `property/{id}`, `body`, `footer` |
| `aws-lambda` | a function | resource card | name, runtime, memory, timeout, role; its environment by name | as above |
| `aws-s3-bucket` | a bucket | resource card | name, access, versioning; key prefixes and lifecycle as properties | as above |
| `aws-cognito-user-pool` | a user pool | resource card | name, MFA; app clients and groups | as above |
| `aws-iam-role` | a role | resource card | name, who assumes it; what it allows, by service | as above |
| `aws-dynamodb-table` | a table, or one kind of its rows | table card | the patterns of `pk` and `sk`; attributes with their key (an index: `GSI PK`), type and what they hold | `body`, `header`, `attribute/{id}` (left, right), `footer` |
| `aws-route-group` | the routes of one group | table card | method, path, `token` or `none` | `body`, `header`, `route/{id}` (left, right), `footer` |
| `aws-log-group` | a log group | compact pill | name, retention | `body` |

- **A card is a schema over a generic card.** The resource kinds are `resourceCardSchemaBuild` and `ResourceNodeCard` with an icon and a family; the two tables are a schema of fixed fields (`awsRowCardSchemaBuild`, `AwsCardData.js`) drawn by `TableCard` in the look of a resource card; the log group is the pill of a brief card. Nothing is drawn from scratch.
- **A line to a table as a whole ends at its title line** (`anchorSideDrawn: 'header'`), as on every table card; a line about one attribute or route leaves its row. A line leaving a card downward, which is how a system read downward leaves most of them, leaves its **footer** ([the footer](card-diagram-usage.md#lines-out-of-the-bottom-of-a-card-the-footer)): every card has one, the pill of a log group excepted.
- **What is written is what a document of the system says.** Names keep the form of the deployment scripts, `{prefix}--{name}`; no deployment's own prefix or id is drawn.
- **A client is not an AWS kind.** A page, a browser, a script are drawn with the cards of the base series (`card-note`), in the same diagram.

## Families and the simple display

Each kind belongs to a family of services, which gives its accent (`AwsCard.css`): `aws-network` (API Gateway), `aws-compute` (Lambda), `aws-database` (DynamoDB), `aws-storage` (S3), `aws-security` (IAM, Cognito), `aws-management` (CloudWatch). The accents are the colors of the categories of the official icons, so a card agrees with its icon whether the icons were fetched or not.

Every kind has a [simple display](card-diagram-impl.md#the-display-of-a-node): a tile with the icon of its service, the name of the resource, and the name of the service under it in a small monospace line, in the look of the architecture diagrams of AWS. So one system is drawn at two levels with the same data: an overview of tiles, and the resources as cards. The icon is the official one of AWS where it was fetched ([below](#the-official-icons)), else the icon of the page in the accent of the family.

## The official icons

AWS publishes the icons of its services as a package of SVG files, for drawing architecture diagrams. The kinds use them where they are present: a service icon (`Arch_*`, a colored square of its own) is the whole tile of a node drawn simple; a resource icon (`Res_*`, a glyph: a role, a log group, a group of routes) is drawn inside a white tile. The title line of a card shows the same icon, small.

The package does not hold them. The page of the icons says "We allow customers and partners to use these toolkits and assets to create architecture diagrams", and does not say they may be passed on. So each machine that draws with them fetches them, into a folder git ignores:

```text
node package/cloud-dev-vis/script-icon/aws-icon-fetch.mjs              the current package, found on https://aws.amazon.com/architecture/icons/
node package/cloud-dev-vis/script-icon/aws-icon-fetch.mjs --zip FILE   a package downloaded by hand
node package/cloud-dev-vis/script-icon/aws-icon-fetch.mjs --list       what is there, and from which release
```

| Place | What |
| --- | --- |
| `AwsIcon.js` | `AWS_ICON_LIST`: for each kind, the name of its file in the package (`Arch_AWS-Lambda_64.svg`), and whether it is a glyph (`isFramed`). The script reads the same list, so what is fetched is said once. A new kind adds its line there |
| `comp-mdx/aws/icon-official/` | one file per kind, named by its type (`aws-lambda.svg`), and `source.yaml`: the package, its release, when it was fetched. Only its `.gitignore` is tracked |
| `AwsIconOfficial.js` | registers what the folder holds (a glob of vite), imported by `aws-comp.js` only, so the tests and a machine without the icons see none |

A kind without its file keeps the icon of the page, so nothing is broken where the icons were never fetched. A file is found by its name wherever the package keeps it, and a release that renames one is reported by the script, which leaves that kind as it was. A build made on a machine with the icons carries them (a single html file, an installed tarball): read the terms before passing such a build on.

## Layout

A system is read downward, in the order a request passes it, so the registry offers [the layer arrangers](card-diagram-arrange.md#the-layer-arrangers): `layers` places the cards and routes the lines, `lanes-down` and `lanes-across` route the lines of cards an author placed. A fresh node from the create panel has its handles where a downward reading wants them, on the card as a whole: in on top, out at the bottom (`awsHandleOf`). The starting text of each block is laid out by `layers` when it is made (`AwsSource.js`), so its first layout is the arranger's and the author edits from there.

The cards answer `contract.sizeEstimate` from their rows (`resourceCardHeightEstimate`, `rowCardHeightEstimate` with the widths of their columns), so an arranger with nothing drawn places them near where they will be.

## Components

| Component | Is | Starting text |
| --- | --- | --- |
| `DiagramAws` | `cardDiagramCompCreate(awsNodeRegistry)` | a page, an api, a function, a table and a bucket, laid out by `layers` |
| `DiagramAwsSwitch` | `cardDiagramSwitchCompCreate(awsNodeRegistry)`, scenes by path | one scene in two views: the overview drawn simple, the resources as cards |
| `DiagramAwsArchitecture` | `cardDiagramSwitchCompCreate(awsNodeRegistry, { loadBuild })`: scenes generated from a description ([below](#scenes-generated-from-a-description)) | a shop of three groups and two clients |
| `DiagramAwsResource` | `cardStandaloneCompCreate(awsResourceNodeRegistry)`, one card outside a canvas | a function |

They are mounted under `cloud-dev-vis/{tagName}`, with the dependency extractors of the base series and of the switch layer (`comp.yaml`).

## Scenes generated from a description

A larger system is drawn from a **description**: groups of resources (a backend each), the clients outside them, the relations between resources with what passes, the flows as ordered steps, and for a resource with more inside it, its detail (the routes of an api by group, the kinds of rows of a table, the parts of a function or a bucket). `DiagramAwsArchitecture` reads it (its grammar is in [A system of groups, from a description](../comp-mdx/aws/comp-aws.md#a-system-of-groups-from-a-description)) and `AwsArchitecture.js` answers its scenes as a provider of the switch layer, as a migration is drawn from its data items ([power-platform-migration.md](power-platform-migration.md)). Nothing in the scenes is placed by hand: every one is laid out by the layer arrangers each time it is built.

```text
{root}                      the clients, and a frame per group showing its resources as small tiles
                            (scene-embed of the group, view @frame, all frames at one scale, FRAME_SCALE);
                            what passes between groups and clients, one labelled line per pair
{root}/{group}              @resources (cards), @overview (tiles), @{flow} (the cards of the resources,
                            the steps of the flow as numbered lines, its note); @frame, embedded only
{root}/{group}/{resource}   its detail: route groups, kinds of rows and their links, or parts
```

A click on a frame zooms into its group; a resource with a detail opens it; a resource of another group drawn at the edge of a scene opens that group. Every id is the id of the description, so the views of a group morph into each other, and the frame of a group in the root shows the tiles of its overview, without what lies outside the group.

**Written by the backends.** The description is not written by hand: a script of each backend (`describe_architect.py` in its folder of `aws_oa`) writes its own group offline, from the config and the names its ensure script makes resources from, and merges it into a block of a document (`--write-doc DOC --block ID`), leaving the groups of the other backends as they are. [The storage architecture of aws-utils](~aws-utils:aws-utils/doc/storage-architecture.md) is drawn this way, from the storage service and the auth backend.

## Implementation

| Place | Role |
| --- | --- |
| `aws-node-registry.js` | the kinds, their simple displays and create entries, the two registries, the arrangers offered |
| `AwsCardData.js` | the families, a handle read downward (`awsHandleOf`), the cards of rows with fixed fields: schema, normalization, anchors |
| `Aws{Resource}Node.jsx`, `Aws{Resource}NodeData.js` | per kind: its card, its fields and contract |
| `AwsSource.js` | the starting texts, the example description |
| `AwsArchitecture.js` | a description checked (`awsArchitectureNormalize`) and the provider of its scenes (`awsArchitectureProviderBuild`): the root with its frames, the views of a group, the details |
| `AwsIcon.js`, `AwsIconOfficial.js`, `AwsKindIcon.jsx` | the official icons: the list of their files, what was fetched registered, the icon of a card's title line |
| `icon-official/`, `../../script-icon/aws-icon-fetch.mjs` | where the icons are fetched to (ignored by git), and the script fetching them |
| `aws-comp.js`, `comp.yaml` | the components and their manifest |
| `AwsCard.css` | the accents of the families, the look of the rows of fixed fields, the official icon on a card |
| `aws-node-registry.test.js` | every kind valid from the create panel, a cell edited and undone, rows of fixed fields, the display of a node and of a diagram, the starting texts without a line on another, the official icon of every kind |
| `AwsArchitecture.test.js` | every scene and view of the example a valid diagram, no line on another in what it lays out, an error naming its place |
