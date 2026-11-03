"""What the script of a service is and what it exposes.

Design: doc_page_impl_service_backend.md#what-a-service-script-exposes

The script of a service is a Python class deriving from Service, in the file
service.py of a template folder, and of every instance folder created from
it (each instance runs its own copy), named by the module variable
SERVICE_CLASS. The class says what it exposes in two places, both next to
the code they describe:

    class NoteDb(Service):
        expose = {
            'meta': {...},               label, description, author, version, ...
            'configDefineList': [...],   the shape of an instance's config
            'dependencyList': [...],     the infra services it uses, by name (the initial list of an instance)
            'infra': {...},              an infra service: the name it provides, its storage type
            'execution': {...},          passive (apis only) or resident (a run() thread of its own)
            'lifecycle': {...},          the timeout of the lifecycle hooks
            'dashboardList': [...],      the dashboards, keyed by id (optional)
            'compList': [...],           further components of the module: object views (optional)
            'dashboardRemote': {...},    where the federated module of the dashboards is
            'typeList': [...],           the object Types the template defines, under its name
            'objectProvide': {...},      the objects it provides to the object registry
            'requireList': [...],        the Types and components it needs others to provide
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
# service: another service instance, through ServiceContext.service_call.
# kernel: the service runtime kernel itself (its log records, its checks)
CALLER_KIND_LIST = ['page', 'service', 'kernel']

# the two kinds of services (doc_page_impl_service.md#app-services-and-infra-services):
# app: serves documents and dashboards, keeps its state in infra services.
# infra: serves other services (storage, logging, connections), reached by name
SERVICE_KIND_LIST = ['app', 'infra']

# what an instance does when an infra service it depends on is unavailable:
# report: the dependency is reported in its health, a call of the infra fails (-7)
# reject: moreover, every call of the instance is refused (-7) while a required one is unavailable
DEPENDENCY_POLICY_LIST = ['report', 'reject']

# passive: the instance only answers apis. resident: it also runs run(stop_event)
# in a thread of its own, started after start() and stopped before stop()
EXECUTION_MODE_LIST = ['passive', 'resident']

# the lifecycle hooks a script may implement, in the order they are called
HOOK_NAME_LIST = ['onCreate', 'onStart', 'onStop', 'onDestroy']
HOOK_TIMEOUT_SECOND_DEFAULT = 30

# default: the dashboard a document shows when it places the service.
# config: the dashboard of the instance's settings (the Services tab).
# other: any further dashboard, chosen by its id
DASHBOARD_PURPOSE_LIST = ['default', 'config', 'other']

CONFIG_TYPE_LIST = ['string', 'integer', 'number', 'boolean']

# the storage a infra service exposes to its consumers: the kind of store, the
# shape of its history, the operations it has (doc_page_impl_service_storage.md#storage-infra-services)
STORAGE_VERSIONING_LIST = ['none', 'linear']
STORAGE_OPERATION_LIST = ['versionCreate', 'versionList', 'checkout', 'versionDelete', 'export', 'restore', 'backup']

# the metadata folder of a doc page (doc_page_impl_dir.md), as service_kernel names it
DOC_PAGE_META_DIR_NAME = '.doc-page'

EXPOSE_NAME_STANDARD_LIST = ['meta', 'configDefineList', 'dependencyList', 'infra', 'execution', 'lifecycle',
                             'dashboardList', 'compList', 'dashboardRemote', 'typeList', 'objectProvide', 'requireList']

# ---------- the object registry (doc_page_impl_obj.md) ----------

# an object reference: {namespace}:{local}. the namespace names the provider
# that is authoritative for the object; the local part is the provider's own
REGEX_OBJECT_REF = re.compile(r'^([a-zA-Z][a-zA-Z0-9.-]*):(.+)$')
# a Type id: dotted, its first part the namespace of whoever defines it
# (core, doc, service, or a template's name)
REGEX_TYPE_ID = re.compile(r'^[a-z][a-z0-9-]*(\.[a-zA-Z][a-zA-Z0-9-]*)+$')
TYPE_KIND_LIST = ['object', 'relation']
TYPE_ROOT_BY_KIND = {'object': 'core.object', 'relation': 'core.relation'}
# the contexts an object is drawn in (doc_page_impl_obj.md#object-views)
OBJECT_VIEW_CONTEXT_LIST = ['icon', 'inline', 'card', 'block']
# what a provider can be asked, besides being named by its namespace
OBJECT_CAPABILITY_LIST = ['query', 'count', 'resolve', 'read', 'update', 'relationQuery']
# the api of a script that answers each capability of its objectProvide;
# the kernel is their only caller (callerKindList ['kernel'])
OBJECT_API_BY_CAPABILITY = {'query': 'objectQuery', 'count': 'objectCount', 'resolve': 'objectResolve', 'read': 'objectRead',
                            'update': 'objectUpdate', 'relationQuery': 'relationQuery'}
OBJECT_CACHE_SECOND_DEFAULT = 15
REQUIRE_KIND_LIST = ['type', 'objectView', 'comp']

REGEX_DASHBOARD_ID = re.compile(r'^[a-z][a-zA-Z0-9-]*$')
REGEX_API_NAME = re.compile(r'^[a-z][a-zA-Z0-9]*$')
# an infra service name: what a dependency names (doc_page_impl_service.md#naming-a-service)
REGEX_INFRA_NAME = re.compile(r'^[a-z][a-z0-9_-]*$')

_VALUE_NONE = object()


class ServiceError(Exception):
    """An api refusing or failing with a code of the formatted response.

    -1 bad request or failure, -2 the caller may not call it, -3 something
    the request names is not found, -4 the instance is not ready, -7 an infra
    service the call depends on is unavailable.
    """

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


class ServiceDefineError(Exception):
    """A service script whose declaration cannot be used."""


class ServiceCaller:
    """Who a call comes from, as the runtime knows it: never what a request says it is.

    kind                  page (an http request), service (another instance) or kernel
    service_id            the calling instance; '' for page and kernel
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

    def principal_get(self):
        """The principal of a log record written by this caller."""
        if self.kind == 'service':
            return {'kind': 'service', 'id': self.service_id}
        if self.kind == 'kernel':
            return {'kind': 'kernel', 'id': ''}
        return {'kind': 'page', 'id': self.dashboard_service_id}

    def label_get(self):
        if self.kind == 'service':
            return f'the service {self.service_id}'
        if self.kind == 'kernel':
            return 'the kernel'
        if self.dashboard_service_id:
            return f'the page (a dashboard of {self.dashboard_service_id})'
        return 'the page'


class InfraClient:
    """An infra service as an instance uses it: by name, routed by the kernel
    to the current instance providing that name (doc_page_impl_service_kernel.md#using-an-infra-service).

        db = self.context.infra('sqlite')
        db.query(sql='SELECT 1')          # any api of the infra: a keyword call
        db.call('query', {'sql': '...'})  # the same, as a mapping
        db.resolve()                       # the instance the calls go to, as listed
        db.is_available()                  # whether a ready instance provides it
    """

    def __init__(self, context, name):
        self.context = context
        self.name = name

    def call(self, api, params=None):
        return self.context.service_call({'infra': self.name}, api, params)

    def resolve(self):
        return self.context.service_resolve({'infra': self.name})

    def is_available(self):
        try:
            return self.resolve().get('status') == 'ready'
        except ServiceError:
            return False

    def __getattr__(self, api):
        if api.startswith('_'):
            raise AttributeError(api)
        return lambda **params: self.call(api, params)


class ServiceContext:
    """What a service instance is given: its identity, its folder, its config,
    who calls it, the infra services it uses, and the way to call other instances.

    service_id, name    the instance
    kind                app or infra
    dir_path            the instance's folder: its own script and its data
    template            the template it was created from, as recorded in its
                        service.yaml: { templateId, name, versionId }. a
                        record only: the instance never reads the template
    origin              where the instance's folder was found: { kind: docPage |
                        folder, alias, dir }; for a doc page, dir is the doc page
                        folder (doc_page_meta_dir_get: its .doc-page/ folder)
    config              the instance's config, with the defaults of configDefineList
    dependency_list     the infra services the instance uses, normalized
                        [{ name, isRequired, onUnavailable }]
    caller              the ServiceCaller of the api being run in this thread;
                        None outside an api (start, stop, run, a thread of its own)
    infra(name)         an InfraClient of an infra service of dependency_list
    infra_require(name) adds an infra service to dependency_list at runtime, when allowed
    log(...)            a log record of this instance, through the kernel into the logging infra
    health_set(...)     what the instance says of its own health
    service_call, service_job_get, service_resolve
                        calls of the apis of other instances, as this instance
    """

    def __init__(self, service_id, name, dir_path, template, config, runtime=None, kind='app',
                 dependency_list=(), is_dependency_dynamic_allowed=False, origin=None):
        self.service_id = service_id
        self.name = name
        self.kind = kind
        self.dir_path = dir_path
        self.template = template
        self.origin = dict(origin) if origin else {'kind': 'folder', 'alias': '', 'dir': os.path.dirname(dir_path)}
        self.config = config
        self.dependency_list = [dict(item) for item in dependency_list]
        self.is_dependency_dynamic_allowed = is_dependency_dynamic_allowed
        # the runtime, for the calls of other instances (api_call, job_get, target_resolve)
        self._runtime = runtime
        # the caller and the job of the api being run, per thread: a queued
        # api runs in the instance's worker thread, an api with isQueued
        # False in the thread of its caller, both at once
        self._local = threading.local()
        # what the instance reports of itself (health_set): '' means nothing reported
        self.health_reported = ''
        self.health_reported_message = ''

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

    def doc_page_meta_dir_get(self):
        """The metadata folder (.doc-page/) of the doc page the instance belongs
        to, where a service keeps what should outlive the instance's folder
        (the backups of local-backup); '' for an instance of a plain folder."""
        if self.origin.get('kind') != 'docPage' or not self.origin.get('dir'):
            return ''
        return os.path.join(self.origin['dir'], DOC_PAGE_META_DIR_NAME)

    def job_progress_set(self, fraction, message=''):
        """The progress of the async job being run, 0..1, with a short text."""
        job = self.job_current
        if job is None:
            return
        job.progress = max(0.0, min(1.0, float(fraction)))
        job.progress_message = str(message)

    # ---------- infra services ----------

    def dependency_name_list_get(self):
        return [item['name'] for item in self.dependency_list]

    def infra(self, name):
        """An infra service the instance uses, by name. The name must be in its
        dependency list; when the instance may add dependencies at runtime
        (isDependencyDynamicAllowed), a name not yet there is added."""
        if name not in self.dependency_name_list_get():
            self.infra_require(name)
        return InfraClient(self, name)

    def infra_require(self, name, is_required=False, on_unavailable='report'):
        """Adds an infra service to the dependency list of the instance, written
        back to its service.yaml; raises ServiceError -2 when the instance may
        not (isDependencyDynamicAllowed false in its service.yaml)."""
        if name in self.dependency_name_list_get():
            return
        if not self.is_dependency_dynamic_allowed:
            raise ServiceError(-2, f'{self.service_id} may not add the infra service {name} at runtime: it is not in its '
                                   f'dependencyList and isDependencyDynamicAllowed is false in its service.yaml')
        item = dependency_item_normalize({'name': name, 'isRequired': is_required, 'onUnavailable': on_unavailable},
                                         f'instance {self.service_id}: infra_require')
        self.dependency_list.append(item)
        if self._runtime is not None:
            self._runtime.instance_dependency_added(self.service_id, item)

    # ---------- logging and health ----------

    def log(self, level, feature, message, data=None):
        """A log record of this instance: level (debug, info, warn, error), the
        feature of the instance it belongs to, a message, and data (json). It
        goes through the kernel into the logging infra service when there is
        one, to stderr otherwise."""
        if self._runtime is None:
            return
        self._runtime.kernel_log.write(level, feature, message, data, {'kind': 'service', 'id': self.service_id})

    def health_set(self, health, message=''):
        """What the instance says of its own health: 'healthy', 'degraded' or
        'unhealthy' (or '' to say nothing), with a message. The kernel combines
        it with what it sees itself (the lifecycle state, the dependencies)."""
        if health not in ('', 'healthy', 'degraded', 'unhealthy'):
            raise ValueError("health is '', healthy, degraded or unhealthy")
        self.health_reported = health
        self.health_reported_message = str(message or '')

    # ---------- calls of other instances ----------

    def service_call(self, target, api, params=None):
        """Calls an api of another instance, as this instance: what a sync api
        returned, the job of an async one; raises ServiceError with the call's
        code when it fails.

        target is { serviceId } (that instance), { templateId, versionId? }
        (an instance created from that template, at that version; this
        instance itself is never chosen), or { infra: name } (the current
        instance of that infra service; the name must be in the dependency
        list). The callee reads this instance as its context.caller. A sync
        call waits apiWaitSecondMax at most.
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

    # ---------- the object registry (doc_page_impl_obj.md) ----------
    # the registry is a place of discovery and resolution, never the truth
    # of an object: what it answers may be stale or incomplete, and says so
    # (status, completeness). an object is read and changed through its
    # provider (object_read, object_update), which decides

    @property
    def object_namespace(self):
        """The namespace of the objects this instance provides: service.{serviceId}."""
        return f'service.{self.service_id}'

    def object_ref_build(self, local_id):
        """The reference of one of this instance's own objects."""
        return f'{self.object_namespace}:{local_id}'

    def object_type_is_assignable(self, type_id, type_id_to):
        """Whether an object of type_id is one of type_id_to (the same Type, or a
        subtype), by the Type registry of the backend: what a provider asks to
        answer a query for a Type it does not name itself (core.object)."""
        return self._runtime.object_registry.type_registry.is_assignable(type_id, type_id_to)

    def object_type_list_match(self, type_list_own, type_list_asked):
        """The Types of type_list_own that a query for type_list_asked wants."""
        return [type_id for type_id in type_list_own
                if any(self.object_type_is_assignable(type_id, asked) for asked in (type_list_asked or ['core.object']))]

    def object_query(self, type_list=None, text='', filter=None, limit=100, is_fresh=False):
        """Objects of these Types (and their subtypes), from every provider that has
        some, and from what was registered: { objectList, completeness }. A
        provider that does not answer is in completeness, not an error."""
        return self._runtime.object_registry.query({'typeList': type_list or [], 'text': text, 'filter': filter or {},
                                                    'limit': limit, 'isFresh': is_fresh}, self._caller_self_get())

    def object_count(self, type_list=None, text='', filter=None):
        """How many objects a query would answer, per provider, without fetching them:
        { providerList: [{ providerId, label, status, count, countKind: exact | unknown }] }."""
        return self._runtime.object_registry.count({'typeList': type_list or [], 'text': text, 'filter': filter or {}},
                                                   self._caller_self_get())

    def object_resolve(self, ref_list, is_verify=False):
        """The descriptors of these references, in order, each with its status
        (found, registered, missing, unavailable, unknown)."""
        return self._runtime.object_registry.resolve(ref_list, is_verify, self._caller_self_get())

    def object_read(self, ref):
        """{ descriptor, content } of an object, from its provider; raises ServiceError."""
        return self._runtime.object_registry.read(ref, self._caller_self_get())

    def object_update(self, ref, patch):
        """Changes an object through its provider, which checks the patch; raises ServiceError."""
        return self._runtime.object_registry.update(ref, patch, self._caller_self_get())

    def relation_query(self, from_ref='', to_ref='', type_list=None, is_fresh=False):
        """The relations from from_ref and / or to to_ref, of these Types: { relationList, completeness }."""
        return self._runtime.object_registry.relation_query({'fromRef': from_ref, 'toRef': to_ref, 'typeList': type_list or [],
                                                             'isFresh': is_fresh}, self._caller_self_get())

    def object_register(self, descriptor_list, is_replace=False):
        """Registers descriptors of this instance's own objects (a localId, or a
        reference of its namespace), so a query finds them without asking the
        instance; with is_replace its earlier registrations are dropped first.
        Registered is known, not verified: a resolve still asks the instance."""
        return self._runtime.object_registry.register(descriptor_list, {'kind': 'service', 'id': self.service_id},
                                                      [self.object_namespace], is_replace)

    def object_changed(self, local_id_list=None):
        """Tells the registry that these objects (all of this instance's, for None)
        changed or are gone: what it keeps of them is asked again."""
        ref_list = None if local_id_list is None else [self.object_ref_build(local_id) for local_id in local_id_list]
        self._runtime.object_registry.changed(f'service:{self.service_id}', ref_list)

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

    The lifecycle hooks (doc_page_impl_service_kernel.md#lifecycle-and-hooks), each
    run with the timeout of expose.lifecycle.hookTimeoutSecond:
      on_create   once in the life of the instance, the first time it starts
      start       every time the instance starts (after on_create the first time)
      run         a resident instance only (expose.execution.mode): a thread of
                  its own, started after start(); it returns when stop_event is set
      stop        every time the instance stops
      on_destroy  once, when the instance is deleted (after stop)
    An app instance is meant to keep no state of its own: what it keeps goes
    into an infra service (self.context.infra('sqlite')), so that the instance
    can be recreated, and the data kept, backed up and restored by the infra.
    """

    expose = {}

    def __init__(self, context):
        self.context = context

    def on_create(self):
        """Called once, before the first start() of the instance: create what the
        instance needs once (a schema in its storage). Must be safe to run again."""

    def start(self):
        """Called once before the first api: open the data, create it when new."""

    def run(self, stop_event):
        """A resident instance's own loop; returns when stop_event is set."""

    def stop(self):
        """Called once when the instance stops: close what start opened."""

    def on_destroy(self):
        """Called once when the instance is deleted, after stop(): what its data
        in infra services should become (kept by default: nothing to do)."""


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

    callerKindList  who may call it: page, service, kernel (None: all three).
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
    comp_list = _comp_list_normalize(expose.get('compList'), label, dashboard_list)
    api_list = _api_list_build(service_class, label)
    hook_list = [name for name, method in HOOK_METHOD_BY_NAME.items() if getattr(service_class, method) is not getattr(Service, method)]
    return {
        **expose_other,
        'meta': _meta_normalize(expose.get('meta'), label, dir_path),
        'configDefineList': _config_define_list_normalize(expose.get('configDefineList'), label),
        'dependencyList': dependency_list_normalize(expose.get('dependencyList'), f'{label}: expose.dependencyList'),
        'infra': _infra_normalize(expose.get('infra'), label),
        'execution': _execution_normalize(expose.get('execution'), label),
        'lifecycle': _lifecycle_normalize(expose.get('lifecycle'), label),
        # the hooks the script implements (the methods it overrides), for information
        'hookList': hook_list,
        'apiList': api_list,
        'dashboardList': dashboard_list,
        'compList': comp_list,
        'dashboardRemote': _dashboard_remote_normalize(expose.get('dashboardRemote'), label, dir_path, dashboard_list + comp_list),
        'typeList': type_define_list_normalize(expose.get('typeList'), f'{label}: expose.typeList'),
        'objectProvide': _object_provide_normalize(expose.get('objectProvide'), label, api_list),
        'requireList': _require_list_normalize(expose.get('requireList'), label),
    }


# the hook names of the exposure and the methods of Service they are
HOOK_METHOD_BY_NAME = {'onCreate': 'on_create', 'onStart': 'start', 'run': 'run', 'onStop': 'stop', 'onDestroy': 'on_destroy'}


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


def dependency_item_normalize(item, place):
    """One entry of a dependency list: a name, or { name, isRequired?, onUnavailable? }.
    Raises ServiceDefineError."""
    if isinstance(item, str):
        item = {'name': item}
    if not isinstance(item, dict) or not isinstance(item.get('name'), str):
        raise ServiceDefineError(f'{place}: an entry is an infra service name, or {{ name, isRequired?, onUnavailable? }}')
    name = item['name']
    if not REGEX_INFRA_NAME.match(name):
        raise ServiceDefineError(f'{place}: the infra service name {name!r} is lowercase letters, digits, - and _, starting with a letter')
    is_required = item.get('isRequired', True)
    if not isinstance(is_required, bool):
        raise ServiceDefineError(f'{place}: isRequired of {name} must be true or false')
    on_unavailable = item.get('onUnavailable', 'report')
    if on_unavailable not in DEPENDENCY_POLICY_LIST:
        raise ServiceDefineError(f'{place}: onUnavailable of {name} must be one of {", ".join(DEPENDENCY_POLICY_LIST)}')
    return {'name': name, 'isRequired': is_required, 'onUnavailable': on_unavailable}


def dependency_list_normalize(dependency_list, place):
    """A dependency list normalized: [{ name, isRequired, onUnavailable }], names unique.
    Raises ServiceDefineError."""
    if dependency_list is None:
        return []
    if not isinstance(dependency_list, list):
        raise ServiceDefineError(f'{place} must be a list of infra service names')
    result = []
    for index, item in enumerate(dependency_list):
        normalized = dependency_item_normalize(item, f'{place}[{index}]')
        if any(existing['name'] == normalized['name'] for existing in result):
            raise ServiceDefineError(f'{place} names {normalized["name"]} twice')
        result.append(normalized)
    return result


def _infra_normalize(infra, label):
    """expose.infra of an infra service: { name?, storage? }; None for an app service."""
    place = f'{label}: expose.infra'
    if infra is None:
        return None
    if not isinstance(infra, dict):
        raise ServiceDefineError(f'{place} must be a mapping {{ name?, storage? }}')
    name = infra.get('name', '')
    if not isinstance(name, str) or (name != '' and not REGEX_INFRA_NAME.match(name)):
        raise ServiceDefineError(f'{place}.name is lowercase letters, digits, - and _, starting with a letter')
    storage = infra.get('storage')
    if storage is not None:
        if not isinstance(storage, dict) or not isinstance(storage.get('type'), str) or storage['type'] == '':
            raise ServiceDefineError(f'{place}.storage must be {{ type, versioning?, operationList? }}')
        versioning = storage.get('versioning', 'none')
        if versioning not in STORAGE_VERSIONING_LIST:
            raise ServiceDefineError(f'{place}.storage.versioning must be one of {", ".join(STORAGE_VERSIONING_LIST)}')
        operation_list = storage.get('operationList', [])
        if not isinstance(operation_list, list) or not all(item in STORAGE_OPERATION_LIST for item in operation_list):
            raise ServiceDefineError(f'{place}.storage.operationList must list some of {", ".join(STORAGE_OPERATION_LIST)}')
        storage = {**storage, 'type': storage['type'], 'versioning': versioning, 'operationList': operation_list,
                   'description': str(storage.get('description', ''))}
    return {**infra, 'name': name, 'storage': storage}


def _execution_normalize(execution, label):
    place = f'{label}: expose.execution'
    if execution is None:
        return {'mode': 'passive'}
    if not isinstance(execution, dict):
        raise ServiceDefineError(f'{place} must be a mapping {{ mode }}')
    mode = execution.get('mode', 'passive')
    if mode not in EXECUTION_MODE_LIST:
        raise ServiceDefineError(f'{place}.mode must be one of {", ".join(EXECUTION_MODE_LIST)}')
    return {**execution, 'mode': mode}


def _lifecycle_normalize(lifecycle, label):
    place = f'{label}: expose.lifecycle'
    if lifecycle is None:
        return {'hookTimeoutSecond': HOOK_TIMEOUT_SECOND_DEFAULT}
    if not isinstance(lifecycle, dict):
        raise ServiceDefineError(f'{place} must be a mapping {{ hookTimeoutSecond }}')
    timeout = lifecycle.get('hookTimeoutSecond', HOOK_TIMEOUT_SECOND_DEFAULT)
    if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or timeout <= 0:
        raise ServiceDefineError(f'{place}.hookTimeoutSecond must be a positive number')
    return {**lifecycle, 'hookTimeoutSecond': float(timeout)}


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
    """The dashboards of a script; [] for a script without any (an infra
    service that is worked from the Services tab alone)."""
    place = f'{label}: expose.dashboardList'
    if dashboard_list is None:
        return []
    if not isinstance(dashboard_list, list):
        raise ServiceDefineError(f'{place} must be a list of dashboards, or absent')
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
    if len(result) > 0:
        for purpose in ['default', 'config']:
            count = len([dashboard for dashboard in result if dashboard['purpose'] == purpose])
            if count != 1:
                raise ServiceDefineError(f'{place} must have exactly one dashboard of purpose {purpose} (has {count})')
    return result


def _dashboard_remote_normalize(remote, label, dir_path, module_comp_list):
    """Where the federated module of the dashboards and of the further
    components (compList) is; None for a script with neither."""
    place = f'{label}: expose.dashboardRemote'
    if len(module_comp_list) == 0:
        if remote is not None:
            raise ServiceDefineError(f'{place} goes with dashboardList or compList; the script declares no component')
        return None
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


def _comp_list_normalize(comp_list, label, dashboard_list):
    """The components of the module beyond the dashboards (doc_page_impl_obj.md#object-views):
    [{ id, export, label, description, objectView? }], the ids unique among the
    dashboards' too, since both are named service/{templateName}/... on the page."""
    place = f'{label}: expose.compList'
    if comp_list is None:
        return []
    if not isinstance(comp_list, list):
        raise ServiceDefineError(f'{place} must be a list of components, or absent')
    id_set = {dashboard['id'] for dashboard in dashboard_list}
    result = []
    for index, comp in enumerate(comp_list):
        if not isinstance(comp, dict):
            raise ServiceDefineError(f'{place}[{index}] must be a mapping')
        comp_id = comp.get('id')
        if not isinstance(comp_id, str) or not REGEX_DASHBOARD_ID.match(comp_id):
            raise ServiceDefineError(f'{place}[{index}].id must start with a lowercase letter, then letters, digits, -')
        if comp_id in id_set:
            raise ServiceDefineError(f'{place}: {comp_id} is declared twice (the ids of dashboardList and compList are one set)')
        id_set.add(comp_id)
        export_name = comp.get('export')
        if not isinstance(export_name, str) or export_name == '':
            raise ServiceDefineError(f'{place}[{index}].export must name the export of the module')
        result.append({
            **comp,
            'id': comp_id,
            'export': export_name,
            'label': comp.get('label') or comp_id,
            'description': comp.get('description', ''),
            'objectView': object_view_normalize(comp.get('objectView'), f'{place}[{index}].objectView'),
        })
    return result


def object_view_normalize(object_view, place):
    """What a component draws as an object view: { typeList, contextList, priority }; None when absent."""
    if object_view is None:
        return None
    if not isinstance(object_view, dict):
        raise ServiceDefineError(f'{place} must be {{ typeList, contextList, priority? }}')
    type_list = object_view.get('typeList')
    if not isinstance(type_list, list) or len(type_list) == 0 or not all(isinstance(item, str) and REGEX_TYPE_ID.match(item) for item in type_list):
        raise ServiceDefineError(f'{place}.typeList must list Type ids (core.task, todo-list.todo)')
    context_list = object_view.get('contextList', OBJECT_VIEW_CONTEXT_LIST)
    if not isinstance(context_list, list) or len(context_list) == 0 or not all(item in OBJECT_VIEW_CONTEXT_LIST for item in context_list):
        raise ServiceDefineError(f'{place}.contextList must list some of {", ".join(OBJECT_VIEW_CONTEXT_LIST)}')
    priority = object_view.get('priority', 0)
    if not isinstance(priority, (int, float)) or isinstance(priority, bool):
        raise ServiceDefineError(f'{place}.priority must be a number')
    return {'typeList': list(type_list), 'contextList': list(context_list), 'priority': priority}


def type_define_normalize(item, place):
    """One Type definition: { id, kind?, label?, description?, extendList?, icon?, summaryKeyList? }.
    Raises ServiceDefineError. Whether its parents exist is the Type registry's check."""
    if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not REGEX_TYPE_ID.match(item['id']):
        raise ServiceDefineError(f'{place}: a Type needs an id, dotted (todo-list.todo)')
    type_id = item['id']
    kind = item.get('kind', 'object')
    if kind not in TYPE_KIND_LIST:
        raise ServiceDefineError(f'{place}: the kind of {type_id} is object or relation')
    extend_list = item.get('extendList')
    if extend_list is None:
        extend_list = [] if type_id == TYPE_ROOT_BY_KIND[kind] else [TYPE_ROOT_BY_KIND[kind]]
    if not isinstance(extend_list, list) or not all(isinstance(parent, str) and REGEX_TYPE_ID.match(parent) for parent in extend_list):
        raise ServiceDefineError(f'{place}: extendList of {type_id} must list Type ids')
    if type_id in extend_list:
        raise ServiceDefineError(f'{place}: {type_id} cannot extend itself')
    summary_key_list = item.get('summaryKeyList', [])
    if not isinstance(summary_key_list, list) or not all(isinstance(key, str) for key in summary_key_list):
        raise ServiceDefineError(f'{place}: summaryKeyList of {type_id} must list keys')
    for key in ['label', 'description', 'icon']:
        if item.get(key) is not None and not isinstance(item.get(key), str):
            raise ServiceDefineError(f'{place}: {key} of {type_id} must be a string')
    return {
        **item,
        'id': type_id,
        'kind': kind,
        'label': item.get('label') or type_id,
        'description': item.get('description', ''),
        'extendList': list(extend_list),
        'icon': item.get('icon', ''),
        'summaryKeyList': list(summary_key_list),
    }


def type_define_list_normalize(type_list, place):
    if type_list is None:
        return []
    if not isinstance(type_list, list):
        raise ServiceDefineError(f'{place} must be a list of Types')
    result = []
    for index, item in enumerate(type_list):
        normalized = type_define_normalize(item, f'{place}[{index}]')
        if any(existing['id'] == normalized['id'] for existing in result):
            raise ServiceDefineError(f'{place} defines {normalized["id"]} twice')
        result.append(normalized)
    return result


def _object_provide_normalize(provide, label, api_list):
    """expose.objectProvide: the objects the instances of the template provide
    to the object registry, { typeList, relationTypeList?, queryFilterList?,
    cacheSecond? }; None for a script that provides none. Its capabilities are
    the object apis the script implements (objectQuery, objectResolve,
    objectRead, objectUpdate, relationQuery), each answered to the kernel."""
    place = f'{label}: expose.objectProvide'
    api_by_name = {item['name']: item for item in api_list}
    for capability, api_name in OBJECT_API_BY_CAPABILITY.items():
        api_define = api_by_name.get(api_name)
        if api_define is not None and provide is None:
            raise ServiceDefineError(f'{label}: api {api_name} is an object api; declare expose.objectProvide')
        if api_define is not None and 'kernel' not in api_define['callerKindList']:
            raise ServiceDefineError(f'{label}: api {api_name} is called by the kernel; its callerKindList must hold kernel')
    if provide is None:
        return None
    if not isinstance(provide, dict):
        raise ServiceDefineError(f'{place} must be {{ typeList, relationTypeList?, queryFilterList?, cacheSecond? }}')
    type_list = provide.get('typeList', [])
    relation_type_list = provide.get('relationTypeList', [])
    for key, value in [('typeList', type_list), ('relationTypeList', relation_type_list)]:
        if not isinstance(value, list) or not all(isinstance(item, str) and REGEX_TYPE_ID.match(item) for item in value):
            raise ServiceDefineError(f'{place}.{key} must list Type ids')
    if len(type_list) == 0 and len(relation_type_list) == 0:
        raise ServiceDefineError(f'{place} provides no Type: typeList or relationTypeList names one at least')
    filter_list = provide.get('queryFilterList', [])
    if not isinstance(filter_list, list) or not all(isinstance(item, str) for item in filter_list):
        raise ServiceDefineError(f'{place}.queryFilterList must list filter names')
    cache_second = provide.get('cacheSecond', OBJECT_CACHE_SECOND_DEFAULT)
    if not isinstance(cache_second, (int, float)) or isinstance(cache_second, bool) or cache_second < 0:
        raise ServiceDefineError(f'{place}.cacheSecond must be a number, 0 or more')
    capability_list = [capability for capability, api_name in OBJECT_API_BY_CAPABILITY.items() if api_name in api_by_name]
    if 'query' not in capability_list and 'resolve' not in capability_list and len(type_list) > 0:
        raise ServiceDefineError(f'{place}: a provider of objects answers objectQuery or objectResolve at least')
    if 'relationQuery' not in capability_list and len(relation_type_list) > 0:
        raise ServiceDefineError(f'{place}: relationTypeList needs the api relationQuery')
    return {
        **provide,
        'typeList': list(type_list),
        'relationTypeList': list(relation_type_list),
        'queryFilterList': list(filter_list),
        'cacheSecond': float(cache_second),
        'capabilityList': capability_list,
    }


def _require_list_normalize(require_list, label):
    """What the template needs others to provide (doc_page_impl_obj.md#what-a-template-declares):
    [{ type } | { objectView: typeId, context? } | { comp }, with isRequired?, note?]."""
    place = f'{label}: expose.requireList'
    if require_list is None:
        return []
    if not isinstance(require_list, list):
        raise ServiceDefineError(f'{place} must be a list')
    result = []
    for index, item in enumerate(require_list):
        if not isinstance(item, dict):
            raise ServiceDefineError(f'{place}[{index}] must be {{ type }}, {{ objectView }} or {{ comp }}')
        kind_list = [kind for kind in REQUIRE_KIND_LIST if kind in item]
        if len(kind_list) != 1:
            raise ServiceDefineError(f'{place}[{index}] names one of type, objectView, comp')
        kind = kind_list[0]
        value = item[kind]
        if kind in ('type', 'objectView') and (not isinstance(value, str) or not REGEX_TYPE_ID.match(value)):
            raise ServiceDefineError(f'{place}[{index}].{kind} must be a Type id')
        if kind == 'comp' and (not isinstance(value, str) or value == ''):
            raise ServiceDefineError(f'{place}[{index}].comp must be a component id')
        context = item.get('context', '')
        if context and (kind != 'objectView' or context not in OBJECT_VIEW_CONTEXT_LIST):
            raise ServiceDefineError(f'{place}[{index}].context goes with objectView, one of {", ".join(OBJECT_VIEW_CONTEXT_LIST)}')
        is_required = item.get('isRequired', True)
        if not isinstance(is_required, bool):
            raise ServiceDefineError(f'{place}[{index}].isRequired must be true or false')
        result.append({'kind': kind, 'value': value, 'context': context, 'isRequired': is_required,
                       'note': str(item.get('note', ''))})
    return result


# ---------- object descriptors and relations ----------

def object_ref_split(ref):
    """(namespace, local) of an object reference; raises ServiceError -1."""
    match = REGEX_OBJECT_REF.match(ref) if isinstance(ref, str) else None
    if match is None:
        raise ServiceError(-1, f'{ref!r} is not an object reference: {{namespace}}:{{local}}')
    return match.group(1), match.group(2)


def object_descriptor_normalize(item, place, namespace_own=None):
    """A descriptor as a provider or a registrant gives it. With namespace_own,
    a localId is made into a reference of that namespace, and a reference of
    another namespace is refused: a provider names only its own objects.
    Raises ServiceError -1."""
    if not isinstance(item, dict):
        raise ServiceError(-1, f'{place}: a descriptor is a mapping {{ ref | localId, typeList, label, ... }}')
    ref = item.get('ref')
    if ref is None and namespace_own is not None and item.get('localId') not in (None, ''):
        ref = f'{namespace_own}:{item["localId"]}'
    namespace, _local = object_ref_split(ref)
    if namespace_own is not None and namespace != namespace_own:
        raise ServiceError(-1, f'{place}: {ref} is not of the namespace {namespace_own}; a provider names its own objects only')
    type_list = item.get('typeList') or []
    if not isinstance(type_list, list) or len(type_list) == 0 or not all(isinstance(type_id, str) and REGEX_TYPE_ID.match(type_id) for type_id in type_list):
        raise ServiceError(-1, f'{place}: typeList of {ref} must list Type ids')
    summary = item.get('summary') or {}
    if not isinstance(summary, dict):
        raise ServiceError(-1, f'{place}: summary of {ref} must be a mapping')
    capability_list = item.get('capabilityList') or []
    if not isinstance(capability_list, list):
        raise ServiceError(-1, f'{place}: capabilityList of {ref} must be a list')
    return {
        'ref': ref,
        'typeList': list(type_list),
        'label': str(item.get('label') or ref),
        'description': str(item.get('description') or ''),
        'summary': summary,
        'iconUrl': str(item.get('iconUrl') or ''),
        'capabilityList': [str(capability) for capability in capability_list],
        'open': item.get('open') if isinstance(item.get('open'), dict) else None,
    }


def relation_normalize(item, place, namespace_own=None):
    """A relation as a provider gives it: { key, type, fromRef, toRef, order?, label?, data? }.
    With namespace_own a fromLocalId / toLocalId is made into a reference of it. Raises ServiceError -1."""
    if not isinstance(item, dict):
        raise ServiceError(-1, f'{place}: a relation is a mapping {{ key, type, fromRef, toRef }}')
    result = {}
    for end in ['from', 'to']:
        ref = item.get(f'{end}Ref')
        if ref is None and namespace_own is not None and item.get(f'{end}LocalId') not in (None, ''):
            ref = f'{namespace_own}:{item[f"{end}LocalId"]}'
        object_ref_split(ref)
        result[f'{end}Ref'] = ref
    if not isinstance(item.get('type'), str) or not REGEX_TYPE_ID.match(item['type']):
        raise ServiceError(-1, f'{place}: the type of a relation is a Type id')
    key = item.get('key')
    if not isinstance(key, (str, int)) or key == '':
        raise ServiceError(-1, f'{place}: a relation needs a key (its entry, unique for its provider)')
    data = item.get('data') or {}
    if not isinstance(data, dict):
        raise ServiceError(-1, f'{place}: data of a relation must be a mapping')
    order = item.get('order')
    return {
        'key': str(key),
        'type': item['type'],
        **result,
        'order': order if isinstance(order, (int, float)) and not isinstance(order, bool) else None,
        'label': str(item.get('label') or ''),
        'data': data,
    }


def dashboard_remote_build_get(dir_path, remote):
    """Whether the dashboard module is built, and when: read on every listing,
    since it is built while the backend runs. timeBuilt (the mtime of the
    entry, in ms) lets the page load a rebuilt module instead of its cache.
    None for a script without dashboards."""
    if remote is None:
        return None
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
