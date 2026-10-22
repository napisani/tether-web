#!/usr/bin/env python3
"""Regression checks for manual core snapshot input validation."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

WORKFLOW = Path(__file__).resolve().parents[1] / '.github/workflows/core-image.yml'

class SnapshotValidation(unittest.TestCase):
    def test_malformed_snapshot_rejected_before_network(self):
        text = WORKFLOW.read_text()
        run = text.split('        run: |\n', 1)[1].split('\n  build:', 1)[0]
        run = '\n'.join(line[10:] for line in run.splitlines())
        for value in ['main', '549f6eb', '$(touch /should-not-exist)', 'a'*40+'\n']:
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                env = dict(os.environ, TAG='v0.2.40', COMMIT=value, GITHUB_OUTPUT=directory+'/output')
                result = subprocess.run(['bash', '-euo', 'pipefail', '-c', run], env=env, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('full lowercase 40-character SHA', result.stdout)

if __name__ == '__main__':
    unittest.main()
