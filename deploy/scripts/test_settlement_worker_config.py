from __future__ import annotations

import os
import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SettlementWorkerConfigTests(unittest.TestCase):
    def test_worker_gate_matches_backend_boolean_values(self) -> None:
        compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
        match = re.search(
            r'        case "\$\$ECONOMY_SETTLEMENT_ENABLED" in\n((?:          .*\n)+)        esac;',
            compose,
        )
        self.assertIsNotNone(
            match,
            "local settlement worker must gate disabled config without restarting",
        )
        gate = 'case "$ECONOMY_SETTLEMENT_ENABLED" in\n' + match.group(1) + "esac"
        gate = gate.replace("$$", "$")
        enabled_values = ("1", "true", "TRUE", "yes", "Yes", "on", "On")
        disabled_values = ("0", "false", "no", "off", "", "enabled")
        for value in enabled_values:
            with self.subTest(value=value):
                result = subprocess.run(
                    ["/bin/sh", "-ec", f"{gate}; echo enabled"],
                    capture_output=True,
                    text=True,
                    check=False,
                    env={**os.environ, "ECONOMY_SETTLEMENT_ENABLED": value},
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), "enabled")
        for value in disabled_values:
            with self.subTest(value=value):
                result = subprocess.run(
                    ["/bin/sh", "-ec", gate],
                    capture_output=True,
                    text=True,
                    check=False,
                    env={**os.environ, "ECONOMY_SETTLEMENT_ENABLED": value},
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("disabled", result.stdout)


if __name__ == "__main__":
    unittest.main()
