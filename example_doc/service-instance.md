---
title: Service Instances
description: Stateful services run by a backend of their own, shown and worked through dashboards placed in documents
---

An asset is data: a versioned object a component reads. A **service instance** is a running thing with its own state: a database, a crawler, anything that answers requests and keeps something between them. Its state is not the document's; the document only places **dashboards** that show and work an instance. A **service type** is the code (a Python class) and the dashboards (a federated module) every instance of it shares; an instance is one folder with its config and its data.

The instances are run by the **service backend**, a program of its own (`main/service-backend/server.py`); the page reaches it through the development server. Both work alone: the backend answers any http client without the page, and the page without the backend shows in every dashboard that the backend is down. A built page has no backend.

## Running the example

The example type is `note-db`: notes kept in a sqlite database, one database per instance. Its dashboards are a small Vite project of their own (`example_doc/service-type/note-db/dashboard/`, with its own dependencies: installed there, or through a workspace that lists the folder), built once; the build is ignored by git:

````bash
pip install -r main/service-backend/requirements.txt
cd example_doc/service-type/note-db/dashboard && npm install && npm run build && cd -
python3 main/service-backend/server.py --config example_doc/service-backend.yaml
````

The backend listens on port 45190 (`example_doc/service-backend.yaml`); `config.yaml` names it under `service.backend`. It finds the types in `example_doc/service-type/` and the instances in `example_doc/service/`: `example notes` and `reading list` are two instances of `note-db`, each folder `{serviceId}--{name}` with its `service.yaml`, and with its `notes.sqlite` once it ran (ignored by git).

## A dashboard bound to an instance

The dashboard below is the default dashboard of `note-db`, bound to `example notes`. Add a note, edit it in place (the pencil beside its title), search. The head of the frame is the same for every dashboard: the type and the dashboard, the instance it shows (a choice, since a type has several instances), and the state of the instance with a button that asks the backend again.

<!--renderComp=service/note-db/default-->
```asset
store: local
objectId: w4veeme6sff
```

The block is a reference into the asset store, like any asset-only component: the object holds which instance the dashboard shows and the dashboard's own state, here the search it shows. A search is written into the object in place, so the document opens on the same search; choosing another instance rewrites the object the same way. A dashboard keeps its state there and nowhere else, whatever it is; the instance keeps its own state in its own folder.

## Another dashboard, another instance

A type may expose more dashboards than the two every type has (default, config). This one shows the numbers of `reading list`:

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

This one is a dashboard of a type the backend does not have (`sheet-db`):

<!--renderComp=service/sheet-db/default-->
```asset
store: local
objectId: w4vfc1twaj6
```

Stop the backend (Ctrl+C) and every dashboard says the backend is down; one that was showing stays on screen, and its calls fail until the backend is back. The page asks again every few seconds, so starting the backend brings the dashboards back without a reload.

## The queue of an instance

An instance answers one request at a time; a request waits until the ones before it are done. The config dashboard of `note-db` has **Reindex**, an async api slowed down to three seconds: while it runs, a search in the notes dashboard above waits for it, then answers.

## The Services tab

The settings panel (the gear in the side panel) has a **Services** tab. System services would be the page's own features run as services; there are none yet. Custom services are the instances of the backend, one card each. A card shows the instance: its type, its folder, the apis its type exposes, and its config dashboard. **New** creates an instance of a type: a new folder in the default instance folder of the backend.

## Placing a dashboard

In edit mode the insert menu has a **Services** row: every dashboard of every type the backend knows. A new dashboard is an asset object bound to no instance; choose the instance in its head. The playground is the place to try it (it is ignored by git).

The design (the backend, what a type exposes, the props of a dashboard, its events) is `main/doc_page_impl_service_instance.md`.
