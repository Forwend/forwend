#!/usr/bin/env python3
"""Test changed Go packages and every repository package that imports them."""
import json
from pathlib import Path
import subprocess
import sys


def affected(root, packages, paths):
    full = not paths or any(not p.startswith('apps/backend/internal/') or not p.endswith('.go') for p in paths
                           if not p.endswith('.md') and not p.startswith('docs/'))
    changed_dirs = {str((root / p).parent) for p in paths if p.endswith('.go')}
    selected = set(packages) if full else {name for name, p in packages.items() if p['Dir'] in changed_dirs}
    # Deleted or moved packages may no longer appear in go list.
    if changed_dirs - {p['Dir'] for p in packages.values()}:
        selected = set(packages)
    while True:
        callers = {name for name, p in packages.items()
                   if selected.intersection(p.get('Imports', []) + p.get('TestImports', []) + p.get('XTestImports', []))}
        if callers <= selected:
            break
        selected |= callers
    return sorted(selected)


def main():
    root = Path(__file__).resolve().parent.parent
    backend = root / 'apps/backend'
    paths = sys.argv[1:]
    listed = subprocess.run(['go', 'list', '-json', './...'], cwd=backend, capture_output=True, text=True, check=True)
    decoder = json.JSONDecoder()
    text = listed.stdout
    packages = {}
    while text.strip():
        item, end = decoder.raw_decode(text.lstrip())
        packages[item['ImportPath']] = item
        text = text.lstrip()[end:]
    args = affected(root, packages, paths)
    if not args:
        raise SystemExit('No backend packages selected; use the full backend check for non-Go changes.')
    print(f'Backend: {len(args)} of {len(packages)} packages, including dependent callers', flush=True)
    source = [str(root / p) for p in paths if p.endswith('.go') and (root / p).is_file()]
    if source:
        formatted = subprocess.run(['gofmt', '-l', *source], capture_output=True, text=True, check=True)
        if formatted.stdout:
            print(formatted.stdout)
            raise SystemExit(1)
    subprocess.run(['go', 'vet', '-tags', 'e2e,privylive,loadtest', *args], cwd=backend, check=True)
    return subprocess.run(['sh', 'scripts/with-env.sh', 'go', 'test', '-race', '-count=1', *args], cwd=backend).returncode


if __name__ == '__main__':
    raise SystemExit(main())
