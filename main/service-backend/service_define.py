"""What the script of a service is and what it exposes.

Design: doc_page_impl_service.md#what-a-service-script-exposes

The script of a service is a Python class deriving from Service, in the file
service.py of a template folder, and of every instance folder created from
it (each instance runs its own copy), named by the module variable
SERVICE_CLASS. The class says what it exposes in two places, both next to
the code they describe:

    class NoteDb(Service):
        expose = {
            'meta': {...},               label, description, author, version, ...
            'configDefineList': [...],   the shape of an instance's config
            'dashboardList': [...],      the dashboards, keyed by id
            'dashboardRemote': {...},    where the federated module of the dashboards is
            'anythingElse': ...,         kept as written (non-standard names)
        }

        @api(kind='query', description='...', params=[param('limit', 'integer', '...', default=50)],
             result=returns('array', '...'))
        def noteList(self, limit=50):
            ...

The method name is the name of the api on the wire, which is why api methods
are written in camelCase like every other name the page sees.

expose_build() normalizes both into one exposure, the way compExposeNormalize
does for components: a wrong shape fails when the script is loaded, with the
place of the mistake, not later in a dashboard.
"""

import os
import re
import threading

# the types a parameter or a result may have: the type names of JSON Schema,
# plus 'any' for a value the type does not describe
SCHEMA_TYPE_LIST = ['string', 'integer', 'number', 'boolean', 'object', 'array', 'null', 'any']

# query: reads the state only. command: changes it
API_KIND_LIST = ['query', 'command']

# sync: the call is answered when the api is done. async: the call is
# answered at once with a job, which runs in the instance's queue; the job is
# asked for its state and result (GET /job/get)
API_EXECUTION_LIST = ['sync', 'async']

# who a call comes from, as the runtime knows it. page: an http request (the
# page through the development server, or any http client of the backend).
# service: another service instance, through ServiceContext.service_call
CALLER_KIND_LIST = ['page', 'service']

# default: the dashboard a document shows when it places the service.
# config: the dashboard of the instance's settings (the Services tab).
# other: any further dashboard, chosen by its id
DASHBOARD_PURPOSE_LIST = ['default', 'config', 'other']

CONFIG_TYPE_LIST = ['string', 'integer', 'number', 'boolean']

EXPOSE_NAME_STANDARD_LIST = ['meta', 'configDefineList', 'dashboardList', 'dashboardRemote']

REGEX_DASHBOARD_ID = re.compile(r'^[a-z][a-zA-Z0-9-]*$')
REGEX_API_NAME = re.compile(r'^[a-z][a-zA-Z0-9]*$')

_VALUE_NONE = object()


class ServiceError(Exception):
    """An api refusing or failing with a code of the formatted response.

    -1 bad request or failure, -2 the caller may not call it, -3 something
    the request names is not found.
    """

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


class ServiceDefineError(Exception):
    """A service script whose declaration cannot be used."""


class ServiceCaller:
    """Who a call comes from, as the runtime knows it: never what a request says it is.

    kind                  page (an http request) or service (another instance)
    service_id            the calling instance; '' for page
    dashboard_service_id  for page: the instance whose dashboard asked, '' for
                          none. a claim of the page, not checked: every
                          dashboard runs in the same page
    chain                 the instances the call passed through, the caller
                          included (page -> A -> B: B is called with (A,)).
                          a queued api of an instance already in the chain is
                          refused: its queue waits for this call, a deadlock
    """

    def __init__(self, kind, service_id='', dashboard_service_id='', chain=()):
        self.kind = kind
        self.service_id = service_id
        self.dashboard_service_id = dashboard_service_id
        self.chain = tuple(chain)

    def info_get(self):
        return {'kind': self.kind, 'serviceId': self.service_id, 'dashboardServiceId': self.dashboard_service_id}

    def label_get(self):
        if self.kind == 'service':
            return f'the service {self.service_id}'
        if self.dashboard_service_id:
            return f'the page (a dashboard of {self.dashboard_service_id})'
        return 'the page'


class ServiceContext:
    """What a service instance is given: its identity, its folder, its config,
    who calls it, and the way to call other instances.

    service_id, name    the instance
    dir_path            the instance's folder: its own script and its data
    template            the template it was created from, as recorded in its
                        service.yaml: { templateId, name, versionId }. a
                        record only: the instance never reads the template
    config              the instance's config, with the defaults of configDefineList
    caller              the ServiceCaller of the api being run in this thread;
                        None outside an api (start, stop, a thread of its own)
    service_call, service_job_get, service_resolve
                        calls of the apis of other instances, as this instance
    """

    def __init__(self, service_id, name, dir_path, template, config, runtime=None):
        self.service_id = service_id
        self.name = name
        self.dir_path = dir_path
        self.template = template
        self.config = config
        # the runtime, for the calls of other instances (api_call, job_get, target_resolve)
        self._runtime = runtime
        # the caller and the job of the api being run, per thread: a queued
        # api runs in the instance's worker thread, an api with isQueued
        # False in the thread of its caller, both at once
        self._local = threading.local()

    @property
    def caller(self):
        return getattr(self._local, 'caller', None)

    @property
    def job_current(self):
        """The async job being run in this thread, so the api can report its progress; None otherwise."""
        return getattr(self._local, 'job', None)

    def call_enter(self, caller, job):
        """Set by the runtime around every api it runs; answers what call_exit restores."""
        previous = (self.caller, self.job_current)
        self._local.caller = caller
        self._local.job = job
        return previous

    def call_exit(self, previous):
        self._local.caller, self._local.job = previous

    def path_get(self, name):
        """A file of the instance's folder."""
        return os.path.join(self.dir_path, name)

    def job_progress_set(self, fraction, message=''):
        """The progress of the async job being run, 0..1, with a short text."""
        job = self.job_current
        if job is None:
            return
        job.progress = max(0.0, min(1.0, float(fraction)))
        job.progress_message = str(message)

    # ---------- calls of other instances ----------

    def service_call(self, target, api, params=None):
        """Calls an api of another instance, as this instance: what a sync api
        returned, the job of an async one; raises ServiceError with the call's
        code when it fails.

        target is { serviceId } (that instance) or { templateId, versionId? }
        (an instance created from that template, at that version; this
        instance itself is never chosen). The callee reads this instance as
        its context.caller. A sync call waits apiWaitSecondMax at most.
        """
        result = self._runtime.api_call(target, api, params, self._caller_self_get())
        if result['code'] != 0:
            raise ServiceError(result['code'], result.get('message', ''))
        return result['data']

    def service_job_get(self, service_id, job_id):
        """The job of an async call (its serviceId and jobId); raises ServiceError."""
        return self._runtime.job_get(service_id, job_id)

    def service_resolve(self, target):
        """The instance a call of target would go to, as listed ({ serviceId,
        name, template, status, expose, … }); raises ServiceError -3 when none."""
        return self._runtime.target_resolve(target, self._caller_self_get()).info_get()

    def _caller_self_get(self):
        caller_current = self.caller
        chain = caller_current.chain if caller_current is not None else ()
        return ServiceCaller('service', service_id=self.service_id, chain=chain + (self.service_id,))


class Service:
    """The base of every service script.

    Every service instance loads the service.py of its own folder, and one
    object of its class is created in the instance's own worker thread;
    every api of the instance runs in that thread, one at a time: an
    implementation never sees two calls at once and may keep a connection
    (sqlite) as a plain attribute. Two instances never share a module, so
    module-level state is never shared either.
    """

    expose = {}

    def __init__(self, context):
        self.context = context

    def start(self):
        """Called once before the first api: open the data, create it when new."""

    def stop(self):
        """Called once when the instance stops: close what start opened."""


def param(name, type, description='', default=_VALUE_NONE, isRequired=None, schema=None):
    """One parameter of an api. Without a default the parameter is required."""
    return {
        'name': name,
        'type': type,
        'description': description,
        'default': default,
        'isRequired': isRequired,
        'schema': schema,
    }


def returns(type, description='', schema=None):
    """The result of an api."""
    return {'type': type, 'description': description, 'schema': schema}


def api(kind='query', execution='sync', description='', params=(), result=None,
        callerKindList=None, isQueued=True):
    """Marks a method of a Service class as an api of the service.

    callerKindList  who may call it: page, service, or both (None, the default).
                    ['service']: an api for other instances only, never answered
                    to the page (credentials, a principal)
    isQueued        True: run in the instance's queue, one api at a time.
                    False: run at once in the thread of the caller (an http
                    request, the calling instance), beside whatever the queue
                    runs: the method guards the state it touches with locks.
                    for a sync api that must not wait behind the queue, or
                    that other instances call often
    """

    def decorate(method):
        method.__service_api__ = {
            'kind': kind,
            'execution': execution,
            'description': description,
            'params': list(params),
            'result': result,
            'callerKindList': list(callerKindList) if callerKindList is not None else list(CALLER_KIND_LIST),
            'isQueued': isQueued,
        }
        return method

    return decorate


# ---------- the exposure ----------

def expose_build(service_class, label, dir_path):
    """The normalized exposure of a service class; raises ServiceDefineError.

    label names the folder in the messages (a template, an instance);
    dir_path is the folder holding the script, its icon and its dashboards.
    """
    expose = getattr(service_class, 'expose', None)
    if not isinstance(expose, dict):
        raise ServiceDefineError(f'{label}: expose must be a mapping')
    expose_other = {key: value for key, value in expose.items() if key not in EXPOSE_NAME_STANDARD_LIST}
    if 'apiList' in expose_other:
        raise ServiceDefineError(f'{label}: apiList is not declared in expose; mark the methods with @api')
    dashboard_list = _dashboard_list_normalize(expose.get('dashboardList'), label)
    return {
        **expose_other,
        'meta': _meta_normalize(expose.get('meta'), label, dir_path),
        'configDefineList': _config_define_list_normalize(expose.get('configDefineList'), label),
        'apiList': _api_list_build(service_class, label),
        'dashboardList': dashboard_list,
        'dashboardRemote': _dashboard_remote_normalize(expose.get('dashboardRemote'), label, dir_path, dashboard_list),
    }


def _meta_normalize(meta, label, dir_path):
    place = f'{label}: expose.meta'
    if not isinstance(meta, dict):
        raise ServiceDefineError(f'{place} must be a mapping')
    label = meta.get('label')
    if not isinstance(label, str) or label == '':
        raise ServiceDefineError(f'{place}.label must be a non-empty string')
    for key in ['description', 'author', 'version', 'license', 'homepage', 'icon']:
        if meta.get(key) is not None and not isinstance(meta.get(key), str):
            raise ServiceDefineError(f'{place}.{key} must be a string')
    icon = meta.get('icon') or ''
    if icon and not os.path.isfile(os.path.join(dir_path, icon)):
        raise ServiceDefineError(f'{place}.icon names {icon}, which is not a file of the folder')
    tag_list = meta.get('tagList', [])
    if not isinstance(tag_list, list) or not all(isinstance(tag, str) for tag in tag_list):
        raise ServiceDefineError(f'{place}.tagList must be a list of strings')
    return {
        **meta,
        'label': label,
        'description': meta.get('description', ''),
        'author': meta.get('author', ''),
        'version': meta.get('version', '0.0.0'),
        'license': meta.get('license', ''),
        'homepage': meta.get('homepage', ''),
        'icon': icon,
        'tagList': tag_list,
    }


def _config_define_list_normalize(define_list, label):
    place = f'{label}: expose.configDefineList'
    if define_list is None:
        return []
    if not isinstance(define_list, list):
        raise ServiceDefineError(f'{place} must be a list')
    key_set = set()
    result = []
    for index, define in enumerate(define_list):
        if not isinstance(define, dict) or not isinstance(define.get('key'), str) or define['key'] == '':
            raise ServiceDefineError(f'{place}[{index}] needs a string key')
        if define['key'] in key_set:
            raise ServiceDefineError(f'{place} declares {define["key"]} twice')
        key_set.add(define['key'])
        if define.get('type') not in CONFIG_TYPE_LIST:
            raise ServiceDefineError(f'{place}[{index}].type must be one of {", ".join(CONFIG_TYPE_LIST)}')
        if 'default' in define and not value_type_is(define['default'], define['type']):
            raise ServiceDefineError(f'{place}[{index}].default is not of type {define["type"]}')
        result.append({
            'key': define['key'],
            'type': define['type'],
            'default': define.get('default'),
            'description': define.get('description', ''),
        })
    return result


def _api_list_build(service_class, label):
    api_list = []
    for name in dir(service_class):
        method = getattr(service_class, name, None)
        declared = getattr(method, '__service_api__', None)
        if declared is None:
            continue
        place = f'{label}: api {name}'
        if not REGEX_API_NAME.match(name):
            raise ServiceDefineError(f'{place}: an api name is camelCase letters and digits')
        if declared['kind'] not in API_KIND_LIST:
            raise ServiceDefineError(f'{place}: kind must be one of {", ".join(API_KIND_LIST)}')
        if declared['execution'] not in API_EXECUTION_LIST:
            raise ServiceDefineError(f'{place}: execution must be one of {", ".join(API_EXECUTION_LIST)}')
        caller_kind_list = declared['callerKindList']
        if len(caller_kind_list) == 0 or not all(item in CALLER_KIND_LIST for item in caller_kind_list):
            raise ServiceDefineError(f'{place}: callerKindList must list some of {", ".join(CALLER_KIND_LIST)}')
        if not isinstance(declared['isQueued'], bool):
            raise ServiceDefineError(f'{place}: isQueued must be true or false')
        if declared['execution'] == 'async' and not declared['isQueued']:
            raise ServiceDefineError(f'{place}: an async api runs as a job of the queue; isQueued cannot be false')
        api_list.append({
            'name': name,
            'kind': declared['kind'],
            'execution': declared['execution'],
            'callerKindList': caller_kind_list,
            'isQueued': declared['isQueued'],
            'description': declared['description'],
            'paramList': [_param_normalize(item, f'{place} param {index}') for index, item in enumerate(declared['params'])],
            'result': _result_normalize(declared['result'], f'{place} result'),
        })
    api_list.sort(key=lambda item: item['name'])
    return api_list


def _param_normalize(item, place):
    if not isinstance(item, dict) or not isinstance(item.get('name'), str) or item['name'] == '':
        raise ServiceDefineError(f'{place}: a parameter is param(name, type, ...)')
    if item.get('type') not in SCHEMA_TYPE_LIST:
        raise ServiceDefineError(f'{place}: type must be one of {", ".join(SCHEMA_TYPE_LIST)}')
    has_default = item.get('default', _VALUE_NONE) is not _VALUE_NONE
    is_required = item['isRequired'] if item.get('isRequired') is not None else not has_default
    schema = {**(item.get('schema') or {}), 'type': item['type']}
    if has_default:
        schema['default'] = item['default']
    return {
        'name': item['name'],
        'description': item.get('description', ''),
        'isRequired': bool(is_required),
        'schema': schema,
    }


def _result_normalize(item, place):
    if item is None:
        return {'description': '', 'schema': {'type': 'null'}}
    if not isinstance(item, dict) or item.get('type') not in SCHEMA_TYPE_LIST:
        raise ServiceDefineError(f'{place}: a result is returns(type, description)')
    return {'description': item.get('description', ''), 'schema': {**(item.get('schema') or {}), 'type': item['type']}}


def _dashboard_list_normalize(dashboard_list, label):
    place = f'{label}: expose.dashboardList'
    if not isinstance(dashboard_list, list) or len(dashboard_list) == 0:
        raise ServiceDefineError(f'{place} must list the dashboards, at least one of purpose default and one of purpose config')
    id_set = set()
    result = []
    for index, dashboard in enumerate(dashboard_list):
        if not isinstance(dashboard, dict):
            raise ServiceDefineError(f'{place}[{index}] must be a mapping')
        dashboard_id = dashboard.get('id')
        if not isinstance(dashboard_id, str) or not REGEX_DASHBOARD_ID.match(dashboard_id):
            raise ServiceDefineError(f'{place}[{index}].id must start with a lowercase letter, then letters, digits, -')
        if dashboard_id in id_set:
            raise ServiceDefineError(f'{place} declares {dashboard_id} twice')
        id_set.add(dashboard_id)
        purpose = dashboard.get('purpose', 'other')
        if purpose not in DASHBOARD_PURPOSE_LIST:
            raise ServiceDefineError(f'{place}[{index}].purpose must be one of {", ".join(DASHBOARD_PURPOSE_LIST)}')
        export_name = dashboard.get('export')
        if not isinstance(export_name, str) or export_name == '':
            raise ServiceDefineError(f'{place}[{index}].export must name the export of the dashboard module')
        result.append({
            **dashboard,
            'id': dashboard_id,
            'purpose': purpose,
            'label': dashboard.get('label') or dashboard_id,
            'description': dashboard.get('description', ''),
            'export': export_name,
            'heightMin': dashboard.get('heightMin', ''),
        })
    for purpose in ['default', 'config']:
        count = len([dashboard for dashboard in result if dashboard['purpose'] == purpose])
        if count != 1:
            raise ServiceDefineError(f'{place} must have exactly one dashboard of purpose {purpose} (has {count})')
    return result


def _dashboard_remote_normalize(remote, label, dir_path, dashboard_list):
    place = f'{label}: expose.dashboardRemote'
    if not isinstance(remote, dict):
        raise ServiceDefineError(f'{place} must be a mapping {{ dir, entry, container, module }}')
    for key in ['dir', 'entry', 'container', 'module']:
        if not isinstance(remote.get(key), str) or remote[key] == '':
            raise ServiceDefineError(f'{place}.{key} must be a non-empty string')
    dir_abs = os.path.normpath(os.path.join(dir_path, remote['dir']))
    if not dir_abs.startswith(os.path.normpath(dir_path) + os.sep):
        raise ServiceDefineError(f'{place}.dir must be inside the folder')
    return {
        'dir': remote['dir'],
        'entry': remote['entry'],
        'container': remote['container'],
        'module': remote['module'],
    }


def dashboard_remote_build_get(dir_path, remote):
    """Whether the dashboard module is built, and when: read on every listing,
    since it is built while the backend runs. timeBuilt (the mtime of the
    entry, in ms) lets the page load a rebuilt module instead of its cache."""
    entry_path = os.path.join(dir_path, remote['dir'], remote['entry'])
    if not os.path.isfile(entry_path):
        return {'isBuilt': False, 'timeBuilt': 0}
    return {'isBuilt': True, 'timeBuilt': int(os.path.getmtime(entry_path) * 1000)}


# ---------- values ----------

def value_type_is(value, schema_type):
    """Whether a json value has one of the schema types."""
    if schema_type == 'any':
        return True
    if schema_type == 'null':
        return value is None
    if schema_type == 'boolean':
        return isinstance(value, bool)
    if schema_type == 'integer':
        return isinstance(value, int) and not isinstance(value, bool)
    if schema_type == 'number':
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if schema_type == 'string':
        return isinstance(value, str)
    if schema_type == 'object':
        return isinstance(value, dict)
    if schema_type == 'array':
        return isinstance(value, list)
    return False


def api_param_dict_build(api_define, params):
    """The keyword arguments of a call, checked against the api's parameters.

    Raises ServiceError -1 for an unknown parameter, a missing required one,
    or a value of the wrong type; a missing optional one is left to the
    method's own default.
    """
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise ServiceError(-1, f'the params of {api_define["name"]} must be a mapping')
    param_by_name = {item['name']: item for item in api_define['paramList']}
    for name in params:
        if name not in param_by_name:
            raise ServiceError(-1, f'{api_define["name"]} has no parameter {name}')
    result = {}
    for name, item in param_by_name.items():
        if name not in params:
            if item['isRequired']:
                raise ServiceError(-1, f'{api_define["name"]} needs the parameter {name}')
            continue
        value = params[name]
        schema_type = item['schema']['type']
        if not value_type_is(value, schema_type) and not (value is None and not item['isRequired']):
            raise ServiceError(-1, f'the parameter {name} of {api_define["name"]} must be of type {schema_type}')
        result[name] = value
    return result


def openrpc_document_build(expose, info_extra):
    """The apis of a script as an OpenRPC document (https://spec.open-rpc.org).

    info_extra: the extension keys of info naming whose script it is
    (x-templateId, x-serviceId, ...).

    The exposure keeps the project's own names (paramList, isRequired, kind,
    execution, callerKindList, isQueued); this is the same information in the standard form, for
    tools that read OpenRPC.
    """
    method_list = []
    for item in expose['apiList']:
        method_list.append({
            'name': item['name'],
            'description': item['description'],
            'params': [
                {'name': param_item['name'], 'description': param_item['description'],
                 'required': param_item['isRequired'], 'schema': param_item['schema']}
                for param_item in item['paramList']
            ],
            'result': {'name': 'result', 'description': item['result']['description'], 'schema': item['result']['schema']},
            'paramStructure': 'by-name',
            'x-kind': item['kind'],
            'x-execution': item['execution'],
            'x-callerKindList': item['callerKindList'],
            'x-isQueued': item['isQueued'],
        })
    return {
        'openrpc': '1.3.2',
        'info': {
            'title': expose['meta']['label'],
            'description': expose['meta']['description'],
            'version': expose['meta']['version'],
            **info_extra,
        },
        'methods': method_list,
    }
