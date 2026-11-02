<!-- Design of the service layer, storage: what a storage infra service exposes, the sqlite infra service, the local-backup infra service. Parent document: doc_page_impl_service.md. -->

# Services: Storage Infra Services

An app service keeps nothing of its own: its data lives in storage infra services, reached by name through the kernel ([Using an infra service](doc_page_impl_service_kernel.md#using-an-infra-service)). This document is what those infra services promise and the two built-in ones.

## Storage infra services

An infra service that keeps data for its consumers **exposes its storage** (`expose.infra.storage`): the `type` of store (`sqlite`, `backup-zip`, later `folder`, `object-store`), its `versioning` (`none`, `linear`; a tree or a graph of versions is a later model), the `operationList` it implements among `versionCreate`, `versionList`, `checkout`, `versionDelete`, `export`, `restore`, `backup`, and a `description`. A consumer knows what it stands on: the Services tab shows the storage of every infra name, and an app service's own dashboard can say where its data is and what can be done with it. The operations are apis of the infra service, with the names above, each about the calling consumer's own resource; an app service performs them on its data without holding it, and exposes what it wants of them as its own apis (`todo-list` exposes `versionCreate`, `versionCheckout`, `versionDelete`, `storageInfo`).

The built-in template `sqlite` (`built-in/service-template-infra/storage/w55iiudkmpr--sqlite/`) gives **every consumer a database of its own**, in the instance's folder:

```text
sqlite-inst-{serviceId}/data/{consumerServiceId}/current.sqlite      the consumer's database
                                                 /version/{id}.sqlite  a version: a consistent copy (sqlite's backup api)
                                                 /version.yaml         the versions, oldest first: { versionId, time, note, size }
```

The consumer is the caller the kernel knows, never a parameter: a service reaches its own database and no other's; the page names the consumer it inspects (`consumerServiceId`), for the Services tab. The sql apis keep sqlite's own model (`query`, `execute`, `executeBatch` in one transaction, `executeScript` for a schema), rather than a generic object api, because a service that chose sqlite should have sqlite: its transactions, its indexes, its SQL. The storage operations: `versionCreate(note)`, `versionList()`, `checkout(versionId)` (the current database is kept as a version first, `before checkout of …`; the consumer's connection is closed and opened again around the copy, so no statement sees half a file; the consumer's `start()` runs its schema again, since a version may predate it), `versionDelete`, `export()` (the path of the file, for a copy by hand), `exportTo(dirTarget)` (a consistent copy written where the consumer says: what it hands to another infra to keep), `restore(file, note)` (the database replaced by a sqlite file the consumer names, the one before kept as a version first: a backup brought back), `databaseInfo()`; `versionKeepMax` (50) prunes the oldest versions. Every api runs in the instance's queue, one at a time, so one open connection per consumer is enough, and a long checkout makes the other consumers wait: acceptable for a local backend of a few services, and the reason a second sqlite instance can be created and routed for a consumer that needs its own ([Routing](doc_page_impl_service_kernel.md#routing-an-infra-service)).

The storage operations are deliberately a storage layer's: `checkout` is not a read, it is a state change of the resource with lifecycle consequences, and it belongs to the infra service that holds the connection, not to the app service that asked for it.

### The local-backup infra service

A version of the sqlite infra service lives in the sqlite instance's folder: it goes where that instance goes, and is gone with it. A **backup** is a copy of a consumer's data kept **outside every instance**, as a file a person can see, copy and bring back. The built-in template `local-backup` (`built-in/service-template-infra/storage/w5f2xw18q2r--local-backup/`, infra name `local-backup`, `provision: auto`) is the simplest infra service that does this: **one zip file per backup, in one local folder**.

```text
{backupDir}/{consumerServiceId}--{templateName}--{time}[--{note-slug}].zip     one backup of one consumer
    service-backup.yaml     inside the zip: the consumer (id, name, its template record), the time, the whole note,
                            who asked, the entries, the consumer's own meta
    data/…                  the consumer's files and folders, as it gave them

example_doc/.doc-page/service-backup/                                         the default folder of the example's instance
    w55j3ztn3rq--todo-list--20261102_23540104+09--first-todos.zip
```

The design choices, each with its reason:

- **The folder is the whole state.** The instance keeps nothing beside it, and reads it again on every call: it can be deleted and provisioned again, moved, or pointed at another folder, and the backups there are the same consumers' backups. The name of a file is what identifies a backup (its `versionId` is the file name without `.zip`), so the folder is readable without the backend, and a file whose name has not the form is a problem the folder reports, never silently a backup. This is why the name carries the **consumer first** (its backups sort together), the **template name** (a reader of the disk knows what the id was), the **time** in the project's form, and the **note** as a slug, separated by `--` as a template folder's name is ([Backend](doc_page_impl_service_backend.md#backend)); the whole note and everything else is in the metadata inside the zip, so one file moved alone keeps its description.
- **Where the folder is**: by default `.doc-page/service-backup/` of the doc page the instance belongs to, since the metadata folder is already where the page keeps what is its own and not content ([the doc page folder](doc_page_impl_dir.md)), and `*.zip` is ignored by git; the instance's `backupDir` config names another (absolute, or relative to the instance folder). For this the context of an instance knows its **origin** (`context.origin`, the folder it was found in, and `doc_page_meta_dir_get()`).
- **A consumer sees its own backups only**, like a sqlite consumer: the caller the kernel knows is the consumer, never a parameter, and a service naming another `consumerServiceId` is refused, even an instance of the same template at the same version. The page names any consumer, found or not: a backup whose consumer instance the kernel does not list is an **orphan** (deleted, or made by another backend), listed with `isInstanceFound: false` and deleted from the page one by one, by consumer, or all at once (`orphanDeleteAll`). Nothing is removed by itself when an instance is deleted; what should happen then is in [TODO](doc_page_impl_TODO.md#service-data-clear).
- **The storage operations keep their names** (`versionCreate(pathList, note, meta)`, `versionList()`, `versionGet()`, `checkout(versionId, dirTarget)`, `versionDelete()`, `export()`), so a consumer that knows them from sqlite finds them here with the same meaning, a version being a backup. What differs is what passes: paths. The consumer hands over the files or folders holding its data, which another infra exported for it, and a checkout extracts them where the consumer says, since what to do with the files is the consumer's (hand a database back to its sqlite). The infra never holds a consumer's data open and never knows what the files are.
- **The page works it through its dashboards** (`default` Backups, `config` Backup folder, the latter shown in the Services tab under the instance): the folder, its consumers (the found ones with their instance's name and status, the orphans marked), each consumer's backups, and the deletions, every one confirmed in place. The usage, the apis and the metadata in full are in the template's own document, `service_local_backup.md`.

An app service makes the round trip in two calls each way, with a temporary folder in between and nothing in its own folder; `todo-list` does (`backupCreate`, `backupList`, `backupCheckout`, `backupDelete`, and the backups in `storageInfo`), with `local-backup` as an **optional** dependency, so the todos work without a backup instance and the backup apis answer -7 until the kernel provisions one:

```text
backupCreate(note)                                           backupCheckout(versionId)
  -> sqlite.exportTo(dirTemp)                                  -> local-backup.checkout(versionId, dirTemp)
  -> local-backup.versionCreate([dirTemp/current.sqlite], note)   -> sqlite.restore(dirTemp/current.sqlite): the database
  -> dirTemp removed                                              before is kept as a sqlite version first; the schema run again
```
