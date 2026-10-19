"""The service backend: an http server answering the service apis.

    python3 server.py --config ../../example_doc/service-backend.yaml [--port 45190] [--host 127.0.0.1]

Design: doc_page_impl_service_instance.md#backend

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

from service_define import ServiceError, openrpc_document_build  # noqa: E402
from service_runtime import ServiceRuntime  # noqa: E402

BODY_SIZE_MAX = 16 * 1024 * 1024

STATUS_BY_CODE = {0: 200, -1: 400, -3: 404, -4: 409, -6: 504}

CONTENT_TYPE_BY_EXT = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
}


def handler_class_build(runtime):

    class ServiceRequestHandler(BaseHTTPRequestHandler):
        server_version = 'DocServiceBackend/1'

        def log_message(self, format_text, *args):
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
                elif path == '/type/list':
                    self.response_send({'code': 0, 'data': runtime.type_list_get()})
                elif path == '/type/openrpc':
                    entry = runtime.type_get(query.get('typeId', ''))
                    if entry.status != 'ready':
                        raise ServiceError(-1, f'the service type {entry.type_id} failed to load: {entry.message}')
                    self.response_send({'code': 0, 'data': openrpc_document_build(entry.type_id, entry.expose)})
                elif path.startswith('/type/dashboard/'):
                    type_id, _, relative_path = path[len('/type/dashboard/'):].partition('/')
                    entry = runtime.type_get(unquote(type_id))
                    if entry.status != 'ready':
                        raise ServiceError(-1, f'the service type {entry.type_id} failed to load: {entry.message}')
                    remote_dir = os.path.join(entry.dir_path, entry.expose['dashboardRemote']['dir'])
                    self.file_send(remote_dir, unquote(relative_path))
                elif path.startswith('/type/icon/'):
                    entry = runtime.type_get(unquote(path[len('/type/icon/'):]))
                    icon = (entry.expose or {}).get('meta', {}).get('icon', '')
                    if icon == '':
                        raise ServiceError(-3, f'the service type {entry.type_id} has no icon')
                    self.file_send(entry.dir_path, icon)
                elif path == '/instance/list':
                    self.response_send({'code': 0, 'data': runtime.instance_list_get()})
                elif path == '/instance/get':
                    instance = runtime.instance_get(query.get('serviceId', ''))
                    self.response_send({'code': 0, 'data': instance.info_get()})
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
                    data = runtime.instance_create(body.get('typeId', ''), body.get('name', ''), body.get('description', ''), body.get('config'))
                    self.response_send({'code': 0, 'data': data})
                elif path == '/api/call':
                    self.response_send(runtime.api_call(body.get('serviceId', ''), body.get('api', ''), body.get('params')))
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

    server = ThreadingHTTPServer((host, port), handler_class_build(runtime))
    server.daemon_threads = True

    def shutdown(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    print(f'[service] {len(runtime.type_by_id)} types, {len(runtime.instance_by_id)} instances; listening on http://{host}:{port}')
    try:
        server.serve_forever()
    finally:
        runtime.stop_all()
        server.server_close()
        print('[service] stopped')


if __name__ == '__main__':
    main()
