---
title: App Services, Infra Services and the Kernel
description: App services keep their state in infra services, both run by the service runtime kernel, which provisions, routes, watches and logs them; shown with a todo list whose todos live in the sqlite infra service
---

The [service instances](service-instance.md) document shows `note-db`, a service that keeps its notes in a database file of its own folder. That is the simplest service there is, and it is also the kind that is hard to move, back up or share: its state is wherever its folder is. The services of a page are of **two kinds** so that state has one place to be:

- An **app service** (`kind: app`) is what a document works through its dashboards: a todo list, a crawler, a report. It is meant to be **stateless**: its folder holds its script, its dashboards and its config, and nothing it would miss. What it keeps between requests, it keeps in an infra service.
- An **infra service** (`kind: infra`) serves other services, never a document: storage (`sqlite`), logging (`logging`), connections (`aws-connection`, `postgres-connection`, `google-drive`, `cognito-auth`). It has no dashboards of its own; it is worked from the Services tab.

Both kinds come as templates and instances, in one registry, run by the same backend. What tells them apart is who they serve, and what the **service runtime kernel** of the backend does for them: it provisions an infra service when one is needed, routes a name to the instance providing it, watches every instance (its lifecycle, its dependencies, its health), runs the lifecycle hooks, and logs it all into the logging infra service.

## An app service: todo-list

The template `todo-list` (`example_doc/service-template-app/productivity/task/w55iiudjq5y--todo-list/`) is a todo list. Its script declares one dependency, the infra name `sqlite`, and reaches it by that name; it never knows which instance provides it, nor where the database file is:

```python
expose = {
    'dependencyList': [
        {'name': 'sqlite', 'isRequired': True, 'onUnavailable': 'report'},
    ],
    …
}

@property
def db(self):
    return self.context.infra('sqlite')

def on_create(self):
    self.db.executeScript(script=SCHEMA_SCRIPT)

def todoCreate(self, title):
    result = self.db.execute(sql='INSERT INTO todo (title, isDone, timeCreated, timeUpdated) VALUES (?, 0, ?, ?)', params=[title, now, now])
    return self._todo_get(result['lastRowId'])
```

`example todos` is an instance created from it (`example_doc/service-app/todo-list-inst-w55j3ztn3rq/`). Its folder is a copy of the template's and stays one: no database ever appears in it. Its todos are a database the sqlite infra service holds for it, one file per consumer instance, `data/w55j3ztn3rq/current.sqlite` in the infra instance's folder. That folder, `example_doc/service-infra/`, is ignored by git, so a fresh checkout opens the dashboard below on an empty list; the todos and the version this document talks about are those of the machine the example was written on.

<!--renderComp=service/todo-list/default-->
```asset
store: local
objectId: w55j4vdm1uw
```

Add a todo (Enter adds it), check one off, edit a title in place (the pencil), remove one. The filter is the dashboard's own state, written into its asset object, as the search of the notes dashboard is. Everything else is asked from the instance, which asks the infra service. Disable the sqlite instance (in the Services tab, or `POST /instance/enable` with `isEnabled: false`) and every action answers that `sqlite` is unavailable (code -7), where it was asked for; the instance stays `ready` but its health turns `unhealthy`, with the reason. Enable it again and the next action works. The app service noticed nothing: it has nothing to lose.

## Dependencies

What an instance depends on is written in its `service.yaml`, next to the kind:

```yaml
serviceId: w55j3ztn3rq
name: example todos
kind: app
template:
  templateId: w55iiudjq5y
  name: todo-list
  versionId: w55iiudjq61
dependencyList:
- name: sqlite
  isRequired: true
  onUnavailable: report
isDependencyDynamicAllowed: false
```

The template's script declares the initial list (`expose.dependencyList`), copied into the instance when it is created; from then on the list is the instance's own. The Services tab edits it (the instance is restarted with the new list), and an instance may add a name at runtime, when `isDependencyDynamicAllowed` says so. Each dependency says what to do when the name has no instance to answer: `isRequired` keeps the instance from starting without it, `onUnavailable` is what a call gets while it is gone, `report` (the call goes on and answers -7 when it reaches the name) or `reject` (the call is refused at once). The instance as listed carries the status of each dependency (`dependencyStatusList`: `available`, `unavailable` or `notProvided`, and the instance providing it), which is what the storage dashboard further down shows first.

## Waiting and provisioning

An instance whose required infra name has no instance providing it does not start: it is `waiting`, and the kernel starts it when the name is provided. Nobody has to provide it by hand. An infra template may say `provision: auto`, and the kernel then **provisions** an instance from it when the name is required and nobody provides it; the built-in `sqlite` and `logging` templates do. That is how the two instances of `example_doc/service-infra/` came to be: `sqlite (auto)` when the first todo list was created, `logging (auto)` when the kernel first started, since the kernel itself requires `logging` for its records. Each remembers why in its `service.yaml`:

```yaml
provision:
  mode: auto
  infra: sqlite
  requiredBy: example todos (w55j3ztn3rq)
```

The folder is ignored by git: provisioned instances are the kernel's to make, and a fresh checkout gets its own within the first reconcile (a few seconds after the backend starts). An instance created by hand from an infra template provides the name as well; when several provide one name, the kernel **routes** it to the oldest ready one, or to the one chosen in the Services tab (`POST /infra/route`), and the consumers see the change at their next call.

## Health and the lifecycle hooks

Beside its lifecycle status (`ready`, `starting`, `waiting`, `disabled`, `error`), every instance has a **health**: `healthy`, `degraded` or `unhealthy`, with a message. The kernel derives it from the lifecycle, the dependencies (a required name gone makes the instance `degraded` or `unhealthy`) and whatever the script reports itself (`self.context.health_set(status, message)`), so a service that can tell its own trouble (a connection lost, a quota reached) says so where the page shows it.

A script may implement the **lifecycle hooks** `on_create`, `on_start`, `on_stop` and `on_destroy`. The kernel runs each one with a timeout (`expose.lifecycle.hookTimeoutSecond`) and records how it went (`hookRecordList` of the instance: running, done, failed, timed out, and how long it took). `todo-list` creates its table in `on_create`, once in the life of the instance, and makes sure it is there again in `start`, since a checkout may bring back a database older than the table. Both are safe to run twice.

## Storage: versions and a checkout

An infra service that stores things says what it can do with them (`expose.infra.storage`: the type, `versioning: none | linear`, the operations). The sqlite infra service keeps **versions** of a consumer's database: a consistent copy, with a note, and `versionCreate`, `checkout` and `versionDelete` on them. `todo-list` offers them for its own database, through `versionCreate`, `versionCheckout` and `versionDelete` of its own, which is where the storage dashboard asks:

<!--renderComp=service/todo-list/config-->
```asset
store: local
objectId: w55j4vfa50k
```

The first rows are the instance as the kernel sees it: what it depends on, with the status of each name and the infra instance answering it, and its health. Then the database itself: the file in the infra instance's folder, its size and tables, and the versions. **Create version** keeps the todos as they are now, with a note; the example was written with one version, `first todos`. **Check out** makes the todos those of a version: the database as it is now is kept as a version first, so a checkout loses nothing and can be undone by checking that one out. The version list is the infra service's, in its folder, and `versionKeepMax` of the sqlite instance's config says how many it keeps.

## Where templates and instances come from

The registry reads service folders of three origins, and every template and instance says which (`origin: { kind, alias, dir }`):

| origin | templates | instances |
| --- | --- | --- |
| **built-in**: what the package ships | `built-in/service-template-app/` (`note-db`), `built-in/service-template-infra/` (`sqlite`, `logging`, the connections) | none |
| **docPage**: a doc page's own | `service-template-app/`, `service-template-infra/` of the doc page folder | `service-app/`, `service-infra/` of the doc page folder |
| **folder**: named in the backend config | `templateFolderList` | `instanceFolderList` |

The convention folders of a doc page need no declaration: the backend reads them for every doc page its config names (`docPageList` of `example_doc/.doc-page/service-backend.yaml`), and for every doc page the page has loaded, which it tells the backend as it loads them. A doc page that keeps its services elsewhere names its folders in `.doc-page/service.yaml`, with the kind of each; one with none says `service: false` in its entry. An instance is created in the instance folder of its template's kind, of the doc page named in the creation, or else of the default doc page; the kernel provisions into the default doc page as well. The example doc has both of its own: `todo-list` in `example_doc/service-template-app/`, its instance in `example_doc/service-app/`, and the two note-db instances there too, created from the built-in template.

## The log

Everything the kernel does, and everything a script logs (`self.context.log(level, feature, message, data)`), is a record of the **logging** infra service, with the **principal** that produced it (`{ kind: 'kernel' | 'service', id }`) and a **feature** the record belongs to (`schema`, `storage`, `provision`, `hook`, …). The log is queried like any infra service, by its name, from the page or over http:

````bash
curl -s -XPOST localhost:45190/api/call -H 'content-type: application/json' \
  -d '{"target": {"infra": "logging"}, "api": "logQuery", "params": {"principalId": "w55j3ztn3rq", "feature": "storage", "limit": 20}}'
````

```json
{"code": 0, "data": {"recordList": [{"logId": 182, "time": "2026-10-29T05:42:00.306+09:00", "level": "info",
  "principal": {"kind": "service", "id": "w55j3ztn3rq"}, "feature": "storage", "message": "version w55j4cmisph created", "data": {"note": "first todos"}}], "total": 1}}
```

The **Logs** area of the Services tab is the same query with its facets: the principals, the features and the levels that have records, so the records of one instance, or of the kernel's provisioning, are a click away. Until a logging instance is ready, the kernel keeps its records in a buffer of its own (`GET /log/recent`), and flushes them once one is.

## The Services tab

The Services tab lists the templates and the instances **by kind**, app and infra, and has an area for the **infra names**: for each name, who provides it (and which instance the route goes to), who requires it (the instances and the kernel), and the templates that could provision it. An instance's card shows its dependencies, each with its status, and lets them be edited; an infra instance's card shows the consumers of its name. Then the Logs area. The [service instances](service-instance.md) document shows the rest of the tab.

The design (the kernel, the two kinds, the infra names and routing, the dependencies, provisioning, health, the hooks, the storage operations, the logging) is `main/doc_page_impl_service.md`.
