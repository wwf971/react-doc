<!-- Design of components available inside documents. Parent document: doc_page_impl.md -->

# MDX Components: Design

Components that authors can use inside md/mdx documents live under `main/comp-mdx/`, one folder per component family. They are ordinary registered components: `config.yaml` `compRegistry` maps a tag name to a component id, and the component definition in `compById` (created with `compDefine()`) provides the render component and its declared capabilities. Registration, placements, and the common `{ data, config, onEvent }` interface are described in [Document Page: Design](doc_page_impl.md#component-registry).

```text
document  <!--renderComp=FileTree,id=x-->  or  <FileTree .../>
   -> compRegistry: tag name FileTree -> id common/FileTree
   -> compById: definition { CompRender, componentType, dataRefTypeList, placementList, dataBuild }
   -> RegisteredComp: normalize input into { data, config, onEvent }
   -> render component
```

## Component names

Component and file names carry no `Doc` prefix: inside a document every component is already a document component, so the prefix adds no meaning.

| Tag name | Folder | Compatibility tag name |
| --- | --- | --- |
| `FileTree` | `file-tree/` | `DocFileTree` |
| `Index` | `index/` | `DocIndex` |
| `MultiLang` | `multi-lang/` (`MultiLangEntry.jsx`) | `DocMultiLang` |
| `Image` | `image/` | `DocImage` |
| `ImageGrid` | `image-grid/` | `DocImageGrid` |
| `DiagramText` | `diagram-ascii/` | `DocDiagramText` |
| `DiagramMermaid` | `diagram-mermaid/` | `DocDiagramMermaid` |
| `DiagramER` | `diagram-er/` | `DocDiagramER` |
| `BlockSimple`, `Block` | `block-simple/` | |
| `BlockMdx` | `block-mdx/` | |
| `Tag`, `TagLabel`, `TagOverview` | `tag/` | |

Some components read host settings from `config`, supplied by the application through `DocPageMdx` `config.compConfigHost` (see [Component registry](doc_page_impl.md#component-registry)): `Image` and `ImageGrid` resolve `src` through `assetUrlGet`, and `DiagramMermaid` loads Mermaid through `mermaidLoad` and resolves lane icons through `assetUrlGet`. The block components receive `MdxRenderer` and `DocLink` from their package registry definitions.

Documents and consumer code written with the old names keep working:

- Each component module exports both names, for example `export { FileTree, FileTree as DocFileTree }`. `IndexData.js` also keeps `docIndexLanguageListGet` and `docIndexStructuredDataGet`.
- The package registry keeps the old component ids (`common/DocFileTree`, `common/DocIndex`, `common/DocMultiLang`, `common/DocImage`, `common/DocImageGrid`, `common/DocDiagramText`, `common/DocDiagramMermaid`) as aliases of the new definitions, so existing consumer `compRegistry` entries still resolve.
- The demo `config.yaml` maps both tag names to the same id.
- Code that recognizes a component by tag name before the registry is involved accepts both names: the multilingual heading marker and compile callbacks (`multiLangCompNameList` in `MultiLangData.js`), and the build-time attachment finders for `Image`, `ImageGrid`, and `DiagramMermaid`. Consumer callbacks keyed by tag name, such as `compile.languageListGetByComponent`, must list every tag name in use.

`DocLink`, `DocLinkInline`, and `DocComp` keep their names. In `DocLink`, "Doc" means "link to a document", as opposed to `SourceLink`; `DocLink` and `DocComp` are also element names emitted by the remark plugins that custom recognizers rely on.

## Component data reference

A component can reuse the authored data of another component instead of repeating it. The source component is marked with a document-unique `id`; the reusing component names it with `dataRef`. A typical use is a family of diagrams that draw different overlays above the same file tree: the tree is written once, and each diagram references it as its background.

````markdown
<!-- comp-file-tree.md: the source -->
<!--renderComp=FileTree,id=example-project-tree-->
```yaml
tree: [...]
```

<!-- another document: the reference, with optional local data -->
<!--renderComp=FileTree,dataRef=comp-file-tree.md#example-project-tree-->
```yaml
maxHeight: 8rem
```
````

In `.mdx`, the same reference is a property: `<FileTree dataRef="comp-file-tree.md#example-project-tree" />`. `dataRef` is always a component property (a comment key or an MDX attribute), never a key inside the YAML block, because the host resolves it before the component parses its own data.

### Reference grammar

```text
dataRef = {document target}#{component id}

/root/a.md#tree        exact internal path
./a.md#tree, ../a.md   relative to the referencing document
xx/a.md#tree           path suffix
a.md#tree              file name
@first/{itemId}#tree   first document of a side-panel item
#tree                  component in the referencing document
```

The document part uses the document-link grammar of [Navigation design](doc_page_impl_nav.md#link-recognition-and-target-resolution), resolved by the same function. The fragment, which selects a place in a link, selects a component here. A data reference reads data and does not navigate, so the referenced document must be collected in the source but does not need a side-panel item. A file-name or suffix target matching several documents uses the first match in source order and shows a warning listing all matches, like an ambiguous side-panel item.

### Resolution flow

```text
RegisteredComp: data.dataRef present?
  no  -> render the component as usual
  yes -> CompDataRefHost
           -> useCompDataRef(dataRef, sourcePath)
                -> DocStore.compDataRefLoad()   load + compile the referenced document
                -> DocStore.compDataRefQuery()  observable result
                     -> docTargetResolve()       shared with DocLink
                     -> componentQueryByPath()   shared with the part index
                     -> compInputNormalize()     the data the referenced component itself receives
           -> validate, then render the component with data.dataRefResolved
```

The referenced document is compiled through the normal `DocSourceStore.loadDoc()` cache. Compilation records every id-marked comment-block component of the document, which is the same lookup used to locate a hosted part index. The referenced data is normalized by `compInputNormalize()`, the function `RegisteredComp` uses for every invocation, so the reusing component sees exactly the `data` the referenced component itself receives (properties, `raw`, `lang`).

### Component interface

A component opts in by declaring the component types it accepts. A component that is referenced declares its own `componentType`:

```javascript
compDefine(FileTree, {
  componentType: 'fileTree',
  dataRefTypeList: ['fileTree'],
  placementList: ['mdx', 'commentBlock'],
})
```

After validation, the component receives its own data plus `data.dataRefResolved`:

```text
data.dataRefResolved = {
  target,          authored dataRef
  docPath,         internal path of the referenced document
  componentId,     id of the referenced component
  compName,        authored tag name of the referenced component
  compId,          resolved registry id
  componentType,   declared type of the referenced definition
  data,            normalized data of the referenced component
}
```

How referenced and local data are combined belongs to the component. `FileTree` parses both with the same parser, uses the referenced data as the base, and lets local top-level keys override it; `tree` is replaced as a whole. A local block containing only a YAML comment is valid when `dataRef` is present. A local block containing only `annotations` keeps the referenced tree as its background and draws its own overlay above it (see [File tree annotations](#file-tree-annotations)).

A component that needs more than one reference, or a reference chosen by its own data, calls `useCompDataRef(target, { sourcePath: config.sourcePath })` from an observer component. The hook is exported from the package entry and returns the same result object as `DocStore.compDataRefQuery()` (`status`, `message`, `warning`, `componentType`, `data`, ...). The component is then responsible for its own type checks and messages.

### Errors and warnings

Problems are shown in place of the component, together with the authored `dataRef`, so the author sees the failure where it was written:

- the component definition declares no `dataRefTypeList` (legacy plain-function components cannot accept references either);
- `dataRef` is empty, not a string, or has no `#component-id`;
- the document is not found in the source;
- the document fails to compile, or the id is missing or duplicated in it;
- the referenced component is not registered;
- the referenced `componentType` is not in `dataRefTypeList`;
- a component references its own id.

While the referenced document is compiling, a neutral loading line replaces the component. An ambiguous document target shows a warning above the rendered component.

### Constraints

- Only comment-block components with an `id` can be referenced. MDX component properties are JavaScript expressions evaluated at render time, so they are not available before the referenced document is rendered.
- References are resolved one level deep. If the referenced component itself has a `dataRef`, its data is delivered unchanged, including that `dataRef`; the host does not follow chains.
- With `pruneSourceToSidePanel`, a referenced document that has no side-panel item must be listed in `sourceDependencies` of a retained item; otherwise the deployed page reports it as not found.

## File tree annotations

A `FileTree` can draw annotations above its rows. The first annotation type is a right-angled arrow from one or more source nodes to one or more destination nodes, with optional text beside it:

```text
main.js     ●──╮
               │ reads at startup
config.yaml ◀──╯
```

```yaml
tree:
  - name: src/
    children:
      - name: main.js
        id: entry            # optional, a short stable name for references
  - name: config.yaml
annotationStyle:             # optional, shared style per annotation type
  arrow: { color: "#2563eb" }
annotations:
  - type: arrow              # default; the type decides the remaining keys
    from: entry              # one reference or a list
    to: [config.yaml]
    text: reads at startup
    lane: 0                  # optional; same lane = same vertical track
    style: { lineStyle: dashed }   # optional, overrides annotationStyle.arrow
```

A node reference is a node `id`; when no node has that id, it is read as a name path such as `src/main.js`, ignoring the trailing `/` of folder names. An endpoint can also be written as `{ node: entry }`, which leaves room for per-endpoint options. Every annotation has its own lane by default, in list order; annotations sharing a `lane` share one vertical track, and the author keeps them from overlapping.

Arrow style keys, all lengths in px: `color`, `textColor`, `lineWidth`, `lineStyle` (`solid` / `dashed` / `dotted`), `lineStyleCollapsed`, `cornerRadius`, `headShape` (`triangle` / `open` / `none`), `headSize`, `tailShape` (`dot` / `none`), `gap` (name to arrow end), `laneSpacing`, `textGap`, `textMaxWidth`. Defaults use the muted theme color, so arrows look like part of the tree.

**Layout.** The tree grid has three columns: name, gutter, description. The gutter is empty unless annotations exist; its width is the sum of lane widths, and a lane is as wide as its trunk spacing plus its widest text. Each endpoint gets a horizontal branch from the end of its name to the trunk of its lane; the text sits to the right of the trunk, centered on it. The gutter width depends only on text sizes, never on row positions, so the layout cannot oscillate.

**Collapsed folders.** An endpoint hidden in a collapsed folder is drawn at the outermost collapsed ancestor row, with the collapsed line style and a hollow marker, meaning "somewhere inside". Endpoints landing on the same row with the same role merge. When one row is both source and destination, the two branches move slightly apart, so an arrow whose ends all collapse into one folder becomes a small loop on that row; its text is hidden there, because it would cover the branches of other arrows on that row. The overlay reads open state from `FileTreeStore`, the same source the rows render from, so the arrows always match the displayed tree. While a folder is opening, endpoints stay inside the growing children clip instead of pointing at rows that are not visible yet.

**Responsibilities.**

```text
FileTreeStore          parses data; keeps annotations / annotationStyle as authored
FileTreeOverlayStore   annotation type registry, reference resolution, visible-row mapping,
                       measured geometry (source of truth), lanes, gutter width, shapes
FileTreeOverlayArrow.js  arrow type: grammar normalization, style defaults, geometry (pure)
FileTreeOverlay.jsx    measures the tree, renders shapes, labels, and warnings
FileTree               reserves the gutter, marks rows / names / clips with data attributes
```

`FileTreeOverlay` is a zero-size layer at the content origin of the tree, so it scrolls with the rows. Its SVG has a real size, the name column plus the gutter down to the last row, with a `viewBox` of the same size; the size comes from row geometry, never from the scroll size, so the drawing cannot enlarge the tree it measures. Measured positions are converted from on-screen px to css px by the on-screen scale of the tree, so CSS `zoom` or a scale transform on an ancestor does not shift the arrows away from the rows. A `ResizeObserver` watches the tree, every row, every children clip, and every label; any size change (container resize, font load, folder animation, data change) schedules one measurement per animation frame. The store ignores a measurement that is equal to the current one, then recomputes the shapes.

A new annotation type adds a `{ normalize, laneWidthGet, layout }` entry to `overlayTypeById` in `FileTreeOverlayStore.js` and a renderer to `shapeRenderByType` in `FileTreeOverlay.jsx`. Problems such as an unknown type, an unknown style key, or an unresolved reference are listed below the tree; every valid annotation still renders.
