---
title: Command Palette, Apis and Hotkeys
description: The unified api registry of the page, its command palette, its keyboard maps, and how an AI agent calls the page
language: en
---

Everything that works the page programmatically goes through one thing, an **api**: a named operation with declared parameters (optional or required, of a common type: a text, a number, a switch, a mapping, a list, or a path of the source) that answers within the call. The apis are kept in one registry, and three callers use it: the **command palette**, the **keyboard maps**, and callers **outside the page** (an AI agent, a script) through the development server. This document shows the three on this doc page. The design is in `main/doc_page_impl_api.md`, `doc_page_impl_api_command_palette.md` and `doc_page_impl_api_hotkey.md`.

## The command palette

Press **Ctrl+Shift+P** (**⇧⌘P** on macOS), or **F1**, or click the terminal button left of the gear in the side-panel header. A field opens at the top of the window with every api that lists itself; typing narrows it, the arrow keys move, Enter runs, Escape closes. An api that cannot run now (Back with nothing to go back to) stays in the list, greyed out, with its reason as its hover title. The key bound to an api is shown at its right, so the palette is where the keys are learned.

An api with parameters ends with `…` and asks for them in a second step at the same place: one field per parameter, a `*` on the required ones, a choice of buttons for a switch or a fixed list, a path with completion for a document, a text otherwise. Enter runs when the fields check, and says under them what does not; Escape goes back to the list. When every parameter is optional, Enter at once runs with the defaults, so the step costs one key.

Try: type `edit` and run **Edit: Toggle edit mode**; type `settings` and open the settings panel; type `document model`, an api this doc page declares itself (below). Then type `go to`, choose **Navigation: Go to a document…**, type `~example/doc` in the field and take a document from the completion list with the arrow keys and Enter; and **Settings: Open the settings panel…**, whose only parameter, the tab, is optional: Enter opens the panel as it was, or pick a tab first.

## The apis

Open the settings panel and its **API** tab: it lists every api registered now, its parameters, whether it can run and the key bound to it. The apis come from several sources, and the list changes as they come and go:

- the **page's own layers**: navigation (`nav/back`, `nav/goTo`), the document and its blocks (`doc/blockListGet`, `doc/blockGet`, `doc/blockDataSet`), the edit layer (`edit/modeToggle`, `edit/blockEnter`), the page (`settings/open`, `search/open`, `page/contextGet`, `api/listGet`);
- the **components** of the registry that expose apis: `common/TestCaseTable/tableGet` and `common/TestCaseTable/resultRecord` read a [test case table](mdx-usage/comp-test-case-table.md) and record a result on its asset item, the same way a click on a cell does;
- the **service instances**: while the service backend runs an instance of `todo-list`, its apis are registered as `service/todo-list/todoList`, `service/todo-list/todoCreate`, …, and leave the registry when the instance stops;
- the **declared apis** of this doc page, written in `.doc-page/api.yaml` without code: `example/openGuide` opens the document model, `example/editPlayground` opens the editing playground and turns edit mode on, two calls in one.

## The keyboard maps

The keys are keyboard maps, yaml files of one grammar stacked like the config layers: the package's default map at the bottom (`main/hotkey/default.yaml`, named by `main/config.yaml`: the default keys of the built-in apis), the maps of the doc pages over it, the workspace's map over those (`.doc-workspace/hotkey.yaml` at the root of the project, named by `workspace.yaml` beside it). This doc page keeps its maps in `.doc-page/hotkey/`: `main.yaml` is the active map, it includes `base.yaml`, and `minimal.yaml` is a second map the reader may pick instead (API tab, the row of `example`). A key is resolved when it is pressed, from the top:

- **Ctrl+Alt+G** (**⌥⌘G**) runs `example/openGuide`, the declared api;
- **Ctrl+K Ctrl+S**, a chord, opens the settings panel on its API tab;
- **Ctrl+Alt+T** (**⌥⌘T**) is bound in `main.yaml` to `service/todo-list/todoList`, and in `base.yaml` to opening the [todo-list demonstration](service-kernel.md). While the instance runs, the first binding is found; while it does not, that api is not registered, the binding is **hidden** rather than broken, and the key opens the document. Stop the backend and press it again;
- **Alt+S** saves the block being edited, and only then (`when: sessionOpen`); otherwise the key is nothing;
- **Alt+Home** goes through all three levels: the package binds it to the home document, this doc page **unbinds** it (`api: null` in `base.yaml`), and the workspace binds it again above the doc page (`.doc-workspace/hotkey.yaml`), so the key works, and the table says the binding comes from the workspace;
- **Ctrl+Alt+W** (**⌥⌘W**) is the workspace's own key: the Workspace tab of the settings panel.

The API tab shows the maps of the stack and the table that results: every key, the binding that answers it now, and the ones it passes over, each with why.

## Calling the page from outside

While the development server runs, every api is reachable over http, forwarded to this page through the server (the API tab shows the address and the id of this page). An AI agent that checked a feature records its check this way:

```bash
# what is there to call, and where the reader is
curl http://localhost:5173/__doc-api/list
curl http://localhost:5173/__doc-api/context

# open a document, read the blocks of it, read a test case table
curl -X POST http://localhost:5173/__doc-api/call -H 'content-type: application/json' \
  -d '{"api":"nav/goTo","params":{"target":"~example/mdx-usage/comp-test-case-table.md"}}'
curl -X POST http://localhost:5173/__doc-api/call -H 'content-type: application/json' \
  -d '{"api":"doc/blockListGet"}'
curl -X POST http://localhost:5173/__doc-api/call -H 'content-type: application/json' \
  -d '{"api":"common/TestCaseTable/tableGet","params":{"doc":"~example/mdx-usage/comp-test-case-table.md","block":"login-asset"}}'

# record a result of the table kept in the asset service layer (the block
# is named by the id of its marker; without "block", the first table of the document)
curl -X POST http://localhost:5173/__doc-api/call -H 'content-type: application/json' \
  -d '{"api":"common/TestCaseTable/resultRecord","params":{"doc":"~example/mdx-usage/comp-test-case-table.md","block":"login-asset","caseId":"form-empty","testerId":"ai","result":"OK","operator":"an agent","evidence":"test-case-evidence.md"}}'
```

Every answer is `{ code, data, message }`: `0` done, `-1` the api refused or failed, `-2` no such api, `-3` the api cannot run now (the message says why), `-4` wrong parameters, `-5` the api did not answer in time, `-6` no page is connected. A write made this way is a write of the page: the same event, the same route, the same checks on the server, and the same history as a click would leave.
