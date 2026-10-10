"""Harness regression tests use disposable roots and stub remote calls."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('harness', Path(__file__).resolve().parents[1] / 'scripts/harness.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'docs').mkdir()
        self.task = {'id': 'F001', 'state': 'active', 'behavior': 'value is one',
                     'acceptance': ['value is one'], 'verification': ['unit'],
                     'keep': [], 'dependsOn': [], 'refs': [], 'review': False}
        self.config = {'schemaVersion': 2, 'delivery': {'mode': 'local'}, 'checks': [
            {'id': 'unit', 'argv': [sys.executable, '-c', 'assert 1 == 1']}]}
        self.save()

    def save(self):
        h.write_json(self.root / h.TASKS, {'schemaVersion': 2, 'nextId': 2, 'tasks': [self.task]})
        h.write_json(self.root / h.CONFIG, self.config)

    def run_cli(self, *args):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return h.main(['--root', str(self.root), *args])

    def verify(self):
        # Namespace permits testing the old runner before the new proof flag exists.
        from argparse import Namespace
        with contextlib.redirect_stdout(io.StringIO()):
            return h.cmd_verify(self.root, Namespace(id='F001', proof=['1=unit: value assertion']))

    def test_success_has_fresh_evidence(self):
        self.assertEqual(self.verify(), 0)
        state = h.State(self.root)
        self.assertEqual(state.task('F001')['state'], 'verified')
        self.assertIsNone(h.stale_reason(state, state.task('F001')))

    def test_mutation_during_checks_cannot_verify(self):
        (self.root / 'value.py').write_text('value = 1\n')
        self.config['checks'][0]['argv'] = [sys.executable, '-c',
            "from value import value; assert value == 1; from pathlib import Path; Path('value.py').write_text('value = 2\\n')"]
        self.save()
        self.assertEqual(self.verify(), 1)
        self.assertEqual(h.State(self.root).task('F001')['state'], 'active')

    def test_constraints_invalidate_evidence(self):
        self.verify()
        original = h.State(self.root).data
        for key, value in [('keep', ['protected/*']), ('dependsOn', ['F002']),
                           ('review', True), ('refs', ['R-2'])]:
            with self.subTest(key=key):
                data = copy.deepcopy(original)
                data['tasks'][0][key] = value
                h.write_json(self.root / h.TASKS, data)
                state = h.State(self.root)
                self.assertIsNotNone(h.stale_reason(state, state.task('F001')))

    def test_source_and_config_changes_invalidate_evidence(self):
        self.verify()
        (self.root / 'new.py').write_text('changed = True\n')
        state = h.State(self.root)
        self.assertIsNotNone(h.stale_reason(state, state.task('F001')))
        self.assertEqual(self.run_cli('validate'), 1)

    def test_unknown_proof_is_rejected(self):
        self.verify()
        task = h.State(self.root).task('F001')
        with self.assertRaises(h.Refused):
            h.parse_proof(['1=nonexistent_test'], task)
        self.assertEqual(h.parse_proof(['1=unit: value assertion'], task)['1'], 'unit: value assertion')

    def test_failed_and_missing_commands_never_verify(self):
        for argv, outcome in [([sys.executable, '-c', 'raise SystemExit(7)'], 'failed'),
                              (['/does/not/exist'], 'missing-command')]:
            with self.subTest(outcome=outcome):
                self.config['checks'][0]['argv'] = argv
                self.save()
                self.assertEqual(self.verify(), 1)
                self.assertEqual(h.State(self.root).task('F001')['evidence']['checks'][0]['outcome'], outcome)

    def test_timeout(self):
        self.config['checks'][0].update(argv=[sys.executable, '-c', 'import time; time.sleep(10)'], timeoutSeconds=.05)
        self.save()
        self.assertEqual(self.verify(), 1)
        self.assertEqual(h.State(self.root).task('F001')['evidence']['checks'][0]['outcome'], 'timeout')

    def test_missing_package_script_fails_before_pnpm(self):
        (self.root / 'package.json').write_text(json.dumps({'scripts': {}}))
        check = {'id': 'gate', 'argv': ['pnpm', 'e2e'], 'package': '.', 'script': 'e2e'}
        with patch.object(h.subprocess, 'Popen') as spawn:
            result = h.run_check(self.root, check, self.root / 'check.log')
        self.assertEqual(result['outcome'], 'missing-command')
        spawn.assert_not_called()

    def test_no_ci_is_not_success(self):
        (self.root / '.github/workflows').mkdir(parents=True)
        (self.root / '.github/workflows/ci.yml').write_text('on: pull_request\n')
        response = subprocess.CompletedProcess([], 0, '[]', '')
        with patch.object(h, 'gh', return_value=response):
            outcome, _ = h.wait_for_checks(self.root, 1, {'wait': 0, 'register': 0, 'poll': 0})
        self.assertNotEqual(outcome, 'pass')

    def test_explicit_local_policy_allows_absent_remote_checks(self):
        response = subprocess.CompletedProcess([], 0, '[]', '')
        with patch.object(h, 'gh', return_value=response):
            outcome, checks = h.wait_for_checks(self.root, 1,
                {'wait': 0, 'register': 0, 'poll': 0, 'requireRemoteChecks': False})
        self.assertEqual(outcome, 'not-required')
        self.assertEqual(checks, [])

    def test_local_policy_does_not_ignore_reported_checks_or_errors(self):
        settings = {'wait': 0, 'register': 0, 'poll': 0, 'requireRemoteChecks': False}
        for bucket, expected in [('fail', 'fail'), ('cancel', 'fail'), ('skipping', 'fail'),
                                 ('pending', 'pending'), ('pass', 'pass')]:
            with self.subTest(bucket=bucket):
                response = subprocess.CompletedProcess([], 0,
                    json.dumps([{'name': 'checks', 'bucket': bucket}]), '')
                with patch.object(h, 'gh', return_value=response):
                    outcome, _ = h.wait_for_checks(self.root, 1, settings)
                self.assertEqual(outcome, expected)
        with patch.object(h, 'gh', return_value=subprocess.CompletedProcess([], 1, '', 'not logged in')):
            outcome, _ = h.wait_for_checks(self.root, 1, settings)
        self.assertEqual(outcome, 'error')

    def test_remote_check_policy_is_explicit_and_boolean(self):
        self.assertTrue(h.delivery(h.State(self.root))['requireRemoteChecks'])
        self.config['delivery']['requireRemoteChecks'] = False
        self.save()
        self.assertFalse(h.delivery(h.State(self.root))['requireRemoteChecks'])
        self.config['delivery']['requireRemoteChecks'] = 'false'
        self.save()
        with self.assertRaises(h.Refused):
            h.delivery(h.State(self.root))

    def test_local_policy_still_requires_successful_local_verification(self):
        self.config['delivery']['requireRemoteChecks'] = False
        self.config['checks'][0]['argv'] = [sys.executable, '-c', 'raise SystemExit(7)']
        self.save()
        self.assertEqual(self.verify(), 1)
        with patch.object(h, 'deliver') as deliver:
            self.assertEqual(self.run_cli('done', 'F001'), 1)
        deliver.assert_not_called()

    def test_pending_delivery_rechecks_constraints(self):
        self.verify()
        state = h.State(self.root)
        task = state.task('F001')
        task.update(state='passing', delivery={'mode': 'pr', 'branch': 'fix/test', 'base': 'main'})
        task['keep'] = ['protected/*']
        state.save()
        self.config['delivery']['mode'] = 'pr'
        h.write_json(self.root / h.CONFIG, self.config)
        with patch.object(h, 'git', return_value=''), patch.object(h, 'unmerged', return_value=True), \
                patch.object(h, 'deliver') as deliver:
            self.assertEqual(self.run_cli('done', 'F001'), 1)
            deliver.assert_not_called()

    def test_skipped_ci_is_not_success(self):
        response = subprocess.CompletedProcess([], 0, '[{"name":"checks","bucket":"skipping"}]', '')
        with patch.object(h, 'gh', return_value=response):
            outcome, _ = h.wait_for_checks(self.root, 1, {'wait': 0, 'register': 0, 'poll': 0})
        self.assertEqual(outcome, 'fail')

    def test_missing_origin_does_not_allow_local_done(self):
        self.config['delivery']['mode'] = 'pr'
        self.save()
        self.assertEqual(h.delivery(h.State(self.root))['mode'], 'pr')

    def test_normal_cli_output_is_not_debug_code(self):
        with patch.object(h, 'added_lines', return_value=[('scripts/check.mjs', 1, 'console.log("check passed")')]):
            self.assertEqual(h.debug_leftovers(self.root), [])
        with patch.object(h, 'added_lines', return_value=[('apps/web/src/a.ts', 1, 'console.log(value)')]):
            self.assertEqual(len(h.debug_leftovers(self.root)), 1)

    def test_legacy_completed_task_keeps_its_definition(self):
        self.task['state'] = 'passing'
        self.task['evidence'] = {'version': 2, 'taskHash': h.digest({k: self.task.get(k) for k in ('behavior', 'acceptance', 'verification')})}
        self.save()
        state = h.State(self.root)
        self.assertIsNone(h.stale_reason(state, state.task('F001')))

    def test_malformed_schema_and_duplicate_checks(self):
        self.config['schemaVersion'] = 99
        self.save()
        self.assertEqual(self.run_cli('validate'), 2)
        self.config['schemaVersion'] = 2
        self.config['checks'].append(self.config['checks'][0])
        self.save()
        self.assertEqual(self.run_cli('validate'), 2)
        self.assertEqual(self.run_cli('check', '--ci'), 2)


if __name__ == '__main__':
    unittest.main()
