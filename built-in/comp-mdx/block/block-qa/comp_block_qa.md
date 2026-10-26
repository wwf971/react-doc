# BlockQA

`BlockQA` renders repeated question-and-answer items with distinct question and answer backgrounds. It is available as a comment-block component. The title defaults to `null` and is not rendered unless the marker or YAML data supplies one.

## Data

The fenced block contains a YAML mapping with a non-empty `items` list. Each item requires `question` and `answer`.

A scalar is treated as `type: text`:

````markdown
<!--renderComp=BlockQA-->
```yaml
items:
  - question: Is a database required?
    answer: No.
```
````

Use an object with `type: markdown` and a YAML block scalar when the content needs Markdown syntax such as paragraphs, lists, links, or code:

`````markdown
<!--renderComp=BlockQA-->
````yaml
items:
  - question: How do I run the command?
    answer:
      type: markdown
      content: |
        Follow these steps:

        1. Open PowerShell.
        2. Run the command:

           ```powershell
           npm run build
           ```
````
`````

The component fence uses four backticks in this example because the Markdown content contains a three-backtick code fence. YAML does not contain another Markdown code block: `content: |` stores the indented Markdown as a multiline string, and `MdxRenderer` compiles that string after the YAML is parsed.

Both `question` and `answer` accept these forms:

```yaml
question:
  type: text
  content: Is a database required?
answer:
  type: markdown
  content: |
    **No.** The generated page is static.
```

Supported types are `text` and `markdown`. The default is `text`.

## Expand and collapse

Expansion is controlled by three YAML properties:

- `isCollapsible`: enables the toggle control. The default is `false`. When it is `false`, no chevron is rendered and every answer is expanded; the other expansion properties are ignored.
- `isExpandedDefault`: global initial state used when `isCollapsible` is `true`. The default is `true`.
- `items[].isExpanded`: optional initial state for one pair. It overrides `isExpandedDefault`.

```yaml
isCollapsible: true
isExpandedDefault: false
items:
  - question: This pair starts expanded.
    isExpanded: true
    answer: Its item setting overrides the global default.
  - question: This pair starts collapsed.
    answer: It uses the global default.
```

Each Q&A pair is rendered as one accordion card. In the collapsed state, only its question and toggle are visible.
