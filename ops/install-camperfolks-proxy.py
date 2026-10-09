#!/usr/bin/python3
"""Add Camperfolks to the existing Vanly Nginx; never replace other proxy sites."""

import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile


BASE = Path('/Library/Application Support/Vanly')
RENDERER = BASE / 'render-nginx-config.py'
RENEWAL = BASE / 'renew-nginx-tls.sh'
CONFIG = BASE / 'nginx-runtime/nginx.conf'
CERTIFICATE = BASE / 'tls/server.crt'
HOSTS = Path('/private/etc/hosts')
DOMAIN = 'camperfolks.com.local'


def replace_once(text, before, after):
    if after in text:
        return text
    if text.count(before) != 1:
        raise RuntimeError('Existing Nginx differs from the verified installation; no files changed.')
    return text.replace(before, after, 1)


def prepare():
    renderer = RENDERER.read_text()
    renderer = replace_once(renderer,
        '        ("vanly.me.local", 3100, True, False),',
        '        ("vanly.me.local", 3100, True, False),\n        ("camperfolks.com.local", 3104, True, False),')
    renderer = replace_once(renderer,
        '    if life:\n        lines.append(',
        '    if domain == "camperfolks.com.local" and not tls:\n'
        '        target_port = "" if args.https_port == 443 else ":{}".format(args.https_port)\n'
        '        lines += ["        return 308 https://camperfolks.com.local{}$request_uri;".format(target_port), "    }"]\n'
        '        return "\\n".join(lines)\n'
        '    if life:\n        lines.append(')
    compile(renderer, str(RENDERER), 'exec')

    renewal = RENEWAL.read_text()
    renewal = replace_once(renewal,
        "vanly_hosts='vanly.local vanly.life.local vanly.me.local owner.vanly.me.local admin.vanly.me.local'",
        "vanly_hosts='vanly.local vanly.life.local vanly.me.local owner.vanly.me.local admin.vanly.me.local camperfolks.com.local'")
    renewal = replace_once(renewal,
        'subjectAltName=DNS:vanly.local,DNS:vanly.life.local,DNS:vanly.me.local,DNS:owner.vanly.me.local,DNS:admin.vanly.me.local',
        'subjectAltName=DNS:vanly.local,DNS:vanly.life.local,DNS:vanly.me.local,DNS:owner.vanly.me.local,DNS:admin.vanly.me.local,DNS:camperfolks.com.local')
    subprocess.run(['/bin/sh', '-n'], input=renewal.encode(), check=True)

    hosts = HOSTS.read_text()
    existing = [line.split('#', 1)[0].split() for line in hosts.splitlines()]
    records = [entry[0] for entry in existing if DOMAIN in entry[1:]]
    if records and records != ['127.0.0.2']:
        raise RuntimeError('Camperfolks already has another hosts address; no files changed.')
    if not records:
        hosts = hosts.rstrip() + '\n\n# Camperfolks — shared Vanly API, separate frontend\n127.0.0.2 camperfolks.com.local\n'

    # Check that every pre-existing rendered server is byte-for-byte unchanged.
    original_scope = {'__file__': str(RENDERER), '__name__': 'camperfolks_proxy_check'}
    updated_scope = original_scope.copy()
    exec(compile(RENDERER.read_text(), str(RENDERER), 'exec'), original_scope)
    exec(compile(renderer, str(RENDERER), 'exec'), updated_scope)
    addresses = list(dict.fromkeys(re.findall(r'listen (\d+\.\d+\.\d+\.\d+):443', CONFIG.read_text())))
    args = argparse.Namespace(addresses=addresses, http_port=80, https_port=443, public_dir=BASE / 'public')
    for domain, port, portal, life in (
        ('vanly.local', 3100, False, False), ('vanly.life.local', 8086, False, True),
        ('vanly.me.local', 3100, True, False), ('owner.vanly.me.local', 8182, True, False),
        ('admin.vanly.me.local', 8183, True, False),
    ):
        for tls in (False, True):
            old = original_scope['site_server'](args, domain, port, tls, portal, life)
            new = updated_scope['site_server'](args, domain, port, tls, portal, life)
            if old != new:
                raise RuntimeError('An unrelated proxy server would change; installation cancelled.')
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


def install(changes, addresses):
    if os.geteuid() != 0:
        raise RuntimeError('Administrator authentication is required for hosts, the existing Nginx and its TLS certificate.')
    # Resolve the exact active master before changing anything.
    pid = int((BASE / 'nginx-runtime/nginx.pid').read_text().strip())
    command = subprocess.check_output(['/bin/ps', '-p', str(pid), '-o', 'command='], text=True)
    if 'nginx: master process ' + str(BASE / 'nginx') not in command:
        raise RuntimeError('The verified existing Vanly Nginx master is not running.')
    snapshots = {path: (path.read_bytes(), path.stat().st_mode & 0o777) for path in [*changes, CERTIFICATE, CONFIG]}
    backup = BASE / 'camperfolks-backups' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup.mkdir(parents=True, mode=0o700)
    backup.parent.chmod(0o700)
    for path, (data, mode) in snapshots.items():
        # CA and private keys are deliberately never copied or replaced.
        atomic_write(backup / path.name, data, min(mode, 0o600))
    next_config = BASE / 'nginx-runtime/camperfolks.conf.next'
    try:
        for path, data in changes.items():
            atomic_write(path, data, snapshots[path][1])
        subprocess.run(['/bin/sh', str(RENEWAL), '--force'], check=True)
        subprocess.run(['/usr/bin/python3', str(RENDERER), '--addresses', *addresses,
                        '--prefix', str(BASE / 'nginx-runtime'), '--output', str(next_config)], check=True)
        subprocess.run([str(BASE / 'nginx'), '-t', '-p', str(BASE / 'nginx-runtime') + '/', '-c', str(next_config)], check=True)
        os.replace(next_config, CONFIG)
        os.kill(pid, signal.SIGHUP)
        subprocess.run(['/usr/bin/dscacheutil', '-flushcache'], check=True)
        print('Installed: https://camperfolks.com.local → 127.0.0.1:3104; /api/v1/ → existing 4100.')
        print('HTTP redirects to HTTPS. Existing hosts, routes and CA preserved. Backup: ' + str(backup))
    except BaseException:
        for path, (data, mode) in snapshots.items():
            atomic_write(path, data, mode)
        os.kill(pid, signal.SIGHUP)
        raise
    finally:
        next_config.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', action='store_true', help='Apply checked changes; requires administrator authentication.')
    args = parser.parse_args()
    try:
        changes, addresses = prepare()
        if args.install:
            install(changes, addresses)
        else:
            print('READY: exact Camperfolks route, HTTP→HTTPS and one hosts record; existing domains unchanged.')
            print('TLS adds only Camperfolks SAN to the existing certificate; CA and key remain in place.')
            print('Existing bind addresses: ' + ', '.join(addresses))
            print('Apply: sudo /usr/bin/python3 ' + str(Path(__file__).resolve()) + ' --install')
    except (OSError, RuntimeError, subprocess.CalledProcessError, ValueError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
