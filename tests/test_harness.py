"""Harness regression tests use disposable roots and stub remote calls."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('harness', Path(__file__).resolve().parents[1] / 'scripts/harness.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ))
        # Commit hooks export repository paths that would override the disposable roots.
        for name in subprocess.check_output(['git', 'rev-parse', '--local-env-vars'], text=True).splitlines():
            os.environ.pop(name, None)
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

    def test_running_verify_has_a_wait_next_step(self):
        self.task['evidence'] = {'status': 'running', 'pid': 123}
        self.save()
        state = h.State(self.root)
        with patch.object(h, 'pid_alive', return_value=True):
            self.assertEqual(h.next_step(state, []), 'wait for `verify F001` to finish, then `status`')
        with patch.object(h, 'pid_alive', return_value=False):
            self.assertEqual(h.next_step(state, []), '`verify F001` again; the last run was interrupted')

    def test_status_does_not_repeat_task_details_or_old_handoff(self):
        self.task['notes'] = ['old task handoff']
        self.save()
        state = h.State(self.root)
        state.data['lastWrapup'] = {'at': '2020-01-01', 'clean': True, 'note': 'start obsolete F099'}
        state.save()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(h.main(['--root', str(self.root), 'status']), 0)
        text = output.getvalue()
        self.assertIn('active: F001', text)
        self.assertIn('last: no verify yet', text)
        self.assertIn('next:', text)
        for omitted in ('obsolete F099', 'old task handoff', 'accept 1:', 'check unit:'):
            self.assertNotIn(omitted, text)

    def test_show_keeps_constraints_and_bounds_recent_notes(self):
        self.task.update(refs=['R-25'], keep=['protected/*'],
                         notes=['old note', *[f'recent note {i} ' + 'x' * 1000 for i in range(3)]])
        self.save()
        self.verify()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(h.main(['--root', str(self.root), 'show', 'F001']), 0)
        text = output.getvalue()
        self.assertIn('accept 1: value is one', text)
        self.assertIn('check unit:', text)
        self.assertIn('must not change: protected/*', text)
        self.assertIn('refs: R-25', text)
        self.assertNotIn('old note', text)
        notes = [line for line in text.splitlines() if line.startswith('note: ')]
        self.assertEqual(len(notes), 3)
        self.assertTrue(all(len(line) <= 246 for line in notes))
        self.assertNotIn('exit 0', text)
        self.assertIn('show F001 --history', text)

    def test_show_history_preserves_complete_notes_and_check_results(self):
        notes = ['old note', *[f'long note {i} ' + 'x' * 1000 for i in range(3)]]
        self.task['notes'] = notes
        self.save()
        self.verify()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(h.main(['--root', str(self.root), 'show', 'F001', '--history']), 0)
        text = output.getvalue()
        for note in notes:
            self.assertIn('note: ' + note, text)
        self.assertIn('unit: passed exit 0', text)
        self.assertEqual(h.State(self.root).task('F001')['notes'], notes)

    def test_show_missing_refs_gives_a_narrow_reading_instruction(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(h.main(['--root', str(self.root), 'show', 'F001']), 0)
        self.assertIn('edit F001 --ref', output.getvalue())
        self.assertIn('requirement or decision', output.getvalue())

    def test_archive_preserves_records_reading_and_dependency_readiness(self):
        self.verify()
        self.assertEqual(self.run_cli('done', 'F001'), 0)
        state = h.State(self.root)
        completed = copy.deepcopy(state.task('F001'))
        dependent = dict(self.task, id='F002', state='not_started', dependsOn=['F001'])
        state.tasks.append(dependent)
        state.data['nextId'] = 3
        state.save()
        self.assertEqual(self.run_cli('archive'), 0)
        state = h.State(self.root)
        self.assertEqual([t['id'] for t in state.tasks], ['F002'])
        self.assertEqual(h.read_json(self.root / 'docs/archive/F001.json'), completed)
        self.assertEqual([t['id'] for t in state.ready()], ['F002'])
        self.assertEqual(self.run_cli('validate'), 0)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(h.main(['--root', str(self.root), 'show', 'F001', '--history']), 0)
            self.assertEqual(h.main(['--root', str(self.root), 'list', '--all']), 0)
        self.assertIn('F001 [passing]', output.getvalue())
        self.assertIn('archived', output.getvalue())

    def test_archive_refuses_unfinished_stale_and_unmerged_tasks(self):
        for state_name in ('not_started', 'active', 'blocked', 'verified'):
            with self.subTest(state=state_name):
                self.task['state'] = state_name
                self.save()
                self.assertEqual(self.run_cli('archive', 'F001'), 1)
                self.assertFalse((self.root / 'docs/archive/F001.json').exists())
        self.task.update(state='passing', delivery={'mode': 'pr', 'base': 'main'})
        self.save()
        self.assertEqual(self.run_cli('archive', 'F001'), 1)
        self.assertEqual(self.run_cli('archive'), 0)
        self.assertEqual(len(h.State(self.root).tasks), 1)
        self.task.pop('delivery')
        self.task['evidence'] = {'version': 3, 'taskHash': 'stale'}
        self.save()
        self.assertEqual(self.run_cli('archive', 'F001'), 1)
        self.assertFalse((self.root / 'docs/archive/F001.json').exists())

    def test_archived_dropped_task_does_not_satisfy_dependency(self):
        self.task['state'] = 'dropped'
        self.save()
        self.assertEqual(self.run_cli('archive'), 0)
        state = h.State(self.root)
        state.tasks.append(dict(self.task, id='F002', state='not_started', dependsOn=['F001']))
        state.data['nextId'] = 3
        state.save()
        state = h.State(self.root)
        self.assertFalse(state.satisfied('F001'))
        self.assertEqual(state.ready(), [])
        self.assertEqual(self.run_cli('validate'), 0)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            h.main(['--root', str(self.root), 'status'])
        self.assertIn('depends on dropped F001', output.getvalue())

    def test_archiving_does_not_stale_verified_work(self):
        self.verify()
        state = h.State(self.root)
        state.tasks.append(dict(self.task, id='F002', state='passing'))
        state.data['nextId'] = 3
        state.save()
        self.assertEqual(self.run_cli('archive'), 0)
        state = h.State(self.root)
        self.assertIsNone(h.stale_reason(state, state.task('F001')))

    def test_archived_task_can_be_reopened_and_ids_are_not_reused(self):
        self.task.update(id='F009', state='passing')
        self.save()
        self.assertEqual(self.run_cli('archive'), 0)
        self.assertEqual(self.run_cli('add', 'next task', '--accept', 'value is one', '--check', 'unit'), 0)
        self.assertEqual([t['id'] for t in h.State(self.root).tasks], ['F010'])
        self.assertEqual(self.run_cli('reopen', 'F009', '--reason', 'repeat work'), 0)
        state = h.State(self.root)
        self.assertEqual(state.task('F009')['state'], 'active')
        self.assertEqual(state.task('F009')['acceptance'], self.task['acceptance'])
        self.assertFalse((self.root / 'docs/archive/F009.json').exists())

    def test_archive_does_not_overwrite_a_conflicting_record(self):
        self.task['state'] = 'passing'
        self.save()
        path = self.root / 'docs/archive/F001.json'
        path.parent.mkdir()
        previous = dict(self.task, behavior='different behavior')
        h.write_json(path, previous)
        self.assertEqual(self.run_cli('archive', 'F001'), 1)
        self.assertEqual(h.read_json(path), previous)
        self.assertEqual(len(h.State(self.root).tasks), 1)

    def test_archived_remote_task_is_recognized_as_merged(self):
        self.task.update(state='passing', delivery={'mode': 'pr', 'base': 'main'})
        self.save()
        state = h.State(self.root)
        with patch.object(h, 'git', side_effect=[json.dumps({'tasks': []}), json.dumps(self.task)]):
            self.assertFalse(h.unmerged(state, self.task))

    def test_archived_task_branch_is_not_reported_as_unknown_work(self):
        self.task['state'] = 'passing'
        self.save()
        self.assertEqual(self.run_cli('archive'), 0)
        with patch.object(h, 'current_branch', return_value='main'), \
                patch.object(h, 'git', return_value='fix/f001-value-is-one'):
            self.assertEqual(h.branches_elsewhere(h.State(self.root)), [])

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

    def test_docs_only_changes_run_only_docs_checks(self):
        from argparse import Namespace
        self.task['verification'] = ['docs-check']
        self.config['checks'] = [
            {'id': 'docs-check', 'argv': [sys.executable, '-c', 'pass'], 'required': True, 'precommit': True, 'docs': True},
            {'id': 'unit', 'argv': [sys.executable, '-c', 'raise SystemExit(1)'], 'required': True, 'precommit': True}]
        self.save()
        git = lambda *args: subprocess.run(['git', *args], cwd=self.root, check=True, capture_output=True, text=True).stdout
        git('init', '-q')
        git('add', '.')
        git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'base')
        self.task['baseCommit'] = git('rev-parse', 'HEAD').strip()
        self.save()
        hook = lambda: h.cmd_hook(self.root, Namespace(name='pre-commit'))
        (self.root / 'README.md').write_text('docs\n')
        git('add', 'README.md')
        self.assertEqual(h.run_order(h.State(self.root), self.task), ['docs-check'])
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(hook(), 0)
            (self.root / 'value.py').write_text('value = 1\n')
            git('add', 'value.py')
            self.assertEqual(h.run_order(h.State(self.root), self.task), ['docs-check', 'unit'])
            self.assertEqual(hook(), 1)

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

    def test_sigterm_stops_the_running_check(self):
        pid_file = self.root / 'check.pid'
        self.config['checks'][0]['argv'] = [
            sys.executable, '-c', f'import os, time; open({str(pid_file)!r}, "w").write(str(os.getpid())); time.sleep(30)']
        self.save()
        harness = subprocess.Popen([sys.executable, spec.origin, '--root', str(self.root), 'check', 'unit'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 10
        while not pid_file.exists() or not pid_file.read_text():
            self.assertLess(time.monotonic(), deadline, 'the check never started')
            time.sleep(.05)
        check = int(pid_file.read_text())
        harness.terminate()
        harness.wait(timeout=10)
        while time.monotonic() < deadline:
            try:
                os.kill(check, 0)
            except ProcessLookupError:
                return
            time.sleep(.05)
        os.kill(check, 9)
        self.fail('the check kept running after the harness got SIGTERM')

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
