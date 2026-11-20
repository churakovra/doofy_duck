from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEST_ENV = {
    "POSTGRES_ADMIN_PASSWORD": "test-admin",
    "PLATFORM_DB_PASSWORD": "test-platform",
    "ECONOMY_DB_PASSWORD": "test-economy",
    "CORE_DB_PASSWORD": "test-core",
    "TELEGRAM_BOT_TOKEN": "development-placeholder",
    "TELEGRAM_BOT_TOKEN_REAL": "real-token-canary-do-not-print",
    "ACCESS_TOKEN_PRIVATE_KEY_B64": "test-private-key",
    "ACCESS_TOKEN_KEY_ID": "test-key",
    "ACCESS_TOKEN_PUBLIC_KEYS_JSON": "{}",
    "CORE_TO_PLATFORM_TOKEN": "test-core-platform",
    "CORE_OPERATOR_TOKEN": "test-operator",
}


@unittest.skipUnless(shutil.which("docker"), "Docker Compose is required for rendered config checks")
class TelegramComposeConfigTests(unittest.TestCase):
    def run_compose_config(
        self, environment: dict[str, str], *, telegram_test: bool = True
    ) -> subprocess.CompletedProcess[str]:
        compose = ["docker", "compose", "--env-file", "/dev/null", "-f", "deploy/compose.yaml"]
        if telegram_test:
            compose.extend(("-f", "deploy/compose.telegram-test.yaml"))
        return subprocess.run(
            [*compose, "config", "--format", "json"],
            cwd=ROOT.parent,
            env={**os.environ, **environment},
            capture_output=True,
            text=True,
            check=False,
        )

    def test_local_stack_uses_vite_and_migrates_core_on_startup(self) -> None:
        result = self.run_compose_config(TEST_ENV, telegram_test=False)
        self.assertEqual(result.returncode, 0, "Local Compose configuration should render")
        services = json.loads(result.stdout)["services"]
        self.assertNotIn("web", services)
        self.assertNotIn("core-migrate", services)
        self.assertNotIn("build", services["gateway"])
        self.assertEqual(services["core"]["environment"]["CORE_AUTO_MIGRATE"], "true")

    def test_overlay_requires_a_real_bot_token_and_disables_development_auth(self) -> None:
        result = self.run_compose_config(TEST_ENV)
        self.assertEqual(result.returncode, 0, "Telegram test Compose configuration should render")
        config = json.loads(result.stdout)
        platform = config["services"]["platform"]["environment"]
        self.assertEqual(platform["DD_ENV"], "development")
        self.assertEqual(platform["DEV_AUTH_ENABLED"], "false")
        self.assertEqual(platform["DEV_AUTH_USER_ID"], "0")
        self.assertEqual(platform["TELEGRAM_BOT_TOKEN"], TEST_ENV["TELEGRAM_BOT_TOKEN_REAL"])

        gateway = config["services"]["gateway"]
        self.assertEqual(gateway["build"]["dockerfile"], "deploy/gateway.Dockerfile")
        port = gateway["ports"][0]
        self.assertEqual((port["host_ip"], port["published"], port["target"]), ("127.0.0.1", "8080", 80))
        self.assertNotIn(TEST_ENV["TELEGRAM_BOT_TOKEN_REAL"], result.stderr)

    def test_overlay_fails_when_real_bot_token_is_missing(self) -> None:
        environment = {key: value for key, value in TEST_ENV.items() if key != "TELEGRAM_BOT_TOKEN_REAL"}
        result = self.run_compose_config(environment)
        self.assertNotEqual(result.returncode, 0, "configuration must fail without the real bot token")
        self.assertIn("TELEGRAM_BOT_TOKEN_REAL", result.stderr)
        self.assertNotIn(TEST_ENV["TELEGRAM_BOT_TOKEN"], result.stderr)


if __name__ == "__main__":
    unittest.main()
