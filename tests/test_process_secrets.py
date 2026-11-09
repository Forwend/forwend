"""Which secrets scripts/with-env.sh hands each backend program: only presence is printed, never a value."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'apps/backend/scripts/with-env.sh'
SECRETS = ['RESEND_API_KEY', 'EXECUTOR_PRIVATE_KEY', 'PRIVY_APP_SECRET', 'ONECLICK_API_KEY']


def held(program):
    """The secrets a program named program gets, as names."""
    with tempfile.TemporaryDirectory() as tmp:
        stub = Path(tmp) / program
        stub.write_text('#!/bin/sh\n' + ''.join(f'[ -n "${{{s}:-}}" ] && echo {s}\n' for s in SECRETS) + 'exit 0\n')
        stub.chmod(0o755)
        env = {**os.environ, **{s: 'stand-in' for s in SECRETS}}
        out = subprocess.run(['sh', str(SCRIPT), str(stub)], env=env, capture_output=True, text=True, check=True)
        return set(out.stdout.split())


class ProcessSecretsTests(unittest.TestCase):
    def test_the_api_sends_codes_but_never_holds_the_executor_key(self):
        # R-137: the api emails Confirm it's you codes itself.
        self.assertIn('RESEND_API_KEY', held('api'))
        self.assertNotIn('EXECUTOR_PRIVATE_KEY', held('api'))

    def test_the_worker_sends_email_and_the_signer_never_does(self):
        self.assertIn('RESEND_API_KEY', held('worker'))
        self.assertNotIn('RESEND_API_KEY', held('signer'))
        self.assertIn('EXECUTOR_PRIVATE_KEY', held('signer'))

    def test_only_the_api_and_the_worker_hold_the_1click_key(self):
        # D-123: the api asks for quotes and the worker reads the token list; nothing else, tests included, needs it.
        for program in ('api', 'worker'):
            self.assertIn('ONECLICK_API_KEY', held(program))
        for program in ('signer', 'webhooks', 'go'):
            self.assertNotIn('ONECLICK_API_KEY', held(program))


if __name__ == '__main__':
    unittest.main()
