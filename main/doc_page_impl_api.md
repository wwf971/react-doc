<!-- Design of the unified api registry. Parent document: doc_page_impl.md. The two callers of the page's own ui have documents of their own: the command palette (doc_page_impl_api_command_palette.md) and the keyboard maps (doc_page_impl_api_hotkey.md). -->

# Unified Api Registry: Design

Everything that works the page programmatically goes through one thing, an **api**: a named operation with declared parameters that is answered within the call. The apis of the page are kept in one registry, built the way the [component registry](doc_page_impl.md#component-registry) and the [slash action registry](doc_page_impl_edit_slash.md#the-slash-action-registry) are built, and every caller uses the same entry: the **command palette** of the page, the **keyboard maps** that bind keys to apis, a **caller outside the page** (an AI agent, a script, a test) through the development server, the **host application**, and an api calling another. The three parts are one subsystem, kept apart: the registry knows nothing of keys or of the palette, and the palette and the maps know nothing of what an api does.

```text
callers                                 the registry (DocApiStore)                        the apis
command palette  ──┐                    apiById = package apis                            nav/back        DocStore.navigationBack()
keyboard maps    ──┤                            + the doc pages' declared apis (yaml)     edit/modeToggle DocEditStore.editModeToggle()
remote caller    ──┼── call(id, params) ──►     + the host's apis                    ──►  doc/blockGet    the edit layer's block model
  (dev server)     │     context built          + providers: the components' apis,        common/TestCaseTable/resultRecord
host application ──┤     availability checked              the service instances' apis        ──► assetTestCaseResultRequest (event layer)
another api      ──┘     params checked                                                   service/todo-list/todoList  ──► the backend
                         result normalized   ◄──────────────────────────────────────────  { code, data, message }
                         call recorded
```

## Core concepts

- **An api** is a definition made with `apiDefine()`: a label and a description for the places that list it, the parameters it takes, `run(context, params)`, and optionally `isAvailable(context)`, which says whether it can run now and why not. It is **instant**: it answers within the call (a result, or a promise that resolves soon; a timeout guards it), never as a job to poll. An operation that takes long is not an api; it is a job of a service, started by an api.
- **The registry** is `apiById`, `{ id: definition }`, the ids `{layer}/{name}` (`nav/back`, `doc/blockGet`), or `{compId}/{name}` for the apis of a component (`common/TestCaseTable/resultRecord`). Ids are what the maps and the callers write, so they stay stable while labels change.
- **A layer** of the registry is a source read once when the page starts: the package's apis, the apis the doc pages declare in yaml, the host's. **A provider** is a source read at run time, whose apis come and go: the components of the registry, the instances of the service backend. A key bound to an api that a provider took away is hidden rather than broken ([Hotkeys](doc_page_impl_api_hotkey.md#resolution)).
- **The context** is what every api receives: where the reader is, at every level (the workspace, the doc page, the document, the block), the state of the page, the stores, and the means to call another api or to report through the event layer.
- **The result** is `{ code, data, message }` as everywhere on the page: `0` done, negative a failure the message explains.
- **The principal** is who asked: the palette, a hotkey, a remote caller, the host, an api. It travels in the context and in the record of the call, so a write made by an agent says so in the history and in the logs.

## The registry

The registry mirrors the other two registries of the page part for part, so a reader who knows one knows the others:

| | component registry | slash action registry | api registry |
| --- | --- | --- | --- |
| a definition | `compDefine(Comp, options)` | `slashActionDefine(options)` | `apiDefine(options)` |
| the package's | `registry/registry.js` `compById` | `slash/slash-registry.js` | `api/api-registry.js` `apiById` |
| the doc pages' | `data.compMountList` (`comp.yaml`) | none yet | `configDoc.apiDeclared` (`.doc-page/api.yaml`, [Declared apis](#declared-apis)) |
| the host's | `config.compById` | `config.slashActionById` | `config.apiById` (an id mapped to `null` removes one) |
| at run time | the dashboards of service instances | | the providers: the components' apis, the service instances' apis |
| built at start, rebuilt on change | `compByIdBuild` in `DocPageMdx` | `slashActionByIdPageBuild` | `apiByIdPageBuild` in `DocPageMdx` (`apiByIdBuild`, `lib/doc-api.js`) |
| held by | `DocStore.compById` | `DocSlashStore.slashActionById` | `DocApiStore.apiById` |
| looked up by | a tag name → id (`compIdResolve`) | a typed name → action | an id (`apiGet`) |

A later layer replaces an id of an earlier one, and `null` removes it; a provider never replaces a registered id (a collision is warned about and the first kept). What is not a definition, or has no valid id, is reported (`[doc-api]`) and left out, never the page.

The package's own apis live in `comp-doc/api/`, one file per layer of the page (`api-nav.js`, `api-doc.js`, `api-edit.js`, `api-page.js`), gathered by `api-registry.js`; the registry knows none of them by name.

### The definition

```text
apiDefine({
  name,           optional: the last part of the id when the registry key gives the id;
                  required for the apis a component exposes (their id is {compId}/{name})
  label,          how the palette and the API tab name it
  description,    one line under the label
  category,       the group the palette shows before the label ("Navigation: Back");
                  default: the first part of the id
  icon,           a component drawing its icon (optional)
  paramList: [{ name, type, isRequired, description, valueDefault, valueList, pathSpec }],
                  type: string | number | boolean | object | list | any
                    | sourcePath: a string naming a document or folder of the source, with
                      pathSpec { kind: 'file' | 'dir' | 'any', extList? } as a config key of that
                      type (the palette completes it from the doc page source service layer)
                  isRequired: a call without it is refused; otherwise valueDefault stands in,
                  or the param is absent. valueList: the values allowed (the palette offers them)
  run(context, params) -> result | Promise<result>
                  result: { code, data, message }, or the data alone (code 0), or nothing (code 0);
                  a thrown error is code -1
  isAvailable(context) -> true | false | 'why not'      optional
  palette,        true | false | { keywordList }: whether the command palette lists it;
                  default: listed (an api with parameters is asked for them there); false for
                  an api that is not for a reader, one that answers data
  timeoutMs,      how long a call may take (10 s by default)
})
```

The parameters are declared so that a caller who has never seen the page can call it right: the API tab and `GET /list` show them, the command palette asks for them field by field ([The parameters](doc_page_impl_api_command_palette.md#the-parameters)), and a call with a missing, wrongly typed or unknown parameter is refused with the parameter named (code -4) before `run` is reached. The types are the common ones a caller writes without thought (a text, a number, a switch, a mapping, a list), and one of the page's own, a source path, so that a document or folder is named the way the rest of the page names it and completed the way the settings panel completes a path key.

### Calls and results

Every call goes through `DocApiStore.call(id, params, { principal })`, whoever asks:

```text
call(id, params, { principal })
  -> the api                 none registered as id             -> -2
  -> the context built       (contextBuild: the levels, the page state, the stores, call, eventDispatch)
  -> isAvailable(context)    false, or a reason                -> -3 "{id}: {reason}"
  -> the params checked      required, types, unknown names    -> -4
  -> run(context, params)    raced against the api's timeout   -> -5 after timeoutMs
                             thrown                            -> -1
  -> the result normalized   { code, data, message }
  -> recorded                callRecordList: time, id, principal, code, message, duration (the API tab)
```

| code | meaning |
| --- | --- |
| `0` | done; `data` is what the api answered |
| `-1` | the api refused or failed; the message says why |
| `-2` | no api of that id is registered now |
| `-3` | the api exists and cannot run now (the reason of `isAvailable`) |
| `-4` | the parameters are wrong |
| `-5` | the api did not answer within its timeout |
| `-6` | a remote call: no page is connected, or it did not answer ([Remote callers](#remote-callers)) |

An api answers the page's own ui through one more place: a call made from a hotkey or the palette that fails shows its message for a few seconds in a notice at the top of the window (`DocApiStore.notice`, `DocApiNotice`); a success shows its message when it has one. Nothing else of the page moves for it.

### The context

```text
context = {
  principal     { kind: palette | hotkey | remote | host | api | component, id }
  page          { envKind, isEditAvailable, isEditMode, isBlockSelectMode, isSessionOpen,
                  isSettingsOpen, isPaletteOpen, isBlockPopupOpen, language }
  workspace     { title, aliasMain, docPageList: [{ alias, title, isRoot, dirPage }] }
  docPage       { alias, title, dirPage }            the doc page of the current document
  doc           { path, title, ext, hash }           the current document, undefined without one
  block         { index, kind, compName, id }        the block the author is at: the open session's,
                                                    else the first of the selection; undefined otherwise
  selection     { blockIndexList }
  stores        every store of the page (never serialized)
  call(id, params)                 another api, with the same principal, 8 levels deep at most
  eventDispatch(type, data, source) a report through the event layer, placement 'api' (below)
  apiExists(id), uiHandleGet(name)
}
```

The levels are what the command function of a palette needs ("the current document", "the block the author is at"); the stores are what the apis of the page need to do their work. A remote caller receives the serializable part (`page/contextGet`, `GET /context`).

### Apis and the event layer

An api that changes the document does not call a store where a component would report an event: it dispatches the same event through the router, with `placement: 'api'` and the principal in its source, so the host application sees it first and the same route answers it ([Extending the layer](doc_page_impl_event.md#extending-the-layer)). `edit/blockEnter` dispatches `editBlockEnterRequest` as a click on the block does; `doc/blockDataSet` dispatches `dataReplaceRequest` (and `doc/blockPropSet` `blockPropSetRequest`), so an inline block is rewritten and an asset reference has its head updated by the one function that knows the difference; `common/TestCaseTable/resultRecord` dispatches `assetTestCaseResultRequest`, the event a cell's form sends. An api therefore makes the change the author could have made, with the same checks and in the same history.

## The apis of the page

| id | does | available when |
| --- | --- | --- |
| `nav/back`, `nav/forward`, `nav/up`, `nav/home` | the navigation buttons | there is somewhere to go |
| `nav/goTo { target }` | opens a document by any link target form, with an optional `#fragment` | |
| `doc/currentGet`, `doc/listGet { docPage? }` | the current document; every md / mdx document of the source with its title and whether the side panel reaches it | |
| `doc/blockListGet { doc? }` | the root-level blocks of a document as the edit layer models them ([The block model](doc_page_impl_edit.md)) | the edit api answers (development server) |
| `doc/blockGet { block?, doc? }` | one block with its text and, for a component block, its data (an asset reference read) | the same |
| `doc/blockDataSet { raw, block?, doc? }` | the complete new data of a component block, inline or in its asset item (`dataReplaceRequest`) | editing is available |
| `doc/blockPropSet { props, block?, doc? }` | the props of a component block's marker changed, inline or asset-backed (`blockPropSetRequest`, [Changing its own block](doc_page_impl_mdx_comp.md#changing-its-own-block)) | editing is available |
| `doc/blockTextSet { text, block?, doc? }` | the lines of one block rewritten, as a session typed and saved | edit mode is on |
| `doc/blockInsert { text, borderIndex?, doc? }`, `doc/blockDelete { block?, doc? }` | blocks inserted at a border, a block removed ([Block-level operations](doc_page_impl_block_ops.md)) | editing is available |
| `edit/modeToggle`, `edit/modeSet { isOn }`, `edit/blockSelectModeToggle` | the modes of the page | editing is available |
| `edit/sessionLeave`, `edit/sessionCancel` | the open session saved or dropped | a block is being edited |
| `edit/blockEnter { block?, editModeId?, doc? }` | a block opened in an edit mode (`editBlockEnterRequest`) | edit mode is on |
| `page/contextGet` | the context above, serializable | |
| `settings/open { tab? }`, `settings/close`, `settings/toggle`; `search/open`; `palette/open`, `palette/close`, `palette/toggle` | the dialogs of the page | |
| `find/open`, `find/close` | the search of the part of the page under the pointer or holding the focus, such as a diagram ([Finding in a part of the page](#finding-in-a-part-of-the-page)) | such a part is active; its search is open |
| `language/set { language }` | one of the authored languages of the document | |
| `type/list { typeList? }`, `type/get { typeId }`; `object/search`, `object/query`, `object/resolve`, `object/read`, `object/open`; `object/create`, `object/update`, `object/delete`; `relation/query`, `relation/create`, `relation/update`, `relation/delete` | the standard apis of the object service layer, one vocabulary for every kind of object (a document, an asset, a frontend object and its assets, a todo of a service), each answered by the provider that owns what it is about ([The apis](doc_page_impl_obj.md#the-apis)) | the provider offers the write |
| `playground/listGet`, `playground/reset { id? }`, `playground/delete { id? }` | the playground documents, created or reset from their templates, and deleted ([Playground documents](doc_page_impl_test.md#the-apis)) | the development server serves the page |
| `api/listGet`, `hotkey/listGet` | the registry itself: every api with its parameters and availability; every key with the binding that answers it and those it passes over | |

**Locating a block.** The `block` parameter of a document api is the index of the block among the root-level blocks of the document, or the `id` of its marker (`<!--renderComp=TestCaseTable,id=login-asset-->`, the identity [`dataRef`](doc_page_impl_mdx_comp.md#component-data-reference) uses); without it, the block the author is at. `doc` is any link target form; without it, the current document. The block model comes from the edit layer and is read through the edit api, so these apis exist on the development server; a built page keeps the apis that need no server.

### Finding in a part of the page

Some parts of the page draw what the browser's find cannot search the way a reader means: a diagram canvas holds rows behind a break and scenes inside cards, and moves its camera rather than scrolling. Such a part registers a **find scope** (`DocFindStore`, through `useFindScope(hostRef, { label, open, close, isOpenGet })` of `comp-doc/find/`) for as long as it is mounted, and is the **active** one while the pointer is over its element or the focus is in it. `find/open` and `find/close` act on the active scope; the context names `findScopeActive` and `findOpen` let a map bind them only then. The default map binds `mod+f` to `find/open` while a scope is active and `escape` to `find/close` while its search is open, so the browser's own find keeps `mod+f` everywhere else, and a map rebinds either like any key. The page knows nothing of what a scope searches: the diagrams of `cloud-dev-vis` are the first ([Search](../package/cloud-dev-vis/doc/card-diagram-impl.md#search)).

## The apis of a component

A component offers apis the way it offers everything else about itself, through its exposure ([What a component exposes](doc_page_impl_mdx_comp.md#what-a-component-exposes)): `expose.apiList`, the sixth standard name, a list of `apiDefine()` definitions (or their options), each with a `name`. While the component is in the registry, its apis are registered under `{compId}/{name}` by the component provider of `DocApiStore`, and `run` receives `context.comp = { compId, definition }`. A doc page's components ([Components of a doc page](doc_page_impl_mdx_comp.md#components-of-a-doc-page)) and a package's bring their apis along the same way, since they join the same registry.

A component's api is about the blocks of that component in a document, so it locates its block like the document apis do, and reads and writes through the same paths. `TestCaseTable` is the demonstration (`built-in/comp-mdx/test-case-table/TestCaseTableApiList.js`):

- `common/TestCaseTable/tableGet { block?, doc? }`: the cases, the testers and the current result of every cell of a table; without `block`, the first table of the document.
- `common/TestCaseTable/resultRecord { caseId, testerId, result, operator, evidence?, block?, doc? }`: one result appended to the history of a cell of a table whose data is an asset item, by the same event a click on the cell sends, so the server writes the time and the id, resolves the evidence, and refuses a record over somebody else's ([the managed history](../built-in/comp-mdx/test-case-table/comp_test_case_table.md)).

This is what an AI agent that checked a feature does to record its check: read the table, record the result with its own name as the operator and the document of its evidence.

The diagram components of the package `cloud-dev-vis` expose in the same way what the edit card of a connection line does ([Connection Lines](../package/cloud-dev-vis/doc/card-diagram-connection-line.md#the-apis)). A write goes into the draft when an edit session is open on the block, so it is undoable there, and into the data of the block otherwise.

## The apis of a service instance

The service instances of the backend are the second provider (`comp-doc/api/api-service.js`): while the backend is up, every **sync** api of every ready instance that pages may call is registered as `service/{templateName}/{apiName}`, with the parameters the script declared ([What a service script exposes](doc_page_impl_service_backend.md#what-a-service-script-exposes)) and one more, `serviceId`, to pick an instance when several of the template run. The call goes through `DocServiceStore.apiCall` with the target `{ serviceId }`, as a dashboard's call does. An async api of a service runs as a job and is not an api of the page. The apis leave the registry when the instance stops or the backend goes down, which is what makes a key bound to one safe ([Resolution](doc_page_impl_api_hotkey.md#resolution)).

## Declared apis

A doc page declares apis without code, in `.doc-page/api.yaml` beside its entry ([The doc page folder](doc_page_impl_dir.md)), read when it exists; the entry may name another file (`api: { file }`) or none (`api: false`). A declared api is an alias of an api of the page with fixed parameters, or a sequence of such calls, run in order and stopped by the first failure:

```yaml
apiList:
  - id: example/openGuide          # {layer}/{name}; the doc page's alias is a good layer
    label: Open the document model
    description: The first document of the demonstration.
    category: Example
    run:
      api: nav/goTo
      params: { target: ~example/doc.md }
  - id: example/editPlayground
    label: Edit the in-place editing playground
    run:                             # several calls, in order
      - { api: nav/goTo, params: { target: ~example/mdx-doc-edit-in-place.md } }
      - { api: edit/modeSet, params: { isOn: true } }
    palette: true                    # optional: false keeps it out of the palette
```

The plugin reads the files (`plugin/doc-api-config.ts`, every problem reported as `[doc-api]` with the file and the item skipped) and hands the items to the page as `configDoc.apiDeclared`; the page defines them (`apiDeclaredDefine`, `lib/doc-api.js`) as the second layer of the registry. A declared api is available while every api it calls is registered. This is the place for what a doc page wants in its palette and under its keys: "open the guide", "open the playground in edit mode".

## Remote callers

The apis run in the browser, where the stores are. A caller outside the page reaches them through the development server, which forwards a request to a connected page over the HMR socket and answers with what the page answered (`plugin/doc-api-server.ts`, the endpoint `{base}/__doc-api`, exported by the virtual module as `docApiEndpoint` and passed to `DocPageMdx` as `config.api` with `subscribeDocApi` and `docApiSend`):

```text
agent / script ── http ──► development server ── HMR socket ──► the page (DocApiStore)
                           {base}/__doc-api          doc-api-request { requestId, kind, api, params }
                                                     doc-api-response { requestId, result }
                           pageById: the pages that said hello (doc-api-hello: pageId, docPath, url)
```

| route | answers |
| --- | --- |
| `GET {endpoint}/status` | the connected pages (`pageList`: id, title, the document shown, url, time) and the default one |
| `GET {endpoint}/list?pageId=` | every api with its parameters, whether it can run now and why not, and the key bound to it |
| `GET {endpoint}/context?pageId=` | where the reader is: the context, serializable |
| `POST {endpoint}/call` `{ api, params?, pageId?, principalId? }` | the result of the api, as the page answered it |

Every answer is `{ code, data, message }` with the api's codes; `-6` (http 503) is the bridge's own: no page is connected, the page named is not, or it did not answer in time. A page says hello when it loads, when its document changes and when the socket comes back, and bye when it unloads; without `pageId` a request goes to the page that said hello last, so one open tab needs no id, and several tabs are told apart by `/status`. The environment offers this as the capability `apiRemote` ([The environment](doc_page_impl.md#the-environment)); a built page has no server, so its apis are reached from the page only.

How an agent works the page:

```text
GET  /context                       where the reader is, what the page allows
GET  /list                          what can be called now, with parameters
POST /call nav/goTo                 open the document to work on
POST /call doc/blockListGet         find the block (its index, or the id of its marker)
POST /call doc/blockGet             read its data (an asset reference is read for it)
POST /call doc/blockDataSet         write the data back: the inline block, or the head of its item
POST /call common/TestCaseTable/resultRecord   record what was checked, as the operator, with the evidence
```

A write made this way is a write of the page: the same event, the same route, the same checks on the server, the same history as a click. The principal of the call (`remote`, with the `principalId` given) is in the record of the call and in the source of the event.

## The API tab

The settings panel has a tab **API** (`comp-doc/settings/ApiSettings.jsx`, [Settings panel](doc_page_impl_config.md#settings-panel)) that shows the registry as it is now: the remote address and the id of this page with an example call; every api with its parameters, whether it can run and the key bound to it; the keyboard maps of the stack, lowest first (the package's, each doc page's with the map it activates, which the reader changes there, the workspace's), the resolved table of every key with the bindings it passes over, and the problems of the map files; the last calls with their principal, code and duration. It is where a reader finds out what the page offers and where a key went.

## Cooperation with the other layers

- **The environment**: the remote api is a capability (`apiRemote`), on when the development server serves the page; an api that needs editing asks `env.isCapable('edit')` through its `isAvailable` and says the reason the environment gives.
- **The event layer**: an api reports a change as a component would (`context.eventDispatch`), with `placement: 'api'`; a palette or a test building events is the tooling the layer anticipated.
- **The edit layer**: the document apis read the block model and write through the writes of the layer (a session left, an insert, a delete, a data replacement), so every change is recorded in its history.
- **The component registry**: `expose.apiList` is a standard exposure; the component provider follows `DocStore.compById`, so the apis of a doc page's components and of a package's are registered when the components are mounted.
- **The service layer**: the service provider follows `DocServiceStore.instanceList`; the call is a dashboard's call with the page as the caller.
- **The config system**: the API tab is one more tab of the settings panel; the keyboard maps are stacked by the rule of the config layers and kept beside the config of each level (`config.yaml`, the metadata folder of a doc page, the workspace file), watched like the other yaml files (a change reloads the page); a source path parameter is the `sourcePath` of the config keys.

## Files

```text
frontend/src/lib/doc-api.js                apiDefine, apiByIdBuild, params check, params from the texts of the palette,
                                           result normalize, availability, apiInfoBuild (what a remote caller sees),
                                           apiDeclaredDefine (yaml aliases)
frontend/src/store/DocApiStore.ts          the registry (layers + providers), the context, call, the call records,
                                           the notice, the remote bridge of the page, uiHandle (search)
comp-doc/api/api-registry.js               the package's apis by id, from api-nav.js, api-doc.js, api-edit.js, api-page.js,
                                           api-object.js, api-playground.js
comp-doc/api/api-service.js                the provider of the service instances' apis
comp-doc/api/DocApiNotice.jsx, DocApi.css  the notice of a failed or answered call
comp-doc/settings/ApiSettings.jsx          the API tab of the settings panel
frontend/plugin/doc-api-config.ts          .doc-page/api.yaml of every doc page -> configDoc.apiDeclared
frontend/plugin/doc-api-server.ts          the remote api: the http routes and the socket bridge to the pages
frontend/plugin/doc-source.ts              docApiEndpoint, subscribeDocApi, docApiSend of the virtual module; the bridge mounted
built-in/comp-mdx/test-case-table/TestCaseTableApiList.js   the apis TestCaseTable exposes
frontend/src/lib/doc-api.test.js, plugin/doc-hotkey.test.js  the definition, the registry, the params; the yaml readers
example_doc/.doc-page/api.yaml, example_doc/api-command-palette.md   the demonstration
```

What the design leaves for later (a client keyboard map edited in the browser, an api that is a job, a page reached without the development server) is in [TODO](doc_page_impl_TODO.md#api-registry).
