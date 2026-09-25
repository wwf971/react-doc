---
title: Multilingual Display
description: DocMultiLang switches headings, paragraphs, and lists to the language selected on the page
language: en
---

<!--renderComp=DocMultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`DocMultiLang` switches headings, paragraphs, and lists to the language selected on the page. The language used when the page is first opened is specified by `language` in the frontmatter.

`DocMultiLang` は、ページで選択されている言語に合わせて、見出し、段落、一覧を切り替えて表示します。ページを最初に開いたときの言語は、フロントマターの `language` で指定します。
```

<!--renderComp=DocMultiLang-->
## {en: "Paragraphs", jp: "段落"}

<!--renderComp=DocMultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
With `type=paragraphs`, paragraphs are arranged in the order of the languages given in `languages`. Multiple consecutive groups of paragraphs are kept in one single `markdown` code block instead of one code block per group.

`type=paragraphs` では、`languages` に指定した言語の順序で段落を並べます。連続する複数組の段落は、一組ごとにコードブロックを分けず、一つの `markdown` コードブロックにまとめられます。
```

<!--renderComp=DocMultiLang-->
### {en: "Syntax", jp: "構文"}

````markdown
<!--renderComp=DocMultiLang,type=paragraphs,languages=[jp,en]-->
```markdown
最初の段落です。

This is the first paragraph.

次の段落です。

This is the next paragraph.
```
````

<!--renderComp=DocMultiLang-->
### {en: "Display example", jp: "表示例"}

<!--renderComp=DocMultiLang,type=paragraphs,languages=[jp,en]-->
```markdown
最初の段落です。

This is the first paragraph.

次の段落です。

This is the next paragraph.
```

<!--renderComp=DocMultiLang-->
## {en: "Lists", jp: "一覧"}

<!--renderComp=DocMultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
With `type=list`, the translations of each item are arranged in the order of the languages given in `languages`.

`type=list` では、`languages` に指定した言語の順序で各項目の翻訳を並べます。
```

<!--renderComp=DocMultiLang-->
### {en: "Syntax", jp: "構文"}

````markdown
<!--renderComp=DocMultiLang,type=list,languages=[jp,en]-->
```markdown
- 最初の項目
- First item
- 次の項目
- Next item
```
````

<!--renderComp=DocMultiLang-->
### {en: "Display example", jp: "表示例"}

<!--renderComp=DocMultiLang,type=list,languages=[jp,en]-->
```markdown
- 最初の項目
- First item
- 次の項目
- Next item
```

<!--renderComp=DocMultiLang-->
## {en: "Shared YAML form", jp: "共通 YAML 形式"}

<!--renderComp=DocMultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
Besides the Markdown block forms above, the same trigger comment accepts one YAML list. Each root item selects a renderer through `type`: `p` for a paragraph, `ul` or `ol` for a list. Translations are placed directly on the item, and list items can nest further lists through `children`.

上記の Markdown ブロック形式に加えて、同じトリガーコメントは一つの YAML リストも受け付けます。ルートの各項目は `type` でレンダラーを選択します。`p` は段落、`ul` と `ol` は一覧です。翻訳は項目に直接記述し、一覧の項目は `children` でさらに一覧をネストできます。
```

<!--renderComp=DocMultiLang-->
### {en: "Paragraphs in YAML", jp: "YAML の段落"}

<!--renderComp=DocMultiLang-->
```yaml
- type: p
  en: This paragraph inherits English from the document page configuration.
  jp: この段落はドキュメントページ設定から日本語を継承します。
- type: p
  en: A normal Markdown renderer shows this YAML block instead.
  jp: 通常のMarkdownレンダラーでは、代わりにこのYAMLブロックが表示されます。
```

<!--renderComp=DocMultiLang-->
### {en: "Nested lists in YAML", jp: "YAML のネストされた一覧"}

<!--renderComp=DocMultiLang-->
```yaml
- type: ul
  items:
    - en: First unordered item.
      jp: 最初の箇条書き項目です。
      children:
        - type: ol
          items:
            - en: First nested step with `inline code`.
              jp: `インラインコード`を含む最初のネストされた手順です。
            - en: Second nested step.
              jp: 2番目のネストされた手順です。
    - en: Second unordered item.
      jp: 2番目の箇条書き項目です。
```

<!--renderComp=DocMultiLang-->
## {en: "Headings", jp: "見出し"}

<!--renderComp=DocMultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
For a multilingual heading, place a Markdown heading whose text maps language codes to display strings directly after the `DocMultiLang` comment. Adding an explicit anchor allows the same fragment link to be used whichever language is displayed.

多言語の見出しでは、`DocMultiLang` のコメント直後に、言語コードと表示文字列の対応を記述した Markdown 見出しを置きます。明示的なアンカーを付けると、どの言語を表示している場合でも同じフラグメントリンクを使用できます。
```

<!--renderComp=DocMultiLang-->
### {en: "Syntax", jp: "構文"}

````markdown
<span id="multilingual-heading-example" />

<!--renderComp=DocMultiLang-->
### {jp: "多言語の見出し", en: "Multilingual Heading"}
````

<!--renderComp=DocMultiLang-->
### {en: "Display example", jp: "表示例"}

<span id="multilingual-heading-display-example" />

<!--renderComp=DocMultiLang-->
#### {jp: "多言語の見出し", en: "Multilingual Heading"}

<!--renderComp=BlockSimple,type=warning,title=アンカーの後には空行が必要です-->
> `<span id="..." />` と `<!--renderComp=DocMultiLang-->` の間には、必ず空行を入れてください。空行がない場合、Markdown パーサーはアンカー、コメント、見出しを一つの生の HTML ブロックとして扱います。その結果、見出しが見出しノードとして認識されず、どの言語を選択しても表示されません。

<!--renderComp=DocMultiLang-->
### {en: "Unparsable mapping", jp: "解析できない対応表"}

<!--renderComp=DocMultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
When the heading mapping cannot be parsed, the native heading is left unchanged instead of being replaced by an error, preserving ordinary Markdown degradation:

見出しの対応表を解析できない場合は、エラー表示に置き換えずに元の見出しをそのまま残し、通常の Markdown としての読みやすさを保ちます。
```

<!--renderComp=DocMultiLang-->
### {this mapping cannot be parsed
