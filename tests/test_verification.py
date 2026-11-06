"""Verification selection, input reuse and provider isolation regressions."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import verification as v

spec = importlib.util.spec_from_file_location('backend_checks', ROOT / 'scripts/check-backend.py')
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / 'docs/config.json').read_text())

    def test_docs_and_ui_copy_do_not_select_backend_or_browser_suites(self):
        self.assertEqual(v.select(self.config, ['docs/README.md']), ['docs-check'])
        names = v.select(self.config, ['apps/web/src/features/profiles/constants/profiles-copy.ts'])
        self.assertEqual(set(names), {'docs-check', 'lint', 'typecheck', 'web-unit'})

    def test_unknown_paths_fall_back_and_explicit_checks_are_preserved(self):
        for paths in (None, ['new-runtime/file.xyz'], ['pnpm-lock.yaml']):
            self.assertEqual(set(v.select(self.config, paths)), set(self.config['verification']['fallback']))
        self.assertIn('live-e2e', v.select(self.config, ['README.md'], ['live-e2e']))

    def test_migrations_and_money_keep_integration_coverage(self):
        for path in ['database/migrations/new.sql', 'ledger/ledger.go', 'settlement/gas.go', 'auth/auth.go',
                     'balance/balance.go', 'chain/chain.go', 'privy/privy.go', 'worker/worker.go']:
            names = v.select(self.config, ['apps/backend/internal/' + path])
            self.assertIn('backend-affected', names)
            self.assertIn('backend-e2e', names)
            self.assertNotIn('e2e', names)

    def test_browser_runner_changes_invalidate_and_select_harness(self):
        harness = next(c for c in self.config['checks'] if c['id'] == 'harness')
        for path in ['apps/web/scripts/e2e.mjs', 'apps/web/playwright.privy.config.ts']:
            self.assertIn('harness', v.select(self.config, [path]))
            self.assertTrue(v.matches(path, harness['inputs']))
        self.assertIn('unit', v.select(self.config, ['scripts/new-production-tool.py']))

    def test_shared_ui_checks_consumers_and_renames_include_old_path(self):
        names = v.select(self.config, ['packages/ui-web/src/button.tsx'])
        self.assertTrue({'ui-unit', 'web-unit', 'web-e2e'} <= set(names))
        names = v.select(self.config, ['apps/backend/internal/ledger/ledger.go', 'notes.md'])
        self.assertIn('backend-e2e', names)

    def test_go_selection_includes_transitive_and_test_only_callers(self):
        root = Path('/repo')
        packages = {
            'a': {'Dir': '/repo/apps/backend/internal/a'},
            'b': {'Dir': '/repo/apps/backend/internal/b', 'Imports': ['a']},
            'c': {'Dir': '/repo/apps/backend/internal/c', 'XTestImports': ['b']},
            'd': {'Dir': '/repo/apps/backend/internal/d'},
        }
        self.assertEqual(backend.affected(root, packages, ['apps/backend/internal/a/a.go']), ['a', 'b', 'c'])
        for path in ['apps/backend/go.mod', 'apps/backend/internal/database/migrations/new.sql',
                     'apps/backend/internal/deleted/old.go']:
            self.assertEqual(backend.affected(root, packages, [path]), sorted(packages))


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='forwend-check-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.check = {'id': 'unit', 'argv': ['test'], 'cache': True, 'inputs': ['src/*']}
        self.files = {'src/value.go': 'one', 'README.md': 'docs'}
        self.calls = 0
        self.outcome = 'passed'

    def execute(self, check):
        self.calls += 1
        return {'id': check['id'], 'outcome': self.outcome, 'exit': 0 if self.outcome == 'passed' else 1,
                'seconds': 1, 'log': ''}

    def run_checks(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            return v.run(self.root, {'unit': self.check}, ['unit'], self.execute, self.files, **kwargs)

    def test_only_matching_success_is_reused(self):
        self.run_checks()
        self.assertTrue(self.run_checks()[0]['cached'])
        self.files['README.md'] = 'new docs'
        self.run_checks()
        self.assertEqual(self.calls, 1)
        self.files['src/new.go'] = 'new file'
        self.run_checks()
        del self.files['src/value.go']
        self.run_checks()
        self.assertEqual(self.calls, 3)

    def test_command_environment_and_ignored_env_changes_invalidate(self):
        self.check['localInputs'] = ['.env']
        self.run_checks()
        self.check['argv'] = ['other-test']
        self.run_checks()
        with patch.dict(os.environ, {'FORWEND_VERIFICATION_TEST': 'changed'}):
            self.run_checks()
        (self.root / '.env').write_text('SECRET=never-print-this')
        self.run_checks()
        self.assertEqual(self.calls, 4)
        self.assertNotIn('never-print-this', (self.root / 'docs/runs/check-cache.json').read_text())

    def test_tool_call_metadata_does_not_invalidate_execution_inputs(self):
        with patch.dict(os.environ, {'CODEX_TOOL_CALL_ID': 'first', '_': 'previous-command'}):
            self.run_checks()
        with patch.dict(os.environ, {'CODEX_TOOL_CALL_ID': 'second', '_': 'another-command'}):
            self.assertTrue(self.run_checks()[0]['cached'])
        self.assertEqual(self.calls, 1)

    def test_real_git_hook_reuses_verified_inputs(self):
        import shlex
        import shutil
        for name in subprocess.check_output(['git', 'rev-parse', '--local-env-vars'], text=True).splitlines():
            self.enterContext(patch.dict(os.environ))
            os.environ.pop(name, None)
        subprocess.run(['git', 'init', '-q'], cwd=self.root, check=True)
        scripts = self.root / 'scripts'
        scripts.mkdir()
        shutil.copyfile(ROOT / 'scripts/verification.py', scripts / 'verification.py')
        probe = self.root / 'probe.py'
        probe.write_text("""import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / 'scripts'))
import verification
root = Path(__file__).parent
check = {'id':'unit', 'argv':['probe'], 'cache':True}
def execute(check):
    path = root / 'executions'
    path.write_text(path.read_text() + 'run\\n' if path.exists() else 'run\\n')
    return {'id':'unit','outcome':'passed','exit':0,'seconds':0,'log':''}
verification.run(root, {'unit':check}, ['unit'], execute, {'source':'same'})
""")
        (self.root / '.gitignore').write_text('docs/runs/\nexecutions\n__pycache__/\n')
        subprocess.run([sys.executable, str(probe)], cwd=self.root, check=True, capture_output=True)
        hook = self.root / '.git/hooks/pre-commit'
        hook.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) + ' ' + shlex.quote(str(probe)) + '\n')
        hook.chmod(0o755)
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(['git', 'config', 'user.name', 'Test'], cwd=self.root, check=True)
        subprocess.run(['git', 'config', 'user.email', 'test@example.com'], cwd=self.root, check=True)
        subprocess.run(['git', 'commit', '-qm', 'check'], cwd=self.root, check=True, capture_output=True)
        self.assertEqual((self.root / 'executions').read_text().splitlines(), ['run'])

    def test_fresh_failure_and_expiry_never_reuse_success(self):
        self.run_checks()
        self.outcome = 'failed'
        self.run_checks(fresh=True)
        self.run_checks()
        self.assertEqual(self.calls, 3)
        self.outcome = 'passed'
        self.run_checks()
        with patch.object(v.time, 'time', return_value=v.time.time() + 86401):
            self.run_checks()
        self.assertEqual(self.calls, 5)

    def test_change_during_execution_is_not_cached(self):
        result = self.run_checks(snapshot=lambda: {'src/value.go': 'changed'})
        self.assertEqual(result[0]['outcome'], 'inputs-changed')
        self.run_checks()
        self.assertEqual(self.calls, 2)

    def test_changed_package_selection_and_toolchain_invalidate(self):
        self.check['changedPaths'] = True
        self.run_checks(paths=['src/a.go'])
        self.run_checks(paths=['src/b.go'])
        self.assertEqual(self.calls, 2)
        self.check['versions'] = [['tool', '--version']]
        with patch.object(v.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'v1')):
            self.run_checks()
            self.run_checks()
        with patch.object(v.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'v2')):
            self.run_checks()
        self.assertEqual(self.calls, 4)


class BrowserCommandTests(unittest.TestCase):
    def test_credentials_do_not_implicitly_run_live_tests(self):
        with tempfile.TemporaryDirectory(prefix='forwend-browser-test-') as directory:
            root = Path(directory)
            binary = root / 'pnpm'
            binary.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\n')
            binary.chmod(0o755)
            (root / '.env').write_text('PRIVY_TEST_EMAIL=test@example.com\nPRIVY_TEST_OTP=123456\n')
            log = root / 'commands'
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'], COMMAND_LOG=str(log))
            script = ROOT / 'apps/web/scripts/e2e.mjs'
            subprocess.run(['node', str(script)], cwd=root, env=env, check=True)
            self.assertEqual(log.read_text().splitlines(), ['exec playwright test'])
            subprocess.run(['node', str(script), '--live', 'team.spec.ts'], cwd=root, env=env, check=True)
            self.assertEqual(log.read_text().splitlines()[-1],
                             'exec playwright test -c playwright.privy.config.ts team.spec.ts')

    def test_live_config_refuses_existing_servers(self):
        text = (ROOT / 'apps/web/playwright.privy.config.ts').read_text()
        self.assertNotIn('reuseExistingServer: true', text)
        self.assertEqual(text.count('reuseExistingServer: false'), 3)  # fake Resend, api, web
