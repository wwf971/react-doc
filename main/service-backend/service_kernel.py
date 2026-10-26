"""The parts of the service runtime kernel that stand on their own: the kernel
log, the service folders of a doc page, the infra routing table.

Design: doc_page_impl_service.md#the-service-runtime-kernel

The kernel is the part of the backend that is no service: it keeps the
registry (the templates and instances found in the folders it watches),
monitors the instances (lifecycle, dependencies, health), routes an infra
service name to the instance providing it, provisions an infra instance
from a template when something requires a name nobody provides, and writes
what it does into the logging infra service, through the kernel log here.
"""

import json
import os
import sys
import threading
from collections import deque

from service_util import time_iso_get, yaml_read

LOG_LEVEL_LIST = ['debug', 'info', 'warn', 'error']

# the infra service the kernel itself requires: where its records go
# (doc_page_impl_service.md#the-logging-infra-service)
INFRA_LOGGING_NAME = 'logging'

# the files and folders of a doc page that concern the service backend
# (doc_page_impl_dir.md): the config file in its metadata folder, and the
# folders used when the file is absent, relative to the doc page folder
DOC_PAGE_META_DIR_NAME = '.doc-page'
DOC_PAGE_SERVICE_CONFIG_FILE = 'service.yaml'
DOC_PAGE_FOLDER_DEFAULT_LIST = [
    {'path': 'service-template-app', 'role': 'template', 'kind': 'app'},
    {'path': 'service-template-infra', 'role': 'template', 'kind': 'infra'},
    {'path': 'service-app', 'role': 'instance', 'kind': 'app', 'isDefault': True},
    {'path': 'service-infra', 'role': 'instance', 'kind': 'infra', 'isDefault': True},
]
# the folders of the built-in folder (what the package ships), relative to the built-in folder
BUILT_IN_FOLDER_LIST = [
    {'path': 'service-template-app', 'role': 'template', 'kind': 'app'},
    {'path': 'service-template-infra', 'role': 'template', 'kind': 'infra'},
]


class KernelLog:
    """The kernel's own logger: what the kernel and the instances log, on its
    way to the logging infra service (doc_page_impl_service.md#the-logging-infra-service).

    A record is written here first, to stderr (from level warn, or every
    level with isVerbose) and into a bounded buffer; flush() hands the
    buffered records to the logging instance when there is a ready one, so
    nothing is lost while it starts, and the kernel never waits for it. The
    last records stay in memory for GET /log/recent, with or without a
    logging instance. A record is
        { time, level, principal: { kind, id }, feature, message, data }
    principal: who the record is about (the kernel, a service instance, the
    page); feature: which function of it (lifecycle, registry, dependency,
    route, provision, hook, scan, or a feature of a service).
    """

    BUFFER_MAX = 5000
    RECENT_MAX = 500
    FLUSH_BATCH_MAX = 200

    def __init__(self, is_verbose=False):
        self.is_verbose = is_verbose
        self.lock = threading.Lock()
        self.buffer = deque()
        self.recent = deque(maxlen=self.RECENT_MAX)
        self.dropped_count = 0
        self.flushed_count = 0
        self.flush_error = ''

    def write(self, level, feature, message, data=None, principal=None):
        if level not in LOG_LEVEL_LIST:
            level = 'info'
        record = {
            'time': time_iso_get(),
            'level': level,
            'principal': principal or {'kind': 'kernel', 'id': ''},
            'feature': str(feature or ''),
            'message': str(message or ''),
            'data': _json_safe(data),
        }
        with self.lock:
            self.recent.append(record)
            if len(self.buffer) >= self.BUFFER_MAX:
                self.buffer.popleft()
                self.dropped_count += 1
            self.buffer.append(record)
        if self.is_verbose or level in ('warn', 'error'):
            principal_text = record['principal']['kind'] + (f' {record["principal"]["id"]}' if record['principal']['id'] else '')
            print(f'[service] {level} {principal_text} {record["feature"]}: {record["message"]}', file=sys.stderr)

    def kernel(self, level, feature, message, data=None):
        self.write(level, feature, message, data, {'kind': 'kernel', 'id': ''})

    def recent_get(self, limit=200):
        with self.lock:
            record_list = list(self.recent)
        return record_list[-max(1, int(limit)):]

    def buffer_count(self):
        with self.lock:
            return len(self.buffer)

    def flush(self, write_batch):
        """Hands the buffered records to write_batch(recordList) in batches;
        a batch that fails stays in the buffer for the next flush."""
        while True:
            with self.lock:
                if len(self.buffer) == 0:
                    return
                batch = [self.buffer[index] for index in range(min(self.FLUSH_BATCH_MAX, len(self.buffer)))]
            try:
                write_batch(batch)
            except Exception as error:
                self.flush_error = f'{type(error).__name__}: {error}'
                return
            self.flush_error = ''
            with self.lock:
                for _ in range(len(batch)):
                    if len(self.buffer) > 0:
                        self.buffer.popleft()
                self.flushed_count += len(batch)

    def info_get(self):
        with self.lock:
            return {
                'bufferCount': len(self.buffer),
                'droppedCount': self.dropped_count,
                'flushedCount': self.flushed_count,
                'flushError': self.flush_error,
            }


def _json_safe(value):
    """The value as json would keep it; text for what json cannot."""
    if value is None:
        return None
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return str(value)


# ---------- the service folders of a doc page ----------

def doc_page_service_folder_list_read(dir_page, service_file=''):
    """The service folders of a doc page (doc_page_impl_dir.md#service-folders):
    those of its config file when it has one (.doc-page/service.yaml by
    convention, or the file the entry names), the convention folders
    otherwise. Every folder is { path (absolute), role, kind, isDefault };
    raises ValueError for a file that cannot be used.

    The file:
        templateFolderList:
          - { path: ../service-template-app, kind: app }
          - { path: ../service-template-infra, kind: infra }
        instanceFolderList:
          - { path: ../service-app, kind: app, isDefault: true }
          - { path: ../service-infra, kind: infra, isDefault: true }
    paths relative to the file; kind app when absent; a list may be absent
    (no folders of that role).
    """
    if service_file == '':
        service_file = os.path.join(dir_page, DOC_PAGE_META_DIR_NAME, DOC_PAGE_SERVICE_CONFIG_FILE)
    if not os.path.isfile(service_file):
        return [
            {**item, 'path': os.path.normpath(os.path.join(dir_page, item['path'])), 'isDefault': bool(item.get('isDefault', False))}
            for item in DOC_PAGE_FOLDER_DEFAULT_LIST
        ]
    try:
        raw = yaml_read(service_file) or {}
    except Exception as error:
        raise ValueError(f'{service_file} is not valid yaml: {error}')
    if not isinstance(raw, dict):
        raise ValueError(f'{service_file} must be a mapping {{ templateFolderList, instanceFolderList }}')
    dir_base = os.path.dirname(service_file)
    result = []
    for key, role in [('templateFolderList', 'template'), ('instanceFolderList', 'instance')]:
        folder_list = raw.get(key)
        if folder_list is None:
            continue
        if not isinstance(folder_list, list):
            raise ValueError(f'{key} in {service_file} must be a list')
        for item in folder_list:
            result.append(folder_item_normalize(item, dir_base, role, f'{key} in {service_file}'))
    return result


def folder_item_normalize(item, dir_base, role, place):
    """One folder entry of a config: a path, or { path, kind?, isDefault? }."""
    if isinstance(item, str):
        item = {'path': item}
    if not isinstance(item, dict) or not isinstance(item.get('path'), str) or item['path'] == '':
        raise ValueError(f'{place}: every entry is a path or {{ path, kind, isDefault }}')
    kind = item.get('kind', 'app')
    if kind not in ('app', 'infra'):
        raise ValueError(f'{place}: kind must be app or infra')
    return {
        'path': os.path.normpath(os.path.join(dir_base, item['path'])),
        'pathWritten': item['path'],
        'role': role,
        'kind': kind,
        'isDefault': bool(item.get('isDefault', False)),
    }


# ---------- infra routing ----------

class InfraRouteTable:
    """Which instance answers an infra service name (doc_page_impl_service.md#routing-an-infra-service).

    route_by_name: the explicit routes (set from the Services tab, kept in the
    kernel's state file); an explicit route to an instance that is gone or
    does not provide the name is ignored, and reported.
    """

    def __init__(self):
        self.route_by_name = {}

    def current_get(self, name, provider_list):
        """The instance of provider_list (instances providing the name, any
        status) a call of the name goes to; None when there is none. An
        explicit route first; else a ready one, the oldest first, so the same
        one answers while nothing changes; a provisioned one is never
        preferred over one a person created."""
        if len(provider_list) == 0:
            return None
        route_id = self.route_by_name.get(name, '')
        if route_id:
            for instance in provider_list:
                if instance.service_id == route_id:
                    return instance
        ordered = sorted(provider_list, key=lambda instance: (instance.status != 'ready', instance.is_provisioned(), instance.service_id))
        return ordered[0]

    def route_is_explicit(self, name, instance):
        return instance is not None and self.route_by_name.get(name, '') == instance.service_id
