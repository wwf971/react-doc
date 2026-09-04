# Component via Comment Mark

This file is plain markdown. An html comment `renderComp=...` marks the next
block for component rendering; a normal markdown renderer ignores the comment
and shows the block as-is.

## Multilingual paragraphs inheriting the page language

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
## {jp:多言語の見出し, en:Multilingual heading}

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
### {this mapping cannot be parsed

## Marked code block

<!--renderComp=StockTable,title=Warehouse A-->
```
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #1024 | Wireless Ergonomic Mouse | In Stock |
| #2048 | Mechanical Keyboard (RGB) | Low Stock |
| #4096 | Monitor Arm | Out of Stock |
```

## Same block without the comment (degradation view)

```
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #1024 | Wireless Ergonomic Mouse | In Stock |
```

## Comment directly before a table

<!--renderComp=StockTable,title=Warehouse C-->
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #8192 | USB Dock | In Stock |
| #8193 | Webcam | Low Stock |

## Unknown component name

<!--renderComp=NoSuchComp-->
```
this block shows an inline error box instead of crashing the page
```
