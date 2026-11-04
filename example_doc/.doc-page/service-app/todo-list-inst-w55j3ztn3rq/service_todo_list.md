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

## Objects

The todos are objects of the object registry (`main/doc_page_impl_obj.md`), so any consumer finds and draws them without knowing this service: `ObjectList` of `core.task`, an `ObjectView` of one todo, a node of a card diagram ([Objects and Types](../../../../object-registry.md)).

| | |
| --- | --- |
| Types it defines | `todo-list.todo` (a `core.task`: summary `isDone`), `todo-list.list` (a `core.collection`) |
| objects | `service.{serviceId}:todo/{todoId}` (an update `{ isDone }` or `{ title }`), `service.{serviceId}:list` (its members, `core.member`, are the todos, oldest first) |
| object apis | `objectQuery`, `objectResolve`, `objectRead`, `objectUpdate`, `relationQuery`, answered to the kernel only; every write of the todos calls `context.object_changed()` |
| component | `TodoCard` (`expose.compList`, `todo-card`): the card of any `core.task`, checked off in place through the registry |
| requires | the type `core.task` (built in) |

## Dashboards

`default` (**Todos**): the list, with a filter kept as the dashboard's state. `config` (**Storage**): the dependencies with their status, the health, the database with its versions (create, check out, remove), and the backups (create, bring back, remove). Built from `dashboard/` (`npm install`, `npm run build`) into `dashboard/dist/`, which git ignores.
