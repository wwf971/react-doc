# Notes (root level)

One of two files named `notes.md`, for the multi-candidate dropdown test.

Links also work from plain md files: [[frontend-store.md]] and [doc.md](doc.md).

## A link inside a folded answer

The answer below links to a section of [Links and Navigation](link-usage.md). Open that document's **Backlinks** and follow the reference written here: the answer unfolds and the link is marked.

<!--renderComp=BlockQA-->
````yaml
title: Backlinks and components
isCollapsible: true
isExpandedDefault: false
items:
  - question: Can a backlink be written inside a component?
    answer:
      type: markdown
      content: |
        Yes. This answer links to [linking to a section](link-usage.md#Linking%20to%20a%20section), and the
        backlinks of that document list it under the `BlockQA` badge.
````
