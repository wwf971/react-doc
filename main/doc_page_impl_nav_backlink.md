<!-- Design of backlinks: the link index of the workspace, the backlinks panel, and following a backlink to the reference itself. Parent document: doc_page_impl_nav.md -->

# Backlinks: Design

A link says where a document points; a **backlink** says who points at it. This document specifies how the page knows every reference every document writes (the **link index**), how it lists the references that reach the current document (the **backlinks panel** in the right column, beside the page headings and the part index), and how following one goes not to a document but to the very reference, marked and, when a component holds it out of sight, revealed. For navigation in general, refer to [Navigation design](doc_page_impl_nav.md); for how the page tells a component something, [Events delivered to components](doc_page_impl_event.md#events-delivered-to-components).

```text
development server / build                        page
  every document ─► dependency scan ─► link index ─► DocSourceStore.linkIndex
  (doc-link-index.ts, the scan of pruning)            │
                                                      ▼  invert, resolve as a link resolves
                                                DocLinkStore: backlinks of the current document
                                                      │
                                       ┌──────────────┴───────────────┐
                                       ▼                              ▼
                              BacklinkPanel (right column)    the removal dialog of a
                              a reference ─► navigate with a  side-panel item: who links
                              focus ─► placeReveal to the     to the document
                              block ─► the link ringed
```

## The link index

The page's own reading of a document finds its links one at a time, at render time, and only for the document shown. Backlinks need the opposite: every reference of every document, before any of them is opened. The development server has that view, and already reads it: the dependency scan that prunes a build (`docSourceDependenciesCollect`, [Source pruning](doc_page_impl.md#source-pruning-for-deployment)) parses every document with the Markdown extensions and the comment-component parsing of the runtime compile, classifies its links with the runtime rules, and asks the components' extractors for the references in their data. The link index is that scan kept: for every document of the manifest, its references as written, with where each is written.

```text
linkIndex
  version                     1
  byDoc[docPath]              one entry per .md / .mdx document of the manifest
    contentHash               sha256 of the text scanned
    linkList[]                the references, in document order
      target                  as written: a.md, ./sub/a.md#Setup, ~page:root/a.md, a.png
      kind                    document | source | asset   (the classification of the scan)
      construct               what declared it: link, inline code, wiki link, image,
                              link "inline-link", the component's name (Index, BlockQA, ...),
                              dataRef of X
      sourceLine              the line of the reference, counted without the frontmatter;
                              absent for a reference written in the data of a component
      blockLine               the line of the root-level block holding it: for a component
                              block the line of its marker comment, the block identity of
                              the page (doc_page_impl_popup.md#block-identity)
      headingTrail            the titles of the headings above it, the outermost first
      context                 { before, label, after }: the sentence around it, clipped at
                              words, the reference's own text as the label (the link text,
                              the alt of an image, the code of an inline target); absent
                              for a reference read from component data without text
```

The references are kept **as written, never resolved** on the server. Resolution happens on the page, against the source as it is when the page asks, with the same resolver as every link (`docTargetResolve`, [Link recognition and target resolution](doc_page_impl_nav.md#link-recognition-and-target-resolution)): a document or asset target by the link grammar, the referencing document's own doc page first; a source target only as a rooted source path, as `SourceLink` resolves it. A file added or removed therefore changes the backlinks without a scan, and the page and the index can never disagree on what a target means.

**Built on the server, kept up to date.** `DocLinkIndexBuilder` (`plugin/doc-link-index.ts`) scans every document when the virtual module is generated and whenever the source data is reported again (a file saved, a file created or deleted from the page, a configuration reload), and scans a document again only when its content hash changed, so a saved file costs one scan. The index travels with the source data: `docLinkIndex` of `virtual:doc-source`, the `linkIndex` of every `doc-source-change` event, and `data.linkIndex` of `DocPageMdx` ([the source data](doc_page_impl_source.md#the-page-side-docsourcestore-and-the-service-object)). A build carries it in the module like the manifest, so a built site lists backlinks too. A host that builds its own source data may give none; the page then offers no backlinks panel and the removal dialog says the referencing documents are not known.

**What is and is not in it.** Every reference the dependency scan finds: links, inline code naming a document, wiki links, images, inline source links, the targets a component's data names through its extractor (an `Index` item, the Markdown of a `BlockQA` answer or a `Block`, a `dataRef`), in `.md` and `.mdx` alike. A reference written in the data of a component has the component's block as its place and the component's name as its construct, since the data has lines of its own; its context is still read when the data is Markdown. Not in it: references inside asset objects (a block whose data lives in the [asset service layer](doc_page_impl_asset.md) is a reference block, and the asset usage index is where objects are tracked), side-panel inline items, and anything a component builds at run time. A document that cannot be parsed has an empty entry and a warning on the server.

**Referrers.** The documents that reference a file, with a count each (`referrerListGet`), are a query on the same index. The removal dialog of a side-panel item ([Changing the structure](doc_page_impl_side_panel.md#changing-the-structure)) reads them from the page's own copy, at once, in place of the former request to the development server; a renaming of files from the page ([TODO](doc_page_impl_TODO.md#source-file-rename)) would read the same index on the server to find what to rewrite.

## The backlinks of a document

`DocLinkStore` resolves the index once per change of the index or of the source (`linkIndexResolve`, `lib/doc-link-index.js`): every reference of every document is resolved into a **link** to each file it resolves to, and the one list of links is seen both ways, the links a document writes (`linkListOfDoc`, `linkListOfPlace` for those under a heading) and the backlinks of a file (`backlinkListGet`). A backlink is a link seen from its target: the same entry.

```text
link (a backlink, seen from its target)
  docPath        the document the reference is written in
  reference      the entry of the index
  fragment       the place after "#" in its target, '' when none
  targetPath     the file it resolves to; '' when it resolves to nothing (in the links of a document only)
  key            docPath and the reference's position (and the file, for each file of an ambiguous name):
                 stable while the document is unchanged
```

The links also answer the [object registry](doc_page_impl_obj.md#documents-as-objects): the provider `doc-link` (`lib/doc-object-provider-link.js`) says the links of a document or a section, and the backlinks of a document or a section, as `doc.link` relations between `doc:` objects, with the links' own keys. The resolution and its rules stay here, the navigation layer's own; nothing of it is copied into the registry, and the Backlinks panel reads the layer directly, at once, as the layer's own ui.

Three rules of the inversion: a reference that resolves to several files (a bare name shared by two documents) is a backlink of **each**, so a document never misses a link that may reach it, as pruning retains each; a document's references to **itself** are not backlinks, as a referrer count never counted them; and the backlinks of a document are ordered by where they are written, so the list reads like the referencing document does. The groups of the panel follow the side panel: the referencing documents in the order of their first item, documents without an item last, by path.

## The backlinks panel

The right column of the page holds one segmented control with up to three choices, **On this page**, **In this part** and **Backlinks**, and one panel under it ([Semantic parts and hosted indexes](doc_page_impl.md#semantic-parts-and-hosted-indexes)): the native heading list, the hosted index of the part, or the backlinks of the document. The choice is one value of the page (`DocStore.tocContentMode`), kept across documents, so a reader who works by backlinks keeps seeing them; a choice not available beside the document shown (no part, no index) shows the page headings meanwhile, without changing the choice. **In this part** appears inside a part with an index, **Backlinks** whenever the page has a link index and `backlink.isEnabled` is not `false` in config; the control itself needs the host's segmented control (`config.components.SegmentedControl`), as the part index does.

```text
 [On this page] [In this part] [Backlinks]
 6 backlinks from 3 documents                       ← the summary; or "No backlinks" and a hint
 Links & Navigation ↗  3                            ← the referencing document: a document link of
 │  Bare name, single match                           the page (navigates, or views a document that
 │  How to link to sections and declare ids:          has no side-panel item), its label from the
 │  [Links and Navigation], in particular…            side panel, else its title, and the count
 │  Bare name, single match                         ← a reference: the headings above it, muted;
 │  …ids: [Links and Navigation], in particular       then the sentence around it, the reference's
 │  declaring an id and…                              own text marked; the whole row is a button
 │  (#link-usage-declare-id)                        ← the place of this document it points at,
 Ambiguous Name Example ↗  2                          when it names one: a chip of its own
 │  Notes (root level) › A link inside a folded answer
 │  [BlockQA] Yes. This answer links to [linking to a section], and…
 │  (#Linking to a section)
```

The appearance is that of the rest of the column: small text, the muted color for what is secondary (the summary, the heading trail, the count), the page's accent color on hover of a row, the primary tint on the marked label and on the chip of the place that is the current one (`aria-current`). A reference declared by something other than a plain link, inline code or wiki link carries a badge of the shared `.doc-badge` kind before its sentence: the component whose data it is written in (`BlockQA`, `Index`), `image`, `inline link`, or `X · dataRef`; a reference with no sentence (an `Index` item) shows its target instead. A referencing document that has no side-panel item keeps its rows but greys them out, with the reason as their tooltip; its heading link still opens it in the viewing popup, as any document link does. The panel is the scroll owner of a long list, bounded like the part index to the window's bottom (`use-panel-height-available.js`, shared by both panels), so the control never scrolls away. Labels follow the page language (English and Japanese, `labelSetGet` of `DocPageToc`).

Two gestures:

- **the row**: opens the referencing document *at the reference*, below, through `DocLinkStore.backlinkOpen`;
- **the chip**: goes to the place of this document the reference points at, `DocStore.navigate(docPath#fragment)`, the ordinary fragment navigation with its yellow marker and history entry; `DocLinkStore.backlinkTargetOpen`.

## Going to a backlink

A fragment names a heading or a declared id; a backlink names something finer, one reference in a sentence, possibly inside a component. The navigation layer takes it as a **focus**, a third thing beside the route and the fragment, asked for by a navigation and applied to the rendered body:

```text
DocStore.navigate(docPath, '', { focus })
  focus = { kind: 'link', target, sourceLine?, blockLine, heading? }
          target       the reference as written (the focus is found by it)
          sourceLine   its line in the document's own Markdown, when it has one
          blockLine    the block holding it (the subject of the reveal event)
          heading      the nearest heading above it: the fallback
  -> docCurrentFocus (cleared by every navigation that asks for none)
  -> after the body is rendered (useDocDestinationNavigation):
       1. placeReveal published to the components of the block       (a frame later, so the
          { kind, target, sourceLine, blockLine }                      components have subscribed)
       2. the reference looked for in the body, up to ~1 s:
            [data-doc-link-target="…"] on the link's line, else the first one with that target,
            laid out (a reference inside a folded part is waited for)
       3. found: the paragraph (list item, cell, heading) holding it aligned with the top of the
          viewport, the link itself marked with .doc-navigation-focus
          not found: the nearest heading of the index, aligned and marked like a fragment
```

**How a reference is found.** Every document link the page renders (`DocLink`, `SourceLink`) carries its target as written on its controller element, `data-doc-link-target`, and, in the document's own Markdown, the line it is written on, `data-doc-link-line` (`remarkDocLink` with `isSourceLineEnabled`, set by the compile of a document and not by the nested Markdown of a component, whose lines are not the document's). The focus therefore needs no block wrapper and no id: the link on the recorded line wins, the first link with that target stands in for a reference written in component data, which has no line of its own, and a link inside an `Index` or a `BlockQA` is found the same way as one in a paragraph. The line is the only part that goes stale: when the document changed since the index was read, the target still finds the reference, and when the reference is gone, the heading of the index does, as a fragment would.

**The mark.** The focused link gets `.doc-navigation-focus`: a ring in the primary color with a soft halo, drawn in once (no animation under `prefers-reduced-motion`) and kept until the next navigation, as the yellow marker of a fragment is. The fragment marker and the focus never show together: a focus navigation carries no fragment, and its history entry is the document alone, so Back and Forward return to the document, not to the mark. The URL carries the route only; a focus is not an address, because a line is right only until the next edit above it, which is why a backlink row is never written as a link ([Places in a document](doc_page_impl_nav.md#places-in-a-document)).

**Components and the reveal.** A component may hold the reference where the page cannot see it: a folded answer, a view of a `SwitchView` that is not the current one. Before the page looks, it tells the components of the block, through the event layer's delivery direction ([Events delivered to components](doc_page_impl_event.md#events-delivered-to-components)):

```text
placeReveal  { kind: 'link', target, sourceLine, blockLine, subject: { sourcePath, blockLine, type } }
  -> delivered to the components subscribed at that document and block (useDocEventSubscribe)
  -> a component that holds the reference shows it and answers { code: 0 }
  -> one that does not answers undefined; the page does not need an answer to go on
```

The page waits for the answers, then looks for the reference while the component re-renders. A component that ignores the event loses nothing but the reveal: the reference is still found when it is laid out, and when it stays hidden the page falls back to the heading. What a component should do with the event, and how it subscribes, is in [MDX components](doc_page_impl_mdx_comp.md#a-place-the-page-asks-to-see); `BlockQA` (unfolding the item whose question or answer holds the target) and `SwitchView` (selecting the view whose data holds it) are the demonstrations.

## Files

```text
frontend/plugin/doc-link-index.ts         DocLinkIndexBuilder: the index, scanned per changed document
frontend/plugin/doc-source-dependency.ts  the scan: each reference with its line, block, headings, context
frontend/plugin/doc-source.ts             the index in the virtual module (docLinkIndex) and in doc-source-change
frontend/src/lib/doc-link-index.js        the resolution: referenceEntryListGet, linkIndexResolve (the links both ways),
                                          backlinkGroupListBuild, referrerListGet
frontend/src/store/DocSourceStore.ts      linkIndex, received with the source data
frontend/src/store/DocLinkStore.ts        the links resolved (linkListOfDoc, linkListOfPlace, backlinkListGet), the
                                          backlinks of the current document, backlinkOpen, backlinkTargetOpen,
                                          referrerListGet, docLabelGet
frontend/src/store/DocStore.ts            tocContentMode, docCurrentFocus, navigate({ focus })
frontend/src/lib/doc-destination-navigation.js   focusElementFind, focusBlockGet, navigationFocusSet
frontend/src/lib/use-doc-destination-navigation.js  the focus applied: placeReveal, the lookup, the mark
frontend/src/lib/remark-doc-link.js       the line of a link (isSourceLineEnabled)
comp-doc/link/DocLink.jsx                 data-doc-link-target, data-doc-link-line
comp-doc/toc/DocPageToc.jsx               the three-way control of the right column
comp-doc/toc/BacklinkPanel.jsx, .css      the panel
comp-doc/toc/use-panel-height-available.js  the height bound shared with the part index panel
comp-doc/registry/use-doc-event.js        useDocEventSubscribe, the hook components respond with
built-in/comp-mdx/block/block-qa/BlockQA.jsx, switch-view/SwitchView.jsx   components that reveal
frontend/src/DocPageMdx.css               .doc-navigation-focus
```
