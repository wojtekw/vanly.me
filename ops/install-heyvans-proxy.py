#!/usr/bin/python3
"""Add Heyvans to the existing Vanly Nginx, hosts and certificate; preserve other sites."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import ssl
import subprocess
import tempfile


BASE = Path('/Library/Application Support/Vanly')
RENDERER = BASE / 'render-nginx-config.py'
RENEWAL = BASE / 'renew-nginx-tls.sh'
CONFIG = BASE / 'nginx-runtime/nginx.conf'
CERTIFICATE = BASE / 'tls/server.crt'
HOSTS = Path('/private/etc/hosts')
BACKUPS = BASE / 'heyvans-backups'
DOMAIN = 'heyvans.com.local'
PRIVATE_FILES = [BASE / 'tls/server.key', BASE / 'tls/ca/root.key', BASE / 'tls/ca/root.crt']
SNAPSHOT_PATHS = [RENDERER, RENEWAL, HOSTS, CERTIFICATE, CONFIG]


def replace_once(text, before, after):
    if after in text:
        return text
    if text.count(before) != 1:
        raise RuntimeError('Existing Nginx differs from the checked installation; no files changed.')
    return text.replace(before, after, 1)


def live_sans():
    # Read only the public leaf certificate through the existing trusted HTTPS listener.
    context = ssl.create_default_context(cafile=str(BASE / 'public/vanly-root.crt'))
    with socket.create_connection(('127.0.0.2', 443), timeout=5) as connection:
        with context.wrap_socket(connection, server_hostname='vanly.me.local') as secure:
            names = secure.getpeercert().get('subjectAltName', ())
    labels = {'DNS': 'DNS', 'IP Address': 'IP', 'URI': 'URI', 'email': 'email'}
    if not names or any(kind not in labels for kind, _ in names):
        raise RuntimeError('Cannot verify all existing certificate SANs; no files changed.')
    return [labels[kind] + ':' + name for kind, name in names]


def render_scope(renderer):
    scope = {'__file__': str(RENDERER), '__name__': 'heyvans_proxy_check'}
    exec(compile(renderer, str(RENDERER), 'exec'), scope)
    return scope


def prepare():
    original_renderer = RENDERER.read_text()
    renderer = replace_once(original_renderer,
        '        ("camperfolks.com.local", 3104, True, False),',
        '        ("camperfolks.com.local", 3104, True, False),\n'
        '        ("heyvans.com.local", 3106, True, False),')
    renderer = replace_once(renderer,
        '    if life:\n        lines.append(',
        '    if domain == "heyvans.com.local" and not tls:\n'
        '        target_port = "" if args.https_port == 443 else ":{}".format(args.https_port)\n'
        '        lines += ["        return 308 https://heyvans.com.local{}$request_uri;".format(target_port), "    }"]\n'
        '        return "\\n".join(lines)\n'
        '    if life:\n        lines.append(')

    renewal = RENEWAL.read_text()
    host_assignments = list(re.finditer(r"(?m)^vanly_hosts='([^'\n]+)'$", renewal))
    san_assignments = list(re.finditer(r'(?m)^subjectAltName=([^\n]+)$', renewal))
    if len(host_assignments) != 1 or len(san_assignments) != 1:
        raise RuntimeError('Cannot safely extend the existing certificate renewal script; no files changed.')
    certificate_names = live_sans()
    current_sans = [name.strip() for name in san_assignments[0][1].split(',')]
    if set(certificate_names) != set(current_sans):
        raise RuntimeError('Live certificate SANs differ from renewal configuration; no files changed.')
    current_hosts = host_assignments[0][1].split()
    if any('DNS:' + host not in current_sans for host in current_hosts):
        raise RuntimeError('Renewal host verification list differs from certificate SANs; no files changed.')
    if DOMAIN not in current_hosts:
        renewal = renewal.replace(host_assignments[0][0], "vanly_hosts='" + ' '.join([*current_hosts, DOMAIN]) + "'", 1)
    if 'DNS:' + DOMAIN not in current_sans:
        renewal = renewal.replace(san_assignments[0][0], 'subjectAltName=' + ','.join([*current_sans, 'DNS:' + DOMAIN]), 1)
    subprocess.run(['/bin/sh', '-n'], input=renewal.encode(), check=True)

    hosts = HOSTS.read_text()
    entries = [line.split('#', 1)[0].split() for line in hosts.splitlines()]
    addresses_for_domain = [entry[0] for entry in entries if DOMAIN in entry[1:]]
    if addresses_for_domain and addresses_for_domain != ['127.0.0.2']:
        raise RuntimeError('Heyvans already has another hosts address; no files changed.')
    if not addresses_for_domain:
        hosts += ('' if hosts.endswith('\n') else '\n') + '\n# Heyvans — shared Vanly API, separate frontend\n127.0.0.2 heyvans.com.local\n'

    config = CONFIG.read_text()
    listeners = re.findall(r'(?m)^\s*listen (\d+\.\d+\.\d+\.\d+):(\d+)', config)
    addresses = list(dict.fromkeys(address for address, port in listeners if port == '443'))
    if not addresses or set(listeners) != {(address, port) for address in addresses for port in ('80', '443')}:
        raise RuntimeError('Cannot preserve every existing HTTP/HTTPS listener; no files changed.')
    args = argparse.Namespace(addresses=addresses, http_port=80, https_port=443,
        public_dir=BASE / 'public', prefix=BASE / 'nginx-runtime', template_dir=None,
        tls_dir=BASE / 'tls', worker_user='_www')
    original_scope = render_scope(original_renderer)
    updated_scope = render_scope(renderer)
    original_config = original_scope['render'](args)
    if original_config != config:
        raise RuntimeError('Active Nginx configuration differs from its renderer; no files changed.')
    next_config = updated_scope['render'](args)
    if renderer != original_renderer:
        # Removing exactly the two new servers must recover the full original config.
        # This checks every existing server and the entire surrounding configuration.
        restored = next_config
        for tls in (False, True):
            block = updated_scope['site_server'](args, DOMAIN, 3106, tls, True, False)
            if restored.count('\n\n' + block) != 1:
                raise RuntimeError('New proxy server is ambiguous; no files changed.')
            restored = restored.replace('\n\n' + block, '', 1)
        if restored != original_config:
            raise RuntimeError('An unrelated Nginx setting would change; installation cancelled.')
    return {RENDERER: renderer.encode(), RENEWAL: renewal.encode(), HOSTS: hosts.encode()}, addresses


def atomic_write(path, data, mode):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def active_master():
    pid = int((BASE / 'nginx-runtime/nginx.pid').read_text().strip())
    command = subprocess.check_output(['/bin/ps', '-p', str(pid), '-o', 'command='], text=True)
    if 'nginx: master process ' + str(BASE / 'nginx') not in command:
        raise RuntimeError('The checked existing Vanly Nginx master is not running.')
    return pid


def require_admin():
    if os.geteuid() != 0:
        raise RuntimeError('Administrator authentication is required for hosts, Nginx and its TLS certificate.')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_nginx(path):
    subprocess.run([str(BASE / 'nginx'), '-t', '-p', str(BASE / 'nginx-runtime') + '/', '-c', str(path)], check=True)


def install(changes, addresses):
    require_admin()
    pid = active_master()
    private_hashes = {path: digest(path) for path in PRIVATE_FILES}
    snapshots = {path: (path.read_bytes(), path.stat().st_mode & 0o777) for path in SNAPSHOT_PATHS}
    if all(data == snapshots[path][0] for path, data in changes.items()):
        print('CURRENT: Heyvans hosts, route and certificate SAN are already installed.')
        return
    backup = BACKUPS / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    backup.mkdir(parents=True, mode=0o700)
    BACKUPS.chmod(0o700)
    for path, (data, _) in snapshots.items():
        # Only public certificate and configuration snapshots; no CA or private keys.
        atomic_write(backup / path.name, data, 0o600)
    next_config = BASE / 'nginx-runtime/heyvans.conf.next'
    try:
        for path, data in changes.items():
            atomic_write(path, data, snapshots[path][1])
        subprocess.run(['/bin/sh', str(RENEWAL), '--force'], check=True)
        if any(digest(path) != before for path, before in private_hashes.items()):
            raise RuntimeError('CA or existing server key changed unexpectedly.')
        subprocess.run(['/usr/bin/python3', str(RENDERER), '--addresses', *addresses,
                        '--prefix', str(BASE / 'nginx-runtime'), '--output', str(next_config)], check=True)
        check_nginx(next_config)
        os.replace(next_config, CONFIG)
        os.kill(pid, signal.SIGHUP)
        subprocess.run(['/usr/bin/dscacheutil', '-flushcache'], check=True)
        manifest = {path.name: {'mode': mode, 'installed_sha256': digest(path)}
                    for path, (_, mode) in snapshots.items()}
        atomic_write(backup / 'manifest.json', json.dumps(manifest, indent=2).encode(), 0o600)
        print('Installed: https://heyvans.com.local → 127.0.0.1:3106; /api/v1/ → existing 4100.')
        print('HTTP redirects to HTTPS. All existing routes/listeners, CA and key preserved. Backup: ' + str(backup))
        print('Rollback: sudo /usr/bin/python3 ' + str(Path(__file__).resolve()) + ' --rollback "' + str(backup) + '"')
    except BaseException:
        for path, (data, mode) in snapshots.items():
            atomic_write(path, data, mode)
        os.kill(pid, signal.SIGHUP)
        subprocess.run(['/usr/bin/dscacheutil', '-flushcache'], check=False)
        raise
    finally:
        next_config.unlink(missing_ok=True)


def rollback(backup):
    require_admin()
    backup = backup.resolve()
    if backup.parent != BACKUPS.resolve():
        raise RuntimeError('Rollback must use a Heyvans backup from ' + str(BACKUPS))
    manifest = json.loads((backup / 'manifest.json').read_text())
    if set(manifest) != {path.name for path in SNAPSHOT_PATHS}:
        raise RuntimeError('Backup manifest is incomplete; no files changed.')
    if any(digest(path) != manifest[path.name]['installed_sha256'] for path in SNAPSHOT_PATHS):
        raise RuntimeError('Configuration changed since installation; automatic rollback would overwrite later changes.')
    pid = active_master()
    current = {path: (path.read_bytes(), path.stat().st_mode & 0o777) for path in SNAPSHOT_PATHS}
    try:
        for path in SNAPSHOT_PATHS:
            atomic_write(path, (backup / path.name).read_bytes(), manifest[path.name]['mode'])
        check_nginx(CONFIG)
        os.kill(pid, signal.SIGHUP)
        subprocess.run(['/usr/bin/dscacheutil', '-flushcache'], check=True)
        print('Restored previous configuration and public certificate; CA and private keys preserved.')
    except BaseException:
        for path, (data, mode) in current.items():
            atomic_write(path, data, mode)
        os.kill(pid, signal.SIGHUP)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--check', action='store_true', help='Check the additive plan without changing files; also run nginx -t when invoked as administrator.')
    actions.add_argument('--install', action='store_true', help='Apply checked changes; requires administrator authentication.')
    actions.add_argument('--rollback', type=Path, help='Restore a checked Heyvans installation backup; requires administrator authentication.')
    args = parser.parse_args()
    try:
        if args.rollback:
            rollback(args.rollback)
        else:
            changes, addresses = prepare()
            if args.install:
                install(changes, addresses)
            else:
                if args.check and os.geteuid() == 0:
                    check_nginx(CONFIG)
                print('READY: exact Heyvans route, HTTP→HTTPS and one hosts record; every existing server is unchanged.')
                print('TLS adds only Heyvans SAN to the existing certificate; CA and private key remain in place.')
                print('Existing bind addresses: ' + ', '.join(addresses))
                print('Apply: sudo /usr/bin/python3 "' + str(Path(__file__).resolve()) + '" --install')
    except (OSError, RuntimeError, subprocess.CalledProcessError, ValueError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
