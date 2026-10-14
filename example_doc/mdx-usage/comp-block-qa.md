---
title: Q&A
description: BlockQA shows questions and answers, optionally collapsible, with Markdown answers
language: en
---

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`BlockQA` shows a list of questions and answers. An answer is plain text, or Markdown written as `{ type: markdown, content }`, rendered like the document body. `isCollapsible` lets the reader fold every item; `isExpandedDefault` chooses whether they start open.

`BlockQA` は質問と回答の一覧を表示します。回答はプレーンテキスト、または `{ type: markdown, content }` で書いた Markdown で、本文と同じように描画されます。`isCollapsible` で各項目を折りたためるようにし、`isExpandedDefault` で初期状態を開くかどうかを選びます。
```

<!--renderComp=MultiLang-->
## {en: "Syntax", jp: "構文"}

`````markdown
<!--renderComp=BlockQA-->
````yaml
title: Frequently asked
isCollapsible: true
items:
  - question: Is a database required?
    answer: No. The generated page is static.
  - question: How do I build the page?
    answer:
      type: markdown
      content: |
        Run the build in `main/frontend`:

        ```sh
        pnpm build
        ```

        See [the writing style](writing-style.md) for the component syntax.
````
`````

<!--renderComp=BlockQA-->
````yaml
title: Frequently asked
isCollapsible: true
items:
  - question: Is a database required?
    answer: No. The generated page is static.
  - question: How do I build the page?
    answer:
      type: markdown
      content: |
        Run the build in `main/frontend`:

        ```sh
        pnpm build
        ```

        See [the writing style](writing-style.md) for the component syntax.
````
