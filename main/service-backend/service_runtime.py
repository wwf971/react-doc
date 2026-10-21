"""The service runtime: finds the templates and the instances, creates instances, runs the apis.

Design: doc_page_impl_service_instance.md#backend

- a template is a folder {templateFolder}/{templateId}--{name}/ holding
  service-template.yaml and service.py (with its icon and dashboards): the
  initial state of a service. it is listed, never run
- an instance is a folder {instanceFolder}/{templateName}-inst-{serviceId}/
  holding service.yaml, its own copy of everything its template held when
  it was created, and its data. it runs its own service.py; the template is
  recorded in service.yaml and never read again
- every running instance has one worker thread and one queue: its apis run
  one at a time, in the order they came; a call waits behind the ones before
- scan() is cheap and runs on every listing, so a folder added, removed or
  edited by hand is seen without a restart; an instance whose service.yaml
  or whose service.py changed is restarted
"""

import importlib.util
import json
import os
import queue
import shutil
import sys
import threading
import time
import traceback

from service_define import (
    Service,
    ServiceContext,
    ServiceDefineError,
    ServiceError,
    api_param_dict_build,
    dashboard_remote_build_get,
    expose_build,
    value_type_is,
)
from service_util import (
    REGEX_ID,
    id_ms48_create,
    instance_dir_name_build,
    instance_dir_name_split,
    instance_name_normalize,
    template_dir_name_split,
    time_text_get,
    yaml_read,
    yaml_write,
)

SERVICE_SCRIPT_FILE = 'service.py'
SERVICE_CONFIG_FILE = 'service.yaml'
TEMPLATE_CONFIG_FILE = 'service-template.yaml'

# the keys of service.yaml and of service-template.yaml, in the order they are written
SERVICE_CONFIG_KEY_LIST = ['serviceId', 'name', 'description', 'isEnabled', 'timeCreated', 'template', 'config']
TEMPLATE_CONFIG_KEY_LIST = ['templateId', 'name', 'description', 'timeCreated', 'versionId', 'versionList', 'config']

# what creating an instance does not copy from its template folder: the
# template's own file (the instance gets service.yaml instead) and what is
# installed or generated rather than written (dependencies, bytecode)
INSTANCE_COPY_IGNORE_NAME_LIST = [TEMPLATE_CONFIG_FILE, 'node_modules', '__pycache__']

# the folder an instance is copied into before it is renamed to its own
# name; the scan skips names starting with a dot
INSTANCE_CREATING_PREFIX = '.creating-'

# how many finished jobs an instance keeps for GET /job/get
JOB_DONE_KEEP_MAX = 50

# ready: apis are answered. starting: start() is running (calls wait in the
# queue). disabled: isEnabled is false. error: the folder, the config, the
# script or start() failed; message says why
INSTANCE_STATUS_LIST = ['ready', 'starting', 'disabled', 'error']


class ServiceScript:
    """The service.py of one folder, a template's or an instance's, as last loaded.

    Every folder loads its own file into a module of its own, so two
    instances never share code objects or module-level state, even when
    their files are the same.
    """

    def __init__(self, dir_path, label, module_key):
        self.dir_path = dir_path
        self.label = label
        self.module_key = module_key
        self.file_path = os.path.join(dir_path, SERVICE_SCRIPT_FILE)
        self.mtime = None
        # increased on every load, so an instance knows its script changed
        self.load_count = 0
        self.status = 'error'
        self.message = ''
        self.service_class = None
        self.expose = None

    def load_if_changed(self):
        mtime = os.path.getmtime(self.file_path) if os.path.isfile(self.file_path) else None
        if self.load_count > 0 and mtime == self.mtime:
            return
        self.mtime = mtime
        self.load_count += 1
        self.service_class = None
        self.expose = None
        if mtime is None:
            self.status = 'error'
            self.message = f'{self.label} has no {SERVICE_SCRIPT_FILE}'
            return
        try:
            module_name = f'service_script__{self.module_key}__{self.load_count}'
            spec = importlib.util.spec_from_file_location(module_name, self.file_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            service_class = getattr(module, 'SERVICE_CLASS', None)
            if not (isinstance(service_class, type) and issubclass(service_class, Service)):
                raise ServiceDefineError(f'{self.label}: {SERVICE_SCRIPT_FILE} must set SERVICE_CLASS to a Service class')
            self.expose = expose_build(service_class, self.label, self.dir_path)
            self.service_class = service_class
            self.status = 'ready'
            self.message = ''
        except Exception as error:
            self.status = 'error'
            self.message = f'{type(error).__name__}: {error}'
            print(f'[service] {self.label}: {SERVICE_SCRIPT_FILE} failed to load: {self.message}', file=sys.stderr)

    def dashboard_build_get(self):
        if self.expose is None:
            return None
        return dashboard_remote_build_get(self.dir_path, self.expose['dashboardRemote'])


class ServiceTemplate:
    """A template folder: the initial state of a service, as last read. Never run."""

    def __init__(self, template_id, name, dir_path, folder, dir_name):
        self.template_id = template_id
        self.name = name
        self.dir_path = dir_path
        self.folder = folder
        self.dir_name = dir_name
        self.config_path = os.path.join(dir_path, TEMPLATE_CONFIG_FILE)
        self.config_mtime = None
        # service-template.yaml as read and checked; {} when it cannot be used
        self.template_config = {}
        # why service-template.yaml cannot be used ('' when it can)
        self.config_message = ''
        self.script = ServiceScript(dir_path, f'template {name}', f'template_{template_id}')
        self.status = 'error'
        self.message = ''

    def refresh(self):
        self.script.load_if_changed()
        config_mtime = os.path.getmtime(self.config_path) if os.path.isfile(self.config_path) else None
        if config_mtime != self.config_mtime or self.template_config == {}:
            self.config_mtime = config_mtime
            try:
                self.template_config = self._config_read()
                self.config_message = ''
            except ValueError as error:
                self.template_config = {}
                self.config_message = str(error)
        self.status = 'error'
        if self.config_message:
            self.message = self.config_message
            return
        if self.script.status != 'ready':
            self.message = self.script.message
            return
        try:
            config_normalize(self.template_config['config'], self.script.expose)
        except ValueError as error:
            self.message = f'config in {TEMPLATE_CONFIG_FILE}: {error}'
            return
        self.status = 'ready'
        self.message = ''

    def _config_read(self):
        """service-template.yaml, checked; raises ValueError with the reason."""
        if not os.path.isfile(self.config_path):
            raise ValueError(f'{self.dir_name} has no {TEMPLATE_CONFIG_FILE}')
        try:
            raw = yaml_read(self.config_path)
        except Exception as error:
            raise ValueError(f'{TEMPLATE_CONFIG_FILE} is not valid yaml: {error}')
        if not isinstance(raw, dict):
            raise ValueError(f'{TEMPLATE_CONFIG_FILE} must be a mapping')
        if str(raw.get('templateId', '')) != self.template_id:
            raise ValueError(f'templateId in {TEMPLATE_CONFIG_FILE} must be the id of the folder name ({self.template_id})')
        if raw.get('name') != self.name:
            raise ValueError(f'name in {TEMPLATE_CONFIG_FILE} must be the name of the folder name ({self.name})')
        version_id = str(raw.get('versionId') or '')
        if not REGEX_ID.match(version_id):
            raise ValueError(f'{TEMPLATE_CONFIG_FILE} needs versionId, an id (lowercase letters and digits)')
        version_list = raw.get('versionList') or []
        if not isinstance(version_list, list) or not all(isinstance(item, dict) and REGEX_ID.match(str(item.get('versionId') or '')) for item in version_list):
            raise ValueError(f'versionList in {TEMPLATE_CONFIG_FILE} must be a list of {{ versionId, time, note }}')
        config = raw.get('config') or {}
        if not isinstance(config, dict):
            raise ValueError(f'config in {TEMPLATE_CONFIG_FILE} must be a mapping')
        return {
            'templateId': self.template_id,
            'name': self.name,
            'description': str(raw.get('description') or ''),
            'timeCreated': str(raw.get('timeCreated') or ''),
            'versionId': version_id,
            'versionList': [
                {'versionId': str(item['versionId']), 'time': str(item.get('time') or ''), 'note': str(item.get('note') or '')}
                for item in version_list
            ],
            'config': config,
        }

    def record_get(self):
        """What an instance created now records of its template."""
        return {'templateId': self.template_id, 'name': self.name, 'versionId': self.template_config['versionId']}

    def info_get(self):
        template_config = self.template_config
        return {
            'templateId': self.template_id,
            'name': self.name,
            'description': template_config.get('description', ''),
            'timeCreated': template_config.get('timeCreated', ''),
            'versionId': template_config.get('versionId', ''),
            'versionList': template_config.get('versionList', []),
            'config': template_config.get('config', {}),
            'status': self.status,
            'message': self.message,
            'folder': self.folder,
            'dirName': self.dir_name,
            'expose': self.script.expose,
            'dashboardBuild': self.script.dashboard_build_get(),
        }


class ServiceTask:
    """One api call waiting in, or taken from, an instance's queue."""

    def __init__(self, api_define, param_dict, job_id=''):
        self.api_define = api_define
        self.param_dict = param_dict
        # '' for a sync call; the job id of an async one
        self.job_id = job_id
        self.status = 'queued'
        self.progress = 0.0
        self.progress_message = ''
        self.time_queued = time_text_get()
        self.time_started = ''
        self.time_done = ''
        self.result = None
        self.done_event = threading.Event()

    def finish(self, result):
        self.result = result
        self.status = 'done'
        self.time_done = time_text_get()
        self.done_event.set()

    def job_info_get(self):
        return {
            'jobId': self.job_id,
            'api': self.api_define['name'],
            'status': self.status,
            'progress': self.progress,
            'progressMessage': self.progress_message,
            'timeQueued': self.time_queued,
            'timeStarted': self.time_started,
            'timeDone': self.time_done,
            'result': self.result,
        }


class ServiceInstance:
    """An instance folder, and, when it runs, its worker thread and queue."""

    def __init__(self, service_id, dir_path, folder, dir_name, script):
        self.service_id = service_id
        self.dir_path = dir_path
        self.folder = folder
        self.dir_name = dir_name
        self.config_path = os.path.join(dir_path, SERVICE_CONFIG_FILE)
        self.service_config = {}
        # the instance's own service.py; kept by the runtime across restarts
        self.script = script
        # the exposure the instance was started with: the apis it answers
        self.expose = None
        # what the instance was started from: a change restarts it
        self.signature = None
        self.status = 'error'
        self.message = ''
        self.task_queue = queue.Queue()
        self.task_running = None
        self.job_by_id = {}
        self.job_done_id_list = []
        self.lock = threading.Lock()
        self.thread = None

    # ---------- start / stop ----------

    def start(self, service_config):
        self.service_config = service_config
        self.expose = self.script.expose
        if not service_config['isEnabled']:
            self.status = 'disabled'
            self.message = f'isEnabled is false in {SERVICE_CONFIG_FILE}'
            return
        self.status = 'starting'
        self.message = ''
        context = ServiceContext(
            service_id=self.service_id,
            name=service_config['name'],
            dir_path=self.dir_path,
            template=service_config['template'],
            config=service_config['config'],
        )
        self.thread = threading.Thread(
            target=self._worker_run,
            args=(self.script.service_class, context),
            name=f'service-{self.service_id}',
            daemon=True,
        )
        self.thread.start()

    def error_set(self, message, service_config=None):
        self.status = 'error'
        self.message = message
        if service_config is not None:
            self.service_config = service_config
        self.expose = self.script.expose

    def stop(self):
        """Lets the call being run finish, refuses the ones waiting, then stops."""
        if self.thread is None:
            return
        self.task_queue.put(None)

    def _worker_run(self, service_class, context):
        implementation = None
        try:
            implementation = service_class(context)
            implementation.start()
            self.status = 'ready'
        except Exception as error:
            self.status = 'error'
            self.message = f'start failed: {type(error).__name__}: {error}'
            traceback.print_exc()
        while True:
            task = self.task_queue.get()
            if task is None:
                break
            if self.status != 'ready':
                task.finish({'code': -4, 'message': f'the service {self.service_id} is not ready: {self.message}'})
                self._job_done(task)
                continue
            self._task_run(implementation, context, task)
        while not self.task_queue.empty():
            task = self.task_queue.get()
            if task is not None:
                task.finish({'code': -4, 'message': f'the service {self.service_id} stopped'})
                self._job_done(task)
        if implementation is not None and self.status == 'ready':
            try:
                implementation.stop()
            except Exception:
                traceback.print_exc()

    def _task_run(self, implementation, context, task):
        api_name = task.api_define['name']
        task.status = 'running'
        task.time_started = time_text_get()
        self.task_running = task
        context.job_current = task if task.job_id else None
        try:
            data = getattr(implementation, api_name)(**task.param_dict)
            # a result the page cannot read is a failure of the api, not of the transport
            json.dumps(data)
            result = {'code': 0, 'data': data}
        except ServiceError as error:
            result = {'code': error.code, 'message': error.message}
        except Exception as error:
            traceback.print_exc()
            result = {'code': -1, 'message': f'{api_name} failed: {type(error).__name__}: {error}'}
        context.job_current = None
        self.task_running = None
        task.progress = 1.0
        task.finish(result)
        self._job_done(task)

    # ---------- calls ----------

    def submit(self, task):
        if task.job_id:
            with self.lock:
                self.job_by_id[task.job_id] = task
        self.task_queue.put(task)

    def _job_done(self, task):
        if not task.job_id:
            return
        with self.lock:
            self.job_done_id_list.append(task.job_id)
            while len(self.job_done_id_list) > JOB_DONE_KEEP_MAX:
                self.job_by_id.pop(self.job_done_id_list.pop(0), None)

    def job_get(self, job_id):
        with self.lock:
            return self.job_by_id.get(job_id)

    def job_id_is_used(self, job_id):
        with self.lock:
            return job_id in self.job_by_id

    def info_get(self):
        service_config = self.service_config
        task_running = self.task_running
        return {
            'serviceId': self.service_id,
            'name': service_config.get('name', ''),
            'description': service_config.get('description', ''),
            'isEnabled': service_config.get('isEnabled', True),
            'timeCreated': service_config.get('timeCreated', ''),
            'template': service_config.get('template', None),
            'config': service_config.get('config', {}),
            'status': self.status,
            'message': self.message,
            'folder': self.folder,
            'dirName': self.dir_name,
            'expose': self.expose,
            'dashboardBuild': self.script.dashboard_build_get(),
            # the calls waiting behind the one being run
            'queueLength': self.task_queue.qsize(),
            'apiRunning': task_running.api_define['name'] if task_running is not None else '',
        }


def config_normalize(config, expose):
    """The config with the defaults of configDefineList; keys it does not declare
    are kept. Raises ValueError for a key of the wrong type."""
    result = dict(config)
    for define in expose['configDefineList']:
        key = define['key']
        if key not in result or result[key] is None:
            result[key] = define['default']
            continue
        if not value_type_is(result[key], define['type']):
            raise ValueError(f'config.{key} must be of type {define["type"]}')
    return result


def instance_copy_ignore(_dir_path, name_list):
    return [name for name in name_list if name in INSTANCE_COPY_IGNORE_NAME_LIST or name.startswith('.tmp-')]


class ServiceRuntime:
    """The templates and instances of one backend config file."""

    def __init__(self, config_path):
        self.config_path = os.path.abspath(config_path)
        self.base_dir = os.path.dirname(self.config_path)
        config = yaml_read(self.config_path) or {}
        self.host = str(config.get('host', '127.0.0.1'))
        self.port = int(config.get('port', 45190))
        self.api_wait_second_max = float(config.get('apiWaitSecondMax', 120))
        self.template_folder_list = self._folder_list_read(config.get('templateFolderList'), 'templateFolderList')
        self.instance_folder_list = self._folder_list_read(config.get('instanceFolderList'), 'instanceFolderList')
        if len(self.instance_folder_list) > 0 and not any(folder['isDefault'] for folder in self.instance_folder_list):
            self.instance_folder_list[0]['isDefault'] = True
        self.template_by_id = {}
        self.instance_by_id = {}
        # the script of every instance folder, kept across restarts of the
        # instance, so a restart reloads it only when the file changed
        self.instance_script_by_id = {}
        # problems of the scan that belong to no template or instance (a
        # folder whose name has not the form, two folders of one id)
        self.scan_problem_list = []
        self.time_started = time_text_get()
        self.lock = threading.RLock()

    def _folder_list_read(self, folder_list, key):
        if folder_list is None:
            return []
        if not isinstance(folder_list, list):
            raise ValueError(f'{self.config_path}: {key} must be a list')
        result = []
        for item in folder_list:
            if isinstance(item, str):
                item = {'path': item}
            if not isinstance(item, dict) or not isinstance(item.get('path'), str):
                raise ValueError(f'{self.config_path}: every entry of {key} is a path or {{ path, isDefault }}')
            result.append({
                'path': item['path'],
                'pathAbs': os.path.normpath(os.path.join(self.base_dir, item['path'])),
                'isDefault': bool(item.get('isDefault', False)),
            })
        return result

    # ---------- scan ----------

    def scan(self):
        with self.lock:
            template_problem_list = self._template_scan()
            instance_problem_list = self._instance_scan()
            self.scan_problem_list = template_problem_list + instance_problem_list

    def _folder_entry_list(self, folder_list):
        """(dir_path, folder path, dir name) of every folder of the folders, dot names skipped."""
        result = []
        for folder in folder_list:
            if not os.path.isdir(folder['pathAbs']):
                continue
            for dir_name in sorted(os.listdir(folder['pathAbs'])):
                dir_path = os.path.join(folder['pathAbs'], dir_name)
                if os.path.isdir(dir_path) and not dir_name.startswith('.'):
                    result.append((dir_path, folder['path'], dir_name))
        return result

    def _template_scan(self):
        problem_list = []
        found_by_id = {}
        for dir_path, folder, dir_name in self._folder_entry_list(self.template_folder_list):
            split = template_dir_name_split(dir_name)
            if split is None:
                problem_list.append(f'{folder}/{dir_name}: a template folder is named {{templateId}}--{{name}}, the name in lowercase letters, digits, - and _')
                continue
            template_id, name = split
            if template_id in found_by_id:
                problem_list.append(f'{folder}/{dir_name}: the template id {template_id} is also the folder {found_by_id[template_id][2]}; the first is used')
                continue
            name_found = next((entry[3] for entry in found_by_id.values() if entry[3] == name), None)
            if name_found is not None:
                problem_list.append(f'{folder}/{dir_name}: the template name {name} is taken by another template folder; the first is used')
                continue
            found_by_id[template_id] = (dir_path, folder, dir_name, name)

        for template_id in list(self.template_by_id):
            if template_id not in found_by_id:
                del self.template_by_id[template_id]
        for template_id, (dir_path, folder, dir_name, name) in found_by_id.items():
            template = self.template_by_id.get(template_id)
            if template is None or template.dir_path != dir_path:
                template = ServiceTemplate(template_id, name, dir_path, folder, dir_name)
                self.template_by_id[template_id] = template
            template.refresh()
        return problem_list

    def _instance_scan(self):
        problem_list = []
        found_by_id = {}
        for dir_path, folder, dir_name in self._folder_entry_list(self.instance_folder_list):
            split = instance_dir_name_split(dir_name)
            if split is None:
                problem_list.append(f'{folder}/{dir_name}: an instance folder is named {{templateName}}-inst-{{serviceId}}')
                continue
            service_id = split[1]
            if service_id in found_by_id:
                problem_list.append(f'{folder}/{dir_name}: the service id {service_id} is also the folder {found_by_id[service_id][2]}; the first is used')
                continue
            found_by_id[service_id] = (dir_path, folder, dir_name)

        for service_id in list(self.instance_by_id):
            if service_id not in found_by_id:
                self.instance_by_id.pop(service_id).stop()
                self.instance_script_by_id.pop(service_id, None)
        for service_id, (dir_path, folder, dir_name) in found_by_id.items():
            self._instance_refresh(service_id, dir_path, folder, dir_name)
        return problem_list

    def _instance_refresh(self, service_id, dir_path, folder, dir_name):
        script = self.instance_script_by_id.get(service_id)
        if script is None or script.dir_path != dir_path:
            script = ServiceScript(dir_path, f'instance {dir_name}', f'instance_{service_id}')
            self.instance_script_by_id[service_id] = script
        script.load_if_changed()

        config_path = os.path.join(dir_path, SERVICE_CONFIG_FILE)
        config_mtime = os.path.getmtime(config_path) if os.path.isfile(config_path) else None
        service_config = None
        error_message = ''
        try:
            service_config = self._service_config_read(config_path, service_id, dir_name)
            if script.status != 'ready':
                error_message = script.message
            else:
                service_config['config'] = config_normalize(service_config['config'], script.expose)
        except ValueError as error:
            error_message = str(error)
        signature = (dir_path, config_mtime, script.load_count, error_message)

        instance = self.instance_by_id.get(service_id)
        if instance is not None and instance.signature == signature:
            return
        if instance is not None:
            instance.stop()
        instance = ServiceInstance(service_id, dir_path, folder, dir_name, script)
        instance.signature = signature
        self.instance_by_id[service_id] = instance
        if error_message:
            instance.error_set(error_message, service_config)
            return
        instance.start(service_config)

    def _service_config_read(self, config_path, service_id, dir_name):
        """service.yaml, checked; raises ValueError with the reason."""
        if not os.path.isfile(config_path):
            raise ValueError(f'{dir_name} has no {SERVICE_CONFIG_FILE}')
        try:
            raw = yaml_read(config_path)
        except Exception as error:
            raise ValueError(f'{SERVICE_CONFIG_FILE} is not valid yaml: {error}')
        if not isinstance(raw, dict):
            raise ValueError(f'{SERVICE_CONFIG_FILE} must be a mapping')
        if str(raw.get('serviceId', '')) != service_id:
            raise ValueError(f'serviceId in {SERVICE_CONFIG_FILE} must be the id of the folder name ({service_id})')
        try:
            name = instance_name_normalize(raw.get('name'))
        except ValueError as error:
            raise ValueError(f'name in {SERVICE_CONFIG_FILE}: {error}')
        template = raw.get('template')
        if not isinstance(template, dict) or not all(isinstance(template.get(key), str) and template[key] != '' for key in ['templateId', 'name', 'versionId']):
            raise ValueError(f'{SERVICE_CONFIG_FILE} needs template: {{ templateId, name, versionId }}, the template the instance was created from')
        config = raw.get('config') or {}
        if not isinstance(config, dict):
            raise ValueError(f'config in {SERVICE_CONFIG_FILE} must be a mapping')
        return {
            'serviceId': service_id,
            'name': name,
            'description': str(raw.get('description') or ''),
            'isEnabled': raw.get('isEnabled', True) is not False,
            'timeCreated': str(raw.get('timeCreated') or ''),
            'template': {key: template[key] for key in ['templateId', 'name', 'versionId']},
            'config': config,
        }

    # ---------- requests ----------

    def status_get(self):
        with self.lock:
            return {
                'timeStarted': self.time_started,
                'configPath': self.config_path,
                'templateFolderList': [{'path': item['path']} for item in self.template_folder_list],
                'instanceFolderList': [{'path': item['path'], 'isDefault': item['isDefault']} for item in self.instance_folder_list],
                'templateCount': len(self.template_by_id),
                'instanceCount': len(self.instance_by_id),
                'scanProblemList': list(self.scan_problem_list),
            }

    def template_list_get(self):
        self.scan()
        with self.lock:
            return [template.info_get() for template in self.template_by_id.values()]

    def template_get(self, template_id):
        with self.lock:
            template = self.template_by_id.get(template_id)
        if template is None:
            self.scan()
            with self.lock:
                template = self.template_by_id.get(template_id)
        if template is None:
            raise ServiceError(-3, f'the service template {template_id} is not found')
        return template

    def template_version_new(self, template_id, note):
        """A new version id of the template, recorded in its versionList. Instances
        created from now on record it; the instances created before keep theirs."""
        template = self.template_get(template_id)
        with self.lock:
            if template.config_message:
                raise ServiceError(-1, f'{TEMPLATE_CONFIG_FILE} of {template.name} cannot be used: {template.config_message}')
            template_config = dict(template.template_config)
            version_list = list(template_config['versionList'])
            if not any(item['versionId'] == template_config['versionId'] for item in version_list):
                version_list.append({'versionId': template_config['versionId'], 'time': template_config['timeCreated'], 'note': ''})
            version_id = id_ms48_create(lambda candidate: any(item['versionId'] == candidate for item in version_list))
            version_list.append({'versionId': version_id, 'time': time_text_get(), 'note': str(note or '').strip()})
            template_config['versionId'] = version_id
            template_config['versionList'] = version_list
            yaml_write(template.config_path, {key: template_config[key] for key in TEMPLATE_CONFIG_KEY_LIST})
            template.refresh()
            return template.info_get()

    def instance_list_get(self):
        self.scan()
        with self.lock:
            return [instance.info_get() for instance in self.instance_by_id.values()]

    def instance_get(self, service_id):
        with self.lock:
            instance = self.instance_by_id.get(service_id)
        if instance is None:
            self.scan()
            with self.lock:
                instance = self.instance_by_id.get(service_id)
        if instance is None:
            raise ServiceError(-3, f'the service instance {service_id} is not found')
        return instance

    def instance_create(self, template_id, name_input, description, config):
        """A new instance from a template: the template folder copied (but its own
        file and what is installed) into {templateName}-inst-{serviceId}, and a
        service.yaml recording the template, with the template's config under the
        config given."""
        try:
            name = instance_name_normalize(name_input)
        except ValueError as error:
            raise ServiceError(-1, str(error))
        if config is not None and not isinstance(config, dict):
            raise ServiceError(-1, 'config must be a mapping')
        folder = next((item for item in self.instance_folder_list if item['isDefault']), None)
        if folder is None:
            raise ServiceError(-1, 'the backend config lists no instance folder (instanceFolderList)')
        self.scan()
        with self.lock:
            template = self.template_by_id.get(template_id)
            if template is None:
                raise ServiceError(-3, f'the service template {template_id} is not found')
            if template.status != 'ready':
                raise ServiceError(-1, f'the service template {template.name} cannot be used: {template.message}')
            if any(instance.service_config.get('name') == name for instance in self.instance_by_id.values()):
                raise ServiceError(-1, f'a service instance is already named {name}')
            try:
                config_full = config_normalize({**template.template_config['config'], **(config or {})}, template.script.expose)
            except ValueError as error:
                raise ServiceError(-1, str(error))
            service_id = id_ms48_create(lambda candidate: candidate in self.instance_by_id)
            dir_path = os.path.join(folder['pathAbs'], instance_dir_name_build(template.name, service_id))
            dir_path_creating = os.path.join(folder['pathAbs'], f'{INSTANCE_CREATING_PREFIX}{service_id}')
            service_config = {
                'serviceId': service_id,
                'name': name,
                'description': str(description or ''),
                'isEnabled': True,
                'timeCreated': time_text_get(),
                'template': template.record_get(),
                'config': config_full,
            }
            # copied under a dot name and renamed when complete, so a scan
            # never sees half an instance
            try:
                os.makedirs(folder['pathAbs'], exist_ok=True)
                shutil.copytree(template.dir_path, dir_path_creating, ignore=instance_copy_ignore)
                yaml_write(os.path.join(dir_path_creating, SERVICE_CONFIG_FILE), {key: service_config[key] for key in SERVICE_CONFIG_KEY_LIST})
                os.rename(dir_path_creating, dir_path)
            except OSError as error:
                shutil.rmtree(dir_path_creating, ignore_errors=True)
                raise ServiceError(-1, f'the instance folder could not be created: {error}')
            self.scan()
            return self.instance_by_id[service_id].info_get()

    def api_call(self, service_id, api_name, params):
        """A call of an api: the result of a sync api, the job of an async one."""
        instance = self.instance_get(service_id)
        if instance.status in ('error', 'disabled'):
            raise ServiceError(-4, f'the service {service_id} is not ready ({instance.status}): {instance.message}')
        api_define = next((item for item in instance.expose['apiList'] if item['name'] == api_name), None)
        if api_define is None:
            raise ServiceError(-3, f'the service {instance.service_config.get("name", service_id)} has no api {api_name}')
        param_dict = api_param_dict_build(api_define, params)
        if api_define['execution'] == 'async':
            task = ServiceTask(api_define, param_dict, id_ms48_create(instance.job_id_is_used))
            instance.submit(task)
            return {'code': 0, 'data': task.job_info_get()}
        task = ServiceTask(api_define, param_dict)
        instance.submit(task)
        if not task.done_event.wait(self.api_wait_second_max):
            return {'code': -6, 'message': f'{api_name} did not finish in {self.api_wait_second_max:g} s; it is still queued or running'}
        return task.result

    def job_get(self, service_id, job_id):
        instance = self.instance_get(service_id)
        task = instance.job_get(job_id)
        if task is None:
            raise ServiceError(-3, f'the job {job_id} of {service_id} is not found (only the last {JOB_DONE_KEEP_MAX} finished jobs are kept)')
        return task.job_info_get()

    def stop_all(self):
        with self.lock:
            for instance in self.instance_by_id.values():
                instance.stop()
        deadline = time.time() + 5
        for instance in list(self.instance_by_id.values()):
            if instance.thread is not None:
                instance.thread.join(max(0, deadline - time.time()))
