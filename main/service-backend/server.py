"""The service backend: an http server answering the service apis.

    python3 server.py --config ../../example_doc/.doc-page/service-backend.yaml [--port 45190] [--host 127.0.0.1]

Design: doc_page_impl_service.md#backend

It runs on its own; the doc page reaches it through the vite plugin, which
forwards /__doc-service/* here unchanged. Every answer is
{ code, data?, message? }, code 0 for success; the http status follows the
code (statusByCode) for tools that read only the status.

The server sends no CORS headers on purpose: a page of any other origin
must not be able to call the services on localhost. The doc page calls
them on its own origin, through the plugin.
"""

import argparse
import json
import mimetypes
import os
import signal
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from service_define import ServiceCaller, ServiceError, openrpc_document_build  # noqa: E402
from service_runtime import ServiceRuntime  # noqa: E402

BODY_SIZE_MAX = 16 * 1024 * 1024

STATUS_BY_CODE = {0: 200, -1: 400, -2: 403, -3: 404, -4: 409, -6: 504, -7: 424}

CONTENT_TYPE_BY_EXT = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
}


def script_expose_get(script, label):
    """The exposure of a loaded script; ServiceError -1 when it failed to load."""
    if script.status != 'ready':
        raise ServiceError(-1, f'the service.py of {label} failed to load: {script.message}')
    return script.expose


def handler_class_build(runtime):

    class ServiceRequestHandler(BaseHTTPRequestHandler):
        server_version = 'DocServiceBackend/1'

        def log_message(self, format_text, *args):
            if runtime.kernel_log.is_verbose:
                sys.stderr.write(f'[service] {self.command} {self.path} {format_text % args}\n')

        # ---------- answers ----------

        def response_send(self, result):
            body = json.dumps(result, ensure_ascii=False).encode('utf-8')
            self.send_response(STATUS_BY_CODE.get(result.get('code'), 500))
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def file_send(self, root_dir, relative_path):
            root_abs = os.path.normpath(root_dir)
            file_path = os.path.normpath(os.path.join(root_abs, relative_path))
            if not file_path.startswith(root_abs + os.sep) or not os.path.isfile(file_path):
                self.response_send({'code': -3, 'message': f'{relative_path} is not found'})
                return
            ext = os.path.splitext(file_path)[1].lower()
            content_type = CONTENT_TYPE_BY_EXT.get(ext) or mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
            with open(file_path, 'rb') as file:
                body = file.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            # a rebuilt dashboard is picked up by the next page load
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(body)

        def icon_send(self, dir_path, expose, label):
            icon = (expose or {}).get('meta', {}).get('icon', '')
            if icon == '':
                raise ServiceError(-3, f'{label} has no icon')
            self.file_send(dir_path, icon)

        def page_caller_get(self, value_get):
            """The caller of an http request: always the page. a request cannot
            say it is a service; the dashboard it names is kept as a claim."""
            return ServiceCaller('page', dashboard_service_id=str(value_get('dashboardServiceId') or ''))

        def body_read(self):
            length = int(self.headers.get('Content-Length') or 0)
            if length > BODY_SIZE_MAX:
                raise ServiceError(-1, f'the body is larger than {BODY_SIZE_MAX} bytes')
            if length == 0:
                return {}
            try:
                body = json.loads(self.rfile.read(length).decode('utf-8'))
            except (ValueError, UnicodeDecodeError) as error:
                raise ServiceError(-1, f'the body is not json: {error}')
            if not isinstance(body, dict):
                raise ServiceError(-1, 'the body must be a json object')
            return body

        # ---------- routes ----------

        def do_GET(self):
            url = urlparse(self.path)
            query = {key: value_list[0] for key, value_list in parse_qs(url.query).items()}
            path = url.path
            try:
                if path == '/status':
                    self.response_send({'code': 0, 'data': runtime.status_get()})
                elif path == '/registry':
                    self.response_send({'code': 0, 'data': runtime.registry_get()})
                elif path == '/infra/list':
                    self.response_send({'code': 0, 'data': runtime.infra_list_get()})
                elif path == '/log/recent':
                    self.response_send({'code': 0, 'data': runtime.kernel_log.recent_get(int(query.get('limit', '200')))})
                elif path == '/template/list':
                    self.response_send({'code': 0, 'data': runtime.template_list_get()})
                elif path == '/template/get':
                    template = runtime.template_get(query.get('templateId', ''))
                    self.response_send({'code': 0, 'data': template.info_get()})
                elif path == '/template/openrpc':
                    template = runtime.template_get(query.get('templateId', ''))
                    expose = script_expose_get(template.script, f'the template {template.name}')
                    info_extra = {'x-templateId': template.template_id, 'x-templateName': template.name,
                                  'x-templateVersionId': template.template_config.get('versionId', '')}
                    self.response_send({'code': 0, 'data': openrpc_document_build(expose, info_extra)})
                elif path.startswith('/template/icon/'):
                    template = runtime.template_get(unquote(path[len('/template/icon/'):]))
                    self.icon_send(template.dir_path, template.script.expose, f'the template {template.name}')
                elif path == '/instance/list':
                    self.response_send({'code': 0, 'data': runtime.instance_list_get()})
                elif path == '/instance/get':
                    instance = runtime.instance_get(query.get('serviceId', ''))
                    self.response_send({'code': 0, 'data': instance.info_get()})
                elif path == '/instance/resolve':
                    target = {key: query[key] for key in ['serviceId', 'templateId', 'versionId', 'infra'] if key in query}
                    instance = runtime.target_resolve(target, self.page_caller_get(query.get))
                    self.response_send({'code': 0, 'data': instance.info_get()})
                elif path == '/instance/openrpc':
                    instance = runtime.instance_get(query.get('serviceId', ''))
                    expose = script_expose_get(instance.script, f'the instance {instance.service_id}')
                    template_record = instance.service_config.get('template') or {}
                    info_extra = {'x-serviceId': instance.service_id,
                                  'x-templateId': template_record.get('templateId', ''),
                                  'x-templateName': template_record.get('name', ''),
                                  'x-templateVersionId': template_record.get('versionId', '')}
                    self.response_send({'code': 0, 'data': openrpc_document_build(expose, info_extra)})
                elif path.startswith('/instance/icon/'):
                    instance = runtime.instance_get(unquote(path[len('/instance/icon/'):]))
                    self.icon_send(instance.dir_path, instance.script.expose, f'the instance {instance.service_id}')
                elif path.startswith('/instance/dashboard/'):
                    service_id, _, relative_path = path[len('/instance/dashboard/'):].partition('/')
                    instance = runtime.instance_get(unquote(service_id))
                    expose = script_expose_get(instance.script, f'the instance {instance.service_id}')
                    if expose['dashboardRemote'] is None:
                        raise ServiceError(-3, f'the instance {instance.service_id} has no dashboards')
                    remote_dir = os.path.join(instance.dir_path, expose['dashboardRemote']['dir'])
                    self.file_send(remote_dir, unquote(relative_path))
                elif path == '/job/get':
                    self.response_send({'code': 0, 'data': runtime.job_get(query.get('serviceId', ''), query.get('jobId', ''))})
                else:
                    self.response_send({'code': -3, 'message': f'GET {path} is not an endpoint'})
            except ServiceError as error:
                self.response_send({'code': error.code, 'message': error.message})
            except Exception as error:
                self.response_send({'code': -1, 'message': f'{type(error).__name__}: {error}'})

        def do_POST(self):
            path = urlparse(self.path).path
            try:
                body = self.body_read()
                if path == '/instance/create':
                    data = runtime.instance_create(body.get('templateId', ''), body.get('name', ''), body.get('description', ''),
                                                   body.get('config'), str(body.get('docPageAlias') or ''))
                    self.response_send({'code': 0, 'data': data})
                elif path == '/instance/dependency/set':
                    data = runtime.instance_dependency_set(body.get('serviceId', ''), body.get('dependencyList'),
                                                           body.get('isDependencyDynamicAllowed'))
                    self.response_send({'code': 0, 'data': data})
                elif path == '/instance/enable':
                    data = runtime.instance_enable_set(body.get('serviceId', ''), body.get('isEnabled', True) is not False)
                    self.response_send({'code': 0, 'data': data})
                elif path == '/instance/delete':
                    data = runtime.instance_delete(body.get('serviceId', ''))
                    self.response_send({'code': 0, 'data': data})
                elif path == '/infra/route':
                    data = runtime.infra_route_set(body.get('name', ''), str(body.get('serviceId') or ''))
                    self.response_send({'code': 0, 'data': data})
                elif path == '/registry/docpage/sync':
                    data = runtime.docpage_sync(body.get('docPageList') or [])
                    self.response_send({'code': 0, 'data': data})
                elif path == '/template/version/new':
                    data = runtime.template_version_new(body.get('templateId', ''), body.get('note', ''))
                    self.response_send({'code': 0, 'data': data})
                elif path == '/api/call':
                    # target, or serviceId alone: the short form of target { serviceId }
                    target = body.get('target') if body.get('target') is not None else {'serviceId': body.get('serviceId', '')}
                    self.response_send(runtime.api_call(target, body.get('api', ''), body.get('params'), self.page_caller_get(body.get)))
                else:
                    self.response_send({'code': -3, 'message': f'POST {path} is not an endpoint'})
            except ServiceError as error:
                self.response_send({'code': error.code, 'message': error.message})
            except Exception as error:
                self.response_send({'code': -1, 'message': f'{type(error).__name__}: {error}'})

    return ServiceRequestHandler


def main():
    parser = argparse.ArgumentParser(description='the service backend of the doc page')
    parser.add_argument('--config', required=True, help='the backend config file (service-backend.yaml)')
    parser.add_argument('--port', type=int, default=None, help='overrides port of the config file')
    parser.add_argument('--host', default=None, help='overrides host of the config file')
    args = parser.parse_args()

    runtime = ServiceRuntime(args.config)
    host = args.host or runtime.host
    port = args.port or runtime.port
    runtime.scan()
    runtime.reconcile_thread_start()

    server = ThreadingHTTPServer((host, port), handler_class_build(runtime))
    server.daemon_threads = True

    def shutdown(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    print(f'[service] {len(runtime.template_by_id)} templates, {len(runtime.instance_by_id)} instances; listening on http://{host}:{port}')
    try:
        server.serve_forever()
    finally:
        runtime.stop_all()
        server.server_close()
        print('[service] stopped')


if __name__ == '__main__':
    main()
