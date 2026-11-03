"""local-backup: a storage infra service keeping backups of its consumers' data as zip files in one folder.

Design: doc_page_impl_service_storage.md#the-local-backup-infra-service
Usage, for the authors of a consumer: service_local_backup.md beside this file.

A consumer (an app instance, typically) hands over the files or folders
holding its data (what another infra service exported for it), and gets one
zip file in the backup folder, named so that the folder alone says what it
holds: the consumer first, so its backups sort together,

    {backupDir}/{consumerServiceId}--{templateName}--{time}[--{note-slug}].zip

    service-backup.yaml        inside the zip: the metadata (the consumer, its
                               template, the time, the whole note, the entries)
    data/...                   the consumer's files and folders, as given

The folder is the whole state. Nothing is kept beside it: every listing
reads the folder again, so the instance can be deleted and created again,
or pointed at another folder (backupDir), and the backups there are those
of the same consumers. A name that has not the form is a problem of the
folder, reported, never taken for a backup; a file starting with a dot is
not read (a backup being written is .tmp-…, renamed when complete).

The consumer is the caller the kernel knows, never a parameter: a service
reaches its own backups and no other's, even an instance of the same
template. The page (the Services tab, the dashboards of this template)
names the consumer it works on (consumerServiceId), active or not: a backup
whose consumer instance is not found (deleted, or of another backend) is an
orphan, listed and deleted from there.

The storage operations keep the names of the storage vocabulary
(doc_page_impl_service_storage.md#storage-infra-services), so a consumer that
knows them from sqlite finds them here: versionCreate (the zip written),
versionList, checkout (the zip extracted where the consumer says),
versionDelete, export (the path of the zip). A version of this storage is
a backup, and its id is the name of its file.
"""

import os
import re
import time
import zipfile

import yaml

from service_define import Service, ServiceError, api, param, returns
from service_util import REGEX_ID, REGEX_TEMPLATE_NAME, time_text_get

BACKUP_DIR_DEFAULT_NAME = 'service-backup'
BACKUP_FILE_EXT = '.zip'
# the separator of the parts of a backup name, as for a template folder
# ({templateId}--{name}): an id and a time never hold it, a template name
# and a note slug are kept from holding it
NAME_SEPARATOR = '--'
META_MEMBER = 'service-backup.yaml'
DATA_MEMBER_DIR = 'data'
TEMP_PREFIX = '.tmp-'
NOTE_SLUG_LENGTH_MAX = 40
REGEX_TIME = re.compile(r'^\d{8}_\d{8}[+-]\d{2}$')
REGEX_SLUG = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')

BACKUP_SCHEMA = {
    'type': 'object',
    'properties': {
        'versionId': {'type': 'string'},
        'fileName': {'type': 'string'},
        'file': {'type': 'string'},
        'consumerServiceId': {'type': 'string'},
        'templateName': {'type': 'string'},
        'time': {'type': 'string'},
        'note': {'type': 'string'},
        'size': {'type': 'integer'},
        'entryCount': {'type': 'integer'},
    },
}


class LocalBackup(Service):
    expose = {
        'meta': {
            'label': 'Local backup',
            'description': 'Backups of every consumer instance as zip files in one local folder, listed from the folder alone.',
            'author': 'react-doc',
            'version': '1.0.0',
            'license': 'MIT',
            'icon': 'icon.svg',
            'tagList': ['infra', 'storage', 'backup', 'built-in'],
        },
        'infra': {
            'name': 'local-backup',
            'storage': {
                'type': 'backup-zip',
                'versioning': 'linear',
                'operationList': ['versionCreate', 'versionList', 'checkout', 'versionDelete', 'export'],
                'description': 'one zip file per backup in a local folder; a version is a backup, named by its file',
            },
        },
        'configDefineList': [
            {'key': 'backupDir', 'type': 'string', 'default': '',
             'description': "the backup folder: '' for .doc-page/service-backup/ of the doc page the instance belongs to; "
                            'a path, relative to the instance folder'},
            {'key': 'versionKeepMax', 'type': 'integer', 'default': 0,
             'description': 'the oldest backups of a consumer beyond this many are removed when one is created (0: keep all)'},
        ],
        'dashboardList': [
            {'id': 'default', 'purpose': 'default', 'label': 'Backups', 'export': 'LocalBackupDashboard',
             'description': 'the backup folder, its consumers (active and not found) and their backups, deleted from here', 'heightMin': '10rem'},
            {'id': 'config', 'purpose': 'config', 'label': 'Backup folder', 'export': 'LocalBackupConfigDashboard',
             'description': 'the folder and the config of the instance, then the backups', 'heightMin': '10rem'},
        ],
        'dashboardRemote': {
            'dir': 'dashboard/dist',
            'entry': 'remoteEntry.js',
            'container': 'serviceLocalBackup',
            'module': './dashboard',
        },
        # the backups as objects of the object registry (doc_page_impl_obj.md): one
        # per zip file, related to the consumer instance it is a backup of
        'typeList': [
            {'id': 'local-backup.backup', 'label': 'Backup', 'extendList': ['core.file'], 'icon': 'archive',
             'summaryKeyList': ['size', 'time', 'consumerServiceId'],
             'description': 'a backup of a consumer instance: one zip file of the backup folder'},
            {'id': 'local-backup.backupOf', 'kind': 'relation', 'label': 'Backup of', 'extendList': ['core.reference'], 'icon': 'archive',
             'description': 'from a backup to the consumer instance it was made of (an instance that may be gone)'},
        ],
        'objectProvide': {
            'typeList': ['local-backup.backup'],
            'relationTypeList': ['local-backup.backupOf'],
            'cacheSecond': 15,
        },
    }

    def start(self):
        self.backup_dir, self.is_backup_dir_default = self._backup_dir_resolve()
        try:
            os.makedirs(self.backup_dir, exist_ok=True)
        except OSError as error:
            raise RuntimeError(f'the backup folder cannot be made: {self.backup_dir}: {error}')
        # the metadata read from a zip, by file name, valid while the file's size and mtime are the same
        self.meta_cache_by_name = {}

    # ---------- the storage operations: the calling consumer's own backups ----------

    @api(kind='command', description='a backup of the consumer: the files and folders of pathList zipped into one file of the '
                                     'backup folder, with a note. the consumer instance must exist (it is recorded in the backup)',
         params=[
             param('pathList', 'array', 'the files and folders to keep (absolute paths); a folder with everything in it'),
             param('note', 'string', 'what the backup is; its slug ends the file name', default=''),
             param('meta', 'object', "the consumer's own metadata, kept in the backup as given", default=None),
             param('consumerServiceId', 'string', 'the page only: the consumer whose backup', default=''),
         ],
         result=returns('object', 'the backup', schema=BACKUP_SCHEMA))
    def versionCreate(self, pathList, note='', meta=None, consumerServiceId=''):
        consumer = self._consumer_get(consumerServiceId)
        consumer_info = self._consumer_instance_get(consumer)
        if consumer_info is None:
            raise ServiceError(-3, f'the consumer instance {consumer} is not found: a backup is made for an instance that exists')
        path_list = self._path_list_check(pathList)
        note = str(note or '').strip()
        if meta is not None and not isinstance(meta, dict):
            raise ServiceError(-1, 'meta must be a mapping')
        template_name = (consumer_info.get('template') or {}).get('name') or 'service'
        file_name = self._file_name_new(consumer, template_name, note)
        file_path = os.path.join(self.backup_dir, file_name)
        path_temp = os.path.join(self.backup_dir, TEMP_PREFIX + file_name)
        version_id = file_name[:-len(BACKUP_FILE_EXT)]
        caller = self.context.caller
        metadata = {
            'versionId': version_id,
            'consumerServiceId': consumer,
            'consumerName': consumer_info.get('name', ''),
            'consumerKind': consumer_info.get('kind', ''),
            'template': consumer_info.get('template') or {},
            'time': version_id.split(NAME_SEPARATOR)[2],
            'note': note,
            'caller': caller.principal_get() if caller is not None else {'kind': 'kernel', 'id': ''},
            'entryList': [],
            'meta': meta or {},
        }
        try:
            with zipfile.ZipFile(path_temp, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                metadata['entryList'] = self._zip_write_entries(zip_file, path_list)
                zip_file.writestr(META_MEMBER, yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False))
            os.replace(path_temp, file_path)
        except (OSError, zipfile.BadZipFile, ServiceError) as error:
            if os.path.exists(path_temp):
                os.remove(path_temp)
            if isinstance(error, ServiceError):
                raise
            raise ServiceError(-1, f'the backup could not be written: {error}')
        self._prune(consumer)
        self.context.log('info', 'backup', f'backup {file_name} of {consumer} made',
                         {'consumerServiceId': consumer, 'versionId': version_id, 'note': note, 'entryCount': len(metadata['entryList'])})
        return self._record_get(file_name)

    @api(kind='query', description="the backups of the consumer, oldest first, read from the folder",
         params=[param('consumerServiceId', 'string', 'the page only: the consumer whose backups', default='')],
         result=returns('array', 'the backups', schema={'items': BACKUP_SCHEMA}))
    def versionList(self, consumerServiceId=''):
        consumer = self._consumer_get(consumerServiceId)
        return [self._record_get(entry['fileName']) for entry in self._folder_scan()['entryList'] if entry['consumerServiceId'] == consumer]

    @api(kind='query', description='one backup with everything its metadata holds: the consumer as it was, its entries, its meta',
         params=[
             param('versionId', 'string', 'the backup: the name of its file without .zip'),
             param('consumerServiceId', 'string', 'the page only: the consumer whose backup', default=''),
         ],
         result=returns('object', 'the backup, with entryList [{ path, size }], consumerName, template, caller, meta'))
    def versionGet(self, versionId, consumerServiceId=''):
        consumer = self._consumer_get(consumerServiceId)
        file_name = self._file_name_of_version(consumer, versionId)
        return {**self._record_get(file_name), **self._meta_read(file_name)}

    @api(kind='command', description="the backup extracted into dirTarget: its files and folders as they were given, "
                                     'under the names they had. the folder is created; files there are replaced. the consumer '
                                     'then does what it needs with them (hands a database back to its storage infra)',
         params=[
             param('versionId', 'string', 'the backup'),
             param('dirTarget', 'string', 'the folder to extract into (absolute)'),
             param('consumerServiceId', 'string', 'the page only: the consumer whose backup', default=''),
         ],
         result=returns('object', '{ versionId, dirTarget, entryList: [{ path, size }] }'))
    def checkout(self, versionId, dirTarget, consumerServiceId=''):
        consumer = self._consumer_get(consumerServiceId)
        file_name = self._file_name_of_version(consumer, versionId)
        dir_target = str(dirTarget or '')
        if not os.path.isabs(dir_target):
            raise ServiceError(-1, 'dirTarget must be an absolute path')
        entry_list = self._zip_extract(os.path.join(self.backup_dir, file_name), dir_target)
        self.context.log('info', 'backup', f'backup {file_name} of {consumer} checked out into {dir_target}',
                         {'consumerServiceId': consumer, 'versionId': versionId, 'entryCount': len(entry_list)})
        return {'versionId': versionId, 'dirTarget': dir_target, 'entryList': entry_list}

    @api(kind='command', description='removes a backup',
         params=[
             param('versionId', 'string', 'the backup'),
             param('consumerServiceId', 'string', 'the page only: the consumer whose backup', default=''),
         ],
         result=returns('null'))
    def versionDelete(self, versionId, consumerServiceId=''):
        consumer = self._consumer_get(consumerServiceId)
        file_name = self._file_name_of_version(consumer, versionId)
        self._file_delete(file_name)
        self.context.log('info', 'backup', f'backup {file_name} of {consumer} removed', {'consumerServiceId': consumer, 'versionId': versionId})
        return None

    @api(kind='query', description='the path of the zip file of a backup, for a copy by hand (storage operation export)',
         params=[
             param('versionId', 'string', 'the backup'),
             param('consumerServiceId', 'string', 'the page only: the consumer whose backup', default=''),
         ],
         result=returns('object', '{ file }'))
    def export(self, versionId, consumerServiceId=''):
        consumer = self._consumer_get(consumerServiceId)
        return {'file': os.path.join(self.backup_dir, self._file_name_of_version(consumer, versionId))}

    # ---------- the folder: for the Services tab and the dashboards ----------

    @api(kind='query', description='the backup folder: where it is, what it holds, and the names in it that are no backup',
         result=returns('object', '{ backupDir, isBackupDirDefault, isExisting, backupCount, sizeTotal, consumerCount, orphanCount, problemList }'),
         callerKindList=['page', 'kernel'])
    def folderInfo(self):
        scan = self._folder_scan()
        consumer_list = self._consumer_list_build(scan)
        return {
            'backupDir': self.backup_dir,
            'isBackupDirDefault': self.is_backup_dir_default,
            'isExisting': os.path.isdir(self.backup_dir),
            'backupCount': len(scan['entryList']),
            'sizeTotal': sum(entry['size'] for entry in scan['entryList']),
            'consumerCount': len(consumer_list),
            'orphanCount': sum(1 for consumer in consumer_list if not consumer['isInstanceFound']),
            'problemList': scan['problemList'],
        }

    @api(kind='query', description='the consumers that have backups in the folder, whether their instance is found (an orphan '
                                   'otherwise: deleted, or of another backend), with how many backups and how large',
         result=returns('array', '[{ consumerServiceId, templateName, isInstanceFound, instanceName, instanceStatus, instanceKind, '
                                 'backupCount, sizeTotal, timeLatest }]'),
         callerKindList=['page', 'kernel'])
    def consumerList(self):
        return self._consumer_list_build(self._folder_scan())

    @api(kind='command', description='removes every backup of a consumer, found or not',
         params=[param('consumerServiceId', 'string', 'the consumer')],
         result=returns('object', '{ deletedCount }'),
         callerKindList=['page', 'kernel'])
    def consumerDelete(self, consumerServiceId):
        consumer = str(consumerServiceId or '')
        if not REGEX_ID.match(consumer):
            raise ServiceError(-1, 'consumerServiceId names the consumer whose backups are removed')
        deleted_count = self._consumer_files_delete(consumer)
        self.context.log('info', 'backup', f'{deleted_count} backup(s) of {consumer} removed', {'consumerServiceId': consumer})
        return {'deletedCount': deleted_count}

    @api(kind='command', description='removes every orphan backup: those whose consumer instance is not found',
         result=returns('object', '{ deletedCount, consumerServiceIdList }'),
         callerKindList=['page', 'kernel'])
    def orphanDeleteAll(self):
        orphan_list = [consumer for consumer in self._consumer_list_build(self._folder_scan()) if not consumer['isInstanceFound']]
        deleted_count = 0
        for consumer in orphan_list:
            deleted_count += self._consumer_files_delete(consumer['consumerServiceId'])
        id_list = [consumer['consumerServiceId'] for consumer in orphan_list]
        self.context.log('info', 'backup', f'{deleted_count} orphan backup(s) of {len(id_list)} consumer(s) removed', {'consumerServiceIdList': id_list})
        return {'deletedCount': deleted_count, 'consumerServiceIdList': id_list}

    # ---------- the objects: the provider of the object registry ----------
    # local ids: 'backup/{versionId}' (the file name without .zip). read only:
    # a backup is made and removed by its consumer, or from the dashboards

    @api(kind='query', description='the backups as objects, every consumer, oldest first',
         params=[param('typeList', 'array', 'the Types asked for'), param('text', 'string', 'text the label contains', default=''),
                 param('filter', 'object', '{ consumerServiceId? }', default=None), param('limit', 'integer', 'how many at most', default=100)],
         result=returns('array', 'descriptors'), callerKindList=['kernel'])
    def objectQuery(self, typeList, text='', filter=None, limit=100):
        if not self.context.object_type_list_match(['local-backup.backup'], typeList):
            return []
        consumer = (filter or {}).get('consumerServiceId') or ''
        result = []
        for entry in self._folder_scan()['entryList']:
            if consumer and entry['consumerServiceId'] != consumer:
                continue
            descriptor = self._backup_descriptor_build(self._record_get(entry['fileName']))
            if text and text.lower() not in descriptor['label'].lower():
                continue
            result.append(descriptor)
        return result[:limit]

    @api(kind='query', description='how many backups objectQuery would answer (the preflight of a search): the names of the folder, no zip opened',
         params=[param('typeList', 'array', 'the Types asked for'), param('text', 'string', 'text the label contains', default=''),
                 param('filter', 'object', 'the filters', default=None)],
         result=returns('integer', 'how many'), callerKindList=['kernel'])
    def objectCount(self, typeList, text='', filter=None):
        if not self.context.object_type_list_match(['local-backup.backup'], typeList):
            return 0
        consumer = (filter or {}).get('consumerServiceId') or ''
        return len([entry for entry in self._folder_scan()['entryList']
                    if (not consumer or entry['consumerServiceId'] == consumer) and (not text or text.lower() in entry['fileName'].lower())])

    @api(kind='query', description='the descriptor of each local id, null for one that does not exist',
         params=[param('localIdList', 'array', 'the local ids')], result=returns('array', 'descriptors or null'), callerKindList=['kernel'])
    def objectResolve(self, localIdList):
        return [self._backup_descriptor_build(record) if record is not None else None
                for record in (self._backup_record_of_local_get(local_id) for local_id in localIdList)]

    @api(kind='query', description='{ descriptor, content: the backup and its metadata } of a backup',
         params=[param('localId', 'string', 'the local id')], result=returns('object', '{ descriptor, content }'), callerKindList=['kernel'])
    def objectRead(self, localId):
        record = self._backup_record_of_local_get(localId)
        if record is None:
            raise ServiceError(-3, f'{localId} is not a backup of the folder')
        return {'descriptor': self._backup_descriptor_build(record), 'content': {**record, **self._meta_read(record['fileName'])}}

    @api(kind='query', description='from every backup to the consumer instance it was made of',
         params=[param('fromRef', 'string', 'the object the relations start at', default=''),
                 param('toRef', 'string', 'the object they end at', default=''),
                 param('typeList', 'array', 'the relation Types asked for', default=None)],
         result=returns('array', 'relations'), callerKindList=['kernel'])
    def relationQuery(self, fromRef='', toRef='', typeList=None):
        if not self.context.object_type_list_match(['local-backup.backupOf'], typeList or ['core.relation']):
            return []
        return [{'key': f'backupOf/{entry["fileName"]}', 'type': 'local-backup.backupOf',
                 'fromLocalId': f'backup/{entry["fileName"][:-len(BACKUP_FILE_EXT)]}', 'toRef': f'service:{entry["consumerServiceId"]}'}
                for entry in self._folder_scan()['entryList']]

    def _backup_record_of_local_get(self, local_id):
        if not isinstance(local_id, str) or not local_id.startswith('backup/'):
            return None
        file_name = local_id[len('backup/'):] + BACKUP_FILE_EXT
        if file_name_parse(file_name) is None or not os.path.isfile(os.path.join(self.backup_dir, file_name)):
            return None
        return self._record_get(file_name)

    def _backup_descriptor_build(self, record):
        note = f' · {record["note"]}' if record.get('note') else ''
        return {'localId': f'backup/{record["versionId"]}', 'typeList': ['local-backup.backup'],
                'label': f'{record["templateName"]} {record["time"]}{note}',
                'description': f'a backup of {record["consumerServiceId"]}, {record["size"]} bytes',
                'summary': {'size': record['size'], 'time': record['time'], 'consumerServiceId': record['consumerServiceId'],
                            'consumerRef': f'service:{record["consumerServiceId"]}'},
                'capabilityList': ['read'], 'open': {'kind': 'serviceInstance', 'serviceId': self.context.service_id}}

    # ---------- the consumer ----------

    def _consumer_get(self, consumerServiceId=''):
        """The consumer a call is about: the calling service, which may name no
        other; for the page (or the kernel), the one it names."""
        caller = self.context.caller
        consumer_named = str(consumerServiceId or '')
        if caller is not None and caller.kind == 'service':
            if consumer_named and consumer_named != caller.service_id:
                raise ServiceError(-2, f'{caller.label_get()} reaches its own backups only, not those of {consumer_named}')
            return caller.service_id
        if not REGEX_ID.match(consumer_named):
            raise ServiceError(-1, 'consumerServiceId names the consumer instance whose backups the call is about')
        return consumer_named

    def _consumer_instance_get(self, consumer):
        """The consumer instance as the kernel lists it; None when there is none."""
        try:
            return self.context.service_resolve({'serviceId': consumer})
        except ServiceError:
            return None

    def _consumer_list_build(self, scan):
        by_consumer = {}
        for entry in scan['entryList']:
            consumer = by_consumer.setdefault(entry['consumerServiceId'], {
                'consumerServiceId': entry['consumerServiceId'],
                'templateName': entry['templateName'],
                'backupCount': 0,
                'sizeTotal': 0,
                'timeLatest': '',
            })
            consumer['backupCount'] += 1
            consumer['sizeTotal'] += entry['size']
            consumer['timeLatest'] = max(consumer['timeLatest'], entry['time'])
        result = []
        for consumer in by_consumer.values():
            instance = self._consumer_instance_get(consumer['consumerServiceId'])
            result.append({
                **consumer,
                'isInstanceFound': instance is not None,
                'instanceName': instance.get('name', '') if instance else '',
                'instanceStatus': instance.get('status', '') if instance else '',
                'instanceKind': instance.get('kind', '') if instance else '',
            })
        result.sort(key=lambda item: (not item['isInstanceFound'], item['instanceName'] or item['consumerServiceId']))
        return result

    # ---------- the folder ----------

    def _backup_dir_resolve(self):
        """(the backup folder, whether it is the default one)."""
        backup_dir = str(self.context.config.get('backupDir') or '').strip()
        if backup_dir:
            return (backup_dir if os.path.isabs(backup_dir) else self.context.path_get(backup_dir)), False
        meta_dir = self.context.doc_page_meta_dir_get()
        if meta_dir:
            return os.path.join(meta_dir, BACKUP_DIR_DEFAULT_NAME), True
        # an instance of a plain folder (no doc page): beside its own folder
        return os.path.join(os.path.dirname(self.context.dir_path), BACKUP_DIR_DEFAULT_NAME), True

    def _folder_scan(self):
        """What the folder holds now: the backups by their names, and the names
        that are no backup. { entryList: [{ fileName, consumerServiceId, templateName,
        time, slug, size }], problemList }."""
        entry_list = []
        problem_list = []
        if not os.path.isdir(self.backup_dir):
            return {'entryList': entry_list, 'problemList': [f'the backup folder does not exist: {self.backup_dir}']}
        for name in sorted(os.listdir(self.backup_dir)):
            if name.startswith('.'):
                continue
            file_path = os.path.join(self.backup_dir, name)
            if not os.path.isfile(file_path):
                problem_list.append(f'{name}: a folder; a backup is one zip file')
                continue
            parsed = file_name_parse(name)
            if parsed is None:
                problem_list.append(f'{name}: not named {{consumerServiceId}}--{{templateName}}--{{time}}[--{{note}}].zip')
                continue
            entry_list.append({**parsed, 'fileName': name, 'size': os.path.getsize(file_path)})
        entry_list.sort(key=lambda entry: (entry['consumerServiceId'], entry['time'], entry['fileName']))
        return {'entryList': entry_list, 'problemList': problem_list}

    def _file_name_of_version(self, consumer, version_id):
        """The file of a version of the consumer; -3 when there is none, or it is another consumer's."""
        version_id = str(version_id or '')
        parsed = file_name_parse(version_id + BACKUP_FILE_EXT)
        if parsed is None or parsed['consumerServiceId'] != consumer:
            raise ServiceError(-3, f'the backup {version_id} is not one of {consumer}')
        file_name = version_id + BACKUP_FILE_EXT
        if not os.path.isfile(os.path.join(self.backup_dir, file_name)):
            raise ServiceError(-3, f'the backup {version_id} is not found')
        return file_name

    def _file_name_new(self, consumer, template_name, note):
        """A name no file of the folder has: the time moves on until it is free."""
        slug = note_slug_build(note)
        while True:
            parts = [consumer, template_name, time_text_get()] + ([slug] if slug else [])
            file_name = NAME_SEPARATOR.join(parts) + BACKUP_FILE_EXT
            if not os.path.exists(os.path.join(self.backup_dir, file_name)):
                return file_name
            time.sleep(0.01)

    def _record_get(self, file_name):
        """A backup as listed: what its name says, its size, and the note of its metadata."""
        parsed = file_name_parse(file_name)
        file_path = os.path.join(self.backup_dir, file_name)
        meta = self._meta_read(file_name)
        return {
            'versionId': file_name[:-len(BACKUP_FILE_EXT)],
            'fileName': file_name,
            'file': file_path,
            'consumerServiceId': parsed['consumerServiceId'],
            'templateName': parsed['templateName'],
            'time': parsed['time'],
            'note': meta.get('note', parsed['slug']),
            'size': os.path.getsize(file_path) if os.path.isfile(file_path) else 0,
            'entryCount': len(meta.get('entryList') or []),
        }

    def _meta_read(self, file_name):
        """The metadata member of a backup; from its name alone when the zip has none
        (a zip dropped in the folder by hand, under the right name)."""
        file_path = os.path.join(self.backup_dir, file_name)
        try:
            stat = os.stat(file_path)
        except OSError:
            return {}
        cache_key = (stat.st_size, stat.st_mtime)
        cached = self.meta_cache_by_name.get(file_name)
        if cached is not None and cached[0] == cache_key:
            return cached[1]
        parsed = file_name_parse(file_name) or {}
        meta = {'note': parsed.get('slug', ''), 'entryList': [], 'meta': {}, 'isMetaFound': False}
        try:
            with zipfile.ZipFile(file_path) as zip_file:
                if META_MEMBER in zip_file.namelist():
                    raw = yaml.safe_load(zip_file.read(META_MEMBER).decode('utf-8'))
                    if isinstance(raw, dict):
                        meta = {**raw, 'isMetaFound': True}
                else:
                    meta['entryList'] = [{'path': info.filename[len(DATA_MEMBER_DIR) + 1:], 'size': info.file_size}
                                         for info in zip_file.infolist()
                                         if info.filename.startswith(DATA_MEMBER_DIR + '/') and not info.is_dir()]
        except (OSError, zipfile.BadZipFile):
            meta['isMetaFound'] = False
        self.meta_cache_by_name[file_name] = (cache_key, meta)
        return meta

    def _file_delete(self, file_name):
        file_path = os.path.join(self.backup_dir, file_name)
        try:
            os.remove(file_path)
        except OSError as error:
            raise ServiceError(-1, f'the backup {file_name} could not be removed: {error}')
        self.meta_cache_by_name.pop(file_name, None)

    def _consumer_files_delete(self, consumer):
        deleted_count = 0
        for entry in self._folder_scan()['entryList']:
            if entry['consumerServiceId'] == consumer:
                self._file_delete(entry['fileName'])
                deleted_count += 1
        return deleted_count

    def _prune(self, consumer):
        keep_max = int(self.context.config.get('versionKeepMax') or 0)
        if keep_max <= 0:
            return
        entry_list = [entry for entry in self._folder_scan()['entryList'] if entry['consumerServiceId'] == consumer]
        for entry in entry_list[:max(0, len(entry_list) - keep_max)]:
            self._file_delete(entry['fileName'])

    # ---------- the zip ----------

    def _path_list_check(self, path_list):
        if not isinstance(path_list, list) or len(path_list) == 0:
            raise ServiceError(-1, 'pathList is a list of the files and folders to keep')
        result = []
        for path in path_list:
            path = str(path or '')
            if not os.path.isabs(path):
                raise ServiceError(-1, f'every path of pathList is absolute: {path}')
            if not os.path.exists(path):
                raise ServiceError(-3, f'the path is not found: {path}')
            result.append(os.path.normpath(path))
        return result

    def _zip_write_entries(self, zip_file, path_list):
        """The files and folders written under data/, each by its own name; the entries written."""
        entry_list = []
        name_set = set()
        for path in path_list:
            name = os.path.basename(path)
            if name in name_set:
                raise ServiceError(-1, f'two entries of pathList have the same name: {name}')
            name_set.add(name)
            if os.path.isfile(path):
                arc_name = f'{DATA_MEMBER_DIR}/{name}'
                zip_file.write(path, arc_name)
                entry_list.append({'path': name, 'size': os.path.getsize(path)})
                continue
            for dir_path, dir_name_list, file_name_list in os.walk(path):
                dir_name_list.sort()
                relative = os.path.relpath(dir_path, path)
                arc_dir = f'{DATA_MEMBER_DIR}/{name}' + ('' if relative == '.' else '/' + relative.replace(os.sep, '/'))
                zip_file.writestr(zipfile.ZipInfo(arc_dir + '/'), '')
                for file_name in sorted(file_name_list):
                    file_path = os.path.join(dir_path, file_name)
                    if not os.path.isfile(file_path):
                        continue
                    zip_file.write(file_path, f'{arc_dir}/{file_name}')
                    entry_list.append({'path': f'{arc_dir}/{file_name}'[len(DATA_MEMBER_DIR) + 1:], 'size': os.path.getsize(file_path)})
        return entry_list

    def _zip_extract(self, file_path, dir_target):
        """The data/ members extracted into dir_target; a member naming a path outside it is refused."""
        entry_list = []
        try:
            with zipfile.ZipFile(file_path) as zip_file:
                os.makedirs(dir_target, exist_ok=True)
                dir_target_real = os.path.realpath(dir_target)
                for info in zip_file.infolist():
                    if not info.filename.startswith(DATA_MEMBER_DIR + '/'):
                        continue
                    relative = info.filename[len(DATA_MEMBER_DIR) + 1:]
                    if relative == '':
                        continue
                    target_path = os.path.realpath(os.path.join(dir_target, relative))
                    if target_path != dir_target_real and not target_path.startswith(dir_target_real + os.sep):
                        raise ServiceError(-1, f'the backup holds a path outside the target folder: {info.filename}')
                    if info.is_dir():
                        os.makedirs(target_path, exist_ok=True)
                        continue
                    os.makedirs(os.path.dirname(target_path), exist_ok=True)
                    with zip_file.open(info) as source, open(target_path, 'wb') as target:
                        while True:
                            chunk = source.read(1 << 20)
                            if not chunk:
                                break
                            target.write(chunk)
                    entry_list.append({'path': relative.rstrip('/'), 'size': info.file_size})
        except (OSError, zipfile.BadZipFile) as error:
            raise ServiceError(-1, f'the backup could not be extracted: {error}')
        return entry_list


# ---------- the name of a backup file ----------

def note_slug_build(note):
    """The part of the file name a note becomes: lowercase words joined by single
    dashes (never --, the separator), at most NOTE_SLUG_LENGTH_MAX characters; ''
    for a note with no letter or digit."""
    slug = re.sub(r'[^a-z0-9]+', '-', str(note or '').lower()).strip('-')
    if len(slug) > NOTE_SLUG_LENGTH_MAX:
        slug = slug[:NOTE_SLUG_LENGTH_MAX].rstrip('-')
    return slug


def file_name_parse(file_name):
    """{ consumerServiceId, templateName, time, slug } of a backup file name, or
    None when it is not {id}--{templateName}--{time}[--{slug}].zip."""
    if not file_name.endswith(BACKUP_FILE_EXT):
        return None
    part_list = file_name[:-len(BACKUP_FILE_EXT)].split(NAME_SEPARATOR)
    if len(part_list) not in (3, 4):
        return None
    consumer, template_name, time_text = part_list[:3]
    slug = part_list[3] if len(part_list) == 4 else ''
    if not REGEX_ID.match(consumer) or not REGEX_TEMPLATE_NAME.match(template_name) or not REGEX_TIME.match(time_text):
        return None
    if slug and not REGEX_SLUG.match(slug):
        return None
    return {'consumerServiceId': consumer, 'templateName': template_name, 'time': time_text, 'slug': slug}


SERVICE_CLASS = LocalBackup
