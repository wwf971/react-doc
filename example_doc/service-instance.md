---
title: Service Instances
description: Stateful services created from templates, run by a backend of their own, shown and worked through dashboards placed in documents
---

An asset is data: a versioned object a component reads. A **service instance** is a running thing with its own state: a database, a crawler, anything that answers requests and keeps something between them. Its state is not the document's; the document only places **dashboards** that show and work an instance.

A **service template** is the initial state of a service: a folder with the script (a Python class), the dashboards (a federated module), and the initial config, but no data. A template is never run. An instance is always **created from a template**: the template's folder is copied into a folder of the instance's own, and from then on the instance runs its own copy. Two instances of the same template and the same template version do not share a script, even while their scripts are the same; changing a template changes no instance, and changing an instance's script changes no other instance.

The instances are run by the **service backend**, a program of its own (`main/service-backend/server.py`); the page reaches it through the development server. Both work alone: the backend answers any http client without the page, and the page without the backend shows in every dashboard that the backend is down. A built page has no backend.

## Running the example

The example template is `note-db`: notes kept in a sqlite database. Its dashboards are a small Vite project (`dashboard/` in the template folder), and every instance has its own copy of the project; each copy is built once, and the builds are ignored by git:

````bash
pip install -r main/service-backend/requirements.txt
for dir in example_doc/service-template/*--note-db/dashboard example_doc/service/note-db-inst-*/dashboard; do
  (cd "$dir" && npm install && npm run build)
done
python3 main/service-backend/server.py --config example_doc/.doc-page/service-backend.yaml
````

The backend listens on port 45190 (`example_doc/.doc-page/service-backend.yaml`); `config.yaml` names it under `service.backend`. It reads two kinds of folders:

| | template | instance |
| --- | --- | --- |
| where | `example_doc/service-template/` | `example_doc/service/` |
| folder | `{templateId}--{name}`: `w4wp4t0czko--note-db` | `{templateName}-inst-{serviceId}`: `note-db-inst-w4veemd7i36` |
| its file | `service-template.yaml`: id, name, version id, versions, initial config | `service.yaml`: id, name, the template it was created from, config |
| script, dashboards | `service.py`, `dashboard/` | its own copies of them |
| data | none | `notes.sqlite`, created when it first runs (ignored by git) |
| run | never | by the backend, one request at a time |

`example notes` and `reading list` are two instances created from `note-db`. Each `service.yaml` records where it came from:

```yaml
template:
  templateId: w4wp4t0czko
  name: note-db
  versionId: w4wp4t0yp9u
```

## A dashboard bound to an instance

The dashboard below is the default dashboard of the instances of `note-db`, bound to `example notes`. Add a note, edit it in place (the pencil beside its title), search. The head of the frame is the same for every dashboard: the template and the dashboard, the instance it shows (a choice: every instance created from `note-db`), and the state of the instance with a button that asks the backend again.

<!--renderComp=service/note-db/default-->
```asset
store: local
objectId: w4veeme6sff
```

The block is a reference into the asset service layer, like any asset-only component: the object holds which instance the dashboard shows and the dashboard's own state, here the search it shows. A search is written into the object in place, so the document opens on the same search; choosing another instance rewrites the object the same way. A dashboard keeps its state there and nowhere else, whatever it is; the instance keeps its own state in its own folder.

The component id `service/note-db/default` names the template by the name the instances recorded, not the template folder: the dashboard is the instance's own (from its own copy of `dashboard/`), and keeps working if the template is renamed or removed.

## Another dashboard, another instance

A template may expose more dashboards than the two every script has (default, config). This one shows the numbers of `reading list`:

<!--renderComp=service/note-db/stat-->
```asset
store: local
objectId: w4veemesqgt
```

## When a dashboard cannot show

A dashboard says what keeps it from showing, and its head stays usable, so the reader can fix it from there. This one is bound to an instance no folder holds; choose one of the instances in its head:

<!--renderComp=service/note-db/default-->
```asset
store: local
objectId: w4veemfcx8m
```

This one is a dashboard of a template the backend does not have (`sheet-db`): no template has that name and no instance was created from one, so there is nothing to choose:

<!--renderComp=service/sheet-db/default-->
```asset
store: local
objectId: w4vfc1twaj6
```

Stop the backend (Ctrl+C) and every dashboard says the backend is down; one that was showing stays on screen, and its calls fail until the backend is back. The page asks again every few seconds, so starting the backend brings the dashboards back without a reload.

## The queue of an instance

An instance answers one request at a time; a request waits until the ones before it are done. The config dashboard of `note-db` has **Reindex**, an async api slowed down to three seconds: while it runs, a search in the notes dashboard above waits for it, then answers. The other instance is not affected: it has its own queue.

## Instances own their copies

Since an instance runs its own `service.py`, changing it is changing that instance only: edit the title check in `example_doc/service/note-db-inst-w4veemdrx8y/service.py` and only `reading list` is restarted (at the next listing) with the new code; `example notes` and the template are as they were. Rebuilding one instance's `dashboard/` changes that instance's dashboards only.

## One instance calling another

Some services exist to serve others: a connection to AWS, PostgreSQL or Google Drive, a provider that signs users in. A call names either one instance, `{ serviceId }`, or any instance created from a template, `{ templateId }` (optionally `versionId` too); asked by template, the backend never picks the instance that asks.

The statistics dashboard above shows it on its second line. It asks for *another instance of its template* (bound to `reading list`, it gets `example notes`), reads that instance's numbers by its id, and **Import its notes** asks `reading list` to copy them. `noteImport` is an api of `reading list` that calls `noteList` of `example notes` itself, as a service:

```python
target = {'serviceId': sourceServiceId} if sourceServiceId else {'templateId': self.context.template['templateId']}
source = self.context.service_resolve(target)
note_list = self.context.service_call({'serviceId': source['serviceId']}, 'noteList', {'limit': limit})['noteList']
```

Importing again copies nothing: the notes are already there. An instance cannot import from itself: the call would come back to its own queue, which waits for the call to finish, so the backend refuses it at once.

The same calls over http, as any client of the backend makes them:

````bash
curl -s -XPOST localhost:45190/api/call -d '{"target": {"templateId": "w4wp4t0czko"}, "api": "statGet"}'
curl -s 'localhost:45190/instance/resolve?templateId=w4wp4t0czko'
````

An api may be answered to other instances only: `credentialsGet` of `aws-connection` gives AWS credentials to the services the connection allows, and is refused to the page (code -2), so the credentials never reach a browser. The callee knows its caller from the backend (`self.context.caller`), never from what a request says. The other connection templates (`google-drive`, `postgres-connection`, `cognito-auth`) serve other services the same way; they need accounts of their own, so the example has no instance of them.

## The Services tab

The settings panel (the gear in the side panel) has a **Services** tab with two areas:

- **Service templates**: one card per template. A card shows the template: its version id and the versions it had, its script, its initial config, the instances created from it (with the version each was created from when it is not the current one), and **New instance from note-db**. The `+` beside the version id records a new version id, with a note, after the template's files changed; the instances created before keep the version they recorded.
- **Service instances**: the system services (the page's own features run as services; none yet) and the custom ones, one card each. A card shows the instance: the template it was created from and how that template stands now (the same version, a newer one, renamed, gone), its folder, the apis of its own script, and its config dashboard. **New** creates an instance from a template chosen there.

Creating an instance copies the template folder (not its `service-template.yaml`, not installed `node_modules`) into a new `{templateName}-inst-{serviceId}` folder of the backend's default instance folder.

## Placing a dashboard

In edit mode the insert menu has a **Services** row: every dashboard of every template the backend knows. A new dashboard is an asset object bound to no instance; choose the instance in its head. The playground is the place to try it (it is ignored by git).

The design (the backend, templates and instances, what a script exposes, the calls between services, the props of a dashboard, its events) is `main/doc_page_impl_service.md`.
