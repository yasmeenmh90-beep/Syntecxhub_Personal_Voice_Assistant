import plistlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.launcher import ActionError, find_macos_app, launch


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="NOVA app tests ")
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "Calculator.app"
        (self.path / "Contents/MacOS").mkdir(parents=True)
        (self.path / "Contents/MacOS/Calculator").write_bytes(b"test")
        self.info = self.path / "Contents/Info.plist"
        self.write_info("com.apple.calculator")
        patcher = patch(
            "backend.launcher.MAC_APPS",
            {"calculator": ("com.apple.calculator", (str(self.path),))},
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def write_info(self, identifier):
        with self.info.open("wb") as file:
            plistlib.dump(
                {"CFBundleIdentifier": identifier, "CFBundleExecutable": "Calculator"},
                file,
            )

    def test_resolves_installed_bundle(self):
        self.assertEqual(find_macos_app("calculator"), self.path.resolve())

    def test_rejects_wrong_bundle_identifier(self):
        self.write_info("com.example.untrusted")
        with self.assertRaisesRegex(ActionError, "unavailable"):
            find_macos_app("calculator")

    def test_rejects_missing_executable(self):
        (self.path / "Contents/MacOS/Calculator").unlink()
        with self.assertRaises(ActionError):
            find_macos_app("calculator")

    def test_rejects_malformed_bundle(self):
        self.info.write_bytes(b"not a plist")
        with self.assertRaises(ActionError):
            find_macos_app("calculator")

    def test_rejects_unlisted_application(self):
        with patch("backend.launcher.subprocess.run") as run:
            with self.assertRaises(ActionError):
                launch("/bin/sh")
            with self.assertRaises(ActionError):
                find_macos_app("calculator;whoami")
            run.assert_not_called()

    @patch("backend.launcher.platform.system", return_value="Darwin")
    def test_launches_exact_bundle_with_separate_arguments(self, system):
        with patch(
            "backend.launcher.subprocess.run",
            return_value=subprocess.CompletedProcess([], 0, stderr=""),
        ) as run:
            self.assertIn("accepted", launch("calculator"))
            self.assertEqual(
                run.call_args.args[0], ["/usr/bin/open", "-a", str(self.path.resolve())]
            )
            self.assertNotIn("shell", run.call_args.kwargs)

    @patch("backend.launcher.platform.system", return_value="Darwin")
    def test_launch_rejection_is_not_success(self, system):
        with patch(
            "backend.launcher.subprocess.run",
            return_value=subprocess.CompletedProcess(
                [], 1, stderr="LaunchServices denied"
            ),
        ):
            with self.assertRaisesRegex(
                ActionError, "installed.*rejected.*LaunchServices denied"
            ):
                launch("calculator")

    @patch("backend.launcher.platform.system", return_value="Darwin")
    def test_launch_timeout(self, system):
        with patch(
            "backend.launcher.subprocess.run",
            side_effect=subprocess.TimeoutExpired("open", 10),
        ):
            with self.assertRaisesRegex(ActionError, "Could not launch"):
                launch("calculator")


if __name__ == "__main__":
    unittest.main()
