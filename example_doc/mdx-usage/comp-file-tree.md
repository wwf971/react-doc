---
title: File Tree
description: FileTree shows a folder structure, with an optional description for each node and annotation arrows between nodes
language: en
---

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`FileTree` shows a folder structure written as a YAML `tree` list. Folders can be opened and closed, and each node can carry a plain-text description or a description rendered by a registered component, such as a document link. Annotations can draw arrows between nodes, for example to show which file reads which.

`FileTree` は、YAML の `tree` リストで記述したフォルダー構成を表示します。フォルダーは開閉でき、各ノードにはテキストの説明、またはドキュメントリンクなどの登録済みコンポーネントで描画する説明を付けられます。注釈を使うと、どのファイルがどのファイルを読み込むかなど、ノード間に矢印を描けます。
```

<!--renderComp=MultiLang-->
## {en: "Node properties", jp: "ノードのプロパティ"}

<!--renderComp=MultiLang,type=list,languages=[en,jp]-->
```markdown
- `name`: the displayed name. Required.
- `name`: 表示名です。必須です。
- `type`: `file`, `folder`, or `project`. Without it, a node with `children` is a folder and a node without `children` is a file.
- `type`: `file`、`folder`、`project` のいずれかです。省略した場合、`children` を持つノードはフォルダー、持たないノードはファイルになります。
- `defaultOpen`: opens the folder when the page is first displayed.
- `defaultOpen`: ページを最初に表示したときにフォルダーを開きます。
- `description`: plain text, or a `{ component, data, config }` mapping resolved through the component registry.
- `description`: テキスト、またはコンポーネントレジストリで解決される `{ component, data, config }` の対応表です。
- `id`: an optional short name that annotations use to refer to the node.
- `id`: 注釈からノードを参照するための、任意の短い名前です。
```

<!--renderComp=MultiLang-->
## {en: "Syntax", jp: "構文"}

````markdown
<!--renderComp=FileTree,id=example-project-tree-->
```yaml
tree:
  - name: react-doc/
    type: project
    defaultOpen: true
    description: Reusable document page
    children:
      - name: main/
        type: folder
        defaultOpen: true
        description: Document page implementation
        children:
          - name: comp-mdx/
            type: folder
            description: Components available in documents
          - name: frontend/
            type: folder
            description: Vite app and the embeddable document page
          - name: config.yaml
            description: Demonstration configuration
      - name: example_doc/
        type: folder
        description:
          component: DocLinkInline
          data:
            target: /example/mdx-usage/mdx-components.md
            text: Demonstration documents
```
````

<!--renderComp=MultiLang-->
## {en: "Display example", jp: "表示例"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
The `id` in the comment makes this tree referenceable. [Component data reference](comp-data-ref.md) reuses it from another document.

コメントの `id` により、このツリーを参照できるようになります。[コンポーネントデータ参照](comp-data-ref.md)では、別のドキュメントからこのツリーを再利用しています。
```

<!--renderComp=FileTree,id=example-project-tree-->
```yaml
tree:
  - name: react-doc/
    type: project
    defaultOpen: true
    description: Reusable document page
    children:
      - name: main/
        type: folder
        defaultOpen: true
        description: Document page implementation
        children:
          - name: comp-mdx/
            type: folder
            description: Components available in documents
          - name: frontend/
            type: folder
            description: Vite app and the embeddable document page
          - name: config.yaml
            description: Demonstration configuration
      - name: example_doc/
        type: folder
        description:
          component: DocLinkInline
          data:
            target: /example/mdx-usage/mdx-components.md
            text: Demonstration documents
```

<!--renderComp=MultiLang-->
## {en: "Annotations", jp: "注釈"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`annotations` draws arrows between nodes. `from` and `to` each take one node or a list. A node is referred to by its `id`, or by its name path such as `src/main.js`. When an end of an arrow is inside a collapsed folder, the arrow points at that folder with a dashed line and a hollow marker. Open and close the folders below to see it.

`annotations` はノード間に矢印を描きます。`from` と `to` には、ノードを 1 つ、またはリストで指定します。ノードは `id`、または `src/main.js` のような名前のパスで参照します。矢印の端が閉じたフォルダーの中にある場合、矢印は破線と中抜きの印でそのフォルダーを指します。下のフォルダーを開閉して確認できます。
```

<!--renderComp=MultiLang,type=list,languages=[en,jp]-->
```markdown
- `type`: the annotation type. `arrow` is the default and currently the only type.
- `type`: 注釈の種類です。既定値は `arrow` で、現在はこの種類のみです。
- `from`, `to`: the source and destination nodes, as a node `id`, a name path, or a list of them. Both are required.
- `from`、`to`: 始点と終点のノードです。ノードの `id`、名前のパス、またはそのリストで指定します。両方とも必須です。
- `text`: optional text shown beside the vertical line of the arrow.
- `text`: 矢印の縦線の横に表示する任意のテキストです。
- `lane`: optional lane number. Each arrow has its own vertical lane by default; arrows with the same `lane` share one, so use it only for arrows that do not overlap.
- `lane`: 任意のレーン番号です。既定では矢印ごとに縦のレーンを持ちます。同じ `lane` の矢印は 1 本のレーンを共有するため、重ならない矢印にだけ使ってください。
- `style`: optional style of this arrow, overriding `annotationStyle.arrow` key by key.
- `style`: この矢印の任意のスタイルです。`annotationStyle.arrow` をキーごとに上書きします。
```

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
Style keys, lengths in px: `color`, `textColor`, `lineWidth`, `lineStyle` (`solid`, `dashed`, `dotted`), `lineStyleCollapsed`, `cornerRadius`, `headShape` (`triangle`, `open`, `none`), `headSize`, `tailShape` (`dot`, `none`), `gap`, `laneSpacing`, `textGap`, `textMaxWidth`. Problems such as an unknown node or style key are listed below the tree, and the other arrows are still drawn.

スタイルのキー（長さは px）: `color`、`textColor`、`lineWidth`、`lineStyle`（`solid`、`dashed`、`dotted`）、`lineStyleCollapsed`、`cornerRadius`、`headShape`（`triangle`、`open`、`none`）、`headSize`、`tailShape`（`dot`、`none`）、`gap`、`laneSpacing`、`textGap`、`textMaxWidth`。存在しないノードやスタイルのキーなどの問題はツリーの下に一覧表示され、ほかの矢印は引き続き描画されます。
```

````markdown
<!--renderComp=FileTree-->
```yaml
tree:
  - name: app/
    type: project
    defaultOpen: true
    children:
      - name: src/
        defaultOpen: true
        children:
          - name: main.js
            id: entry
          - name: router.js
            id: router
          - name: pages/
            children:
              - name: home.jsx
                id: home
              - name: settings.jsx
                id: settings
      - name: config.yaml
        id: config
annotations:
  - from: [entry, router]
    to: config
    text: read at startup
  - from: router
    to: [home, settings]
    text: lazy loads pages
    style: { lineStyle: dashed }
  - from: home
    to: settings
    text: link
```
````

<!--renderComp=FileTree-->
```yaml
tree:
  - name: app/
    type: project
    defaultOpen: true
    children:
      - name: src/
        defaultOpen: true
        children:
          - name: main.js
            id: entry
          - name: router.js
            id: router
          - name: pages/
            children:
              - name: home.jsx
                id: home
              - name: settings.jsx
                id: settings
      - name: config.yaml
        id: config
annotations:
  - from: [entry, router]
    to: config
    text: read at startup
  - from: router
    to: [home, settings]
    text: lazy loads pages
    style: { lineStyle: dashed }
  - from: home
    to: settings
    text: link
```

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
Annotations can also be drawn above a tree written elsewhere. This block references the tree above through `dataRef` and only adds its own `annotations`. `annotationStyle.arrow` changes the style of every arrow in the block.

注釈は、別の場所に書かれたツリーの上にも描けます。このブロックは `dataRef` で上のツリーを参照し、自身の `annotations` だけを追加しています。`annotationStyle.arrow` はブロック内のすべての矢印のスタイルを変更します。
```

<!--renderComp=FileTree,dataRef=#example-project-tree-->
```yaml
annotationStyle:
  arrow:
    color: "#2563eb"
    headShape: open
annotations:
  - from: react-doc/main/config.yaml
    to: [react-doc/main/frontend, react-doc/main/comp-mdx]
    text: configures
```
