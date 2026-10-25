# Agent guide

Development guidance for this project is in `main/ai-dev.md`; read it first. This file lists the service layers that already exist, so that before building a feature an agent can judge whether it is missing or already there, and in the latter case find it.

## Existing service layers

Some features already implemented which you can utilize in case you need. Check this list before building something, so a capability that already exists is extended rather than built again.

<!-- Principle when editing this list: each entry briefly states what the service layer provides, and points to its core markdown document (doc_page_impl_xxx.md). Do not mention folder / file locations here; the core document lists its implementation files. -->

- **Environment**: Answers where the page runs (vite development server, static build; more kinds can be added) and what that allows: editing, creating files, the asset api, the service backend. Every check of "can this be done here" goes through it (`isCapable`, `reasonGet`), also for components (`config.env`). Refer to `main/doc_page_impl.md#the-environment`.

- **Doc page source service layer**: Maintains an internal representation of the workspace (the root-level doc pages of one deployment, each doc page one thing however often it is included, named by an alias unique in the workspace), of the roots of every doc page (named by aliases, so a folder can be renamed and same-name folders coexist) and of the files and folders below them, each file named by its full source path `~page:root/path`. Resolves every spelling of a reference, the local doc page first. Provides auto-complete dropdown ui component and logic for user to find / specify a file / dir of the source, the same for a path of the os file system (listed live by the development server), `.gitignore`-like `exclude` patterns on source rules, and the Workspace tab of the settings panel (editing the workspace file in place, temporary doc pages mounted on the development server, a React Flow graph of the doc pages, their includes and alias conflicts). Refer to `main/doc_page_impl_source.md`.

- **Doc page side panel service layer**: Maintains an internal representation of the side panel tree declared in yaml, kept up to date when the yaml changes, from which document order, routes, parts and sub documents are derived. A side panel is a resource with an id and can include another side panel. Provides the tree ui, an item label component that can be replaced per item, localized labels, in-place renaming and moving of items with write-back into yaml, and a context menu. Refer to `main/doc_page_impl_side_panel.md`.

- **Asset store service layer**: Maintains an internal representation of the versioned objects in a store, like a small object storage, kept in sync with the development server, so that a document refers to an object by a short reference block instead of inline data. Its folders belong to the doc pages the page loads (included ones too), each naming them by source path in its `.doc-page/asset.yaml` or using its default `asset/` folder. Provides versions and head, save modes, locks, dependencies, an asset panel for browsing / previewing / reverting, moving inline block data into the store, and a read-only snapshot for builds. Refer to `main/doc_page_impl_asset.md`.

- **Service layer (templates and instances)**: For things that run and keep their own state, unlike assets which are data. Maintains an internal representation of the service templates and running instances known to the backend, with their status. Provides the backend that runs instances created from templates, dashboard blocks placed in a document to show and work an instance, and a settings tab to manage instances. Refer to `main/doc_page_impl_service.md`.

- **Event layer**: The one channel by which a component asks the page for something (navigate, edit, resolve a tag, read an asset ...) through `onEvent`, routed to the owning store, with a uniform response. Refer to `main/doc_page_impl_event.md`.

- **Component state service layer**: Keeps the state a component has while shown (selection, draft, open folders) outside the component, so it survives navigating away and back and is shared by every rendering of the same block. Refer to `main/doc_page_impl_mdx_comp_state.md`.

- **MDX document in-place editing**: Edit mode in local dev. Maintains an internal representation of the current document as root-level blocks with their source lines, updated after every write, and edits one block at a time by sending line operations to the source file without reload. Provides the block toolbar and insert menu, the component edit-mode contract, and reusable editing primitives (inline value editing, floating panel, source surface, click-outside handling). Side-panel item in-place editing (renaming a label, moving an item) is supported by the same layer; refer to `main/doc_page_impl_side_panel.md` for that part. Refer to `main/doc_page_impl_edit.md`.

- **Block-level operations**: Insert, move, duplicate, delete, copy / move blocks to another place or document, paste text as blocks, and block selection mode. Refer to `main/doc_page_impl_block_ops.md`.

- **Block popup**: Opens any component block in a maximizable dialog with a view / edit switch. Refer to `main/doc_page_impl_popup.md`.

- **Panel contract**: All dialogs of the page are framed by the host's panel component, and can be made movable, resizable and size-remembered. The host also injects menu and segmented-control components. Refer to `main/doc_page_impl.md#the-panel-contract`.

- **Tag system**: Maintains an internal representation of every tag declared on source rules and side-panel items, queried through a tag service. Displays tags on side-panel items, beside links, in text and in a tag overview. Refer to `main/doc_page_impl_tag.md`.

- **Config system**: Maintains an internal representation of the config values of the page and of components, stacked by level: config layers (the package default, the doc page's own declarations, the browser) around the document levels (source rules, side panel, frontmatter); more layers can be inserted. Read through a config service; the settings panel shows what each layer declares and edits the doc page declarations in place. A component can declare its own keys. Refer to `main/doc_page_impl_config.md`; the doc page folder convention (metadata in `.doc-page/`, a doc page named by its folder) is in `main/doc_page_impl_dir.md`.

- **Navigation**: Maintains the current location (route, document, fragment) and its history as the single place to change it from. Provides the link / target grammar, anchors and aliases, back / forward / up, and a navigation channel for hosted indexes. Refer to `main/doc_page_impl_nav.md`.

- **Component registry and MDX components**: How a component is defined and registered (render, placements, exposed meta / icon / modes / config keys), the comment-marked block form for graceful degradation, data reuse between blocks, and rendering markdown inside a component. Refer to `main/doc_page_impl_mdx_comp.md`, and `main/doc_page_impl_mdx_li.md` for components inside list items.

- **Multilingual content**: Per-language headings, paragraphs, lists and the multi-lang block, with one language preference across the page. Refer to `main/doc_page_impl_multi-lang.md`.

- **YAML Utils**. For any operations involving YAML file editing, refer to `main/doc_page_impl_yaml_utils.md`. Overwriting YAML file simply by writing serialized yaml is usually not acceptable.
