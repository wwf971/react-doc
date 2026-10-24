<!-- Design of the component state service layer. Parent document: doc_page_impl.md. This is the design document of the layer; other documents link here. -->

# Component State Service Layer: Design

A component on the page renders its data, which the document or an [asset object](doc_page_impl_asset.md) holds. Many components hold something more while they are on the page: a count, which cells are selected and which sheet is active, which folders are open, a draft being edited that is not saved yet. That is the component's **state**. Left in the component (`useState`, a store created per mount), it lives exactly as long as the mount: navigating to another document and back starts the block from scratch, and the same block shown twice holds two states that know nothing of each other.

The **component state service layer** keeps the state outside the component, in one **state object** per block, found by a **key**. A component asks for its state object and gets the one that exists, or a new one; the state outlives the mount, and every mount of the same block shares it. For the components themselves, refer to [MDX components](doc_page_impl_mdx_comp.md); for the overall architecture, [Document Page: Design](doc_page_impl.md).

```text
component (an observer)                  DocCompStateStore                            who decides the key
useCompState(config, initial)  ──────►   stateByKey: key -> state object              RegisteredComp
  │                                         { key, kind, value, holdCount, ... }        compStateKeyBuild:
  │  state.value.count  (observable)        ensure: the one there, or a new one           asset object
  │  state.patch({ count })                 hold / release: how many mounts have it        > id prop
  │                                         idle: nobody holds it, kept, collected        > place (doc, marker line)
  └─ unmount ───────────► release           by a cap and with the document                > the mount
                                            place-keyed states follow the lines the
                                            edit layer moves (docLineShift, docLineRemap)
```

## What the state is, and is not

The layer answers three questions a component should not answer alone:

- **Where does the state live while the block is not rendered?** In the store. A reader navigates away and back, a block is opened in the [block popup](doc_page_impl_popup.md) and closed, a component switches between its view and its editor: the next mount finds the state the last one left.
- **What do two renderings of one block share?** The state object. Two blocks reading one asset object, the block and its preview in the asset panel, and later the same document open in two tabs: they ask for the same key, get the same object, and what one changes the others render at once, since the object is observable.
- **When is a state thrown away?** When nothing will come back for it: its document left the source, the page itself removed the block, or the store is full and the state has been idle longest. The rule is deliberately loose, [below](#lifecycle-hold-idle-collect).

Three things the state is **not**:

- **Not data.** The data is the document's lines or the asset object's version; a state is what the component makes of it while it is shown. A draft may sit in the state while a session lasts ([Drafts and sharing](#drafts-and-sharing)), but what is saved goes where the data goes.
- **Not persistent.** It lives with the page and is empty after a reload. What must survive a reload is written into the data (a [dashboard writes its state into its asset object](doc_page_impl_service.md#dashboard-state)) or into a config layer ([the client layer](doc_page_impl_config.md#the-client-layer)).
- **Not guaranteed.** A state can be lost: the cap, a document edited outside the page. A component keeps in it what it can afford to lose and recompute: a selection, a draft the session will save anyway, an open folder.

## The key

The key is what decides which mounts share a state and whether the state is found again later, so it must name the block, not the mount, and must be as stable as the block's identity allows. The page chooses it in one place, the registry boundary (`RegisteredComp`, `config.stateKey`), from the most stable identity the block has, in this order (`lib/doc-comp-state.js`, `compStateKeyBuild`):

```text
asset:{store}/{objectId}       the data comes from the asset service layer: every block reading the
                               object shares the state, wherever the block is
id:{docPath}#{id}              the block declares an id prop (<!--renderComp=X,id=tree-->): the id a
                               data reference or a part index names the block by, unique in its document
place:{docPath}:{sourceLine}   a comment block without an id: its place, the document and the line of
                               its marker comment, the block identity of the page
                               (doc_page_impl_nav.md#places-in-a-document)
instance:{instanceId}          anything else (an MDX element, a part rendered by another component, a
                               side-panel item): the instance id of the mount, which only that mount has
```

The stability falls from top to bottom. An asset object keeps its id whatever happens to the documents. An id prop moves with the block through every edit, and is what an author declares when the state should not depend on where the block is. A place changes whenever lines above the block change: the edit layer repairs the keys for the changes it makes itself ([Following the lines](#following-the-lines-of-a-document)), and a change made outside the page (an editor, git) leaves the state behind under the old line, idle, until it is collected; the block starts anew. That is the accepted imperfection: it keeps the key a pure function of what the boundary already knows, with no index of blocks to maintain. An instance key makes the state last as long as the mount plus the idle time, which is still useful for a draft shared with a second renderer of the same mount, and costs nothing.

The place is the format the navigation layer names a block by, and an `Anchor` id declared before a block (the `fragment` of a place) would be one more stable key between the id prop and the line; it is not used today because the boundary does not know the anchor of its block, which only a scan of the document finds. The key kinds are therefore the ones above, in `compStateKeyParse`, and a key reads as text, so the list of states can be read by a person.

## Lifecycle: hold, idle, collect

```text
mount          useCompState(config, initial)
                 -> stateEnsure(key): the state object that exists, or a new one with initial
                 -> stateHold(key): holdCount + 1                     (in an effect; released on unmount)
render         state.value is observable: the component reads it, patches it (state.patch, state.set)
unmount        stateRelease(state): holdCount - 1
                 -> holdCount 0: idle, kept
idle           kept until
                 - more than idleMax (300) states are idle: the ones touched longest ago are dropped
                 - its document leaves the source (the manifest): its idle states are dropped
                 - the page removes its block (a delete, a rewrite of other lines over it)
                 - stateDrop(key) by whoever knows better
a mount again  the idle state is found by its key and held again: the block is as it was left
```

The state object is `{ key, kind, docPath, compId, value, holdCount, timeCreated, timeTouched }` (`CompStateObject`): `value` is whatever the component keeps, converted to an observable mapping when it is a plain object (a class instance, such as a draft store of a component, is kept as it is); `holdCount` how many mounted components hold it; `timeTouched` the last hold or release, which the collection orders by. `kind`, `docPath` and `compId` are read from the key and the first holder, for the lists and the collection.

Holding is counted, not owned: the layer does not know which mount is which, only how many there are, and that is enough for idle to mean "nobody shows this now". A state is never dropped while held; a mount whose block disappears under it releases when it unmounts, and the drop follows. A hold is released by the state object the hold returned, not by key, because a key may have moved meanwhile.

## Following the lines of a document

A place-keyed state names a marker line, and the edit layer moves lines with every write. Every write goes through one method, `DocEditStore.operationApply` ([DocEditStore](doc_page_impl_edit.md#doceditstore)), so that is where the layer is told, once, before the new text is compiled, so that the body rendered from the new text finds the states under their new lines:

```text
operationApply(path, operation)
  -> the file is written
  -> lineShiftListGet(operation, frontmatterLineEnd)   file lines -> lines counted without the frontmatter
       replaceLines a..b   the block starting at a is the same block (its marker stays on a);
                           a marker inside the range is gone; lines after b move by the difference
       insertLines at a    every line from a on moves by the inserted count
       deleteLines a..b    every marker of the range is gone; lines after move up
       replaceAll          nothing can be followed; the states stay where they are (and go idle)
  -> compStateStore.docLineShift(path, shiftList)      every place-keyed state of the document is re-keyed
                                                       at once (lineShiftApply), or dropped with its block
  -> the new text is compiled and rendered
```

A swap of two blocks (the move buttons) is one `replaceLines` over both, which the rule above cannot tell from an edit of the upper block; `blockMoveApply` therefore hands `operationApply` the mapping of the two marker lines itself (`stateRemapList`, the arithmetic of the usage index's move notification), and `docLineRemap` exchanges the keys of the two states in one step. The state objects stay the same objects through a re-key, so a mounted component keeps holding what it held; the hook looks its state up by key on every render, and when the recompiled body gives the component its new `sourceLine`, the lookup finds the same object under the new key, releases it under the old one and holds it under the new.

The re-key is for the edits the page makes. A change of the file by anything else arrives as new text with no operation, and the manifest tells the layer only which documents exist, so such a change is not followed: a state whose line no longer names its block is an idle state nobody asks for, and the cap collects it. This is the same stance as the usage index of the asset service layer, which can be behind and is read again ([Usage](doc_page_impl_asset.md#usage)).

## Drafts and sharing

The first reason the layer exists is a component whose data is large and whose editor must not write it on every change: a workbook. The edit layer already keeps such a draft out of the document until the session ends ([Asset-only components](doc_page_impl_edit.md#asset-only-components): the draft is reported with every change and saved into the asset object when the session is left; leaving the page saves it too, so a draft is never dirty across documents). What was still per mount is everything the editor holds beside the reported draft, and the fact that nothing else on the page could see the draft.

With the state object both change. `ExcelUniver` ([the component](doc_page_impl_mdx_comp.md#exceluniver)) keeps in its state, keyed by its asset object:

- `engine`: the active sheet and the selected cells, in view and in edit mode, taken from the engine's events and given to the next engine instance, so the selection comes back after another document, a switch between View and Edit, the popup;
- `draft`: the editor's draft store while a session is open on the object. A second block reading the same object, in view mode, renders the draft's workbook and the range typed in the editor's panel, as they change; when the session ends the editor takes the draft out, and every block shows the object again.

This is the pattern for a component with a draft: the draft lives in the state under a key of its own while the session lasts, the editor puts it there when it mounts and takes it out when it unmounts (a session that ends is always an unmount of the editor), and a view of the same block renders `state.value.draft` when there is one and its data otherwise. It is also how two tabs showing one document would share an edit in progress: the tabs are two mounts with one key, and nothing else is needed for the view side; the edit side stays one session at a time, which is the edit layer's rule.

## Api

The store (`store/DocCompStateStore.ts`, `compStateStore` in the store context), created by `DocPageMdx` with the source store and started with the other stores:

| method | effect |
| --- | --- |
| `stateEnsure(key, { initial, compId })` | the state object of the key, created with `initial` (a mapping or a factory of one) when there is none; the lookup is untracked, so a render may call it |
| `stateHold(key, options)` / `stateRelease(stateOrKey)` | one more / one less mount holding it; a release collects idle states beyond the cap |
| `stateGet(key)`, `stateList`, `idleCount` | reading: one state, every state (last touched first), how many are idle |
| `statePatch(key, patch)` / `stateSet(key, value)` / `stateDrop(key)` | the value changed from outside the component, or the state dropped |
| `docLineShift(docPath, shiftList)` / `docLineRemap(docPath, remapList)` | the edit layer: place-keyed states follow the lines |
| `docDrop(docPath)` | the idle states of a document dropped (a document that left the source) |
| `idleCollect()` | idle states beyond `idleMax` dropped, the ones touched longest ago first |

The state object: `value` (observable), `patch(mapping)` (merged into a mapping value), `set(value)`, `key`, `kind`, `holdCount`, `timeTouched`.

The component side is one hook, exported by the package (`comp-doc/registry/use-comp-state.js`):

```jsx
export const Xxx = observer(function Xxx({ data, config, onEvent }) {
  const state = useCompState(config, { count: 0 });   // config.stateKey, chosen by RegisteredComp
  return <span onClick={() => state.patch({ count: state.value.count + 1 })}>{state.value.count}</span>;
});
```

The hook holds the state for the mount and follows `config.stateKey` when it changes. A component needing more than one state object (one per sheet, one per tab) asks the store itself with keys of its own built under its `stateKey` (`${config.stateKey}:sheet:${id}`), holding and releasing them in an effect as the hook does. Nothing of this goes through the [event layer](doc_page_impl_event.md): the state is the component's own, the layer only keeps it, and a change of it is not a request the page answers.

What `RegisteredComp` gives every component for this is `config.stateKey` ([the runtime config](doc_page_impl.md#component-registry)); a component that never asks for its state costs nothing, since a state object is created on the first ask.

## Where it stands among the layers

```text
document / asset object      the data: lines, versions                     persistent, versioned
component state (this layer) what a component makes of its data while     the page's lifetime, keyed by
                             shown: selection, drafts, open folders         the block, shared by its mounts
edit session                 the one block being edited and its draft as    one at a time; the draft is
                             the editor last reported it                    saved when the session ends
config layers                settings a reader chose                        the client layer survives a reload
```

The edit layer's own per-block memory, the view mode a reader picked for a block (`blockViewModeById`, keyed by block index and dropped when the block count changes), is the same kind of thing and could move onto a state key; it stays where it is until that is worth a change.

## Extending the layer

- **An anchor as a key.** A block whose `Anchor` id the boundary knows (through the block model, which a scan already finds for the usage index) would be keyed `anchor:{docPath}#{id}` between the id prop and the place, stable across edits like an id and declared outside the marker.
- **Two tabs, one page.** Tabs of one `DocPageMdx` share its stores and need nothing. Tabs that are separate pages (two browser tabs) would need the state objects of one key to be kept in step through a channel (`BroadcastChannel`, a websocket), which is also the channel the TODO subscriptions of the event layer would use ([Extending the layer](doc_page_impl_event.md#extending-the-layer)); the key format is already the address.
- **A state that outlives the page.** A state object marked persistent could be written to the client config layer under its key and read back on the first ask; the key rule gives it a stable name only for asset and id keys, so persistence would be offered for those.

## Files

```text
frontend/src/lib/doc-comp-state.js          the key: build (the rule), parse; the line shifts of a write
                                            (lineShiftListGet, lineShiftApply)
frontend/src/lib/doc-comp-state.test.js     the key rule, the shifts, the store: hold, idle, collection, re-keys
frontend/src/store/DocCompStateStore.ts     the states (CompStateObject), hold / release, collection, docDrop
                                            with the manifest, docLineShift / docLineRemap
comp-doc/registry/use-comp-state.js         useCompState: the state object of a component, held for the mount
comp-doc/registry/RegisteredComp.jsx        config.stateKey (compStateKeyBuild)
frontend/src/store/DocEditStore.ts          operationApply tells the layer the line shifts of every write;
                                            blockMoveApply the mapping of a swap (stateRemapList)
frontend/src/DocPageMdx.jsx                 the store beside the others; init / dispose
comp-mdx/excel-univer/                      ExcelUniver: engine selection and the shared draft in the state;
                                            ExcelUniverSheet restores and reports the selection
example_doc/comp-mdx/DemoCounter.jsx        a count in the state (keyed by id or by place)
example_doc/comp-mdx/CompStateListDemo.jsx  the states the layer holds, listed
example_doc/comp-state.md                   demonstration: counts that stay, two blocks on one object, the list
```
