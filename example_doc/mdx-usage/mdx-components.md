---
title: MDX Components
description: Syntax and display examples for the custom components available in MD / MDX documents
language: en
---

<!--renderComp=DocMultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
This part introduces the custom components available in MD / MDX documents, organized by type, with syntax and display examples for each. Detailed syntax and live examples are separated into one document per component type; this page gives the overview and the index.

ドキュメントで利用できるカスタムコンポーネントについて、種類ごとに構文と表示例をまとめています。詳細な構文と表示例はコンポーネント種別ごとの資料に分かれており、このページは概要と索引を提供します。

Almost every example in this part introduces a component with an HTML comment followed by a fenced code block, so the same file stays readable in a normal Markdown renderer. The reasoning behind this style is described in the writing style document below.

このパートのほぼすべての例は、HTML コメントとコードブロックの組み合わせでコンポーネントを導入しているため、通常の Markdown レンダラーでもそのまま読めます。この記法の背景は、下記の記述スタイルの資料で説明しています。
```

<!--renderComp=DocIndex,id=mdx-usage-index-->
```yaml
type: title-subtopics-items
layout: horizontal-wrap
title:
  en: MDX Components
  jp: カスタムコンポーネント集
subtopics:
  - id: writing-style
    title:
      en: Writing style
      jp: 記述スタイル
    items:
      - id: writing-style-recommended
        title:
          en: Recommended comment-block style
          jp: 推奨のコメントブロック記法
        target: /example/mdx-usage/writing-style.md
      - id: writing-style-native
        title:
          en: Direct MDX components
          jp: MDX 直接記法
        target: /example/mdx-usage/comp-mdx-native.mdx
  - id: text-language
    title:
      en: Text and language
      jp: テキストと言語
    items:
      - id: multi-lang
        title:
          en: Multilingual display
          jp: 多言語表示
        target: /example/mdx-usage/comp-multi-lang.md
  - id: blocks
    title:
      en: Blocks
      jp: ブロック
    items:
      - id: block-simple
        title:
          en: Simple block
          jp: 単純ブロック
        target: /example/mdx-usage/comp-block.md#block-simple
      - id: block-mdx
        title:
          en: Markdown block
          jp: Markdown ブロック
        target: /example/mdx-usage/comp-block.md#block-mdx
  - id: images
    title:
      en: Images
      jp: 画像
    items:
      - id: image-single
        title:
          en: Single image
          jp: 画像
        target: /example/mdx-usage/comp-image.md#image-single
      - id: image-grid
        title:
          en: Image grid
          jp: 画像グリッド
        target: /example/mdx-usage/comp-image.md#image-grid
  - id: diagrams
    title:
      en: Diagrams
      jp: 図表
    items:
      - id: diagram-text
        title:
          en: Text diagram
          jp: テキスト図表
        target: /example/mdx-usage/comp-diagram.md#diagram-text
      - id: diagram-mermaid
        title:
          en: Mermaid diagram
          jp: Mermaid 図表
        target: /example/mdx-usage/comp-diagram.md#diagram-mermaid
  - id: files
    title:
      en: Files
      jp: ファイル
    items:
      - id: file-download
        title:
          en: File download
          jp: ファイルダウンロード
        target: /example/mdx-usage/comp-file-download.md
```

<!--renderComp=DocMultiLang-->
## {en: "Writing Style", jp: "記述スタイル"}

<!--renderComp=DocMultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
Instead of writing an MDX component directly, a document introduces a component with an HTML comment and a fenced code block. A normal Markdown renderer ignores the comment and still shows readable content. Direct MDX syntax remains supported in `.mdx` files.

MDX コンポーネントを直接書く代わりに、HTML コメントとコードブロックの組み合わせでコンポーネントを導入します。通常の Markdown レンダラーはコメントを無視するため、内容はそのまま読めます。`.mdx` ファイルでは MDX 直接記法も引き続き利用できます。
```

- [Recommended writing style](writing-style.md)
- [Direct MDX components](comp-mdx-native.mdx)

<!--renderComp=DocMultiLang-->
## {en: "Text and Language", jp: "テキストと言語"}

<!--renderComp=DocMultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`DocMultiLang` switches headings, paragraphs, and lists to the language selected on the page.

`DocMultiLang` は、ページで選択されている言語に合わせて、見出し、段落、一覧を切り替えて表示します。
```

- [Multilingual display](comp-multi-lang.md)

<!--renderComp=DocMultiLang-->
## {en: "Blocks", jp: "ブロック"}

<!--renderComp=DocMultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`BlockSimple` highlights a Markdown quote block with a title, and `BlockMdx` renders multi-line Markdown as a titled panel. `Block` is a compatibility entry that selects one of them automatically.

`BlockSimple` は Markdown の引用ブロックをタイトル付きで強調表示し、`BlockMdx` は複数行の Markdown をタイトル付きパネルとして表示します。`Block` は互換用の入口で、どちらかを自動的に選択します。
```

- [Blocks](comp-block.md)

<!--renderComp=DocMultiLang-->
## {en: "Images", jp: "画像"}

<!--renderComp=DocMultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`DocImage` fits one image into a configured display frame with a caption. `DocImageGrid` arranges several images into centered rows that wrap when the page becomes narrow.

`DocImage` は、画像を指定した表示枠に収め、キャプション付きで表示します。`DocImageGrid` は複数の画像を中央揃えの行として配置し、表示幅が狭くなると折り返します。
```

- [Images and image grids](comp-image.md)

<!--renderComp=DocMultiLang-->
## {en: "Diagrams", jp: "図表"}

<!--renderComp=DocMultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`DocDiagramText` keeps plain-text box diagrams aligned in the browser even when full-width and half-width characters are mixed. `DocDiagramMermaid` renders Mermaid sources such as sequence diagrams.

`DocDiagramText` は、全角文字と半角文字が混在してもテキスト図の罫線をブラウザー上で揃えて表示します。`DocDiagramMermaid` は、シーケンス図などの Mermaid ソースを描画します。
```

- [Text and Mermaid diagrams](comp-diagram.md)

<!--renderComp=DocMultiLang-->
## {en: "Files", jp: "ファイル"}

<!--renderComp=DocMultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`FileDownload` shows a file from the document source as a download card, in a compact or detailed view.

`FileDownload` は資料ソース内のファイルをダウンロードカードとして、コンパクト表示または詳細表示で表示します。
```

- [File download](comp-file-download.md)
