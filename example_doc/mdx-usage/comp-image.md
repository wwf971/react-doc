---
title: Images
description: Image fits one image into a display frame; ImageGrid arranges images into centered wrapping rows
language: en
---

<span id="image-single" />

<!--renderComp=MultiLang-->
## {en: "Image", jp: "画像"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`Image` fits an image into a configured display frame and specifies the caption, display mode, and frame size together. The comment contains only the component name; all properties are written in the YAML code block directly after it.

`Image` は、画像を指定した表示枠に収め、キャプション、表示方法、表示枠の大きさをまとめて指定するコンポーネントです。コメントにはコンポーネント名だけを書き、すべてのプロパティを直後の YAML コードブロックに記述します。
```

<!--renderComp=MultiLang,type=list,languages=[en,jp]-->
```markdown
- `src`: path of the image file
- `src`: 画像ファイルのパス
- `alt`: alternative text describing the image
- `alt`: 画像を説明する代替テキスト
- `caption`: description displayed below the image
- `caption`: 画像の下に表示する説明
- `displayMode`: `contain`, `contain-auto`, or `fill`
- `displayMode`: `contain`、`contain-auto`、または `fill`
- `width` / `height`: width and height of the display frame; numbers are treated as px
- `width`／`height`: 表示枠の幅と高さ。数値は px として扱います。
```

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
A normal Markdown renderer shows the content as a YAML code block, while the dedicated document page replaces it with the image.

通常の Markdown では YAML コードブロックとして内容を確認でき、専用のドキュメント画面では画像へ置き換えて表示します。
```

<!--renderComp=MultiLang-->
### {en: "Syntax", jp: "構文"}

````markdown
<!--renderComp=Image-->
```yaml
src: image/robot-computer.svg
alt: パソコンを操作するロボット
caption: 資料作成を支援するロボット
displayMode: contain
width: 420
height: 320
```
````

<!--renderComp=MultiLang-->
### {en: "Display example", jp: "表示例"}

<!--renderComp=Image-->
```yaml
src: image/robot-computer.svg
alt: パソコンを操作するロボット
caption: 資料作成を支援するロボット
displayMode: contain
width: 420
height: 320
```

<span id="image-grid" />

<!--renderComp=MultiLang-->
## {en: "Image Grid", jp: "画像グリッド"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
When the display width narrows, images move to the next row, and each row is centered.

表示幅が狭くなると画像を次の行へ移し、各行を中央揃えにします。
```

<!--renderComp=MultiLang-->
### {en: "Syntax", jp: "構文"}

````markdown
<!--renderComp=ImageGrid-->
```yaml
itemWidth: 260
gap: 16
images:
  - src: image/robot-computer.svg
    alt: パソコンを操作するロボット
    caption: 資料作成を支援するロボット
    displayMode: contain
    height: 220
  - src: image/office-worker.svg
    alt: パソコンを操作する会社員
    caption: パソコンで作業する会社員
    displayMode: contain
    height: 220
```
````

<!--renderComp=MultiLang-->
### {en: "Display example", jp: "表示例"}

<!--renderComp=ImageGrid-->
```yaml
itemWidth: 260
gap: 16
images:
  - src: image/robot-computer.svg
    alt: パソコンを操作するロボット
    caption: 資料作成を支援するロボット
    displayMode: contain
    height: 220
  - src: image/office-worker.svg
    alt: パソコンを操作する会社員
    caption: パソコンで作業する会社員
    displayMode: contain
    height: 220
```
