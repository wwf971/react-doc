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
| `Tag`, `TagOverview` | `tag/` | |

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

How referenced and local data are combined belongs to the component. `FileTree` parses both with the same parser, uses the referenced data as the base, and lets local top-level keys override it; `tree` is replaced as a whole. A local block containing only a YAML comment is valid when `dataRef` is present. An overlay diagram would instead keep the referenced tree as its background and read its own overlay data from the local block.

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
