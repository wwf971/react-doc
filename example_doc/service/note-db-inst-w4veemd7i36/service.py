"""note-db: notes kept in a sqlite database of the instance's folder.

The example of a stateful service (example_doc/service-instance.md). This
file is the template's; every instance created from the template runs its
own copy, and keeps its own notes.sqlite (created by start(), ignored by git).
"""

import os
import sqlite3
import time

from service_define import Service, ServiceError, api, param, returns
from service_util import time_text_get

NOTE_SCHEMA = {
    'type': 'object',
    'properties': {
        'noteId': {'type': 'integer'},
        'title': {'type': 'string'},
        'body': {'type': 'string'},
        'timeCreated': {'type': 'string'},
        'timeUpdated': {'type': 'string'},
    },
}


class NoteDb(Service):
    expose = {
        'meta': {
            'label': 'Note DB',
            'description': 'Notes kept in a sqlite database, one database per instance.',
            'author': 'react-doc example',
            'version': '1.0.0',
            'license': 'MIT',
            'icon': 'icon.svg',
            'tagList': ['example', 'sqlite'],
        },
        'configDefineList': [
            {'key': 'databaseFile', 'type': 'string', 'default': 'notes.sqlite',
             'description': 'the database file, in the instance folder'},
            {'key': 'titleLengthMax', 'type': 'integer', 'default': 120,
             'description': 'the longest title a note may have'},
        ],
        'dashboardList': [
            {'id': 'default', 'purpose': 'default', 'label': 'Notes', 'export': 'NoteDbDashboard',
             'description': 'list, search, add and edit the notes', 'heightMin': '14rem'},
            {'id': 'config', 'purpose': 'config', 'label': 'Settings', 'export': 'NoteDbConfigDashboard',
             'description': 'the database: its size, its settings, reindex', 'heightMin': '8rem'},
            {'id': 'stat', 'purpose': 'other', 'label': 'Statistics', 'export': 'NoteDbStatDashboard',
             'description': 'how many notes, how long they are', 'heightMin': '4rem'},
        ],
        'dashboardRemote': {
            'dir': 'dashboard/dist',
            'entry': 'remoteEntry.js',
            'container': 'serviceNoteDb',
            'module': './dashboard',
        },
        # a custom exposure: the sqlite schema, for whoever wants to read the file directly
        'sqliteTableList': ['note', 'setting'],
    }

    def start(self):
        database_file = self.context.config['databaseFile']
        self.database_path = self.context.path_get(database_file)
        self.connection = sqlite3.connect(self.database_path)
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS note (
                noteId INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                timeCreated TEXT NOT NULL,
                timeUpdated TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS setting (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)
        self.connection.commit()

    def stop(self):
        self.connection.close()

    # ---------- notes ----------

    @api(kind='query', description='the notes, newest first; query filters by title and body',
         params=[
             param('limit', 'integer', 'how many notes at most', default=50),
             param('offset', 'integer', 'how many notes to skip', default=0),
             param('query', 'string', 'text the title or the body contains', default=''),
         ],
         result=returns('object', '{ noteList, total }', schema={
             'properties': {'noteList': {'type': 'array', 'items': NOTE_SCHEMA}, 'total': {'type': 'integer'}},
         }))
    def noteList(self, limit=50, offset=0, query=''):
        where = ''
        argument_list = []
        if query:
            where = 'WHERE title LIKE ? OR body LIKE ?'
            argument_list = [f'%{query}%', f'%{query}%']
        total = self.connection.execute(f'SELECT COUNT(*) FROM note {where}', argument_list).fetchone()[0]
        row_list = self.connection.execute(
            f'SELECT * FROM note {where} ORDER BY noteId DESC LIMIT ? OFFSET ?',
            argument_list + [limit, offset],
        ).fetchall()
        return {'noteList': [dict(row) for row in row_list], 'total': total}

    @api(kind='query', description='one note',
         params=[param('noteId', 'integer', 'the note')],
         result=returns('object', 'the note', schema=NOTE_SCHEMA))
    def noteGet(self, noteId):
        return self._note_get(noteId)

    @api(kind='command', description='adds a note',
         params=[
             param('title', 'string', 'the title, not empty'),
             param('body', 'string', 'the text', default=''),
         ],
         result=returns('object', 'the note added', schema=NOTE_SCHEMA))
    def noteCreate(self, title, body=''):
        title = self._title_check(title)
        now = time_text_get()
        cursor = self.connection.execute(
            'INSERT INTO note (title, body, timeCreated, timeUpdated) VALUES (?, ?, ?, ?)',
            [title, body, now, now],
        )
        self.connection.commit()
        return self._note_get(cursor.lastrowid)

    @api(kind='command', description='changes the title or the body of a note',
         params=[
             param('noteId', 'integer', 'the note'),
             param('title', 'string', 'the new title', default=None),
             param('body', 'string', 'the new text', default=None),
         ],
         result=returns('object', 'the note changed', schema=NOTE_SCHEMA))
    def noteUpdate(self, noteId, title=None, body=None):
        note = self._note_get(noteId)
        title_new = self._title_check(title) if title is not None else note['title']
        body_new = body if body is not None else note['body']
        self.connection.execute(
            'UPDATE note SET title = ?, body = ?, timeUpdated = ? WHERE noteId = ?',
            [title_new, body_new, time_text_get(), noteId],
        )
        self.connection.commit()
        return self._note_get(noteId)

    @api(kind='command', description='removes a note',
         params=[param('noteId', 'integer', 'the note')],
         result=returns('null'))
    def noteDelete(self, noteId):
        self._note_get(noteId)
        self.connection.execute('DELETE FROM note WHERE noteId = ?', [noteId])
        self.connection.commit()
        return None

    # ---------- the database ----------

    @api(kind='query', description='how many notes, how long they are, how large the database is',
         result=returns('object', '{ noteCount, bodyLengthTotal, bodyLengthMax, databaseFile, databaseSize }'))
    def statGet(self):
        row = self.connection.execute(
            'SELECT COUNT(*) AS noteCount, COALESCE(SUM(LENGTH(body)), 0) AS bodyLengthTotal, '
            'COALESCE(MAX(LENGTH(body)), 0) AS bodyLengthMax FROM note'
        ).fetchone()
        return {
            **dict(row),
            'databaseFile': self.context.config['databaseFile'],
            'databaseSize': os.path.getsize(self.database_path),
        }

    @api(kind='query', description='a setting kept in the database',
         params=[param('key', 'string', 'the setting')],
         result=returns('any', 'the value, null when it is not set'))
    def settingGet(self, key):
        row = self.connection.execute('SELECT value FROM setting WHERE key = ?', [key]).fetchone()
        return row['value'] if row is not None else None

    @api(kind='command', description='sets a setting kept in the database',
         params=[param('key', 'string', 'the setting'), param('value', 'string', 'the value')],
         result=returns('null'))
    def settingSet(self, key, value):
        self.connection.execute(
            'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            [key, value],
        )
        self.connection.commit()
        return None

    @api(kind='command', execution='async',
         description='rebuilds the database file (VACUUM). Slowed down on purpose, to show a job and the queue: '
                     'the apis called meanwhile wait until it is done',
         params=[param('secondSlow', 'number', 'how long to pretend it takes', default=3)],
         result=returns('object', '{ sizeBefore, sizeAfter }'))
    def reindex(self, secondSlow=3):
        size_before = os.path.getsize(self.database_path)
        step_count = 10
        for step in range(step_count):
            self.context.job_progress_set(step / step_count, f'step {step + 1} of {step_count}')
            time.sleep(max(0, secondSlow) / step_count)
        self.connection.execute('VACUUM')
        return {'sizeBefore': size_before, 'sizeAfter': os.path.getsize(self.database_path)}

    # ---------- helpers ----------

    def _note_get(self, note_id):
        row = self.connection.execute('SELECT * FROM note WHERE noteId = ?', [note_id]).fetchone()
        if row is None:
            raise ServiceError(-3, f'the note {note_id} is not found')
        return dict(row)

    def _title_check(self, title):
        title = title.strip()
        if title == '':
            raise ServiceError(-1, 'the title is empty')
        title_length_max = self.context.config['titleLengthMax']
        if len(title) > title_length_max:
            raise ServiceError(-1, f'the title is longer than {title_length_max} characters')
        return title


SERVICE_CLASS = NoteDb
