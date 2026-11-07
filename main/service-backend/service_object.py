"""The object registry and the type registry of the backend.

Design: doc_page_impl_obj.md

The object registry must not automatically become the source of truth for
object contents, relationships, or lifecycle. Providers remain authoritative
for the data they own. Registration, discovery, resolution, and verification
are separate concerns.

- a type is a JSON definition { id, kind: object | relation, label,
  extendList, ... }; the type registry holds the built-in types (the JSON
  file built-in/type.yaml, shared with the page) and the types the
  service templates define (expose.typeList, under the template's name), and
  answers which type is assignable to which (a DAG: a type extends any
  number of types of its kind)
- an object is named by a reference {namespace}:{local}. the namespace is the
  provider's: service, serviceTemplate, serviceConfig (the kernel's own
  provider), service.{serviceId} (an instance whose script declares
  expose.objectProvide). the local part is the provider's own business
- a provider answers what it can (its capabilities: query, resolve, read,
  update, relationQuery) and nothing more; an instance provider answers
  through its object apis, called by the kernel in its queue
- the registry keeps three things, none of them the truth: what was
  registered (descriptors a principal handed it, never verified by the
  registering), what a provider answered (a cache, for cacheSecond), and
  the types. a query is federated to the providers of the types asked for
  and says how complete it is; a provider that does not answer is reported,
  not an error; a stale descriptor is answered with its status
"""

import json
import os
import threading
import time

import yaml

from service_define import (
    OBJECT_CACHE_SECOND_DEFAULT,
    REGEX_TYPE_ID,
    TYPE_KIND_LIST,
    TYPE_ROOT_BY_KIND,
    ServiceCaller,
    ServiceDefineError,
    ServiceError,
    object_descriptor_normalize,
    object_ref_split,
    relation_normalize,
    type_define_normalize,
)

# the built-in types, beside the backend (two levels above service-backend/):
# they are part of the protocol of the registry, so they are read whatever
# builtIn the backend config says
OBJECT_TYPE_BUILTIN_FILE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'built-in',
                                                         'type.yaml'))

# the namespaces of the kernel's own provider
KERNEL_NAMESPACE_LIST = ['service', 'serviceTemplate', 'serviceConfig']
# the namespace of the objects of an instance: service.{serviceId}
INSTANCE_NAMESPACE_PREFIX = 'service.'

# found: a provider answered with it (at timeChecked). registered: a principal
# registered it, nobody verified it. missing: its provider says it does not
# exist. unavailable: its provider could not be asked (what is answered is
# what was known before, if anything). unknown: no provider of its namespace
OBJECT_STATUS_LIST = ['found', 'registered', 'missing', 'unavailable', 'unknown']

# how long the kernel waits for one provider of a federated request: a
# provider that is slower is reported as timedOut, the others are answered
PROVIDER_WAIT_SECOND_DEFAULT = 5.0
QUERY_LIMIT_MAX = 500


class TypeRegistry:
    """The types of the backend: the built-in ones, then those of the templates."""

    def __init__(self):
        self.type_by_id = {}
        self.problem_list = []
        self._ancestor_by_id = {}
        self.signature = None

    def rebuild(self, entry_list, signature=None):
        """entry_list: [(type_define, defined_by)] in order of precedence: the first
        definition of an id is kept. A parent that is not known is reported and
        replaced by the root of the kind; a cycle is reported and broken."""
        type_by_id = {}
        problem_list = []
        for define, defined_by in entry_list:
            type_id = define['id']
            if type_id in type_by_id:
                problem_list.append(f'the type {type_id} of {defined_by_label_get(defined_by)} is defined by '
                                    f'{defined_by_label_get(type_by_id[type_id]["definedBy"])} already; the first is kept')
                continue
            type_by_id[type_id] = {**define, 'extendList': list(define['extendList']), 'definedBy': dict(defined_by)}
        for type_define in type_by_id.values():
            extend_list = []
            for parent in type_define['extendList']:
                parent_define = type_by_id.get(parent)
                if parent_define is None:
                    root = TYPE_ROOT_BY_KIND[type_define['kind']]
                    problem_list.append(f'the type {type_define["id"]} extends {parent}, which no one defines; it extends {root} instead')
                    parent = root
                elif parent_define['kind'] != type_define['kind']:
                    problem_list.append(f'the type {type_define["id"]} ({type_define["kind"]}) cannot extend {parent} ({parent_define["kind"]})')
                    continue
                if parent != type_define['id'] and parent not in extend_list:
                    extend_list.append(parent)
            type_define['extendList'] = extend_list
        # a cycle: the edge that closes it is dropped
        state_by_id = {}

        def visit(type_id, path):
            state_by_id[type_id] = 'visiting'
            type_define = type_by_id[type_id]
            for parent in list(type_define['extendList']):
                if parent not in type_by_id:
                    continue
                if state_by_id.get(parent) == 'visiting':
                    problem_list.append(f'the types extend one another in a cycle: {" -> ".join(path + [type_id, parent])}; '
                                        f'{type_id} no longer extends {parent}')
                    type_define['extendList'].remove(parent)
                elif state_by_id.get(parent) is None:
                    visit(parent, path + [type_id])
            state_by_id[type_id] = 'done'

        for type_id in list(type_by_id):
            if state_by_id.get(type_id) is None:
                visit(type_id, [])
        self.type_by_id = type_by_id
        self.problem_list = problem_list
        self._ancestor_by_id = {}
        self.signature = signature

    def get(self, type_id):
        return self.type_by_id.get(type_id)

    def ancestor_distance_get(self, type_id):
        """{ ancestor: distance } of a type, itself at 0. A type no one defines is
        taken as a child of both roots: every object is a core.object."""
        cached = self._ancestor_by_id.get(type_id)
        if cached is not None:
            return cached
        if type_id not in self.type_by_id:
            result = {type_id: 0, 'core.object': 1, 'core.relation': 1}
        else:
            result = {type_id: 0}
            frontier = [type_id]
            distance = 0
            while frontier:
                distance += 1
                frontier_next = []
                for current in frontier:
                    for parent in (self.type_by_id.get(current) or {}).get('extendList', []):
                        if parent not in result:
                            result[parent] = distance
                            frontier_next.append(parent)
                frontier = frontier_next
        self._ancestor_by_id[type_id] = result
        return result

    def is_assignable(self, type_id, type_id_to):
        """Whether an object of type_id is an object of type_id_to (the same, or a subtype)."""
        return type_id_to in self.ancestor_distance_get(type_id)

    def is_assignable_any(self, type_list, type_list_to):
        return any(self.is_assignable(type_id, type_id_to) for type_id in type_list for type_id_to in type_list_to)

    def info_list_get(self):
        result = []
        for type_define in self.type_by_id.values():
            ancestor = self.ancestor_distance_get(type_define['id'])
            result.append({**type_define, 'ancestorList': sorted((item for item in ancestor if item != type_define['id']),
                                                                 key=lambda item: (ancestor[item], item))})
        return result


def defined_by_label_get(defined_by):
    kind = defined_by.get('kind')
    if kind == 'builtIn':
        return 'the built-in types'
    if kind == 'serviceTemplate':
        return f'the template {defined_by.get("name", "")} ({defined_by.get("id", "")})'
    if kind == 'serviceInstance':
        return f'the instance {defined_by.get("id", "")} (its template is not found)'
    return str(kind)


def builtin_type_list_read():
    """The built-in types: (type_list, problem); a missing or broken file leaves the two roots."""
    root_list = [type_define_normalize({'id': 'core.object', 'kind': 'object', 'label': 'Object'}, 'the built-in types'),
                 type_define_normalize({'id': 'core.relation', 'kind': 'relation', 'label': 'Relation'}, 'the built-in types')]
    try:
        with open(OBJECT_TYPE_BUILTIN_FILE, encoding='utf-8') as file:
            raw = yaml.safe_load(file)
        type_list = [type_define_normalize(item, f'{OBJECT_TYPE_BUILTIN_FILE} typeList[{index}]')
                     for index, item in enumerate(raw.get('typeList') or [])]
        return type_list, ''
    except (OSError, ValueError, yaml.YAMLError, ServiceDefineError) as error:
        return root_list, f'the built-in types cannot be read from {OBJECT_TYPE_BUILTIN_FILE}: {error}'


def text_is_match(descriptor, text):
    if not text:
        return True
    text_lower = text.lower()
    return text_lower in descriptor.get('label', '').lower() or text_lower in descriptor.get('description', '').lower() \
        or text_lower in descriptor.get('ref', '').lower()


# ---------- providers ----------

class KernelObjectProvider:
    """The kernel's own objects: every template (service.template), every
    instance (service.instance) and the config of every instance
    (service.config, read and written in its service.yaml); and their
    relations (service.createdFrom, service.dependsOn)."""

    provider_id = 'kernel'

    def __init__(self, runtime):
        self.runtime = runtime

    def info_get(self):
        return {
            'id': self.provider_id,
            'label': 'the service runtime kernel',
            'registry': 'backend',
            'namespaceList': list(KERNEL_NAMESPACE_LIST),
            'typeList': ['service.template', 'service.instance', 'service.config'],
            'relationTypeList': ['service.createdFrom', 'service.dependsOn'],
            'capabilityList': ['query', 'count', 'resolve', 'read', 'update', 'relationQuery'],
            'queryFilterList': ['kind', 'status'],
            # local and cheap: answered fresh every time
            'cacheSecond': 0,
            'status': 'ready',
            'serviceId': '',
        }

    # ----- descriptors -----

    def _instance_descriptor(self, instance):
        config = instance.service_config or {}
        template = config.get('template') or {}
        health, _message = self.runtime.health_get(instance, self.runtime.dependency_status_list_get(instance))
        return {
            'ref': f'service:{instance.service_id}',
            'typeList': ['service.instance'],
            'label': config.get('name') or instance.service_id,
            'description': config.get('description', ''),
            'summary': {'status': instance.status, 'kind': instance.kind, 'health': health, 'templateName': template.get('name', ''),
                        'configRef': f'serviceConfig:{instance.service_id}'},
            'iconUrl': f'/instance/icon/{instance.service_id}' if (instance.expose or {}).get('meta', {}).get('icon') else '',
            'capabilityList': ['read'],
            'open': {'kind': 'serviceInstance', 'serviceId': instance.service_id},
        }

    def _template_descriptor(self, template):
        expose = template.script.expose or {}
        meta = expose.get('meta') or {}
        return {
            'ref': f'serviceTemplate:{template.template_id}',
            'typeList': ['service.template'],
            'label': meta.get('label') or template.name,
            'description': template.template_config.get('description', '') or meta.get('description', ''),
            'summary': {'name': template.name, 'kind': template.kind, 'status': template.status,
                        'versionId': template.template_config.get('versionId', '')},
            'iconUrl': f'/template/icon/{template.template_id}' if meta.get('icon') else '',
            'capabilityList': ['read'],
            'open': {'kind': 'serviceTemplate', 'templateId': template.template_id},
        }

    def _config_descriptor(self, instance):
        config = instance.service_config or {}
        name = config.get('name') or instance.service_id
        define_list = (instance.script.expose or {}).get('configDefineList') or []
        return {
            'ref': f'serviceConfig:{instance.service_id}',
            'typeList': ['service.config'],
            'label': f'{name} · config',
            'description': f'the config of the {instance.kind} service {name}, in its service.yaml',
            'summary': {'keyCount': len(define_list), 'serviceId': instance.service_id, 'serviceName': name},
            'iconUrl': '',
            'capabilityList': ['read', 'update'] if instance.script.expose is not None else ['read'],
            'open': {'kind': 'serviceInstance', 'serviceId': instance.service_id},
        }

    def _descriptor_get(self, ref):
        namespace, local = object_ref_split(ref)
        with self.runtime.lock:
            if namespace == 'service':
                instance = self.runtime.instance_by_id.get(local)
                return self._instance_descriptor(instance) if instance is not None else None
            if namespace == 'serviceConfig':
                instance = self.runtime.instance_by_id.get(local)
                return self._config_descriptor(instance) if instance is not None else None
            if namespace == 'serviceTemplate':
                template = self.runtime.template_by_id.get(local)
                return self._template_descriptor(template) if template is not None else None
        return None

    # ----- capabilities -----

    def query(self, spec, _caller):
        type_registry = self.runtime.object_registry.type_registry
        result = []
        with self.runtime.lock:
            instance_list = list(self.runtime.instance_by_id.values())
            template_list = list(self.runtime.template_by_id.values())
            filter_value = spec['filter']
            if type_registry.is_assignable_any(['service.template'], spec['typeList']):
                for template in template_list:
                    if filter_value.get('kind') and template.kind != filter_value['kind']:
                        continue
                    if filter_value.get('status') and template.status != filter_value['status']:
                        continue
                    result.append(self._template_descriptor(template))
            for instance in instance_list:
                if filter_value.get('kind') and instance.kind != filter_value['kind']:
                    continue
                if filter_value.get('status') and instance.status != filter_value['status']:
                    continue
                if type_registry.is_assignable_any(['service.instance'], spec['typeList']):
                    result.append(self._instance_descriptor(instance))
                if type_registry.is_assignable_any(['service.config'], spec['typeList']):
                    result.append(self._config_descriptor(instance))
        return [item for item in result if text_is_match(item, spec['text'])]

    def resolve(self, ref_list, _caller):
        return [self._descriptor_get(ref) for ref in ref_list]

    def count(self, spec, caller):
        # local and cheap: the query itself
        return len(self.query(spec, caller))

    def read(self, ref, _caller):
        namespace, local = object_ref_split(ref)
        descriptor = self._descriptor_get(ref)
        if descriptor is None:
            raise ServiceError(-3, f'{ref} is not found')
        if namespace == 'serviceConfig':
            instance = self.runtime.instance_get(local)
            return {'descriptor': descriptor, 'content': {
                'valueByKey': dict((instance.service_config or {}).get('config') or {}),
                'defineList': list((instance.script.expose or {}).get('configDefineList') or []),
            }}
        if namespace == 'service':
            info = self.runtime.instance_get(local).info_get()
            return {'descriptor': descriptor, 'content': {key: info.get(key) for key in [
                'serviceId', 'name', 'description', 'kind', 'status', 'message', 'health', 'healthMessage', 'template',
                'dependencyList', 'dependencyStatusList', 'infraName', 'executionMode', 'timeCreated', 'origin']}}
        template = self.runtime.template_get(local)
        info = template.info_get()
        expose = info.get('expose') or {}
        return {'descriptor': descriptor, 'content': {
            **{key: info.get(key) for key in ['templateId', 'name', 'kind', 'description', 'provision', 'infraName', 'status',
                                               'message', 'versionId', 'origin', 'groupPath']},
            'typeList': expose.get('typeList', []), 'objectProvide': expose.get('objectProvide'),
            'compList': expose.get('compList', []), 'requireList': expose.get('requireList', []),
        }}

    def update(self, ref, patch, _caller):
        """Only a config can be changed: { valueByKey }, merged into the instance's
        config, checked against its own script, written into its service.yaml;
        the instance restarts with it."""
        namespace, local = object_ref_split(ref)
        if namespace != 'serviceConfig':
            raise ServiceError(-2, f'{ref} cannot be changed through the object registry')
        if not isinstance(patch, dict) or not isinstance(patch.get('valueByKey'), dict):
            raise ServiceError(-1, 'the change of a config is { valueByKey: { key: value } }')
        instance = self.runtime.instance_get(local)
        self.runtime.instance_config_set(instance.service_id, patch['valueByKey'])
        return self.read(ref, _caller)

    def relation_query(self, spec, _caller):
        type_registry = self.runtime.object_registry.type_registry
        result = []
        with self.runtime.lock:
            instance_list = list(self.runtime.instance_by_id.values())
            infra_info_by_name = dict(self.runtime.infra_info_by_name)
        is_created_from = type_registry.is_assignable_any(['service.createdFrom'], spec['typeList'])
        is_depends_on = type_registry.is_assignable_any(['service.dependsOn'], spec['typeList'])
        for instance in instance_list:
            from_ref = f'service:{instance.service_id}'
            template = (instance.service_config or {}).get('template') or {}
            if is_created_from and template.get('templateId'):
                result.append({'key': f'createdFrom/{instance.service_id}', 'type': 'service.createdFrom', 'fromRef': from_ref,
                               'toRef': f'serviceTemplate:{template["templateId"]}', 'order': None, 'label': '',
                               'data': {'versionId': template.get('versionId', '')}})
            if is_depends_on:
                for index, item in enumerate(instance.dependency_list_get()):
                    current = (infra_info_by_name.get(item['name']) or {}).get('serviceId', '')
                    if not current:
                        continue
                    result.append({'key': f'dependsOn/{instance.service_id}/{item["name"]}', 'type': 'service.dependsOn',
                                   'fromRef': from_ref, 'toRef': f'service:{current}', 'order': index, 'label': item['name'],
                                   'data': {'infraName': item['name'], 'isRequired': item['isRequired']}})
        return result


class InstanceObjectProvider:
    """An instance whose script declares expose.objectProvide: its objects are
    of the namespace service.{serviceId}, and it is asked through its object
    apis, as the kernel, in its queue."""

    def __init__(self, runtime, instance):
        self.runtime = runtime
        self.instance = instance
        self.provider_id = f'service:{instance.service_id}'
        self.namespace = f'{INSTANCE_NAMESPACE_PREFIX}{instance.service_id}'

    @property
    def provide(self):
        return (self.instance.expose or {}).get('objectProvide') or {}

    def info_get(self):
        provide = self.provide
        config = self.instance.service_config or {}
        return {
            'id': self.provider_id,
            'label': config.get('name') or self.instance.service_id,
            'registry': 'backend',
            'namespaceList': [self.namespace],
            'typeList': list(provide.get('typeList', [])),
            'relationTypeList': list(provide.get('relationTypeList', [])),
            'capabilityList': list(provide.get('capabilityList', [])),
            'queryFilterList': list(provide.get('queryFilterList', [])),
            'cacheSecond': provide.get('cacheSecond', OBJECT_CACHE_SECOND_DEFAULT),
            'status': self.instance.status,
            'serviceId': self.instance.service_id,
            'templateName': (config.get('template') or {}).get('name', ''),
        }

    def _call(self, api_name, params, caller):
        """An object api of the instance, as the kernel, on behalf of the caller
        (its chain kept, so a call back into a busy queue is refused, not waited for)."""
        caller_kernel = ServiceCaller('kernel', chain=caller.chain if caller is not None else ())
        result = self.runtime.api_call({'serviceId': self.instance.service_id}, api_name, params, caller_kernel,
                                       wait_second=self.runtime.object_registry.provider_wait_second)
        if result.get('code') != 0:
            raise ServiceError(result.get('code', -1), result.get('message', f'{api_name} failed'))
        return result.get('data')

    def query(self, spec, caller):
        data = self._call('objectQuery', {'typeList': spec['typeList'], 'text': spec['text'], 'filter': spec['filter'],
                                          'limit': spec['limit']}, caller)
        if not isinstance(data, list):
            raise ServiceError(-1, f'objectQuery of {self.instance.service_id} answers a list of descriptors')
        return [object_descriptor_normalize(item, f'objectQuery of {self.instance.service_id}', self.namespace) for item in data]

    def count(self, spec, caller):
        data = self._call('objectCount', {'typeList': spec['typeList'], 'text': spec['text'], 'filter': spec['filter']}, caller)
        if not isinstance(data, int) or isinstance(data, bool) or data < 0:
            raise ServiceError(-1, f'objectCount of {self.instance.service_id} answers a number')
        return data

    def resolve(self, ref_list, caller):
        local_list = [object_ref_split(ref)[1] for ref in ref_list]
        data = self._call('objectResolve', {'localIdList': local_list}, caller)
        if not isinstance(data, list) or len(data) != len(ref_list):
            raise ServiceError(-1, f'objectResolve of {self.instance.service_id} answers one descriptor or null per id, in order')
        return [None if item is None else object_descriptor_normalize(item, f'objectResolve of {self.instance.service_id}', self.namespace)
                for item in data]

    def read(self, ref, caller):
        data = self._call('objectRead', {'localId': object_ref_split(ref)[1]}, caller)
        return self._read_result_normalize(data, 'objectRead')

    def update(self, ref, patch, caller):
        data = self._call('objectUpdate', {'localId': object_ref_split(ref)[1], 'patch': patch}, caller)
        return self._read_result_normalize(data, 'objectUpdate')

    def _read_result_normalize(self, data, api_name):
        if not isinstance(data, dict) or 'descriptor' not in data:
            raise ServiceError(-1, f'{api_name} of {self.instance.service_id} answers {{ descriptor, content }}')
        return {'descriptor': object_descriptor_normalize(data['descriptor'], f'{api_name} of {self.instance.service_id}', self.namespace),
                'content': data.get('content')}

    def relation_query(self, spec, caller):
        data = self._call('relationQuery', {'fromRef': spec['fromRef'], 'toRef': spec['toRef'], 'typeList': spec['typeList']}, caller)
        if not isinstance(data, list):
            raise ServiceError(-1, f'relationQuery of {self.instance.service_id} answers a list of relations')
        return [relation_normalize(item, f'relationQuery of {self.instance.service_id}', self.namespace) for item in data]


# ---------- the registry ----------

class ObjectRegistry:
    """Discovery and resolution of objects on the backend, federated over the
    providers, tolerant of providers that are slow, gone or stale."""

    def __init__(self, runtime, provider_wait_second=PROVIDER_WAIT_SECOND_DEFAULT):
        self.runtime = runtime
        self.provider_wait_second = float(provider_wait_second)
        self.type_registry = TypeRegistry()
        self.kernel_provider = KernelObjectProvider(runtime)
        self.builtin_type_list, self.builtin_problem = builtin_type_list_read()
        # ref -> { descriptor, registrant: { kind, id }, timeRegistered }
        self.registration_by_ref = {}
        # (provider id, request key) -> { time, list }: what a provider answered
        self.query_cache = {}
        self.relation_cache = {}
        # ref -> { time, descriptor, providerId }
        self.resolve_cache = {}
        self.lock = threading.RLock()

    # ---------- types ----------

    def types_rebuild(self, template_list, instance_list):
        """The type registry rebuilt when a template's or an instance's script changed:
        the built-in types, the templates' (oldest id first), then those of instances
        whose template is not found. A template defines types under its name only."""
        template_list = sorted(template_list, key=lambda template: template.template_id)
        template_id_set = {template.template_id for template in template_list}
        instance_orphan_list = sorted((instance for instance in instance_list
                                       if ((instance.service_config or {}).get('template') or {}).get('templateId') not in template_id_set),
                                      key=lambda instance: instance.service_id)
        signature = tuple((template.template_id, template.script.load_count) for template in template_list) \
            + tuple((instance.service_id, instance.script.load_count) for instance in instance_orphan_list)
        if signature == self.type_registry.signature:
            return
        entry_list = [(item, {'kind': 'builtIn'}) for item in self.builtin_type_list]
        problem_list = [self.builtin_problem] if self.builtin_problem else []
        owner_list = [(template.name, template.script.expose, {'kind': 'serviceTemplate', 'id': template.template_id, 'name': template.name})
                      for template in template_list]
        owner_list += [(((instance.service_config or {}).get('template') or {}).get('name', ''), instance.script.expose,
                        {'kind': 'serviceInstance', 'id': instance.service_id,
                         'name': ((instance.service_config or {}).get('template') or {}).get('name', '')})
                       for instance in instance_orphan_list]
        for name, expose, defined_by in owner_list:
            for item in (expose or {}).get('typeList') or []:
                if not item['id'].startswith(f'{name}.'):
                    problem_list.append(f'{defined_by_label_get(defined_by)} defines {item["id"]}: a template defines types under its name ({name}.…)')
                    continue
                entry_list.append((item, defined_by))
        self.type_registry.rebuild(entry_list, signature)
        self.type_registry.problem_list = problem_list + self.type_registry.problem_list
        with self.lock:
            self.query_cache.clear()
            self.relation_cache.clear()

    def type_list_get(self):
        return {'typeList': self.type_registry.info_list_get(), 'problemList': list(self.type_registry.problem_list)}

    # ---------- providers ----------

    def provider_list_get(self):
        with self.runtime.lock:
            instance_list = sorted(self.runtime.instance_by_id.values(), key=lambda instance: instance.service_id)
        provider_list = [self.kernel_provider]
        for instance in instance_list:
            if (instance.expose or {}).get('objectProvide'):
                provider_list.append(InstanceObjectProvider(self.runtime, instance))
        return provider_list

    def provider_info_list_get(self):
        return [provider.info_get() for provider in self.provider_list_get()]

    def _provider_by_namespace_get(self, namespace):
        if namespace in KERNEL_NAMESPACE_LIST:
            return self.kernel_provider
        if namespace.startswith(INSTANCE_NAMESPACE_PREFIX):
            with self.runtime.lock:
                instance = self.runtime.instance_by_id.get(namespace[len(INSTANCE_NAMESPACE_PREFIX):])
            if instance is not None and (instance.expose or {}).get('objectProvide'):
                return InstanceObjectProvider(self.runtime, instance)
        return None

    def namespace_is_backend(self, namespace):
        """Whether a namespace belongs to a provider of the backend (now or when its instance runs)."""
        return namespace in KERNEL_NAMESPACE_LIST or namespace.startswith(INSTANCE_NAMESPACE_PREFIX)

    def _provider_call(self, provider, info, caller, call):
        """One call of a provider of a federated request: (status, value, message).
        status: answered, unavailable (not ready), skipped (the caller is the
        provider: its queue is busy with this very call), timedOut, failed."""
        if info['status'] != 'ready':
            return 'unavailable', None, f'{info["label"]} is {info["status"]}'
        if info.get('serviceId') and caller is not None and (info['serviceId'] in caller.chain or info['serviceId'] == caller.service_id):
            return 'skipped', None, f'{info["label"]} is the caller itself'
        try:
            return 'answered', call(), ''
        except ServiceError as error:
            return ('timedOut' if error.code == -6 else 'failed'), None, error.message
        except Exception as error:
            return 'failed', None, f'{type(error).__name__}: {error}'

    # ---------- query ----------

    def _query_spec_normalize(self, spec):
        if not isinstance(spec, dict):
            raise ServiceError(-1, 'a query is { typeList, text?, filter?, limit?, providerIdList?, isFresh? }')
        type_list = spec.get('typeList') or ['core.object']
        if isinstance(type_list, str):
            type_list = [type_list]
        if not isinstance(type_list, list) or not all(isinstance(item, str) and REGEX_TYPE_ID.match(item) for item in type_list):
            raise ServiceError(-1, 'typeList of a query lists type ids')
        filter_value = spec.get('filter') or {}
        if not isinstance(filter_value, dict):
            raise ServiceError(-1, 'filter of a query is a mapping')
        provider_id_list = spec.get('providerIdList') or []
        if not isinstance(provider_id_list, list):
            raise ServiceError(-1, 'providerIdList of a query is a list')
        try:
            limit = int(spec.get('limit') or 100)
        except (TypeError, ValueError):
            raise ServiceError(-1, 'limit of a query is a number')
        return {
            'typeList': type_list,
            'text': str(spec.get('text') or ''),
            'filter': filter_value,
            'limit': max(1, min(QUERY_LIMIT_MAX, limit)),
            'providerIdList': [str(item) for item in provider_id_list],
            'isFresh': spec.get('isFresh') is True,
        }

    def query(self, spec, caller=None):
        """Objects of the types asked for, and of their subtypes: { objectList,
        completeness: { isComplete, providerList }, isTruncated }. Each provider
        of a type assignable to one asked for is asked (or its answer of the last
        cacheSecond reused); the registered descriptors are added. A provider that
        does not answer is in completeness, and what it answered before, if
        anything, is still answered with the status unavailable."""
        spec = self._query_spec_normalize(spec)
        key = json.dumps({name: spec[name] for name in ['typeList', 'text', 'filter', 'limit']}, sort_keys=True)
        now = time.time()
        object_by_ref = {}
        completeness_list = []
        for provider in self.provider_list_get():
            info = provider.info_get()
            if spec['providerIdList'] and info['id'] not in spec['providerIdList']:
                continue
            if 'query' not in info['capabilityList'] or not self.type_registry.is_assignable_any(info['typeList'], spec['typeList']):
                continue
            cache_key = (info['id'], key)
            with self.lock:
                cached = self.query_cache.get(cache_key)
            if cached is not None and not spec['isFresh'] and now - cached['time'] < info['cacheSecond']:
                status, object_list, message, time_checked = 'cached', cached['list'], '', cached['time']
            else:
                status, object_list, message = self._provider_call(provider, info, caller, lambda: provider.query(spec, caller))
                time_checked = now
                if status == 'answered':
                    with self.lock:
                        self.query_cache[cache_key] = {'time': now, 'list': object_list}
                elif cached is not None:
                    object_list, time_checked = cached['list'], cached['time']
            descriptor_status = 'found' if status in ('answered', 'cached') else 'unavailable'
            count = 0
            for descriptor in object_list or []:
                if not self.type_registry.is_assignable_any(descriptor['typeList'], spec['typeList']) or not text_is_match(descriptor, spec['text']):
                    continue
                object_by_ref.setdefault(descriptor['ref'], self._descriptor_out(descriptor, info, descriptor_status, time_checked))
                count += 1
            completeness_list.append({'providerId': info['id'], 'label': info['label'], 'status': status, 'count': count,
                                      'message': message, 'timeChecked': time_checked})
        # what was registered and no provider answered (a registrant without a
        # provider, the page's documents; or a provider that did not answer);
        # a query of named providers wants theirs only, unless it names 'registration'
        count_registered = 0
        with self.lock:
            registration_list = list(self.registration_by_ref.values())
        if spec['providerIdList'] and 'registration' not in spec['providerIdList']:
            registration_list = []
        for registration in registration_list:
            descriptor = registration['descriptor']
            if descriptor['ref'] in object_by_ref:
                continue
            if not self.type_registry.is_assignable_any(descriptor['typeList'], spec['typeList']) or not text_is_match(descriptor, spec['text']):
                continue
            object_by_ref[descriptor['ref']] = self._descriptor_out(descriptor, {'id': 'registration', 'label': 'registered',
                                                                                 'registrant': registration['registrant']},
                                                                    'registered', registration['timeRegistered'])
            count_registered += 1
        if count_registered:
            completeness_list.append({'providerId': 'registration', 'label': 'registered descriptors', 'status': 'registered',
                                      'count': count_registered, 'message': '', 'timeChecked': None})
        object_list = list(object_by_ref.values())
        return {
            'objectList': object_list[:spec['limit']],
            'isTruncated': len(object_list) > spec['limit'],
            'completeness': {
                'isComplete': all(item['status'] in ('answered', 'cached', 'registered') for item in completeness_list),
                'providerList': completeness_list,
            },
        }

    def _descriptor_out(self, descriptor, info, status, time_checked, message=''):
        provider = {'id': info['id'], 'label': info.get('label', ''), 'registry': 'backend'}
        if info.get('registrant'):
            provider['registrant'] = info['registrant']
        return {**descriptor, 'status': status, 'timeChecked': time_checked, 'provider': provider,
                **({'message': message} if message else {})}

    # ---------- count: the preflight of a search ----------

    def count(self, spec, caller=None):
        """How many objects each provider of the types asked for would answer to a
        query, without fetching any (doc_page_impl_obj_search.md#the-preflight):
        { providerList: [{ providerId, label, status, count, countKind, message }] }.
        countKind is exact for a provider that counts (capability count), unknown
        for one that can only list: a search fetches a bounded page of it instead."""
        spec = self._query_spec_normalize({**spec, 'limit': 1})
        result = []
        for provider in self.provider_list_get():
            info = provider.info_get()
            if spec['providerIdList'] and info['id'] not in spec['providerIdList']:
                continue
            if 'query' not in info['capabilityList'] or not self.type_registry.is_assignable_any(info['typeList'], spec['typeList']):
                continue
            entry = {'providerId': info['id'], 'label': info['label'], 'serviceId': info.get('serviceId', ''), 'count': None,
                     'countKind': 'unknown', 'status': 'answered', 'message': ''}
            if 'count' in info['capabilityList']:
                status, count, message = self._provider_call(provider, info, caller, lambda: provider.count(spec, caller))
                entry.update({'status': status, 'message': message})
                if status == 'answered':
                    entry.update({'count': count, 'countKind': 'exact'})
            elif info['status'] != 'ready':
                entry.update({'status': 'unavailable', 'message': f'{info["label"]} is {info["status"]}'})
            result.append(entry)
        return {'providerList': result}

    # ---------- resolve ----------

    def resolve(self, ref_list, is_verify=False, caller=None):
        """The descriptor of every reference, in order, each with its status. A
        reference whose provider answered within its cacheSecond is not asked
        again unless is_verify. A provider that cannot be asked leaves what was
        known (cached, else registered) with the status unavailable."""
        if not isinstance(ref_list, list) or not all(isinstance(ref, str) for ref in ref_list):
            raise ServiceError(-1, 'refList is a list of object references')
        now = time.time()
        result = [None] * len(ref_list)
        index_list_by_namespace = {}
        for index, ref in enumerate(ref_list):
            try:
                namespace, _local = object_ref_split(ref)
            except ServiceError as error:
                result[index] = self._unknown_get(ref, 'unknown', error.message)
                continue
            index_list_by_namespace.setdefault(namespace, []).append(index)
        for namespace, index_list in index_list_by_namespace.items():
            provider = self._provider_by_namespace_get(namespace)
            if provider is None:
                for index in index_list:
                    result[index] = self._known_get(ref_list[index], 'unknown', f'no provider of the namespace {namespace} on the backend')
                continue
            info = provider.info_get()
            ask_list = []
            for index in index_list:
                ref = ref_list[index]
                with self.lock:
                    cached = self.resolve_cache.get(ref)
                if cached is not None and not is_verify and now - cached['time'] < info['cacheSecond']:
                    result[index] = self._descriptor_out(cached['descriptor'], info, 'found', cached['time'])
                else:
                    ask_list.append(index)
            if not ask_list:
                continue
            if 'resolve' not in info['capabilityList']:
                for index in ask_list:
                    result[index] = self._known_get(ref_list[index], 'registered', f'{info["label"]} does not resolve its objects one by one')
                continue
            status, answer_list, message = self._provider_call(provider, info, caller, lambda: provider.resolve([ref_list[index] for index in ask_list], caller))
            for position, index in enumerate(ask_list):
                ref = ref_list[index]
                if status != 'answered':
                    result[index] = self._known_get(ref, 'unavailable', message)
                    continue
                descriptor = answer_list[position]
                if descriptor is None:
                    with self.lock:
                        self.resolve_cache.pop(ref, None)
                    result[index] = self._unknown_get(ref, 'missing', f'{info["label"]} has no object {ref}')
                    continue
                with self.lock:
                    self.resolve_cache[ref] = {'time': now, 'descriptor': descriptor, 'providerId': info['id']}
                result[index] = self._descriptor_out(descriptor, info, 'found', now)
        return result

    def _unknown_get(self, ref, status, message):
        return {'ref': ref, 'typeList': [], 'label': ref, 'description': '', 'summary': {}, 'iconUrl': '', 'capabilityList': [],
                'open': None, 'status': status, 'timeChecked': time.time(), 'provider': None, 'message': message}

    def _known_get(self, ref, status, message):
        """What is known of a reference its provider cannot answer for: the cached
        descriptor, else the registered one, else nothing but the reference."""
        with self.lock:
            cached = self.resolve_cache.get(ref)
            registration = self.registration_by_ref.get(ref)
        if cached is not None:
            return {**cached['descriptor'], 'status': status, 'timeChecked': cached['time'],
                    'provider': {'id': cached['providerId'], 'label': '', 'registry': 'backend'}, 'message': message}
        if registration is not None:
            return {**registration['descriptor'], 'status': 'registered' if status == 'unknown' else status,
                    'timeChecked': registration['timeRegistered'],
                    'provider': {'id': 'registration', 'label': 'registered', 'registry': 'backend', 'registrant': registration['registrant']},
                    'message': message}
        return self._unknown_get(ref, status, message)

    # ---------- read, update ----------

    def _provider_require(self, ref, capability):
        namespace, _local = object_ref_split(ref)
        provider = self._provider_by_namespace_get(namespace)
        if provider is None:
            raise ServiceError(-3, f'no provider of the namespace {namespace} on the backend')
        info = provider.info_get()
        if capability not in info['capabilityList']:
            raise ServiceError(-2, f'{info["label"]} does not {capability} its objects')
        if info['status'] != 'ready':
            raise ServiceError(-4, f'{info["label"]} is {info["status"]}')
        return provider, info

    def read(self, ref, caller=None):
        """{ descriptor, content }, from the provider: the registry never answers a read from what it keeps."""
        provider, info = self._provider_require(ref, 'read')
        result = provider.read(ref, caller)
        with self.lock:
            self.resolve_cache[ref] = {'time': time.time(), 'descriptor': result['descriptor'], 'providerId': info['id']}
        return {'descriptor': self._descriptor_out(result['descriptor'], info, 'found', time.time()), 'content': result['content']}

    def update(self, ref, patch, caller=None):
        """A change, checked and made by the provider; what the registry kept of the provider is asked again."""
        provider, info = self._provider_require(ref, 'update')
        result = provider.update(ref, patch, caller)
        self.changed(info['id'], None)
        return {'descriptor': self._descriptor_out(result['descriptor'], info, 'found', time.time()), 'content': result['content']}

    # ---------- relations ----------

    def relation_query(self, spec, caller=None):
        """The relations from fromRef and / or to toRef, of the relation types asked
        for (core.relation: all), from every provider of one of them:
        { relationList, completeness }."""
        if not isinstance(spec, dict):
            raise ServiceError(-1, 'a relation query is { fromRef?, toRef?, typeList?, isFresh? }')
        type_list = spec.get('typeList') or ['core.relation']
        if isinstance(type_list, str):
            type_list = [type_list]
        spec = {'fromRef': str(spec.get('fromRef') or ''), 'toRef': str(spec.get('toRef') or ''), 'typeList': list(type_list),
                'isFresh': spec.get('isFresh') is True}
        key = json.dumps({name: spec[name] for name in ['fromRef', 'toRef', 'typeList']}, sort_keys=True)
        now = time.time()
        relation_list = []
        completeness_list = []
        for provider in self.provider_list_get():
            info = provider.info_get()
            if 'relationQuery' not in info['capabilityList'] or not self.type_registry.is_assignable_any(info['relationTypeList'], spec['typeList']):
                continue
            cache_key = (info['id'], key)
            with self.lock:
                cached = self.relation_cache.get(cache_key)
            if cached is not None and not spec['isFresh'] and now - cached['time'] < info['cacheSecond']:
                status, answer_list, message = 'cached', cached['list'], ''
            else:
                status, answer_list, message = self._provider_call(provider, info, caller, lambda: provider.relation_query(spec, caller))
                if status == 'answered':
                    with self.lock:
                        self.relation_cache[cache_key] = {'time': now, 'list': answer_list}
                elif cached is not None:
                    answer_list = cached['list']
            count = 0
            for relation in answer_list or []:
                if spec['fromRef'] and relation['fromRef'] != spec['fromRef']:
                    continue
                if spec['toRef'] and relation['toRef'] != spec['toRef']:
                    continue
                if not self.type_registry.is_assignable_any([relation['type']], spec['typeList']):
                    continue
                relation_list.append({**relation, 'provider': {'id': info['id'], 'label': info['label'], 'registry': 'backend'},
                                      'status': 'found' if status in ('answered', 'cached') else 'unavailable'})
                count += 1
            completeness_list.append({'providerId': info['id'], 'label': info['label'], 'status': status, 'count': count, 'message': message})
        relation_list.sort(key=lambda item: (item['fromRef'], item['order'] if item['order'] is not None else 0, item['key']))
        return {'relationList': relation_list, 'completeness': {
            'isComplete': all(item['status'] in ('answered', 'cached') for item in completeness_list), 'providerList': completeness_list}}

    # ---------- registration ----------

    def register(self, descriptor_list, registrant, namespace_list=None, is_replace=False):
        """Descriptors a principal hands the registry: known, not verified. A
        service registers in its own namespace only; the page in namespaces no
        provider of the backend claims (its documents). With is_replace, what the
        registrant registered before in namespace_list is dropped first."""
        if not isinstance(descriptor_list, list):
            raise ServiceError(-1, 'descriptorList is a list of descriptors')
        namespace_list = list(namespace_list or [])
        for namespace in namespace_list:
            if registrant['kind'] == 'page' and self.namespace_is_backend(namespace):
                raise ServiceError(-2, f'the page cannot register objects of the namespace {namespace}: a provider of the backend owns it')
        normalized_list = []
        for index, item in enumerate(descriptor_list):
            namespace_own = namespace_list[0] if registrant['kind'] == 'service' else None
            descriptor = object_descriptor_normalize(item, f'descriptorList[{index}]', namespace_own)
            namespace = object_ref_split(descriptor['ref'])[0]
            if registrant['kind'] == 'page' and self.namespace_is_backend(namespace):
                raise ServiceError(-2, f'the page cannot register {descriptor["ref"]}: a provider of the backend owns its namespace')
            if namespace_list and namespace not in namespace_list:
                raise ServiceError(-1, f'{descriptor["ref"]} is not of the namespaces named ({", ".join(namespace_list)})')
            normalized_list.append(descriptor)
        now = time.time()
        with self.lock:
            if is_replace:
                for ref, registration in list(self.registration_by_ref.items()):
                    if registration['registrant'] == registrant and object_ref_split(ref)[0] in namespace_list:
                        del self.registration_by_ref[ref]
            for descriptor in normalized_list:
                current = self.registration_by_ref.get(descriptor['ref'])
                if current is not None and current['registrant'] != registrant:
                    # one registrant per reference: the first keeps it
                    continue
                self.registration_by_ref[descriptor['ref']] = {'descriptor': descriptor, 'registrant': dict(registrant), 'timeRegistered': now}
            count = len([item for item in self.registration_by_ref.values() if item['registrant'] == registrant])
        return {'registeredCount': len(normalized_list), 'registrantCount': count}

    def unregister(self, ref_list, registrant):
        with self.lock:
            removed = 0
            for ref in ref_list or []:
                registration = self.registration_by_ref.get(ref)
                if registration is not None and registration['registrant'] == registrant:
                    del self.registration_by_ref[ref]
                    removed += 1
        return {'unregisteredCount': removed}

    def changed(self, provider_id, ref_list=None):
        """What the registry kept of a provider (of these references, or all) is dropped."""
        with self.lock:
            for ref in list(self.resolve_cache):
                entry = self.resolve_cache[ref]
                if entry['providerId'] == provider_id and (ref_list is None or ref in ref_list):
                    del self.resolve_cache[ref]
            for cache in (self.query_cache, self.relation_cache):
                for key in [key for key in cache if key[0] == provider_id]:
                    del cache[key]

    def provider_forget(self, provider_id):
        """An instance restarted or gone: its answers are not reused."""
        self.changed(provider_id, None)

    def status_get(self):
        with self.lock:
            return {
                'typeCount': len(self.type_registry.type_by_id),
                'typeProblemList': list(self.type_registry.problem_list),
                'providerCount': len(self.provider_list_get()),
                'registrationCount': len(self.registration_by_ref),
                'cacheCount': len(self.query_cache) + len(self.relation_cache) + len(self.resolve_cache),
                'providerWaitSecond': self.provider_wait_second,
            }


__all__ = ['ObjectRegistry', 'TypeRegistry', 'KernelObjectProvider', 'InstanceObjectProvider', 'OBJECT_STATUS_LIST',
           'TYPE_KIND_LIST', 'KERNEL_NAMESPACE_LIST']
