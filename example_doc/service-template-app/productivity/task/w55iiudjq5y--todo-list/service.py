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
"""

from service_define import Service, ServiceError, api, param, returns
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
        ],
        'configDefineList': [
            {'key': 'titleLengthMax', 'type': 'integer', 'default': 200, 'description': 'the longest title a todo may have'},
        ],
        'dashboardList': [
            {'id': 'default', 'purpose': 'default', 'label': 'Todos', 'export': 'TodoListDashboard',
             'description': 'list, add, check off and remove the todos', 'heightMin': '12rem'},
            {'id': 'config', 'purpose': 'config', 'label': 'Storage', 'export': 'TodoListConfigDashboard',
             'description': 'the database the sqlite infra service keeps for this instance: its versions, a checkout', 'heightMin': '10rem'},
        ],
        'dashboardRemote': {
            'dir': 'dashboard/dist',
            'entry': 'remoteEntry.js',
            'container': 'serviceTodoList',
            'module': './dashboard',
        },
    }

    @property
    def db(self):
        return self.context.infra('sqlite')

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
        return self._todo_get(result['lastRowId'])

    @api(kind='command', description='checks a todo off, or back on',
         params=[param('todoId', 'integer', 'the todo'), param('isDone', 'boolean', 'done or not')],
         result=returns('object', 'the todo changed', schema=TODO_SCHEMA))
    def todoDoneSet(self, todoId, isDone):
        self._todo_get(todoId)
        self.db.execute(sql='UPDATE todo SET isDone = ?, timeUpdated = ? WHERE todoId = ?', params=[1 if isDone else 0, time_text_get(), todoId])
        return self._todo_get(todoId)

    @api(kind='command', description='changes the title of a todo',
         params=[param('todoId', 'integer', 'the todo'), param('title', 'string', 'the new title')],
         result=returns('object', 'the todo changed', schema=TODO_SCHEMA))
    def todoUpdate(self, todoId, title):
        self._todo_get(todoId)
        self.db.execute(sql='UPDATE todo SET title = ?, timeUpdated = ? WHERE todoId = ?', params=[self._title_check(title), time_text_get(), todoId])
        return self._todo_get(todoId)

    @api(kind='command', description='removes a todo',
         params=[param('todoId', 'integer', 'the todo')],
         result=returns('null'))
    def todoDelete(self, todoId):
        self._todo_get(todoId)
        self.db.execute(sql='DELETE FROM todo WHERE todoId = ?', params=[todoId])
        return None

    @api(kind='command', description='removes the done todos',
         result=returns('object', '{ deletedCount }'))
    def todoClearDone(self):
        result = self.db.execute(sql='DELETE FROM todo WHERE isDone = 1')
        return {'deletedCount': result['rowCount']}

    # ---------- the storage: the instance's database in the infra service ----------

    @api(kind='query', description='the database the sqlite infra service keeps for this instance: file, size, versions, '
                                   'and the infra instance that holds it',
         result=returns('object', '{ infra: { serviceId, name, status }, database: { file, size, tableList, versionList } }'))
    def storageInfo(self):
        infra = self.db.resolve()
        return {
            'infra': {'serviceId': infra['serviceId'], 'name': infra['name'], 'status': infra['status']},
            'database': self.db.databaseInfo(),
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
        self.context.log('info', 'storage', f'version {versionId} checked out', {'versionBefore': result['versionBefore']['versionId']})
        return result

    @api(kind='command', description='removes a version of the database',
         params=[param('versionId', 'string', 'the version')],
         result=returns('null'))
    def versionDelete(self, versionId):
        self.db.versionDelete(versionId=versionId)
        return None

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
