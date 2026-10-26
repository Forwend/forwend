"""Check selection and reusable local results; no task or delivery state."""
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time

# Git injects commit identity and index location into hooks; staged source is checked separately.
GIT_HOOK_METADATA = {
    'GIT_AUTHOR_DATE', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_NAME', 'GIT_COMMITTER_DATE',
    'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_EDITOR', 'GIT_EXEC_PATH',
    'GIT_INDEX_FILE', 'GIT_PREFIX',
}


def matches(path, patterns):
    return any(fnmatch.fnmatch(path, pattern) for pattern in patterns)


def select(config, paths, explicit=()):
    policy = config.get('verification')
    if policy is None:
        docs = bool(paths) and all(matches(p, ['*.md', 'docs/archive/*.json']) for p in paths)
        names = [c['id'] for c in config['checks'] if c.get('required') and (c.get('docs') or not docs)]
    else:
        names = list(policy['always'])
        for path in paths if paths is not None else ['<unknown>']:
            rule = next((r for r in policy['rules'] if matches(path, r['paths'])), None)
            names.extend(rule['checks'] if rule else policy['fallback'])
    wanted = set(names) | set(explicit)
    covered = {name for c in config['checks'] if c['id'] in wanted for name in c.get('covers', [])}
    wanted -= covered - set(explicit)
    # Registry order puts cheap checks first, regardless of the task's explicit checks.
    return [c['id'] for c in config['checks'] if c['id'] in wanted] + sorted(wanted - {c['id'] for c in config['checks']})


def execution_environment(root):
    env = {k: value for k, value in os.environ.items() if k not in GIT_HOOK_METADATA and k not in {'OLDPWD', '_', 'CODEX_TOOL_CALL_ID'}}
    env['PWD'] = str(root.resolve())
    # Git prepends its own executable directory when launching hooks.
    git_exec = os.environ.get('GIT_EXEC_PATH')
    if git_exec and env.get('PATH', '').startswith(git_exec + os.pathsep):
        env['PATH'] = env['PATH'][len(git_exec) + 1:]
    return env


def fingerprint(root, check, files, paths):
    patterns = check.get('inputs', ['*']) + [
        'scripts/harness.py', 'scripts/verification.py', 'docs/config.json',
        'package.json', '*/package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
        'turbo.json', '.nvmrc', 'tsconfig.base.json']
    inputs = {p: value for p, value in files.items() if matches(p, patterns)}
    # Include ignored environment files without storing their contents or individual hashes in the cache.
    for pattern in check.get('localInputs', []):
        for path in root.glob(pattern):
            if path.is_file():
                inputs[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    versions = []
    for command in check.get('versions', []):
        try:
            result = subprocess.run(command, cwd=root, capture_output=True, timeout=10)
        except (OSError, subprocess.TimeoutExpired):
            return None
        if result.returncode:
            return None
        versions.append(result.stdout.decode(errors='replace'))
    # A different environment, runner, toolchain or selected package list cannot reuse old results.
    payload = [check, inputs, paths if check.get('changedPaths') else None,
               execution_environment(root), sys.version, platform.platform(), versions]
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def run(root, checks, names, execute, files, paths=None, fresh=False, snapshot=None):
    cache_path = root / 'docs/runs/check-cache.json'
    try:
        cache = json.loads(cache_path.read_text())
    except (FileNotFoundError, ValueError):
        cache = {}
    results = []
    for name in names:
        check = checks[name]
        key = fingerprint(root, check, files, paths) if check.get('cache') else None
        saved = cache.get(name, {})
        if not fresh and key and saved.get('key') == key and time.time() - saved.get('at', 0) < 86400:
            print(f'  {name}: reused matching successful check', flush=True)
            results.append(dict(saved['result'], seconds=0.0, cached=True))
            continue
        print(f'  {name}: running', flush=True)
        command = dict(check)
        if check.get('changedPaths'):
            command['argv'] = check['argv'] + (paths or [])
        result = execute(command)
        if snapshot and key and fingerprint(root, check, snapshot(), paths) != key:
            result = dict(result, outcome='inputs-changed', exit=1)
        results.append(result)
        print(f'  {name}: {result["outcome"]} ({result["seconds"]}s)', flush=True)
        cache.pop(name, None)
        if key and result['outcome'] == 'passed':
            cache[name] = {'key': key, 'at': time.time(), 'result': result}
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode='w', dir=cache_path.parent, delete=False) as stream:
            json.dump(cache, stream)
            temporary = stream.name
        os.replace(temporary, cache_path)
        if result['outcome'] != 'passed':
            break
    return results
