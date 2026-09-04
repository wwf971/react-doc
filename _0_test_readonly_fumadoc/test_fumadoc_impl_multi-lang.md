<!-- Multilingual design for the fumadocs-based readonly doc system test. Main design: ./test_fumadoc_impl.md -->

# Fumadocs Test Environment: Multilingual Content Design

## Scope

The multilingual feature supports basic document components through one shared entry. Paragraphs, unordered lists, ordered lists, nested lists, and native Markdown headings all inherit the same preferred language. Language codes are author-provided strings and are not limited to `en` and `jp`.

For filenames, all code files dedicated to the multi-language feature start with `MultiLang`. Existing public component and context export names remain stable for consumers.

## Language preference and synchronization

`DocPageMdx` accepts `config.language` as the document-page preference. A document can override it with `language` in YAML frontmatter, and a multilingual YAML block can override both with an authored `language` comment property. A missing preference inherits from the nearest language context in this order:

1. component
2. document frontmatter
3. document page
4. optional outer `DocLanguageProvider`

Compilation collects language keys from multilingual headings and YAML blocks in source order. When at least one language exists, both the document toolbar and the floating bottom-right back/forward controls display the same `config.components.SegmentedControl` supplied by the consumer. The selected language is stored by `DocStore` per content path. Changing either selector updates the page language context and rerenders every multilingual basic component and both selectors without a local override.

For any item that lacks the preferred translation, the renderer uses that item's first authored translation. The rendered paragraph, list item, or heading text receives the actual `lang` value.

## Shared YAML entry

A normal Markdown renderer ignores the trigger comment and displays the YAML code block. The document runtime recognizes it as the shared `DocMultiLang` entry:

````markdown
<!--renderComp=DocMultiLang-->
```yaml
- type: p
  en: English paragraph
  jp: 日本語の段落
```
````

The YAML root must be a list. Every root item dispatches to a child renderer according to `type`.

## Paragraphs

Paragraphs use `type: p` and put translations directly on the item. Inline text enclosed by single backticks renders as inline code.

```yaml
- type: p
  en: Use `npm run build` to validate the package.
  jp: `npm run build`でパッケージを検証します。
- type: p
  en: Another paragraph.
  jp: もう一つの段落です。
```

## Headings

A multilingual heading uses the same trigger comment immediately before a native Markdown heading. Its heading text is a YAML flow mapping:

```markdown
<!--renderComp=DocMultiLang-->
## {jp:日本語見出し, en:English Heading}
```

Whitespace after each colon is optional, so both `{jp:日本語, en:English}` and `{jp: 日本語, en: English}` are accepted. Heading levels 1 through 6 work because the transform retains the original native heading node and changes only its text child. Fumadocs therefore retains the heading depth, generated anchor properties, table-of-contents participation, copy-link control, and search structure.

The heading anchor is generated from the original flow-mapping source and remains stable when the selected language changes.

Only a trigger comment immediately followed by a heading activates this syntax. If the mapping cannot be parsed, has no entries, contains a non-text value, or contains Markdown child nodes rather than one plain text node, the transform records no languages and leaves the heading unchanged. The generic comment-block transform also skips that marker, so ordinary rendering displays the raw heading text instead of producing a component error.

## Unordered and ordered lists

Lists use `type: ul` or `type: ol` with an `items` list. Each list item puts translations directly on the item:

```yaml
- type: ul
  items:
    - en: First unordered item.
      jp: 最初の箇条書き項目です。
    - en: Second unordered item.
      jp: 2番目の箇条書き項目です。
- type: ol
  items:
    - en: First step.
      jp: 最初の手順です。
    - en: Second step.
      jp: 2番目の手順です。
```

The renderer emits native `ul`, `ol`, and `li` elements, preserving normal document styling and accessibility semantics.

## Nested lists

A list item can contain a `children` list. Each child must be another `ul` or `ol` object and can recursively contain more children. A parent with children may keep translations directly on itself:

```yaml
- type: ul
  items:
    - en: Parent item.
      jp: 親項目です。
      children:
        - type: ol
          items:
            - en: First nested step.
              jp: 最初のネストされた手順です。
            - en: Second nested step.
              jp: 2番目のネストされた手順です。
              children:
                - type: ul
                  items:
                    - en: Nested detail.
                      jp: ネストされた詳細です。
    - en: Parent sibling.
      jp: 親項目と同じ階層の項目です。
```

For compatibility with data that separates structural and translated fields, a list item may alternatively place translations under `text`:

```yaml
- type: ul
  items:
    - text:
        en: Parent item.
        jp: 親項目です。
      children:
        - type: ul
          items:
            - en: Child item.
              jp: 子項目です。
```

Language detection recursively scans all list items and nested child lists.

## Search indexing

Fumadocs `remarkStructure` scans ordinary Markdown nodes automatically. A rendered custom component has no ordinary text children, so its semantic content must be supplied separately. Fumadocs supports this through `node.data.structuredData.contents`; its default stringifier adds those entries to the current heading while extracting structured search data.

The comment-component transform uses this extension point. `DocMultiLang` contributes every valid translation from paragraphs and recursively nested list items, so searches match content in any authored language, not only the currently selected language. Multilingual headings contribute one heading entry per translation, all sharing the native heading anchor.

Additional comment components can provide index content through `config.compile.structuredDataGetByComponent`, keyed by authored component name. The callback receives the raw marked block and a context object containing `compName` and parsed comment `props`. It returns the Fumadocs structured-data shape:

```javascript
structuredDataGetByComponent: {
  StockTable: (raw, { props }) => ({
    contents: [
      { content: `${props.title ?? ''} ${raw}`.trim() },
    ],
  }),
}
```

Search indexing runs lazily and caches the resulting structured data per source path. Replacing source data clears this cache. Invalid multilingual YAML contributes no custom entries rather than indexing an error message or raw YAML syntax.

The search dialog groups matching heading and text rows below one page row. That page row is contextual rather than an additional text match. Before display, `DocStore` resolves it through the page-tree model, uses the configured side-panel item text, and changes its URL to the corresponding item route. It therefore cannot display stale source-title metadata when every search happens to match another row in the same document. When no custom side-panel text exists, manifest title extraction uses frontmatter `title`, then a level-one Markdown heading, then the file name. Level-one-looking lines inside fenced code blocks are ignored, so example code such as `# note ...` cannot become an unrelated page label above a multilingual search match.

## Parsing and error behavior

Malformed YAML blocks render an inline error with their raw source. A parsed root value that is not a YAML list also renders an error. Unsupported root types, missing list `items`, malformed list items, or invalid nested children produce localized inline errors while valid sibling content continues rendering.

Malformed heading mappings intentionally behave differently: the native heading is left untouched, the trigger comment stays invisible as an HTML comment, and no language variants are reported. This preserves ordinary Markdown degradation and avoids replacing a readable heading with an error component.

## Runtime boundaries

The shared YAML entry is exposed as `common/DocMultiLang` and remains limited to the `commentBlock` placement. The `SegmentedControl` is runtime-injected by the consuming application, avoiding a dependency from the reusable document package to an application component library.

Additional comment components can participate in toolbar language detection through `config.compile.languageListGetByComponent`. Each callback receives the raw marked block and returns its supported language codes.
