# Card Diagram: Building on the Framework

The base series of the package ([README](README.md)) is a framework: a React Flow canvas of node cards and connection lines, one YAML data format, one draft store with a history, one visual editor, and the node registry through which a series plugs its own cards in. This document is the **guidance** for anyone implementing on it: the standards every piece follows, the things most often forgotten, and the checklists to go through before a change is done. It does not describe how the framework works inside; that is the **design and implementation introduction, [card-diagram-impl.md](card-diagram-impl.md)**, to be read first for the data format, the canvas, the editor, the path, the history and the registries. The Power Platform series is the example of a series built on the framework ([power-platform.md](power-platform.md)); what authors see is in [comp-diagram-er.md](comp-diagram-er.md) and [comp-powerplatform.md](comp-powerplatform.md), beside this file.

What the page asks of every block-like component (the popup surface, the no-jitter rule, the editor contract) is not repeated here: [Block-like MDX components](../../../main/doc_page_impl_mdx_comp_block.md) and [Component edit mode](../../../main/doc_page_impl_edit.md#component-edit-mode) are read together with this document, and their checklists apply.

## Know what kind of change you are making

```text
a new card of a platform         a kind: contract + schema + Card + create entry, in a series folder
a new platform                   a series: a folder of kinds, a registry, components, a comp.yaml, a doc
a new thing the author can do    a command of DiagramEditStore (and the control that calls it)
a change of how cards are drawn  TableCard / ResourceNodeCard / OperatorCard and their css
a change of the canvas           DiagramERStore, CardDiagram, DiagramRender
a change of the data format      DiagramERData (normalization) first, then everything that reads it
```

Each kind of change has a checklist below. Most mistakes come from making one kind of change in the place of another: a card's styling in the engine, a command's validation in a control, a series' knowledge in the base.

## The standards

**1. The engine knows no series.** Nothing in `comp-mdx/card-diagram/` imports from a series folder. Everything specific to a node type (how its data is checked, which anchors it offers, what its card draws, how a new one starts) is in its kind, read from the registry the component is given. A series adds a folder; it changes nothing in the base. If a change to the base is needed for a series, it is a generic capability (a new field kind of the schema, a new render hook of the table card), named generically.

**2. One registry per component type, and a kind is complete.** A kind declares its `type`, `contract`, `schema`, `Card` and `create` together, in the registry of its series ([Node Registries](card-diagram-impl.md#node-registries)). A diagram offers and reads only the kinds of its registry; a node of another series is an error naming the known types, never a guess. Combining registries is written in code today ([TODO](../../../main/doc_page_impl_TODO.md#package-registry-import)).

**3. The YAML is the truth; React Flow objects are derived.** Nodes, edges, measurements, selection, camera and hover are runtime data and are never saved. A command that wants something kept writes it into the draft (a node position, a free end's point), never into the canvas store ([React Flow Boundary](card-diagram-impl.md#react-flow-boundary)).

**4. Every change of the draft goes through `changeApply`.** `DiagramEditStore.changeApply(change, { groupKey })` is the one place a draft changes: it clones the YAML document, applies the change, validates with the same normalization the view uses, keeps the previous draft with the message when the change is invalid, re-resolves the path, and **records the step in the history**. A command that assigns `documentDraft`, `valueCurrent` or `rawDraft` itself, or changes the draft in a control, breaks validation, the path and undo at once. This is also what makes the history a property of the framework: **a series gets undo and redo for every command it adds without doing anything, as long as the command changes the draft through `changeApply`** ([History](card-diagram-impl.md#history)).

**5. The history records the draft, nothing else.** Selection (the path), the cell being typed, a gesture, the create panel, the camera and the save target are the state of the editor, not of the draft: they are never a step, and an undo re-resolves the path against the restored draft instead of restoring it. Typing is one step per cell or field (a `groupKey`); a picked value is a step of its own. The history belongs to the session: it starts empty when the session opens with the data, is dropped when a save or a cancel closes the session, and is never written with the data (frontend only, by design).

**6. The selection is one state, the path.** Everything the edit card and the highlights show is read off the path ([The path of the edit card](card-diagram-impl.md#the-path-of-the-edit-card)); there is no second copy of the focus. A command that creates something focuses it (`select`, `selectConnection`, `pathSet`); a command that removes something goes to the list the thing was in; everything else leaves the path alone and lets `pathNormalize` redirect what is gone. A path is never left pointing at something that does not exist.

**7. Nothing is discarded silently.** Removing what others depend on (a handle with lines, a row with handles, a node with lines) reroutes or detaches the dependents and keeps them visible (a free end), never refuses for being connected and never deletes them (`endpointsDetach`, the reroute rule of `handleSideSet`).

**8. A refused change says why and changes nothing.** Validation throws inside the change with a message that names the thing (`Connection "x" cannot move …`, `A table keeps at least one column.`); the store keeps the message, the draft, the path and the history as they were. A control never validates on its own what the store validates; a control may only grey itself out with the same reason as its title.

**9. The same renderer in both modes, and entering moves nothing.** The editor renders the read view and hands it an `editor`; a cell starting or ending editing keeps its box; the bar and the edit card float; the card keeps its top edge. These are the page's rules ([the no-jitter rule](../../../main/doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)) and they are measured, not assumed.

**10. The canvas is fast because objects keep their identity.** `nodeList` and `edgeList` are shallow observables of plain objects; a change replaces only the item it names; a card's props keep their identity across frames. No deep clone of the lists, no object rebuilt per render, no measurement repeated when nothing changed ([React Flow Boundary](card-diagram-impl.md#react-flow-boundary)). A draft reloaded into the canvas keeps the place of every node, unless the draft now says otherwise (a remembered, cleared, locked or undone position): then the draft wins.

**11. The keys belong to the editor.** Escape steps out and never ends the session; Ctrl/⌘ + Enter saves; Ctrl/⌘ + Z and Ctrl/⌘ + Shift + Z (or Y) undo and redo; the editor handles them first and stops their propagation, so no keyboard map of the page takes them from an open editor ([Keyboard maps](../../../main/doc_page_impl_api_hotkey.md)). In a text being typed the undo keys stay the browser's: the typing they take back reaches the draft through the field's input event, as the typing did.

**12. Reading writes nothing.** In view mode nothing is draggable or editable; the wheel over a card is the wheel over the canvas; the camera is remembered for the block and dropped with the page.

## Adding a command to the editor

A command is a method of `DiagramEditStore` (or of a store a series adds on the same terms), called by a control through `editor.change(() => store.xxx(...))`, which reports the draft to the page after it.

| | Check |
| --- | --- |
| ☐ | The draft changes only inside `changeApply`; the method returns `true` / an id, or `false` / `null` when refused |
| ☐ | Validation throws inside the change with a message naming the thing; nothing is checked in the control instead |
| ☐ | **History:** a typed value passes a `groupKey` (`field:node/row/field`, `column:node/field`, `connection:id/field`); a picked, dragged-and-dropped, inserted or removed thing passes none. If the command opens a typing session of its own, it closes the group when it ends (`history.groupClose()`), as `cellEnd` does |
| ☐ | **History:** the command's whole effect is in the draft, so an undo puts it back entirely; if it must also touch the canvas (a position), the canvas follows the draft on reload, not the command |
| ☐ | **History:** `undo()` after the command restores exactly what was there (test it in `DiagramEditStore.test.js`: command, undo, compare; redo, compare) |
| ☐ | A command that creates focuses its result; a command that removes goes to the list; nothing else moves the path, and the path is never a step |
| ☐ | A dependent of what is removed is rerouted or detached, never dropped |
| ☐ | The control is greyed out with the reason as its title when the command cannot apply, never missing |
| ☐ | The gesture, if any, sets `interaction` while it lasts (the edit card hides, undo waits) and clears it at its end, also when the drop is refused |
| ☐ | The rule is written for authors in [comp-diagram-er.md](comp-diagram-er.md) (Visual Editing) and demonstrated in `example_doc/` |

## Adding a kind

| | Check |
| --- | --- |
| ☐ | The kind is declared in the registry of its series with `type`, `contract` (`dataNormalize`, `anchorListGet`, `sizeDefault`, `sizeMin`), `schema`, `Card`, `create` |
| ☐ | The card is a schema over a generic card (the table card, the resource card) plus at most a small variant (an icon, an accent, a badge, a cell hook); a card drawn from scratch is the exception and says why |
| ☐ | `dataNormalize` keeps unknown authored data, refuses invalid values with a message naming the node, and never fetches or executes anything |
| ☐ | Every anchor `anchorListGet` lists is attached by the card (`anchorRef`); the title line is an anchor only if the kind says so |
| ☐ | The fields the schema marks fixed are still focused and listed in the editor, with their buttons greyed out and the reason (`reasonFieldListFixed`) |
| ☐ | The cells use `CardCell` / the injected text control, so typing goes through `fieldSet` (and therefore the history); no input of its own |
| ☐ | A fresh node from `create` is valid as it is, with explicit handles where the author would expect them |
| ☐ | The kind has a test beside the registry (as `OperatorNodes.test.js`), covering normalization, the schema's rows and fields, a cell edit and its undo |
| ☐ | The series document and the usage document describe it; `example_doc/` shows it |

## Adding nodes that are not kinds

A node drawn by a registered component of the page (`renderer: { component }`) needs no kind: the create panel adds one with `DiagramEditStore.nodeComponentAdd(compName, data, position, idPrefix)`, and an entry of the panel that carries `nodeComponent: { compName, data, idPrefix }` is created that way by `createChoose`. That is how the objects of the page's object search become nodes (`ObjectView`, `data: { object }`). Keep it so: the engine names the component, it never imports it or knows what its data means, and a source of such entries other than the object search (a template gallery, a clipboard) is one more list of entries in the panel, not a change of the engine.

| | Check |
| --- | --- |
| ☐ | The entries come from a service of the page reached through `config` (`config.object`), never from an import of a page store by the engine |
| ☐ | The entries are searched only once something is typed, and never list more than a bound; a source that has more says how many (the object search's summaries) |
| ☐ | The node is added through `nodeComponentAdd` (so `changeApply`, validation and undo apply) and the component declares the placement `visualizationNode` |

## Adding a series

| | Check |
| --- | --- |
| ☐ | A folder under `comp-mdx/` with its kinds, its registry (`nodeRegistryBuild({ id, kindList, cardLegacyConvert? })`, usually including `cardDiagramNodeKindList`), its components (`cardDiagramCompCreate`, `cardStandaloneCompCreate`), a `comp.yaml` naming them with the dependency extractor |
| ☐ | Nothing of the series is imported by `card-diagram/`; the series imports the base by relative path |
| ☐ | A document `doc/<series>.md` (design), a usage document for authors beside it, both reachable from the README's tables; the package's `README.md` tree and tables list the folder |
| ☐ | The tests of the base still pass unchanged, and the series has tests of its own; the test command in [power-platform.md](power-platform.md#mapping-operators) lists them |
| ☐ | A diagram of the series started from the insert menu is a small complete example (`sourceDefaultCreate`) |

## Changing the canvas or the cards

Things to be careful about, each learned once:

- **Identity.** Do not rebuild node or edge objects in render; decorate them once per flag set (`decorate` in `CardDiagram.jsx`). A new prop object per frame makes every card re-measure its anchors and dragging sluggish.
- **Positions.** A dragged node's position lives in the canvas store until the drop writes it into the draft (`nodeMove`, read a frame after the drop). A draft reloaded keeps runtime positions for nodes whose authored position did not change, and takes the authored one when it did; `positionsTemporary` is forgotten for such a node. Keep this when touching `sourceLoad`, or an undo of a move will leave the node where it was dragged.
- **Measurement.** Repeat layout only when automatic geometry changed (`measurementSet` ignores sub-pixel changes); never on camera movement or render.
- **The wheel and the drag.** Every row of a card is `nodrag nopan` (a drag in it selects text), the title line is not (a drag pans or moves), nothing is `nowheel` (the wheel zooms everywhere in the box). A sub-area that must scroll itself opts out explicitly and scrolls itself.
- **Handles.** Runtime handle ids derive from `direction` (a `both` handle has two runtime ids mapped back to one authored id); side and position are not part of an id; after rows reorder or an anchor moves, call `updateNodeInternals`.
- **Free ends** are hidden point nodes (`~end:<role>:<id>`); authored ids may not start with `~`. A gesture ending on a point node is not a handle drop.
- **Edit layout equals read layout.** A cell is text in one mode and a control of the same box in the other; a row or field toolbar floats beside the card and undoes the zoom (the custom property of the canvas), so it keeps its screen size.
- **Styles** are the shared classes of the edit layer where one exists (`.doc-button-icon`, `.doc-button-group`, `.doc-path`, `.doc-note`); the series css holds what is the series' own (an accent, a header color), never a second button style.

## Tests and documents

From `main/frontend`:

```sh
node --import tsx --import ./src/lib/node-test-register.js --test ../../package/cloud-dev-vis/comp-mdx/card-diagram/DiagramERData.test.js ../../package/cloud-dev-vis/comp-mdx/card-diagram/DiagramEditStore.test.js ../../package/cloud-dev-vis/comp-mdx/card-diagram/DiagramEditPath.test.js ../../package/cloud-dev-vis/comp-mdx/card-diagram/DiagramEditIntegration.test.js ../../package/cloud-dev-vis/comp-mdx/power-platform/OperatorNodes.test.js
```

The store is tested on the registry of the Power Platform series, which holds every card variant; a change of the engine is tested there, a change of a series beside the series. Every command has a test of its effect **and of its undo**. The page is then checked in the browser, in the demonstration (`example_doc/`, the documents of the MDX Components part): entering edit mode moves nothing, the command works from its control and from the keys, Ctrl/⌘ + Z takes it back, Save clears the bar's history buttons.

Documents to keep in step, by what changed: a rule of the engine goes into [card-diagram-impl.md](card-diagram-impl.md) (what exists, integrated, never a changelog); a rule authors meet goes into [comp-diagram-er.md](comp-diagram-er.md) or the usage document of the series; a new file goes into the README's implementation table; a gap left for later goes into the project's [TODO](../../../main/doc_page_impl_TODO.md), not into a document as a note. The page-level documents in `main/` change only when the contract of every block-like component changes.

## Definition of done

| | Check |
| --- | --- |
| ☐ | The checklist of the kind of change above is gone through |
| ☐ | The checklist of [Block-like MDX components](../../../main/doc_page_impl_mdx_comp_block.md#checklist) still holds for every diagram component |
| ☐ | Every change of the draft is undone and redone correctly, in the tests and in the browser; the selection is not a step; the history is empty when the block enters edit mode and gone after a save |
| ☐ | The engine imports no series; the series imports only the base |
| ☐ | Tests pass; the documents named above say what exists now |
