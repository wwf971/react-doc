"""todo-list: a stateless app service whose todos live in the sqlite infra service.

The example of an app service as they are meant to be written
(doc_page_impl_service.md#app-services-and-infra-services): the instance
keeps nothing in its own folder. Its data is a database the "sqlite" infra
service holds for it (one file per consumer instance), reached by name
through self.context.infra('sqlite'); the kernel routes the name to the
current sqlite instance, and provisions one from the built-in template when
none exists. The storage operations (versions, checkout) are the infra's,
asked for by this service for its own database.

The schema is created in on_create (once in the life of the instance) and
checked again in start (a checkout may bring an older database back); both
are idempotent.

A backup is the same idea one level up: the "local-backup" infra service
keeps zip files of a consumer's data in a folder outside any infra instance.
This service asks sqlite for a consistent copy of its database, hands the
file to local-backup, and on a restore brings the file back through sqlite
(doc_page_impl_service_storage.md#the-local-backup-infra-service). The dependency
is optional: without a local-backup instance the todos work, and the backup
apis answer -7.

The todos are objects of the object registry too (doc_page_impl_obj.md): the
template defines the types todo-list.todo (a core.task) and todo-list.list (a
core.collection, one per instance), the instance provides them in its
namespace service.{serviceId} through the object apis (objectQuery,
objectResolve, objectRead, objectUpdate, relationQuery), which only the
kernel calls, and its module carries a card (TodoCard) that draws any
core.task, a todo of this template or of another provider. A consumer that
knows nothing of this service (an ObjectList of core.task, a card diagram)
finds the todos, draws them and checks them off through the registry.
"""

import os
import shutil
import tempfile

from service_define import Service, ServiceError, api, object_api, param, returns
from service_util import time_text_get

SCHEMA_SCRIPT = """
    CREATE TABLE IF NOT EXISTS todo (
        todoId INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        isDone INTEGER NOT NULL DEFAULT 0,
        timeCreated TEXT NOT NULL,
        timeUpdated TEXT NOT NULL
    );
"""

TODO_SCHEMA = {
    'type': 'object',
    'properties': {
        'todoId': {'type': 'integer'},
        'title': {'type': 'string'},
        'isDone': {'type': 'boolean'},
        'timeCreated': {'type': 'string'},
        'timeUpdated': {'type': 'string'},
    },
}


class TodoList(Service):
    expose = {
        'meta': {
            'label': 'Todo list',
            'description': 'Todos kept in the sqlite infra service: a stateless app service.',
            'author': 'react-doc example',
            'version': '1.0.0',
            'license': 'MIT',
            'icon': 'icon.svg',
            'tagList': ['example', 'app', 'stateless'],
        },
        # the infra services the instance uses, by name; the initial dependency
        # list of every instance created from the template (its service.yaml
        # keeps the effective one, which the Services tab edits)
        'dependencyList': [
            {'name': 'sqlite', 'isRequired': True, 'onUnavailable': 'report'},
            {'name': 'local-backup', 'isRequired': False, 'onUnavailable': 'report'},
        ],
        'configDefineList': [
            {'key': 'titleLengthMax', 'type': 'integer', 'default': 200, 'description': 'the longest title a todo may have'},
        ],
        'dashboardList': [
            {'id': 'default', 'purpose': 'default', 'label': 'Todos', 'export': 'TodoListDashboard',
             'description': 'list, add, check off and remove the todos', 'heightMin': '12rem'},
            {'id': 'config', 'purpose': 'config', 'label': 'Storage', 'export': 'TodoListConfigDashboard',
             'description': 'the database the sqlite infra service keeps for this instance: its versions, a checkout; '
                            'its backups in the local-backup infra service', 'heightMin': '10rem'},
        ],
        # the components of the module besides the dashboards: an object view,
        # chosen by the page for an object of a type it draws (any core.task)
        'compList': [
            {'id': 'todo-card', 'export': 'TodoCard', 'label': 'Task card',
             'description': 'a task: its title, checked off in place when the provider allows it',
             'objectView': {'typeList': ['core.task'], 'contextList': ['card', 'icon', 'inline']}},
        ],
        'dashboardRemote': {
            'dir': 'dashboard/dist',
            'entry': 'remoteEntry.js',
            'container': 'serviceTodoList',
            'module': './dashboard',
        },
        # the types the template defines, under its name (doc_page_impl_obj.md#types)
        'typeList': [
            {'id': 'todo-list.todo', 'label': 'Todo', 'extendList': ['core.task'], 'icon': 'square-check',
             'summaryKeyList': ['isDone'],
             'description': 'a todo of a todo-list instance; an update { isDone } or { title } changes it'},
            {'id': 'todo-list.list', 'label': 'Todo list', 'extendList': ['core.collection'], 'icon': 'list-todo',
             'summaryKeyList': ['total', 'openCount'],
             'description': 'the todos of one todo-list instance, as a collection: its members are the todos, oldest first'},
        ],
        # the objects every instance provides (the object apis below)
        'objectProvide': {
            'typeList': ['todo-list.todo', 'todo-list.list'],
            'relationTypeList': ['core.member'],
            'queryFilterList': ['isDone'],
            'cacheSecond': 10,
        },
        # what the template needs others to provide: its types extend core.task
        'requireList': [
            {'type': 'core.task', 'note': 'todo-list.todo extends it'},
        ],
    }

    @property
    def db(self):
        return self.context.infra('sqlite')

    @property
    def backup(self):
        return self.context.infra('local-backup')

    def on_create(self):
        self.db.executeScript(script=SCHEMA_SCRIPT)
        self.context.log('info', 'schema', 'todo table created')

    def start(self):
        # a checked-out version may predate the schema: make sure it is there
        self.db.executeScript(script=SCHEMA_SCRIPT)

    # ---------- todos ----------

    @api(kind='query', description='the todos, newest first; isDone filters, query filters by title',
         params=[
             param('isDone', 'boolean', 'only the done (true) or the open (false) ones; null for all', default=None),
             param('query', 'string', 'text the title contains', default=''),
             param('limit', 'integer', 'how many at most', default=100),
         ],
         result=returns('object', '{ todoList, total, openCount }', schema={
             'properties': {'todoList': {'type': 'array', 'items': TODO_SCHEMA}, 'total': {'type': 'integer'}, 'openCount': {'type': 'integer'}},
         }))
    def todoList(self, isDone=None, query='', limit=100):
        where_list = []
        argument_list = []
        if isDone is not None:
            where_list.append('isDone = ?')
            argument_list.append(1 if isDone else 0)
        if query:
            where_list.append('title LIKE ?')
            argument_list.append(f'%{query}%')
        where = f'WHERE {" AND ".join(where_list)}' if where_list else ''
        row_list = self.db.query(sql=f'SELECT * FROM todo {where} ORDER BY isDone ASC, todoId DESC LIMIT ?', params=argument_list + [limit])['rowList']
        total = self.db.query(sql='SELECT COUNT(*) AS total, SUM(CASE WHEN isDone = 0 THEN 1 ELSE 0 END) AS openCount FROM todo')['rowList'][0]
        return {'todoList': [self._todo_build(row) for row in row_list], 'total': total['total'], 'openCount': total['openCount'] or 0}

    @api(kind='command', description='adds a todo',
         params=[param('title', 'string', 'the title, not empty')],
         result=returns('object', 'the todo added', schema=TODO_SCHEMA))
    def todoCreate(self, title):
        title = self._title_check(title)
        now = time_text_get()
        result = self.db.execute(sql='INSERT INTO todo (title, isDone, timeCreated, timeUpdated) VALUES (?, 0, ?, ?)', params=[title, now, now])
        self.context.object_changed()
        return self._todo_get(result['lastRowId'])

    @api(kind='command', description='checks a todo off, or back on',
         params=[param('todoId', 'integer', 'the todo'), param('isDone', 'boolean', 'done or not')],
         result=returns('object', 'the todo changed', schema=TODO_SCHEMA))
    def todoDoneSet(self, todoId, isDone):
        self._todo_get(todoId)
        self.db.execute(sql='UPDATE todo SET isDone = ?, timeUpdated = ? WHERE todoId = ?', params=[1 if isDone else 0, time_text_get(), todoId])
        self.context.object_changed()
        return self._todo_get(todoId)

    @api(kind='command', description='changes the title of a todo',
         params=[param('todoId', 'integer', 'the todo'), param('title', 'string', 'the new title')],
         result=returns('object', 'the todo changed', schema=TODO_SCHEMA))
    def todoUpdate(self, todoId, title):
        self._todo_get(todoId)
        self.db.execute(sql='UPDATE todo SET title = ?, timeUpdated = ? WHERE todoId = ?', params=[self._title_check(title), time_text_get(), todoId])
        self.context.object_changed()
        return self._todo_get(todoId)

    @api(kind='command', description='removes a todo',
         params=[param('todoId', 'integer', 'the todo')],
         result=returns('null'))
    def todoDelete(self, todoId):
        self._todo_get(todoId)
        self.db.execute(sql='DELETE FROM todo WHERE todoId = ?', params=[todoId])
        self.context.object_changed()
        return None

    @api(kind='command', description='removes the done todos',
         result=returns('object', '{ deletedCount }'))
    def todoClearDone(self):
        result = self.db.execute(sql='DELETE FROM todo WHERE isDone = 1')
        self.context.object_changed()
        return {'deletedCount': result['rowCount']}

    # ---------- the storage: the instance's database in the infra service ----------

    @api(kind='query', description='the database the sqlite infra service keeps for this instance: file, size, versions, '
                                   'and the infra instance that holds it; and the backups the local-backup infra service '
                                   'keeps of it (backup is null when no local-backup instance answers)',
         result=returns('object', '{ infra: { serviceId, name, status }, database: { file, size, tableList, versionList }, '
                                  'backup: { infra: { serviceId, name, status }, backupList } | null }'))
    def storageInfo(self):
        infra = self.db.resolve()
        backup = None
        if self.backup.is_available():
            backup_infra = self.backup.resolve()
            backup = {
                'infra': {'serviceId': backup_infra['serviceId'], 'name': backup_infra['name'], 'status': backup_infra['status']},
                'backupList': self.backup.versionList(),
            }
        return {
            'infra': {'serviceId': infra['serviceId'], 'name': infra['name'], 'status': infra['status']},
            'database': self.db.databaseInfo(),
            'backup': backup,
        }

    @api(kind='command', description='a version of the database, made by the infra service',
         params=[param('note', 'string', 'what the version is', default='')],
         result=returns('object', 'the version: { versionId, time, note, size }'))
    def versionCreate(self, note=''):
        version = self.db.versionCreate(note=note)
        self.context.log('info', 'storage', f'version {version["versionId"]} created', {'note': note})
        return version

    @api(kind='command', description='checks a version of the database out: the todos become those of the version '
                                     '(the database as it was is kept as a version first)',
         params=[param('versionId', 'string', 'the version')],
         result=returns('object', '{ versionId, versionBefore }'))
    def versionCheckout(self, versionId):
        result = self.db.checkout(versionId=versionId)
        # the version may predate the schema
        self.db.executeScript(script=SCHEMA_SCRIPT)
        self.context.object_changed()
        self.context.log('info', 'storage', f'version {versionId} checked out', {'versionBefore': result['versionBefore']['versionId']})
        return result

    @api(kind='command', description='removes a version of the database',
         params=[param('versionId', 'string', 'the version')],
         result=returns('null'))
    def versionDelete(self, versionId):
        self.db.versionDelete(versionId=versionId)
        return None

    # ---------- the backups: the database as a zip file in the local-backup infra service ----------

    @api(kind='command', description='a backup of the database: a consistent copy handed to the local-backup infra service, '
                                     'which keeps it as one zip file in its folder',
         params=[param('note', 'string', 'what the backup is', default='')],
         result=returns('object', 'the backup: { versionId, fileName, file, time, note, size }'))
    def backupCreate(self, note=''):
        dir_temp = tempfile.mkdtemp(prefix='todo-list-backup-')
        try:
            exported = self.db.exportTo(dirTarget=dir_temp)
            backup = self.backup.versionCreate(pathList=[exported['file']], note=note,
                                               meta={'storage': 'sqlite', 'file': 'current.sqlite', 'size': exported['size']})
        finally:
            shutil.rmtree(dir_temp, ignore_errors=True)
        self.context.log('info', 'backup', f'backup {backup["versionId"]} made', {'note': note})
        return backup

    @api(kind='query', description='the backups of the database in the local-backup infra service, oldest first',
         result=returns('array', 'the backups'))
    def backupList(self):
        return self.backup.versionList()

    @api(kind='command', description='brings a backup back: the todos become those of the backup (the database as it was '
                                     'is kept as a sqlite version first)',
         params=[param('versionId', 'string', 'the backup')],
         result=returns('object', '{ versionId, versionBefore }'))
    def backupCheckout(self, versionId):
        dir_temp = tempfile.mkdtemp(prefix='todo-list-backup-')
        try:
            checkout = self.backup.checkout(versionId=versionId, dirTarget=dir_temp)
            file_list = [entry for entry in checkout['entryList'] if entry['path'].endswith('.sqlite')]
            if len(file_list) != 1:
                raise ServiceError(-1, f'the backup {versionId} holds no single sqlite file: {[entry["path"] for entry in checkout["entryList"]]}')
            restored = self.db.restore(file=os.path.join(dir_temp, file_list[0]['path']), note=f'backup {versionId}')
        finally:
            shutil.rmtree(dir_temp, ignore_errors=True)
        # the backup may predate the schema
        self.db.executeScript(script=SCHEMA_SCRIPT)
        self.context.object_changed()
        self.context.log('info', 'backup', f'backup {versionId} checked out', {'versionBefore': restored['versionBefore']['versionId']})
        return {'versionId': versionId, 'versionBefore': restored['versionBefore']}

    @api(kind='command', description='removes a backup',
         params=[param('versionId', 'string', 'the backup')],
         result=returns('null'))
    def backupDelete(self, versionId):
        self.backup.versionDelete(versionId=versionId)
        return None

    # ---------- the objects: the provider of the object registry ----------
    # local ids: 'list' (the list itself), 'todo/{todoId}'. the kernel makes
    # them references of the instance's namespace, service.{serviceId}:…

    @object_api(description='the objects of the instance of these types (or their supertypes): the list, the todos')
    def objectQuery(self, typeList, text='', filter=None, limit=100):
        filter = filter or {}
        result = []
        if self.context.object_type_list_match(['todo-list.list'], typeList) and (not text or text.lower() in self._list_label_get().lower()):
            result.append(self._list_descriptor_build())
        if self.context.object_type_list_match(['todo-list.todo'], typeList):
            is_done = filter.get('isDone') if isinstance(filter.get('isDone'), bool) else None
            for todo in self.todoList(isDone=is_done, query=text, limit=limit)['todoList']:
                result.append(self._todo_descriptor_build(todo))
        return result[:limit]

    @object_api(description='how many objects objectQuery would answer, without listing them (the preflight of a search)')
    def objectCount(self, typeList, text='', filter=None):
        filter = filter or {}
        count = 0
        if self.context.object_type_list_match(['todo-list.list'], typeList) and (not text or text.lower() in self._list_label_get().lower()):
            count += 1
        if self.context.object_type_list_match(['todo-list.todo'], typeList):
            where_list, argument_list = ['title LIKE ?'], [f'%{text}%']
            if isinstance(filter.get('isDone'), bool):
                where_list.append('isDone = ?')
                argument_list.append(1 if filter['isDone'] else 0)
            count += self.db.query(sql=f'SELECT COUNT(*) AS total FROM todo WHERE {" AND ".join(where_list)}', params=argument_list)['rowList'][0]['total']
        return count

    @object_api(description='the descriptor of each local id, null for one that does not exist')
    def objectResolve(self, localIdList):
        return [self._object_get(local_id)[0] for local_id in localIdList]

    @object_api(description='{ descriptor, content } of an object')
    def objectRead(self, localId):
        descriptor, content = self._object_get(localId)
        if descriptor is None:
            raise ServiceError(-3, f'{localId} is not an object of this list')
        return {'descriptor': descriptor, 'content': content}

    @object_api(description='changes a todo: { isDone } checks it off or on, { title } renames it')
    def objectUpdate(self, localId, patch):
        todo_id = self._todo_id_get(localId)
        if todo_id is None:
            raise ServiceError(-2, f'{localId} cannot be changed: only a todo can')
        if 'title' in patch:
            self.todoUpdate(todo_id, patch['title'])
        if 'isDone' in patch:
            if not isinstance(patch['isDone'], bool):
                raise ServiceError(-1, 'isDone is true or false')
            self.todoDoneSet(todo_id, patch['isDone'])
        return self.objectRead(localId)

    @object_api(description='the members of the list (core.member), from the list or to a todo')
    def relationQuery(self, fromRef='', toRef='', typeList=None):
        if not self.context.object_type_list_match(['core.member'], typeList or ['core.relation']):
            return []
        list_ref = self.context.object_ref_build('list')
        if fromRef and fromRef != list_ref:
            return []
        if toRef and not toRef.startswith(self.context.object_ref_build('todo/')):
            return []
        row_list = self.db.query(sql='SELECT todoId FROM todo ORDER BY todoId ASC')['rowList']
        result = []
        for index, row in enumerate(row_list):
            to_ref = self.context.object_ref_build(f'todo/{row["todoId"]}')
            if toRef and toRef != to_ref:
                continue
            result.append({'key': f'member/{row["todoId"]}', 'type': 'core.member', 'fromRef': list_ref, 'toRef': to_ref, 'order': index})
        return result

    def _list_label_get(self):
        return f'{self.context.name} · todos'

    def _list_descriptor_build(self):
        total = self.db.query(sql='SELECT COUNT(*) AS total, SUM(CASE WHEN isDone = 0 THEN 1 ELSE 0 END) AS openCount FROM todo')['rowList'][0]
        return {'localId': 'list', 'typeList': ['todo-list.list'], 'label': self._list_label_get(),
                'description': f'the todos of {self.context.name}',
                'summary': {'total': total['total'], 'openCount': total['openCount'] or 0},
                'capabilityList': ['read'], 'open': {'kind': 'serviceInstance', 'serviceId': self.context.service_id}}

    def _todo_descriptor_build(self, todo):
        return {'localId': f'todo/{todo["todoId"]}', 'typeList': ['todo-list.todo'], 'label': todo['title'],
                'description': f'a todo of {self.context.name}', 'summary': {'isDone': todo['isDone']},
                'capabilityList': ['read', 'update'], 'open': {'kind': 'serviceInstance', 'serviceId': self.context.service_id}}

    def _todo_id_get(self, local_id):
        if not isinstance(local_id, str) or not local_id.startswith('todo/'):
            return None
        try:
            return int(local_id[len('todo/'):])
        except ValueError:
            return None

    def _object_get(self, local_id):
        """(descriptor, content) of a local id; (None, None) when there is no such object."""
        if local_id == 'list':
            descriptor = self._list_descriptor_build()
            return descriptor, dict(descriptor['summary'])
        todo_id = self._todo_id_get(local_id)
        if todo_id is None:
            return None, None
        row_list = self.db.query(sql='SELECT * FROM todo WHERE todoId = ?', params=[todo_id])['rowList']
        if len(row_list) == 0:
            return None, None
        todo = self._todo_build(row_list[0])
        return self._todo_descriptor_build(todo), todo

    # ---------- helpers ----------

    def _todo_get(self, todo_id):
        row_list = self.db.query(sql='SELECT * FROM todo WHERE todoId = ?', params=[todo_id])['rowList']
        if len(row_list) == 0:
            raise ServiceError(-3, f'the todo {todo_id} is not found')
        return self._todo_build(row_list[0])

    def _todo_build(self, row):
        return {**row, 'isDone': bool(row['isDone'])}

    def _title_check(self, title):
        title = str(title or '').strip()
        if title == '':
            raise ServiceError(-1, 'the title is empty')
        title_length_max = self.context.config['titleLengthMax']
        if len(title) > title_length_max:
            raise ServiceError(-1, f'the title is longer than {title_length_max} characters')
        return title


SERVICE_CLASS = TodoList
