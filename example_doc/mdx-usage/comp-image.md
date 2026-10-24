---
title: Images
description: Image fits one image into a display frame; ImageGrid arranges images into centered wrapping rows
language: en
---

<!--renderComp=Anchor,id=image-single-->
<!--renderComp=MultiLang-->
## {en: "Image", jp: "画像"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`Image` fits an image into a configured display frame and specifies the caption, display mode, and frame size together. The comment contains only the component name; all properties are written in the YAML code block directly after it.

`Image` は、画像を指定した表示枠に収め、キャプション、表示方法、表示枠の大きさをまとめて指定するコンポーネントです。コメントにはコンポーネント名だけを書き、すべてのプロパティを直後の YAML コードブロックに記述します。
```

<!--renderComp=MultiLang,type=list,languages=[en,jp]-->
```markdown
- `src`: the image file: a path relative to this document (`image/a.svg`), or a source path (`~example/mdx-usage/image/a.svg`)
- `src`: 画像ファイル。この文書からの相対パス（`image/a.svg`）、またはソースパス（`~example/mdx-usage/image/a.svg`）
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

<!--renderComp=Anchor,id=image-empty-->
<!--renderComp=MultiLang-->
### {en: "Empty image and pasting", jp: "空の画像と貼り付け"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
An `Image` without `src` is empty: it shows a placeholder, which is the state a new Image block is created in from the insert menu of edit mode. In edit mode, a paste (Ctrl/⌘+V) while the pointer is over the placeholder writes the clipboard image as a file of the source and sets it as `src`. The file goes to the folder named by the component config `FileStoreDir` (settings panel, tab Component; here `~example/asset-file/image`); with "choose folder" switched on, a prompt asks for the folder first, completing the folders of the source as you type. A paste over an existing image replaces it, after a confirmation when `PasteReplaceConfirmIsOn` is on. When the block's data is an asset (an `asset` block), the paste saves the asset instead of rewriting the block.

`src` のない `Image` は空の状態で、プレースホルダーを表示します。編集モードの挿入メニューから新しい Image ブロックを作るとこの状態になります。編集モードでプレースホルダーにポインターを置いて貼り付け（Ctrl/⌘+V）ると、クリップボードの画像がソースのファイルとして書き込まれ、`src` に設定されます。保存先はコンポーネント設定 `FileStoreDir`（設定パネルの Component タブ。ここでは `~example/asset-file/image`）のフォルダーです。「choose folder」を有効にすると、入力に応じてソースのフォルダーを補完するプロンプトで保存先を先に選べます。既存の画像への貼り付けは、`PasteReplaceConfirmIsOn` が有効なら確認の後に置き換えます。ブロックのデータがアセット（`asset` ブロック）のときは、ブロックを書き換える代わりにアセットを保存します。
```

````markdown
<!--renderComp=Image-->
```yaml
src:
alt:
caption: an empty image, waiting for a paste
```
````

<!--renderComp=Image-->
```yaml
src:
alt:
caption: an empty image, waiting for a paste
```

<!--renderComp=Anchor,id=image-grid-->
<!--renderComp=MultiLang-->
## {en: "Image Grid", jp: "画像グリッド"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
When the display width narrows, images move to the next row, and each row is centered. A slot without `src` is empty, like an empty `Image`; in edit mode a paste over a slot fills that slot (the slot under the pointer takes the paste). A grid opened for editing is in its **Images** mode: it stays a grid, its slots take pastes, slots can be added and removed, and the yaml is one entry away in the mode menu, as the **Source** mode (see [MDX Document In-place Editing](../mdx-doc-edit-in-place.md#imagegrid)). A new ImageGrid block from the insert menu starts with two empty slots.

表示幅が狭くなると画像を次の行へ移し、各行を中央揃えにします。`src` のないスロットは空の `Image` と同じく空の状態です。編集モードでは、ポインターを置いたスロットへの貼り付けがそのスロットを埋めます。編集のために開いたグリッドは **Images** モードになります。グリッドのまま、スロットへの貼り付け、スロットの追加と削除ができ、yaml はモードメニューの **Source** モードで開けます（[MDX Document In-place Editing](../mdx-doc-edit-in-place.md#imagegrid) を参照）。挿入メニューから作った新しい ImageGrid ブロックは、2 つの空のスロットから始まります。
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
  - src:
    caption: an empty slot
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
  - src:
    caption: an empty slot
    height: 220
```
