---
title: File Download
description: FileDownload shows a file from the document source as a download card
language: en
---

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`FileDownload` shows a file from the document source as a download card. `view` selects `compact` or `detailed`. `icon` can name a component id registered in the unified component registry in advance; when omitted, the registered `FileIcon` is used. `size` is the display string written in the detailed view.

`FileDownload` は資料ソース内のファイルをダウンロードカードとして表示します。`view` は `compact` または `detailed` を指定します。`icon` には事前に統一コンポーネントレジストリへ登録したコンポーネント ID を指定でき、省略時は登録済みの `FileIcon` を使用します。`size` は詳細表示に記載する表示文字列です。
```

<!--renderComp=MultiLang-->
## {en: "Compact view", jp: "コンパクト表示"}

````markdown
<!--renderComp=FileDownload-->
```yaml
src: /doc-page/doc-page-introduction.md
name: doc-page-introduction-example-with-a-long-file-name.md
view: compact
```
````

<!--renderComp=FileDownload-->
```yaml
src: /doc-page/doc-page-introduction.md
name: doc-page-introduction-example-with-a-long-file-name.md
view: compact
```

<!--renderComp=MultiLang-->
## {en: "Detailed view", jp: "詳細表示"}

````markdown
<!--renderComp=FileDownload-->
```yaml
src: /doc-page/doc-page-introduction.md
name: doc-page-introduction.md
size: 1.2 KB
view: detailed
```
````

<!--renderComp=FileDownload-->
```yaml
src: /doc-page/doc-page-introduction.md
name: doc-page-introduction.md
size: 1.2 KB
view: detailed
```
