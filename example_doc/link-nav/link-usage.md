---
title: Links and Navigation
description: Link to a document or to a section by its title or by a declared id
---

A link opens another document of the side panel, optionally scrolls to one place in it, and marks that place with a yellow background. Clicking a link, the side panel, Back, Forward, and Up all go through the same navigation, so browser history and the URL stay consistent.

```text
[label](target.md#place)
   -> find the document          target.md
   -> open it, scroll to place   #place = an id, or the title of a heading
   -> mark the place in yellow
```

## Linking to a document

Each of these forms becomes a navigable link, in `.md` and `.mdx`:

```markdown
[database](database.md)               normal Markdown link
`database.md`                         inline code that looks like a document name
[[database.md]]                       wiki-style link
```

The target can be a file name, a path relative to the current document (`./sub/notes.md`), or an internal path (`/example/database.md`). When a file name matches several documents, the link shows a list to choose from. More forms are collected in [Link Test Cases](links.mdx).

## Linking to a section

Write the place after `#`. It can be named in two ways:

- **By title**: `database.md#Object Types` opens the first heading whose text is `Object Types`. Case and repeated spaces are ignored.
- **By id**: `database.md#object-types` uses the id of the heading. Every heading has an id generated from its title; a heading can also declare its own id (see [[link-usage.md#Declaring an id for a section]]).

A Markdown link cannot contain a plain space, so a title with spaces is written as a wiki link, inside angle brackets, or with `%20`:

```markdown
[[database.md#Object Types]]
[object types](<database.md#Object Types>)
[object types](database.md#Object%20Types)
```

Try them: [[database.md#Object Types]], [object types](<database.md#Object Types>), [by generated id](database.md#object-types).

To link to a place in the same document, also write the document name, for example [the deprecated form](<link-usage.md#Deprecated: span markers>). A link with only `#place` is a plain browser anchor: it is not looked up by title and the place is not marked.

<!--renderComp=Anchor,id=link-usage-declare-id-->
## Declaring an id for a section

A link by title breaks when someone edits the title. When other documents link to a section, declare a stable id for it with an `Anchor` comment directly before the heading:

```markdown
<!--renderComp=Anchor,id=link-usage-declare-id-->
## Declaring an id for a section
```

Links then use the id, which keeps working whatever the title becomes: [declared id of this section](link-usage.md#link-usage-declare-id).

- No blank line is needed between the comment and the heading.
- The heading itself receives the id, so the table of contents uses it as well.
- A normal Markdown viewer ignores the comment and still shows the heading.
- An id must be unique within its document. Prefixing it with the document topic (`link-usage-...`) avoids clashing with generated ids.

<!--renderComp=Anchor,id=link-usage-aliases,aliases=[link-usage-alias-a,link-usage-alias-b]-->
### Several ids for one place

`aliases` adds more ids for the same place. This is useful when one section describes several things that are linked separately, or when an old id must keep working after a section is merged into another:

```markdown
<!--renderComp=Anchor,id=link-usage-aliases,aliases=[link-usage-alias-a,link-usage-alias-b]-->
### Several ids for one place
```

Each id opens this subsection: [primary id](link-usage.md#link-usage-aliases), [first alias](link-usage.md#link-usage-alias-a), [second alias](link-usage.md#link-usage-alias-b).

### Multilingual headings

The title of a multilingual heading changes with the selected language, so link to it by id. Put the `Anchor` comment before the `MultiLang` comment:

```markdown
<!--renderComp=Anchor,id=multilingual-heading-example-->
<!--renderComp=MultiLang-->
### {jp: "多言語の見出し", en: "Multilingual Heading"}
```

Example: [multilingual heading in the MultiLang document](comp-multi-lang.md#multilingual-heading-display-example).

### Places other than headings

Before any other block, such as a paragraph, a code block, or a component, the `Anchor` comment places an invisible marker. Navigating to its id scrolls to the block after it and marks that block.

<!--renderComp=Anchor,id=link-usage-paragraph-->
This paragraph has the id `link-usage-paragraph`: [link to this paragraph](link-usage.md#link-usage-paragraph).

### In MDX

In `.mdx` documents, write the component on its own line before the heading or block:

```mdx
<Anchor id="configuration" />

## Configuration
```

## Deprecated: span markers

Earlier documents placed raw HTML markers before a heading, separated from it by a blank line:

```markdown
<span id="component-toolbar" />
<span id="component-titleline" />

## Toolbar and TitleLine
```

This form is deprecated. It still works, but compiling such a document logs a deprecation warning. Replace it with one `Anchor` comment; the first id becomes `id` and the rest become `aliases`:

```markdown
<!--renderComp=Anchor,id=component-toolbar,aliases=[component-titleline]-->
## Toolbar and TitleLine
```
