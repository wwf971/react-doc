<!-- This is a minimalist requirement document, aiming at letting reader get a overall grasp of core concepts/workflows, and design and implementation requiremen, at a few glances-->

The file system should support automatically rendering a beautiful and organized doc page, with highly customizable ui layout and behavior, based on local directories and files, including mdx, md and other files.

## Document Source

The source of documents in its most complete form is `0..N folder + 0..N file`. The source should be represented as a list of rules, for exapmle:

```
add xxx folder
add files: /path/to/file1, /path/to/file/2
remove files with file name pattern: *.pyc
remove file with path pattern: **/.gitignore

# remove all things in /xx/yy/ folder, except one file
remove folder with path pattern /xx/yy/
add file with path /xx/yy/zz 
```

The files/folders included in source should eventually be parsed by executing the list of rules in order, and form the following structure. In its most complete form, it should be multi-root(of course it can be single-root in case only one root item exists).

```text
source
  ├──root folder1
  ├──root folder2
  ├──root file1
  └──root file2
```

And the internal representation of a folder/file should always be `/{root-folder-or-file-id}/xx/yy/`. We use id for root folder/file, so that we can deal with situation when there are root items with same name.

For files other than md/mdx, there should be a default display, and display strategies based on file suffices should also be supported. For example, python scripts can be treated as a markdown file with a title(being its file name) and a one single code block.

Source should be able to be specified from a config file, typically using yaml, and with file name `source.yaml`.

## SidePanel

Custom side panel structure should be supported, not necessarily plainly reflecting the file tree structure of source. The custom side panel tree structure should be able to be specified from an index config file.

The core design idea is that each item in the side panel tree does not necessarily correspond to a file or a folder in the tree, but can also be virtual node.

A non-leaf item should suport follwoing mode:

1. Be a virtual folder, under it that can be other items, such as real files.

2. Represent a folder in the source(not necessarily root folder). So the subtree under it will be fully reflecting the actual file tree structure under that folder. Files will appear as descedant items and be displayed in normal way.

3. represent a file in the source, similar to a leaf-item bound to a file. when bound to a file, navigation behavior to this non-leaf item will be revoled to navigation to the file bound to the non-leaf item itself, instead of the first item under it according to tree order. clicking an inactive non-leaf item label should only navigate to its bound file without changing its collapse/expand state; clicking the active label should toggle collapse/expand while remaining on the bound file(therefore, double clicking the label can navigate to the item and then toggle it). clicking its chevron should only toggle collapse/expand. this behavior should be highly customiable, and ui behavior listener and navigation logic should be decoupled.

A leaf item should support following mode:

1. Repersent a file in the source. the file can be specified by its path, or only by its name. In latter case, the item declares that it holds the file inside the source with given name. In case multiple files of given name exists, the first file under a default order will be selected. there will also be a warning area prepended, listing all matched files, warning user to deal with the problem

2. Have the panel to its right rendered using a component. the component is speicied by its name, as well as the data to be fed into it. the component will be resolved from the unified component registry.

All items should support custom display name in the side panel, or even using custom component. the component is specified by component name, and data to be fed to it. the component will be resolved from the unified component registry.

For the time being, we still assume that only leaf item can have corresponding panel to the right.

It's totally possible that there exists multiple leaf items that correspond to same file in source.

For config file that describes that side panel's tree structure, the data format should be well designed, and keep things clean and clear.

### Part index

A side-panel node can be declared as the root of a semantic part. The node and all of its descendants belong to that part, except descendants under a more deeply nested part root. A part can bind an index by a pair of stable identifiers:

1. the side-panel document item id that owns the index component;
2. the component id authored inside that document.

This binding must not duplicate the index data in the side-panel config. The document system should load the referenced document, query the identified component's authored data and registered component type, and render it through the ordinary component registry. The component id must be unique within the referenced document, and a part index reference is valid only when the registered component declares itself as component type `index`.

When the current document belongs to a part with a valid index, the desktop local-index area should show a segmented control that switches between the ordinary **On this page** heading index and an **In this part** index. **In this part** is selected by default. The page/part selection is global document-page UI state, so it remains unchanged when navigating to another document or part. Floating display mode remains UI state owned by the MobX document store.

A hosted part index can optionally switch between its normal docked location and a floating panel. The floating panel is placed at the top-right of the page by default. The docked/floating segmented control belongs at the rightmost side of the index title line. This control must not appear when the same index is rendered as an ordinary component inside an MDX/Markdown document.

In hosted placement, the index title is left-aligned and wraps naturally. The docked/floating control remains on the title row only when enough width exists and otherwise wraps below the title. The index must not create its own vertical scrollbar; the document page remains the vertical scrolling surface even when the index is taller than the document content. An index link targeting the current source document is highlighted with a yellow background.

An index type may allow a subtopic to replace its ordinary item list with a custom component from the unified component registry. The authored index data supplies the component name and its semantic data, while the runtime host supplies placement and instance context. The nested component uses the same `{ data, config, onEvent }` interface as every other registered component and must submit navigation through the centralized navigation layer. A subtopic must choose either an item list or one custom component, not both.

A hosted index and its nested custom components may opt in to navigation notifications through a runtime subscription supplied by the document host. A notification describes the successfully applied destination, including a monotonically increasing request version, side-panel route and item, source document path, and fragment. Repeated navigation to the same destination must still publish a new notification. Failed navigation attempts must not be published as current-location changes. The subscription must also provide route-aware target matching so a custom index does not duplicate document-path, side-panel-alias, or fragment resolution rules.

Only the hosted index associated with the current document's semantic part is active and eligible to receive these notifications. It remains active when the local-index control is switched to **On this page**, even though its visual content is hidden, so it is already synchronized when **In this part** is selected again. Navigating to another part must dispose the previous hosted index's subscriptions before activating the new part's index. Indexes embedded as ordinary document content and indexes belonging to other parts must not receive hosted-index notifications merely because their source has been collected or compiled.

This mechanism must be opt-in and index-agnostic. An ordinary index need not perform work for a navigation notification. A visual index such as a screen mini-map can subscribe, match the current document against the targets represented by its sections, and highlight the matching section. The document store must not contain mini-map-specific section-selection logic.

The complete part-index feature must be globally configurable. It is enabled by default; floating mode is also enabled by default. Disabling the part-index feature restores the ordinary local page index without requiring changes to side-panel part declarations or document content.


## Unified Component Registry

The document page should maintain a unified component registry, supporting registering a component with given name, and fetching a component by component name. The component can be provided not only to mdx, but also used elsewhere such as side panel item that wants custom component to render themselves, and their main. 

There should be a standard of the interface of custom components that can be registered, including a unified prop shape etc.


## Link/Ref system

Link/Ref system consists of at least the following major logical layers:

1. Parse/Render layer. Identify from content of the source documents valid link format that points to another place(not necessarily valid). Links are typically identified from string patterns in raw text. Note that some custom components might also support navigation behavior, and can specify where they want to navigate to upon certain ui behavior, but they might not be handled by parse/render layer.

2. Route layer. This layer maintains for a file in source, what items are bound to it, and when navigating to it, which item to go to(in case multiple items correspond to same file in source). For the time being, let us simply go to the first item according to tree order. Note that this might include items automatically collected as descendants of an item that bound to a folder.

3. Navigation layer. Triggers proper navigation behavior upon user clicks a link or performs certain behavior upon components that support navigation. Navigation attempt should be submitted to a centralized navigation logic, to support recording of navigation history, required for redo/undo operations.

A navigation target may include a document-local place indicator after `#`, for example `/root-id/guide.md#configuration`. The route layer resolves the document portion, while the navigation layer keeps the fragment as part of the destination, loads the resolved document, and scrolls to the matching element id after rendering. The destination receives a persistent yellow highlight until the next document/place navigation, so the user can distinguish the exact destination after scrolling. Plain Markdown may declare a stable heading destination by placing `<span id="configuration"></span>` immediately before the heading; compilation must preserve that destination on the rendered heading without enabling arbitrary MDX behavior in `.md` files. If a matched id nevertheless belongs to an empty authored anchor marker, the first following content element is highlighted instead.

Every successful navigation request must apply its destination behavior even when its resolved document and fragment are identical to the current state. Selecting a document-only index link again resets the vertical scroll position to the document top. Selecting the same document-plus-place index link again scrolls to that place and reapplies its destination highlight. Document-plus-place navigation, including requests emitted by custom components, must go through the same centralized navigation and history logic as document-only navigation. Backward and forward navigation therefore restore both the document and the recorded place.

If a document link resolves to a source file that is not represented in the side panel, activating it must show a warning tooltip anchored to that link. The warning must not be rendered at the top of the document, because detached feedback hides which link caused the failure and can be outside the reader's current viewport. The tooltip can be dismissed directly or by clicking outside it.

The document controls should support three kinds of navigation. These controls appear both in the document toolbar and in the floating controls.

1. **Backward navigation**

  Navigate to the previous entry in navigation history. It is unavailable when the current entry is the first entry.

2. **Forward navigation**

  Navigate to the next entry in navigation history. It is unavailable when the current entry is the latest entry. Ordinary navigation after moving backward replaces the remaining forward branch.

3. **Upward navigation**

  Navigate to the document "above" the current document. Every folder has a first document. A document bound directly to the folder takes precedence. Otherwise, the folder's first document is the first child item's first document: a document child resolves to itself, while a folder child resolves by applying the same rule recursively. If the first-child chain is empty or contains no document, the folder's first document is null; later siblings are not searched.

  The document above the current document is the nearest containing folder's first document that is neither null nor the current source document. If the containing folder's first document is null or is the current document, continue with its containing folder, and repeat up to the root. Upward navigation is unavailable when no such document exists. A successful upward navigation goes through the centralized navigation logic and is recorded in navigation history.

The link/ref system should be able to deal with invalid link/ref and navigation attempt from it. The parse/render layer needs to render the link using a different style indicating invalid link/ref. The navigation layer to deal with failure when a link points to a valid file in source, but navigation cannot be performed because no item in the side panel has picked it up.

Custom link parsing/rendering logic and navigation behavior should be supported.

For link string patterns, not only will link parsing logic be applied to typical links like `[a.md](a.md)`, but we also support applying it to `a.md`(incline code), or other patterns `[[a.md]]`(obsidian style link).

### Source links

A source link opens a collected source file in a compact read-only popup instead of navigating to a document page. This capability must be independent of indexes: Markdown/MDX authors and registered custom components can use the same source-link component directly, while an index item with `kind: inline-link` is only one host of that component.

The target is an internal source path and does not need a side-panel item. Loading, syntax-language selection, popup rendering, copy behavior, and errors must use the shared source-store and compact-code-block implementation. The source link uses the unified component interface and must remain usable through both direct MDX authoring and the degradation-compatible comment-block form.

Parse layer might require taking over the rendering of almost everything, including the most basic nodes like plain text, so link pattern matching logic can be applied, and links embedded in plain text can be rendered properly.

Various navigation mode should be supported. One basic example is to make clicking `[a.md](a.md)` possible to navigate to `a.md` within the source, regardless of where it is. A more advanced most is to display a dropdown allowing user to choose which one to navigate to, in case multiple `a.md` exists in the source.

## Graceful degradation to normal markdown

It's possible that the .mdx files in source will be directly read using normal markdown renderer. so we need some special stipulation as well as corresponding processing logic to ensure that the file look totally normal when treated as markdown, not mdx. without unpredicatable rendering behaviors.

HTML comment will be used to mark specific content that needs special rendering logic, for exapmle rendering using special comment.

```
<!--special comment before the code block-->
| Product ID | Description | Stock Status |
| :--- | :--- | :---: | ---: |
| #1024 | Wireless Ergonomic Mouse | In Stock |
| #2048 | Mechanical Keyboard (RGB) | Low Stock |
```

An embedded component is preferred to be written inside a code block, to avoid unpredictable rendering behavior when rendered using normal markdown renderer. This is only a preference, and mdex-style inline component should always be supported.

<!--renderComp=xxx,a=b,c=d-->
```
<Comp a=b c=d>
```

To implement above design, remark plugins might need to be configured to be able to parse html comment that contain specific patterns, and mark the node next to the comment node.