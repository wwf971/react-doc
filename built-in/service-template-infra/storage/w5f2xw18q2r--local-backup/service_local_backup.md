# local-backup: the local backup infra service

An infra service (`kind: infra`, infra name `local-backup`) that keeps **backups of its consumers' data as zip files in one folder** on the local disk. A consumer is a service instance, typically an app service that keeps its data in another infra service (`sqlite`) and wants a copy of it kept outside that infra, as a file it can bring back later. The kernel provisions an instance of this template when the name `local-backup` is required and nobody provides it (`provision: auto`).

Design and the place of this service among the storage infra services: `main/doc_page_impl_service_storage.md#the-local-backup-infra-service`. This file is how to use it.

## The folder

```text
{backupDir}/
├── w55j3ztn3rq--todo-list--20261029_05420030+09--first-todos.zip     a backup of the instance w55j3ztn3rq
├── w55j3ztn3rq--todo-list--20261102_23540104+09.zip                  another, without a note
└── w4veemd7i36--note-db--20261102_12000000+09--before-import.zip     a backup of another instance
```

- **One zip file per backup**, named `{consumerServiceId}--{templateName}--{time}[--{note-slug}].zip`: the consumer instance first, so its backups sort together; the name of the template it was created from, for the reader of the disk; the time in the project's form (`20261102_23540104+09`); and the note turned into a slug (lowercase words joined by `-`, at most 40 characters), when the note has any. `--` separates the parts, as in a template folder's name: an id and a time never hold it, and the other parts are kept from holding it.
- **The folder is the whole state.** Every listing reads it again; the instance keeps nothing beside it. Point an instance at another folder (`backupDir`), or delete the instance and let the kernel provision a new one, and the backups there are those of the same consumers. A file whose name has not the form, or a folder, is a problem the folder reports (`folderInfo`), never a backup; names starting with a dot are not read (a backup being written is `.tmp-…`, renamed when complete).
- **The default folder** is `.doc-page/service-backup/` of the doc page the instance belongs to (the metadata folder, beside the other files the page keeps for itself; `*.zip` is ignored by git). `backupDir` of the instance's config names another: an absolute path, or one relative to the instance folder. An instance of a plain folder of the backend config (no doc page) uses `service-backup/` beside its own folder. The folder is made by the first backup, never before: until then the listing is empty.
- **Inside a zip**: `service-backup.yaml`, the metadata, and `data/`, the consumer's files and folders as they were given, each under its own name:

```yaml
# service-backup.yaml, inside the zip
versionId: w55j3ztn3rq--todo-list--20261029_05420030+09--first-todos
consumerServiceId: w55j3ztn3rq
consumerName: example todos
consumerKind: app
template: { templateId: w55iiudjq5y, name: todo-list, versionId: w55iiudjq61 }   # the consumer's template record
time: 20261029_05420030+09
note: first todos                       # the whole note; the file name holds its slug
caller: { kind: service, id: w55j3ztn3rq }   # who asked for the backup
entryList:
  - { path: current.sqlite, size: 12288 }
meta: {}                                # the consumer's own, as given
```

## Who sees what

The **consumer is the caller the kernel knows**, never a parameter: a service reaches its own backups and no other's, even an instance of the same template (a call naming another `consumerServiceId` is refused, -2). The page (the Services tab, the dashboards) names the consumer it works on, found or not: a backup whose consumer instance the kernel does not list (deleted, or made by another backend) is an **orphan**, listed under its id with `isInstanceFound: false`, and deleted from the page one by one, by consumer, or all at once. Nothing is deleted by itself: when a consumer instance is deleted, its backups stay (`main/doc_page_impl_TODO.md#service-data-clear`).

## The apis

The storage operations have the names of the storage vocabulary (`expose.infra.storage.operationList`), so a consumer that knows them from `sqlite` finds them here; a version of this storage is a backup, and its `versionId` is the name of its file without `.zip`. `consumerServiceId` is for the page only.

| api | what |
| --- | --- |
| `versionCreate(pathList, note?, meta?)` | the files and folders of `pathList` (absolute paths; a folder with everything in it) zipped into one backup, with the note and the consumer's own `meta`; the consumer instance must exist. Answers the backup `{ versionId, fileName, file, consumerServiceId, templateName, time, note, size, entryCount }`. The oldest backups beyond `versionKeepMax` are removed (0: keep all) |
| `versionList()` | the consumer's backups, oldest first |
| `versionGet(versionId)` | one backup with its whole metadata (`entryList`, `consumerName`, `template`, `caller`, `meta`) |
| `checkout(versionId, dirTarget)` | the backup extracted into `dirTarget` (absolute; created; files there replaced), each entry under the name it was given; answers `{ versionId, dirTarget, entryList }`. What to do with the files is the consumer's: it hands a database back to its storage infra (`sqlite.restore`) and removes the folder |
| `versionDelete(versionId)` | the backup removed |
| `export(versionId)` | `{ file }`: the path of the zip, for a copy by hand |

For the page and the kernel only (`callerKindList`): `folderInfo()` (the folder: `backupDir`, whether it is the default, whether it exists, the counts, the sizes, the `problemList`), `consumerList()` (every consumer with backups: `consumerServiceId`, `templateName`, `isInstanceFound`, `instanceName`, `instanceStatus`, `backupCount`, `sizeTotal`, `timeLatest`; the found ones first), `consumerDelete(consumerServiceId)` (every backup of one consumer), `orphanDeleteAll()`.

## A consumer: backup and restore round trip

`todo-list` (`example_doc/.doc-page/service-template-app/productivity/task/w55iiudjq5y--todo-list/`) keeps its todos in `sqlite` and declares `local-backup` as an optional dependency; its own `backupCreate`, `backupList`, `backupCheckout` and `backupDelete` are these calls:

```text
backupCreate(note)
  -> dirTemp = a temporary folder (tempfile.mkdtemp: the app instance keeps nothing in its own folder)
  -> sqlite.exportTo(dirTarget=dirTemp)          a consistent copy, dirTemp/current.sqlite
  -> local-backup.versionCreate(pathList=[dirTemp/current.sqlite], note, meta={ ... })
  -> dirTemp removed

backupCheckout(versionId)
  -> local-backup.checkout(versionId, dirTarget=dirTemp)   dirTemp/current.sqlite
  -> sqlite.restore(file=dirTemp/current.sqlite, note)      the database replaced; the one before kept as a sqlite version
  -> the schema script run again (the backup may predate it); dirTemp removed
```

A consumer that keeps its own files (`note-db`, a database in its folder) hands them over directly: `versionCreate(pathList=[self.context.path_get('notes.sqlite')])`, and on checkout extracts beside them and swaps the file with its connection closed.

## The dashboards

`default` (**Backups**) and `config` (**Backup folder**, shown in the Services tab under the instance) are one browser: the folder (where, default or configured, how many backups, how large, how many consumers and orphans, the names that are no backup), then the consumers, the found ones first with their instance's name and status, the orphans with `not found`; a consumer opens its backups (time, note, size, file name), each removed with a confirmation in place, a consumer's all at once, the orphans' all at once. The config dashboard shows the instance's config (`backupDir`, `versionKeepMax`) above. Both are built from `dashboard/` (`npm install`, `npm run build` there) into `dashboard/dist/`, which git ignores.

## Files

```text
service-template.yaml        id, name, kind infra, provision auto, versions, the initial config
service.py                   LocalBackup: the folder, the names, the zip, the apis
service_local_backup.md      this file
icon.svg
dashboard/src/LocalBackupDashboard.jsx         the browser (default); LocalBackupConfigDashboard.jsx wraps it with the config (config)
dashboard/src/service-call.js, dashboard.jsx   the calls through onEvent, the module the page loads
dashboard/vite.config.js, package.json         the federated build (container serviceLocalBackup, module ./dashboard)
```
