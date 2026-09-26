---
title: Blocks
description: BlockSimple highlights a quote block with a title; BlockMdx renders multi-line Markdown as a titled panel
language: en
---

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`BlockSimple` highlights a Markdown quote block with a title. The default title is the upper-case form of the display type; it can be changed with `title` and is hidden only when `isTitleHidden=true`. GitHub Markdown Alert markers such as `[!CAUTION]` are removed from the displayed content, so the block looks natural both on GitHub and in the document page.

`BlockSimple` は Markdown の引用ブロックをタイトル付きで強調表示します。既定のタイトルは表示種別の大文字表記で、`title` で変更でき、`isTitleHidden=true` の場合だけ非表示になります。GitHub Markdown Alert の `[!CAUTION]` などは表示内容から取り除かれるため、GitHub とWikiページの両方で自然に表示できます。

`Block` is a compatibility entry. It automatically selects `BlockSimple` for quote blocks and `BlockMdx` for `markdown` or `mdx` code blocks. To make the kind explicit, use `BlockSimple` or `BlockMdx` directly.

`Block` は互換用の入口です。引用ブロックでは `BlockSimple`、`markdown` または `mdx` コードブロックでは `BlockMdx` を自動的に使用します。種類を明示したい場合は、`BlockSimple` または `BlockMdx` を直接指定できます。
```

<span id="block-simple" />

<!--renderComp=MultiLang-->
## {en: "Simple Block", jp: "単純ブロック"}

<!--renderComp=MultiLang-->
### {en: "Syntax", jp: "構文"}

```markdown
<!--renderComp=BlockSimple,type=warning-->
> [!CAUTION]
> この操作を実行する前に、変更内容を確認してください。
```

<!--renderComp=MultiLang-->
### {en: "Display example", jp: "表示例"}

<!--renderComp=BlockSimple,type=warning-->
> [!CAUTION]
> この操作を実行する前に、変更内容を確認してください。

<span id="block-mdx" />

<!--renderComp=MultiLang-->
## {en: "Markdown Block", jp: "Markdown ブロック"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`BlockMdx` displays multi-line Markdown, including headings and nested lists, as a titled panel.

`BlockMdx` は、見出しや階層リストを含む複数行の Markdown を、タイトル付きパネルとして表示します。
```

<!--renderComp=MultiLang-->
### {en: "Syntax", jp: "構文"}

````markdown
<!--renderComp=BlockMdx,title=関連資料-->
```markdown
- [Wikiページの構築](/doc-page/doc-page-introduction.md)
- [資料トップ](/doc-page/doc-page-root.md)
```
````

<!--renderComp=MultiLang-->
### {en: "Display example", jp: "表示例"}

<!--renderComp=BlockMdx,title=関連資料-->
```markdown
- [Wikiページの構築](/doc-page/doc-page-introduction.md)
- [資料トップ](/doc-page/doc-page-root.md)
```
