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

A side panel is a way of collecting things from what source selects and organizing them as a tree, so it is a resource rather than a unique page setting: a side panel can include another one (for example the side panel of a part), and the source rules of the files a side panel organizes can be declared in the same file as that side panel. The format must leave room for several side panels per file and for using one side panel in more than one place.

### Part index

A side-panel node can be declared as the root of a semantic part. The node and all of its descendants belong to that part, except descendants under a more deeply nested part root. A part can bind an index by a pair of stable identifiers:

1. the side-panel document item id that owns the index component;
2. the component id authored inside that document.

This binding must not duplicate the index data in the side-panel config. The document system should load the referenced document, query the identified component's authored data and registered component type, and render it through the ordinary component registry. The component id must be unique within the referenced document, and a part index reference is valid only when the registered component declares itself as component type `index`.

When the current document belongs to a part with a valid index, the desktop local-index area should show a segmented control that switches between the ordinary **On this page** heading index and an **In this part** index. **In this part** is selected by default. The page/part selection is global document-page UI state, so it remains unchanged when navigating to another document or part. Floating display mode remains UI state owned by the MobX document store.

A hosted part index can optionally switch between its normal docked location and a floating panel. The floating panel is placed at the top-right of the page by default. The docked/floating segmented control belongs at the rightmost side of the index title line. This control must not appear when the same index is rendered as an ordinary component inside an MDX/Markdown document.

A hosted index belongs to the document that authors it, not to the document currently shown. Its language is its own state, kept per part and selected by a language control at the top right of the index when the index is multilingual; switching documents or the document language does not change it. Its links resolve and display (for example tags beside links) according to the index document, and the part declaration can override such document-level config for the hosted index only.

In hosted placement, the index title is left-aligned and wraps naturally. The docked/floating control remains on the title row only when enough width exists and otherwise wraps below the title. The index component itself must not create its own vertical scrollbar. Its host panel, docked or floating, is bounded by the window: a short index keeps its natural height, and an index taller than the space below the panel's top edge scrolls inside the panel, while the page/part switch stays visible outside the scrolling content. An index link targeting the current source document is highlighted with a yellow background.

An index type may allow a subtopic to replace its ordinary item list with a custom component from the unified component registry. The authored index data supplies the component name and its semantic data, while the runtime host supplies placement and instance context. The nested component uses the same `{ data, config, onEvent }` interface as every other registered component and must submit navigation through the centralized navigation layer. A subtopic must choose either an item list or one custom component, not both.

A hosted index and its nested custom components may opt in to navigation notifications through a runtime subscription supplied by the document host. A notification describes the successfully applied destination, including a monotonically increasing request version, side-panel route and item, source document path, and fragment. Repeated navigation to the same destination must still publish a new notification. Failed navigation attempts must not be published as current-location changes. The subscription must also provide route-aware target matching so a custom index does not duplicate document-path, side-panel-alias, or fragment resolution rules.

Only the hosted index associated with the current document's semantic part is active and eligible to receive these notifications. It remains active when the local-index control is switched to **On this page**, even though its visual content is hidden, so it is already synchronized when **In this part** is selected again. Navigating to another part must dispose the previous hosted index's subscriptions before activating the new part's index. Indexes embedded as ordinary document content and indexes belonging to other parts must not receive hosted-index notifications merely because their source has been collected or compiled.

This mechanism must be opt-in and index-agnostic. An ordinary index need not perform work for a navigation notification. A visual index such as a screen mini-map can subscribe, match the current document against the targets represented by its sections, and highlight the matching section. The document store must not contain mini-map-specific section-selection logic.

The complete part-index feature must be globally configurable. It is enabled by default; floating mode is also enabled by default. Disabling the part-index feature restores the ordinary local page index without requiring changes to side-panel part declarations or document content.

## Layout Stability

Switching documents must not cause horizontal jitter between the three major areas: the left side panel, the main document area, and the local-index area at the right.

1. While a document is loading, the temporary skeleton placeholder keeps the same global layout as the loaded document; the widths of the major areas do not change when the skeleton is replaced by the content.
2. A short document, a loading skeleton, or a component panel page must not shift the layout by removing the window scrollbar. The scrollbar gutter is reserved whenever the document page is present, so the viewport width available to the layout stays constant.
3. A document without headings has no document-level navigation at the right. This is normal, but it must not collapse the reserved width of the local-index area.


## Unified Component Registry

The document page should maintain a unified component registry, supporting registering a component with given name, and fetching a component by component name. The component can be provided not only to mdx, but also used elsewhere such as side panel item that wants custom component to render themselves, and their main. 

There should be a standard of the interface of custom components that can be registered, including a unified prop shape etc.

A component in a document should be able to reuse the authored data of another component, instead of repeating it. The referenced component is addressed by its document and a document-unique component id, and the document part uses the same target grammar as the link/ref system. A component explicitly declares which component types it accepts data from. A missing document, a missing or duplicate component id, an incompatible component type, and a component without reference support must each be indicated in place where the reference is written.


## In-place Editing

When the page runs on the local development server, a document must be editable from the page itself. Deployed (built) pages are not editable and show no edit controls: the edit API exists only in the development server, and the page learns about it at runtime.

A document consists of root-level blocks (headings, paragraphs, lists, code blocks, custom components, ...), each mapping to a range of source lines. Editing happens at this granularity through one unified layer with standardized operations: read the current source of a block, submit a replacement of its lines, insert a block between two blocks or at the top or end of the document, delete a block. The HTML comment and the block after it that together invoke a component (`<!--renderComp=X-->` + fenced block) are one block, never two. The server must refuse a change made against an outdated version of the file instead of overwriting another editor's work.

How a block is edited is the job of the component that renders it. The layer provides default editors for the basic blocks (headings, paragraphs, lists, and plain source for everything else); a custom component `Xxx.jsx` opts in by declaring edit support and rendering `XxxEdit.jsx` when it receives `config.isEdit`. `Xxx` and `XxxEdit` should share their rendering code rather than duplicate it. Not every component needs an edit mode.

The page has one global edit-mode toggle at the document toolbar, hidden when no edit API is available; a built page must not show any edit control, and this must hold by construction (no endpoint in a build), not by a flag someone remembers to set. In edit mode, a block enters its edit mode by clicking the block (the default, `EditBlockEnterMode` `click`) or through the Edit button of its toolbar; the reader can restrict entering to the button in the settings. Entering is aware of where the mouse is: a click into a paragraph puts the caret at the text nearest to the click, as a text editor does, which means the mouse position travels with the request through the event layer and is interpreted in the right coordinate system. One block of a document is in edit mode at a time, so entering another block's edit mode leaves the previous one. From inside a block the author can move on with the keyboard: the arrow key at the first or last line of a block continues in the neighbor block, with the caret keeping its horizontal position. Each block has one toolbar, shown only while the block is hovered, floating above the block: edit, insert above, insert below, delete; its buttons are comfortably large, since they are hit while the pointer moves over the document; when the top of the block is scrolled out of view the toolbar stays at the top of the block's visible range. Hovering or entering a block must not change its look beyond that toolbar (no outline, no frame). Deleting asks for confirmation in place, never through a browser dialog. The layer is decoupled from the reading logic: an additional layer that changes nothing in how a document is read, and a save keeps the reading position.

Editing is WYSIWYG in the sense that a block is edited directly where it is displayed, in its own typography: no separate panel repeating the block's content. The modification is saved at the moment the author leaves edit mode in a non-canceling way (clicking elsewhere, entering another block, a toolbar action, Save, Ctrl/⌘ + Enter, switching edit mode off); Escape or Cancel abandons the modification. A block created from the insert menu is removed again when its creation is canceled.

Edit mode must not jitter the page: toggling it, and entering the edit mode of a block, keeps every block at its height and place. The source of a block usually needs more room than the rendered block, sometimes less; in both cases the block keeps the height it has in view mode while it is edited: source that needs more room extends over the area of the block below, covering it, instead of pushing it down, and source that needs less does not shrink the block. A block that is not being edited renders in view mode even while the document is in edit mode, and every control that exists only for editing floats instead of taking space in the flow. This applies to creating a block as much as to editing one, and at the end of the document as much as between two blocks: inserting a block offers a floating menu, never a form, a preview, or a placeholder inserted into the document. Custom components that implement an edit mode must obey the same rule ([in-place editing and the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)).

Components report what the user asked for through events and never call page logic themselves; one centralized layer receives, routes, and answers these events (navigation events go to the navigation system, edit events to the edit layer), with room for later concerns such as undo / redo ([event layer](doc_page_impl_event.md)). Every answer is a formatted result `{ code, data, message }`, code 0 for success and a negative code for failure.


## Asset Store

The data of a component invoked through an HTML comment and a code block can be kept outside the document, in a managed asset store, so that it can be shared, versioned, and edited without touching the document. The store is a general storage of versioned objects, modeled after an object storage at the concept level: an object is a key with metadata, a version is bytes, and the storage layer does not distinguish text from binary; the page decides when it reads (a component expecting yaml from bytes that are not utf-8 text gets an error, not a crash), and an object declares its content type. The store is exposed through a standard set of apis: declare (create) an object, delete it, update it in place or as a new version, query its history, and switch its head version. The history model is a DAG and is kept in the object-level metadata, so that the model maps onto a metadata table plus an object storage (DynamoDB plus s3) when a service backend is added. Object ids follow the project id format (ms_48, no prefix or suffix, random, not meaningful). An object may also carry a semantically meaningful **name**, unique in its store, so that an asset can be declared by name as well as by id, which is the usual way a person writes one; declaring an asset whose name exists in the store creates nothing and means the existing object. The object metadata records the first creation time and a list of events (an in-place edit leaves no version behind, so the record is a list); each event is a mapping `{ event type, time stamp with time zone, user id }`, where the user id may be missing and is reserved for later. Each object carries a save mode, `update in place` or `new version`, applied when a save names no mode; the default is not written and reads as in place; the mode is set from the object's own panel, and the panel offers both saves whatever the mode. The data format follows the object store of `homepage-utils/storage-obj`.

There is one **local store**, managed by the development server: physically one or more folders, with a default folder for new objects that can be changed, and more folders added, from a tab of the settings panel; the choice is saved in the store's config file. The data must be fully reflected in the folders' files; a metadata file per object is allowed, and every edit of the metadata file, or of a data file, leaves a backup file beside it in the same folder. An object's folder is named by its id and its name, `{id}--{name}`, with a separator that neither an id nor a name may contain and that is valid in a folder name on the major operating systems, so the disk is readable by people and scanned by id. The store is loaded systematically when the page initializes (its status and the index of its objects), and the storage structure supports finding an object quickly by id or name across the folders. Planned, and left room for in the model: remote stores answering the same apis, and a local cache of a remote store, whose cached assets are treated differently from local ones.

MDX components must not know or care whether their data is inline or in the store. In the document an asset-backed component is still a code block after the comment, with a special language type; its content is yaml, parsed with yaml, that names the store and the object (by id or by name; the store is required, so that no reference ever needs an object created for it) and optionally a version, the head by default. Components whose data is in the store get an additional asset button, which opens a general popup panel provided by the asset service: viewing and deleting history versions, setting the head, the save mode, editing or uploading the head data, and so on. The panel is large enough to show a history beside its data; the version rows all have the same height whether selected or not, the values of one column are vertically aligned across the rows, and clicking the selected row unselects it. Entering edit mode of the data must not move anything in the panel (the no-jitter rule), and for a binary asset the edit action is greyed out with the reason beside it. Clicking outside the data being edited leaves editing, saving a changed draft. A confirmation (of a deletion) opens right after the button that asked for it, in the same row, so nothing moves. An individual version can be **locked** against being edited in place and deleted, and a whole object can be locked against every change until it is unlocked; the store enforces the locks, and the panel greys out what they forbid, with the reason. The panel header carries a side-panel toggle button (the side-panel icon pair, not the maximize one) that shows a preview pane at the right: the component rendered with the data as it is in the panel, following the edit in real time, so that the author sees what a save would render as. To keep components decoupled from the store, the button and the asset information live outside the component, in the block's toolbar of edit mode ([asset store](doc_page_impl_asset.md)). A component block whose data is inline can be moved into the store from the same toolbar.


## Link/Ref system

Link/Ref system consists of at least the following major logical layers:

1. Parse/Render layer. Identify from content of the source documents valid link format that points to another place(not necessarily valid). Links are typically identified from string patterns in raw text. Note that some custom components might also support navigation behavior, and can specify where they want to navigate to upon certain ui behavior, but they might not be handled by parse/render layer.

2. Route layer. This layer maintains for a file in source, what items are bound to it, and when navigating to it, which item to go to(in case multiple items correspond to same file in source). For the time being, let us simply go to the first item according to tree order. Note that this might include items automatically collected as descendants of an item that bound to a folder.

3. Navigation layer. Triggers proper navigation behavior upon user clicks a link or performs certain behavior upon components that support navigation. Navigation attempt should be submitted to a centralized navigation logic, to support recording of navigation history, required for redo/undo operations.

A navigation target may include a document-local place indicator after `#`, for example `/root-id/guide.md#configuration`. The route layer resolves the document portion, while the navigation layer keeps the fragment as part of the destination, loads the resolved document, and scrolls to the matching element id after rendering. The destination receives a persistent yellow highlight until the next document/place navigation, so the user can distinguish the exact destination after scrolling.

The place indicator can name a section in two ways. It can be the title text of a heading, for example `guide.md#Configuration`, so authors can link to a section without preparing anything. It can also be an id, which keeps working when the title text changes. Authors declare ids in the degradation-compatible comment style used by other document components, with a pre-registered component placed directly before the node: `<!--renderComp=Anchor,id=configuration,aliases=[config-old]-->`. Before a heading, the heading itself receives the id; additional aliases point to the same heading. Before any other node, the ids mark that node, and navigation highlights the first following content element. This must not enable arbitrary HTML or MDX behavior in `.md` files.

Raw HTML markers such as `<span id="configuration"></span>` before a heading are deprecated. They keep working for existing documents, but compiling them reports a deprecation warning that points to the `Anchor` comment.

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

Ordinary Markdown prose must be able to place a source link in place through an exact, case-sensitive link-title marker: `[label](/path "inline-link")` and `[label](/path "inline-link:source")` display the collected source, while `[label](/path "inline-link:render")` displays the target compiled through the normal document pipeline. The link stays inside its paragraph, keeps the authored text as its label, and opens the popup without navigating. Links with any other title keep normal behavior; external URLs and same-page anchors are unaffected.

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

### Components as list elements

Components must be usable as elements of nested list items (ordered or unordered, any depth), including components whose source spans several lines or that render as a rectangular block, such as code blocks, images, and diagrams. Many Markdown-based note tools make this fragile: authors cannot tell which indentation keeps a multi-line block inside a list item, and different renderers disagree.

There should be one stipulated writing style that reads naturally in source, keeps the comment + code block style above, is parsed stably by the project's pipeline, and stays nested in the list item under common Markdown renderers. The comment may also follow the text of the item, and text may continue after the block within the same item.