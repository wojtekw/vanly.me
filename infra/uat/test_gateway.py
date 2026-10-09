"""Exercise the actual Nginx gateway on private loopback ports with stub apps."""
import base64
import http.server
import pathlib
import platform
import shutil
import ssl
import subprocess
import tempfile
import threading
import unittest
import urllib.request
import urllib.error

ROOT = pathlib.Path(__file__).resolve().parent

class Backend(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write((self.path + '|auth=' + self.headers.get('Authorization', '')
                         + '|protocol=' + self.headers.get('X-Vanly-Protocol', '')).encode())
    def log_message(self, *args):
        pass

class GatewayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.dir = pathlib.Path(cls.temp.name)
        cls.backend = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Backend)
        threading.Thread(target=cls.backend.serve_forever, daemon=True).start()
        # Test-only credentials: the deployment password is never included in tests.
        cls.password = 'gateway-test-password'
        # Exercise Linux bcrypt; macOS crypt needs APR1 for the same HTTP checks.
        hash_args = '-nBi' if platform.system() == 'Linux' else '-ni'
        hashed = subprocess.run(['htpasswd', hash_args, 'test'], input=cls.password + '\n',
                                text=True, capture_output=True, check=True).stdout
        (cls.dir / 'htpasswd').write_text(hashed)
        # The Linux test master forks an unprivileged worker; only a disposable
        # test hash is stored here. Deployment uses a private group-readable file.
        cls.dir.chmod(0o755)
        (cls.dir / 'htpasswd').chmod(0o644)
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
                        '-keyout', str(cls.dir / 'key'), '-out', str(cls.dir / 'cert')],
                       capture_output=True, check=True)
        config = (ROOT / 'nginx.conf.template').read_text()
        config = config.replace('user www-data;\n', '')
        mime = pathlib.Path('/etc/nginx/mime.types' if platform.system() == 'Linux'
                            else '/opt/homebrew/etc/nginx/mime.types')
        config = config.replace('/etc/nginx/mime.types', str(mime))
        config = config.replace('/run/nginx.pid', str(cls.dir / 'nginx.pid'))
        config = config.replace('/var/log/nginx/', str(cls.dir) + '/')
        config = config.replace('listen 80 default_server', 'listen 127.0.0.1:18480 default_server')
        config = config.replace('listen 443 ssl default_server', 'listen 127.0.0.1:18443 ssl default_server')
        for port in (3100, 8182, 8183, 4100):
            config = config.replace('127.0.0.1:' + str(port), '127.0.0.1:' + str(cls.backend.server_port))
        for key, value in {'__ORIGIN_SECRET__': 'test-origin-secret', '__TLS_CERT__': str(cls.dir / 'cert'),
                           '__TLS_KEY__': str(cls.dir / 'key'), '__HTPASSWD__': str(cls.dir / 'htpasswd')}.items():
            config = config.replace(key, value)
        (cls.dir / 'nginx.conf').write_text(config)
        cls.nginx = shutil.which('nginx')
        subprocess.run([cls.nginx, '-p', str(cls.dir) + '/', '-c', str(cls.dir / 'nginx.conf'), '-t'],
                       capture_output=True, check=True)
        subprocess.run([cls.nginx, '-p', str(cls.dir) + '/', '-c', str(cls.dir / 'nginx.conf')],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        cls.context = ssl.create_default_context(cafile=str(cls.dir / 'cert'))

    @classmethod
    def tearDownClass(cls):
        subprocess.run([cls.nginx, '-p', str(cls.dir) + '/', '-c', str(cls.dir / 'nginx.conf'), '-s', 'quit'],
                       capture_output=True, check=True)
        cls.backend.shutdown()
        cls.backend.server_close()
        cls.temp.cleanup()

    def request(self, host, path='/', authenticated=False, origin=True, password=None):
        headers = {'Host': 'origin.uat.vanly.me', 'X-Vanly-Viewer-Host': host,
                   'X-Vanly-Protocol': 'http'}
        if origin:
            headers['X-Vanly-Origin'] = 'test-origin-secret'
        if authenticated:
            headers['Authorization'] = 'Basic ' + base64.b64encode(
                ('test:' + (password or self.password)).encode()).decode()
        req = urllib.request.Request('https://127.0.0.1:18443' + path, headers=headers)
        try:
            return urllib.request.urlopen(req, context=self.context, timeout=3)
        except urllib.error.HTTPError as e:
            return e

    def test_all_apps_api_assets_and_documents_require_auth(self):
        for host in ('uat.vanly.me', 'owner.uat.vanly.me', 'admin.uat.vanly.me'):
            for path in ('/', '/api/v1/auth/me', '/api/v1/documents/example', '/assets/logo-dark.png', '/robots.txt'):
                with self.subTest(host=host, path=path), self.request(host, path) as response:
                    self.assertEqual(response.status, 401)
                    self.assertEqual(response.headers['WWW-Authenticate'], 'Basic realm="VANLY UAT"')
                    self.assertIn('no-store', response.headers['Cache-Control'])

    def test_authenticated_request_strips_gateway_secret(self):
        for host in ('uat.vanly.me', 'owner.uat.vanly.me', 'admin.uat.vanly.me'):
            with self.request(host, '/api/v1/auth/me', authenticated=True) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), b'/api/v1/auth/me|auth=|protocol=https')
                self.assertIn('noindex', response.headers['X-Robots-Tag'])

    def test_direct_origin_and_unknown_host_are_blocked(self):
        with self.request('uat.vanly.me', authenticated=True, origin=False) as response:
            self.assertEqual(response.status, 403)
        with self.request('unknown.example', authenticated=True) as response:
            self.assertEqual(response.status, 403)

    def test_incorrect_password_never_reaches_app(self):
        with self.request('uat.vanly.me', authenticated=True, password='incorrect') as response:
            self.assertEqual(response.status, 401)

if __name__ == '__main__':
    unittest.main()
