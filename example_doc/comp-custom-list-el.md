---
title: Components in Lists
description: Put components, including multi-line blocks such as images, diagrams, and code, inside nested list items
language: en
---

A component can be an element of a list item at any depth, including components whose source spans several lines, such as an image, a diagram, or a code block. The writing style is the [recommended comment-block style](mdx-usage/writing-style.md) indented into the list item, so a normal Markdown renderer still shows the block nested inside the item.

## Rules

1. **Indent to the text column.** The marker comment, both fence lines, and every line of the block start at the *text column* of the list item: the column where the item's text begins. That is 2 spaces after `- `, 3 after `1. `, and 4 after `10. `; each nesting level adds its parent's text column.
2. **Place the comment** at the start of the item, at the end of a text line, or on its own line. In every case it marks the block on the next lines.
3. **Continue the text on its own line** after the closing fence, still at the text column. Never write text right after the closing fence: `` ```there is a dog. `` is not a closing fence, and the code block then swallows the rest of the item.
4. **Prefer fenced blocks.** A fenced block ends exactly at its closing fence. A Markdown table or quote has no closing line and ends only at a blank line, so text written directly below it becomes part of it. Wrap a table in a fence, or leave a blank line after a table or quote.
5. **Blank lines are optional.** Without them the list stays compact. A blank line anywhere in an item makes the whole list "loose": each text line becomes a spaced paragraph.

````text
- parent item
  - as shown in this image<!--renderComp=Image-->
    ```yaml
    src: mdx-usage/image/office-worker.svg
    ```
    the staff member works at a desk.
^ ^ ^
| | └ text column of the nested item: comment, fences, block, and text all start here
| └ text column of the parent item
└ the list marker
````

In MDX files, HTML comments are not allowed. Write the component directly as JSX, at the same text column; see [Direct MDX components](mdx-usage/comp-mdx-native.mdx#components-in-lists).

## Examples

### Code block

````markdown
- Install:
  - run the command below in `frontend/`:
    ```bash
    pnpm install
    pnpm build
    ```
    the result is written to `dist/`.
````

- Install:
  - run the command below in `frontend/`:
    ```bash
    pnpm install
    pnpm build
    ```
    the result is written to `dist/`.

### Image, comment at the end of a text line

````markdown
- Office work
  - as shown in this image<!--renderComp=Image-->
    ```yaml
    src: mdx-usage/image/robot-computer.svg
    alt: A robot using a computer
    width: 240
    height: 160
    ```
    the robot prepares the documents.
  - the next item
````

- Office work
  - as shown in this image<!--renderComp=Image-->
    ```yaml
    src: mdx-usage/image/robot-computer.svg
    alt: A robot using a computer
    width: 240
    height: 160
    ```
    the robot prepares the documents.
  - the next item

### Image, comment at the start of an item

````markdown
- Staff
  - <!--renderComp=Image-->
    ```yaml
    src: mdx-usage/image/office-worker.svg
    alt: An office worker
    width: 240
    height: 160
    ```
  - the next item
````

- Staff
  - <!--renderComp=Image-->
    ```yaml
    src: mdx-usage/image/office-worker.svg
    alt: An office worker
    width: 240
    height: 160
    ```
  - the next item

### File tree in an ordered list

The text column of `1. ` is 3 spaces, so the nested item starts at column 3 and its block at column 6.

````markdown
1. Create the project folders.
   1. the layout:<!--renderComp=FileTree-->
      ```yaml
      tree:
        - name: guide/
          type: folder
          defaultOpen: true
          children:
            - name: setup.md
            - name: usage.md
      ```
   2. add one document per topic.
````

1. Create the project folders.
   1. the layout:<!--renderComp=FileTree-->
      ```yaml
      tree:
        - name: guide/
          type: folder
          defaultOpen: true
          children:
            - name: setup.md
            - name: usage.md
      ```
   2. add one document per topic.

### Diagram at the third level

````markdown
- Login
  - Request flow:
    - <!--renderComp=DiagramMermaid,displayMode=contain-->
      ```mermaid
      sequenceDiagram
        User->>Frontend: submit account and password
        Frontend->>Backend: forward the credentials
        Backend-->>Frontend: return a token
      ```
      the token is kept by the frontend.
````

- Login
  - Request flow:
    - <!--renderComp=DiagramMermaid,displayMode=contain-->
      ```mermaid
      sequenceDiagram
        User->>Frontend: submit account and password
        Frontend->>Backend: forward the credentials
        Backend-->>Frontend: return a token
      ```
      the token is kept by the frontend.

### Quote block and table

A quote and a table end only at a blank line, so the text after them is separated by one. The table could also be wrapped in a fence, which needs no blank line.

````markdown
- Before deleting:<!--renderComp=BlockSimple,type=warning-->
  > [!CAUTION]
  > Check the changes before running this operation.

  then run the deletion.
- Stock of warehouse A:<!--renderComp=StockTable,title=Warehouse A-->
  ```
  | Product ID | Description | Stock Status |
  | :--- | :--- | :---: |
  | #1024 | Wireless Ergonomic Mouse | In Stock |
  ```
  restocked every Monday.
````

- Before deleting:<!--renderComp=BlockSimple,type=warning-->
  > [!CAUTION]
  > Check the changes before running this operation.

  then run the deletion.
- Stock of warehouse A:<!--renderComp=StockTable,title=Warehouse A-->
  ```
  | Product ID | Description | Stock Status |
  | :--- | :--- | :---: |
  | #1024 | Wireless Ergonomic Mouse | In Stock |
  ```
  restocked every Monday.

### Tag inside a list item

An inline component, such as a [tag mention](side-panel-tag.md#mentioning-a-tag-in-text), stays inside the text line.

```markdown
- Reading order
  - start with the documents tagged <!--renderComp=Tag-->`guide`
  - then read the <!--renderComp=Tag-->`reference` documents
```

- Reading order
  - start with the documents tagged <!--renderComp=Tag-->`guide`
  - then read the <!--renderComp=Tag-->`reference` documents

## Common mistakes

- The fence is at the parent's text column. The block leaves the nested item and lands in the parent item, where the comment no longer marks it:
  ````text
  - item
    - the flow:<!--renderComp=DiagramMermaid-->
    ```mermaid
    flowchart LR
      A --> B
    ```
  ````
- Text right after the closing fence. That line is not a closing fence, so the code block continues to the end of the item:
  ````text
  - the flow:<!--renderComp=DiagramMermaid-->
    ```mermaid
    flowchart LR
      A --> B
    ```A leads to B.
  ````
- More than 3 spaces beyond the text column after a blank line. The block becomes an indented code block that shows the fences as text:
  ````text
  - the flow:

        ```mermaid
        flowchart LR
          A --> B
        ```
  ````
- Text directly below a quote or table. It joins the quote or table; leave a blank line before it:
  ````text
  - note:<!--renderComp=BlockSimple-->
    > quoted
    more text
  ````
