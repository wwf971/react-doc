# Navigation Design

This document describes navigation for the reusable document page. For the overall architecture, source collection, component registry, and side-panel configuration, refer to [Document Page: Design](doc_page_impl.md).

`DocStore` is the navigation source of truth. Links and controls do not update the document body, URL, or history independently.

```text
link / side-panel item / component / history control
	-> DocStore.navigate(route + optional fragment)
	-> resolve one semantic side-panel item
	-> update current route, document, and fragment
	-> update history and browser URL when applicable
	-> publish one navigation snapshot
	-> render document and align the requested place
```

## Routes and navigation state

The current location has three related identities:

- `routeCurrentPath`: stable route of the selected side-panel item.
- `docCurrentPath`: source document rendered by that item.
- `docCurrentHash`: optional place inside the document.

Side-panel item identity remains separate from source identity because the same source can appear in more than one semantic location. `DocStore.navigate()` resolves the requested route or source path to one side-panel item before changing any current-location state. A source document that is not represented in the side panel is not directly navigable.

Every successful request increments `navigationRequestVersion`, including a request for the already-current route and fragment. Path and hash values alone cannot represent that repeated request. After updating the complete location, `DocStore.navigate()` updates history, synchronizes the browser URL in query mode, and publishes one immutable navigation snapshot. An invalid target leaves the current snapshot unchanged and reports through the navigation-error path.

Two route modes share this boundary:

- **Query mode** stores the selected route in the `doc` query parameter and the place in the browser hash. Browser Back and Forward restore document navigation.
- **Memory mode** keeps location and history inside `DocStore`, allowing the document page to be embedded without changing the host URL.

## Link recognition and target resolution

`remarkDocLink` recognizes three authoring patterns and rewrites them into `DocLink`:

- normal links such as `[text](target.md)`; external URLs, `mailto:` links, and fragment-only URLs are left unchanged;
- inline code that looks like a Markdown file name or path, such as `` `a.md` ``;
- Obsidian-style references such as `[[a.md]]`.

`DocLink` resolves targets at render time:

```text
target form                resolution
/rootId/xx/a.md            exact internal path
./sub/a.md, ../a.md        path relative to the source document
a.md                       file-name lookup
														 ├─ one match  -> navigate
														 ├─ many       -> choose from a candidate list
														 └─ none       -> show a broken link
```

A target can append a fragment, for example `/rootId/xx/a.md#configuration`. `DocSourceStore.resolveLink()` separates the source path from the fragment and resolves the path. `DocLink` then submits the resolved side-panel route and fragment to `DocStore.navigate()`.

Resolution happens during rendering rather than compilation. Moving a source file therefore updates the document index without invalidating otherwise reusable compiled content.

Link recognition, resolution, presentation, and navigation remain separate. Applications can add or replace remark recognizers, provide `config.link.resolve`, replace the link renderer, and intercept link events before default navigation. Registered components use the same destination format through `navigateRequest`.

`DocLink` reports a link as current only when both its resolved source path and fragment match the current destination. A hosted index therefore marks only the item for the exact place and clears the previous item after navigation; links to other fragments in the same document do not appear current together.

When a source document exists but has no side-panel item, activating its link opens a dismissible warning beside that link. Unexpected `navigate()` failures use the same local warning. It closes after dismissal, an outside click, a target change, or successful navigation. This identifies the failing link without moving the reader or showing a detached page-level warning.

The default document-link renderer and warning are also the display boundary for inline source links. A source target absent from the collected manifest uses the same red broken-link treatment as a missing document. A collected source that cannot be loaded or opened uses the orange unavailable treatment and the same local warning. This keeps target-state feedback consistent while leaving document navigation and source-popup behavior in their respective controllers.

## Fragment scrolling and highlighting

Document replacement and place selection have different behavior:

```text
new document
	-> reset the document scroll chain
	-> wait for the compiled body
	-> find and align the requested fragment

same fragment again
	-> if already aligned and highlighted: no visual change
	-> if manually displaced: align it again
```

`useDocDestinationNavigation()` owns this behavior. It scopes fragment lookup to the rendered document body, retries briefly while the destination is mounting, and calculates the destination position within the document viewport. Browser scroll anchoring is disabled on that viewport.

The resolved destination receives `doc-navigation-target`. The package stylesheet displays this as a full-content-width yellow marker until navigation selects another document or place. Alignment runs again after the browser layout phase only when movement is needed. Pending images above the destination also request another alignment when they finish loading.

### Stable aliases in plain Markdown

Plain `.md` documents can place one or more stable markers immediately before a heading:

```html
<span id="configuration" />
<span id="configuration-legacy"></span>
```

Raw HTML is intentionally omitted when compiling with `format: 'md'`. `remarkStableHeadingAnchor` therefore recognizes only blocks made entirely from these marker forms. It transfers the first ID to the following heading and renders additional IDs as empty aliases immediately before that heading.

Aliases must not be heading children. Fumadocs copies heading content into its breadcrumb and table of contents. An alias inside the heading would therefore create duplicate DOM IDs and make fragment lookup choose a navigation copy instead of the document destination. Scoping lookup to the document body provides an additional boundary.

An empty alias delegates scrolling and highlighting to the following visible content element. The primary ID already belongs to the visible heading, so both primary and alias destinations highlight the same section title.

### Heading selection

Fumadocs wraps heading text in hash links. Releasing the pointer after selecting heading text can otherwise activate that link and move the heading unexpectedly. `DocPageMdx` tracks pointer movement and browser selection, then cancels only the heading-link click produced by a selection drag. Ordinary heading clicks and the copy-link button remain available.

## History and navigation controls

History entries contain the semantic route and fragment together. Repeating the current destination reruns its destination behavior without adding a duplicate entry. Normal navigation after moving backward removes the forward branch.

`DocNavigationButtons` exposes the same actions in the document toolbar and compact floating controls:

1. **Back** calls `DocStore.navigationBack()`. Query mode delegates to browser history; memory mode moves through the internal history list.
2. **Forward** calls `DocStore.navigationForward()` through the same mode-specific mechanism.
3. **Up** calls `DocStore.navigationUp()` with the page-tree model's nearest valid ancestor destination.

For Up navigation, a folder's own document is its first document. A virtual folder follows only its first-child chain recursively; later siblings are not fallback candidates. Starting from the current item, `itemAboveById` checks containing folders from nearest to root and selects the first available document whose source differs from the current document. Up then passes that route through ordinary `navigate()`, so it participates in history and URL synchronization.

## Side-panel routes and folder navigation

Each document item has a stable item ID and route. A non-leaf item with both `doc` and `children` becomes a Fumadocs folder whose native index is that document. The navigation index records every item bound to each source file, allowing duplicate document placements while link and search navigation consistently choose the first item in tree order.

Indexed folders appear before their descendants. Fumadocs uses this order for bottom previous/next cards, so the folder document's next page is its first child and that child's previous page is the folder document. Breadcrumbs show the indexed folder as the current page for its document and as a link for descendants.

`@first/{itemId}` resolves to the folder's own document when present. For a virtual folder, it follows the first descendant chain. A link to a collected source omitted from the side panel reports a navigation error instead of opening an unrepresented page.

### Indexed-folder interaction

The default sidebar folder override keeps route changes separate from expansion state:

- Selecting an inactive folder label navigates to its document without changing expansion.
- Selecting the active label toggles expansion. A double click therefore navigates first and then toggles.
- Selecting the chevron toggles expansion without navigating.

Consumers can replace this gesture policy through `config.sidePanel.components.Folder` without replacing route resolution or history behavior.

## Hosted-index navigation channel

A hosted part index can observe navigation without receiving `DocStore`. The host provides one stable `navigation` channel through runtime `config`:

```text
navigation.getSnapshot()
	-> { requestVersion, route, itemId, docPath, hash }

navigation.subscribe(listener)
	-> unsubscribe

navigation.isTargetCurrent(target, { fragmentMode: "exact" | "ignore" })
	-> boolean
```

`getSnapshot()` returns an immutable value. `requestVersion` changes even when the route and fragment remain the same. `isTargetCurrent()` uses central route resolution and supports exact document-and-fragment matching or document-only matching. Components therefore do not resolve side-panel aliases or strip fragments themselves.

`subscribe()` follows external-store semantics and returns an idempotent cleanup function. Components can consume it through `useSyncExternalStore`; components that do not subscribe perform no navigation-specific work. Back, Forward, Up, browser-history restoration, links, and registered-component requests all publish through the same channel after navigation state is complete.

The current part's hosted-index runtime remains mounted when the display switches from **In this part** to **On this page**; only its presentation is hidden. This preserves subscriptions and current-section state. Changing the part ID or referenced index document/component unmounts the old runtime and cleans up its subscriptions. Docked and floating presentations share the same runtime and channel.

A mini-map subtopic subscribes once and stores only its derived selected-section ID. It compares each snapshot with primary and subordinate section targets. A direct child match takes precedence over its parent, a subordinate target selects its containing section, and otherwise the first authored match wins. The generic index host owns only channel scope, snapshots, target matching, and cleanup; it does not know mini-map section semantics.
