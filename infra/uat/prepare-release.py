"""Freeze the running local release, applying only the reviewed UAT URL changes."""
import hashlib
import json
import pathlib
import shutil
import subprocess

SOURCE = pathlib.Path(__file__).resolve().parents[2]
RUNTIME = pathlib.Path('/Users/wojtek/.local/share/vanly-portal')
TARGET = SOURCE / '.local/uat/release'
TARGET.mkdir(parents=True, exist_ok=True)
for name in ('apps', 'packages', 'scripts', 'db'):
    (TARGET / name).mkdir(exist_ok=True)
    subprocess.run(['rsync', '-a', '--delete', '--exclude=node_modules', '--exclude=.next',
                    '--exclude=dist', '--exclude=.local', '--exclude=.env*',
                    '--exclude=*.log', '--exclude=.DS_Store', '--exclude=*.tsbuildinfo',
                    str(RUNTIME / name) + '/', str(TARGET / name) + '/'], check=True)
for name in ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'):
    shutil.copy2(RUNTIME / name, TARGET / name)
overlays = ['apps/frontoffice/next.config.mjs', 'apps/frontoffice/lib/panel-origins.ts',
            'apps/frontoffice/components/VanlyApp.tsx', 'packages/ui/navigation.tsx',
            'scripts/worker/runtime.mjs', '.dockerignore']
for name in overlays:
    shutil.copy2(SOURCE / name, TARGET / name)
shutil.copytree(SOURCE / 'infra/uat', TARGET / 'infra/uat', dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('__pycache__'))
manifest = {}
for filename in sorted(TARGET.rglob('*')):
    if filename.is_symlink():
        target = filename.resolve(strict=True)
        if not target.is_relative_to(TARGET):
            raise ValueError('Release symlink may not leave the frozen source')
        manifest[filename.relative_to(TARGET).as_posix()] = 'symlink:' + str(filename.readlink())
        continue
    if filename.is_file():
        relative = filename.relative_to(TARGET).as_posix()
        if any(part.startswith('.env') or part == '.local' for part in filename.relative_to(TARGET).parts):
            raise ValueError('Release may not contain secrets')
        manifest[relative] = hashlib.sha256(filename.read_bytes()).hexdigest()
(SOURCE / '.local/uat/source-manifest.json').write_text(json.dumps(manifest, indent=2))
print(json.dumps({'files': len(manifest), 'source': str(RUNTIME), 'overlays': overlays,
                  'bytes': sum((TARGET / p).stat().st_size for p, h in manifest.items() if not h.startswith('symlink:'))}))
