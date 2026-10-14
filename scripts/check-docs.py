#!/usr/bin/env python3
"""Check navigation, canonical decision IDs, cited IDs and check names without enforcing prose or heading style."""
import json
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parent.parent
files = [root / 'AGENTS.md', root / 'PLAN.md', *root.glob('apps/*/AGENTS.md'),
         *root.glob('packages/*/AGENTS.md'), *root.glob('docs/**/*.md')]
errors = []
ids = {}
project = (root / 'docs/PROJECT.md').read_text().splitlines()
defined = {m[1] for line in project if (m := re.match(r'\| ([RDQA]-\d+) \|', line))}
checks = {check['id'] for check in json.loads((root / 'docs/config.json').read_text())['checks']}
CITED = re.compile(r'\b[RDQA]-\d+\b')
for path in files:
    if 'runs' in path.parts:
        continue
    for number, line in enumerate(path.read_text().splitlines(), 1):
        for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', line):
            target = target.split('#')[0]
            if target and '://' not in target and not target.startswith('mailto:') and not (path.parent / target).exists():
                errors.append(f'{path.relative_to(root)}:{number}: missing {target}')
        match = re.match(r'\| (D-\d+) \|', line)
        if match:
            ident = match[1]
            if ident in ids:
                errors.append(f'{path.relative_to(root)}:{number}: duplicate {ident} (already in {ids[ident]})')
            if path != root / 'docs/PROJECT.md':
                errors.append(f'{path.relative_to(root)}:{number}: decisions belong in docs/PROJECT.md')
            ids[ident] = str(path.relative_to(root))
        for ident in CITED.findall(line):
            if ident not in defined:
                errors.append(f'{path.relative_to(root)}:{number}: {ident} is not defined in docs/PROJECT.md')
for task in json.loads((root / 'docs/tasks.json').read_text())['tasks']:
    for ident in task.get('refs') or []:
        if CITED.fullmatch(ident) and ident not in defined:
            errors.append(f'docs/tasks.json: {task["id"]} refs {ident}, which docs/PROJECT.md does not define')
for number, line in enumerate(project, 1):
    if re.match(r'\| R-\d+ \|', line):
        named = re.sub(r'\([^)]*\)', '', line.split(' | ')[3]).split('manual')[0]  # notes in (), free text after manual
        for name in named.split(','):
            if name.strip() and name.strip() not in checks:
                errors.append(f'docs/PROJECT.md:{number}: check {name.strip()!r} is not in docs/config.json')
for error in errors:
    print(error)
print(f'docs-check: {len(errors)} errors')
sys.exit(bool(errors))
