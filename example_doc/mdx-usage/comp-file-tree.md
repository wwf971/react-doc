---
title: File Tree
description: FileTree shows a folder structure, with an optional description for each node
language: en
---

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`FileTree` shows a folder structure written as a YAML `tree` list. Folders can be opened and closed, and each node can carry a plain-text description or a description rendered by a registered component, such as a document link.

`FileTree` は、YAML の `tree` リストで記述したフォルダー構成を表示します。フォルダーは開閉でき、各ノードにはテキストの説明、またはドキュメントリンクなどの登録済みコンポーネントで描画する説明を付けられます。
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
