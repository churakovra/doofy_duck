import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from ensure_dev_env import ensure_dev_env


class EnsureDevEnvTests(unittest.TestCase):
    def test_adds_missing_local_defaults_once_and_preserves_existing_values(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env.dev"
            path.write_text(
                "POSTGRES_ADMIN_PASSWORD='keep-me'\nECONOMY_SHOP_ENABLED=false\n",
                encoding="utf-8",
            )
            cutoff = datetime(2026, 10, 18, 12, 30, tzinfo=timezone.utc)

            ensure_dev_env(path, now=lambda: cutoff)
            first = path.read_text(encoding="utf-8")
            ensure_dev_env(path, now=lambda: datetime(2030, 1, 1, tzinfo=timezone.utc))

            self.assertEqual(path.read_text(encoding="utf-8"), first)
            self.assertIn("POSTGRES_ADMIN_PASSWORD='keep-me'", first)
            self.assertIn("ECONOMY_SHOP_ENABLED=false", first)
            self.assertIn("ECONOMY_SETTLEMENT_ENABLED='true'", first)
            self.assertIn(
                "ECONOMY_SETTLEMENT_ACTIVATED_AT='2026-10-18T12:30:00Z'", first
            )

    def test_creates_local_defaults_for_new_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env.dev"
            ensure_dev_env(
                path, now=lambda: datetime(2026, 10, 18, 12, 30, tzinfo=timezone.utc)
            )
            content = path.read_text(encoding="utf-8")
            self.assertIn("ECONOMY_SETTLEMENT_ENABLED='true'", content)
            self.assertIn("ECONOMY_SHOP_ENABLED='true'", content)
            self.assertIn(
                "ECONOMY_SETTLEMENT_ACTIVATED_AT='2026-10-18T12:30:00Z'", content
            )


if __name__ == "__main__":
    unittest.main()
