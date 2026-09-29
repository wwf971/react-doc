---
title: Component Data Reference
description: A component reuses the authored data of another component, addressed by document and component id
language: en
---

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
A component can reuse the data authored for another component instead of repeating it. The source component is marked with `id`, and the reusing component names it with `dataRef`. For example, several documents can draw different overlays on the same file tree while the tree itself is written only once.

コンポーネントは、別のコンポーネント用に記述されたデータを、繰り返し書かずに再利用できます。参照元のコンポーネントには `id` を付け、再利用する側は `dataRef` でそれを指定します。たとえば、ツリー自体は一度だけ記述し、複数のドキュメントで同じファイルツリーに異なるオーバーレイを描くことができます。
```

<!--renderComp=MultiLang-->
## {en: "Reference format", jp: "参照の形式"}

```text
dataRef = {document target}#{component id}

/example/mdx-usage/comp-file-tree.md#example-project-tree   exact internal path
./comp-file-tree.md#example-project-tree                     relative to this document
comp-file-tree.md#example-project-tree                       file name
@first/mdx-usage#mdx-usage-index                             first document of a side-panel item
#local-tree                                                  component in this document
```

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
The document part accepts the same forms as document links. The part after `#` is the `id` of a comment-block component in that document. The referenced document does not need a side-panel entry, but it must be collected in the document source.

ドキュメント部分には、ドキュメントリンクと同じ形式を使用できます。`#` の後は、そのドキュメント内にあるコメントブロック形式のコンポーネントの `id` です。参照先のドキュメントはサイドパネルに含まれている必要はありませんが、ドキュメントソースに収集されている必要があります。
```

<!--renderComp=MultiLang-->
## {en: "Reference from another document", jp: "別のドキュメントからの参照"}

<!--renderComp=MultiLang-->
### {en: "Syntax", jp: "構文"}

````markdown
<!--renderComp=FileTree,dataRef=comp-file-tree.md#example-project-tree-->
```yaml
# The tree is defined in comp-file-tree.md (id: example-project-tree).
```
````

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
The YAML block may contain only a comment. A normal Markdown renderer still shows where the data comes from.

YAML ブロックにはコメントだけを書くこともできます。通常の Markdown レンダラーでも、データの参照元が分かります。
```

<!--renderComp=MultiLang-->
### {en: "Display example", jp: "表示例"}

<!--renderComp=FileTree,dataRef=comp-file-tree.md#example-project-tree-->
```yaml
# The tree is defined in comp-file-tree.md (id: example-project-tree).
```

<!--renderComp=MultiLang-->
## {en: "Overriding referenced data", jp: "参照データの上書き"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
Each component decides how referenced data and its own data are combined. `FileTree` uses the referenced data as the base, and top-level keys in its own YAML override it. Here `maxHeight` limits the height of the same tree.

参照データと自身のデータの組み合わせ方は、各コンポーネントが決めます。`FileTree` は参照データを基にし、自身の YAML のトップレベルのキーで上書きします。ここでは、`maxHeight` で同じツリーの高さを制限しています。
```

````markdown
<!--renderComp=FileTree,dataRef=comp-file-tree.md#example-project-tree-->
```yaml
maxHeight: 8rem
```
````

<!--renderComp=FileTree,dataRef=comp-file-tree.md#example-project-tree-->
```yaml
maxHeight: 8rem
```

<!--renderComp=MultiLang-->
## {en: "Overlay on a referenced tree", jp: "参照したツリーへのオーバーレイ"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
Own YAML can also add keys that the referenced data does not have. Here `annotations` draws an arrow above the referenced tree, while the tree itself stays in `comp-file-tree.md`. Another document can reference the same tree and draw different arrows. For the annotation syntax, see [File tree](comp-file-tree.md).

自身の YAML では、参照データにないキーを追加することもできます。ここでは `annotations` で参照したツリーの上に矢印を描いており、ツリー自体は `comp-file-tree.md` にあります。別のドキュメントから同じツリーを参照し、異なる矢印を描くこともできます。注釈の構文は[ファイルツリー](comp-file-tree.md)を参照してください。
```

````markdown
<!--renderComp=FileTree,dataRef=comp-file-tree.md#example-project-tree-->
```yaml
annotations:
  - from: react-doc/main/frontend
    to: react-doc/example_doc
    text: renders
```
````

<!--renderComp=FileTree,dataRef=comp-file-tree.md#example-project-tree-->
```yaml
annotations:
  - from: react-doc/main/frontend
    to: react-doc/example_doc
    text: renders
```

<!--renderComp=MultiLang-->
## {en: "Reference within the same document", jp: "同じドキュメント内の参照"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
Without a document part, the reference points to a component in the current document. The first tree below is the source, and the second one reuses it.

ドキュメント部分を省略すると、現在のドキュメント内のコンポーネントを参照します。下の一つ目のツリーが参照元で、二つ目がそれを再利用しています。
```

````markdown
<!--renderComp=FileTree,id=local-tree-->
```yaml
tree:
  - name: notes/
    defaultOpen: true
    children:
      - name: meeting.md
      - name: plan.md
```

<!--renderComp=FileTree,dataRef=#local-tree-->
```yaml
# Same tree as local-tree above.
```
````

<!--renderComp=FileTree,id=local-tree-->
```yaml
tree:
  - name: notes/
    defaultOpen: true
    children:
      - name: meeting.md
      - name: plan.md
```

<!--renderComp=FileTree,dataRef=#local-tree-->
```yaml
# Same tree as local-tree above.
```

<!--renderComp=MultiLang-->
## {en: "Invalid references", jp: "無効な参照"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
An invalid reference replaces the component with an inline error that names the authored `dataRef`, so the problem is visible where it was written. The examples below show each kind of failure.

無効な参照では、コンポーネントの代わりに、記述された `dataRef` を示すエラーをその場に表示します。記述した箇所で問題を確認できます。以下は、失敗の種類ごとの例です。
```

<!--renderComp=MultiLang-->
### {en: "Document not found", jp: "ドキュメントが見つからない"}

<!--renderComp=FileTree,dataRef=no-such-doc.md#example-project-tree-->
```yaml
# The referenced document does not exist.
```

<!--renderComp=MultiLang-->
### {en: "Component id not found", jp: "コンポーネント ID が見つからない"}

<!--renderComp=FileTree,dataRef=comp-file-tree.md#no-such-tree-->
```yaml
# The referenced document has no component with this id.
```

<!--renderComp=MultiLang-->
### {en: "Component id missing", jp: "コンポーネント ID がない"}

<!--renderComp=FileTree,dataRef=comp-file-tree.md-->
```yaml
# The reference has no "#component-id" part.
```

<!--renderComp=MultiLang-->
### {en: "Incompatible component type", jp: "互換性のないコンポーネント種別"}

<!--renderComp=FileTree,dataRef=mdx-components.md#mdx-usage-index-->
```yaml
# The referenced component is an index, not a file tree.
```

<!--renderComp=MultiLang-->
### {en: "Component without reference support", jp: "参照に対応していないコンポーネント"}

<!--renderComp=StockTable,dataRef=#local-tree-->
```
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #1024 | Wireless Ergonomic Mouse | In Stock |
```
