"""The service runtime: the kernel, the registry of templates and instances, the calls.

Design: doc_page_impl_service.md#the-service-runtime-kernel

- a template is a folder {folder}/{templateId}--{name}/ holding
  service-template.yaml and service.py (with its icon and dashboards): the
  initial state of a service, app or infra (kind). it is listed, never run
- an instance is a folder {folder}/{templateName}-inst-{serviceId}/ holding
  service.yaml, its own copy of everything its template held when it was
  created, and its data. it runs its own service.py; the template is
  recorded in service.yaml and never read again
- the folders come from three places (the origin of a template or an
  instance): the built-in folder of the package, the doc pages the backend is
  given (by its config, or synced by the page), and plain folders of the
  config; a doc page's folders are the convention ones (doc_page_impl_dir.md)
  or those of its .doc-page/service.yaml
- every running instance has one worker thread and one queue: its apis run
  one at a time, in the order they came; a call waits behind the ones before
- scan() is cheap and runs on every listing and every reconcile tick, so a
  folder added, removed or edited by hand is seen without a restart; an
  instance whose service.yaml or whose service.py changed is restarted.
  after the scan the kernel reconciles: which infra names are required,
  which are provided, what to provision, where each name is routed
- every call, from the page or from another instance, goes through
  api_call: the target resolved to an instance (an infra name routed to its
  current instance), the caller authorized (call_authorize, the dependency
  list for an infra target), the params checked, then queued (or run at
  once, for an api with isQueued False)
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
    ServiceCaller,
    ServiceContext,
    ServiceDefineError,
    ServiceError,
    api_param_dict_build,
    dashboard_remote_build_get,
    dependency_list_normalize,
    expose_build,
    value_type_is,
)
from service_kernel import (
    INFRA_LOGGING_NAME,
    BUILT_IN_FOLDER_LIST,
    InfraRouteTable,
    KernelLog,
    doc_page_service_folder_list_read,
    folder_item_normalize,
)
from service_util import (
    REGEX_ID,
    TEMPLATE_DIR_SEPARATOR,
    id_ms48_create,
    instance_dir_name_build,
    instance_dir_name_split,
    instance_name_normalize,
    template_dir_name_split,
    time_text_get,
    yaml_read,
    yaml_write,
    yaml_write_commented,
)

SERVICE_SCRIPT_FILE = 'service.py'
SERVICE_CONFIG_FILE = 'service.yaml'
TEMPLATE_CONFIG_FILE = 'service-template.yaml'
# a template folder may group its templates in folders of any name that is
# not a template's ({templateId}--{name}), nested up to this depth
TEMPLATE_GROUP_DEPTH_MAX = 8
# what is never a group of templates: what a group holding a template
# project (a dashboard copied in by hand) might bring along
TEMPLATE_GROUP_SKIP_NAME_LIST = ['node_modules', 'dist', '__pycache__']
# the kernel's record of an instance, in the instance folder: whether
# onCreate ran, the last hook runs. written by the kernel, never by hand
SERVICE_RECORD_FILE = 'service-record.yaml'
# the kernel's own state, beside the backend config file: the explicit infra routes
KERNEL_STATE_FILE = 'service-kernel.yaml'

# the keys of service.yaml and of service-template.yaml, in the order they are written
SERVICE_CONFIG_KEY_LIST = ['serviceId', 'name', 'description', 'kind', 'isEnabled', 'timeCreated', 'template',
                           'provision', 'dependencyList', 'isDependencyDynamicAllowed', 'config']
TEMPLATE_CONFIG_KEY_LIST = ['templateId', 'name', 'description', 'kind', 'provision', 'timeCreated', 'versionId',
                            'versionList', 'config']

# what creating an instance does not copy from its template folder: the
# template's own file (the instance gets service.yaml instead) and what is
# installed or generated rather than written (dependencies, bytecode)
INSTANCE_COPY_IGNORE_NAME_LIST = [TEMPLATE_CONFIG_FILE, 'node_modules', '__pycache__']

# the folder an instance is copied into before it is renamed to its own
# name, and the one a deleted instance is renamed to; the scan skips names
# starting with a dot
INSTANCE_CREATING_PREFIX = '.creating-'
INSTANCE_DELETED_PREFIX = '.deleted-'

# how many finished jobs an instance keeps for GET /job/get
JOB_DONE_KEEP_MAX = 50
# how many hook runs an instance's record keeps
HOOK_RECORD_KEEP_MAX = 20

# ready: apis are answered. starting: start() is running (calls wait in the
# queue). waiting: not started yet, a required infra service is not
# available (started by the kernel when it is). disabled: isEnabled is
# false. error: the folder, the config, the script or start() failed;
# message says why
INSTANCE_STATUS_LIST = ['ready', 'starting', 'waiting', 'disabled', 'error']

# auto: the kernel creates an instance of the template when a name it
# provides is required and no instance provides it. manual: never by itself
TEMPLATE_PROVISION_LIST = ['auto', 'manual']

# the built-in folder of the package, relative to this file: what the package ships
BUILT_IN_DIR_DEFAULT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'built-in'))


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


def origin_info_get(folder):
    """What a template or instance of a folder reports as its origin."""
    return dict(folder['origin'])


class ServiceTemplate:
    """A template folder: the initial state of a service, as last read. Never run."""

    def __init__(self, template_id, name, dir_path, folder, group_path=''):
        self.template_id = template_id
        self.name = name
        self.dir_path = dir_path
        # the folder entry it was found in: path, kind, origin
        self.folder = folder
        # the groups it is in, inside the folder: 'connection/cloud', '' at the top
        self.group_path = group_path
        self.dir_name = os.path.basename(dir_path)
        self.kind = folder['kind']
        self.config_path = os.path.join(dir_path, TEMPLATE_CONFIG_FILE)
        self.config_mtime = None
        # service-template.yaml as read and checked; {} when it cannot be used
        self.template_config = {}
        # why service-template.yaml cannot be used ('' when it can)
        self.config_message = ''
        self.script = ServiceScript(dir_path, f'template {name}', f'template_{template_id}')
        self.status = 'error'
        self.message = ''

    @property
    def provision(self):
        return self.template_config.get('provision', 'manual')

    def infra_name_get(self):
        """The infra service name an infra template provides: expose.infra.name, else its name."""
        if self.kind != 'infra' or self.script.expose is None:
            return ''
        infra = self.script.expose.get('infra') or {}
        return infra.get('name') or self.name

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
        if self.kind == 'app' and self.script.expose.get('infra') is not None:
            self.message = f'an app template declares no expose.infra; {self.dir_name} is in a folder of app templates'
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
        kind = raw.get('kind', self.kind)
        if kind != self.kind:
            raise ValueError(f'kind in {TEMPLATE_CONFIG_FILE} is {kind}, but the folder holds {self.kind} templates')
        provision = raw.get('provision', 'manual')
        if provision not in TEMPLATE_PROVISION_LIST:
            raise ValueError(f'provision in {TEMPLATE_CONFIG_FILE} must be auto or manual')
        if provision == 'auto' and kind != 'infra':
            raise ValueError(f'provision auto in {TEMPLATE_CONFIG_FILE} is for infra templates only')
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
            'kind': kind,
            'provision': provision,
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
            'kind': self.kind,
            'description': template_config.get('description', ''),
            'provision': self.provision,
            'infraName': self.infra_name_get(),
            'timeCreated': template_config.get('timeCreated', ''),
            'versionId': template_config.get('versionId', ''),
            'versionList': template_config.get('versionList', []),
            'config': template_config.get('config', {}),
            'status': self.status,
            'message': self.message,
            'folder': self.folder['path'],
            'groupPath': self.group_path,
            'dirName': self.dir_name,
            'origin': origin_info_get(self.folder),
            'expose': self.script.expose,
            'dashboardBuild': self.script.dashboard_build_get(),
        }


class ServiceTask:
    """One api call waiting in, or taken from, an instance's queue."""

    def __init__(self, service_id, api_define, param_dict, caller, job_id=''):
        self.service_id = service_id
        self.api_define = api_define
        self.param_dict = param_dict
        # the ServiceCaller: the api reads it as context.caller
        self.caller = caller
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
            'serviceId': self.service_id,
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


# the sentinels of an instance's queue: stop, or stop and destroy
_STOP = object()
_DESTROY = object()


class ServiceInstance:
    """An instance folder, and, when it runs, its worker thread and queue."""

    def __init__(self, service_id, dir_path, folder, script, runtime):
        self.service_id = service_id
        self.dir_path = dir_path
        # the folder entry it was found in: path, kind, origin
        self.folder = folder
        self.dir_name = os.path.basename(dir_path)
        self.kind = folder['kind']
        self.config_path = os.path.join(dir_path, SERVICE_CONFIG_FILE)
        self.record_path = os.path.join(dir_path, SERVICE_RECORD_FILE)
        self.service_config = {}
        # the instance's own service.py; kept by the runtime across restarts
        self.script = script
        # given to the context, for the calls of other instances
        self.runtime = runtime
        # the context and the object of the script's class, once start() succeeded:
        # what a call with isQueued False runs on, in the caller's thread
        self.context = None
        self.implementation = None
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
        # a resident instance's run() thread and the event that ends it
        self.run_thread = None
        self.run_stop_event = None
        # the kernel's record of the instance (service-record.yaml)
        self.record = {'timeCreateHook': '', 'hookRecordList': []}
        self.hook_running = None
        # set when the instance is deleted: the worker runs onDestroy after stop
        self.destroyed_event = threading.Event()

    # ---------- what it is ----------

    def infra_name_get(self):
        """The infra service name an infra instance provides: expose.infra.name of
        its own script, else the name of the template it recorded."""
        if self.kind != 'infra' or self.expose is None:
            return ''
        infra = self.expose.get('infra') or {}
        return infra.get('name') or (self.service_config.get('template') or {}).get('name', '')

    def is_provisioned(self):
        return (self.service_config.get('provision') or {}).get('mode') == 'auto'

    def dependency_list_get(self):
        """The effective dependency list: the context's while it runs (it may
        have added some), the config's otherwise."""
        if self.context is not None:
            return [dict(item) for item in self.context.dependency_list]
        return [dict(item) for item in self.service_config.get('dependencyList', [])]

    # ---------- start / stop ----------

    def start(self, service_config):
        self.service_config = service_config
        self.expose = self.script.expose
        self._record_read()
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
            runtime=self.runtime,
            kind=self.kind,
            dependency_list=service_config['dependencyList'],
            is_dependency_dynamic_allowed=service_config['isDependencyDynamicAllowed'],
        )
        self.context = context
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

    def wait_set(self, service_config, message):
        """Not started yet: a required infra service is not available. The
        kernel starts it when the dependency is (start_if_ready)."""
        self.service_config = service_config
        self.expose = self.script.expose
        self.status = 'waiting'
        self.message = message

    def start_if_ready(self):
        """A waiting instance started once its required dependencies are available."""
        if self.status != 'waiting':
            return False
        message = self.runtime.dependency_wait_message_get(self)
        if message:
            self.message = message
            return False
        self.start(self.service_config)
        return True

    def stop(self, is_destroy=False):
        """Lets the call being run finish, refuses the ones waiting, then stops
        (and runs onDestroy when the instance is deleted)."""
        if self.thread is None:
            if is_destroy:
                self.destroyed_event.set()
            return
        self.task_queue.put(_DESTROY if is_destroy else _STOP)

    def _worker_run(self, service_class, context):
        implementation = None
        timeout = self.expose['lifecycle']['hookTimeoutSecond']
        is_started = False
        try:
            implementation = service_class(context)
        except Exception as error:
            self.status = 'error'
            self.message = f'the service class could not be created: {type(error).__name__}: {error}'
            traceback.print_exc()
        if implementation is not None:
            is_create_ok = True
            if self.record['timeCreateHook'] == '':
                is_create_ok = self._hook_run('onCreate', implementation.on_create, timeout)
                if is_create_ok:
                    self.record['timeCreateHook'] = time_text_get()
                    self._record_write()
            if is_create_ok and self._hook_run('onStart', implementation.start, timeout):
                self.implementation = implementation
                self.status = 'ready'
                is_started = True
                self.runtime.kernel_log.kernel('info', 'lifecycle', f'{self.label_get()} started', {'serviceId': self.service_id})
                if self.expose['execution']['mode'] == 'resident':
                    self.run_stop_event = threading.Event()
                    self.run_thread = threading.Thread(target=self._run_resident, args=(implementation,),
                                                       name=f'service-{self.service_id}-run', daemon=True)
                    self.run_thread.start()
        sentinel = _STOP
        while True:
            task = self.task_queue.get()
            if task is _STOP or task is _DESTROY:
                sentinel = task
                break
            if self.status != 'ready':
                task.finish({'code': -4, 'message': f'the service {self.service_id} is not ready: {self.message}'})
                self._job_done(task)
                continue
            self._task_run(implementation, context, task)
        while not self.task_queue.empty():
            task = self.task_queue.get()
            if task is not _STOP and task is not _DESTROY:
                task.finish({'code': -4, 'message': f'the service {self.service_id} stopped'})
                self._job_done(task)
        if self.run_stop_event is not None:
            self.run_stop_event.set()
            self.run_thread.join(5)
            if self.run_thread.is_alive():
                self.runtime.kernel_log.kernel('warn', 'lifecycle', f'run() of {self.label_get()} did not return in 5 s after stop')
        if is_started:
            self.status = 'error'
            self.message = 'stopped'
            self._hook_run('onStop', implementation.stop, timeout)
            self.runtime.kernel_log.kernel('info', 'lifecycle', f'{self.label_get()} stopped', {'serviceId': self.service_id})
        if sentinel is _DESTROY:
            if implementation is not None:
                self._hook_run('onDestroy', implementation.on_destroy, timeout)
            self.destroyed_event.set()

    def _run_resident(self, implementation):
        try:
            implementation.run(self.run_stop_event)
        except Exception as error:
            self.runtime.kernel_log.kernel('error', 'lifecycle', f'run() of {self.label_get()} failed: {type(error).__name__}: {error}')
            traceback.print_exc()

    def _hook_run(self, hook_name, method, timeout):
        """Runs a lifecycle hook in this (the worker) thread, recorded with its
        outcome; a hook that runs past the timeout is a failed hook: the
        instance is in error with the reason even if the hook returns later."""
        record = {'hook': hook_name, 'status': 'running', 'timeStarted': time_text_get(), 'timeDone': '', 'second': 0.0, 'message': ''}
        self._hook_record_add(record)
        self.hook_running = record
        time_start = time.time()

        def timed_out():
            if record['status'] != 'running':
                return
            record['status'] = 'timedOut'
            record['message'] = f'{hook_name} did not finish in {timeout:g} s'
            if hook_name in ('onCreate', 'onStart'):
                self.status = 'error'
                self.message = record['message']
            self.runtime.kernel_log.kernel('error', 'hook', f'{hook_name} of {self.label_get()} timed out', {'serviceId': self.service_id, 'second': timeout})

        timer = threading.Timer(timeout, timed_out)
        timer.daemon = True
        timer.start()
        is_ok = False
        try:
            method()
            is_ok = True
        except Exception as error:
            if record['status'] == 'running':
                record['status'] = 'failed'
                record['message'] = f'{type(error).__name__}: {error}'
            traceback.print_exc()
        finally:
            timer.cancel()
        record['second'] = round(time.time() - time_start, 3)
        record['timeDone'] = time_text_get()
        if record['status'] == 'running':
            record['status'] = 'done'
        elif record['status'] == 'timedOut':
            # it did finish, late: the record says so, the outcome stays
            record['message'] += ' (finished later)' if is_ok else f' (then failed)'
            is_ok = False
        self.hook_running = None
        if not is_ok and hook_name in ('onCreate', 'onStart') and self.status != 'error':
            self.status = 'error'
            self.message = f'{hook_name} failed: {record["message"]}'
        level = 'debug' if is_ok else 'error'
        self.runtime.kernel_log.kernel(level, 'hook', f'{hook_name} of {self.label_get()} {record["status"]}'
                                       + (f': {record["message"]}' if record['message'] else ''),
                                       {'serviceId': self.service_id, 'second': record['second']})
        self._record_write()
        return is_ok

    # ---------- the record ----------

    def _record_read(self):
        self.record = {'timeCreateHook': '', 'hookRecordList': []}
        if not os.path.isfile(self.record_path):
            return
        try:
            raw = yaml_read(self.record_path) or {}
            if isinstance(raw, dict):
                self.record['timeCreateHook'] = str(raw.get('timeCreateHook') or '')
                hook_list = raw.get('hookRecordList') or []
                self.record['hookRecordList'] = [item for item in hook_list if isinstance(item, dict)]
        except Exception as error:
            print(f'[service] {SERVICE_RECORD_FILE} of {self.dir_name} is not readable, started over: {error}', file=sys.stderr)

    def _record_write(self):
        try:
            yaml_write_commented(self.record_path, {
                'timeCreateHook': self.record['timeCreateHook'],
                'hookRecordList': self.record['hookRecordList'][-HOOK_RECORD_KEEP_MAX:],
            }, 'the record the service runtime kernel keeps of this instance: whether its onCreate hook ran,\n'
               'and its last lifecycle hook runs (doc_page_impl_service.md#lifecycle-and-hooks). written by the kernel.')
        except OSError as error:
            print(f'[service] {SERVICE_RECORD_FILE} of {self.dir_name} could not be written: {error}', file=sys.stderr)

    def _hook_record_add(self, record):
        self.record['hookRecordList'].append(record)
        del self.record['hookRecordList'][:-HOOK_RECORD_KEEP_MAX]

    # ---------- calls ----------

    def _task_run(self, implementation, context, task):
        task.status = 'running'
        task.time_started = time_text_get()
        self.task_running = task
        result = api_run(implementation, context, task.api_define['name'], task.param_dict,
                         task.caller, task if task.job_id else None)
        self.task_running = None
        task.progress = 1.0
        task.finish(result)
        self._job_done(task)

    def call_direct(self, api_define, param_dict, caller):
        """An api with isQueued False, run at once in the caller's thread."""
        implementation = self.implementation
        if self.status != 'ready' or implementation is None:
            return {'code': -4, 'message': f'the service {self.service_id} is not ready ({self.status}): {self.message}'}
        return api_run(implementation, self.context, api_define['name'], param_dict, caller, None)

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

    def label_get(self):
        name = self.service_config.get('name', '')
        return f'the {self.kind} service {name or self.service_id} ({self.service_id})'

    def info_get(self):
        service_config = self.service_config
        task_running = self.task_running
        dependency_status_list = self.runtime.dependency_status_list_get(self)
        health, health_message = self.runtime.health_get(self, dependency_status_list)
        context = self.context
        return {
            'serviceId': self.service_id,
            'name': service_config.get('name', ''),
            'description': service_config.get('description', ''),
            'kind': self.kind,
            'isEnabled': service_config.get('isEnabled', True),
            'timeCreated': service_config.get('timeCreated', ''),
            'template': service_config.get('template', None),
            'provision': service_config.get('provision', None),
            'config': service_config.get('config', {}),
            'dependencyList': self.dependency_list_get(),
            'isDependencyDynamicAllowed': service_config.get('isDependencyDynamicAllowed', False),
            'dependencyStatusList': dependency_status_list,
            'infraName': self.infra_name_get(),
            'status': self.status,
            'message': self.message,
            'health': health,
            'healthMessage': health_message,
            'healthReported': context.health_reported if context is not None else '',
            'executionMode': self.expose['execution']['mode'] if self.expose else 'passive',
            'isResidentRunning': self.run_thread is not None and self.run_thread.is_alive(),
            'hookRecordList': list(self.record['hookRecordList']),
            'timeCreateHook': self.record['timeCreateHook'],
            'folder': self.folder['path'],
            'dirName': self.dir_name,
            'origin': origin_info_get(self.folder),
            'expose': self.expose,
            'dashboardBuild': self.script.dashboard_build_get(),
            # the calls waiting behind the one being run
            'queueLength': self.task_queue.qsize(),
            'apiRunning': task_running.api_define['name'] if task_running is not None else '',
        }


def api_run(implementation, context, api_name, param_dict, caller, job):
    """The formatted result of one api run in the current thread, the caller
    and the job set in the context while it runs."""
    previous = context.call_enter(caller, job)
    try:
        data = getattr(implementation, api_name)(**param_dict)
        # a result the page cannot read is a failure of the api, not of the transport
        json.dumps(data)
        return {'code': 0, 'data': data}
    except ServiceError as error:
        return {'code': error.code, 'message': error.message}
    except Exception as error:
        traceback.print_exc()
        return {'code': -1, 'message': f'{api_name} failed: {type(error).__name__}: {error}'}
    finally:
        context.call_exit(previous)


TARGET_KEY_LIST = ['serviceId', 'templateId', 'versionId', 'infra']


def target_normalize(target):
    """What a call names: { serviceId }, { templateId, versionId? } or { infra }; raises ServiceError -1."""
    if not isinstance(target, dict):
        raise ServiceError(-1, 'a target is { serviceId }, { templateId, versionId? } or { infra: name }')
    key_unknown_list = [key for key in target if key not in TARGET_KEY_LIST]
    if key_unknown_list:
        raise ServiceError(-1, f'a target has no key {", ".join(key_unknown_list)}; it is {{ serviceId }}, {{ templateId, versionId? }} or {{ infra: name }}')
    result = {key: target.get(key) or '' for key in TARGET_KEY_LIST}
    if not all(isinstance(value, str) for value in result.values()):
        raise ServiceError(-1, 'the ids of a target are strings')
    given_count = sum(1 for key in ['serviceId', 'templateId', 'infra'] if result[key] != '')
    if given_count != 1:
        raise ServiceError(-1, 'a target names one of serviceId, templateId or infra')
    if result['versionId'] and not result['templateId']:
        raise ServiceError(-1, 'versionId goes with templateId')
    return result


def target_label_get(target):
    if target['serviceId']:
        return f'the service {target["serviceId"]}'
    if target['infra']:
        return f'the infra service {target["infra"]}'
    version = f' at version {target["versionId"]}' if target['versionId'] else ''
    return f'an instance of the template {target["templateId"]}{version}'


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
    """The kernel and the registry of one backend config file."""

    def __init__(self, config_path):
        self.config_path = os.path.abspath(config_path)
        self.base_dir = os.path.dirname(self.config_path)
        config = yaml_read(self.config_path) or {}
        if not isinstance(config, dict):
            raise ValueError(f'{self.config_path} must be a mapping')
        self.host = str(config.get('host', '127.0.0.1'))
        self.port = int(config.get('port', 45190))
        self.api_wait_second_max = float(config.get('apiWaitSecondMax', 120))
        self.reconcile_interval_second = float(config.get('reconcileIntervalSecond', 10))
        self.kernel_log = KernelLog(is_verbose=bool(config.get('isLogVerbose', False)))
        self.kernel_state_path = os.path.join(self.base_dir, KERNEL_STATE_FILE)
        # the built-in folder: what the package ships. false: none
        built_in = config.get('builtIn', None)
        if built_in is False:
            self.built_in_dir = ''
        elif built_in is None:
            self.built_in_dir = BUILT_IN_DIR_DEFAULT if os.path.isdir(BUILT_IN_DIR_DEFAULT) else ''
        elif isinstance(built_in, str) and built_in != '':
            self.built_in_dir = os.path.normpath(os.path.join(self.base_dir, built_in))
        else:
            raise ValueError(f'{self.config_path}: builtIn is a path, or false')
        # the doc pages of the config, and those the page synced (docpage_sync)
        self.doc_page_list_config = self._doc_page_list_read(config.get('docPageList'))
        self.doc_page_list_page = []
        # the plain folders of the config (the former form; kind app by default)
        self.folder_list_config = (
            [self._folder_config_build(item, 'template') for item in self._folder_list_read(config.get('templateFolderList'), 'templateFolderList')]
            + [self._folder_config_build(item, 'instance') for item in self._folder_list_read(config.get('instanceFolderList'), 'instanceFolderList')]
        )
        self.template_by_id = {}
        self.instance_by_id = {}
        # the script of every instance folder, kept across restarts of the
        # instance, so a restart reloads it only when the file changed
        self.instance_script_by_id = {}
        # problems of the scan that belong to no template or instance (a
        # folder whose name has not the form, two folders of one id)
        self.scan_problem_list = []
        # problems of the kernel: a doc page whose service file cannot be
        # read, an infra name that cannot be provisioned, a bad explicit route
        self.kernel_problem_list = []
        self.route_table = InfraRouteTable()
        self._kernel_state_read()
        # what the last reconcile found: by infra name
        self.infra_info_by_name = {}
        self.provision_failure_by_name = {}
        self.reconcile_count = 0
        self.time_reconciled = ''
        self.time_started = time_text_get()
        self.lock = threading.RLock()
        self.reconcile_thread = None
        self.reconcile_stop_event = threading.Event()
        self.kernel_log.kernel('info', 'registry', f'kernel started with {self.config_path}',
                               {'builtInDir': self.built_in_dir, 'docPageCount': len(self.doc_page_list_config)})

    # ---------- config ----------

    def _folder_list_read(self, folder_list, key):
        if folder_list is None:
            return []
        if not isinstance(folder_list, list):
            raise ValueError(f'{self.config_path}: {key} must be a list')
        try:
            return [folder_item_normalize(item, self.base_dir, key, f'{key} in {self.config_path}') for item in folder_list]
        except ValueError as error:
            raise ValueError(str(error))

    def _folder_config_build(self, item, role):
        return {
            'path': item['path'],
            'pathWritten': item['pathWritten'],
            'role': role,
            'kind': item['kind'],
            'isDefault': item['isDefault'],
            'origin': {'kind': 'folder', 'alias': '', 'dir': os.path.dirname(item['path'])},
        }

    def _doc_page_list_read(self, doc_page_list):
        if doc_page_list is None:
            return []
        if not isinstance(doc_page_list, list):
            raise ValueError(f'{self.config_path}: docPageList must be a list of {{ dir, alias?, isDefault?, serviceFile? }}')
        result = []
        for index, item in enumerate(doc_page_list):
            if isinstance(item, str):
                item = {'dir': item}
            if not isinstance(item, dict) or not isinstance(item.get('dir'), str) or item['dir'] == '':
                raise ValueError(f'{self.config_path}: docPageList[{index}] must be {{ dir, alias?, isDefault?, serviceFile? }}')
            dir_page = os.path.normpath(os.path.join(self.base_dir, item['dir']))
            service_file = item.get('serviceFile', '')
            result.append({
                'alias': str(item.get('alias') or os.path.basename(dir_page)),
                'dir': dir_page,
                'serviceFile': os.path.normpath(os.path.join(self.base_dir, service_file)) if service_file else '',
                'isDefault': bool(item.get('isDefault', False)),
                'source': 'config',
            })
        if len(result) > 0 and not any(item['isDefault'] for item in result):
            result[0]['isDefault'] = True
        return result

    def docpage_sync(self, doc_page_list):
        """The doc pages the page loaded, with their folders: mounted for as
        long as the backend runs, after those of the config (a doc page the
        config names is not mounted twice). Raises ServiceError -1."""
        if not isinstance(doc_page_list, list):
            raise ServiceError(-1, 'docPageList must be a list of { alias, dir, serviceFile? }')
        result = []
        for index, item in enumerate(doc_page_list):
            if not isinstance(item, dict) or not isinstance(item.get('dir'), str) or item['dir'] == '' or not os.path.isabs(item['dir']):
                raise ServiceError(-1, f'docPageList[{index}] must be {{ alias, dir (absolute), serviceFile? }}')
            service_file = item.get('serviceFile') or ''
            if service_file and not os.path.isabs(service_file):
                raise ServiceError(-1, f'docPageList[{index}].serviceFile must be absolute')
            result.append({
                'alias': str(item.get('alias') or os.path.basename(item['dir'])),
                'dir': os.path.normpath(item['dir']),
                'serviceFile': os.path.normpath(service_file) if service_file else '',
                'isDefault': False,
                'source': 'page',
            })
        with self.lock:
            dir_set = {item['dir'] for item in self.doc_page_list_config}
            result = [item for item in result if item['dir'] not in dir_set]
            is_changed = [(item['alias'], item['dir'], item['serviceFile']) for item in result] != [(item['alias'], item['dir'], item['serviceFile']) for item in self.doc_page_list_page]
            self.doc_page_list_page = result
        if is_changed:
            self.kernel_log.kernel('info', 'registry', f'{len(result)} doc page(s) mounted by the page',
                                   {'docPageList': [{'alias': item['alias'], 'dir': item['dir']} for item in result]})
        self.scan()
        return self.status_get()['kernel']['docPageList']

    def doc_page_list_get(self):
        return self.doc_page_list_config + self.doc_page_list_page

    def folder_list_get(self):
        """Every folder the registry reads, with its origin: the built-in folder's, the
        doc pages', the config's. The problems of the doc pages are reported."""
        folder_list = []
        problem_list = []
        if self.built_in_dir:
            for item in BUILT_IN_FOLDER_LIST:
                folder_list.append({
                    'path': os.path.join(self.built_in_dir, item['path']),
                    'pathWritten': item['path'],
                    'role': item['role'],
                    'kind': item['kind'],
                    'isDefault': False,
                    'origin': {'kind': 'builtIn', 'alias': '', 'dir': self.built_in_dir},
                })
        for doc_page in self.doc_page_list_get():
            try:
                for item in doc_page_service_folder_list_read(doc_page['dir'], doc_page['serviceFile']):
                    folder_list.append({
                        **item,
                        'pathWritten': item.get('pathWritten', os.path.relpath(item['path'], doc_page['dir'])),
                        'origin': {'kind': 'docPage', 'alias': doc_page['alias'], 'dir': doc_page['dir']},
                    })
            except ValueError as error:
                problem_list.append(f'doc page {doc_page["alias"]}: {error}')
        folder_list.extend(self.folder_list_config)
        return folder_list, problem_list

    def _kernel_state_read(self):
        if not os.path.isfile(self.kernel_state_path):
            return
        try:
            raw = yaml_read(self.kernel_state_path) or {}
            route_by_name = raw.get('routeByInfra') if isinstance(raw, dict) else None
            if isinstance(route_by_name, dict):
                self.route_table.route_by_name = {str(key): str(value) for key, value in route_by_name.items() if value}
        except Exception as error:
            self.kernel_problem_list.append(f'{KERNEL_STATE_FILE} is not readable: {error}')

    def _kernel_state_write(self):
        yaml_write_commented(self.kernel_state_path, {'routeByInfra': dict(self.route_table.route_by_name)},
                             'the state of the service runtime kernel (doc_page_impl_service.md#the-service-runtime-kernel):\n'
                             'routeByInfra: the infra service names routed to one instance on purpose, by service id.\n'
                             'written by the kernel (the Services tab); without an entry a name goes to the oldest ready instance providing it.')

    # ---------- scan ----------

    def scan(self):
        """Reads the folders, starts and stops instances, then reconciles
        (infra names, provisioning, routes) and flushes the kernel log."""
        with self.lock:
            folder_list, doc_page_problem_list = self.folder_list_get()
            template_problem_list = self._template_scan([folder for folder in folder_list if folder['role'] == 'template'])
            instance_problem_list = self._instance_scan([folder for folder in folder_list if folder['role'] == 'instance'])
            problem_list_before = list(self.scan_problem_list)
            self.scan_problem_list = template_problem_list + instance_problem_list
            if self.scan_problem_list != problem_list_before:
                for problem in self.scan_problem_list:
                    if problem not in problem_list_before:
                        self.kernel_log.kernel('warn', 'scan', problem)
            self._reconcile(folder_list, doc_page_problem_list)
        self._log_flush()

    def _template_scan(self, folder_list):
        problem_list = []
        found_by_id = {}
        for dir_path, folder, group_path in self._template_entry_list(folder_list, problem_list):
            dir_name = os.path.basename(dir_path)
            template_id, name = template_dir_name_split(dir_name)
            place = f'{folder["path"]}/{group_path + "/" if group_path else ""}{dir_name}'
            if template_id in found_by_id:
                problem_list.append(f'{place}: the template id {template_id} is also the folder {found_by_id[template_id][0]}; the first is used')
                continue
            if any(entry[2] == name for entry in found_by_id.values()):
                problem_list.append(f'{place}: the template name {name} is taken by another template folder; the first is used')
                continue
            found_by_id[template_id] = (dir_path, folder, name, group_path)

        for template_id in list(self.template_by_id):
            if template_id not in found_by_id:
                template = self.template_by_id.pop(template_id)
                self.kernel_log.kernel('info', 'registry', f'template {template.name} ({template_id}) is gone')
        for template_id, (dir_path, folder, name, group_path) in found_by_id.items():
            template = self.template_by_id.get(template_id)
            if template is None or template.dir_path != dir_path or template.kind != folder['kind']:
                template = ServiceTemplate(template_id, name, dir_path, folder, group_path)
                self.template_by_id[template_id] = template
                self.kernel_log.kernel('info', 'registry', f'{folder["kind"]} template {name} ({template_id}) found in {folder["path"]}',
                                       {'origin': folder['origin']})
            template.refresh()
        return problem_list

    def _template_entry_list(self, folder_list, problem_list):
        """(dir_path, folder, group_path) of every template of the template
        folders. A folder named {templateId}--{name} is a template; any other
        is a group of templates, read in turn, to TEMPLATE_GROUP_DEPTH_MAX.
        A group holding the files of a template, or named like a template
        but not one ({id}--{bad name}), is a misnamed template: reported, and
        not read."""
        result = []

        def group_read(group_dir, folder, group_path, depth):
            for dir_name in sorted(os.listdir(group_dir)):
                dir_path = os.path.join(group_dir, dir_name)
                if not os.path.isdir(dir_path) or dir_name.startswith('.') or dir_name in TEMPLATE_GROUP_SKIP_NAME_LIST:
                    continue
                place = f'{folder["path"]}/{group_path + "/" if group_path else ""}{dir_name}'
                if template_dir_name_split(dir_name) is not None:
                    result.append((dir_path, folder, group_path))
                    continue
                is_template_like = (TEMPLATE_DIR_SEPARATOR in dir_name
                                    or os.path.isfile(os.path.join(dir_path, TEMPLATE_CONFIG_FILE))
                                    or os.path.isfile(os.path.join(dir_path, 'service.py')))
                if is_template_like:
                    problem_list.append(f'{place}: a template folder is named {{templateId}}--{{name}}, the name in lowercase letters, digits, - and _')
                    continue
                if depth >= TEMPLATE_GROUP_DEPTH_MAX:
                    problem_list.append(f'{place}: groups of templates are nested {TEMPLATE_GROUP_DEPTH_MAX} deep at most; not read')
                    continue
                group_read(dir_path, folder, f'{group_path}/{dir_name}' if group_path else dir_name, depth + 1)

        for folder in folder_list:
            if os.path.isdir(folder['path']):
                group_read(folder['path'], folder, '', 0)
        return result

    def _folder_entry_list(self, folder_list):
        """(dir_path, folder) of every folder of the folders, dot names skipped."""
        result = []
        for folder in folder_list:
            if not os.path.isdir(folder['path']):
                continue
            for dir_name in sorted(os.listdir(folder['path'])):
                dir_path = os.path.join(folder['path'], dir_name)
                if os.path.isdir(dir_path) and not dir_name.startswith('.'):
                    result.append((dir_path, folder))
        return result

    def _instance_scan(self, folder_list):
        problem_list = []
        found_by_id = {}
        for dir_path, folder in self._folder_entry_list(folder_list):
            dir_name = os.path.basename(dir_path)
            split = instance_dir_name_split(dir_name)
            if split is None:
                problem_list.append(f'{folder["path"]}/{dir_name}: an instance folder is named {{templateName}}-inst-{{serviceId}}')
                continue
            service_id = split[1]
            if service_id in found_by_id:
                problem_list.append(f'{folder["path"]}/{dir_name}: the service id {service_id} is also the folder {found_by_id[service_id][0]}; the first is used')
                continue
            found_by_id[service_id] = (dir_path, folder)

        for service_id in list(self.instance_by_id):
            if service_id not in found_by_id:
                instance = self.instance_by_id.pop(service_id)
                instance.stop()
                self.instance_script_by_id.pop(service_id, None)
                self.kernel_log.kernel('info', 'registry', f'{instance.label_get()} is gone: its folder {instance.dir_name} is not there')
        for service_id, (dir_path, folder) in found_by_id.items():
            self._instance_refresh(service_id, dir_path, folder)
        return problem_list

    def _instance_refresh(self, service_id, dir_path, folder):
        dir_name = os.path.basename(dir_path)
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
            service_config = self._service_config_read(config_path, service_id, dir_name, folder['kind'])
            if script.status != 'ready':
                error_message = script.message
            else:
                service_config['config'] = config_normalize(service_config['config'], script.expose)
                if service_config['dependencyList'] is None:
                    service_config['dependencyList'] = [dict(item) for item in script.expose['dependencyList']]
                if folder['kind'] == 'app' and script.expose.get('infra') is not None:
                    error_message = 'an app instance declares no expose.infra; it is in a folder of app instances'
        except ValueError as error:
            error_message = str(error)
        if service_config is not None and service_config['dependencyList'] is None:
            service_config['dependencyList'] = []
        signature = (dir_path, folder['kind'], config_mtime, script.load_count, error_message)

        instance = self.instance_by_id.get(service_id)
        if instance is not None and instance.signature == signature:
            return
        if instance is not None:
            instance.stop()
            self.kernel_log.kernel('info', 'lifecycle', f'{instance.label_get()} restarted: its folder, {SERVICE_CONFIG_FILE} or {SERVICE_SCRIPT_FILE} changed')
        else:
            self.kernel_log.kernel('info', 'registry', f'{folder["kind"]} instance {dir_name} found in {folder["path"]}', {'origin': folder['origin']})
        instance = ServiceInstance(service_id, dir_path, folder, script, self)
        instance.signature = signature
        self.instance_by_id[service_id] = instance
        if error_message:
            instance.error_set(error_message, service_config)
            self.kernel_log.kernel('error', 'lifecycle', f'{instance.label_get()} cannot start: {error_message}')
            return
        if service_config['isEnabled']:
            instance.service_config = service_config
            wait_message = self.dependency_wait_message_get(instance)
            if wait_message:
                instance.wait_set(service_config, wait_message)
                self.kernel_log.kernel('info', 'lifecycle', f'{instance.label_get()} is waiting: {wait_message}', {'serviceId': service_id})
                return
        instance.start(service_config)

    def _service_config_read(self, config_path, service_id, dir_name, folder_kind):
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
        kind = raw.get('kind', folder_kind)
        if kind != folder_kind:
            raise ValueError(f'kind in {SERVICE_CONFIG_FILE} is {kind}, but the folder holds {folder_kind} instances')
        template = raw.get('template')
        if not isinstance(template, dict) or not all(isinstance(template.get(key), str) and template[key] != '' for key in ['templateId', 'name', 'versionId']):
            raise ValueError(f'{SERVICE_CONFIG_FILE} needs template: {{ templateId, name, versionId }}, the template the instance was created from')
        config = raw.get('config') or {}
        if not isinstance(config, dict):
            raise ValueError(f'config in {SERVICE_CONFIG_FILE} must be a mapping')
        dependency_list = None
        if raw.get('dependencyList') is not None:
            try:
                dependency_list = dependency_list_normalize(raw.get('dependencyList'), f'dependencyList in {SERVICE_CONFIG_FILE}')
            except ServiceDefineError as error:
                raise ValueError(str(error))
        provision = raw.get('provision')
        if provision is not None and not isinstance(provision, dict):
            raise ValueError(f'provision in {SERVICE_CONFIG_FILE} must be a mapping')
        return {
            'serviceId': service_id,
            'name': name,
            'description': str(raw.get('description') or ''),
            'kind': kind,
            'isEnabled': raw.get('isEnabled', True) is not False,
            'timeCreated': str(raw.get('timeCreated') or ''),
            'template': {key: template[key] for key in ['templateId', 'name', 'versionId']},
            'provision': provision,
            'dependencyList': dependency_list,
            'isDependencyDynamicAllowed': raw.get('isDependencyDynamicAllowed', False) is True,
            'config': config,
        }

    # ---------- the kernel: reconcile ----------

    def _reconcile(self, folder_list, doc_page_problem_list):
        """After a scan: which infra names are required (by the instances and the
        kernel), which are provided, which to provision; the routes checked."""
        problem_list = list(doc_page_problem_list)
        required_by_name = {}

        def require(name, consumer):
            required_by_name.setdefault(name, []).append(consumer)

        require(INFRA_LOGGING_NAME, {'serviceId': '', 'name': 'the kernel', 'kind': 'kernel', 'isRequired': False})
        for instance in self.instance_by_id.values():
            if not instance.service_config.get('isEnabled', True):
                continue
            for item in instance.dependency_list_get():
                require(item['name'], {'serviceId': instance.service_id, 'name': instance.service_config.get('name', ''),
                                       'kind': instance.kind, 'isRequired': item['isRequired']})

        provider_list_by_name = {}
        for instance in self.instance_by_id.values():
            name = instance.infra_name_get()
            if name:
                provider_list_by_name.setdefault(name, []).append(instance)
        template_list_by_name = {}
        for template in self.template_by_id.values():
            name = template.infra_name_get()
            if name:
                template_list_by_name.setdefault(name, []).append(template)

        # a dependency cycle among infra services: reported, not refused (the
        # queue-cycle check refuses a call that would wait for itself)
        for cycle in self._infra_cycle_list_get(provider_list_by_name):
            problem_list.append(f'the infra services depend on one another in a cycle: {" -> ".join(cycle)}')

        for name, consumer_list in required_by_name.items():
            if name in provider_list_by_name:
                continue
            problem = self._provision(name, consumer_list, template_list_by_name.get(name, []))
            if problem:
                problem_list.append(problem)
            else:
                for instance in self.instance_by_id.values():
                    if instance.infra_name_get() == name:
                        provider_list_by_name.setdefault(name, []).append(instance)

        for name, service_id in list(self.route_table.route_by_name.items()):
            provider_list = provider_list_by_name.get(name, [])
            if not any(instance.service_id == service_id for instance in provider_list):
                problem_list.append(f'the route of the infra service {name} names {service_id}, which is not an instance providing it; the default route is used')

        # the instances waiting for a required infra service, started when it is
        # available: infra instances first, so that one waiting for another
        # can follow in the same tick
        for instance in sorted(self.instance_by_id.values(), key=lambda item: (item.kind != 'infra', item.service_id)):
            if instance.start_if_ready():
                self.kernel_log.kernel('info', 'lifecycle', f'{instance.label_get()} starts: its dependencies are available', {'serviceId': instance.service_id})

        info_by_name = {}
        for name in sorted(set(required_by_name) | set(provider_list_by_name) | set(template_list_by_name)):
            provider_list = provider_list_by_name.get(name, [])
            current = self.route_table.current_get(name, provider_list)
            if current is None:
                status = 'notProvided'
            elif current.status == 'ready':
                status = 'available'
            else:
                status = 'unavailable'
            storage = None
            if current is not None and current.expose is not None and current.expose.get('infra'):
                storage = current.expose['infra'].get('storage')
            info_by_name[name] = {
                'name': name,
                'serviceId': current.service_id if current is not None else '',
                'status': status,
                'message': '' if current is None or status == 'available' else current.message,
                'isRouteExplicit': self.route_table.route_is_explicit(name, current),
                'providerList': [{'serviceId': instance.service_id, 'name': instance.service_config.get('name', ''),
                                  'status': instance.status, 'isProvisioned': instance.is_provisioned()} for instance in provider_list],
                'consumerList': required_by_name.get(name, []),
                'templateList': [{'templateId': template.template_id, 'name': template.name, 'provision': template.provision,
                                  'status': template.status} for template in template_list_by_name.get(name, [])],
                'storage': storage,
            }
        self.infra_info_by_name = info_by_name
        if problem_list != self.kernel_problem_list:
            for problem in problem_list:
                if problem not in self.kernel_problem_list:
                    self.kernel_log.kernel('warn', 'registry', problem)
            self.kernel_problem_list = problem_list
        self.reconcile_count += 1
        self.time_reconciled = time_text_get()

    def _infra_cycle_list_get(self, provider_list_by_name):
        edge_by_name = {}
        for name, provider_list in provider_list_by_name.items():
            edge_by_name[name] = sorted({item['name'] for instance in provider_list for item in instance.dependency_list_get()})
        cycle_list = []
        for start in edge_by_name:
            path = [start]
            stack = [iter(edge_by_name.get(start, []))]
            visited = set()
            while stack:
                next_name = next(stack[-1], None)
                if next_name is None:
                    stack.pop()
                    path.pop()
                    continue
                if next_name == start:
                    cycle = path + [start]
                    if cycle[0] == min(cycle[:-1]):
                        cycle_list.append(cycle)
                    continue
                if next_name in path or next_name in visited:
                    continue
                visited.add(next_name)
                path.append(next_name)
                stack.append(iter(edge_by_name.get(next_name, [])))
        return cycle_list

    def _provision(self, name, consumer_list, template_list):
        """An instance of a template providing the name, created where the first
        consumer lives; '' when done (or nothing to do), the problem otherwise."""
        candidate_list = sorted([template for template in template_list if template.provision == 'auto' and template.status == 'ready'],
                                key=lambda template: template.template_id)
        consumer_label = ', '.join(f'{item["name"]}' + (f' ({item["serviceId"]})' if item['serviceId'] else '') for item in consumer_list)
        if len(candidate_list) == 0:
            has_manual = any(template.provision == 'manual' for template in template_list)
            reason = 'no template provides it with provision auto' if has_manual or len(template_list) == 0 else 'the template providing it is not ready'
            return f'the infra service {name} is required by {consumer_label} and no instance provides it; {reason}'
        template = candidate_list[0]
        doc_page_alias = ''
        for consumer in consumer_list:
            instance = self.instance_by_id.get(consumer['serviceId'])
            if instance is not None and instance.folder['origin']['kind'] == 'docPage':
                doc_page_alias = instance.folder['origin']['alias']
                break
        folder = self._instance_folder_default_get('infra', doc_page_alias)
        if folder is None:
            return f'the infra service {name} cannot be provisioned from {template.name}: no folder for infra instances (a doc page service-infra/ folder, or instanceFolderList with kind infra)'
        name_base = f'{template.name} (auto)'
        instance_name = name_base
        suffix = 2
        while any(instance.service_config.get('name') == instance_name for instance in self.instance_by_id.values()):
            instance_name = f'{name_base} {suffix}'
            suffix += 1
        provision = {'mode': 'auto', 'infra': name, 'requiredBy': consumer_label, 'time': time_text_get()}
        try:
            instance = self._instance_create_in_folder(template, folder, instance_name,
                                                       f'provisioned by the kernel: {name} is required by {consumer_label}', {}, provision)
        except ServiceError as error:
            if self.provision_failure_by_name.get(name) != error.message:
                self.provision_failure_by_name[name] = error.message
            return f'the infra service {name} could not be provisioned from {template.name}: {error.message}'
        self.provision_failure_by_name.pop(name, None)
        self.kernel_log.kernel('info', 'provision', f'{instance.label_get()} provisioned from {template.name} for the infra service {name}, required by {consumer_label}',
                               {'serviceId': instance.service_id, 'templateId': template.template_id, 'folder': folder['path']})
        return ''

    # ---------- the kernel: dependencies, health, routes ----------

    def infra_provider_list_get(self, name):
        with self.lock:
            return [instance for instance in self.instance_by_id.values() if instance.infra_name_get() == name]

    def infra_resolve(self, name):
        """The instance a call of the infra service goes to; ServiceError -7 when none."""
        provider_list = self.infra_provider_list_get(name)
        current = self.route_table.current_get(name, provider_list)
        if current is None:
            raise ServiceError(-7, f'the infra service {name} is unavailable: no instance provides it')
        return current

    def dependency_wait_message_get(self, instance):
        """Why an instance cannot start yet: its required infra services that are
        not available; '' when it can."""
        missing_list = [f'{item["name"]} ({item["status"]})' for item in self.dependency_status_list_get(instance)
                        if item['isRequired'] and item['status'] != 'available']
        if len(missing_list) == 0:
            return ''
        return f'waiting for the infra service {", ".join(missing_list)}'

    def dependency_status_list_get(self, instance):
        """The dependencies of an instance with the state of each: available (a
        ready instance answers it), unavailable (an instance provides it but is
        not ready), notProvided (none)."""
        result = []
        with self.lock:
            instance_list = list(self.instance_by_id.values())
        for item in instance.dependency_list_get():
            provider_list = [candidate for candidate in instance_list if candidate.infra_name_get() == item['name']]
            current = self.route_table.current_get(item['name'], provider_list)
            if current is None:
                status, service_id, message = 'notProvided', '', 'no instance provides it'
            elif current.status == 'ready':
                status, service_id, message = 'available', current.service_id, ''
            else:
                status, service_id, message = 'unavailable', current.service_id, f'{current.status}: {current.message}'
            result.append({**item, 'status': status, 'serviceId': service_id, 'message': message})
        return result

    def health_get(self, instance, dependency_status_list):
        """(health, message) of an instance: what the kernel sees (its lifecycle
        state, its dependencies) and what the instance reports of itself."""
        if instance.status == 'disabled':
            return 'unhealthy', 'disabled'
        if instance.status == 'error':
            return 'unhealthy', instance.message
        if instance.status == 'waiting':
            return 'unhealthy', instance.message
        if instance.status == 'starting':
            return 'degraded', 'starting'
        health = 'healthy'
        message_list = []
        for item in dependency_status_list:
            if item['status'] == 'available':
                continue
            message_list.append(f'{item["name"]} is {item["status"]}')
            if item['isRequired']:
                health = 'unhealthy'
            elif health == 'healthy':
                health = 'degraded'
        context = instance.context
        if context is not None and context.health_reported in ('degraded', 'unhealthy'):
            if context.health_reported == 'unhealthy' or health == 'healthy':
                health = context.health_reported
            message_list.append(f'reported: {context.health_reported_message or context.health_reported}')
        return health, '; '.join(message_list)

    def infra_route_set(self, name, service_id):
        """Routes an infra name to one instance providing it ('' for the default route)."""
        if not isinstance(name, str) or name == '':
            raise ServiceError(-1, 'name must be an infra service name')
        with self.lock:
            if service_id:
                instance = self.instance_by_id.get(service_id)
                if instance is None:
                    raise ServiceError(-3, f'the service instance {service_id} is not found')
                if instance.infra_name_get() != name:
                    raise ServiceError(-1, f'{instance.label_get()} does not provide the infra service {name}')
                self.route_table.route_by_name[name] = service_id
            else:
                self.route_table.route_by_name.pop(name, None)
            try:
                self._kernel_state_write()
            except OSError as error:
                raise ServiceError(-1, f'{KERNEL_STATE_FILE} could not be written: {error}')
        self.kernel_log.kernel('info', 'route', f'the infra service {name} is routed to {service_id or "its default instance"}')
        self.scan()
        return self.infra_info_by_name.get(name)

    def instance_dependency_added(self, service_id, item):
        """An instance added a dependency at runtime (infra_require): written into
        its service.yaml without restarting it."""
        with self.lock:
            instance = self.instance_by_id.get(service_id)
            if instance is None:
                return
            service_config = dict(instance.service_config)
            dependency_list = [dict(entry) for entry in service_config.get('dependencyList', [])]
            if not any(entry['name'] == item['name'] for entry in dependency_list):
                dependency_list.append(dict(item))
            service_config['dependencyList'] = dependency_list
            self._service_config_write(instance, service_config)
        self.kernel_log.kernel('info', 'dependency', f'{instance.label_get()} requires the infra service {item["name"]} now (added at runtime)',
                               {'serviceId': service_id, 'dependency': item})
        self.scan()

    def instance_dependency_set(self, service_id, dependency_list, is_dynamic_allowed=None):
        """The dependency list of an instance replaced (and whether it may add
        more at runtime); the instance is restarted with it."""
        try:
            dependency_list = dependency_list_normalize(dependency_list, 'dependencyList')
        except ServiceDefineError as error:
            raise ServiceError(-1, str(error))
        with self.lock:
            instance = self.instance_get(service_id)
            service_config = dict(instance.service_config)
            if not service_config.get('serviceId'):
                raise ServiceError(-1, f'{SERVICE_CONFIG_FILE} of {instance.dir_name} cannot be used: {instance.message}')
            service_config['dependencyList'] = dependency_list
            if is_dynamic_allowed is not None:
                service_config['isDependencyDynamicAllowed'] = bool(is_dynamic_allowed)
            self._service_config_write(instance, service_config, is_restart=True)
        self.kernel_log.kernel('info', 'dependency', f'the dependencies of {instance.label_get()} are set to {", ".join(item["name"] for item in dependency_list) or "none"}',
                               {'serviceId': service_id, 'dependencyList': dependency_list})
        self.scan()
        return self.instance_get(service_id).info_get()

    def instance_enable_set(self, service_id, is_enabled):
        with self.lock:
            instance = self.instance_get(service_id)
            service_config = dict(instance.service_config)
            if not service_config.get('serviceId'):
                raise ServiceError(-1, f'{SERVICE_CONFIG_FILE} of {instance.dir_name} cannot be used: {instance.message}')
            service_config['isEnabled'] = bool(is_enabled)
            self._service_config_write(instance, service_config, is_restart=True)
        self.kernel_log.kernel('info', 'lifecycle', f'{instance.label_get()} is {"enabled" if is_enabled else "disabled"}', {'serviceId': service_id})
        self.scan()
        return self.instance_get(service_id).info_get()

    def _service_config_write(self, instance, service_config, is_restart=False):
        """Rewrites an instance's service.yaml (the backend's own file: it
        created it, comment-free). Without is_restart the instance keeps
        running with the config it has (its signature follows the file)."""
        yaml_write(instance.config_path, service_config_yaml_build(service_config))
        instance.service_config = service_config
        if not is_restart and instance.signature is not None:
            config_mtime = os.path.getmtime(instance.config_path)
            instance.signature = (instance.signature[0], instance.signature[1], config_mtime, instance.signature[3], instance.signature[4])

    def instance_delete(self, service_id):
        """Stops the instance, runs its onDestroy hook, and renames its folder to
        .deleted-{dirName}-{time}: its data is kept, and a person removes the
        folder. An instance others depend on is deleted all the same (they
        report it); the kernel provisions a new one when the name is required."""
        with self.lock:
            instance = self.instance_get(service_id)
            self.instance_by_id.pop(service_id, None)
            self.instance_script_by_id.pop(service_id, None)
            for name, route_id in list(self.route_table.route_by_name.items()):
                if route_id == service_id:
                    self.route_table.route_by_name.pop(name)
                    self._kernel_state_write()
        instance.stop(is_destroy=True)
        if not instance.destroyed_event.wait(instance.expose['lifecycle']['hookTimeoutSecond'] + 5 if instance.expose else 35):
            self.kernel_log.kernel('warn', 'lifecycle', f'{instance.label_get()} did not stop in time; its folder is renamed all the same')
        dir_path_deleted = os.path.join(os.path.dirname(instance.dir_path), f'{INSTANCE_DELETED_PREFIX}{instance.dir_name}-{time_text_get()}')
        try:
            os.rename(instance.dir_path, dir_path_deleted)
        except OSError as error:
            raise ServiceError(-1, f'the folder of {instance.dir_name} could not be renamed: {error}')
        self.kernel_log.kernel('info', 'lifecycle', f'{instance.label_get()} deleted; its folder is kept as {os.path.basename(dir_path_deleted)}',
                               {'serviceId': service_id, 'folder': dir_path_deleted})
        self.scan()
        return {'serviceId': service_id, 'folderDeleted': dir_path_deleted}

    # ---------- the kernel: log and reconcile thread ----------

    def _log_flush(self):
        """Hands the kernel log to the logging infra instance when there is a ready one."""
        if self.kernel_log.buffer_count() == 0:
            return
        try:
            current = self.infra_resolve(INFRA_LOGGING_NAME)
        except ServiceError:
            return
        if current.status != 'ready':
            return

        def write_batch(batch):
            result = self.api_call({'serviceId': current.service_id}, 'logWrite', {'recordList': batch}, ServiceCaller('kernel'))
            if result['code'] != 0:
                raise RuntimeError(result.get('message', ''))

        self.kernel_log.flush(write_batch)

    def reconcile_thread_start(self):
        """The kernel's own tick: a scan (and so a reconcile and a log flush)
        every reconcileIntervalSecond, so the backend keeps its registry,
        provisions and monitors without the page asking."""
        if self.reconcile_interval_second <= 0 or self.reconcile_thread is not None:
            return

        def run():
            while not self.reconcile_stop_event.wait(self.reconcile_interval_second):
                try:
                    self.scan()
                except Exception as error:
                    self.kernel_log.kernel('error', 'scan', f'the reconcile tick failed: {type(error).__name__}: {error}')
                    traceback.print_exc()

        self.reconcile_thread = threading.Thread(target=run, name='service-kernel-reconcile', daemon=True)
        self.reconcile_thread.start()

    # ---------- requests ----------

    def status_get(self):
        with self.lock:
            folder_list, doc_page_problem_list = self.folder_list_get()
            doc_page_info_list = []
            for doc_page in self.doc_page_list_get():
                doc_page_info_list.append({
                    'alias': doc_page['alias'],
                    'dir': doc_page['dir'],
                    'serviceFile': doc_page['serviceFile'],
                    'source': doc_page['source'],
                    'isDefault': doc_page['isDefault'],
                    'folderList': [{'path': folder['path'], 'pathWritten': folder['pathWritten'], 'role': folder['role'], 'kind': folder['kind'],
                                    'isDefault': folder['isDefault'], 'isExisting': os.path.isdir(folder['path'])}
                                   for folder in folder_list if folder['origin']['kind'] == 'docPage' and folder['origin']['dir'] == doc_page['dir']],
                })
            logging_info = self.infra_info_by_name.get(INFRA_LOGGING_NAME) or {}
            return {
                'timeStarted': self.time_started,
                'configPath': self.config_path,
                'templateFolderList': [{'path': item['path'], 'kind': item['kind'], 'origin': item['origin']} for item in folder_list if item['role'] == 'template'],
                'instanceFolderList': [{'path': item['path'], 'kind': item['kind'], 'isDefault': item['isDefault'], 'origin': item['origin']} for item in folder_list if item['role'] == 'instance'],
                'templateCount': len(self.template_by_id),
                'instanceCount': len(self.instance_by_id),
                'scanProblemList': list(self.scan_problem_list),
                'kernel': {
                    'timeStarted': self.time_started,
                    'builtInDir': self.built_in_dir,
                    'kernelStateFile': self.kernel_state_path,
                    'docPageList': doc_page_info_list,
                    'reconcileIntervalSecond': self.reconcile_interval_second,
                    'reconcileCount': self.reconcile_count,
                    'timeReconciled': self.time_reconciled,
                    'problemList': list(self.kernel_problem_list),
                    'log': self.kernel_log.info_get(),
                    'loggingServiceId': logging_info.get('serviceId', ''),
                    'loggingStatus': logging_info.get('status', 'notProvided'),
                },
            }

    def registry_get(self):
        """Everything the Services tab shows, in one answer."""
        self.scan()
        with self.lock:
            return {
                'templateList': [template.info_get() for template in self.template_by_id.values()],
                'instanceList': [instance.info_get() for instance in self.instance_by_id.values()],
                'infraList': [dict(info) for info in self.infra_info_by_name.values()],
                'status': self.status_get(),
            }

    def infra_list_get(self):
        self.scan()
        with self.lock:
            return [dict(info) for info in self.infra_info_by_name.values()]

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

    def _instance_folder_default_get(self, kind, doc_page_alias=''):
        """Where an instance of the kind is created: the default instance folder
        of that kind of the doc page named, else of the default doc page, else
        the config's default of that kind, else its first of that kind."""
        folder_list, _ = self.folder_list_get()
        candidate_list = [folder for folder in folder_list if folder['role'] == 'instance' and folder['kind'] == kind]
        doc_page_default = next((item for item in self.doc_page_list_get() if item['isDefault']), None)
        for alias in [doc_page_alias, doc_page_default['alias'] if doc_page_default else '']:
            if not alias:
                continue
            for folder in candidate_list:
                if folder['origin']['kind'] == 'docPage' and folder['origin']['alias'] == alias and folder['isDefault']:
                    return folder
        for folder in candidate_list:
            if folder['origin']['kind'] == 'folder' and folder['isDefault']:
                return folder
        for folder in candidate_list:
            if folder['origin']['kind'] == 'folder':
                return folder
        for folder in candidate_list:
            if folder['isDefault']:
                return folder
        return candidate_list[0] if candidate_list else None

    def instance_create(self, template_id, name_input, description, config, doc_page_alias=''):
        """A new instance from a template: the template folder copied (but its own
        file and what is installed) into {templateName}-inst-{serviceId}, in the
        instance folder of the template's kind of the doc page named (else the
        default one), and a service.yaml recording the template, with the
        template's config under the config given and the dependencies its
        script declares."""
        try:
            name = instance_name_normalize(name_input)
        except ValueError as error:
            raise ServiceError(-1, str(error))
        if config is not None and not isinstance(config, dict):
            raise ServiceError(-1, 'config must be a mapping')
        self.scan()
        with self.lock:
            template = self.template_by_id.get(template_id)
            if template is None:
                raise ServiceError(-3, f'the service template {template_id} is not found')
            if template.status != 'ready':
                raise ServiceError(-1, f'the service template {template.name} cannot be used: {template.message}')
            if any(instance.service_config.get('name') == name for instance in self.instance_by_id.values()):
                raise ServiceError(-1, f'a service instance is already named {name}')
            alias = doc_page_alias or (template.folder['origin']['alias'] if template.folder['origin']['kind'] == 'docPage' else '')
            folder = self._instance_folder_default_get(template.kind, alias)
            if folder is None:
                raise ServiceError(-1, f'no folder for {template.kind} instances: a doc page service-{template.kind}/ folder, or instanceFolderList with kind {template.kind}')
            instance = self._instance_create_in_folder(template, folder, name, description, config or {}, None)
            self.kernel_log.kernel('info', 'lifecycle', f'{instance.label_get()} created from {template.name} in {folder["path"]}',
                                   {'serviceId': instance.service_id, 'templateId': template.template_id})
            return instance.info_get()

    def _instance_create_in_folder(self, template, folder, name, description, config, provision):
        """The copy itself; under self.lock. Raises ServiceError."""
        try:
            config_full = config_normalize({**template.template_config['config'], **config}, template.script.expose)
        except ValueError as error:
            raise ServiceError(-1, str(error))
        service_id = id_ms48_create(lambda candidate: candidate in self.instance_by_id)
        dir_path = os.path.join(folder['path'], instance_dir_name_build(template.name, service_id))
        dir_path_creating = os.path.join(folder['path'], f'{INSTANCE_CREATING_PREFIX}{service_id}')
        service_config = {
            'serviceId': service_id,
            'name': name,
            'description': str(description or ''),
            'kind': template.kind,
            'isEnabled': True,
            'timeCreated': time_text_get(),
            'template': template.record_get(),
            'provision': provision,
            'dependencyList': [dict(item) for item in template.script.expose['dependencyList']],
            'isDependencyDynamicAllowed': False,
            'config': config_full,
        }
        # copied under a dot name and renamed when complete, so a scan
        # never sees half an instance
        try:
            os.makedirs(folder['path'], exist_ok=True)
            shutil.copytree(template.dir_path, dir_path_creating, ignore=instance_copy_ignore)
            yaml_write(os.path.join(dir_path_creating, SERVICE_CONFIG_FILE), service_config_yaml_build(service_config))
            os.rename(dir_path_creating, dir_path)
        except OSError as error:
            shutil.rmtree(dir_path_creating, ignore_errors=True)
            raise ServiceError(-1, f'the instance folder could not be created: {error}')
        self._instance_refresh(service_id, dir_path, folder)
        return self.instance_by_id[service_id]

    # ---------- calls: from the page and between instances ----------

    def api_call(self, target, api_name, params, caller):
        """A call of an api: the result of a sync api, the job of an async one.

        target   { serviceId }, { templateId, versionId? } or { infra: name }: what the call names
        caller   the ServiceCaller, as the runtime knows it: page for an http
                 request, service for ServiceContext.service_call, kernel for the kernel

        Raises ServiceError for a call that cannot be made; the failure of
        the api itself is its result.
        """
        target = target_normalize(target)
        instance = self.target_resolve(target, caller)
        if target['infra'] and instance.status != 'ready':
            raise ServiceError(-7, f'the infra service {target["infra"]} is unavailable: {instance.label_get()} is {instance.status}: {instance.message}')
        if instance.status in ('error', 'disabled', 'waiting'):
            raise ServiceError(-4, f'the service {instance.service_id} is not ready ({instance.status}): {instance.message}')
        api_define = next((item for item in instance.expose['apiList'] if item['name'] == api_name), None)
        if api_define is None:
            raise ServiceError(-3, f'the service {instance.service_config.get("name", instance.service_id)} has no api {api_name}')
        self.call_authorize(caller, instance, api_define, target)
        for item in self.dependency_status_list_get(instance):
            if item['onUnavailable'] == 'reject' and item['isRequired'] and item['status'] != 'available':
                raise ServiceError(-7, f'{api_name} of {instance.service_id} is refused: its dependency {item["name"]} is {item["status"]} (onUnavailable: reject)')
        param_dict = api_param_dict_build(api_define, params)

        if not api_define['isQueued']:
            return instance.call_direct(api_define, param_dict, caller)
        if instance.service_id in caller.chain:
            raise ServiceError(-1, f'{api_name} of {instance.service_id} is refused: the call passed through it '
                                   f'({" -> ".join(caller.chain)}), and its queue would wait for itself')
        if api_define['execution'] == 'async':
            task = ServiceTask(instance.service_id, api_define, param_dict, caller, id_ms48_create(instance.job_id_is_used))
            instance.submit(task)
            return {'code': 0, 'data': task.job_info_get()}
        task = ServiceTask(instance.service_id, api_define, param_dict, caller)
        instance.submit(task)
        if not task.done_event.wait(self.api_wait_second_max):
            return {'code': -6, 'message': f'{api_name} did not finish in {self.api_wait_second_max:g} s; it is still queued or running'}
        return task.result

    def target_resolve(self, target, caller=None):
        """The instance a target names; ServiceError -1 for a bad target, -3 when
        none (-7 for an infra name nobody provides).

        { serviceId }: that instance, whatever its state.
        { templateId, versionId? }: the instances that recorded that template
        (and version) when they were created, the caller itself left out (a
        service asking for an instance of a template asks for another one);
        a ready one first, the oldest first, so the same one answers while
        nothing changes. One that is not ready is chosen only when none is,
        so the call fails with its reason (-4).
        { infra: name }: the instance the kernel routes the name to.
        """
        target = target_normalize(target)
        if target['serviceId']:
            return self.instance_get(target['serviceId'])
        if target['infra']:
            return self.infra_resolve(target['infra'])
        caller_id_list = [caller.service_id, caller.dashboard_service_id] if caller is not None else []
        candidate_list = self._instance_list_of_target(target, caller_id_list)
        if len(candidate_list) == 0:
            self.scan()
            candidate_list = self._instance_list_of_target(target, caller_id_list)
        if len(candidate_list) == 0:
            raise ServiceError(-3, f'no service instance is {target_label_get(target)}')
        candidate_list.sort(key=lambda instance: (instance.status != 'ready', instance.service_id))
        return candidate_list[0]

    def _instance_list_of_target(self, target, caller_id_list):
        with self.lock:
            result = []
            for instance in self.instance_by_id.values():
                record = instance.service_config.get('template') or {}
                if instance.service_id in caller_id_list or record.get('templateId') != target['templateId']:
                    continue
                if target['versionId'] and record.get('versionId') != target['versionId']:
                    continue
                result.append(instance)
            return result

    def call_authorize(self, caller, instance, api_define, target=None):
        """Whether the caller may call the api of the instance; raises ServiceError -2 when not.

        The one place every call passes, from the page and from other
        instances alike, after the target is resolved and before the call is
        queued. It checks what the api declares (callerKindList), and, for a
        service calling an infra service by name, that the name is in the
        caller's dependency list (declared by its template, or added at
        runtime when it may).

        TODO authorization: the place for a policy of the backend: which
        caller may call which instance and api (rules in the backend config,
        or declared by the callee's script and kept per instance, the
        consumer lists the connection templates keep by themselves today),
        the end user behind a page request (a credential the backend takes
        from the http request, never from params, carried by the caller to
        every instance the call passes through), and the dashboards of the
        page, whose identity (dashboard_service_id) is a claim of the page.
        A target resolved by template would then skip the instances that
        refuse the caller, and a job would be read by its caller only.
        """
        if caller.kind not in api_define['callerKindList']:
            raise ServiceError(-2, f'{api_define["name"]} of {instance.service_id} is not answered to {caller.label_get()}: '
                                   f'only to {", ".join(api_define["callerKindList"])}')
        if caller.kind == 'service' and target is not None and target['infra']:
            with self.lock:
                caller_instance = self.instance_by_id.get(caller.service_id)
            name_list = caller_instance.dependency_list_get() if caller_instance is not None else []
            if not any(item['name'] == target['infra'] for item in name_list):
                raise ServiceError(-2, f'{caller.label_get()} may not use the infra service {target["infra"]}: it is not in its dependencyList')

    def job_get(self, service_id, job_id):
        instance = self.instance_get(service_id)
        task = instance.job_get(job_id)
        if task is None:
            raise ServiceError(-3, f'the job {job_id} of {service_id} is not found (only the last {JOB_DONE_KEEP_MAX} finished jobs are kept)')
        return task.job_info_get()

    def stop_all(self):
        self.reconcile_stop_event.set()
        with self.lock:
            for instance in self.instance_by_id.values():
                instance.stop()
        deadline = time.time() + 5
        for instance in list(self.instance_by_id.values()):
            if instance.thread is not None:
                instance.thread.join(max(0, deadline - time.time()))
        self.kernel_log.kernel('info', 'registry', 'kernel stopped')


def service_config_yaml_build(service_config):
    """service.yaml as written: the keys in order, provision only when there is one."""
    result = {}
    for key in SERVICE_CONFIG_KEY_LIST:
        if key == 'provision' and not service_config.get('provision'):
            continue
        result[key] = service_config.get(key)
    return result
