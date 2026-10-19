"""The service runtime: finds the types and the instances, runs the apis.

Design: doc_page_impl_service_instance.md#backend

- a type is a folder {typeFolder}/{typeId}/ holding service_type.py
- an instance is a folder {instanceFolder}/{serviceId}--{name}/ holding service.yaml
- every running instance has one worker thread and one queue: its apis run
  one at a time, in the order they came; a call waits behind the ones before
- scan() is cheap and runs on every listing, so a folder added, removed or
  edited by hand is seen without a restart; an instance whose service.yaml or
  whose type's code changed is restarted
"""

import importlib.util
import json
import os
import queue
import sys
import threading
import time
import traceback

from service_define import (
    ServiceContext,
    ServiceDefineError,
    ServiceError,
    ServiceType,
    api_param_dict_build,
    dashboard_remote_build_get,
    expose_build,
    value_type_is,
)
from service_util import (
    dir_name_split,
    id_ms48_create,
    name_normalize,
    time_text_get,
    yaml_read,
    yaml_write,
)

SERVICE_CONFIG_FILE = 'service.yaml'
SERVICE_TYPE_FILE = 'service_type.py'

# the keys of service.yaml, in the order they are written
SERVICE_CONFIG_KEY_LIST = ['serviceId', 'name', 'typeId', 'description', 'isEnabled', 'timeCreated', 'config']

# how many finished jobs an instance keeps for GET /job/get
JOB_DONE_KEEP_MAX = 50

# ready: apis are answered. starting: start() is running (calls wait in the
# queue). disabled: isEnabled is false. error: the folder, the config, the
# type or start() failed; message says why
INSTANCE_STATUS_LIST = ['ready', 'starting', 'disabled', 'error']


class ServiceTypeEntry:
    """A type folder as last loaded."""

    def __init__(self, type_id, dir_path, folder):
        self.type_id = type_id
        self.dir_path = dir_path
        self.folder = folder
        self.file_path = os.path.join(dir_path, SERVICE_TYPE_FILE)
        self.mtime = None
        # increased on every load, so an instance knows its type changed
        self.load_count = 0
        self.status = 'error'
        self.message = ''
        self.type_class = None
        self.expose = None

    def load_if_changed(self):
        mtime = os.path.getmtime(self.file_path)
        if mtime == self.mtime:
            return
        self.mtime = mtime
        self.load_count += 1
        self.type_class = None
        self.expose = None
        try:
            module_name = f'service_type__{self.type_id.replace("-", "_")}__{self.load_count}'
            spec = importlib.util.spec_from_file_location(module_name, self.file_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            type_class = getattr(module, 'SERVICE_TYPE', None)
            if not (isinstance(type_class, type) and issubclass(type_class, ServiceType)):
                raise ServiceDefineError(f'{self.type_id}: {SERVICE_TYPE_FILE} must set SERVICE_TYPE to a ServiceType class')
            self.expose = expose_build(type_class, self.type_id, self.dir_path)
            self.type_class = type_class
            self.status = 'ready'
            self.message = ''
        except Exception as error:
            self.status = 'error'
            self.message = f'{type(error).__name__}: {error}'
            print(f'[service] type {self.type_id} failed to load: {self.message}', file=sys.stderr)

    def info_get(self):
        return {
            'typeId': self.type_id,
            'status': self.status,
            'message': self.message,
            'folder': self.folder,
            'expose': self.expose,
            'dashboardBuild': dashboard_remote_build_get(self.dir_path, self.expose['dashboardRemote']) if self.expose else None,
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

    def __init__(self, service_id, dir_path, folder, dir_name):
        self.service_id = service_id
        self.dir_path = dir_path
        self.folder = folder
        self.dir_name = dir_name
        self.config_path = os.path.join(dir_path, SERVICE_CONFIG_FILE)
        self.service_config = {}
        self.type_entry = None
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

    def start(self, service_config, type_entry):
        self.service_config = service_config
        self.type_entry = type_entry
        if not service_config['isEnabled']:
            self.status = 'disabled'
            self.message = 'isEnabled is false in service.yaml'
            return
        self.status = 'starting'
        self.message = ''
        context = ServiceContext(
            service_id=self.service_id,
            name=service_config['name'],
            dir_path=self.dir_path,
            type_dir_path=type_entry.dir_path,
            config=service_config['config'],
        )
        self.thread = threading.Thread(
            target=self._worker_run,
            args=(type_entry.type_class, context),
            name=f'service-{self.service_id}',
            daemon=True,
        )
        self.thread.start()

    def error_set(self, message, service_config=None):
        self.status = 'error'
        self.message = message
        if service_config is not None:
            self.service_config = service_config

    def stop(self):
        """Lets the call being run finish, refuses the ones waiting, then stops."""
        if self.thread is None:
            return
        self.task_queue.put(None)

    def _worker_run(self, type_class, context):
        implementation = None
        try:
            implementation = type_class(context)
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
            'typeId': service_config.get('typeId', ''),
            'description': service_config.get('description', ''),
            'isEnabled': service_config.get('isEnabled', True),
            'timeCreated': service_config.get('timeCreated', ''),
            'config': service_config.get('config', {}),
            'status': self.status,
            'message': self.message,
            'folder': self.folder,
            'dirName': self.dir_name,
            # the calls waiting behind the one being run
            'queueLength': self.task_queue.qsize(),
            'apiRunning': task_running.api_define['name'] if task_running is not None else '',
        }


class ServiceRuntime:
    """The types and instances of one backend config file."""

    def __init__(self, config_path):
        self.config_path = os.path.abspath(config_path)
        self.base_dir = os.path.dirname(self.config_path)
        config = yaml_read(self.config_path) or {}
        self.host = str(config.get('host', '127.0.0.1'))
        self.port = int(config.get('port', 45190))
        self.api_wait_second_max = float(config.get('apiWaitSecondMax', 120))
        self.type_folder_list = self._folder_list_read(config.get('typeFolderList'), 'typeFolderList')
        self.instance_folder_list = self._folder_list_read(config.get('instanceFolderList'), 'instanceFolderList')
        if len(self.instance_folder_list) > 0 and not any(folder['isDefault'] for folder in self.instance_folder_list):
            self.instance_folder_list[0]['isDefault'] = True
        self.type_by_id = {}
        self.instance_by_id = {}
        # problems of the scan that belong to no instance (a folder whose
        # name is not {id}--{name}, two folders of one id)
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
            self._type_scan()
            self._instance_scan()

    def _type_scan(self):
        type_id_seen = set()
        for folder in self.type_folder_list:
            if not os.path.isdir(folder['pathAbs']):
                continue
            for dir_name in sorted(os.listdir(folder['pathAbs'])):
                dir_path = os.path.join(folder['pathAbs'], dir_name)
                if not os.path.isfile(os.path.join(dir_path, SERVICE_TYPE_FILE)) or dir_name in type_id_seen:
                    continue
                type_id_seen.add(dir_name)
                entry = self.type_by_id.get(dir_name)
                if entry is None or entry.dir_path != dir_path:
                    entry = ServiceTypeEntry(dir_name, dir_path, folder['path'])
                    self.type_by_id[dir_name] = entry
                entry.load_if_changed()
        for type_id in list(self.type_by_id):
            if type_id not in type_id_seen:
                del self.type_by_id[type_id]

    def _instance_scan(self):
        problem_list = []
        found_by_id = {}
        for folder in self.instance_folder_list:
            if not os.path.isdir(folder['pathAbs']):
                continue
            for dir_name in sorted(os.listdir(folder['pathAbs'])):
                dir_path = os.path.join(folder['pathAbs'], dir_name)
                if not os.path.isdir(dir_path) or dir_name.startswith('.'):
                    continue
                split = dir_name_split(dir_name)
                if split is None:
                    problem_list.append(f'{folder["path"]}/{dir_name}: a service folder is named {{serviceId}}--{{name}}')
                    continue
                service_id = split[0]
                if service_id in found_by_id:
                    problem_list.append(f'{folder["path"]}/{dir_name}: the id {service_id} is also the folder {found_by_id[service_id][2]}; the first is used')
                    continue
                found_by_id[service_id] = (dir_path, folder['path'], dir_name)
        self.scan_problem_list = problem_list

        for service_id in list(self.instance_by_id):
            if service_id not in found_by_id:
                self.instance_by_id.pop(service_id).stop()
        for service_id, (dir_path, folder, dir_name) in found_by_id.items():
            self._instance_refresh(service_id, dir_path, folder, dir_name)

    def _instance_refresh(self, service_id, dir_path, folder, dir_name):
        config_path = os.path.join(dir_path, SERVICE_CONFIG_FILE)
        config_mtime = os.path.getmtime(config_path) if os.path.isfile(config_path) else None
        service_config = None
        type_entry = None
        error_message = ''
        try:
            service_config = self._service_config_read(config_path, service_id, dir_name)
            type_entry = self.type_by_id.get(service_config['typeId'])
            if type_entry is None:
                error_message = f'the service type {service_config["typeId"]} is not found'
            elif type_entry.status != 'ready':
                error_message = f'the service type {type_entry.type_id} failed to load: {type_entry.message}'
            else:
                service_config['config'] = self._instance_config_normalize(service_config['config'], type_entry.expose)
        except ValueError as error:
            error_message = str(error)
        signature = (dir_path, config_mtime, type_entry.type_id if type_entry else None,
                     type_entry.load_count if type_entry else None, error_message)

        instance = self.instance_by_id.get(service_id)
        if instance is not None and instance.signature == signature:
            return
        if instance is not None:
            instance.stop()
        instance = ServiceInstance(service_id, dir_path, folder, dir_name)
        instance.signature = signature
        self.instance_by_id[service_id] = instance
        if error_message:
            instance.error_set(error_message, service_config)
            return
        instance.start(service_config, type_entry)

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
        name = raw.get('name')
        if name != dir_name_split(dir_name)[1]:
            raise ValueError(f'name in {SERVICE_CONFIG_FILE} must be the name of the folder name ({dir_name_split(dir_name)[1]})')
        if not isinstance(raw.get('typeId'), str) or raw['typeId'] == '':
            raise ValueError(f'{SERVICE_CONFIG_FILE} needs typeId')
        config = raw.get('config') or {}
        if not isinstance(config, dict):
            raise ValueError(f'config in {SERVICE_CONFIG_FILE} must be a mapping')
        return {
            'serviceId': service_id,
            'name': name,
            'typeId': raw['typeId'],
            'description': str(raw.get('description') or ''),
            'isEnabled': raw.get('isEnabled', True) is not False,
            'timeCreated': str(raw.get('timeCreated') or ''),
            'config': config,
        }

    def _instance_config_normalize(self, config, expose):
        """The config with the defaults of configDefineList; keys it does not declare are kept."""
        result = dict(config)
        for define in expose['configDefineList']:
            key = define['key']
            if key not in result or result[key] is None:
                result[key] = define['default']
                continue
            if not value_type_is(result[key], define['type']):
                raise ValueError(f'config.{key} must be of type {define["type"]}')
        return result

    # ---------- requests ----------

    def status_get(self):
        with self.lock:
            return {
                'timeStarted': self.time_started,
                'configPath': self.config_path,
                'typeFolderList': [{'path': item['path']} for item in self.type_folder_list],
                'instanceFolderList': [{'path': item['path'], 'isDefault': item['isDefault']} for item in self.instance_folder_list],
                'typeCount': len(self.type_by_id),
                'instanceCount': len(self.instance_by_id),
                'scanProblemList': list(self.scan_problem_list),
            }

    def type_list_get(self):
        self.scan()
        with self.lock:
            return [entry.info_get() for entry in self.type_by_id.values()]

    def type_get(self, type_id):
        with self.lock:
            entry = self.type_by_id.get(type_id)
        if entry is None:
            raise ServiceError(-3, f'the service type {type_id} is not found')
        return entry

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

    def instance_create(self, type_id, name_input, description, config):
        try:
            name = name_normalize(name_input)
        except ValueError as error:
            raise ServiceError(-1, str(error))
        if config is not None and not isinstance(config, dict):
            raise ServiceError(-1, 'config must be a mapping')
        folder = next((item for item in self.instance_folder_list if item['isDefault']), None)
        if folder is None:
            raise ServiceError(-1, 'the backend config lists no instance folder (instanceFolderList)')
        self.scan()
        with self.lock:
            entry = self.type_by_id.get(type_id)
            if entry is None:
                raise ServiceError(-3, f'the service type {type_id} is not found')
            if entry.status != 'ready':
                raise ServiceError(-1, f'the service type {type_id} failed to load: {entry.message}')
            if any(instance.service_config.get('name') == name for instance in self.instance_by_id.values()):
                raise ServiceError(-1, f'a service instance is already named {name}')
            try:
                config_full = self._instance_config_normalize(config or {}, entry.expose)
            except ValueError as error:
                raise ServiceError(-1, str(error))
            service_id = id_ms48_create(lambda candidate: candidate in self.instance_by_id)
            dir_path = os.path.join(folder['pathAbs'], f'{service_id}--{name}')
            os.makedirs(dir_path)
            service_config = {
                'serviceId': service_id,
                'name': name,
                'typeId': type_id,
                'description': str(description or ''),
                'isEnabled': True,
                'timeCreated': time_text_get(),
                'config': config_full,
            }
            yaml_write(os.path.join(dir_path, SERVICE_CONFIG_FILE), {key: service_config[key] for key in SERVICE_CONFIG_KEY_LIST})
            self._instance_scan()
            return self.instance_by_id[service_id].info_get()

    def api_call(self, service_id, api_name, params):
        """A call of an api: the result of a sync api, the job of an async one."""
        instance = self.instance_get(service_id)
        if instance.status in ('error', 'disabled'):
            raise ServiceError(-4, f'the service {service_id} is not ready ({instance.status}): {instance.message}')
        api_define = next((item for item in instance.type_entry.expose['apiList'] if item['name'] == api_name), None)
        if api_define is None:
            raise ServiceError(-3, f'the service type {instance.type_entry.type_id} has no api {api_name}')
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
