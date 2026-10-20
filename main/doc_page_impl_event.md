<!-- Design of the event layer. Parent document: doc_page_impl.md. Other documents link here for how component reports reach the stores. -->

# Event Layer: Design

A component on the page never calls a store. It reports what the author or reader asked for (`onEvent(eventType, eventData)`, the third of the common props `{ data, config, onEvent }`), and the page decides who answers. This document specifies the layer between the two: how a report becomes an event, how an event is routed to the domain that owns it (navigation, tags, editing), how the answer comes back, and how the layer grows when a new domain or a new concern (undo / redo) arrives. For the overall architecture, refer to [Document Page: Design](doc_page_impl.md). The design follows the document store of Yamd (`doc-mobx`): one event shape, one result shape, routing centralized in one place that knows the current state, and handlers that are plain store methods.

```text
component            RegisteredComp                        DocEventRouter                 stores
onEvent(type, data,  ─► eventBuild({type,data,source,point}) ─► dispatch(event)
        { point })
                                                    1. host      DocPageMdx onEvent('component:' + type)
                                                    2. local     onEventRuntime of the rendering place
                                                    3. route     the domain declared for the type ──► DocStore.navigate
                                                                                                       DocTagStore.overviewOpen
                                                                                                       DocEditStore.eventHandle
                                                                                                       DocSourceFileStore.eventHandle
                                                                                                       DocServiceStore.eventHandle
                                                    4. unrouted  { code: -2 }
                     ◄─────────────────────────────── { code, data, message } ◄───────────────────────
```

## Why a layer

Before it existed, a report was answered in whichever place happened to render the component: `RegisteredComp` knew that `navigateRequest` means `docStore.navigate` and `tagOverviewOpenRequest` means `tagStore.overviewOpen`, the block editor wrapped every editor with a handler that knew the edit store, and each place invented its own result (`{ isHandled }`, `{ isAccepted }`, `{ isCanceled }`). Adding a concern, say a focus shift between blocks, meant finding every such place and patching it. The layer puts the knowledge of "who answers what" in one object, so a domain is added by declaring a route, a component stays ignorant of the stores, and a cross-cutting concern (history, logging, a test harness that injects events) has one place to attach to.

## Event and result

```text
DocEvent         { type, data, source, point, time }
  type           the component's event name, e.g. navigateRequest, editDraftChange
  data           what the component reported (its own shape per event)
  source         where it came from: { compId, instanceId, placement, sourcePath,
                 itemId, blockIndex, asset }, filled by RegisteredComp from its runtime
                 config (asset: the object and version the data comes from, for a
                 component rendered from the asset store; else undefined)
  point          where the pointer was when the user asked: { clientX, clientY },
                 or undefined for a keyboard or programmatic report
  time           Date.now() at dispatch

DocEventResult   { code, data, message }
  code 0         accepted: the event was taken and done
  code -1        rejected: a handler took it and refused or failed (message says why)
  code -2        unrouted: nobody answered
```

`point` is the one piece of the user's gesture an event carries besides its data: a handler that places a caret, opens a menu, or scrolls puts the result where the user pointed instead of at a default spot. A component reports it as the third argument of `onEvent` (`onEvent(type, data, { point })`; the pointer event itself can be passed as `point`), the page's own ui gives it to `eventBuild` directly, and `eventBuild` keeps it only when both coordinates are finite numbers. The point is a point of the **viewport**, the coordinates a pointer event reports as `clientX` / `clientY` and `getBoundingClientRect()` measures in; never page coordinates (which add the scroll offset) or coordinates of some element (which an element other than that one cannot use). Every handler can therefore compare the point with any element on the screen, and with the caret, without converting ([where the caret goes](doc_page_impl_edit.md#where-the-caret-goes)). Host and local handlers receive it in their flat data as `point`.

Every result the layer returns has this shape ([formatted responses](doc_page_req.md): `code` 0 is success, negative is failure). A handler returns a result to answer, or `undefined` to pass the event on to the next stage. `resultNormalize` turns the result of a host handler into this shape, which is where the legacy `{ isHandled: true }` of host applications written before the layer is accepted as code 0; nothing else in the page produces or reads `isHandled`. A component that falls back to a browser default (copying to the clipboard, opening a popup of its own) checks `result.code === 0` to know the host took the action over (`eventResultIsAccepted`).

## Dispatch

`DocEventRouter` (`lib/doc-event.js`) is created with the stores in `DocPageMdx` and handed down in the store context as `eventRouter`. `dispatch(event, { onEventHost, onEventLocal })` tries, in order:

1. **host**: the application's `DocPageMdx.onEvent`, called as `onEvent('component:' + type, { ...data, ...source, point })`, so an application overrides anything (its own navigation policy, its own copy handler) without knowing the routes.
2. **local**: the handler of the place that rendered the component (`onEventRuntime` of `RegisteredComp`): a hosted index that turns `activateRequest` into navigation of its own target, the tag overview popup, a side-panel item. Local knowledge stays local; it is a stage, not a bypass.
3. **route**: the domain route declared for the type (`routeAdd({ name, typeList, handle })`, the last declaration of a type wins). The route handles the event with the stores.
4. **unrouted**: `{ code: -2 }` with the type in the message. A component that reports an event the page does not know about gets a definite answer, never silence.

The routes of the page are declared in one place, `DocPageMdx`, next to the stores:

| route        | event types                                            | answered by                                                        |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------ |
| `navigation` | `navigateRequest { target }`                           | `DocStore.navigate`; code -1 with `navigationError` when the target does not resolve ([navigation](doc_page_impl_nav.md)) |
| `tag`        | `tagOverviewOpenRequest { tagId }`                     | `DocTagStore.overviewOpen`, only when the host provides `panelComponent` ([tags](doc_page_impl_tag.md)) |
| `edit`       | `editEventTypeList` of `DocEditStore`: the session events `editDraftChange`, `editTextSetRequest`, `editSubmitRequest`, `editCancelRequest`, `editFocusShiftRequest` (with the caret as `point`); the block events `editBlockEnterRequest` (with the click as `point`; `{ editModeId }` from the mode menu), `editBlockMoveRequest { direction }`, `editBlockAssetMoveRequest`; the side-panel label events `sidePanelTextEditStartRequest`, `sidePanelTextSubmitRequest { text }`, `sidePanelTextCancelRequest`; the data event `dataReplaceRequest { raw }` of a component rendered in a block of the edit body | `DocEditStore.eventHandle` ([editor contract](doc_page_impl_edit.md#the-editor-contract), [entering and moving a block](doc_page_impl_edit.md#floating-controls), [moving data into the asset store](doc_page_impl_asset.md#moving-inline-data-into-the-store), [editing a label](doc_page_impl_side_panel.md#editing-a-label-in-place), [a component replacing its data](doc_page_impl_mdx_comp.md#component-awareness)) |
| `asset`      | `assetEventTypeList` of `DocAssetStore`: `assetRefreshRequest` of a component whose data is an asset (`source.asset`) | `DocAssetStore.eventHandle`: the object is read again from the store; the result's data is `{ versionIdHead, versionId, hash, isChanged }` ([changes made by others](doc_page_impl_mdx_comp.md#changes-made-by-others)) |
| `service`    | `serviceEventTypeList` of `DocServiceStore`: the events of a service dashboard, `serviceApiCallRequest { api, params }`, `serviceJobGetRequest { jobId }`, `dashboardStateSetRequest { state }`, `serviceBindRequest { serviceId }` (reported by the dashboard's frame), `serviceRefreshRequest`; the frame adds `dashboard { typeId, dashboardId, serviceId, state }` to every one | `DocServiceStore.eventHandle`: a call goes to the dashboard's own instance through the service backend, the result being the api's; the state and the bound instance are written into the block's asset object (`source.asset`) in place ([dashboard events](doc_page_impl_service_instance.md#dashboard-events)) |
| `source`     | `sourceEventTypeList` of `DocSourceFileStore`: `fileCreateRequest { name, blob | text, dirPath, isLocationCustom }` (with the pointer as `point`, where the location prompt opens) | `DocSourceFileStore.eventHandle`: the file is created in the source through the source api, after a location prompt when asked for or needed; the result's data is `{ path }`, the source path of the new file ([creating files](doc_page_impl_source.md#creating-files)) |
| `sidePanel`  | `sidePanelEventTypeList` of `DocSidePanelStore`: `sidePanelItemMovePickerOpenRequest` (the move button of an item or **Move…** of its context menu, with the pointer as `point`), `sidePanelItemMoveRequest { position, targetItemId }` (a drop, or an action of the move picker); the item is `source.itemId` | `DocSidePanelStore.eventHandle`: the picker opens, or the item is moved in its yaml files through the edit api; the result's data is `{ fileChangeList }` ([moving an item](doc_page_impl_side_panel.md#moving-an-item)) |

A route handles the type for every component that reports it: a `navigateRequest` from an index item, a tag overview entry, or a link component takes the same path. The page's own ui (`DocLink`, the navigation buttons, the document toolbar) is not a component in this sense and calls the stores directly; the router is the boundary of registered components. Two pieces of the page's own ui join the layer on purpose: the block wrapper and the block toolbar of the edit layer (its mode menu included) dispatch entering a block, moving it, and moving its data into the asset store as `editBlockEnterRequest`, `editBlockMoveRequest`, and `editBlockAssetMoveRequest` (with `eventBuild`, source `{ sourcePath, blockIndex, placement: 'editBlock' | 'editToolbar' }`, the click's position as `point`), because these are operations of the document like the ones components request, and the host application and a future history should see them the same way. The drag of a side-panel item and the move picker do the same for a move (`sidePanelItemMoveRequest`, source `{ itemId, placement: 'sidePanelDisplay' | 'sidePanelMovePicker' }`, the drop's position as `point`).

## The edit domain and the focus shift

The edit store is the one handler of its domain, so the route is a single line (`handle: (event) => editStore.eventHandle(event)`), and the store decides with its own state whether an event applies: session events are accepted only from the editor of the open session (`event.source.sourcePath` is the session's document), the rest get code -1 with a reason. The events of the domain name their subject in `source`, filled by `RegisteredComp` from the runtime config of the component: a session event is matched against the session, a block event carries `sourcePath` and `blockIndex`, a side-panel label event carries `itemId` (the host of a side-panel item renders it with `itemId` in its runtime config, so every report of an item label knows its item).

`dataReplaceRequest` is the event of a component that changes its own data without an editor session: a pasted image gives `Image` a new `src`, and the component reports the whole new data text. The edit store knows what the block is (`source.sourcePath`, `source.blockIndex`): a reference to the asset store gets its head updated, an inline block gets its fenced content rewritten, and the component never learns which ([component awareness](doc_page_impl_mdx_comp.md#component-awareness)). Its companion `fileCreateRequest` goes to the source domain and is answered with a path, which the component then puts into the data it reports; two events, because creating a file and changing a block are two operations of two layers, and a component may need one without the other (an editor of a draft creates the file and keeps the path in its draft).

A focus shift is the event that shows why routing belongs to the store and not to the component. The editing surface knows only that the caret left it at its first or last line, and where the caret was; it reports `editFocusShiftRequest { direction }` with the caret's position as the event's point. The store knows the session, the block index, and the number of blocks, so it leaves the session (saving it) and starts the neighbor with the caret on the near line at the same x, or rejects the request at the ends of the document ([focus shift](doc_page_impl_edit.md#sessions-leave-and-cancel)). This is the default routing of Yamd's `unfocus` with a direction: the component says "out, this way, from here", the document store picks the destination from its state.

## Extending the layer

- **A new domain** declares a route in `DocPageMdx` and a handler on its store; components start reporting the type. No existing place changes.
- **A new event of an existing domain** is one more entry in the domain's type list and one more branch in its handler.
- **History (undo / redo)** attaches at two points that already exist: every write of the edit layer (a document operation in `operationApply`, a side-panel move in `DocSidePanelStore`) is recorded with the texts before and after by `DocEditStore.historyRecord` ([History records](doc_page_impl_edit.md#history-records)), and the router's `dispatch` is the one place every component report passes, where `historyUndoRequest` / `historyRedoRequest` become one more route answered from those records. Neither needs a change in a component.
- **Tooling**: a test or a palette can build an event with `eventBuild` and `dispatch` it with a `source` of its own; the handlers do not distinguish it from a component report.
- **Subscriptions** (TODO): the layer carries reports *from* components and answers them; it does not deliver events *to* them. A component that wants to be told when something changes (the object its data comes from, written by another block or outside the page, [changes made by others](doc_page_impl_mdx_comp.md#changes-made-by-others)) asks today, with a request it reports (`assetRefreshRequest`). A subscription needs a second direction: a component registers for a kind of page event and a subject (`{ type, subject }`, e.g. the asset object of its `source.asset`), a domain publishes the events it observes (the asset store on `doc-asset-change`), and the router delivers them to the subscribers until the component unmounts. Nothing of the existing routes changes for it.

## Files

```text
frontend/src/lib/doc-event.js          DocEventRouter (routeAdd, eventBuild, dispatch),
                                       resultNormalize, eventResultIsAccepted, pointNormalize, result codes
frontend/src/DocPageMdx.jsx            router creation and the route declarations
comp-doc/registry/RegisteredComp.jsx   eventHandle: the component report (data, { point }) becomes an event
comp-doc/edit/DocEditBlock.jsx         a click on a block dispatches editBlockEnterRequest with its point
comp-doc/edit/DocEditBlockToolbar.jsx  the edit, move, and to-asset buttons dispatch their block events
frontend/src/store/DocEditStore.ts     editEventTypeList, eventHandle (the edit domain)
frontend/src/store/DocSourceFileStore.ts sourceEventTypeList, eventHandle (the source domain: file creation)
frontend/src/store/DocAssetStore.ts    assetEventTypeList, eventHandle (the asset domain: assetRefreshRequest)
frontend/src/store/DocServiceStore.ts  serviceEventTypeList, eventHandle (the service domain: dashboards)
frontend/src/store/DocSidePanelStore.ts sidePanelEventTypeList, eventHandle (the side-panel domain: moving items)
comp-doc/side-panel/SidePanelItemHost.jsx, SidePanelMovePicker.jsx  a drop and a picker action dispatch
                                       sidePanelItemMoveRequest
comp-doc/service/ServiceDashboardHost.jsx  adds what the dashboard block shows to every report of a dashboard
comp-doc/edit/DocEditDocContext.js     DocEditBlockContext: the block index a component in the edit body reports with
```
