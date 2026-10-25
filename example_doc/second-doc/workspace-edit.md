---
title: Editing the Workspace
description: The Workspace tab of the settings panel - the workspace file, its doc pages and temporary doc pages
language: en
---

## The workspace file

The **Workspace** tab of the settings panel (the gear in the side panel) lists the doc pages of `workspace.yaml` in their order, with the alias, the folder or entry file, and the side panel of each. On the development server they can be edited in place: rename an alias, point to another folder, pick another side panel, move a doc page up or down, add or remove one. Every change is one edit of the file, line by line, so the comments of the file stay; the page then shows the new workspace without a reload.

The list is **locked** when the panel opens: unlock it (the lock button of the list) before editing, so that a click by mistake never rewrites the workspace. The lock is a state of the page only, never written anywhere.

## Temporary doc pages

Below the list, a doc page can be **mounted for now**: it joins the workspace as one more root doc page, with its section in the side panel and its node in the graph, but nothing is written. It stays as long as the development server runs; unmount it, or restart the server, and it is gone. A doc page is named by its folder (its entry is found in `.doc-page/`) or by its entry file.

The path is typed with completion from the file system of the computer the server runs on: the folders and files of the folder typed so far are listed as the text changes (a folder that holds a doc page is marked), `~/` is the home folder, and a relative path starts at the folder of `workspace.yaml`. Try `./example_doc/sub-doc`: the sub document is then mounted at the root as well; it is still one doc page, now named by the mount.
