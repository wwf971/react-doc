# todo-list: a stateless app service on the storage infra services

The example app service of the demonstration doc page (`kind: app`): a todo list whose instance keeps nothing in its own folder. Its todos live in the `sqlite` infra service (one database per consumer instance), and its backups in the `local-backup` infra service (one zip file per backup in a local folder); both are reached by name, never by instance. Shown in [App Services, Infra Services and the Kernel](../../../../service-kernel.md); the design is `main/doc_page_impl_service.md`.

## Dependencies

```python
'dependencyList': [
    {'name': 'sqlite', 'isRequired': True, 'onUnavailable': 'report'},          # the todos: without it the instance waits
    {'name': 'local-backup', 'isRequired': False, 'onUnavailable': 'report'},   # the backups: without it the backup apis answer -7
],
```

## The apis

| group | apis |
| --- | --- |
| todos | `todoList(isDone?, query?, limit?)`, `todoCreate(title)`, `todoDoneSet(todoId, isDone)`, `todoUpdate(todoId, title)`, `todoDelete(todoId)`, `todoClearDone()` |
| the database in sqlite | `storageInfo()` (the sqlite instance, the database, its versions, and the backups with the local-backup instance when one answers), `versionCreate(note?)`, `versionCheckout(versionId)`, `versionDelete(versionId)`: the sqlite versions of its own database |
| the backups in local-backup | `backupCreate(note?)`, `backupList()`, `backupCheckout(versionId)`, `backupDelete(versionId)`: see the round trip in `service_local_backup.md` of the local-backup template |

## Dashboards

`default` (**Todos**): the list, with a filter kept as the dashboard's state. `config` (**Storage**): the dependencies with their status, the health, the database with its versions (create, check out, remove), and the backups (create, bring back, remove). Built from `dashboard/` (`npm install`, `npm run build`) into `dashboard/dist/`, which git ignores.
