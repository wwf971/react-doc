---
title: Component State
description: What a component keeps between renders and across its unmount, kept by the component state service layer
---

A component on the page often holds more than its data: a count, which cells are selected, a draft that is not saved yet. The **component state service layer** keeps that in a state object outside the component, so that the block is as it was left when the reader comes back to it, and so that every rendering of the same block shows one state. The design is in `doc_page_impl_mdx_comp_state.md`.

## A count that stays

The two counters below keep their count in the layer. Click them a few times, go to another document, and come back: the counts are still there. The first counter declares an `id`, so its state is keyed by `id:{document}#counter-a` and follows the block whatever is edited above it; the second has no id and is keyed by its place, the line of its marker comment. Hover a counter to see its key.

<!--renderComp=DemoCounter,id=counter-a,label=with id-->
```text
A counter; a plain Markdown viewer shows this text in its place.
```

<!--renderComp=DemoCounter,label=by place-->
```text
A counter; a plain Markdown viewer shows this text in its place.
```

In edit mode, insert a paragraph above the second counter: its marker moves down a line, and the edit layer moves its state with it, so the count stays. A change made outside the page (an editor, git) is not followed: the block then starts from zero, and the old state stays idle until the store collects it. Declare an `id` on a block whose state should not depend on that.

## One state, two blocks

Both spreadsheets below read the asset object `quarterly sales`, so they share one state object, keyed by the object. Open the editor on either one (the **Edit** button of its toolbar in edit mode): the other block shows the workbook as it is edited, cell by cell, and the range typed in the editor's panel. Save or cancel, and both show the object again. Select some cells or switch the sheet in one of them, go to another document and come back: the selection is restored, in both.

<!--renderComp=ExcelUniver-->
```asset
store: local
name: quarterly sales
```

The draft is in the state only while the editor is open; what is saved is still written into the asset object when the session ends, as for every asset-only component. The state is not a place for anything that must survive a reload of the page.

## What the layer holds

Every state object the layer holds now, read from the store: its key, how many mounted components hold it (`idle` when none does; idle states are kept, up to a cap, for the block to come back), when it was last held or released, and a short view of its value. The counters and the spreadsheets above are in the list, and so is this list itself.

<!--renderComp=CompStateListDemo-->
```text
The states of the components of the page; replaced by the CompStateListDemo component.
```
